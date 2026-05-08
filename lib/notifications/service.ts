/**
 * NotificationService facade — `notify(input)` is the single entry point
 * every event-firing site uses. The service:
 *
 *   1. Looks up the user's preferences for the event type (or falls back
 *      to the registry default).
 *   2. Honors mandatory events (security, chargebacks) — overrides opt-out.
 *   3. Resolves the recipient address per channel (User.email,
 *      User.notificationPhone, PushSubscription.endpoint).
 *   4. Calls each enabled channel adapter.
 *   5. Persists one NotificationDelivery row per channel attempt.
 *   6. Returns an aggregate result so the caller can log + react.
 *
 * Designed never to throw — channel failures become NotificationDelivery
 * rows with status='failed' and an errorReason. The parent business flow
 * (e.g. payroll PATCH) is unaffected by notification trouble.
 *
 * Privacy gate: the service uses the un-gated `prisma` client because
 * notifications fan out across user boundaries (a phase change might
 * notify the closer, setter, AND trainer). The User and Project rows
 * looked up here are intentionally outside the request-scoped privacy
 * gate — that's the same architectural decision EmailDelivery already
 * makes (see lib/db-gated.ts allowlist).
 */

import { prisma } from '../db';
import { logger, errorContext } from '../logger';
import { getEventDefinition } from './events';
import { sendEmailChannel } from './channels/email';
import { sendSmsChannel } from './channels/sms';
import { sendPushChannel } from './channels/push';
import type {
  Channel,
  ChannelResult,
  DeliveryStatus,
  NotifyInput,
  NotifyResult,
} from './types';

/**
 * Resolved per-channel "should I send" decision after preference + mandatory
 * + audience checks.
 */
interface ChannelDecision {
  channel: Channel;
  enabled: boolean;
  reason?: string; // Why disabled, when applicable
}

/**
 * Look up the user's effective preferences for an event type, or null
 * if the user is not eligible for this event (audience mismatch).
 */
async function resolveDecisions(
  userId: string | null,
  eventType: string,
): Promise<{
  decisions: ChannelDecision[];
  digestMode: 'instant' | 'daily_digest' | 'weekly_digest' | 'off';
  mandatory: boolean;
}> {
  const def = getEventDefinition(eventType);
  if (!def) {
    return {
      decisions: [{ channel: 'email', enabled: false, reason: 'Unknown event type' }],
      digestMode: 'off',
      mandatory: false,
    };
  }

  const mandatory = def.mandatory === true;

  // System-only events (userId=null) don't have preference rows; use defaults.
  if (!userId) {
    return {
      decisions: [
        { channel: 'email', enabled: def.defaults.email },
        { channel: 'sms', enabled: def.defaults.sms },
        { channel: 'push', enabled: def.defaults.push },
      ],
      digestMode: def.defaults.digestMode,
      mandatory,
    };
  }

  // Pull the user's pref row (if any) + their audience-relevant fields.
  const [pref, user] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { userId_eventType: { userId, eventType } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true },
    }),
  ]);

  if (!user || !user.active) {
    return {
      decisions: [{ channel: 'email', enabled: false, reason: 'User inactive or missing' }],
      digestMode: 'off',
      mandatory,
    };
  }

  // Audience gate: if the event registry restricts roles and this user's
  // role isn't in the list, never send.
  if (def.audience && !def.audience.includes(user.role as never)) {
    return {
      decisions: [{ channel: 'email', enabled: false, reason: 'Role not in event audience' }],
      digestMode: 'off',
      mandatory,
    };
  }

  // No preference row → use the event's defaults.
  const emailEnabled = pref?.emailEnabled ?? def.defaults.email;
  const smsEnabled = pref?.smsEnabled ?? def.defaults.sms;
  const pushEnabled = pref?.pushEnabled ?? def.defaults.push;
  const digestMode = (pref?.digestMode ?? def.defaults.digestMode) as
    | 'instant' | 'daily_digest' | 'weekly_digest' | 'off';

  // 'off' is a kill switch — overrides individual toggles. Mandatory wins
  // back, force-emailing the user even when set to off.
  if (digestMode === 'off' && !mandatory) {
    return {
      decisions: [{ channel: 'email', enabled: false, reason: 'digestMode=off' }],
      digestMode: 'off',
      mandatory,
    };
  }

  return {
    decisions: [
      { channel: 'email', enabled: mandatory ? true : emailEnabled },
      { channel: 'sms', enabled: mandatory ? smsEnabled : smsEnabled },
      { channel: 'push', enabled: mandatory ? pushEnabled : pushEnabled },
    ],
    digestMode,
    mandatory,
  };
}

/**
 * Resolve the address to deliver to for a single channel. Returns null
 * if the user has no usable address for that channel (e.g. phone not
 * verified for SMS).
 */
async function resolveAddress(
  channel: Channel,
  userId: string | null,
  toAddressOverride?: string,
): Promise<string | null> {
  if (toAddressOverride) return toAddressOverride;
  if (!userId) return null;

  if (channel === 'email') {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return u?.email ?? null;
  }
  if (channel === 'sms') {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPhone: true, notificationPhoneVerifiedAt: true },
    });
    if (!u?.notificationPhone || !u.notificationPhoneVerifiedAt) return null;
    return u.notificationPhone;
  }
  if (channel === 'push') {
    // Push fan-out: a user can have multiple devices. Caller layer handles
    // the per-subscription loop — this helper just confirms ≥1 exists.
    const sub = await prisma.pushSubscription.findFirst({
      where: { userId },
      select: { endpoint: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sub?.endpoint ?? null;
  }
  return null;
}

async function persistDelivery(args: {
  userId: string | null;
  eventType: string;
  channel: Channel;
  toAddress: string;
  status: DeliveryStatus;
  providerMessageId?: string;
  errorReason?: string;
  payloadJson?: string;
  projectId?: string;
}): Promise<string> {
  const row = await prisma.notificationDelivery.create({
    data: {
      userId: args.userId ?? null,
      eventType: args.eventType,
      channel: args.channel,
      toAddress: args.toAddress,
      status: args.status,
      providerMessageId: args.providerMessageId,
      errorReason: args.errorReason,
      payloadJson: args.payloadJson,
      projectId: args.projectId,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Top-level notify() entry point. Never throws — failures are logged and
 * surfaced via the returned NotifyResult.
 *
 * Today's behavior: only 'instant' digestMode actually fires. 'daily_digest'
 * + 'weekly_digest' are recorded as decisions but don't yet aggregate
 * (the digest aggregator cron lands when the second event type adopts a
 * digest mode — until then, the data captured here lets us build that
 * cron without re-instrumenting call sites).
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    const { decisions, digestMode, mandatory } = await resolveDecisions(input.userId, input.type);
    const force = (input.forceMandatory && mandatory) === true;

    // Non-instant digest modes: record an in_app row only and defer the
    // physical send to the (future) digest aggregator cron. This keeps
    // the data shape consistent so the cron has something to read.
    if (digestMode !== 'instant' && !force) {
      const addr = await resolveAddress('email', input.userId, input.toAddressOverride);
      if (!addr) {
        return { ok: true, attempts: [], skipped: true, skipReason: `digestMode=${digestMode} (deferred, no email on file)` };
      }
      const deliveryId = await persistDelivery({
        userId: input.userId,
        eventType: input.type,
        channel: 'in_app',
        toAddress: addr,
        status: 'queued',
        payloadJson: input.emailHtml ? JSON.stringify({ subject: input.subject, html: input.emailHtml }) : undefined,
        projectId: input.projectId,
      });
      return {
        ok: true,
        attempts: [{ channel: 'in_app', ok: true, deliveryId }],
        skipped: false,
      };
    }

    const attempts: ChannelResult[] = [];
    let allOk = true;
    let anyTried = false;

    for (const d of decisions) {
      if (!d.enabled) continue;
      anyTried = true;

      const addr = await resolveAddress(d.channel, input.userId, input.toAddressOverride);
      if (!addr) {
        const deliveryId = await persistDelivery({
          userId: input.userId,
          eventType: input.type,
          channel: d.channel,
          toAddress: '',
          status: 'failed',
          errorReason: 'No usable address for this channel',
          projectId: input.projectId,
        });
        attempts.push({ channel: d.channel, ok: false, deliveryId, error: 'No usable address' });
        allOk = false;
        continue;
      }

      // Channel dispatch.
      let result;
      if (d.channel === 'email') {
        if (!input.emailHtml) {
          attempts.push({ channel: 'email', ok: false, error: 'No emailHtml provided' });
          allOk = false;
          continue;
        }
        result = await sendEmailChannel({ to: addr, subject: input.subject, html: input.emailHtml });
      } else if (d.channel === 'sms') {
        if (!input.smsBody) {
          attempts.push({ channel: 'sms', ok: false, error: 'No smsBody provided' });
          allOk = false;
          continue;
        }
        result = await sendSmsChannel({ to: addr, body: input.smsBody });
      } else {
        // push
        if (!input.pushBody) {
          attempts.push({ channel: 'push', ok: false, error: 'No pushBody provided' });
          allOk = false;
          continue;
        }
        // Phase 2 stub — Phase 5 will look up the actual subscription record.
        result = await sendPushChannel({
          endpoint: addr,
          provider: 'web_push',
          title: input.subject,
          body: input.pushBody,
        });
      }

      const deliveryId = await persistDelivery({
        userId: input.userId,
        eventType: input.type,
        channel: d.channel,
        toAddress: addr,
        status: result.status,
        providerMessageId: result.providerMessageId,
        errorReason: result.errorReason,
        projectId: input.projectId,
      });
      attempts.push({ channel: d.channel, ok: result.ok, deliveryId, error: result.errorReason });
      if (!result.ok) allOk = false;
    }

    if (!anyTried) {
      return { ok: true, attempts, skipped: true, skipReason: 'All channels disabled or unsupported' };
    }
    return { ok: allOk, attempts };
  } catch (err) {
    logger.error('notification_service_unexpected_error', {
      eventType: input.type,
      userId: input.userId,
      ...errorContext(err),
    });
    return {
      ok: false,
      attempts: [],
      skipped: true,
      skipReason: 'Unexpected service error — check logs',
    };
  }
}
