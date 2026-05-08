/**
 * GET   /api/notifications/preferences  — list of (event, current pref) for the signed-in user
 * PATCH /api/notifications/preferences  — update one event's channel toggles / digest mode
 *
 * Self-only by construction: every read/write is keyed by the signed-in user.
 * No cross-user listing or override surface; admin override goes through a
 * separate (future) impersonation path with audit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireInternalUser } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { logChange } from '../../../../lib/audit';
import { eventsForRole, getEventDefinition } from '../../../../lib/notifications/events';
import { patchNotificationPreferenceSchema } from '../../../../lib/schemas/notification';
import type { Role } from '../../../../lib/notifications/types';

export async function GET() {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const events = eventsForRole(user.role as Role);
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: user.id },
  });
  const prefMap = new Map(prefs.map((p) => [p.eventType, p]));

  const phoneInfo = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      notificationPhone: true,
      notificationPhoneVerifiedAt: true,
      quietHoursStartUtc: true,
      quietHoursEndUtc: true,
    },
  });

  return NextResponse.json({
    user: {
      notificationPhone: phoneInfo?.notificationPhone ?? null,
      phoneVerified: !!phoneInfo?.notificationPhoneVerifiedAt,
      quietHoursStartUtc: phoneInfo?.quietHoursStartUtc ?? null,
      quietHoursEndUtc: phoneInfo?.quietHoursEndUtc ?? null,
    },
    /** One row per event in the user's audience. `mandatory` events return
     *  effective values that respect the registry's mandatory flag (settings
     *  UI shows them locked). */
    events: events.map((e) => {
      const stored = prefMap.get(e.type);
      const effective = stored
        ? {
            emailEnabled: stored.emailEnabled,
            smsEnabled: stored.smsEnabled,
            pushEnabled: stored.pushEnabled,
            digestMode: stored.digestMode,
          }
        : {
            emailEnabled: e.defaults.email,
            smsEnabled: e.defaults.sms,
            pushEnabled: e.defaults.push,
            digestMode: e.defaults.digestMode,
          };
      return {
        type: e.type,
        label: e.label,
        description: e.description,
        category: e.category,
        mandatory: !!e.mandatory,
        ...effective,
      };
    }),
  });
}

export async function PATCH(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const limited = await enforceRateLimit(`PATCH /api/notifications/preferences:${user.id}`, 60, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchNotificationPreferenceSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const def = getEventDefinition(body.eventType);
  if (!def) {
    return NextResponse.json({ error: `Unknown event type: ${body.eventType}` }, { status: 400 });
  }

  // Audience gate: a user can only set prefs for events visible to their role.
  if (def.audience && !def.audience.includes(user.role as Role)) {
    return NextResponse.json({ error: 'Event not in your audience' }, { status: 403 });
  }

  // Mandatory events: email cannot be disabled. Sanity-clamp client requests
  // rather than 400'ing — the user might not realize the row was mandatory.
  if (def.mandatory && body.emailEnabled === false) {
    body.emailEnabled = true;
  }
  if (def.mandatory && body.digestMode === 'off') {
    body.digestMode = 'instant';
  }

  // Upsert: create with defaults+overrides if missing, else update only the
  // fields the request carried.
  const existing = await prisma.notificationPreference.findUnique({
    where: { userId_eventType: { userId: user.id, eventType: body.eventType } },
  });

  const merged = {
    emailEnabled: body.emailEnabled ?? existing?.emailEnabled ?? def.defaults.email,
    smsEnabled:   body.smsEnabled   ?? existing?.smsEnabled   ?? def.defaults.sms,
    pushEnabled:  body.pushEnabled  ?? existing?.pushEnabled  ?? def.defaults.push,
    digestMode:   body.digestMode   ?? existing?.digestMode   ?? def.defaults.digestMode,
  };

  const updated = existing
    ? await prisma.notificationPreference.update({
        where: { id: existing.id },
        data: merged,
      })
    : await prisma.notificationPreference.create({
        data: { userId: user.id, eventType: body.eventType, ...merged },
      });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'notification_preference_update',
    entityType: 'NotificationPreference',
    entityId: updated.id,
    detail: {
      eventType: body.eventType,
      ...merged,
      mandatoryClamp: !!def.mandatory && (body.emailEnabled === false || body.digestMode === 'off'),
    },
  });

  return NextResponse.json({
    type: body.eventType,
    emailEnabled: updated.emailEnabled,
    smsEnabled: updated.smsEnabled,
    pushEnabled: updated.pushEnabled,
    digestMode: updated.digestMode,
  });
}
