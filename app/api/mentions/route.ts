import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';

// GET /api/mentions?userId=xxx — Get unread mentions for a user.
// Non-admin callers can only request their own mentions. Admin may
// query any user's mentions (e.g. for an audit/debug view).
export async function GET(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const mentionUserId = req.nextUrl.searchParams.get('userId');
  if (!mentionUserId) {
    return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  }

  // ─── Privacy guard: non-admins can only read their own mentions ───
  if (user.role !== 'admin' && mentionUserId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
