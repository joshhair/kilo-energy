import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/trainer-assignments — Create a trainer assignment
export async function POST(req: NextRequest) {
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
