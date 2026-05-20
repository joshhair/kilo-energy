/**
 * SMS channel adapter — Twilio.
 *
 * Gated by SMS_ENABLED env flag. When unset/false, returns the same
 * NOT_CONFIGURED shape the original stub used so the dispatcher writes
 * a failed NotificationDelivery row without crashing the parent flow.
 *
 * When SMS_ENABLED=true, dispatches via Twilio Messages API using
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM. The env-flag gate
 * is the production safety net for the A2P 10DLC window: code is fully
 * wired but no SMS physically leaves the platform until ops registration
 * is complete.
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

type TwilioClientLike = {
  messages: {
    create: (opts: { to: string; from: string; body: string }) => Promise<{
      sid?: string;
      status?: string;
      errorCode?: number | null;
      errorMessage?: string | null;
    }>;
  };
};

let cachedClient: TwilioClientLike | null = null;

function getEnvConfig() {
  return {
    enabled: process.env.SMS_ENABLED === 'true',
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    from: process.env.TWILIO_FROM ?? '',
  };
}

function getTwilioClient(): TwilioClientLike {
  if (cachedClient) return cachedClient;
  const { accountSid, authToken } = getEnvConfig();
  // Dynamic require keeps the SDK out of cold-start paths that never SMS.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require('twilio') as (sid: string, token: string) => TwilioClientLike;
  cachedClient = twilio(accountSid, authToken);
  return cachedClient!;
}

/** Test hook: inject a mock client. Resets to lazy-load when called with null. */
export function __setTwilioClientForTests(client: TwilioClientLike | null) {
  cachedClient = client;
}

function mapStatus(twilioStatus: string | undefined): DeliveryStatus {
  // Twilio returns: queued, sending, sent, failed, delivered, undelivered, etc.
  // Our DeliveryStatus is smaller — collapse synonyms.
  switch (twilioStatus) {
    case 'delivered':
      return 'delivered';
    case 'sent':
    case 'sending':
    case 'queued':
    case 'accepted':
      return 'sent';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      return 'sent';
  }
}

export async function sendSmsChannel(env: SmsEnvelope): Promise<ChannelSendResult> {
  const cfg = getEnvConfig();
  if (!cfg.enabled) {
    return {
      channel: 'sms',
      ok: false,
      status: 'failed',
      errorReason: 'NOT_CONFIGURED: SMS_ENABLED is not true (A2P 10DLC gate).',
    };
  }
  if (!cfg.accountSid || !cfg.authToken || !cfg.from) {
    return {
      channel: 'sms',
      ok: false,
      status: 'failed',
      errorReason: 'NOT_CONFIGURED: missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM.',
    };
  }

  try {
    const client = getTwilioClient();
    const msg = await client.messages.create({
      to: env.to,
      from: cfg.from,
      body: env.body,
    });
    if (msg.errorCode) {
      return {
        channel: 'sms',
        ok: false,
        status: 'failed',
        providerMessageId: msg.sid,
        errorReason: `TWILIO_${msg.errorCode}: ${msg.errorMessage ?? 'unknown error'}`,
      };
    }
    return {
      channel: 'sms',
      ok: true,
      status: mapStatus(msg.status),
      providerMessageId: msg.sid,
    };
  } catch (err) {
    const e = err as { code?: number | string; message?: string };
    return {
      channel: 'sms',
      ok: false,
      status: 'failed',
      errorReason: `TWILIO_${e.code ?? 'ERR'}: ${e.message ?? String(err)}`,
    };
  }
}
