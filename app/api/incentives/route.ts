import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/incentives — Create an incentive (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const incentive = await prisma.incentive.create({
    data: {
      title: body.title,
      description: body.description || '',
      type: body.type,
      metric: body.metric,
      period: body.period,
      startDate: body.startDate,
      endDate: body.endDate || null,
      targetRepId: body.targetRepId || null,
      active: body.active ?? true,
      blitzId: body.blitzId || null,
      milestones: body.milestones?.length
        ? {
            create: body.milestones.map((m: { threshold: number; reward: string }) => ({
              threshold: m.threshold,
              reward: m.reward,
            })),
          }
        : undefined,
    },
    include: { milestones: true },
  });
  return NextResponse.json(incentive, { status: 201 });
}
