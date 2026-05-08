/**
 * Shared notification types — kept in their own file so the registry
 * (events.ts), service (service.ts), and channel adapters can all import
 * without circular dependencies.
 */

export type Role = 'admin' | 'project_manager' | 'rep' | 'sub-dealer';

export type Channel = 'email' | 'sms' | 'push' | 'in_app';

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed';

/** What the caller of `notify()` provides for a single event. */
export interface NotifyInput {
  /** Event type from NOTIFICATION_EVENTS. */
  type: string;

  /** Recipient user id (DB User.id). null is allowed only for system-only
   *  events that don't target a specific user (e.g. legacy stalled digest
   *  to a configured admin list). When null, `toAddressOverride` MUST be set. */
  userId: string | null;

  /** Optional project context — drives privacy gate access on the
   *  delivery row + can be referenced by templates. */
  projectId?: string;

  /** Subject line (email) or short message (SMS / push). Caller renders. */
  subject: string;

  /** Long-form body for email. Render before calling notify(). */
  emailHtml?: string;

  /** SMS short text body. Channel-rendering responsibility lives with the
   *  caller for now — no template DSL until we have ≥3 SMS event types. */
  smsBody?: string;

  /** Push payload — title is taken from `subject`; body from this. */
  pushBody?: string;

  /** When set, send to this address regardless of the user's stored
   *  email/phone. Used for email-archive fanout, system digests, and
   *  unit tests. */
  toAddressOverride?: string;

  /** When true, byPass the preference check and force-send via every
   *  channel that has a body. For mandatory security events; ignored
   *  if the registered event is not flagged mandatory. */
  forceMandatory?: boolean;
}

/** Outcome of a single channel attempt within a notify() call. */
export interface ChannelResult {
  channel: Channel;
  ok: boolean;
  /** NotificationDelivery.id of the row written for this attempt. */
  deliveryId?: string;
  /** Human-readable reason on failure. */
  error?: string;
}

/** Aggregate result returned by notify(). */
export interface NotifyResult {
  /** True iff every attempted channel succeeded. */
  ok: boolean;
  attempts: ChannelResult[];
  /** True if the user opted out (or all channels were disabled by policy)
   *  and no send was attempted. Not an error — service treats opt-outs
   *  as the user's intended state. */
  skipped?: boolean;
  skipReason?: string;
}
