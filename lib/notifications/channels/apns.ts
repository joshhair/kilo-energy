/**
 * APNs (Apple Push Notification service) sender for native iOS push.
 *
 * Env-gated: returns null from loadApns() unless ALL of APNS_KEY_P8 /
 * APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID are set, so the push channel
 * reports NOT_CONFIGURED and no-ops cleanly until credentials land.
 *
 * Auth is an ES256 provider JWT signed with the .p8 key (header { alg:'ES256',
 * kid: keyId }, claims { iss: teamId, iat }). Apple rate-limits new tokens and
 * accepts one for 20-60 min, so we cache it ~50 min. Delivery is HTTP/2 to
 * api.push.apple.com — no third-party APNs library, just jose + node:http2.
 *
 * 410 Unregistered / 400 BadDeviceToken → the token is dead; we surface gone=true
 * so the caller prunes the PushSubscription row (same GC web-push uses for 410).
 */
import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';

export interface ApnsConfig {
  p8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

/** Read APNs config from env, or null if not fully configured (channel no-ops). */
export function loadApns(): ApnsConfig | null {
  const p8 = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!p8 || !keyId || !teamId || !bundleId) return null;
  // A .p8 stored in an env var often has its newlines escaped as literal "\n".
  const normalizedP8 = p8.includes('\\n') ? p8.replace(/\\n/g, '\n') : p8;
  // Sandbox (api.sandbox.push.apple.com) for dev/TestFlight builds via env.
  // Accept a bare host and normalize to a URL so http2.connect() can't throw
  // ERR_INVALID_URL synchronously outside the channel result path.
  const rawHost = process.env.APNS_HOST || 'https://api.push.apple.com';
  const host = /^https?:\/\//.test(rawHost) ? rawHost : `https://${rawHost}`;
  return { p8: normalizedP8, keyId, teamId, bundleId, host };
}

/** Build + sign the ES256 provider JWT. Pure (no cache/IO) so it's unit-testable. */
export async function buildProviderJwt(cfg: ApnsConfig, iatSeconds: number): Promise<string> {
  const key = await importPKCS8(cfg.p8, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt(iatSeconds)
    .sign(key);
}

// Provider-JWT cache — reuse for ~50 min (Apple rejects too-frequent minting).
let cachedJwt: { token: string; mintedAtMs: number; keyId: string } | null = null;
const JWT_TTL_MS = 50 * 60 * 1000;

async function getProviderJwt(cfg: ApnsConfig, nowMs: number): Promise<string> {
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && nowMs - cachedJwt.mintedAtMs < JWT_TTL_MS) {
    return cachedJwt.token;
  }
  const token = await buildProviderJwt(cfg, Math.floor(nowMs / 1000));
  cachedJwt = { token, mintedAtMs: nowMs, keyId: cfg.keyId };
  return token;
}

/** Test-only: clear the module-level provider-JWT cache. */
export function __resetApnsJwtCache(): void {
  cachedJwt = null;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  reason?: string;
  /** Token is dead (410/BadDeviceToken) — caller should prune it. */
  gone?: boolean;
  /** Apple's per-push UUID (the `apns-id` response header) — a UNIQUE provider
   *  message id (NotificationDelivery.providerMessageId is @unique). */
  apnsId?: string;
}

/**
 * Send one APNs alert push to a device token over HTTP/2. data becomes APNs
 * top-level custom keys (e.g. { type:'pay_paid', date:'YYYY-MM-DD' }) for
 * deep-linking. nowMs is injectable for tests.
 */
export async function sendApns(opts: {
  cfg: ApnsConfig;
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  nowMs: number;
}): Promise<ApnsResult> {
  const { cfg, deviceToken, title, body, data, nowMs } = opts;
  let jwt: string;
  try {
    jwt = await getProviderJwt(cfg, nowMs);
  } catch (e) {
    return { ok: false, status: 0, reason: `APNS_JWT: ${String((e as Error).message).slice(0, 120)}` };
  }
  const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...(data ?? {}) });

  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    let client: http2.ClientHttp2Session | null = null;
    // Forcefully tear down — close() WAITS for active streams, so a hung stream on
    // the timeout path would leak the session. destroy() cancels immediately; it's
    // also fine after a completed response (one-shot connection per send).
    const finish = (r: ApnsResult) => {
      if (settled) return;
      settled = true;
      try { client?.destroy(); } catch { /* already destroyed */ }
      resolve(r);
    };
    try {
      client = http2.connect(cfg.host);
      client.on('error', (e) => finish({ ok: false, status: 0, reason: `APNS_CONN: ${String((e as Error).message).slice(0, 120)}` }));

      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0;
      let apnsId: string | undefined;
      let respBody = '';
      req.on('response', (h) => {
        status = Number(h[':status'] ?? 0);
        apnsId = typeof h['apns-id'] === 'string' ? h['apns-id'] : undefined;
      });
      req.setEncoding('utf8');
      req.on('data', (c) => { respBody += c; });
      req.on('end', () => {
        if (status === 200) return finish({ ok: true, status, apnsId });
        const gone = status === 410 || (status === 400 && respBody.includes('BadDeviceToken'));
        finish({ ok: false, status, reason: `APNS_${status}: ${respBody.slice(0, 120)}`, gone });
      });
      req.on('error', (e) => finish({ ok: false, status: 0, reason: `APNS_REQ: ${String((e as Error).message).slice(0, 120)}` }));
      req.setTimeout(8000, () => finish({ ok: false, status: 0, reason: 'APNS_TIMEOUT' }));
      req.end(payload);
    } catch (e) {
      // Synchronous throw from connect()/request() (e.g. a bad host) → clean failure.
      finish({ ok: false, status: 0, reason: `APNS_SETUP: ${String((e as Error).message).slice(0, 120)}` });
    }
  });
}
