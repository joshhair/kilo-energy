import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import {
  createTrainerAssignmentSchema,
  patchTrainerAssignmentSchema,
  deleteTrainerAssignmentSchema,
} from '../../../lib/schemas/trainer-assignment';

// POST /api/trainer-assignments — Create a trainer assignment (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createTrainerAssignmentSchema);
  if (!parsed.ok) return parsed.response;
  const { trainerId, traineeId, tiers } = parsed.data;

  const assignment = await prisma.trainerAssignment.create({
    data: {
      trainerId,
      traineeId,
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
  return NextResponse.json(assignment, { status: 201 });
}

// PATCH /api/trainer-assignments — Update tiers (admin only)
export async function PATCH(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, patchTrainerAssignmentSchema);
  if (!parsed.ok) return parsed.response;
  const { id, tiers } = parsed.data;

  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  const assignment = await prisma.trainerAssignment.update({
    where: { id },
    data: {
      tiers: {
        create: tiers.map((t, i) => ({
          upToDeal: t.upToDeal,
          ratePerW: t.ratePerW,
          sortOrder: i,
        })),
      },
    },
    include: { trainer: true, trainee: true, tiers: { orderBy: { sortOrder: 'asc' } } },
  });
  return NextResponse.json(assignment);
}

// DELETE /api/trainer-assignments — Delete a trainer assignment (admin only)
export async function DELETE(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, deleteTrainerAssignmentSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  await prisma.trainerAssignment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
