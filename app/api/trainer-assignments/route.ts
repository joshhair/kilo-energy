import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import {
  createTrainerAssignmentSchema,
  patchTrainerAssignmentSchema,
  deleteTrainerAssignmentSchema,
} from '../../../lib/schemas/trainer-assignment';
import { logChange } from '../../../lib/audit';

// POST /api/trainer-assignments — Create a trainer assignment (admin only)
export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createTrainerAssignmentSchema);
  if (!parsed.ok) return parsed.response;
  const { trainerId, traineeId, tiers, isActiveTraining } = parsed.data;

  try {
    const assignment = await prisma.trainerAssignment.create({
      data: {
        trainerId,
        traineeId,
        isActiveTraining,
        tiers: tiers.length
          ? {
              create: tiers.map((t, i) => ({
                upToDeal: t.upToDeal,
                ratePerW: t.ratePerW,
                sortOrder: i,
              })),
            }
          : undefined,
      },
      include: { trainer: true, trainee: true, tiers: { orderBy: { sortOrder: 'asc' } } },
    });
    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'trainer_assignment_create',
      entityType: 'TrainerAssignment',
      entityId: assignment.id,
      detail: {
        trainerId, traineeId, isActiveTraining,
        tiers: tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
      },
    });
    return NextResponse.json(assignment, { status: 201 });
  } catch (err: unknown) {
    // Prisma unique constraint violation — trainer-trainee pair already exists
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'Assignment already exists for this trainer-trainee pair' },
        { status: 409 },
      );
    }
    throw err;
  }
}

// PATCH /api/trainer-assignments — Update tiers (admin only)
export async function PATCH(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, patchTrainerAssignmentSchema);
  if (!parsed.ok) return parsed.response;
  const { id, tiers, isActiveTraining } = parsed.data;

  const before = await prisma.trainerAssignment.findUnique({
    where: { id },
    include: { tiers: { orderBy: { sortOrder: 'asc' } } },
  });

  // Tier edits replace the entire tier set (delete-then-create). Graduation
  // toggles don't touch tiers — we only rewrite the row's scalar fields.
  if (tiers !== undefined) {
    await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  }
  const assignment = await prisma.trainerAssignment.update({
    where: { id },
    data: {
      ...(tiers !== undefined
        ? {
            tiers: {
              create: tiers.map((t, i) => ({
                upToDeal: t.upToDeal,
                ratePerW: t.ratePerW,
                sortOrder: i,
              })),
            },
          }
        : {}),
      ...(isActiveTraining !== undefined ? { isActiveTraining } : {}),
    },
    include: { trainer: true, trainee: true, tiers: { orderBy: { sortOrder: 'asc' } } },
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'trainer_assignment_update',
    entityType: 'TrainerAssignment',
    entityId: id,
    detail: {
      isActiveTrainingBefore: before?.isActiveTraining,
      isActiveTrainingAfter: assignment.isActiveTraining,
      tiersBefore: before?.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
      tiersAfter: assignment.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
    },
  });
  return NextResponse.json(assignment);
}

// DELETE /api/trainer-assignments — Delete a trainer assignment (admin only)
export async function DELETE(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, deleteTrainerAssignmentSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const before = await prisma.trainerAssignment.findUnique({
    where: { id },
    include: { tiers: true },
  });

  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  await prisma.trainerAssignment.delete({ where: { id } });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'trainer_assignment_delete',
    entityType: 'TrainerAssignment',
    entityId: id,
    detail: before
      ? {
          trainerId: before.trainerId,
          traineeId: before.traineeId,
          isActiveTraining: before.isActiveTraining,
          tiers: before.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
        }
      : { id },
  });
  return NextResponse.json({ success: true });
}
