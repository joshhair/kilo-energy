'use client';

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { fmt$, todayLocalDateStr } from '../../../lib/utils';
import { useToast } from '../../../lib/toast';
import { PayrollEntry } from '../../../lib/data';
import { Check, Trash2, Plus } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';

type StatusTab = 'Draft' | 'Pending' | 'Paid';

export default function MobilePayroll() {
  const {
    payrollEntries,
    setPayrollEntries,
    markForPayroll,
    reps,
    projects,
    installerPayConfigs,
    effectiveRole,
    effectiveRepId,
  } = useApp();
  const { toast } = useToast();

  const [statusTab, setStatusTab] = useState<StatusTab>('Pending');
  const [selectedEntry, setSelectedEntry] = useState<PayrollEntry | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<PayrollEntry | null>(null);
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ repId: '', projectId: '', amount: '', notes: '', date: '', type: 'Bonus' as 'Deal' | 'Bonus' | 'Chargeback', stage: 'Bonus' as string });

  // ── Summaries ─────────────────────────────────────────────────────────────

  const pendingTotal = useMemo(() => {
    const today = todayLocalDateStr();
    return payrollEntries
      .filter((e) => e.status === 'Pending' && e.date <= today && (effectiveRole === 'admin' || e.repId === effectiveRepId))
      .reduce((s, e) => s + e.amount, 0);
  }, [payrollEntries, effectiveRole, effectiveRepId]);

  // ── Filtered entries ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const today = todayLocalDateStr();
    return payrollEntries.filter((e) =>
      e.status === statusTab &&
      (statusTab !== 'Pending' || e.date <= today) &&
      (effectiveRole === 'admin' || e.repId === effectiveRepId)
    );
  }, [payrollEntries, statusTab, effectiveRole, effectiveRepId]);

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
    const today = todayLocalDateStr();
    const target = statusTab === 'Pending'
      ? filtered.filter((e) => e.date <= today)
      : filtered;
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
      setConfirmDeleteEntry(null);
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
      const parsedAmount = parseFloat(paymentForm.amount);
      if (!paymentForm.amount || isNaN(parsedAmount) || parsedAmount <= 0) {
        toast('Enter a valid amount greater than $0', 'error');
        return;
      }
      const rep = reps.find((r) => r.id === paymentForm.repId);
      const isBonus = paymentForm.type === 'Bonus';
      const isChargeback = paymentForm.type === 'Chargeback';
      const project = !isBonus ? projects.find((p) => p.id === paymentForm.projectId) : undefined;

      if (!isBonus && paymentForm.stage === 'M3') {
        if (!paymentForm.projectId || !project) { toast('M3 payments require a linked project', 'error'); return; }
        const installerName = project.installer ?? '';
        const payPct = installerPayConfigs[installerName]?.installPayPct ?? 100;
        if (payPct >= 100) { toast('M3 payments are only allowed for installers with a partial install payment percentage (installPayPct < 100)', 'error'); return; }
      }

      // Chargebacks are stored as negative "Deal" entries (matches the
      // auto-generated shape from handleChargebacks). User enters positive;
      // we negate here.
      const raw = parseFloat(paymentForm.amount);
      const signed = isChargeback ? -raw : raw;
      const dbType = paymentForm.type === 'Bonus' ? 'Bonus' : 'Deal';
      const dbStage = paymentForm.type === 'Bonus' ? 'Bonus' : paymentForm.stage;
      const notesOut = isChargeback ? `Chargeback — manual${paymentForm.notes ? ` · ${paymentForm.notes}` : ''}` : paymentForm.notes;
      const newEntry: PayrollEntry = {
        id: `pay_${Date.now()}`,
        repId: paymentForm.repId,
        repName: rep?.name ?? '',
        projectId: isBonus ? null : (paymentForm.projectId || null),
        customerName: project?.customerName ?? '',
        amount: signed,
        type: dbType,
        paymentStage: dbStage as 'M1' | 'M2' | 'M3' | 'Bonus' | 'Trainer',
        status: 'Draft',
        date: paymentForm.date || new Date().toISOString().split('T')[0],
        notes: notesOut,
      };
      setPayrollEntries((prev) => [...prev, newEntry]);
      setShowAddPayment(false);
      setPaymentForm({ repId: '', projectId: '', amount: '', notes: '', date: '', type: 'Bonus', stage: 'Bonus' });
      const label = isChargeback ? 'Chargeback' : 'Payment';
      toast(`${label} added for ${rep?.name ?? 'rep'} — ${fmt$(Math.abs(signed))}`, 'success');

      fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repId: newEntry.repId,
          projectId: newEntry.projectId,
          customerName: newEntry.customerName,
          amount: newEntry.amount,
          type: newEntry.type,
          paymentStage: newEntry.paymentStage,
          status: newEntry.status,
          date: newEntry.date,
          notes: newEntry.notes,
          // Idempotency key: use the optimistic clientId so retries dedupe.
          idempotencyKey: newEntry.id,
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
    [paymentForm, reps, projects, installerPayConfigs, setPayrollEntries, toast],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  const STATUS_TABS: StatusTab[] = ['Draft', 'Pending', 'Paid'];

  const inputCls =
    'w-full rounded-xl px-3 py-2.5 text-base text-white focus:outline-none transition-colors';

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader
        title="Payroll"
        right={
          <button
            onClick={() => setShowAddPayment(true)}
            className="flex items-center gap-1 min-h-[48px] px-3 py-2 rounded-2xl text-black text-base font-medium active:opacity-90"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 4px 20px rgba(0,229,160,0.25)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            <Plus className="w-4 h-4" />
            Payment
          </button>
        }
      />

      {/* ── Hero ── */}
      <div>
        <p className="text-4xl font-black tabular-nums" style={{ color: '#f5a623', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(pendingTotal)}</p>
        <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>pending approval</p>
      </div>

      {/* ── Status tabs ── */}
      <div className="flex" style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            className="flex-1 min-h-[48px] text-base font-semibold transition-colors"
            style={{
              color: statusTab === tab ? '#fff' : 'var(--m-text-muted, var(--text-mobile-muted))',
              borderBottom: statusTab === tab ? '2px solid var(--m-accent, var(--accent-emerald))' : '2px solid transparent',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Grouped entry list ── */}
      {groupedByRep.length === 0 ? (
        <p className="text-base text-center py-8" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No {statusTab.toLowerCase()} entries.</p>
      ) : (
        <div className="space-y-6">
          {groupedByRep.map((group) => (
            <div key={group.repName} className="rounded-2xl p-4" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
              {/* Rep group header */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-base font-semibold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{group.repName}</p>
                <p className="text-lg font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(group.total)}</p>
              </div>

              {/* Entries */}
              <div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="w-full flex items-center justify-between py-3 text-left active:opacity-80 transition-colors"
                    style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}
                  >
                    <span className="text-base text-white truncate mr-2" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.customerName || (entry.type === 'Bonus' ? 'Bonus' : '--')}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className="text-lg font-bold tabular-nums"
                        style={{
                          color: entry.amount < 0 ? 'var(--accent-red, #ef4444)' : '#fff',
                          fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                        }}
                      >{fmt$(entry.amount)}</span>
                      <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{entry.paymentStage}</span>
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
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-90 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 4px 20px rgba(0,229,160,0.3)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Publish Payroll
          </button>
        </div>
      )}

      {statusTab === 'Draft' && filtered.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-40" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => setShowApproveAllConfirm(true)}
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-90 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 4px 20px rgba(0,229,160,0.25)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Approve All
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showApproveAllConfirm}
        title="Approve All Draft Entries"
        message={`Move all ${filtered.length} draft ${filtered.length === 1 ? 'entry' : 'entries'} to Pending? This will queue them for the next payroll run.`}
        confirmLabel="Approve All"
        onConfirm={async () => {
          setShowApproveAllConfirm(false);
          const ids = filtered.map((e) => e.id);
          try {
            await markForPayroll(ids);
            setPayrollEntries((prev) =>
              prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Pending' } : p)),
            );
            toast('All draft entries moved to Pending', 'success');
            setStatusTab('Pending');
          } catch {
            toast('Failed to approve entries', 'error');
          }
        }}
        onClose={() => setShowApproveAllConfirm(false)}
      />

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
              <>
                <MobileBottomSheet.Item
                  label="Mark as Paid"
                  icon={Check}
                  onTap={() => handleStatusChange(selectedEntry, 'Paid')}
                />
                {/* Reverse Pending → Draft — lets admin pull an entry out of
                    the current batch before publish. Matches desktop parity. */}
                <MobileBottomSheet.Item
                  label="Move back to Draft"
                  icon={Check}
                  onTap={() => handleStatusChange(selectedEntry, 'Draft')}
                />
              </>
            )}
            {selectedEntry.status !== 'Paid' && (
              <>
                <MobileBottomSheet.Item
                  label="Delete"
                  icon={Trash2}
                  onTap={() => setConfirmDeleteEntry(selectedEntry)}
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
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep</label>
            <select
              value={paymentForm.repId}
              onChange={(e) => setPaymentForm((f) => ({ ...f, repId: e.target.value }))}
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              <option value="">Select rep...</option>
              {reps.filter((r) => r.active !== false).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Type</label>
            <div className="flex gap-2">
              {(['Deal', 'Bonus', 'Chargeback'] as const).map((t) => {
                const selected = paymentForm.type === t;
                const isChargebackBtn = t === 'Chargeback';
                const nextStage = t === 'Bonus' ? 'Bonus' : paymentForm.stage && paymentForm.stage !== 'Bonus' ? paymentForm.stage : 'M1';
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPaymentForm((f) => ({ ...f, type: t, stage: nextStage }))}
                    className="flex-1 min-h-[48px] rounded-xl text-sm font-medium transition-colors"
                    style={{
                      background: selected ? (isChargebackBtn ? 'var(--accent-red, #ef4444)' : 'var(--accent-emerald)') : 'var(--m-card, var(--surface-mobile-card))',
                      color: selected ? (isChargebackBtn ? '#fff' : '#000') : 'var(--m-text-muted, var(--text-mobile-muted))',
                      border: selected ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                      fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {paymentForm.type === 'Chargeback' && (
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Positive dollar amount. Stored as a negative Draft entry — admin controls when it hits payroll.</p>
            )}
          </div>
          {(paymentForm.type === 'Deal' || paymentForm.type === 'Chargeback') && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Stage</label>
              <div className="flex gap-2">
                {['M1', 'M2', 'M3'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPaymentForm((f) => ({ ...f, stage: s }))}
                    className="flex-1 min-h-[44px] rounded-xl text-base font-medium transition-colors"
                    style={{
                      background: paymentForm.stage === s ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                      color: paymentForm.stage === s ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                      border: paymentForm.stage === s ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                      fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(paymentForm.type === 'Deal' || paymentForm.type === 'Chargeback') && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Project</label>
              <select
                value={paymentForm.projectId}
                onChange={(e) => setPaymentForm((f) => ({ ...f, projectId: e.target.value }))}
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                <option value="">Select project...</option>
                {projects
                  .filter((p) => !paymentForm.repId || p.repId === paymentForm.repId || p.setterId === paymentForm.repId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.customerName}</option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
            <input
              type="number"
              step="0.01"
              required
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
            <input
              type="date"
              value={paymentForm.date}
              onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))}
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</label>
            <input
              type="text"
              value={paymentForm.notes}
              onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional note"
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-90 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 4px 20px rgba(0,229,160,0.25)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Add Payment
          </button>
        </form>
      </MobileBottomSheet>

      <ConfirmDialog
        open={!!confirmDeleteEntry}
        title="Delete Entry"
        message={confirmDeleteEntry
          ? `Delete this entry?\n\n${confirmDeleteEntry.type === 'Bonus' ? `${confirmDeleteEntry.repName} — Bonus $${confirmDeleteEntry.amount.toFixed(2)}` : `${confirmDeleteEntry.repName} — ${confirmDeleteEntry.paymentStage} $${confirmDeleteEntry.amount.toFixed(2)}`}\n\nThis cannot be undone.`
          : ''}
        confirmLabel="Delete"
        onConfirm={() => confirmDeleteEntry && handleDelete(confirmDeleteEntry)}
        onClose={() => setConfirmDeleteEntry(null)}
      />
    </div>
  );
}
