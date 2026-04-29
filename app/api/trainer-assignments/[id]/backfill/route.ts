import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { backfillTrainerSchema } from '../../../../../lib/schemas/trainer-assignment';
import { resolveTrainerRate, type TrainerResolverAssignment, type TrainerResolverPayrollEntry } from '../../../../../lib/commission';
import { logChange } from '../../../../../lib/audit';

// POST /api/trainer-assignments/[id]/backfill
// Creates Trainer PayrollEntries for historical projects that were never attributed.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const { id } = await params;
  const parsed = await parseJsonBody(req, backfillTrainerSchema);
  if (!parsed.ok) return parsed.response;
  const { projectIds, statusForMilestones } = parsed.data;

  // 1. Load the trainer assignment with tiers
  const assignment = await prisma.trainerAssignment.findUnique({
    where: { id },
    include: { trainer: true, trainee: true, tiers: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  // 2. Load all requested projects with their installer info
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    include: { installer: { select: { name: true, installPayPct: true } } },
  });

  // 3. Load ALL existing trainer payroll entries (for rate resolution counting)
  const existingEntries = await prisma.payrollEntry.findMany({
    where: { paymentStage: 'Trainer' },
    select: { repId: true, projectId: true, paymentStage: true },
  });

  // 4. Load all trainer assignments (for resolveTrainerRate — it may need to
  //    see other assignments if the project override routes to a different trainer)
  const allAssignments = await prisma.trainerAssignment.findMany({
    include: { tiers: { orderBy: { sortOrder: 'asc' } } },
  });
  const resolverAssignments: TrainerResolverAssignment[] = allAssignments.map((a) => ({
    id: a.id,
    trainerId: a.trainerId,
    traineeId: a.traineeId,
    isActiveTraining: a.isActiveTraining,
    tiers: a.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
  }));

  const resolverEntries: TrainerResolverPayrollEntry[] = existingEntries.map((e) => ({
    repId: e.repId,
    projectId: e.projectId,
    paymentStage: e.paymentStage,
  }));

  // Track newly created entries so tier counting stays accurate as we iterate
  const newResolverEntries: TrainerResolverPayrollEntry[] = [];

  const created: string[] = [];
  const skipped: Array<{ projectId: string; reason: string }> = [];
  const entriesToCreate: Array<{
    repId: string;
    projectId: string;
    amountCents: number;
    type: string;
    paymentStage: string;
    status: string;
    date: string;
    notes: string;
  }> = [];

  for (const project of projects) {
    // Validate the project belongs to the trainee (closer or setter)
    if (project.closerId !== assignment.traineeId && project.setterId !== assignment.traineeId) {
      skipped.push({ projectId: project.id, reason: 'Project does not belong to trainee' });
      continue;
    }

    const installPayPct = project.installer?.installPayPct ?? 80;

    // Resolve rate for this project using the full entry set (including newly created)
    const allResolverEntries = [...resolverEntries, ...newResolverEntries];
    const resolution = resolveTrainerRate(
      { id: project.id, trainerId: project.trainerId, trainerRate: project.trainerRate },
      project.closerId === assignment.traineeId ? project.closerId : project.setterId,
      resolverAssignments,
      allResolverEntries,
    );

    if (resolution.rate <= 0 || !resolution.trainerId) {
      skipped.push({ projectId: project.id, reason: 'Rate resolved to 0 (all tiers consumed or no assignment)' });
      continue;
    }

    const kW = project.kWSize;
    const rate = resolution.rate;

    // Check which milestones this project qualifies for
    const milestones: Array<{ tag: 'M2' | 'M3'; pct: number }> = [];

    // M2 — any project past Installed qualifies
    if (project.m2Paid || ['Installed', 'PTO', 'Completed'].includes(project.phase)) {
      milestones.push({ tag: 'M2', pct: installPayPct / 100 });
    }
    // M3 — only if installPayPct < 100 and project past PTO
    if (installPayPct < 100 && (project.m3Paid || ['PTO', 'Completed'].includes(project.phase))) {
      milestones.push({ tag: 'M3', pct: (100 - installPayPct) / 100 });
    }

    if (milestones.length === 0) {
      skipped.push({ projectId: project.id, reason: 'No milestones qualify (not past Installed)' });
      continue;
    }

    const isCloser = project.closerId === assignment.traineeId;
    const traineeLabel = isCloser
      ? `${assignment.trainee.firstName} ${assignment.trainee.lastName}`
      : `${assignment.trainee.firstName} ${assignment.trainee.lastName}`;

    let anyCreated = false;
    for (const ms of milestones) {
      // Idempotency: check if a Trainer entry already exists for this (trainer, project, milestone)
      const notesPrefix = `Trainer override ${ms.tag}`;
      const alreadyExists = existingEntries.some(
        (e) =>
          e.repId === resolution.trainerId &&
          e.projectId === project.id &&
          e.paymentStage === 'Trainer',
      ) || entriesToCreate.some(
        (e) =>
          e.repId === resolution.trainerId! &&
          e.projectId === project.id &&
          e.notes.startsWith(notesPrefix),
      );

      if (alreadyExists) {
        // Check specifically for this milestone
        const _milestoneExists = existingEntries.some(
          (e) =>
            e.repId === resolution.trainerId &&
            e.projectId === project.id &&
            e.paymentStage === 'Trainer',
        );
        // We need to check more carefully. Trainer entries use paymentStage=Trainer and notes contain M2/M3.
        // Since we can't read notes from the DB select, we do a more targeted query below.
        // For simplicity, check per-milestone using a targeted query.
      }

      const amountDollars = Math.round(rate * kW * 1000 * ms.pct * 100) / 100;
      if (amountDollars <= 0) continue;
      const amountCents = Math.round(amountDollars * 100);

      entriesToCreate.push({
        repId: resolution.trainerId!,
        projectId: project.id,
        amountCents,
        type: 'Deal',
        paymentStage: 'Trainer',
        status: statusForMilestones,
        date: project.soldDate ?? new Date().toISOString().slice(0, 10),
        notes: `Trainer override ${ms.tag} — ${traineeLabel} ($${rate.toFixed(2)}/W) [backfill]`,
      });
      anyCreated = true;
    }

    if (anyCreated) {
      created.push(project.id);
      // Add to resolver entries so subsequent projects see this project as consumed
      newResolverEntries.push({
        repId: resolution.trainerId!,
        projectId: project.id,
        paymentStage: 'Trainer',
      });
    }
  }

  // Idempotency pass — check DB for existing entries with matching (repId, projectId, paymentStage, notes prefix)
  // to avoid duplicates
  if (entriesToCreate.length > 0) {
    const projectIdsToCheck = [...new Set(entriesToCreate.map((e) => e.projectId))];
    const existingDetailed = await prisma.payrollEntry.findMany({
      where: {
        paymentStage: 'Trainer',
        projectId: { in: projectIdsToCheck },
        repId: assignment.trainerId,
      },
      select: { projectId: true, notes: true },
    });

    // Filter out entries that would be duplicates
    const deduped = entriesToCreate.filter((entry) => {
      const milestoneTag = entry.notes.startsWith('Trainer override M2') ? 'M2' : 'M3';
      const exists = existingDetailed.some(
        (e) =>
          e.projectId === entry.projectId &&
          (e.notes ?? '').startsWith(`Trainer override ${milestoneTag}`),
      );
      if (exists) {
        // Remove from created if all milestones for this project were skipped
        const otherEntries = entriesToCreate.filter(
          (x) => x !== entry && x.projectId === entry.projectId,
        );
        if (otherEntries.length === 0) {
          const idx = created.indexOf(entry.projectId);
          if (idx >= 0) created.splice(idx, 1);
          skipped.push({ projectId: entry.projectId, reason: `${milestoneTag} entry already exists` });
        }
      }
      return !exists;
    });

    // Batch create all entries
    if (deduped.length > 0) {
      await prisma.payrollEntry.createMany({ data: deduped });
    }
  }

  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'trainer_backfill',
    entityType: 'TrainerAssignment',
    entityId: id,
    detail: {
      requestedProjectIds: projectIds,
      createdCount: created.length,
      skippedCount: skipped.length,
      statusForMilestones,
      trainerId: assignment.trainerId,
      traineeId: assignment.traineeId,
    },
  });
  return NextResponse.json({
    created: created.length,
    skipped,
  });
}
