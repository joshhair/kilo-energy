import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createIncentiveSchema } from '../../../lib/schemas/incentive';

// POST /api/incentives — Create an incentive (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createIncentiveSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const incentive = await prisma.incentive.create({
    data: {
      title: body.title,
      description: body.description ?? '',
      type: body.type,
      metric: body.metric,
      period: body.period,
      startDate: body.startDate,
      endDate: body.endDate ?? null,
      targetRepId: body.targetRepId ?? null,
      active: body.active,
      blitzId: body.blitzId ?? null,
      milestones: {
        create: body.milestones.map((m) => ({
          threshold: m.threshold,
          reward: m.reward,
        })),
      },
    },
    include: { milestones: true },
  });
  return NextResponse.json(incentive, { status: 201 });
}
