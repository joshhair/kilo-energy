/**
 * POST /api/notifications/phone/start-verify
 *
 * Sends a 6-digit OTP via Twilio Verify to the supplied phone number,
 * writes notificationPhone (verifiedAt=null) on the signed-in user, and
 * returns { ok, sent: true }. Returns 503 NOT_CONFIGURED until Phase D
 * env (SMS_ENABLED=true + TWILIO_VERIFY_SERVICE_SID) is set.
 *
 * Self-only: the route always writes the column on the calling user. No
 * userId path param. Rate-limited 5 / 10 min per user to soak up the
 * cost of an attacker spraying numbers through our Twilio account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../lib/db-gated';
import { requireInternalUser } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logChange } from '../../../../../lib/audit';
import { requestPhoneCodeSchema } from '../../../../../lib/schemas/notification';
import { startPhoneVerification, isVerifyReady } from '../../../../../lib/notifications/twilio-verify';

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const limited = await enforceRateLimit(`phone-start-verify:${user.id}`, 5, 10 * 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, requestPhoneCodeSchema);
  if (!parsed.ok) return parsed.response;
  const { phone } = parsed.data;

  const ready = isVerifyReady();
  if (!ready.ready) {
    return NextResponse.json(
      { error: `SMS verification is not yet enabled (${ready.reason})` },
      { status: 503 },
    );
  }

  // Call Twilio FIRST, write the column only on success. The opposite
  // order would silently wipe a working verified phone if Twilio errors
  // (network blip, bad serviceSid, rate-limit): the user re-verifies a
  // new number, Twilio fails, and now their previously-working phone is
  // gone from the row with no signal to them.
  const result = await startPhoneVerification(phone);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.errorReason ?? 'Twilio Verify call failed' },
      { status: 502 },
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: { notificationPhone: phone, notificationPhoneVerifiedAt: null },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'phone_verify_started',
    entityType: 'User',
    entityId: user.id,
    detail: { phone, twilioStatus: result.status },
  });

  return NextResponse.json({ ok: true, sent: true, phone });
}
