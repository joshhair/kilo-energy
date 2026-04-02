import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/api-auth';

// GET /api/projects/[id]/activity — List all activities for a project
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const url = new URL(req.url);
  const take = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const skip = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const [activities, total] = await Promise.all([
    prisma.projectActivity.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.projectActivity.count({ where: { projectId: id } }),
  ]);

  return NextResponse.json({ activities, total });
}

// POST /api/projects/[id]/activity — Create a new activity entry
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const activity = await prisma.projectActivity.create({
    data: {
      projectId: id,
      type: body.type,
      detail: body.detail,
      meta: body.meta ?? null,
    },
  });

  return NextResponse.json(activity, { status: 201 });
}
