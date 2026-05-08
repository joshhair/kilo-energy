/**
 * Email channel adapter — wraps the existing sendEmail() in lib/email-helpers.
 *
 * The wrapper exists so the NotificationService talks a uniform shape
 * to every channel (`adapter.send(envelope)` returning a normalized
 * result), and so future changes to the email path (different provider,
 * additional headers, archiving rules) live in one place.
 */

import { sendEmail } from '../../email-helpers';
import type { Channel, DeliveryStatus } from '../types';

export interface EmailEnvelope {
  to: string;
  subject: string;
  html: string;
  /** Optional per-call BCC archive override. Default: lib/email-helpers
   *  injects EMAIL_ARCHIVE_BCC unless explicitly disabled. */
  bccArchive?: string | string[] | null;
}

export interface ChannelSendResult {
  channel: Channel;
  ok: boolean;
  status: DeliveryStatus;
  providerMessageId?: string;
  errorReason?: string;
}

export async function sendEmailChannel(env: EmailEnvelope): Promise<ChannelSendResult> {
  const result = await sendEmail({
    to: env.to,
    subject: env.subject,
    html: env.html,
    bccArchive: env.bccArchive,
  });

  if (result.ok) {
    return {
      channel: 'email',
      ok: true,
      status: 'sent',
      providerMessageId: result.providerMessageId,
    };
  }
  return {
    channel: 'email',
    ok: false,
    status: 'failed',
    errorReason: `${result.code}: ${result.error}`,
  };
}
