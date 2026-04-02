import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../../../lib/db';

// GET /api/projects/[id]/messages — List messages for a project (paginated)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const url = new URL(_req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '30', 10) || 30, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const [total, messages] = await Promise.all([
    prisma.projectMessage.count({ where: { projectId: id } }),
    prisma.projectMessage.findMany({
      where: { projectId: id },
      include: { checkItems: true, mentions: true },
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: limit,
    }),
  ]);

  return NextResponse.json({ messages, total });
}

// POST /api/projects/[id]/messages — Create a new message
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();

  if (!body.authorId || !body.authorName || !body.authorRole || !body.text) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const message = await prisma.projectMessage.create({
    data: {
      projectId: id,
      authorId: body.authorId,
      authorName: body.authorName,
      authorRole: body.authorRole,
      text: body.text,
      checkItems: body.checkItems?.length
        ? { create: body.checkItems.map((ci: any) => ({
            text: typeof ci === 'string' ? ci : ci.text,
            dueDate: (typeof ci === 'object' && ci.dueDate) ? new Date(ci.dueDate) : null,
          })) }
        : undefined,
      mentions: body.mentionUserIds?.length
        ? { create: body.mentionUserIds.map((userId: string) => ({ userId })) }
        : undefined,
    },
    include: { checkItems: true, mentions: true },
  });

  return NextResponse.json(message);
}
