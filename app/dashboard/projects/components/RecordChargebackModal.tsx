'use client';

/**
 * RecordChargebackModal — admin-only, for cancelled projects. Creates an
 * explicit chargeback PayrollEntry linked to a Paid milestone entry.
 *
 * The form is opinionated: the Paid-entry picker is pre-scoped to the
 * one project + rep being clawed back, and the amount defaults to the
 * negative of the original (admin can edit for partial clawbacks).
 * Date defaults to today but is backdatable for recording historical
 * clawbacks from pre-app spreadsheets (Glide, etc).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '../../../../lib/hooks';
import { fmt$ } from '../../../../lib/utils';
import { useToast } from '../../../../lib/toast';

interface PaidEntryOption {
  id: string;
  repId: string;
  repName: string;
  paymentStage: string;
  amount: number; // positive dollars
  date: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  projectId: string;
  paidEntries: PaidEntryOption[]; // Paid PayrollEntries on this project that have no existing chargeback
}

export default function RecordChargebackModal({ open, onClose, onSaved, projectId, paidEntries }: Props) {
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  const [selectedEntryId, setSelectedEntryId] = useState<string>(paidEntries[0]?.id ?? '');
  const selected = useMemo(() => paidEntries.find((e) => e.id === selectedEntryId), [paidEntries, selectedEntryId]);

  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Reset the form each time a different entry is selected; pre-fill with
  // the full original as a negative so admins click Save for full clawbacks.
  useEffect(() => {
    if (selected) setAmount(`-${selected.amount.toFixed(2)}`);
  }, [selectedEntryId, selected]);

  // Reset date/notes/entry on open.
  useEffect(() => {
    if (!open) return;
    setSelectedEntryId(paidEntries[0]?.id ?? '');
    setDate(new Date().toISOString().slice(0, 10));
    setNotes('');
  }, [open, paidEntries]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selected) { toast('Pick an entry to charge back', 'error'); return; }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount >= 0) {
      toast('Chargeback amount must be negative', 'error');
      return;
    }
    if (Math.abs(parsedAmount) > selected.amount + 0.01) {
      toast(`Amount can't exceed original ${fmt$(selected.amount)}`, 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repId: selected.repId,
          projectId,
          amount: parsedAmount,
          type: 'Deal',
          paymentStage: selected.paymentStage,
          status: 'Draft',
          date,
          notes: notes.trim() || `Chargeback — ${selected.repName} ${selected.paymentStage}`,
          isChargeback: true,
          chargebackOfId: selected.id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? 'Failed to record chargeback', 'error');
        return;
      }
      toast('Chargeback recorded', 'success');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="min-h-full grid place-items-center p-4">
        <div ref={panelRef} className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 rounded-2xl p-6 w-full max-w-lg">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/15">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-white font-bold">Record Chargeback</h2>
                <p className="text-xs text-[var(--text-muted)]">Creates a linked negative PayrollEntry for admin review.</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-[var(--surface-card)] rounded-lg text-[var(--text-muted)]"><X className="w-5 h-5" /></button>
          </div>

          {paidEntries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">No Paid milestones on this project are eligible for chargeback.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">Original entry</label>
                <select
                  value={selectedEntryId}
                  onChange={(e) => setSelectedEntryId(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                >
                  {paidEntries.map((e) => (
                    <option key={e.id} value={e.id}>{e.repName} · {e.paymentStage} · {fmt$(e.amount)} · {e.date}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">
                  Amount (negative){selected && <span className="ml-2 text-[var(--text-dim)] normal-case">max {fmt$(selected.amount)}</span>}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">Clawback date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                />
                <p className="text-[10px] text-[var(--text-dim)] mt-1">Backdate for historical clawbacks (e.g. Glide-era).</p>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">Notes</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={saving || !selected}
                className="w-full flex items-center justify-center gap-2 min-h-[44px] text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                {saving ? 'Recording…' : 'Record chargeback (Draft)'}
              </button>
              <p className="text-[10px] text-[var(--text-dim)] text-center">Created as Draft. Progress to Pending/Paid via the payroll tab.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
