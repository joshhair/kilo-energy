/**
 * POST /api/notifications/phone/confirm-verify
 *
 * Validates the 6-digit OTP against Twilio Verify. On approval, sets
 * notificationPhoneVerifiedAt = now() on the signed-in user. Rejects
 * if the supplied phone doesn't match the user's pending phone row
 * (defends against a stale form posting an old number after the user
 * changed the input).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../lib/db-gated';
import { requireInternalUser } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logChange } from '../../../../../lib/audit';
import { confirmPhoneCodeSchema } from '../../../../../lib/schemas/notification';
import { confirmPhoneVerification, isVerifyReady } from '../../../../../lib/notifications/twilio-verify';

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const limited = await enforceRateLimit(`phone-confirm-verify:${user.id}`, 10, 10 * 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, confirmPhoneCodeSchema);
  if (!parsed.ok) return parsed.response;
  const { phone, code } = parsed.data;

  const ready = isVerifyReady();
  if (!ready.ready) {
    return NextResponse.json(
      { error: `SMS verification is not yet enabled (${ready.reason})` },
      { status: 503 },
    );
  }

  const current = await db.user.findUnique({
    where: { id: user.id },
    select: { notificationPhone: true },
  });
  if (current?.notificationPhone !== phone) {
    return NextResponse.json(
      { error: 'Phone does not match the pending verification on file. Restart the flow.' },
      { status: 409 },
    );
  }

  const result = await confirmPhoneVerification(phone, code);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.errorReason ?? 'Twilio Verify check failed' },
      { status: 502 },
    );
  }
  if (!result.approved) {
    return NextResponse.json(
      { error: 'Code did not match. Try again or request a new one.', status: result.status },
      { status: 400 },
    );
  }

  const now = new Date();
  await db.user.update({
    where: { id: user.id },
    data: { notificationPhoneVerifiedAt: now },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'phone_verified',
    entityType: 'User',
    entityId: user.id,
    detail: { phone, verifiedAt: now.toISOString() },
  });

  return NextResponse.json({ ok: true, verified: true, verifiedAt: now.toISOString() });
}
