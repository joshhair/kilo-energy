'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, todayLocalDateStr } from '../../../lib/utils';
import { breakdownByType, type StatusBreakdown } from '../../../lib/aggregators';
import { useToast } from '../../../lib/toast';
import { PayrollEntry, Reimbursement } from '../../../lib/data';
import { Check, Trash2, Plus, Pencil, X, Receipt, Archive, ArchiveRestore } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';

type StatusTab = 'Draft' | 'Pending' | 'Paid';
type TypeTab = 'Deal' | 'Bonus' | 'Trainer';
type PageView = 'payroll' | 'reimbursements';
type ReimFilterStatus = 'All' | 'Pending' | 'Approved' | 'Denied';

// Classifies a PayrollEntry into one of the three type tabs. Trainer
// overrides are stored as type='Deal' + paymentStage='Trainer' in the
// DB — we surface them under their own tab. Mirrors the desktop helper
// in app/dashboard/payroll/page.tsx (2026-04-23).
function entryTypeTab(entry: { type?: string; paymentStage?: string }): TypeTab {
  if (entry.paymentStage === 'Trainer') return 'Trainer';
  if (entry.type === 'Bonus') return 'Bonus';
  return 'Deal';
}

export default function MobilePayroll() {
  const {
    payrollEntries,
    setPayrollEntries,
    markForPayroll,
    persistPayrollEntry,
    reps,
    projects,
    installerPayConfigs,
    reimbursements,
    setReimbursements,
    effectiveRole,
    effectiveRepId,
  } = useApp();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Hydrate initial tab state from the URL so a refresh on
  // /dashboard/payroll?view=reimbursements&status=Paid&type=Bonus
  // lands on the same view. Matches desktop pattern shipped 2026-04-23.
  const initialStatus = (searchParams.get('status') ?? 'Draft') as StatusTab;
  const initialType = (searchParams.get('type') ?? 'Deal') as TypeTab;
  const initialView = (searchParams.get('view') === 'reimbursements' ? 'reimbursements' : 'payroll') as PageView;

  const [pageView, setPageView] = useState<PageView>(initialView);
  const [statusTab, setStatusTab] = useState<StatusTab>(['Draft', 'Pending', 'Paid'].includes(initialStatus) ? initialStatus : 'Draft');
  const [typeTab, setTypeTab] = useState<TypeTab>(['Deal', 'Bonus', 'Trainer'].includes(initialType) ? initialType : 'Deal');
  const [selectedEntry, setSelectedEntry] = useState<PayrollEntry | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<PayrollEntry | null>(null);
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ repId: '', projectId: '', amount: '', notes: '', date: '', type: 'Bonus' as 'Deal' | 'Bonus' | 'Chargeback', stage: 'Bonus' as string });
  const [editingEntry, setEditingEntry] = useState<PayrollEntry | null>(null);
  const [editEntryForm, setEditEntryForm] = useState({ amount: '', date: '', notes: '' });

  // ── Admin filters ─────────────────────────────────────────────────────────
  const [filterRepId, setFilterRepId] = useState(searchParams.get('rep') ?? '');
  const [filterFrom, setFilterFrom] = useState(searchParams.get('from') ?? '');
  const [filterTo, setFilterTo] = useState(searchParams.get('to') ?? '');

  // Sync state → URL. Only non-default values are written so the
  // querystring stays clean.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (statusTab !== 'Draft') params.set('status', statusTab); else params.delete('status');
    if (typeTab !== 'Deal') params.set('type', typeTab); else params.delete('type');
    if (pageView === 'reimbursements') params.set('view', 'reimbursements'); else params.delete('view');
    if (filterRepId) params.set('rep', filterRepId); else params.delete('rep');
    if (filterFrom) params.set('from', filterFrom); else params.delete('from');
    if (filterTo) params.set('to', filterTo); else params.delete('to');
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `?${next}` : '?', { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab, typeTab, pageView, filterRepId, filterFrom, filterTo]);

  // ── Reimbursements state ──────────────────────────────────────────────────
  const [reimFilterStatus, setReimFilterStatus] = useState<ReimFilterStatus>('Pending');
  const [showArchivedReim, setShowArchivedReim] = useState<boolean | 'only'>(false);
  const [selectedReim, setSelectedReim] = useState<Reimbursement | null>(null);
  const [confirmDeleteReim, setConfirmDeleteReim] = useState<Reimbursement | null>(null);
  const [processingReimIds, setProcessingReimIds] = useState<Set<string>>(new Set());

  // ── Reimbursement derived state ───────────────────────────────────────────

  const pendingReimCount = useMemo(
    () => reimbursements.filter((r) => r.status === 'Pending').length,
    [reimbursements],
  );

  const filteredReimbursements = useMemo(() => {
    return reimbursements.filter((r) => {
      if (!showArchivedReim && r.archivedAt) return false;
      if (showArchivedReim === 'only' && !r.archivedAt) return false;
      if (reimFilterStatus !== 'All' && r.status !== reimFilterStatus) return false;
      return true;
    });
  }, [reimbursements, showArchivedReim, reimFilterStatus]);

  // ── Reimbursement handlers ────────────────────────────────────────────────

  const patchReim = useCallback(
    (reim: Reimbursement, updates: Partial<{ status: Reimbursement['status']; archived: boolean }>, successMsg: string, rollback: Partial<Reimbursement>) => {
      if (processingReimIds.has(reim.id)) return;
      setProcessingReimIds((prev) => new Set(prev).add(reim.id));
      const optimistic: Partial<Reimbursement> = {};
      if (updates.status) optimistic.status = updates.status;
      if (updates.archived !== undefined) optimistic.archivedAt = updates.archived ? new Date().toISOString() : undefined;
      setReimbursements((prev) => prev.map((x) => x.id === reim.id ? { ...x, ...optimistic } : x));
      setSelectedReim(null);
      fetch(`/api/reimbursements/${reim.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
        .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(successMsg, 'success'); })
        .catch(() => { toast('Failed to persist change', 'error'); setReimbursements((prev) => prev.map((x) => x.id === reim.id ? { ...x, ...rollback } : x)); })
        .finally(() => setProcessingReimIds((prev) => { const s = new Set(prev); s.delete(reim.id); return s; }));
    },
    [processingReimIds, setReimbursements, toast],
  );

  const handleDeleteReim = useCallback(
    async (reim: Reimbursement) => {
      const snapshot = [...reimbursements];
      setReimbursements((prev) => prev.filter((x) => x.id !== reim.id));
      setConfirmDeleteReim(null);
      toast('Reimbursement deleted', 'success');
      try {
        const res = await fetch(`/api/reimbursements/${reim.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setReimbursements(snapshot);
        toast('Failed to delete — rolled back', 'error');
      }
    },
    [reimbursements, setReimbursements, toast],
  );

  // ── Summaries ─────────────────────────────────────────────────────────────

  const pendingTotal = useMemo(() => {
    const today = todayLocalDateStr();
    return payrollEntries
      .filter((e) => e.status === 'Pending' && entryTypeTab(e) === typeTab && e.date <= today && (effectiveRole === 'admin' || e.repId === effectiveRepId))
      .reduce((s, e) => s + e.amount, 0);
  }, [payrollEntries, typeTab, effectiveRole, effectiveRepId]);

  // Combined breakdowns across ALL types (Deal + Bonus + Trainer) for
  // the summary cards row. Cards stay honest about the total owed;
  // the type tab below still filters the row list for drill-down.
  // Mirrors the desktop payroll tab pattern (2026-04-23).
  const { draftBreakdown, pendingBreakdown, paidBreakdown } = useMemo(() => {
    const today = todayLocalDateStr();
    const scope = payrollEntries.filter(
      (e) => (effectiveRole === 'admin' || e.repId === effectiveRepId) &&
             (!filterRepId || e.repId === filterRepId) &&
             (!filterFrom || e.date >= filterFrom) &&
             (!filterTo || e.date <= filterTo),
    );
    return {
      draftBreakdown: breakdownByType(scope, 'Draft', { asOf: today }),
      pendingBreakdown: breakdownByType(scope, 'Pending', { asOf: today }),
      paidBreakdown: breakdownByType(scope, 'Paid', { asOf: today }),
    };
  }, [payrollEntries, effectiveRole, effectiveRepId, filterRepId, filterFrom, filterTo]);

  // ── Filtered entries ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const today = todayLocalDateStr();
    return payrollEntries.filter((e) =>
      e.status === statusTab &&
      entryTypeTab(e) === typeTab &&
      (statusTab !== 'Paid' || e.date <= today) &&
      (effectiveRole === 'admin' || e.repId === effectiveRepId) &&
      (!filterRepId || e.repId === filterRepId) &&
      (!filterFrom || e.date >= filterFrom) &&
      (!filterTo || e.date <= filterTo)
    );
  }, [payrollEntries, statusTab, typeTab, effectiveRole, effectiveRepId, filterRepId, filterFrom, filterTo]);

  // ── CTA bar animation ─────────────────────────────────────────────────────
  const shouldShowCta = (statusTab === 'Pending' || statusTab === 'Draft') && filtered.length > 0;
  const [ctaMounted, setCtaMounted] = useState(shouldShowCta);
  const [ctaExiting, setCtaExiting] = useState(false);
  useEffect(() => {
    if (shouldShowCta) {
      setCtaExiting(false);
      setCtaMounted(true);
    } else {
      setCtaExiting(true);
      const t = setTimeout(() => setCtaMounted(false), 210);
      return () => clearTimeout(t);
    }
  }, [shouldShowCta]);

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
      ? filtered.filter((e) => e.status === 'Pending' && e.date <= today)
      : filtered;
    const ids = target.map((e) => e.id);
    const amount = target.reduce((s, e) => s + e.amount, 0);
    const snapshot = [...payrollEntries];

    if (statusTab === 'Pending') {
      // Publish — mark as Paid
      setPayrollEntries((prev) =>
        prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Paid' } : p)),
      );
      setStatusTab('Paid');
      toast(`Payroll published — ${fmt$(amount)} marked as Paid`, 'success');

      try {
        const res = await fetch('/api/payroll', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, status: 'Paid' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setPayrollEntries(snapshot);
        toast('Payroll failed to save — rolled back', 'error');
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
        date: paymentForm.date || todayLocalDateStr(),
        notes: notesOut,
      };
      setPayrollEntries((prev) => [...prev, newEntry]);
      setShowAddPayment(false);
      setPaymentForm({ repId: '', projectId: '', amount: '', notes: '', date: '', type: 'Bonus', stage: 'Bonus' });
      const label = isChargeback ? 'Chargeback' : 'Payment';
      toast(`${label} added for ${rep?.name ?? 'rep'} — ${fmt$(Math.abs(signed))}`, 'success');

      persistPayrollEntry(newEntry);
    },
    [paymentForm, reps, projects, installerPayConfigs, setPayrollEntries, persistPayrollEntry, toast],
  );

  const openEditEntry = useCallback((entry: PayrollEntry) => {
    if (entry.status === 'Paid') { toast('Paid entries cannot be edited — add a negative adjustment entry instead', 'error'); return; }
    setEditEntryForm({ amount: String(entry.amount), date: entry.date, notes: entry.notes ?? '' });
    setSelectedEntry(null);
    setEditingEntry(entry);
  }, [toast]);

  const handleSaveEditEntry = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    const amt = parseFloat(editEntryForm.amount);
    const isChargebackEntry = editingEntry.amount < 0;
    if (!Number.isFinite(amt) || amt === 0 || (isChargebackEntry ? amt > 0 : amt < 0)) {
      toast(isChargebackEntry ? 'Chargeback amount must be negative' : 'Amount must be greater than $0', 'error');
      return;
    }
    if (!editEntryForm.date) { toast('Date is required', 'error'); return; }
    const snapshot = editingEntry;
    const patch = { amount: amt, date: editEntryForm.date, notes: editEntryForm.notes };
    setPayrollEntries((prev) => prev.map((p) => p.id === editingEntry.id ? { ...p, ...patch } : p));
    setEditingEntry(null);
    toast('Entry updated', 'success');
    try {
      const res = await fetch(`/api/payroll/${snapshot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setPayrollEntries((prev) => prev.map((p) => p.id === snapshot.id ? snapshot : p));
      toast('Failed to save — reverting', 'error');
    }
  }, [editingEntry, editEntryForm, setPayrollEntries, toast]);

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
          pageView === 'payroll' ? (
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
          ) : null
        }
      />

      {/* ── Page view tabs (admin only) ── */}
      {effectiveRole === 'admin' && (
        <div className="flex gap-2">
          {(['payroll', 'reimbursements'] as PageView[]).map((v) => (
            <button
              key={v}
              onClick={() => setPageView(v)}
              className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold capitalize transition-colors relative"
              style={{
                background: pageView === v ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                color: pageView === v ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                border: pageView === v ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {v}
              {v === 'reimbursements' && pendingReimCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--accent-amber)', color: '#000' }}
                >
                  {pendingReimCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Reimbursements view ── */}
      {pageView === 'reimbursements' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={reimFilterStatus}
              onChange={(e) => setReimFilterStatus(e.target.value as ReimFilterStatus)}
              className="flex-1 min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Denied">Denied</option>
              <option value="All">All</option>
            </select>
            <select
              value={showArchivedReim === 'only' ? 'only' : showArchivedReim ? 'all' : 'active'}
              onChange={(e) => setShowArchivedReim(e.target.value === 'only' ? 'only' : e.target.value === 'all' ? true : false)}
              className="flex-1 min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              <option value="active">Active only</option>
              <option value="all">Inc. archived</option>
              <option value="only">Archived only</option>
            </select>
          </div>

          {/* List */}
          {filteredReimbursements.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Receipt className="w-10 h-10" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
              <p className="text-sm font-semibold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                {reimbursements.length === 0 ? 'No reimbursement requests' : 'No requests match filters'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReimbursements.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedReim(r)}
                  className="w-full rounded-2xl p-4 text-left active:opacity-80 transition-colors"
                  style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{r.repName}</p>
                      <p className="text-sm truncate mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{r.description}</p>
                      {r.archivedAt && (
                        <p className="text-[11px] mt-0.5 uppercase tracking-wider" style={{ color: 'var(--m-text-dim, var(--text-dim))' }}>archived</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-green)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${r.amount.toFixed(2)}</p>
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={
                          r.status === 'Approved'
                            ? { background: 'rgba(0,224,122,0.15)', color: 'var(--accent-green)' }
                            : r.status === 'Denied'
                            ? { background: 'rgba(239,68,68,0.15)', color: '#ef4444' }
                            : { background: 'rgba(255,176,32,0.15)', color: 'var(--accent-amber)' }
                        }
                      >
                        {r.status}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reimbursement action sheet ── */}
      <MobileBottomSheet
        open={!!selectedReim}
        onClose={() => setSelectedReim(null)}
        title={selectedReim ? `${selectedReim.repName} — $${selectedReim.amount.toFixed(2)}` : ''}
      >
        {selectedReim && (
          <div className="px-5 space-y-1 pb-2">
            {selectedReim.status === 'Pending' && (
              <>
                <MobileBottomSheet.Item
                  label="Approve"
                  icon={Check}
                  onTap={() => patchReim(selectedReim, { status: 'Approved' }, `Approved for ${selectedReim.repName}`, { status: 'Pending' })}
                />
                <MobileBottomSheet.Item
                  label="Deny"
                  icon={X}
                  onTap={() => patchReim(selectedReim, { status: 'Denied' }, `Denied for ${selectedReim.repName}`, { status: 'Pending' })}
                  danger
                />
              </>
            )}
            {(selectedReim.status === 'Approved' || selectedReim.status === 'Denied') && (
              <MobileBottomSheet.Item
                label="Reset to Pending"
                icon={Receipt}
                onTap={() => patchReim(selectedReim, { status: 'Pending' }, 'Reset to Pending', { status: selectedReim.status })}
              />
            )}
            {!selectedReim.archivedAt ? (
              <MobileBottomSheet.Item
                label="Archive"
                icon={Archive}
                onTap={() => patchReim(selectedReim, { archived: true }, 'Reimbursement archived', { archivedAt: undefined })}
              />
            ) : (
              <MobileBottomSheet.Item
                label="Unarchive"
                icon={ArchiveRestore}
                onTap={() => patchReim(selectedReim, { archived: false }, 'Reimbursement unarchived', { archivedAt: selectedReim.archivedAt })}
              />
            )}
            <MobileBottomSheet.Item
              label="Delete"
              icon={Trash2}
              onTap={() => { setSelectedReim(null); setConfirmDeleteReim(selectedReim); }}
              danger
            />
          </div>
        )}
      </MobileBottomSheet>

      <ConfirmDialog
        open={!!confirmDeleteReim}
        title="Delete Reimbursement"
        message={confirmDeleteReim ? `Delete this reimbursement request?\n\n${confirmDeleteReim.repName} — ${confirmDeleteReim.description} $${confirmDeleteReim.amount.toFixed(2)}\n\nThis cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={() => confirmDeleteReim && handleDeleteReim(confirmDeleteReim)}
        onClose={() => setConfirmDeleteReim(null)}
      />

      {/* ── Payroll view ── */}
      {pageView === 'payroll' && (
      <div className="space-y-4">

      {/* ── Summary cards ── combined across Deal + Bonus + Trainer
          so admins see everything owed at a glance. Sub-lines break
          down by type. Mirrors the desktop payroll tab (2026-04-23). */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Draft" total={draftBreakdown.total} tone="#4d9fff" breakdown={draftBreakdown} pending />
        <SummaryCard label="Pending" total={pendingBreakdown.total} tone="#f5a623" breakdown={pendingBreakdown} pending />
        <SummaryCard label="Paid" total={paidBreakdown.total} tone="var(--accent-emerald)" breakdown={paidBreakdown} />
      </div>
      {pendingTotal > 0 && (
        <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {fmt$(pendingTotal)} pending · {typeTab}
        </p>
      )}

      {/* ── Type + Status tabs (sticky) ── */}
      <div
        className="sticky z-20 -mx-5 px-5 pt-2 space-y-2"
        style={{
          top: 0,
          background: 'rgba(8, 12, 24, 0.88)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--m-border, var(--border-mobile))',
          paddingBottom: '8px',
        }}
      >
        <div className="flex gap-2">
          {(['Deal', 'Bonus', 'Trainer'] as TypeTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeTab(t)}
              className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold transition-colors"
              style={{
                background: typeTab === t ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                color: typeTab === t ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                border: typeTab === t ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {t}
            </button>
          ))}
        </div>

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
      </div>

      {/* ── Admin filters ── */}
      {effectiveRole === 'admin' && (
        <div className="space-y-2">
          <select
            value={filterRepId}
            onChange={(e) => setFilterRepId(e.target.value)}
            className="w-full min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
            style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: filterRepId ? 'var(--text-primary)' : 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <option value="">All Reps</option>
            {reps.filter((r) => r.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="flex-1 min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: filterFrom ? 'var(--text-primary)' : 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="flex-1 min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
              style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: filterTo ? 'var(--text-primary)' : 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
            {(filterFrom || filterTo) && (
              <button
                onClick={() => { setFilterFrom(''); setFilterTo(''); }}
                className="min-h-[44px] px-3 rounded-xl text-sm"
                style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

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
      {ctaMounted && (
        <div
          className={`fixed bottom-0 left-0 right-0 p-4 z-40 ${ctaExiting ? 'cta-bar-exit' : 'cta-bar-enter'}`}
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={() => statusTab === 'Pending' ? setShowPublishConfirm(true) : setShowApproveAllConfirm(true)}
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-90 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 4px 20px rgba(0,229,160,0.3)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {statusTab === 'Pending' ? `Publish ${typeTab} Payroll` : 'Approve All'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showPublishConfirm}
        title="Publish Payroll?"
        message={`This will mark ${filtered.filter((e) => e.date <= todayLocalDateStr()).length} pending ${typeTab.toLowerCase()} ${filtered.filter((e) => e.date <= todayLocalDateStr()).length === 1 ? 'entry' : 'entries'} as Paid. This action cannot be undone.`}
        confirmLabel="Publish Payroll"
        onConfirm={() => { setShowPublishConfirm(false); handlePublishOrApproveAll(); }}
        onClose={() => setShowPublishConfirm(false)}
      />

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
                  label="Edit Entry"
                  icon={Pencil}
                  onTap={() => openEditEntry(selectedEntry)}
                />
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
                  .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
                  .filter((p) => !paymentForm.repId || p.repId === paymentForm.repId || p.setterId === paymentForm.repId || p.additionalClosers?.some((c) => c.userId === paymentForm.repId) || p.additionalSetters?.some((s) => s.userId === paymentForm.repId))
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

      {/* ── Edit Entry sheet ── */}
      <MobileBottomSheet
        open={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit Entry"
      >
        {editingEntry && (
          <form onSubmit={handleSaveEditEntry} className="px-5 space-y-4 pb-2">
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
              <input
                type="number"
                step="0.01"
                min={editingEntry && editingEntry.amount < 0 ? undefined : "0.01"}
                max={editingEntry && editingEntry.amount < 0 ? "-0.01" : undefined}
                required
                value={editEntryForm.amount}
                onChange={(e) => setEditEntryForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
              <input
                type="date"
                required
                value={editEntryForm.date}
                onChange={(e) => setEditEntryForm((f) => ({ ...f, date: e.target.value }))}
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</label>
              <input
                type="text"
                value={editEntryForm.notes}
                onChange={(e) => setEditEntryForm((f) => ({ ...f, notes: e.target.value }))}
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
              Save Changes
            </button>
          </form>
        )}
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
      )}
    </div>
  );
}

/**
 * Compact mobile summary card. Top: label. Middle: combined total.
 * Bottom: per-type breakdown (Deals / Bonus / Trainer), each
 * suppressed when $0 to reduce noise. Inline chargeback note on the
 * Deals line when non-zero.
 */
function SummaryCard({ label, total, tone, breakdown, pending = false }: {
  label: string;
  total: number;
  tone: string;
  breakdown: StatusBreakdown;
  pending?: boolean;
}) {
  const lines: string[] = [];
  if (breakdown.deal !== 0) {
    const dealAmt = breakdown.deal < 0 ? `−$${Math.abs(breakdown.deal).toLocaleString()}` : `$${breakdown.deal.toLocaleString()}`;
    let line = `Deals ${dealAmt}`;
    if (breakdown.chargebacks !== 0) {
      line += ` (−$${Math.abs(breakdown.chargebacks).toLocaleString()} ${pending ? 'pending cb' : 'cb'})`;
    }
    lines.push(line);
  }
  if (breakdown.bonus !== 0) lines.push(`Bonus $${breakdown.bonus.toLocaleString()}`);
  if (breakdown.trainer !== 0) lines.push(`Trainer $${breakdown.trainer.toLocaleString()}`);

  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
      <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1 leading-none" style={{ color: tone, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${total.toLocaleString()}</p>
      <div className="mt-2 space-y-0.5">
        {lines.length === 0
          ? <p className="text-[10px]" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>—</p>
          : lines.map((l) => (
              <p key={l} className="text-[10px] truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{l}</p>
            ))}
      </div>
    </div>
  );
}
