/**
 * Push channel adapter — Web Push today; APNs+FCM once native apps ship.
 *
 * Phase 4 implementation:
 *   - Uses `web-push` for VAPID-authenticated payload delivery.
 *   - VAPID keys are loaded from env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 *     VAPID_SUBJECT (mailto: or app URL). Missing keys → channel reports
 *     NOT_CONFIGURED rather than throwing.
 *   - 410/404 responses from the push service indicate a dead subscription;
 *     the caller (notifications service) is expected to upsert/delete the
 *     PushSubscription row based on errorReason='GONE'.
 *   - Native providers (apns/fcm) return UNSUPPORTED so the caller can
 *     gracefully skip them while still recording a delivery row.
 */

import type { Channel, DeliveryStatus } from '../types';
import { loadApns, sendApns } from './apns';

export interface PushEnvelope {
  /** Subscription endpoint (web_push) or platform token (apns/fcm). */
  endpoint: string;
  provider: 'web_push' | 'apns' | 'fcm';
  /** Web Push key material — optional for native providers. */
  p256dh?: string | null;
  auth?: string | null;
  /** Native push token for APNs/FCM. */
  nativeToken?: string | null;
  title: string;
  body: string;
  /** Optional deep-link URL the service worker uses on notification click. */
  url?: string;
  /** Optional structured payload for native push (APNs custom keys / FCM data),
   *  e.g. { type: 'pay_paid', date: 'YYYY-MM-DD' } for deep-linking. */
  data?: Record<string, string>;
}

export interface ChannelSendResult {
  channel: Channel;
  ok: boolean;
  status: DeliveryStatus;
  providerMessageId?: string;
  /** GONE | NOT_CONFIGURED | UNSUPPORTED | <provider error>. */
  errorReason?: string;
}

function loadVapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@kiloenergies.com';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export async function sendPushChannel(env: PushEnvelope): Promise<ChannelSendResult> {
  if (env.provider === 'apns') {
    const cfg = loadApns();
    if (!cfg) {
      return { channel: 'push', ok: false, status: 'failed', errorReason: 'NOT_CONFIGURED: APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID env not set.' };
    }
    if (!env.nativeToken) {
      return { channel: 'push', ok: false, status: 'failed', errorReason: 'INVALID_SUBSCRIPTION: missing APNs device token.' };
    }
    const r = await sendApns({ cfg, deviceToken: env.nativeToken, title: env.title, body: env.body, data: env.data, nowMs: Date.now() });
    // Use Apple's unique apns-id (NOT the status code — providerMessageId is @unique,
    // so a constant value would collide on the 2nd delivery). Absent → undefined → null.
    if (r.ok) return { channel: 'push', ok: true, status: 'sent', providerMessageId: r.apnsId };
    // 410/BadDeviceToken → 'GONE' so the service GC prunes the dead token (same as web-push 410).
    return { channel: 'push', ok: false, status: 'failed', errorReason: r.gone ? 'GONE' : (r.reason ?? 'APNS_ERROR') };
  }
  if (env.provider === 'fcm') {
    return {
      channel: 'push',
      ok: false,
      status: 'failed',
      errorReason: 'UNSUPPORTED: FCM (Android) ships with the Android app.',
    };
  }

  const vapid = loadVapid();
  if (!vapid) {
    return {
      channel: 'push',
      ok: false,
      status: 'failed',
      errorReason: 'NOT_CONFIGURED: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env not set.',
    };
  }

  if (!env.p256dh || !env.auth) {
    return {
      channel: 'push',
      ok: false,
      status: 'failed',
      errorReason: 'INVALID_SUBSCRIPTION: missing p256dh or auth keys.',
    };
  }

  // Lazy import so the build doesn't pull web-push into the client bundle.
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const payload = JSON.stringify({
    title: env.title,
    body: env.body,
    url: env.url,
  });

  try {
    const result = await webpush.sendNotification(
      {
        endpoint: env.endpoint,
        keys: { p256dh: env.p256dh, auth: env.auth },
      },
      payload,
      { TTL: 3600 },
    );
    return {
      channel: 'push',
      ok: true,
      status: 'sent',
      providerMessageId: String(result.statusCode),
    };
  } catch (err: unknown) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    const isGone = e?.statusCode === 404 || e?.statusCode === 410;
    return {
      channel: 'push',
      ok: false,
      status: 'failed',
      errorReason: isGone ? 'GONE' : `WEB_PUSH_ERROR: ${e?.statusCode ?? '?'} ${e?.body ?? e?.message ?? ''}`.slice(0, 240),
    };
  }
}
