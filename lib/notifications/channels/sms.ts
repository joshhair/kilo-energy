/**
 * SMS channel adapter — Twilio.
 *
 * STUBBED in Phase 2. Implementation lands in Phase 4 alongside Twilio
 * provisioning + A2P 10DLC ops registration.
 *
 * Until then, calls return ok:false with status:'failed' and a clear
 * error so callers (the NotificationService) can record the attempt
 * in NotificationDelivery without crashing the parent flow. UI can
 * surface "SMS not configured yet" without runtime errors.
 */

import type { Channel, DeliveryStatus } from '../types';

export interface SmsEnvelope {
  to: string; // E.164
  body: string;
}

export interface ChannelSendResult {
  channel: Channel;
  ok: boolean;
  status: DeliveryStatus;
  providerMessageId?: string;
  errorReason?: string;
}

export async function sendSmsChannel(_env: SmsEnvelope): Promise<ChannelSendResult> {
  return {
    channel: 'sms',
    ok: false,
    status: 'failed',
    errorReason: 'NOT_CONFIGURED: SMS adapter ships in Phase 4 (Twilio).',
  };
}
