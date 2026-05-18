import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/db';
import { requireInternalUser } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { logChange } from '../../../../lib/audit';

// POST /api/push/unsubscribe — Phase 4. Client passes the endpoint it
// just unsubscribed from in the browser; the server deletes the matching
// row so we stop trying to send to a dead push subscription.

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, unsubscribeSchema);
  if (!parsed.ok) return parsed.response;
  const { endpoint } = parsed.data;

  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (!existing) return NextResponse.json({ ok: true, deleted: 0 });

  // Defense in depth: only the owning user (or admin) can delete a sub
  // by endpoint. Otherwise a malicious user who learned someone else's
  // endpoint could deregister their phone.
  if (existing.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.pushSubscription.delete({ where: { endpoint } });
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'push_subscription_delete',
    entityType: 'PushSubscription',
    entityId: existing.id,
    detail: { endpoint: endpoint.slice(0, 120) },
  });
  return NextResponse.json({ ok: true, deleted: 1 });
}
