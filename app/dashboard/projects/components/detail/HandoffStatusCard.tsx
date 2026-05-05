'use client';

/**
 * HandoffStatusCard — installer handoff send + delivery status overview.
 *
 * Shows:
 *   - Whether a handoff has been sent for this project (Project.handoffSentAt)
 *   - Latest delivery status from EmailDelivery rows (sent / delivered /
 *     bounced / complained / failed)
 *   - "Resend to Installer" button (Phase 7 wires the action — this card
 *     ships in Phase 6 with the button disabled + a hint)
 *
 * Audience: admin + internal PM + vendor PM scoped to this project's
 * installer (same as the other installer-surface sections). Render-
 * gating is the parent's responsibility.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Mail, Check, X, Clock, Send } from 'lucide-react';
import { useToast } from '@/lib/toast';
import { SecondaryButton, PrimaryButton } from '@/components/ui';

interface DeliveryRow {
  id: string;
  projectId: string;
  installerId: string | null;
  providerMessageId: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed';
  errorReason: string | null;
  sentAt: string;
  deliveredAt: string | null;
  bouncedAt: string | null;
  isTest: boolean;
  createdById: string;
}

interface Props {
  projectId: string;
  /** True for admin / internal PM only (NOT vendor PM). Drives the Resend button. */
  canResend: boolean;
}

const STATUS_BADGE: Record<DeliveryRow['status'], { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  queued:     { label: 'Queued',     className: 'text-[var(--text-muted)]',          icon: Clock },
  sent:       { label: 'Sent',       className: 'text-[var(--accent-cyan-text)]',     icon: Send },
  delivered:  { label: 'Delivered',  className: 'text-[var(--accent-emerald-text)]',  icon: Check },
  bounced:    { label: 'Bounced',    className: 'text-[var(--accent-red-text)]',      icon: X },
  complained: { label: 'Complaint',  className: 'text-[var(--accent-amber-text)]',    icon: AlertCircle },
  failed:     { label: 'Failed',     className: 'text-[var(--accent-red-text)]',      icon: X },
};

export function HandoffStatusCard({ projectId, canResend }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const refresh = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/email-deliveries`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()) as DeliveryRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load delivery history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const onSend = async (opts: { resend?: boolean; test?: boolean } = {}) => {
    if (opts.resend && !confirm('Resend the handoff to the installer? They will receive another email.')) return;
    setSending(true);
    try {
      const url = `/api/projects/${projectId}/handoff${opts.test ? '?test=true' : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.resend ? { confirm: 'resend' } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; ok?: boolean };
      if (!res.ok) {
        toast(data.error || `Send failed (${res.status})`, 'error');
        return;
      }
      toast(opts.test ? 'Test email sent' : (opts.resend ? 'Handoff resent' : 'Handoff sent'), 'success');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Send failed', 'error');
    } finally {
      setSending(false);
    }
  };

  const realDeliveries = rows.filter((r) => !r.isTest);
  const latest = realDeliveries[0] ?? null;
  const hasBeenSent = !!latest;

  return (
    <div className="card-surface rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Installer Handoff</p>
        </div>
        {canResend && (
          <div className="flex items-center gap-2">
            <SecondaryButton
              size="sm"
              disabled={sending}
              onClick={() => void onSend({ test: true })}
              title="Send the handoff email to your own admin email instead of the installer (no EmailDelivery row, no handoffSentAt update)"
            >
              <Send className="w-3 h-3" /> Test
            </SecondaryButton>
            <PrimaryButton
              size="sm"
              disabled={sending}
              loading={sending}
              onClick={() => void onSend({ resend: hasBeenSent })}
            >
              <Send className="w-3 h-3" /> {hasBeenSent ? 'Resend' : 'Send Handoff'}
            </PrimaryButton>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading delivery status…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-[var(--accent-red-text)] py-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : !latest ? (
        <p className="text-xs text-[var(--text-dim)] py-2">
          No handoff has been sent for this project yet.
        </p>
      ) : (
        <div className="space-y-3">
          {(() => {
            const Badge = STATUS_BADGE[latest.status];
            const Icon = Badge.icon;
            return (
              <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${Badge.className}`}>
                    <Icon className="w-3 h-3" />
                    {Badge.label}
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">
                    {latest.toEmails.join(', ')}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {new Date(latest.sentAt).toLocaleString()}
                    {latest.deliveredAt && ` · delivered ${new Date(latest.deliveredAt).toLocaleString()}`}
                    {latest.bouncedAt && ` · bounced ${new Date(latest.bouncedAt).toLocaleString()}`}
                  </p>
                  {latest.errorReason && (
                    <p className="text-[10px] text-[var(--accent-red-text)] mt-0.5 truncate" title={latest.errorReason}>
                      {latest.errorReason}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {realDeliveries.length > 1 && (
            <details className="text-xs">
              <summary className="text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]">
                {realDeliveries.length - 1} earlier {realDeliveries.length - 1 === 1 ? 'send' : 'sends'}
              </summary>
              <div className="mt-2 space-y-1">
                {realDeliveries.slice(1).map((r) => (
                  <div key={r.id} className="text-[10px] text-[var(--text-muted)] pl-3">
                    {STATUS_BADGE[r.status].label} · {new Date(r.sentAt).toLocaleString()}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
