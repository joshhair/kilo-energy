'use client';

/**
 * NotificationsSection — per-user notification preferences UI.
 *
 * Mounted in both /dashboard/preferences (rep / sub-dealer / PM) and the
 * admin Settings page. One implementation; one experience.
 *
 * Design alignment:
 *   - card-surface tokens (--surface-card, --border-default)
 *   - Switch primitive from components/ui/Switch
 *   - text-primary / text-secondary / text-muted color hierarchy
 *   - animate-fade-in-up for initial mount (matches PreferencesPage)
 *   - brand emerald accent on active states + mandatory locks
 *
 * The matrix:
 *   - rows = event types (grouped by category: Mentions, Projects, Pay,
 *     Admin, Security)
 *   - columns = channels (Email, SMS, Push)
 *   - cells = Switch primitive (mandatory rows show locked)
 *   - per-row digest mode dropdown (Instant / Daily / Weekly / Off)
 *
 * SMS + Push are visually present today (Phase 2) but flagged as
 * "coming soon" until Phase 4 (SMS) and Phase 5 (Web Push) ship.
 */

import { useEffect, useState, useCallback } from 'react';
import { Bell, Mail, MessageSquare, Smartphone, Lock, Loader2 } from 'lucide-react';
import { Switch } from '../../../../components/ui/Switch';
import { SelectMenu } from '../../../../components/ui/SelectMenu';
import { useToast } from '../../../../lib/toast';

const CADENCE_OPTIONS: { value: DigestMode; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily_digest', label: 'Daily digest' },
  { value: 'weekly_digest', label: 'Weekly digest' },
  { value: 'off', label: 'Off' },
];

type DigestMode = 'instant' | 'daily_digest' | 'weekly_digest' | 'off';

interface EventRow {
  type: string;
  label: string;
  description: string;
  category: 'projects' | 'pay' | 'mentions' | 'blitz' | 'admin' | 'security';
  mandatory: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  digestMode: DigestMode;
}

interface ApiResponse {
  user: {
    notificationPhone: string | null;
    phoneVerified: boolean;
    quietHoursStartUtc: number | null;
    quietHoursEndUtc: number | null;
  };
  events: EventRow[];
}

const CATEGORY_ORDER: EventRow['category'][] = ['mentions', 'projects', 'blitz', 'pay', 'admin', 'security'];

const CATEGORY_LABEL: Record<EventRow['category'], string> = {
  mentions: 'Mentions',
  projects: 'Projects',
  blitz: 'Blitzes',
  pay: 'Pay',
  admin: 'Admin',
  security: 'Security',
};

const CATEGORY_HINT: Record<EventRow['category'], string> = {
  mentions: 'When someone tags you in a chat or task.',
  projects: 'Phase changes, install scheduling, PTO, cancellations.',
  blitz: 'Join requests, blitz requests, and approvals.',
  pay: 'When commissions move toward your bank.',
  admin: 'Operational alerts for admins and project managers.',
  security: 'Account changes you can\'t opt out of.',
};

export default function NotificationsSection() {
  const { toast } = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/preferences');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      console.error('[NotificationsSection] load failed:', err);
      toast('Failed to load notification preferences', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const updateRow = useCallback(
    async (type: string, patch: Partial<Omit<EventRow, 'type' | 'label' | 'description' | 'category' | 'mandatory'>>) => {
      if (!data) return;
      // Optimistic
      setData({
        ...data,
        events: data.events.map((e) => (e.type === type ? { ...e, ...patch } : e)),
      });
      setSavingType(type);
      try {
        const res = await fetch('/api/notifications/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventType: type, ...patch }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const updated = await res.json();
        // Reconcile with server's clamped values (mandatory protections etc.)
        setData((cur) => cur ? {
          ...cur,
          events: cur.events.map((e) => e.type === type ? {
            ...e,
            emailEnabled: updated.emailEnabled,
            smsEnabled: updated.smsEnabled,
            pushEnabled: updated.pushEnabled,
            digestMode: updated.digestMode,
          } : e),
        } : cur);
      } catch (err) {
        toast('Failed to save preference', 'error');
        // Revert: refetch to recover
        load();
        console.error('[NotificationsSection] save failed:', err);
      } finally {
        setSavingType(null);
      }
    },
    [data, toast, load],
  );

  if (loading || !data) {
    return (
      <div
        className="rounded-xl p-8 flex items-center justify-center"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
      >
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
        <span className="ml-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading preferences…
        </span>
      </div>
    );
  }

  const grouped = CATEGORY_ORDER
    .map((cat) => ({ category: cat, events: data.events.filter((e) => e.category === cat) }))
    .filter((g) => g.events.length > 0);

  return (
    <div className="space-y-5">
      {/* Header — inline strip, not a heavyweight card. Title + one
          short helper line; the per-category cards below carry the
          rest of the context. Internal phasing notes intentionally
          dropped — users don't need to read about Phase 4/5 internals. */}
      <div className="flex items-center gap-3 px-1">
        <Bell className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent-emerald-text)' }} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
            Notifications
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Choose how Kilo reaches you. SMS and Push are coming soon.
          </p>
        </div>
      </div>

      {/* Per-category preference cards */}
      {grouped.map(({ category, events }) => (
        <div
          key={category}
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
        >
          <div className="px-5 md:px-6 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              {CATEGORY_LABEL[category]}
            </h3>
            {/* Hide the category hint when the group contains a single event
                — the event's own description below would just restate it
                (see Mentions and Security). Multi-event groups keep the hint
                so the user gets a feel for the category before scanning rows. */}
            {events.length > 1 && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {CATEGORY_HINT[category]}
              </p>
            )}
          </div>

          {/* Channel header (desktop only — mobile uses per-channel rows).
              Each header cell stretches to the full grid-column width so
              its centered content aligns with the toggle/dropdown below
              (using plain inline `<span>` would leave the labels at the
              column start, misaligned with the centered toggles). */}
          <div
            className="hidden md:grid px-6 py-2 text-[11px] uppercase tracking-wider items-center"
            style={{
              gridTemplateColumns: '1fr 64px 64px 64px 132px',
              color: 'var(--text-dim)',
              borderBottom: '1px solid var(--border-default)',
            }}
          >
            <span>Event</span>
            <span className="flex items-center gap-1 justify-center w-full"><Mail className="w-3 h-3" /> Email</span>
            <span className="flex items-center gap-1 justify-center w-full"><MessageSquare className="w-3 h-3" /> SMS</span>
            <span className="flex items-center gap-1 justify-center w-full"><Smartphone className="w-3 h-3" /> Push</span>
            <span className="block w-full text-right">Cadence</span>
          </div>

          <ul>
            {events.map((e, idx) => (
              <li
                key={e.type}
                className="px-5 md:px-6 py-4 md:grid md:items-center"
                style={{
                  gridTemplateColumns: '1fr 64px 64px 64px 132px',
                  borderBottom: idx < events.length - 1 ? '1px solid var(--border-default)' : undefined,
                }}
              >
                {/* Event label + description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {e.label}
                    </span>
                    {e.mandatory && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--accent-emerald-soft)',
                          color: 'var(--accent-emerald-text)',
                          border: '1px solid var(--accent-emerald-solid)',
                        }}
                      >
                        <Lock className="w-2.5 h-2.5" /> Required
                      </span>
                    )}
                    {savingType === e.type && (
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--text-muted)' }} />
                    )}
                  </div>
                  <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    {e.description}
                  </p>
                </div>

                {/* ── Mobile: stacked per-channel rows ─────────────────── */}
                {/* Each channel renders as label-on-left, switch-on-right.
                    Tappable, scannable, matches the rest of the app's mobile
                    settings rows (see InstallerHandoffPanel, CustomizationSection). */}
                <div className="md:hidden mt-4 space-y-1.5 -mx-1">
                  <MobileChannelRow
                    icon={Mail} label="Email"
                    enabled={e.emailEnabled} locked={e.mandatory}
                    onToggle={(v) => updateRow(e.type, { emailEnabled: v })}
                  />
                  <MobileChannelRow
                    icon={MessageSquare} label="SMS"
                    enabled={e.smsEnabled} locked={false} comingSoon
                    onToggle={(v) => updateRow(e.type, { smsEnabled: v })}
                  />
                  <MobileChannelRow
                    icon={Smartphone} label="Push"
                    enabled={e.pushEnabled} locked={false} comingSoon
                    onToggle={(v) => updateRow(e.type, { pushEnabled: v })}
                  />
                  {/* Cadence as its own labeled row on mobile */}
                  <div
                    className="flex items-center justify-between gap-3 px-1 py-2 rounded-md"
                  >
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Cadence
                    </span>
                    <SelectMenu<DigestMode>
                      value={e.digestMode}
                      onChange={(v) => updateRow(e.type, { digestMode: v })}
                      options={CADENCE_OPTIONS}
                      ariaLabel={`Cadence for ${e.label}`}
                      disabled={e.mandatory}
                      alignRight
                    />
                  </div>
                </div>

                {/* ── Desktop: 5-column grid (channels + cadence) ───────── */}
                <DesktopChannelCell
                  enabled={e.emailEnabled} locked={e.mandatory}
                  onToggle={(v) => updateRow(e.type, { emailEnabled: v })}
                  ariaLabel="Toggle Email"
                />
                <DesktopChannelCell
                  enabled={e.smsEnabled} locked={false} comingSoon
                  onToggle={(v) => updateRow(e.type, { smsEnabled: v })}
                  ariaLabel="Toggle SMS"
                />
                <DesktopChannelCell
                  enabled={e.pushEnabled} locked={false} comingSoon
                  onToggle={(v) => updateRow(e.type, { pushEnabled: v })}
                  ariaLabel="Toggle Push"
                />
                <div className="hidden md:flex md:justify-end">
                  <SelectMenu<DigestMode>
                    value={e.digestMode}
                    onChange={(v) => updateRow(e.type, { digestMode: v })}
                    options={CADENCE_OPTIONS}
                    ariaLabel={`Cadence for ${e.label}`}
                    disabled={e.mandatory}
                    alignRight
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Phone + quiet hours card */}
      <div
        className="rounded-xl p-6 space-y-4"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
      >
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
          Phone & quiet hours
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Verified phone needed for SMS. Quiet hours pause SMS and push (email always lands immediately).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'var(--text-dim)' }}>
              Phone (E.164)
            </label>
            <div
              className="text-sm px-3 py-2 rounded-md"
              style={{
                background: 'var(--surface-pressed)',
                color: data.user.notificationPhone ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid var(--border-default)',
              }}
            >
              {data.user.notificationPhone ?? 'Not set'}
              {data.user.notificationPhone && !data.user.phoneVerified && (
                <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: 'var(--accent-amber-text)' }}>
                  Unverified
                </span>
              )}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              SMS verification ships with Phase 4 (Twilio). The field is read-only until then.
            </p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'var(--text-dim)' }}>
              Quiet hours (UTC)
            </label>
            <div
              className="text-sm px-3 py-2 rounded-md"
              style={{
                background: 'var(--surface-pressed)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-default)',
              }}
            >
              {data.user.quietHoursStartUtc != null && data.user.quietHoursEndUtc != null
                ? `${pad(data.user.quietHoursStartUtc)}:00 – ${pad(data.user.quietHoursEndUtc)}:00 UTC`
                : 'Not set'}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Editable when SMS / Push channels go live.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Mobile per-channel row: icon + label on the left, switch on the right.
 *  Mirrors the mobile settings-row pattern used in InstallerHandoffPanel
 *  and CustomizationSection — full-width tap target, comfortable spacing,
 *  no horizontal cramming. */
function MobileChannelRow({
  icon: Icon,
  label,
  enabled,
  locked,
  comingSoon,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  enabled: boolean;
  locked: boolean;
  comingSoon?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-1 py-2 rounded-md"
    >
      <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <Icon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        {label}
        {comingSoon && (
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              color: 'var(--text-dim)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-pressed)',
            }}
          >
            Soon
          </span>
        )}
      </span>
      {locked ? (
        <span
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: 'var(--accent-emerald-text)' }}
        >
          <Lock className="w-3.5 h-3.5" />
          Locked
        </span>
      ) : (
        <div className={comingSoon ? 'opacity-50 pointer-events-none select-none' : ''}>
          <Switch
            checked={enabled}
            onChange={onToggle}
            ariaLabel={`Toggle ${label}`}
            size="md"
          />
        </div>
      )}
    </div>
  );
}

/** Desktop grid cell: just the switch (or lock icon), centered in its column.
 *  Hidden on mobile — replaced by MobileChannelRow above. */
function DesktopChannelCell({
  enabled,
  locked,
  comingSoon,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  locked: boolean;
  comingSoon?: boolean;
  onToggle: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="hidden md:flex items-center justify-center">
      {locked ? (
        <Lock className="w-4 h-4" style={{ color: 'var(--accent-emerald-text)' }} />
      ) : (
        <div
          className={comingSoon ? 'opacity-50 pointer-events-none select-none' : ''}
          title={comingSoon ? `${ariaLabel} — ships in a future phase` : undefined}
        >
          <Switch
            checked={enabled}
            onChange={onToggle}
            ariaLabel={ariaLabel}
            size="sm"
          />
        </div>
      )}
    </div>
  );
}
