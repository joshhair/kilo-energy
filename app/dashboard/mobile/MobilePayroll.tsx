'use client';

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { useToast } from '../../../lib/toast';
import { PayrollEntry } from '../../../lib/data';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileSection from './shared/MobileSection';
import MobileBadge from './shared/MobileBadge';
import MobileBottomSheet from './shared/MobileBottomSheet';
import { Check, Edit2, Trash2, Plus, ChevronDown, ChevronUp, Search } from 'lucide-react';

type StatusFilter = 'All' | 'Draft' | 'Pending' | 'Paid';
type TypeTab = 'Deal' | 'Bonus';

export default function MobilePayroll() {
  const {
    payrollEntries,
    setPayrollEntries,
    markForPayroll,
    reps,
    projects,
    currentRole,
  } = useApp();
  const { toast } = useToast();

  const [typeTab, setTypeTab] = useState<TypeTab>('Deal');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [filterRepId, setFilterRepId] = useState('');
  const [repSearchQuery, setRepSearchQuery] = useState('');
  const [repDropdownOpen, setRepDropdownOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBonusSheet, setShowBonusSheet] = useState(false);
  const [bonusForm, setBonusForm] = useState({ repId: '', amount: '', notes: '', date: '' });

  // ── Summaries ─────────────────────────────────────────────────────────────

  const draftTotal = useMemo(
    () => payrollEntries.filter((e) => e.status === 'Draft').reduce((s, e) => s + e.amount, 0),
    [payrollEntries],
  );
  const draftCount = useMemo(
    () => payrollEntries.filter((e) => e.status === 'Draft').length,
    [payrollEntries],
  );
  const pendingTotal = useMemo(
    () => payrollEntries.filter((e) => e.status === 'Pending').reduce((s, e) => s + e.amount, 0),
    [payrollEntries],
  );
  const pendingCount = useMemo(
    () => payrollEntries.filter((e) => e.status === 'Pending').length,
    [payrollEntries],
  );
  const paidTotal = useMemo(
    () => payrollEntries.filter((e) => e.status === 'Paid').reduce((s, e) => s + e.amount, 0),
    [payrollEntries],
  );

  // ── Filtered entries ──────────────────────────────────────────────────────

  const filtered = useMemo(
    () =>
      payrollEntries.filter((e) => {
        if (e.type !== typeTab) return false;
        if (statusFilter !== 'All' && e.status !== statusFilter) return false;
        if (filterRepId && e.repId !== filterRepId) return false;
        return true;
      }),
    [payrollEntries, typeTab, statusFilter, filterRepId],
  );

  const hasPendingEntries = useMemo(
    () => filtered.some((e) => e.status === 'Pending'),
    [filtered],
  );

  // ── Rep dropdown options ──────────────────────────────────────────────────

  const repOptions = useMemo(() => {
    const q = repSearchQuery.toLowerCase();
    return reps.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [reps, repSearchQuery]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    const pendingVisible = filtered.filter((e) => e.status === 'Pending');
    const ids = pendingVisible.map((e) => e.id);
    const amount = pendingVisible.reduce((s, e) => s + e.amount, 0);
    const snapshot = [...payrollEntries];

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
  }, [filtered, payrollEntries, setPayrollEntries, toast]);

  const handleStatusChange = useCallback(
    async (entry: PayrollEntry, newStatus: 'Draft' | 'Pending' | 'Paid') => {
      const snapshot = [...payrollEntries];
      setPayrollEntries((prev) =>
        prev.map((p) => (p.id === entry.id ? { ...p, status: newStatus } : p)),
      );
      setExpandedId(null);
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
      setExpandedId(null);
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

  const handleAddBonus = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!bonusForm.repId) {
        toast('Please select a rep', 'error');
        return;
      }
      const rep = reps.find((r) => r.id === bonusForm.repId);
      const newEntry: PayrollEntry = {
        id: `pay_${Date.now()}`,
        repId: bonusForm.repId,
        repName: rep?.name ?? '',
        projectId: null,
        customerName: '',
        amount: parseFloat(bonusForm.amount),
        type: 'Bonus',
        paymentStage: 'Bonus',
        status: 'Draft',
        date: bonusForm.date || new Date().toISOString().split('T')[0],
        notes: bonusForm.notes,
      };
      setPayrollEntries((prev) => [...prev, newEntry]);
      setShowBonusSheet(false);
      setBonusForm({ repId: '', amount: '', notes: '', date: '' });
      setTypeTab('Bonus');
      setStatusFilter('All');
      toast(`Bonus added for ${rep?.name ?? 'rep'} — ${fmt$(parseFloat(bonusForm.amount))}`, 'success');

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
          toast('Failed to save bonus — entry removed', 'error');
        });
    },
    [bonusForm, reps, setPayrollEntries, toast],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const STATUS_PILLS: StatusFilter[] = ['All', 'Draft', 'Pending', 'Paid'];

  const selectedRepName = filterRepId
    ? reps.find((r) => r.id === filterRepId)?.name ?? 'Unknown'
    : 'All Reps';

  const inputCls =
    'w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="px-5 pt-3 pb-24 space-y-8">
      <MobilePageHeader
        title="Payroll"
        right={typeTab === 'Bonus' ? (
          <button
            onClick={() => setShowBonusSheet(true)}
            className="flex items-center gap-1 min-h-[44px] px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium active:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Bonus
          </button>
        ) : null}
      />

      {/* Type tab bar */}
      <div className="flex border-b border-slate-800">
        {(['Deal', 'Bonus'] as TypeTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTypeTab(tab)}
            className={`flex-1 min-h-[40px] text-base font-medium pb-2 transition-colors ${
              typeTab === tab
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-500'
            }`}
          >
            {tab} Payments
          </button>
        ))}
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent" />

      {/* Status filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-5 px-5 no-scrollbar">
        {STATUS_PILLS.map((pill) => (
          <button
            key={pill}
            onClick={() => setStatusFilter(pill)}
            className={`shrink-0 min-h-[36px] px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              statusFilter === pill
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {pill}
          </button>
        ))}
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent" />

      {/* Summary card */}
      <MobileCard>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400 tracking-wide">Draft</span>
            <span className="text-lg font-black text-white tabular-nums">
              {fmt$(Math.round(draftTotal))}{' '}
              <span className="text-slate-500 text-xs">({draftCount})</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400 tracking-wide">Pending</span>
            <span className="text-lg font-black text-amber-300 tabular-nums">
              {fmt$(Math.round(pendingTotal))}{' '}
              <span className="text-slate-500 text-xs">({pendingCount})</span>
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/60 pt-2">
            <span className="text-sm text-slate-400 tracking-wide">Total Paid</span>
            <span className="text-lg font-black text-emerald-400 tabular-nums">
              {fmt$(Math.round(paidTotal))}
            </span>
          </div>
        </div>
      </MobileCard>

      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent" />

      {/* Rep filter dropdown */}
      <div className="relative">
        <button
          onClick={() => setRepDropdownOpen(!repDropdownOpen)}
          className="w-full min-h-[44px] flex items-center justify-between px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white"
        >
          <span className={filterRepId ? 'text-white' : 'text-slate-400'}>
            {selectedRepName}
          </span>
          {repDropdownOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
        </button>
        {repDropdownOpen && (
          <div className="absolute z-50 mt-1 left-0 right-0 max-h-64 overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
            <div className="sticky top-0 p-2 bg-slate-900 border-b border-slate-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={repSearchQuery}
                  onChange={(e) => setRepSearchQuery(e.target.value)}
                  placeholder="Search reps..."
                  className="w-full min-h-[40px] pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={() => {
                setFilterRepId('');
                setRepDropdownOpen(false);
                setRepSearchQuery('');
              }}
              className="w-full min-h-[44px] px-4 py-3 text-left text-sm text-slate-400 hover:bg-slate-800 active:bg-slate-800"
            >
              All Reps
            </button>
            {repOptions.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setFilterRepId(r.id);
                  setRepDropdownOpen(false);
                  setRepSearchQuery('');
                }}
                className={`w-full min-h-[44px] px-4 py-3 text-left text-sm active:bg-slate-800 ${
                  filterRepId === r.id ? 'text-blue-400 bg-blue-500/10' : 'text-white hover:bg-slate-800'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent" />

      {/* Entry cards */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <MobileCard>
            <p className="text-sm text-slate-500 text-center py-4">No entries found.</p>
          </MobileCard>
        ) : (
          filtered.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const borderColor = entry.status === 'Paid' ? 'border-l-emerald-500' : entry.status === 'Pending' ? 'border-l-amber-500' : 'border-l-slate-600';
            return (
              <MobileCard key={entry.id} className={`border-l-[3px] ${borderColor}`}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full text-left active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-white truncate">
                      {entry.repName}
                    </span>
                    <span className="text-base font-bold text-emerald-400 tabular-nums">
                      {fmt$(entry.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-sm text-slate-500 truncate">
                      {entry.type === 'Deal' ? entry.customerName || '—' : entry.notes || '—'}
                    </span>
                    <MobileBadge
                      value={entry.paymentStage}
                      variant="status"
                    />
                  </div>
                </button>

                {/* Expanded actions */}
                {isExpanded && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800/60">
                    {entry.status === 'Draft' && (
                      <button
                        onClick={() => handleStatusChange(entry, 'Pending')}
                        className="flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg bg-amber-600/20 text-amber-300 text-xs font-medium active:bg-amber-600/30"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    )}
                    {entry.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => handleStatusChange(entry, 'Paid')}
                          className="flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg bg-emerald-600/20 text-emerald-300 text-xs font-medium active:bg-emerald-600/30"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Pay
                        </button>
                        <button
                          onClick={() => handleStatusChange(entry, 'Draft')}
                          className="flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg bg-slate-700/40 text-slate-300 text-xs font-medium active:bg-slate-700/60"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Revert
                        </button>
                      </>
                    )}
                    {entry.status !== 'Paid' && (
                      <button
                        onClick={() => handleDelete(entry)}
                        className="flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg bg-red-600/20 text-red-300 text-xs font-medium active:bg-red-600/30 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </MobileCard>
            );
          })
        )}
      </div>

      {/* Sticky bottom — Publish Payroll */}
      {hasPendingEntries && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-40" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={handlePublish}
            className="w-full min-h-[52px] rounded-xl bg-blue-600 text-white text-base font-semibold active:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
          >
            Publish Payroll
          </button>
        </div>
      )}

      {/* Add Bonus Bottom Sheet */}
      <MobileBottomSheet
        open={showBonusSheet}
        onClose={() => setShowBonusSheet(false)}
        title="Add Bonus"
      >
        <form onSubmit={handleAddBonus} className="px-5 space-y-4 pb-2">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Rep
            </label>
            <select
              value={bonusForm.repId}
              onChange={(e) => setBonusForm((f) => ({ ...f, repId: e.target.value }))}
              className={`${inputCls} min-h-[44px]`}
            >
              <option value="">Select rep...</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Amount
            </label>
            <input
              type="number"
              step="0.01"
              required
              value={bonusForm.amount}
              onChange={(e) => setBonusForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className={`${inputCls} min-h-[44px]`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Date
            </label>
            <input
              type="date"
              value={bonusForm.date}
              onChange={(e) => setBonusForm((f) => ({ ...f, date: e.target.value }))}
              className={`${inputCls} min-h-[44px]`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Notes
            </label>
            <input
              type="text"
              value={bonusForm.notes}
              onChange={(e) => setBonusForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional note"
              className={`${inputCls} min-h-[44px]`}
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-semibold active:bg-blue-700 transition-colors"
          >
            Add Bonus
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
