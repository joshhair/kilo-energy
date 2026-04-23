import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, userCanAccessProject } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

// GET /api/projects/[id]/notes — list notes for a project, newest first.
// Requires project access (admin/PM always; rep/SD only if on the deal;
// vendor PM only if the project's installerId matches their scope).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const notes = await prisma.projectNote.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(notes);
}

// POST /api/projects/[id]/notes — add a new note.
const createNoteSchema = z.object({
  text: z.string().trim().min(1).max(5000),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  // Loose rate limit — typing a note takes seconds, nobody legit exceeds this.
  const limited = await enforceRateLimit(`POST /api/projects/[id]/notes:${user.id}`, 30, 60_000);
  if (limited) return limited;

  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = await parseJsonBody(req, createNoteSchema);
  if (!parsed.ok) return parsed.response;

  const note = await prisma.projectNote.create({
    data: {
      projectId: id,
      authorId: user.id,
      authorName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      text: parsed.data.text,
    },
  });
  return NextResponse.json(note, { status: 201 });
}
