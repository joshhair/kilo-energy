/**
 * Push channel adapter — Web Push (today) / APNs+FCM (post-app-store).
 *
 * STUBBED in Phase 2. Implementation lands in Phase 5 alongside the
 * service worker, VAPID key wiring, and the subscribe-on-permission
 * flow. Native push (APNs/FCM) waits until the iOS/Android apps ship
 * — see PushSubscription.provider for the discriminator.
 */

import type { Channel, DeliveryStatus } from '../types';

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
}

export interface ChannelSendResult {
  channel: Channel;
  ok: boolean;
  status: DeliveryStatus;
  providerMessageId?: string;
  errorReason?: string;
}

export async function sendPushChannel(_env: PushEnvelope): Promise<ChannelSendResult> {
  return {
    channel: 'push',
    ok: false,
    status: 'failed',
    errorReason: 'NOT_CONFIGURED: Push adapter ships in Phase 5 (Web Push) and Phase 6 (native).',
  };
}
