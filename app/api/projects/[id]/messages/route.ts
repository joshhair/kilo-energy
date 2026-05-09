import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { createProjectMessageSchema } from '../../../../../lib/schemas/business';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { notify } from '../../../../../lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '../../../../../lib/email-templates/notification';
import { logger, errorContext } from '../../../../../lib/logger';

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

  // Fire mention notifications. Async fire-and-forget — failures here
  // never bubble back to the chatter caller (the in-app mention badge
  // is the source of truth for unread state regardless of email).
  // Self-mentions are skipped: an author tagging themselves shouldn't
  // get an email.
  if (body.mentionUserIds && body.mentionUserIds.length > 0) {
    const project = await prisma.project.findUnique({
      where: { id },
      select: { customerName: true },
    });
    const authorName = `${user.firstName} ${user.lastName}`;
    const projectUrl = `${process.env.APP_URL || 'https://app.kiloenergies.com'}/dashboard/projects/${id}`;
    const snippet = body.text.length > 240 ? body.text.slice(0, 240) + '…' : body.text;
    const customerName = project?.customerName ?? 'a project';

    // Don't await the fan-out — chatter UX shouldn't wait on N email sends.
    Promise.all(
      body.mentionUserIds
        .filter((uid) => uid !== user.id)
        .map((uid) =>
          notify({
            type: 'mention',
            userId: uid,
            projectId: id,
            subject: `${authorName} mentioned you on ${customerName}`,
            emailHtml: renderNotificationEmail({
              heading: `${escapeHtml(authorName)} mentioned you`,
              bodyHtml: `
                <p style="margin:0 0 12px 0;">on the <strong>${escapeHtml(customerName)}</strong> deal:</p>
                <blockquote style="margin:0;padding:12px 16px;border-left:3px solid #1de9b6;background:#f5f7fb;color:#0f1322;border-radius:0 6px 6px 0;font-size:14px;">
                  ${escapeHtml(snippet)}
                </blockquote>
              `,
              cta: { label: 'Open deal in Kilo', url: projectUrl },
              footerNote: 'Sent because you have @-mentions turned on. Manage at /dashboard/preferences.',
            }),
            smsBody: `Kilo: ${authorName} mentioned you on ${customerName}. ${projectUrl}`,
            pushBody: `${authorName}: ${snippet}`,
          }),
        ),
    ).catch((err) => {
      logger.error('mention_notification_fanout_failed', {
        projectId: id,
        mentionCount: body.mentionUserIds!.length,
        ...errorContext(err),
      });
    });
  }

  return NextResponse.json(message);
}
