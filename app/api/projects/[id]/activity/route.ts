import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../lib/api-auth';

// GET /api/projects/[id]/activity — List all activities for a project.
// Access: admin, PM, or a rep/sub-dealer who is on the deal.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }
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

// POST /api/projects/[id]/activity — Create a new activity entry.
// Access: admin, PM, or a rep/sub-dealer who is on the deal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }
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
