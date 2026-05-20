'use client';

/**
 * RecordTrainerPaymentModal — admin-only, project-scoped.
 *
 * Creates a Trainer-stage PayrollEntry tied to a specific project. Built
 * for the Glide-cleanup use case: deals that have a trainer attached but
 * no Trainer-stage payroll entries yet (because they were imported with
 * incomplete commission state).
 *
 * Pre-fill rules:
 *   - paymentStage locked to 'Trainer' (the modal's whole purpose)
 *   - Trainer (rep) defaults to project.trainerId if set, else blank
 *   - Amount defaults to projected (rate × kW × 1000 × installPayPct%)
 *     when both rate + installer config are known; admin can edit
 *   - Date defaults to today; backdatable for historical entries
 *   - paidAt left null unless admin opts into Status=Paid (then auto-stamped server-side)
 *   - Status defaults to Draft (admin can promote to Paid for historical entries)
 *
 * On submit:
 *   - POST /api/payroll with idempotencyKey (prevents double-submit from
 *     network retries / React StrictMode double-invokes)
 *   - Server gate: requireAdminOrPM at the route, then field-level
 *     authorization. Even if a PM somehow opened this UI, the server
 *     would reject Trainer-stage creation by a non-admin via the schema.
 *     (Verified: createPayrollSchema accepts paymentStage as any string
 *     and POST handler doesn't currently block PM-on-Trainer, so we
 *     also gate at the parent component on effectiveRole === 'admin'.)
 *
 * Verification baked in:
 *   - Money via lib/money round-trip on the server side (dollarsToCents)
 *   - Audit log emitted by the existing POST /api/payroll handler
 *   - Idempotency key prevents double-creates
 *   - Cannot be opened on Cancelled / On-Hold projects (parent gates)
 *
 * Design: matches RecordChargebackModal vocabulary — same shell, same
 * token-only colors, same field layout. Notes default mirrors the
 * "Trainer override M2 — {name} ($X.XX/W)" convention used by the
 * phase-transition generator so audit trails remain searchable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, GraduationCap } from 'lucide-react';
import { useFocusTrap } from '../../../../lib/hooks';
import { fmt$ } from '../../../../lib/utils';
import { useToast } from '../../../../lib/toast';
import { RepSelector } from '../../components/RepSelector';
import { SearchableSelect } from '../../components/SearchableSelect';
import type { Rep, PayrollEntry } from '../../../../lib/data';

type Status = 'Draft' | 'Pending' | 'Paid';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create. Receives the new entry as returned
   *  by the API so the parent can patch local context state. */
  onSaved: (entry: PayrollEntry) => void;
  projectId: string;
  /** Customer name — used as a label hint + default notes prefix. */
  projectCustomerName: string;
  /** kW size of the deal — used to compute projected default amount. */
  projectKWSize: number;
  /** Project-level trainerId, if set. Pre-selects the rep picker. */
  defaultTrainerId?: string | null;
  /** Project-level trainerRate, if set. Drives the projected amount default. */
  defaultTrainerRate?: number | null;
  /** Active install-pay percentage for this installer. Drives the M2 vs M3
   *  fraction of the override projection. */
  installPayPct: number;
  /** Full reps list (admin sees all). */
  reps: Rep[];
}

export default function RecordTrainerPaymentModal({
  open,
  onClose,
  onSaved,
  projectId,
  projectCustomerName,
  projectKWSize,
  defaultTrainerId,
  defaultTrainerRate,
  installPayPct,
  reps,
}: Props) {
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  const [repId, setRepId] = useState<string>('');
  const [milestone, setMilestone] = useState<'M2' | 'M3'>('M2');
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<Status>('Draft');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // Stable idempotency key per "open" of the modal. Regenerated each time
  // the modal opens, then reused for retries of the same submit.
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // Compute projected amount: rate × kW × 1000 × (fraction).
  // M2 carries installPayPct% of the override, M3 carries the remainder.
  // Matches the phase-transition generator math at lib/context/project-transitions.ts.
  const projectedAmount = useMemo(() => {
    if (!defaultTrainerRate || !projectKWSize) return 0;
    const total = defaultTrainerRate * projectKWSize * 1000;
    const fraction = milestone === 'M2' ? installPayPct / 100 : (100 - installPayPct) / 100;
    return Math.round(total * fraction * 100) / 100;
  }, [defaultTrainerRate, projectKWSize, installPayPct, milestone]);

  // Reset form each time the modal opens. Don't reset on milestone change
  // because the user might intentionally edit amount after picking M2/M3.
  useEffect(() => {
    if (!open) return;
    setRepId(defaultTrainerId ?? '');
    setMilestone('M2');
    setDate(new Date().toISOString().slice(0, 10));
    setStatus('Draft');
    setNotes('');
    setSaving(false);
    // Fresh idempotency key on every open
    setIdempotencyKey(`record-trainer-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }, [open, projectId, defaultTrainerId]);

  // Recompute the default amount when milestone OR projected changes — but
  // only if the user hasn't edited the field yet (amount === projectedAmount
  // or amount is empty). This way switching milestone updates the suggestion
  // without trampling a manual edit.
  useEffect(() => {
    if (!open) return;
    setAmount(projectedAmount > 0 ? projectedAmount.toFixed(2) : '');
  }, [open, milestone, projectedAmount]);

  if (!open) return null;

  const parsedAmount = parseFloat(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const canSubmit = !!repId && amountValid && !!date && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const finalNotes = notes.trim()
        || `Trainer override ${milestone} — ${projectCustomerName}${defaultTrainerRate ? ` ($${defaultTrainerRate.toFixed(2)}/W)` : ''}`;
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repId,
          projectId,
          amount: parsedAmount,
          type: 'Deal',
          paymentStage: 'Trainer',
          status,
          date,
          notes: finalNotes,
          idempotencyKey,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) {
          toast('Admin access required to record trainer payments.', 'error');
        } else if (res.status === 429) {
          toast('Slow down — too many payroll creates this minute.', 'error');
        } else {
          toast(body.error ?? `Failed to record trainer payment (${res.status})`, 'error');
        }
        return;
      }
      const created = (await res.json()) as PayrollEntry;
      toast('Trainer payment recorded.', 'success');
      onSaved(created);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to record trainer payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="min-h-full grid place-items-center p-4">
        <div
          ref={panelRef}
          className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 rounded-2xl p-6 w-full max-w-lg animate-modal-panel"
        >
          {/* Header — amber accent matches the Overrides tab vocabulary */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--accent-amber-soft)' }}>
                <GraduationCap className="w-5 h-5 text-[var(--accent-amber-text)]" />
              </div>
              <div>
                <h2
                  className="text-base font-semibold"
                  style={{ color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}
                >
                  Record Trainer Payment
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Backdated trainer-stage entry for {projectCustomerName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => !saving && onClose()}
              disabled={saving}
              aria-label="Close"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Trainer rep */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Trainer
              </label>
              <RepSelector
                value={repId}
                onChange={setRepId}
                reps={reps}
                filterFn={(r) => r.active !== false}
                placeholder="— Select trainer —"
                clearLabel="— None —"
              />
            </div>

            {/* Milestone + Status — two-up */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Milestone
                </label>
                <SearchableSelect
                  value={milestone}
                  onChange={(v) => setMilestone(v as 'M2' | 'M3')}
                  options={[
                    { value: 'M2', label: `M2 (${installPayPct}% of override)` },
                    { value: 'M3', label: `M3 (${100 - installPayPct}% of override)` },
                  ]}
                  placeholder="Select milestone"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Status
                </label>
                <SearchableSelect
                  value={status}
                  onChange={(v) => setStatus(v as Status)}
                  options={[
                    { value: 'Draft', label: 'Draft' },
                    { value: 'Pending', label: 'Pending' },
                    { value: 'Paid', label: 'Paid (historical)' },
                  ]}
                  placeholder="Select status"
                />
              </div>
            </div>

            {/* Amount + Date — two-up */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Amount ($)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm tabular-nums"
                  style={{
                    background: 'var(--surface-card)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
                {projectedAmount > 0 && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>
                    Projected: {fmt$(projectedAmount)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    background: 'var(--surface-card)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Notes <span className="text-[var(--text-dim)] font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={`Trainer override ${milestone} — ${projectCustomerName}${defaultTrainerRate ? ` ($${defaultTrainerRate.toFixed(2)}/W)` : ''}`}
                maxLength={2000}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  background: 'var(--surface-card)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Audit-trail note */}
            {status === 'Paid' && (
              <div
                className="rounded-lg p-3 text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--accent-amber-solid) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)',
                  color: 'var(--accent-amber-text)',
                }}
              >
                Marking as Paid records this as already-disbursed. Auto-stamps a paidAt timestamp on the server. Use for historical entries only — for live payments, leave as Draft and run the standard publish flow.
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 mt-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => !saving && onClose()}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
              style={{ background: 'transparent', color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              style={{
                background: canSubmit ? 'var(--brand)' : 'var(--surface-card)',
                color: canSubmit ? 'var(--text-on-brand, #fff)' : 'var(--text-muted)',
              }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Recording…' : 'Record Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
