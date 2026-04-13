import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// PATCH /api/incentives/[id] — Update an incentive (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.active !== undefined) data.active = body.active;
  if (body.endDate !== undefined) data.endDate = body.endDate;
  if (body.metric !== undefined) data.metric = body.metric;
  if (body.period !== undefined) data.period = body.period;
  if (body.startDate !== undefined) data.startDate = body.startDate;
  if (body.type !== undefined) data.type = body.type;
  if (body.targetRepId !== undefined) data.targetRepId = body.targetRepId;

  let incentive;
  if (body.milestones !== undefined) {
    const milestones = body.milestones as { id?: string; threshold: number; reward: string; achieved?: boolean }[];
    const withId = milestones.filter((m) => m.id);
    const withoutId = milestones.filter((m) => !m.id);
    const keepIds = withId.map((m) => m.id as string);
    incentive = await prisma.incentive.update({
      where: { id },
      data: {
        ...data,
        milestones: {
          deleteMany: keepIds.length > 0 ? { id: { notIn: keepIds } } : {},
          upsert: withId.map((m) => ({
            where: { id: m.id as string },
            update: { threshold: m.threshold, reward: m.reward, achieved: m.achieved ?? false },
            create: { threshold: m.threshold, reward: m.reward, achieved: m.achieved ?? false },
          })),
          create: withoutId.map((m) => ({
            threshold: m.threshold,
            reward: m.reward,
            achieved: m.achieved ?? false,
          })),
        },
      },
      include: { milestones: true },
    });
  } else {
    incentive = await prisma.incentive.update({
      where: { id },
      data,
      include: { milestones: true },
    });
  }
  return NextResponse.json(incentive);
}

// DELETE /api/incentives/[id] (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.incentive.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
