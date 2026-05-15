/**
 * GET /api/blitzes/[id]/ics
 *
 * Returns an RFC-5545 .ics file representing the blitz event. Used by
 * the "Add to Calendar" button on the blitz detail page — tapping it
 * downloads the .ics, which iOS / Android / desktop email clients all
 * recognize and offer to import into their calendar app.
 *
 * Auth: blitz must be visible to the viewer per the same gate used on
 * GET /api/blitzes/[id]:
 *   - admin / project_manager (subject to canAccessBlitz for PMs)
 *   - owner / creator / approved-or-pending participant
 *   - everyone else: 403
 *
 * Output: Content-Type: text/calendar; Content-Disposition: attachment.
 * The Content-Disposition filename derives from the blitz name so the
 * downloaded file is recognizable ("Phoenix Blitz.ics").
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser } from '../../../../../lib/api-auth';
import { generateBlitzIcs } from '../../../../../lib/ics';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireInternalUser();
  } catch (r) {
    return r as NextResponse;
  }
  const { id } = await params;

  const blitz = await prisma.blitz.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      participants: { select: { userId: true, joinStatus: true } },
    },
  });
  if (!blitz) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // PM canAccessBlitz gate — mirrors GET /api/blitzes/[id].
  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({
      where: { id: user.id },
      select: { canAccessBlitz: true },
    });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // Visibility check — same shape as the main blitz GET route.
  if (user.role !== 'admin' && user.role !== 'project_manager') {
    const isOwner = blitz.ownerId === user.id;
    const isCreator = blitz.createdById === user.id;
    const isParticipant = blitz.participants.some(
      (p) => p.userId === user.id && (p.joinStatus === 'approved' || p.joinStatus === 'pending'),
    );
    if (!isOwner && !isCreator && !isParticipant) {
      return NextResponse.json({ error: 'Forbidden — not a participant' }, { status: 403 });
    }
  }

  // Compose the organizer block from the blitz creator. Reply-To
  // semantics inside calendar clients let attendees email this person
  // back from the event details.
  const organizerName =
    [blitz.createdBy?.firstName, blitz.createdBy?.lastName]
      .filter((n): n is string => !!n && n.trim().length > 0)
      .join(' ') || 'Kilo Energy';
  const organizer = blitz.createdBy?.email
    ? { name: organizerName, email: blitz.createdBy.email }
    : null;

  const icsBody = generateBlitzIcs({
    id: blitz.id,
    name: blitz.name,
    description: composeDescription(blitz),
    startDate: blitz.startDate,
    endDate: blitz.endDate,
    location: blitz.location || null,
    status: blitz.status,
    organizer,
    updatedAt: blitz.updatedAt.toISOString(),
  });

  // Filename derives from the blitz name. Sanitize for Content-Disposition
  // by stripping characters that would break header parsing or filesystem
  // safety on the client side.
  const safeName = blitz.name.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() || 'Blitz';
  const filename = `${safeName}.ics`;

  return new NextResponse(icsBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}

/**
 * Compose a human-readable description from blitz fields. iCal clients
 * show DESCRIPTION below the title in event detail views — pack the
 * housing details and notes here so reps see them when they tap the
 * calendar entry. Multi-line description gets escaped to \n by the
 * iCal generator.
 */
function composeDescription(blitz: { notes: string; housing: string | null }): string {
  const parts: string[] = [];
  if (blitz.housing) parts.push(`Housing: ${blitz.housing}`);
  if (blitz.notes && blitz.notes.trim().length > 0) {
    parts.push('');
    parts.push(blitz.notes.trim());
  }
  return parts.join('\n');
}
