import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/db';
import { requireInternalUser } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { logChange } from '../../../../lib/audit';
import { logger } from '../../../../lib/logger';

// POST /api/push/subscribe — Phase 4. Client passes the Web Push
// subscription object after the user grants permission. Upsert by
// endpoint so re-registration is idempotent.

const subscribeSchema = z.object({
  endpoint: z.string().url('endpoint must be a valid URL'),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, subscribeSchema);
  if (!parsed.ok) return parsed.response;
  const { endpoint, keys, userAgent } = parsed.data;

  // Upsert by endpoint — re-subscribing the same browser is a no-op except
  // for lastSeenAt and (potentially) a user reassignment if a different
  // user signs in on the same device.
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: user.id,
      provider: 'web_push',
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    },
    update: {
      userId: user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
      lastSeenAt: new Date(),
    },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'push_subscription_create',
    entityType: 'PushSubscription',
    entityId: sub.id,
    detail: { endpoint: endpoint.slice(0, 120), userAgent: userAgent?.slice(0, 120) },
  });
  logger.info('push_subscription_upserted', { userId: user.id, subId: sub.id });
  return NextResponse.json({ ok: true });
}
