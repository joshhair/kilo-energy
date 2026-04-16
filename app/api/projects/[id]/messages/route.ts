import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { createProjectMessageSchema } from '../../../../../lib/schemas/business';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

// GET /api/projects/[id]/messages — List messages for a project (paginated).
// Access: admin, PM, or a rep/sub-dealer who is on the deal.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }

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

// POST /api/projects/[id]/messages — Create a new message.
// Access: same as GET. Author is forced to the current user to prevent spoofing.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }

  // Chatter is per-user-per-project — 120/min is a generous upper bound
  // for an engaged human reviewer; stops paste-loops and bot spam.
  const limited = await enforceRateLimit(`POST /api/projects/[id]/messages:${user.id}`, 120, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, createProjectMessageSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const message = await prisma.projectMessage.create({
    data: {
      projectId: id,
      // Force author fields from the session — never trust client-supplied values.
      authorId: user.id,
      authorName: `${user.firstName} ${user.lastName}`,
      authorRole: user.role,
      text: body.text,
      checkItems: body.checkItems?.length
        ? { create: body.checkItems.map((ci) => ({
            text: typeof ci === 'string' ? ci : ci.text,
            dueDate: (typeof ci === 'object' && ci.dueDate) ? new Date(ci.dueDate) : null,
          })) }
        : undefined,
      mentions: body.mentionUserIds?.length
        ? { create: body.mentionUserIds.map((userId) => ({ userId })) }
        : undefined,
    },
    include: { checkItems: true, mentions: true },
  });

  return NextResponse.json(message);
}
