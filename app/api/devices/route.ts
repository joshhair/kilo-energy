import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { logChange } from '../../../lib/audit';
import { logger } from '../../../lib/logger';

// POST /api/devices — register a native device push token (iOS APNs today).
// The native app calls this (Bearer-authenticated; CSRF-exempt via lib/csrf) after
// the user grants notification permission. We store it as an 'apns' PushSubscription
// so the existing notification fan-out + dead-token GC handle it with no new plumbing.
// Upsert by a namespaced endpoint so re-registering the same token is idempotent.

const deviceSchema = z.object({
  token: z.string().min(1).max(400),
  platform: z.literal('ios').optional().default('ios'),
});

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, deviceSchema);
  if (!parsed.ok) return parsed.response;
  const { token } = parsed.data;

  // endpoint is the PushSubscription @unique upsert key; namespace the APNs token
  // so it can never collide with a web_push endpoint (a URL). nativeToken holds the
  // raw token the APNs sender posts to /3/device/<token>.
  const endpoint = `apns:${token}`;
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, provider: 'apns', endpoint, nativeToken: token },
    update: { userId: user.id, nativeToken: token, lastSeenAt: new Date() },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'push_subscription_create',
    entityType: 'PushSubscription',
    entityId: sub.id,
    detail: { provider: 'apns', token: `…${token.slice(-6)}` },
  });
  logger.info('device_registered', { userId: user.id, subId: sub.id, provider: 'apns' });
  return NextResponse.json({ ok: true });
}
