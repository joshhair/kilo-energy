import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireInternalUser } from '../../../../lib/api-auth';

// GET /api/auth/baseline — return baseline-relevant data for the
// currently-signed-in user.
//
// Privacy: this endpoint is keyed entirely off the session — no userId
// param. Cross-user reads are structurally impossible. Each rep only
// sees their own chain assignment, never another rep's pay context.
//
// What ships:
//   - repType  ("closer" | "setter" | "both")
//   - trainerChain  → who deducts from THIS user's pay (the user is the
//                     trainee). Includes trainer name + active tier
//                     rate (the rate they're currently earning).
//   - trainees      → who THIS user trains (the user is the trainer).
//                     Each entry includes the trainee's name + active
//                     tier rate they earn off of.
//
// What's intentionally NOT here:
//   - Per-installer per-watt rates. Those depend on installer + product
//     + tier and are visible via the Calculator (where the rep can
//     view-as themselves). Bundling them here would lock in a single
//     installer's number and mislead reps with multi-installer pay.
//   - Customer-level commission data. The My Pay page already shows
//     paid + pending entries.
export async function GET() {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  // Trainer chain: assignments where this user is the trainee.
  const traineeOf = await prisma.trainerAssignment.findMany({
    where: { traineeId: user.id, isActiveTraining: true },
    include: {
      trainer: { select: { id: true, firstName: true, lastName: true } },
      tiers: { orderBy: { sortOrder: 'asc' } },
    },
  });

  // Trainee chain: assignments where this user is the trainer.
  const trainerOf = await prisma.trainerAssignment.findMany({
    where: { trainerId: user.id, isActiveTraining: true },
    include: {
      trainee: { select: { id: true, firstName: true, lastName: true } },
      tiers: { orderBy: { sortOrder: 'asc' } },
    },
  });

  // Pick the first tier that still has capacity. Mirrors the
  // resolveTrainerRate logic (lib/commission.ts) but without the
  // consumed-deal count — for display only, exact M2/M3 deductions
  // happen at payroll time.
  function activeTierRate(tiers: Array<{ upToDeal: number | null; ratePerW: number }>): number | null {
    for (const t of tiers) {
      if (t.upToDeal === null || t.upToDeal > 0) return t.ratePerW;
    }
    return null;
  }

  const trainerChain = traineeOf.map((a) => ({
    assignmentId: a.id,
    trainerId: a.trainer?.id ?? null,
    trainerName: a.trainer
      ? `${a.trainer.firstName ?? ''} ${a.trainer.lastName ?? ''}`.trim()
      : 'Unknown',
    activeRatePerW: activeTierRate(a.tiers),
  }));

  const trainees = trainerOf.map((a) => ({
    assignmentId: a.id,
    traineeId: a.trainee?.id ?? null,
    traineeName: a.trainee
      ? `${a.trainee.firstName ?? ''} ${a.trainee.lastName ?? ''}`.trim()
      : 'Unknown',
    activeRatePerW: activeTierRate(a.tiers),
  }));

  return NextResponse.json({
    repType: user.repType,
    trainerChain,
    trainees,
  });
}
