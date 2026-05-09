/**
 * Notification event registry.
 *
 * Single source of truth for every notifiable event in the app:
 *   - identifier (NotificationPreference.eventType column key)
 *   - human label (settings UI row title + delivery feed)
 *   - category (settings UI grouping)
 *   - default channels (when no explicit user preference exists)
 *   - mandatory flag (cannot be opted out of — security alerts, comp disputes)
 *   - audience (which roles even SEE the row in the prefs UI)
 *
 * Adding a new event: append a row here, write a unit test asserting the
 * default preference is sane, fire `notify(eventType, …)` from the relevant
 * mutation site. The check:notification-coverage CI gate (Phase 2.6) enforces
 * that every event referenced by `notify()` is registered here.
 *
 * Why a registry over per-event call sites: keeps the Settings UI honest
 * (the matrix is generated from this list, no drift), makes future audits
 * tractable (one file to review for gating policy), and lets us add
 * channel-specific render templates beside the metadata.
 */

import type { Role } from './types';

export type DigestMode = 'instant' | 'daily_digest' | 'weekly_digest' | 'off';

export interface EventDefinition {
  /** NotificationPreference.eventType column value. snake_case. */
  type: string;
  /** Settings UI row title. */
  label: string;
  /** One-line settings UI description. */
  description: string;
  /** Settings UI grouping. */
  category: 'projects' | 'pay' | 'mentions' | 'admin' | 'security';
  /** Default channel toggles when no explicit preference row exists. */
  defaults: {
    email: boolean;
    sms: boolean;
    push: boolean;
    digestMode: DigestMode;
  };
  /** Cannot be opted out of. Reserved for security + payroll-dispute paths.
   *  Mandatory events ignore digestMode='off' AND ignore channel toggles
   *  set to false (forces email at minimum). */
  mandatory?: boolean;
  /** Roles that see this row in the settings UI. Omitted = all internal users. */
  audience?: Role[];
}

/**
 * The full event catalog. Order matters — drives Settings UI row order
 * within each category.
 */
export const NOTIFICATION_EVENTS: EventDefinition[] = [
  // ─── Mentions ──────────────────────────────────────────────────────
  {
    type: 'mention',
    label: 'You were @-mentioned',
    description: 'Someone tagged you in a project chatter message or task.',
    category: 'mentions',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
  },

  // ─── Projects ──────────────────────────────────────────────────────
  {
    type: 'project_phase_change',
    label: 'Project phase changed',
    description: 'A deal you\'re on moved to a new phase (Acceptance, Permitting, PTO, etc.).',
    category: 'projects',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
  },
  {
    type: 'milestone_pto_granted',
    label: 'PTO granted',
    description: 'A deal you\'re on got Permission to Operate.',
    category: 'projects',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
  },
  {
    type: 'project_cancelled',
    label: 'Project cancelled',
    description: 'A deal you\'re on was cancelled.',
    category: 'projects',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
  },

  // ─── Pay ───────────────────────────────────────────────────────────
  {
    type: 'pay_pending',
    label: 'Pay moved to Pending',
    description: 'A draft commission was moved to Pending — close to landing in your bank.',
    category: 'pay',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
  },
  {
    type: 'pay_paid',
    label: 'Pay sent',
    description: 'A commission entry was marked Paid by admin.',
    category: 'pay',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
  },
  {
    type: 'pay_chargeback',
    label: 'Chargeback issued',
    description: 'A commission was charged back. Internal accounting reasons attached.',
    category: 'pay',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
    // Mandatory: a chargeback is a financial event the rep MUST see.
    mandatory: true,
  },

  // ─── Admin (admin-only audience) ───────────────────────────────────
  {
    type: 'handoff_bounced',
    label: 'Installer handoff bounced',
    description: 'A handoff email failed delivery (bounce / complaint / hard error).',
    category: 'admin',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
    audience: ['admin', 'project_manager'],
  },
  {
    type: 'admin_user_invited',
    label: 'New user invited',
    description: 'An admin sent or resent an invitation.',
    category: 'admin',
    defaults: { email: true, sms: false, push: false, digestMode: 'daily_digest' },
    audience: ['admin'],
  },
  {
    type: 'stalled_project_digest',
    label: 'Daily stalled-project digest',
    description: 'Summary of deals stuck in their phase past threshold.',
    category: 'admin',
    defaults: { email: true, sms: false, push: false, digestMode: 'daily_digest' },
    audience: ['admin', 'project_manager'],
  },

  // ─── Security (mandatory for all users) ────────────────────────────
  {
    type: 'security_role_changed',
    label: 'Your account role changed',
    description: 'Your role or permissions were modified by an admin.',
    category: 'security',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
    mandatory: true,
  },
  {
    type: 'security_login_new_device',
    label: 'New device sign-in',
    description: 'Your account was accessed from a device we haven\'t seen before.',
    category: 'security',
    defaults: { email: true, sms: false, push: false, digestMode: 'instant' },
    mandatory: true,
  },
];

/** Map for O(1) lookup. Built once at module load. */
const eventsByType: Record<string, EventDefinition> = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [e.type, e]),
);

export function getEventDefinition(type: string): EventDefinition | undefined {
  return eventsByType[type];
}

/**
 * Filter the registry to events visible to the given role. Used by the
 * Settings UI to render only the rows the user can actually toggle.
 */
export function eventsForRole(role: Role): EventDefinition[] {
  return NOTIFICATION_EVENTS.filter((e) => !e.audience || e.audience.includes(role));
}
