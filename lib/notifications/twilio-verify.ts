/**
 * Twilio Verify wrapper used by /api/notifications/phone/start-verify
 * and /confirm-verify. Verify owns OTP generation + expiry + replay
 * protection — rolling our own would duplicate (and almost certainly
 * regress) production-hardened code that Twilio already runs.
 *
 * Gated by the same SMS_ENABLED env flag as the message channel, so
 * nothing leaves the platform until A2P 10DLC is approved.
 */

type VerifyClientLike = {
  verify: {
    v2: {
      services: (sid: string) => {
        verifications: { create: (opts: { to: string; channel: 'sms' }) => Promise<{ sid: string; status: string }> };
        verificationChecks: { create: (opts: { to: string; code: string }) => Promise<{ status: string }> };
      };
    };
  };
};

let cachedClient: VerifyClientLike | null = null;

export interface VerifyConfig {
  enabled: boolean;
  serviceSid: string;
  accountSid: string;
  authToken: string;
}

export function getVerifyConfig(): VerifyConfig {
  return {
    enabled: process.env.SMS_ENABLED === 'true',
    serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? '',
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  };
}

export function isVerifyReady(cfg: VerifyConfig = getVerifyConfig()): { ready: true } | { ready: false; reason: string } {
  if (!cfg.enabled) return { ready: false, reason: 'SMS_ENABLED is not true' };
  if (!cfg.accountSid || !cfg.authToken) return { ready: false, reason: 'TWILIO_ACCOUNT_SID / AUTH_TOKEN missing' };
  if (!cfg.serviceSid) return { ready: false, reason: 'TWILIO_VERIFY_SERVICE_SID missing' };
  return { ready: true };
}

function getClient(): VerifyClientLike {
  if (cachedClient) return cachedClient;
  const cfg = getVerifyConfig();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require('twilio') as (sid: string, token: string) => VerifyClientLike;
  cachedClient = twilio(cfg.accountSid, cfg.authToken);
  return cachedClient!;
}

export function __setVerifyClientForTests(client: VerifyClientLike | null) {
  cachedClient = client;
}

export interface StartVerifyResult {
  ok: boolean;
  status?: string;
  errorReason?: string;
}

export async function startPhoneVerification(phoneE164: string): Promise<StartVerifyResult> {
  const cfg = getVerifyConfig();
  const ready = isVerifyReady(cfg);
  if (!ready.ready) return { ok: false, errorReason: `NOT_CONFIGURED: ${ready.reason}` };

  try {
    const res = await getClient()
      .verify.v2.services(cfg.serviceSid)
      .verifications.create({ to: phoneE164, channel: 'sms' });
    return { ok: true, status: res.status };
  } catch (err) {
    const e = err as { code?: number | string; message?: string };
    return { ok: false, errorReason: `TWILIO_${e.code ?? 'ERR'}: ${e.message ?? String(err)}` };
  }
}

export interface ConfirmVerifyResult {
  ok: boolean;
  approved: boolean;
  status?: string;
  errorReason?: string;
}

export async function confirmPhoneVerification(phoneE164: string, code: string): Promise<ConfirmVerifyResult> {
  const cfg = getVerifyConfig();
  const ready = isVerifyReady(cfg);
  if (!ready.ready) return { ok: false, approved: false, errorReason: `NOT_CONFIGURED: ${ready.reason}` };

  try {
    const res = await getClient()
      .verify.v2.services(cfg.serviceSid)
      .verificationChecks.create({ to: phoneE164, code });
    return { ok: true, approved: res.status === 'approved', status: res.status };
  } catch (err) {
    const e = err as { code?: number | string; message?: string };
    return { ok: false, approved: false, errorReason: `TWILIO_${e.code ?? 'ERR'}: ${e.message ?? String(err)}` };
  }
}
