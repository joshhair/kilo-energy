'use client';

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { useToast } from '../../../lib/toast';
import { PayrollEntry } from '../../../lib/data';
import { Check, Edit2, Trash2, Plus } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBottomSheet from './shared/MobileBottomSheet';

type StatusTab = 'Draft' | 'Pending' | 'Paid';

export default function MobilePayroll() {
  const {
    payrollEntries,
    setPayrollEntries,
    reps,
    currentRole,
  } = useApp();
  const { toast } = useToast();

  const [statusTab, setStatusTab] = useState<StatusTab>('Pending');
  const [selectedEntry, setSelectedEntry] = useState<PayrollEntry | null>(null);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ repId: '', amount: '', notes: '', date: '', type: 'Bonus' as 'Deal' | 'Bonus', stage: 'Bonus' as string });

  // ── Summaries ─────────────────────────────────────────────────────────────

  const pendingTotal = useMemo(
    () => payrollEntries.filter((e) => e.status === 'Pending').reduce((s, e) => s + e.amount, 0),
    [payrollEntries],
  );

  // ── Filtered entries ──────────────────────────────────────────────────────

  const filtered = useMemo(
    () => payrollEntries.filter((e) => e.status === statusTab),
    [payrollEntries, statusTab],
  );

  // ── Group by rep ──────────────────────────────────────────────────────────

  const groupedByRep = useMemo(() => {
    const map = new Map<string, { repName: string; entries: PayrollEntry[]; total: number }>();
    for (const entry of filtered) {
      if (!map.has(entry.repId)) {
        map.set(entry.repId, { repName: entry.repName, entries: [], total: 0 });
      }
      const group = map.get(entry.repId)!;
      group.entries.push(entry);
      group.total += entry.amount;
    }
    return [...map.values()].sort((a, b) => a.repName.localeCompare(b.repName));
  }, [filtered]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handlePublishOrApproveAll = useCallback(async () => {
    const target = filtered;
    const ids = target.map((e) => e.id);
    const amount = target.reduce((s, e) => s + e.amount, 0);
    const snapshot = [...payrollEntries];

    if (statusTab === 'Pending') {
      // Publish — mark as Paid
      setPayrollEntries((prev) =>
        prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Paid' } : p)),
      );
      toast(`Payroll published — ${fmt$(amount)} marked as Paid`, 'success');

      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/payroll/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Paid' }),
          }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
          }),
        ),
      );
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        setPayrollEntries(snapshot);
        toast(`${failures.length} entries failed to save — rolled back`, 'error');
      }
    }
  }, [filtered, payrollEntries, setPayrollEntries, toast, statusTab]);

  const handleStatusChange = useCallback(
    async (entry: PayrollEntry, newStatus: 'Draft' | 'Pending' | 'Paid') => {
      const snapshot = [...payrollEntries];
      setPayrollEntries((prev) =>
        prev.map((p) => (p.id === entry.id ? { ...p, status: newStatus } : p)),
      );
      setSelectedEntry(null);
      toast(`Entry moved to ${newStatus}`, 'success');

      try {
        const res = await fetch(`/api/payroll/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setPayrollEntries(snapshot);
        toast('Failed to update — rolled back', 'error');
      }
    },
    [payrollEntries, setPayrollEntries, toast],
  );

  const handleDelete = useCallback(
    async (entry: PayrollEntry) => {
      const snapshot = [...payrollEntries];
      setPayrollEntries((prev) => prev.filter((p) => p.id !== entry.id));
      setSelectedEntry(null);
      toast('Entry deleted', 'success');

      try {
        const res = await fetch(`/api/payroll/${entry.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setPayrollEntries(snapshot);
        toast('Failed to delete — rolled back', 'error');
      }
    },
    [payrollEntries, setPayrollEntries, toast],
  );

  const handleAddPayment = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!paymentForm.repId) {
        toast('Please select a rep', 'error');
        return;
      }
      const rep = reps.find((r) => r.id === paymentForm.repId);
      const newEntry: PayrollEntry = {
        id: `pay_${Date.now()}`,
        repId: paymentForm.repId,
        repName: rep?.name ?? '',
        projectId: null,
        customerName: '',
        amount: parseFloat(paymentForm.amount),
        type: paymentForm.type,
        paymentStage: paymentForm.stage as 'M1' | 'M2' | 'M3' | 'Bonus' | 'Trainer',
        status: 'Draft',
        date: paymentForm.date || new Date().toISOString().split('T')[0],
        notes: paymentForm.notes,
      };
      setPayrollEntries((prev) => [...prev, newEntry]);
      setShowAddPayment(false);
      setPaymentForm({ repId: '', amount: '', notes: '', date: '', type: 'Bonus', stage: 'Bonus' });
      toast(`Payment added for ${rep?.name ?? 'rep'} — ${fmt$(parseFloat(paymentForm.amount))}`, 'success');

      fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repId: newEntry.repId,
          amount: newEntry.amount,
          type: newEntry.type,
          paymentStage: newEntry.paymentStage,
          status: newEntry.status,
          date: newEntry.date,
          notes: newEntry.notes,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
        .catch(() => {
          setPayrollEntries((prev) => prev.filter((p) => p.id !== newEntry.id));
          toast('Failed to save payment — entry removed', 'error');
        });
    },
    [paymentForm, reps, setPayrollEntries, toast],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const STATUS_TABS: StatusTab[] = ['Draft', 'Pending', 'Paid'];

  const inputCls =
    'w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="px-5 pt-4 pb-28 space-y-8">
      <MobilePageHeader
        title="Payroll"
        right={
          <button
            onClick={() => setShowAddPayment(true)}
            className="flex items-center gap-1 min-h-[48px] px-3 py-2 rounded-2xl bg-blue-600 text-white text-sm font-medium active:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Payment
          </button>
        }
      />

      {/* ── Hero ── */}
      <div>
        <p className="text-4xl font-black text-amber-400 tabular-nums">{fmt$(pendingTotal)}</p>
        <p className="text-xs text-slate-500 mt-1">pending approval</p>
      </div>

      {/* ── Status tabs ── */}
      <div className="flex border-b border-slate-800/20">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            className={`flex-1 min-h-[48px] text-sm font-semibold transition-colors ${
              statusTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Grouped entry list ── */}
      {groupedByRep.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">No {statusTab.toLowerCase()} entries.</p>
      ) : (
        <div className="space-y-6">
          {groupedByRep.map((group) => (
            <div key={group.repName}>
              {/* Rep group header */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-base font-semibold text-white">{group.repName}</p>
                <p className="text-sm font-bold text-slate-400 tabular-nums">{fmt$(group.total)}</p>
              </div>

              {/* Entries */}
              <div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="w-full flex items-center justify-between py-3 border-b border-slate-800/20 text-left active:bg-slate-800/20 transition-colors"
                  >
                    <span className="text-sm text-white truncate mr-2">
                      {entry.customerName || (entry.type === 'Bonus' ? 'Bonus' : '--')}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold tabular-nums text-white">{fmt$(entry.amount)}</span>
                      <span className="text-xs text-slate-500">{entry.paymentStage}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Sticky bottom action ── */}
      {statusTab === 'Pending' && filtered.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-40" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={handlePublishOrApproveAll}
            className="w-full min-h-[52px] rounded-2xl bg-blue-600 text-white text-base font-semibold active:bg-blue-700 transition-colors"
          >
            Publish Payroll
          </button>
        </div>
      )}

      {statusTab === 'Draft' && filtered.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-40" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => {
              const ids = filtered.map((e) => e.id);
              setPayrollEntries((prev) =>
                prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Pending' } : p)),
              );
              toast('All draft entries moved to Pending', 'success');
              setStatusTab('Pending');
            }}
            className="w-full min-h-[52px] rounded-2xl bg-blue-600 text-white text-base font-semibold active:bg-blue-700 transition-colors"
          >
            Approve All
          </button>
        </div>
      )}

      {/* ── Entry action sheet ── */}
      <MobileBottomSheet
        open={!!selectedEntry}
        onClose={() => setSelectedEntry(null)}
        title={selectedEntry?.customerName || selectedEntry?.repName || 'Entry'}
      >
        {selectedEntry && (
          <div className="px-5 space-y-1 pb-2">
            {selectedEntry.status === 'Draft' && (
              <MobileBottomSheet.Item
                label="Approve"
                icon={Check}
                onTap={() => handleStatusChange(selectedEntry, 'Pending')}
              />
            )}
            {selectedEntry.status === 'Pending' && (
              <MobileBottomSheet.Item
                label="Mark as Paid"
                icon={Check}
                onTap={() => handleStatusChange(selectedEntry, 'Paid')}
              />
            )}
            {selectedEntry.status !== 'Paid' && (
              <>
                <MobileBottomSheet.Item
                  label="Edit Amount"
                  icon={Edit2}
                  onTap={() => {
                    setSelectedEntry(null);
                    toast('Edit not yet implemented on mobile', 'info');
                  }}
                />
                <MobileBottomSheet.Item
                  label="Delete"
                  icon={Trash2}
                  onTap={() => handleDelete(selectedEntry)}
                  danger
                />
              </>
            )}
          </div>
        )}
      </MobileBottomSheet>

      {/* ── Add Payment sheet ── */}
      <MobileBottomSheet
        open={showAddPayment}
        onClose={() => setShowAddPayment(false)}
        title="Add Payment"
      >
        <form onSubmit={handleAddPayment} className="px-5 space-y-4 pb-2">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Rep</label>
            <select
              value={paymentForm.repId}
              onChange={(e) => setPaymentForm((f) => ({ ...f, repId: e.target.value }))}
              className={`${inputCls} min-h-[48px]`}
            >
              <option value="">Select rep...</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Type</label>
            <div className="flex gap-2">
              {(['Deal', 'Bonus'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPaymentForm((f) => ({ ...f, type: t, stage: t === 'Bonus' ? 'Bonus' : 'M1' }))}
                  className={`flex-1 min-h-[48px] rounded-xl text-sm font-medium transition-colors ${paymentForm.type === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {paymentForm.type === 'Deal' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Stage</label>
              <div className="flex gap-2">
                {['M1', 'M2', 'M3', 'Trainer'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPaymentForm((f) => ({ ...f, stage: s }))}
                    className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-colors ${paymentForm.stage === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Amount</label>
            <input
              type="number"
              step="0.01"
              required
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className={`${inputCls} min-h-[48px]`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Date</label>
            <input
              type="date"
              value={paymentForm.date}
              onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))}
              className={`${inputCls} min-h-[48px]`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Notes</label>
            <input
              type="text"
              value={paymentForm.notes}
              onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional note"
              className={`${inputCls} min-h-[48px]`}
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl bg-blue-600 text-white text-sm font-semibold active:bg-blue-700 transition-colors"
          >
            Add Payment
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
