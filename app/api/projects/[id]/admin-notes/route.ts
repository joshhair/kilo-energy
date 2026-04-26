import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, userCanAccessProject, isVendorPM, isInternalPM } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

// Admin notes are internal-only: admin + internal PM can read/write;
// vendor PMs, reps, trainers, sub-dealers get 403. Belt-and-suspenders
// gate — the field-visibility matrix already scrubs the legacy
// adminNotes string to undefined for everyone except admin/pm.
//
// Internal PM = unscoped PM whose email is on the INTERNAL_PM_EMAILS
// allowlist. A previous version treated *any* unscoped PM as internal,
// which let a misconfigured vendor PM (no installer scope set) read +
// modify admin notes — closing that hole here.
function requireInternalAdminOrPM(user: { role: string; email: string; scopedInstallerId: string | null }) {
  if (user.role === 'admin') return null;
  if (isInternalPM(user)) return null;
  return NextResponse.json(
    { error: 'Forbidden — admin notes are internal-only' },
    { status: 403 },
  );
}

// GET /api/projects/[id]/admin-notes — list admin notes, newest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const forbidden = requireInternalAdminOrPM(user);
  if (forbidden) return forbidden;

  // Belt-and-suspenders — userCanAccessProject still runs (vendor PMs
  // are blocked above, but this covers any future role changes).
  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isVendorPM(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const notes = await prisma.projectAdminNote.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(notes);
}

// POST /api/projects/[id]/admin-notes — add a new admin note.
const createNoteSchema = z.object({
  text: z.string().trim().min(1).max(5000),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceRateLimit(`POST /api/projects/[id]/admin-notes:${user.id}`, 30, 60_000);
  if (limited) return limited;

  const forbidden = requireInternalAdminOrPM(user);
  if (forbidden) return forbidden;

  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isVendorPM(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = await parseJsonBody(req, createNoteSchema);
  if (!parsed.ok) return parsed.response;

  const note = await prisma.projectAdminNote.create({
    data: {
      projectId: id,
      authorId: user.id,
      authorName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      text: parsed.data.text,
    },
  });
  return NextResponse.json(note, { status: 201 });
}
