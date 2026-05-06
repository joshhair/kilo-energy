/**
 * Svix webhook signature verification.
 *
 * Resend (and other providers using Svix) signs webhook payloads with
 * HMAC-SHA256 over `${webhookId}.${webhookTimestamp}.${rawBody}` using
 * the secret's base64-decoded bytes. The header carries one or more
 * comma-prefixed signatures (for key rotation): `v1,<base64-sig>` items
 * separated by spaces.
 *
 * Implementation follows the Svix spec — interoperable with @svix/webhooks
 * but vendored to avoid pulling a runtime dep into a thin verification
 * path. Tested in tests/unit/svix-verify.test.ts.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_secret' | 'signature_mismatch' };

/** Tolerance for timestamp drift in seconds — 5 minutes matches Svix default. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function verifySvixSignature(
  rawBody: string,
  webhookId: string | null,
  webhookTimestamp: string | null,
  webhookSignature: string | null,
  secret: string,
): VerifyResult {
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { ok: false, reason: 'missing_headers' };
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const secretValue = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretValue, 'base64');
    if (secretBytes.length === 0) return { ok: false, reason: 'bad_secret' };
  } catch {
    return { ok: false, reason: 'bad_secret' };
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest();

  const entries = webhookSignature.split(' ');
  for (const entry of entries) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    let received: Buffer;
    try {
      received = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (received.length !== expected.length) continue;
    if (timingSafeEqual(received, expected)) return { ok: true };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

/**
 * Helper to compute a Svix signature — used by tests and (potentially)
 * by ourselves if we ever need to sign outbound webhooks. Mirrors the
 * algorithm above but in the signing direction.
 */
export function computeSvixSignature(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  secret: string,
): string {
  const secretValue = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(secretValue, 'base64');
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  return createHmac('sha256', secretBytes).update(signedContent).digest('base64');
}
