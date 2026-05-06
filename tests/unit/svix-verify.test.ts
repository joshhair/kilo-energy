import { describe, it, expect } from 'vitest';
import { verifySvixSignature, computeSvixSignature } from '@/lib/svix-verify';

/**
 * Tests for the Svix-protocol signature verifier used by the Resend
 * webhook receiver. The original implementation incorrectly signed
 * just the raw body (instead of `${id}.${timestamp}.${body}`) and
 * skipped the secret's base64 decode, causing every Resend webhook
 * to fail signature check and our EmailDelivery rows to never move
 * past `sent` to `delivered`. These tests lock in the corrected
 * behavior.
 */

// Generate a valid whsec_-prefixed secret (base64-encoded random bytes).
const SECRET = 'whsec_' + Buffer.from('test-secret-32-bytes-of-entropy!').toString('base64');

const sampleBody = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-05-06T01:00:00Z',
  data: { email_id: 'msg_abc123' },
});

function nowSeconds(offsetSeconds = 0): string {
  return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}

describe('verifySvixSignature', () => {
  it('accepts a valid Svix signature', () => {
    const id = 'msg_test_001';
    const ts = nowSeconds();
    const sig = 'v1,' + computeSvixSignature(sampleBody, id, ts, SECRET);
    expect(verifySvixSignature(sampleBody, id, ts, sig, SECRET)).toEqual({ ok: true });
  });

  it('rejects when any required header is missing', () => {
    expect(verifySvixSignature(sampleBody, null, '1', 'v1,sig', SECRET)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifySvixSignature(sampleBody, 'id', null, 'v1,sig', SECRET)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifySvixSignature(sampleBody, 'id', '1', null, SECRET)).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('rejects timestamp older than 5 minutes (replay protection)', () => {
    const id = 'msg_test_002';
    const ts = nowSeconds(-301); // 5min 1sec ago
    const sig = 'v1,' + computeSvixSignature(sampleBody, id, ts, SECRET);
    expect(verifySvixSignature(sampleBody, id, ts, sig, SECRET)).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects timestamp far in the future (replay protection)', () => {
    const id = 'msg_test_003';
    const ts = nowSeconds(301); // 5min 1sec ahead
    const sig = 'v1,' + computeSvixSignature(sampleBody, id, ts, SECRET);
    expect(verifySvixSignature(sampleBody, id, ts, sig, SECRET)).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects signature computed with wrong secret', () => {
    const id = 'msg_test_004';
    const ts = nowSeconds();
    const wrongSecret = 'whsec_' + Buffer.from('wrong-secret-bytes-of-entropy!').toString('base64');
    const sig = 'v1,' + computeSvixSignature(sampleBody, id, ts, wrongSecret);
    expect(verifySvixSignature(sampleBody, id, ts, sig, SECRET)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects signature computed over wrong body', () => {
    const id = 'msg_test_005';
    const ts = nowSeconds();
    const sig = 'v1,' + computeSvixSignature('{"different":"payload"}', id, ts, SECRET);
    expect(verifySvixSignature(sampleBody, id, ts, sig, SECRET)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects when raw body and signed body diverge (e.g. tampering)', () => {
    const id = 'msg_test_006';
    const ts = nowSeconds();
    const sig = 'v1,' + computeSvixSignature(sampleBody, id, ts, SECRET);
    const tampered = sampleBody.replace('email.delivered', 'email.bounced');
    expect(verifySvixSignature(tampered, id, ts, sig, SECRET)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('accepts signature header with multiple v1 entries (key rotation)', () => {
    const id = 'msg_test_007';
    const ts = nowSeconds();
    const validSig = computeSvixSignature(sampleBody, id, ts, SECRET);
    const header = 'v1,fakeOldKey== v1,' + validSig;
    expect(verifySvixSignature(sampleBody, id, ts, header, SECRET)).toEqual({ ok: true });
  });

  it('ignores entries with versions other than v1', () => {
    const id = 'msg_test_008';
    const ts = nowSeconds();
    const validSig = computeSvixSignature(sampleBody, id, ts, SECRET);
    const header = 'v0,unsupported v1,' + validSig + ' v2,future';
    expect(verifySvixSignature(sampleBody, id, ts, header, SECRET)).toEqual({ ok: true });
  });

  it('rejects malformed signature header (no v-prefix)', () => {
    const id = 'msg_test_009';
    const ts = nowSeconds();
    const validSig = computeSvixSignature(sampleBody, id, ts, SECRET);
    expect(verifySvixSignature(sampleBody, id, ts, validSig, SECRET)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects empty secret', () => {
    const id = 'msg_test_010';
    const ts = nowSeconds();
    const sig = 'v1,abc';
    expect(verifySvixSignature(sampleBody, id, ts, sig, 'whsec_')).toEqual({ ok: false, reason: 'bad_secret' });
  });

  it('rejects non-numeric timestamp', () => {
    const id = 'msg_test_011';
    const sig = 'v1,abc';
    expect(verifySvixSignature(sampleBody, id, 'not-a-number', sig, SECRET)).toEqual({ ok: false, reason: 'stale_timestamp' });
  });
});
