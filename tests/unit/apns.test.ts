// APNs channel — env gating + the ES256 provider JWT. The real HTTP/2 send to
// Apple needs the .p8 credential + a real device, so we test everything up to the
// wire: loadApns gating, the JWT (signed with a generated P-256 key, verified
// back), and the push-channel dispatch for provider:'apns'.

import { describe, it, expect, afterEach } from 'vitest';
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { loadApns, buildProviderJwt } from '@/lib/notifications/channels/apns';
import { sendPushChannel } from '@/lib/notifications/channels/push';

const APNS_ENV = ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_HOST'] as const;
function clearApnsEnv() { for (const k of APNS_ENV) delete process.env[k]; }
function setApnsEnv(p8 = 'x') { process.env.APNS_KEY_P8 = p8; process.env.APNS_KEY_ID = 'k'; process.env.APNS_TEAM_ID = 't'; process.env.APNS_BUNDLE_ID = 'com.kilo.app'; }
afterEach(clearApnsEnv);

describe('loadApns', () => {
  it('returns null unless all four APNS_* vars are set', () => {
    clearApnsEnv();
    expect(loadApns()).toBeNull();
    process.env.APNS_KEY_P8 = 'x'; process.env.APNS_KEY_ID = 'k';
    expect(loadApns()).toBeNull(); // team + bundle still missing
    process.env.APNS_TEAM_ID = 't'; process.env.APNS_BUNDLE_ID = 'com.kilo.app';
    const cfg = loadApns();
    expect(cfg).not.toBeNull();
    expect(cfg!.keyId).toBe('k');
    expect(cfg!.bundleId).toBe('com.kilo.app');
  });

  it('normalizes escaped \\n in the .p8 to real newlines', () => {
    setApnsEnv('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----');
    expect(loadApns()!.p8).toBe('-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----');
  });
});

describe('buildProviderJwt', () => {
  it('signs an ES256 JWT with kid + iss + iat that verifies against the public key', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const p8 = await exportPKCS8(privateKey);
    const jwt = await buildProviderJwt({ p8, keyId: 'KEY123', teamId: 'TEAM456', bundleId: 'com.kilo.app', host: 'h' }, 1700000000);
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey);
    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.kid).toBe('KEY123');
    expect(payload.iss).toBe('TEAM456');
    expect(payload.iat).toBe(1700000000);
  });
});

describe('sendPushChannel — apns dispatch', () => {
  it('NOT_CONFIGURED when APNS env is unset (no-op until creds land)', async () => {
    clearApnsEnv();
    const r = await sendPushChannel({ endpoint: 'apns:tok', provider: 'apns', nativeToken: 'tok', title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.errorReason).toContain('NOT_CONFIGURED');
  });

  it('INVALID_SUBSCRIPTION when configured but the device token is missing', async () => {
    setApnsEnv();
    const r = await sendPushChannel({ endpoint: 'apns:', provider: 'apns', nativeToken: null, title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.errorReason).toContain('INVALID_SUBSCRIPTION');
  });

  it('fcm stays UNSUPPORTED', async () => {
    const r = await sendPushChannel({ endpoint: 'x', provider: 'fcm', nativeToken: 'tok', title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.errorReason).toContain('UNSUPPORTED');
  });
});
