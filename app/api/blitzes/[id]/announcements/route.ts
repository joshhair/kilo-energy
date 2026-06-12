import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser } from '../../../../../lib/api-auth';

// GET /api/blitzes/[id]/announcements?offset=0&limit=20 — paginated
// announcement history for the "View all" sheet. Same field-level gate as
// the preview on GET /api/blitzes/[id]: the blitz page is open-discovery,
// announcements are roster-only (managers, owner/creator, approved or
// invited participants — waitlisted excluded until promoted).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const blitz = await prisma.blitz.findUnique({
    where: { id },
    select: {
      ownerId: true,
      createdById: true,
      participants: { where: { userId: user.id }, select: { joinStatus: true } },
    },
  });
  if (!blitz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  const viewerJoinStatus = blitz.participants[0]?.joinStatus ?? null;
  const canSee =
    user.role === 'admin' ||
    user.role === 'project_manager' ||
    blitz.ownerId === user.id ||
    blitz.createdById === user.id ||
    viewerJoinStatus === 'approved' ||
    viewerJoinStatus === 'invited';
  if (!canSee) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10) || 20));

  const [rows, total] = await Promise.all([
    prisma.blitzAnnouncement.findMany({
      where: { blitzId: id },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.blitzAnnouncement.count({ where: { blitzId: id } }),
  ]);
  return NextResponse.json({ announcements: rows, total });
}
