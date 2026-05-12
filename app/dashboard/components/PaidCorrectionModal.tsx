'use client';

/**
 * PaidCorrectionModal — admin-only retroactive edit of a Paid PayrollEntry.
 *
 * Two distinct branches solve two distinct problems:
 *   1. "Fix the recorded amount"   → the entry's amountCents diverged from
 *                                     what was actually paid (Glide-import
 *                                     typo, kW change after pay, manual
 *                                     error). No money flow — pure data
 *                                     correction. Calls the dedicated
 *                                     /api/payroll/[id]/paid-correction
 *                                     endpoint which preserves the original
 *                                     value, audit-logs, and emails all
 *                                     admins.
 *   2. "Money was wrong, add correction payment"  → real cash flow needed.
 *                                     Closes this modal and signals the
 *                                     parent to open the existing
 *                                     Add Chargeback flow pre-filled with
 *                                     the entry's rep + project.
 *
 * The two paths are deliberately separate so the audit trail can later
 * distinguish "we corrected the number" from "we moved money."
 *
 * Polish: shell + transitions + token-only colors match the FeedbackButton
 * modal (z-[60], 0.6 scrim, blur(4px), DM Serif Display heading,
 * rounded-2xl). Three-card branch selector borrows the BVI opt-in card
 * pattern. Amount input is tabular-nums to read like an accounting ledger.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Loader2, AlertTriangle, FileEdit, MinusCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import type { PayrollEntry } from '../../../lib/data';
import { useToast } from '../../../lib/toast';

const MIN_REASON_LEN = 10;
const MAX_REASON_LEN = 500;

interface PaidCorrectionModalProps {
  /** The Paid entry being corrected. Modal is a no-op when null. */
  entry: PayrollEntry | null;
  onClose: () => void;
  /** Called after a successful correction so the parent can patch local
   *  state. Receives the updated entry as returned by the API. */
  onCorrected: (updated: PayrollEntry) => void;
  /** Called when the admin picks the "money was wrong" branch. The parent
   *  should close this modal and open its existing Add Chargeback flow
   *  pre-filled with the entry's rep + project. */
  onOpenChargeback: (entry: PayrollEntry) => void;
}

type Branch = 'choose' | 'fix-amount';

export default function PaidCorrectionModal({ entry, onClose, onCorrected, onOpenChargeback }: PaidCorrectionModalProps) {
  const { toast } = useToast();
  const [branch, setBranch] = useState<Branch>('choose');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  // Reset every time a new entry opens.
  useEffect(() => {
    if (!entry) return;
    setBranch('choose');
    setAmount(entry.amount.toFixed(2));
    setReason('');
    setSubmitting(false);
  }, [entry]);

  // Focus the amount input when entering fix-amount branch.
  useEffect(() => {
    if (branch !== 'fix-amount') return;
    const t = setTimeout(() => amountRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [branch]);

  // Escape closes; ignored mid-submit.
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry, submitting, onClose]);

  if (!entry) return null;

  const parsedAmount = parseFloat(amount);
  const isChargebackEntry = entry.amount < 0;
  const amountValid = Number.isFinite(parsedAmount)
    && (isChargebackEntry ? parsedAmount < 0 : parsedAmount >= 0)
    && Math.abs(parsedAmount - entry.amount) > 0.005;
  const reasonValid = reason.trim().length >= MIN_REASON_LEN && reason.length <= MAX_REASON_LEN;
  const canSubmit = amountValid && reasonValid && !submitting;
  const delta = Number.isFinite(parsedAmount) ? parsedAmount - entry.amount : 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/payroll/${entry.id}/paid-correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parsedAmount, reason: reason.trim() }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          toast('Too many corrections this hour. Wait a bit and try again.', 'error');
        } else if (res.status === 403) {
          toast('Admin access required to correct paid entries.', 'error');
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.error || `Correction failed (${res.status})`, 'error');
        }
        return;
      }
      const updated = (await res.json()) as PayrollEntry;
      toast('Entry corrected. All admins notified.', 'success');
      onCorrected(updated);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Correction failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChargebackBranch = () => {
    onOpenChargeback(entry);
    onClose();
  };

  const reasonCharsLeft = MAX_REASON_LEN - reason.length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-modal-backdrop"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="paid-correction-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl animate-modal-panel"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2
              id="paid-correction-title"
              className="text-base font-semibold truncate"
              style={{ color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}
            >
              {branch === 'choose' ? 'Edit Paid entry' : 'Fix recorded amount'}
            </h2>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums"
              style={{
                background: 'transparent',
                border: '1.5px solid var(--accent-emerald-display)',
                color: 'var(--accent-emerald-text)',
              }}
            >
              {entry.paymentStage}
            </span>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            aria-label="Close"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {branch === 'choose' ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              What needs to happen with this paid entry?
            </p>

            <button
              type="button"
              onClick={() => setBranch('fix-amount')}
              className="w-full text-left rounded-xl p-4 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-start gap-3"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: 'color-mix(in srgb, var(--accent-emerald-solid) 18%, transparent)',
                  color: 'var(--accent-emerald-text)',
                }}
              >
                <FileEdit className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                  Fix the recorded amount
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  The amount on this row is wrong but the actual payment was correct. No money moves.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 mt-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            </button>

            <button
              type="button"
              onClick={handleChargebackBranch}
              className="w-full text-left rounded-xl p-4 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-start gap-3"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: 'color-mix(in srgb, var(--accent-red-solid) 18%, transparent)',
                  color: 'var(--accent-red-text)',
                }}
              >
                <MinusCircle className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                  Add a correction payment
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Real money was paid in the wrong amount. Opens the chargeback flow to balance the books.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 mt-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Context strip */}
            <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
              <p>
                <span style={{ color: 'var(--text-secondary)' }}>Rep:</span>{' '}
                <span style={{ color: 'var(--text-primary)' }}>{entry.repName ?? '—'}</span>
              </p>
              {entry.customerName && (
                <p>
                  <span style={{ color: 'var(--text-secondary)' }}>Project:</span>{' '}
                  <span style={{ color: 'var(--text-primary)' }}>{entry.customerName}</span>
                </p>
              )}
              <p>
                <span style={{ color: 'var(--text-secondary)' }}>Paid:</span>{' '}
                <span style={{ color: 'var(--text-primary)' }}>{entry.date}</span>
              </p>
            </div>

            {/* Amount field */}
            <div>
              <label
                className="block text-[11px] uppercase tracking-wider font-semibold mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                New amount
              </label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                >
                  $
                </span>
                <input
                  ref={amountRef}
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-7 pr-3 py-2 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              {isChargebackEntry && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  This is a chargeback row — amount must remain negative.
                </p>
              )}
            </div>

            {/* Before / after preview */}
            <div
              className="rounded-lg p-3 grid grid-cols-3 gap-2 text-center"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
            >
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Original
                </p>
                <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  ${entry.amount.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  New
                </p>
                <p
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: amountValid ? 'var(--accent-emerald-text)' : 'var(--text-muted)' }}
                >
                  {Number.isFinite(parsedAmount) ? `$${parsedAmount.toFixed(2)}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Delta
                </p>
                <p
                  className="text-sm font-semibold tabular-nums"
                  style={{
                    color: delta > 0
                      ? 'var(--accent-emerald-text)'
                      : delta < 0
                        ? 'var(--accent-red-text)'
                        : 'var(--text-muted)',
                  }}
                >
                  {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}$${delta.toFixed(2)}`}
                </p>
              </div>
            </div>

            {/* Reason */}
            <div>
              <label
                className="block text-[11px] uppercase tracking-wider font-semibold mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Reason <span style={{ color: 'var(--accent-red-text)' }}>*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON_LEN))}
                placeholder="What needs to change and why? (Glide-import typo, kW correction, manual error…)"
                rows={3}
                disabled={submitting}
                maxLength={MAX_REASON_LEN}
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 resize-y"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
                  <CheckCircle2 className="w-3 h-3" /> Audit-logged and emailed to admins.
                </span>
                <span
                  className="text-[11px] tabular-nums"
                  style={{
                    color: reasonCharsLeft < 50
                      ? reasonCharsLeft < 0
                        ? 'var(--accent-red-text)'
                        : 'var(--accent-amber-text)'
                      : 'var(--text-dim)',
                  }}
                >
                  {reason.length} / {MAX_REASON_LEN}
                </span>
              </div>
              {reason.length > 0 && reason.trim().length < MIN_REASON_LEN && (
                <p
                  className="text-[11px] mt-1 flex items-center gap-1"
                  style={{ color: 'var(--accent-amber-text)' }}
                >
                  <AlertTriangle className="w-3 h-3" /> Reason must be at least {MIN_REASON_LEN} characters.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {branch === 'fix-amount' ? (
            <button
              type="button"
              onClick={() => setBranch('choose')}
              disabled={submitting}
              className="px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--text-muted)',
              }}
            >
              ← Back
            </button>
          ) : <span />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Cancel
            </button>
            {branch === 'fix-amount' && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--accent-emerald-solid)',
                  color: 'var(--text-on-accent)',
                  border: '1px solid var(--accent-emerald-solid)',
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <FileEdit className="w-4 h-4" /> Correct entry
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
