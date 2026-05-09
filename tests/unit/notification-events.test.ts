// Notification event registry unit tests.
//
// The registry is a contract: every event referenced by `notify(...)`
// at any call site MUST exist here, and every entry MUST carry sane
// defaults. Phase 2.6's check:notification-coverage gate enforces the
// first part by grepping call sites; these unit tests enforce the second.

import { describe, it, expect } from 'vitest';
import { NOTIFICATION_EVENTS, getEventDefinition, eventsForRole } from '@/lib/notifications/events';

describe('Notification event registry', () => {
  it('has at least one event in each category', () => {
    const categories = new Set(NOTIFICATION_EVENTS.map((e) => e.category));
    for (const c of ['projects', 'pay', 'mentions', 'admin', 'security'] as const) {
      expect(categories.has(c)).toBe(true);
    }
  });

  it('every event has a unique type', () => {
    const types = NOTIFICATION_EVENTS.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('every event has snake_case lowercase type identifier', () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(e.type).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('every event has a label and description', () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it('every event defines defaults for all four channels', () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(typeof e.defaults.email).toBe('boolean');
      expect(typeof e.defaults.sms).toBe('boolean');
      expect(typeof e.defaults.push).toBe('boolean');
      expect(['instant', 'daily_digest', 'weekly_digest', 'off']).toContain(e.defaults.digestMode);
    }
  });

  it('every event has at least one channel default-on (otherwise opt-in is invisible)', () => {
    for (const e of NOTIFICATION_EVENTS) {
      const anyOn = e.defaults.email || e.defaults.sms || e.defaults.push;
      expect(anyOn, `event ${e.type} has no default channel enabled`).toBe(true);
    }
  });

  it('mandatory events default email-on (cannot be invisible)', () => {
    for (const e of NOTIFICATION_EVENTS) {
      if (e.mandatory) {
        expect(e.defaults.email, `mandatory event ${e.type} must default email=true`).toBe(true);
      }
    }
  });

  it('chargeback + security events are mandatory', () => {
    expect(getEventDefinition('pay_chargeback')?.mandatory).toBe(true);
    expect(getEventDefinition('security_role_changed')?.mandatory).toBe(true);
  });

  it('does not duplicate Clerk-provided security emails', () => {
    // New-device sign-in is handled by Clerk's built-in security email.
    // Re-implementing it here would double-send on every new login.
    expect(getEventDefinition('security_login_new_device')).toBeUndefined();
  });

  it('admin-audience events do NOT show up for reps', () => {
    const repEvents = eventsForRole('rep');
    const types = repEvents.map((e) => e.type);
    expect(types).not.toContain('handoff_bounced');
    expect(types).not.toContain('admin_user_invited');
    expect(types).not.toContain('stalled_project_digest');
  });

  it('common rep-relevant events show up for reps', () => {
    const repEvents = eventsForRole('rep');
    const types = repEvents.map((e) => e.type);
    expect(types).toContain('mention');
    expect(types).toContain('project_phase_change');
    expect(types).toContain('pay_pending');
    expect(types).toContain('pay_paid');
  });

  it('admins see every event including admin-only ones', () => {
    const adminEvents = eventsForRole('admin');
    expect(adminEvents.length).toBe(NOTIFICATION_EVENTS.length);
  });
});
