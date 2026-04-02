import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../lib/db';

// GET /api/mentions?userId=xxx — Get unread mentions for a user
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const mentionUserId = req.nextUrl.searchParams.get('userId');
  if (!mentionUserId) {
    return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  }

  const mentions = await prisma.projectMention.findMany({
    where: { userId: mentionUserId },
    include: {
      message: {
        include: {
          project: true,
          checkItems: true,
        },
      },
    },
    orderBy: { message: { createdAt: 'desc' } },
  });

  return NextResponse.json(mentions);
}
