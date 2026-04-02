import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/trainer-assignments — Create a trainer assignment (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const assignment = await prisma.trainerAssignment.create({
    data: {
      trainerId: body.trainerId,
      traineeId: body.traineeId,
      tiers: body.tiers?.length
        ? {
            create: body.tiers.map((t: { upToDeal: number | null; ratePerW: number }, i: number) => ({
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
  const body = await req.json();
  const { id, tiers } = body;
  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  const assignment = await prisma.trainerAssignment.update({
    where: { id },
    data: {
      tiers: {
        create: (tiers ?? []).map((t: { upToDeal: number | null; ratePerW: number }, i: number) => ({
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
  const { id } = await req.json();
  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  await prisma.trainerAssignment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
