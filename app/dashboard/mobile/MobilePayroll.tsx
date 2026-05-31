'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, todayLocalDateStr, formatDate, downloadCSV } from '../../../lib/utils';
import { breakdownByType, type StatusBreakdown } from '../../../lib/aggregators';
import { useToast } from '../../../lib/toast';
import { PayrollEntry, Reimbursement } from '../../../lib/data';
import { Check, Trash2, Pencil, X, Receipt, Archive, ArchiveRestore, Download, Printer } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import PayrollTypeTabs from './shared/PayrollTypeTabs';
import PayrollStatusTabs from './shared/PayrollStatusTabs';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';
import PaidCorrectionModal from '../components/PaidCorrectionModal';
import { SegmentedPills } from '../../../components/ui';
import { PaymentTypeBadge } from '../../../components/ui/PaymentTypeBadge';

type StatusTab = 'Draft' | 'Pending' | 'Paid';
type TypeTab = 'All' | 'Deal' | 'Bonus' | 'Trainer' | 'Charge';
type PageView = 'payroll' | 'reimbursements';
type ReimFilterStatus = 'All' | 'Pending' | 'Approved' | 'Denied';

// Classifies a PayrollEntry into one of the three type tabs. Trainer
// overrides are stored as type='Deal' + paymentStage='Trainer' in the
// DB — we surface them under their own tab. Mirrors the desktop helper
// in app/dashboard/payroll/page.tsx (2026-04-23).
function entryTypeTab(entry: { type?: string; paymentStage?: string; chargeCategory?: string | null }): Exclude<TypeTab, 'All'> {
  if (entry.chargeCategory != null) return 'Charge';
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
  const initialType = (searchParams.get('type') ?? 'All') as TypeTab;
  const initialView = (searchParams.get('view') === 'reimbursements' ? 'reimbursements' : 'payroll') as PageView;

  const [pageView, setPageView] = useState<PageView>(initialView);
  const [statusTab, setStatusTab] = useState<StatusTab>(['Draft', 'Pending', 'Paid'].includes(initialStatus) ? initialStatus : 'Draft');
  const [typeTab, setTypeTab] = useState<TypeTab>((['All', 'Deal', 'Bonus', 'Trainer', 'Charge'] as const).includes(initialType as TypeTab) ? (initialType as TypeTab) : 'All');
  const [selectedEntry, setSelectedEntry] = useState<PayrollEntry | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<PayrollEntry | null>(null);
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ repId: '', projectId: '', amount: '', notes: '', date: '', type: 'Deal' as 'Deal' | 'Bonus' | 'Chargeback' | 'Charge', stage: 'M1' as string, chargeCategory: 'misc' as 'equipment_damage' | 'reimbursement_clawback' | 'customer_dispute' | 'misc' });
  const [editingEntry, setEditingEntry] = useState<PayrollEntry | null>(null);
  const [editEntryForm, setEditEntryForm] = useState({ amount: '', date: '', notes: '' });
  const [paidCorrectionEntry, setPaidCorrectionEntry] = useState<PayrollEntry | null>(null);

  // ── Admin filters ─────────────────────────────────────────────────────────
  const [filterRepId, setFilterRepId] = useState(searchParams.get('rep') ?? '');
  const [filterFrom, setFilterFrom] = useState(searchParams.get('from') ?? '');
  const [filterTo, setFilterTo] = useState(searchParams.get('to') ?? '');

  // Sync state → URL. Only non-default values are written so the
  // querystring stays clean.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (statusTab !== 'Draft') params.set('status', statusTab); else params.delete('status');
    if (typeTab !== 'All') params.set('type', typeTab); else params.delete('type');
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
      .filter((e) => e.status === 'Pending' && (typeTab === 'All' || entryTypeTab(e) === typeTab) && e.date <= today && (effectiveRole === 'admin' || e.repId === effectiveRepId))
      .reduce((s, e) => s + e.amount, 0);
  }, [payrollEntries, typeTab, effectiveRole, effectiveRepId]);

  // Combined breakdowns across ALL types (Deal + Bonus + Trainer) for
  // the summary cards row. Cards stay honest about the total owed;
  // the type tab below still filters the row list for drill-down.
  // Mirrors the desktop payroll tab pattern (2026-04-23).
  const { draftBreakdown, pendingBreakdown, paidBreakdown, allTypesInScope } = useMemo(() => {
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
      allTypesInScope: scope,
    };
  }, [payrollEntries, effectiveRole, effectiveRepId, filterRepId, filterFrom, filterTo]);

  // ── Filtered entries ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const today = todayLocalDateStr();
    return payrollEntries.filter((e) =>
      e.status === statusTab &&
      (typeTab === 'All' || entryTypeTab(e) === typeTab) &&
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
    const target = statusTab === 'Pending'
      ? allTypesInScope.filter((e) => e.status === 'Pending')
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
        // Re-fetch to get accurate DB state — a partial bulk PATCH may have already
        // committed some entries as Paid before the error, so a blind rollback to
        // the pre-publish snapshot would mark those entries Pending in client state
        // while the DB has them Paid, creating a desync until page reload.
        const refreshRes = await fetch('/api/data').catch(() => null);
        if (refreshRes?.ok) {
          const refreshData = await refreshRes.json().catch(() => null);
          if (refreshData?.payrollEntries) {
            setPayrollEntries(refreshData.payrollEntries);
          } else {
            setPayrollEntries(snapshot);
          }
        } else {
          setPayrollEntries(snapshot);
        }
        toast('Payroll failed to save — rolled back', 'error');
      }
    }
  }, [filtered, allTypesInScope, payrollEntries, setPayrollEntries, toast, statusTab]);

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
      const isCharge = paymentForm.type === 'Charge';
      const project = (!isBonus && !isCharge) ? projects.find((p) => p.id === paymentForm.projectId) : undefined;

      if (isChargeback && !paymentForm.projectId) {
        toast('Select the deal to charge back', 'error');
        return;
      }

      if (!isBonus && !isCharge && paymentForm.stage === 'M3') {
        if (!paymentForm.projectId || !project) { toast('M3 payments require a linked project', 'error'); return; }
        const installerName = project.installer ?? '';
        const payPct = installerPayConfigs[installerName]?.installPayPct ?? 100;
        if (payPct >= 100) { toast('M3 payments are only allowed for installers with a partial install payment percentage (installPayPct < 100)', 'error'); return; }
      }

      // Chargebacks + standalone Charges store negative amounts. User
      // enters positive; we negate here.
      const raw = parseFloat(paymentForm.amount);
      const signed = (isChargeback || isCharge) ? -raw : raw;
      const dbType: 'Deal' | 'Bonus' = isBonus ? 'Bonus' : 'Deal';
      const dbStage: PayrollEntry['paymentStage'] =
        isBonus ? 'Bonus' : isCharge ? 'Charge' : (paymentForm.stage as 'M1' | 'M2' | 'M3');
      const notesOut = isChargeback ? `Chargeback — manual${paymentForm.notes ? ` · ${paymentForm.notes}` : ''}` : paymentForm.notes;
      const newEntry: PayrollEntry = {
        id: `pay_${Date.now()}`,
        repId: paymentForm.repId,
        repName: rep?.name ?? '',
        projectId: (isBonus || isCharge) ? null : (paymentForm.projectId || null),
        customerName: project?.customerName ?? '',
        amount: signed,
        type: dbType,
        paymentStage: dbStage,
        status: 'Draft',
        date: paymentForm.date || todayLocalDateStr(),
        notes: notesOut,
        isChargeback: isChargeback || isCharge,
        chargebackOfId: null,
        chargeCategory: isCharge ? paymentForm.chargeCategory : null,
      };
      setPayrollEntries((prev) => [...prev, newEntry]);
      setShowAddPayment(false);
      setPaymentForm({ repId: '', projectId: '', amount: '', notes: '', date: '', type: 'Deal', stage: 'M1', chargeCategory: 'misc' });
      setStatusTab('Draft');
      setTypeTab(isCharge ? 'Charge' : isBonus ? 'Bonus' : isChargeback ? 'Deal' : 'Deal');
      setFilterRepId('');
      const label = isCharge ? 'Charge' : isChargeback ? 'Chargeback' : 'Payment';
      toast(`${label} added for ${rep?.name ?? 'rep'} — ${fmt$(Math.abs(signed))}`, 'success');

      persistPayrollEntry(newEntry);
    },
    [paymentForm, reps, projects, installerPayConfigs, setPayrollEntries, persistPayrollEntry, toast],
  );

  const openEditEntry = useCallback((entry: PayrollEntry) => {
    if (entry.status === 'Paid') {
      if (effectiveRole === 'admin') {
        setSelectedEntry(null);
        setPaidCorrectionEntry(entry);
      } else {
        toast('Paid entries cannot be edited — ask an admin to correct or add a chargeback.', 'error');
      }
      return;
    }
    setEditEntryForm({ amount: String(entry.amount), date: entry.date, notes: entry.notes ?? '' });
    setSelectedEntry(null);
    setEditingEntry(entry);
  }, [effectiveRole, toast]);

  const handlePaidCorrected = useCallback((updated: PayrollEntry) => {
    setPayrollEntries((prev) => prev.map((e) => e.id === updated.id ? updated : e));
  }, [setPayrollEntries]);

  const openChargebackForEntry = useCallback((entry: PayrollEntry) => {
    setPaymentForm({
      type: 'Chargeback',
      repId: entry.repId,
      projectId: entry.projectId ?? '',
      amount: '',
      stage: 'M1',
      date: todayLocalDateStr(),
      notes: `Correction for ${entry.paymentStage} paid ${entry.date}`,
      chargeCategory: 'misc',
    });
    setShowAddPayment(true);
  }, []);

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

  const inputCls =
    'w-full rounded-xl px-3 py-2.5 text-base text-[var(--text-primary)] focus:outline-none transition-colors';

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader
        title="Payroll"
        right={
          effectiveRole === 'admin' && pageView === 'payroll' ? (
            <button
              onClick={() => setShowAddPayment(true)}
              className="card-surface flex items-center justify-center w-10 h-10 rounded-2xl relative active:scale-95 transition-transform"
              style={{
                border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 32%, transparent)',
              }}
              aria-label="Add payment"
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 3,
                  height: 3,
                  borderRadius: '50%',
                  background: 'var(--accent-emerald-solid)',
                  boxShadow: '0 0 4px color-mix(in srgb, var(--accent-emerald-solid) 65%, transparent)',
                }}
              />
              <span
                className="leading-none"
                style={{
                  fontFamily: "'DM Serif Display', serif",
                  fontSize: 22,
                  color: 'var(--accent-emerald-text)',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  transform: 'translateY(-1px)',
                }}
              >+</span>
            </button>
          ) : null
        }
      />

      {/* ── Page view tabs (admin only) — shared SegmentedPills */}
      {effectiveRole === 'admin' && (
        <SegmentedPills<PageView>
          options={[
            { value: 'payroll', label: 'Payroll' },
            { value: 'reimbursements', label: 'Reimbursements', badge: pendingReimCount > 0 ? pendingReimCount : undefined },
          ]}
          value={pageView}
          onChange={setPageView}
          ariaLabel="Payroll page view"
        />
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
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
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
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              <option value="active">Active only</option>
              <option value="all">Inc. archived</option>
              <option value="only">Archived only</option>
            </select>
          </div>

          {/* List */}
          {filteredReimbursements.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Receipt className="w-10 h-10" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
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
                  style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{r.repName}</p>
                      <p className="text-sm truncate mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{r.description}</p>
                      {r.archivedAt && (
                        <p className="text-[11px] mt-0.5 uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>archived</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${r.amount.toFixed(2)}</p>
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={
                          r.status === 'Approved'
                            ? { background: 'color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)', color: 'var(--accent-emerald-text)' }
                            : r.status === 'Denied'
                            ? { background: 'color-mix(in srgb, var(--accent-red-solid) 15%, transparent)', color: 'var(--accent-red-text)' }
                            : { background: 'color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)', color: 'var(--accent-amber-text)' }
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
      <div className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
        {/* Draft = working/unfinished → muted. Pending = in-flight →
            amber (semantic). Paid = completed → refined Next-Payout
            green. The DRAFT bright-blue was reading as info/primary
            which the status doesn't warrant. */}
        <SummaryCard label="Draft" total={draftBreakdown.total} tone="var(--text-secondary)" breakdown={draftBreakdown} pending />
        <SummaryCard label="Pending" total={pendingBreakdown.total} tone="var(--accent-amber-text)" breakdown={pendingBreakdown} pending />
        <SummaryCard label="Paid" total={paidBreakdown.total} tone="var(--accent-emerald-text)" breakdown={paidBreakdown} />
      </div>
      {pendingTotal > 0 && (
        <p className="text-base mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {fmt$(pendingTotal)} pending{typeTab !== 'All' ? ` · ${typeTab}` : ''}
        </p>
      )}

      {/* ── Type + Status tabs (sticky) ── */}
      <div
        className="sticky z-20 -mx-5 px-5 pt-2 space-y-2"
        style={{
          top: 0,
          background: 'color-mix(in srgb, var(--surface-page) 88%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '8px',
        }}
      >
        <PayrollTypeTabs value={typeTab} onChange={setTypeTab} />

        <PayrollStatusTabs value={statusTab} onChange={setStatusTab} />
      </div>

      {/* ── Admin filters ── */}
      {effectiveRole === 'admin' && (
        <div className="space-y-2">
          <select
            value={filterRepId}
            onChange={(e) => setFilterRepId(e.target.value)}
            className="w-full min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: filterRepId ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
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
              className="flex-1 min-w-0 min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: filterFrom ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="flex-1 min-w-0 min-h-[44px] rounded-xl px-3 text-sm focus:outline-none"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: filterTo ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
            {(filterFrom || filterTo) && (
              <button
                onClick={() => { setFilterFrom(''); setFilterTo(''); }}
                className="min-h-[44px] px-3 rounded-xl text-sm"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Export buttons (admin only) ── */}
      {effectiveRole === 'admin' && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              const headers = ['Rep', 'Customer', 'Type', 'Stage', 'Amount', 'Status', 'Date', 'Notes'];
              const rows = filtered.map((e) => [
                e.repName,
                e.customerName || '',
                e.type,
                e.paymentStage,
                `$${e.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                e.status,
                formatDate(e.date),
                e.notes ?? '',
              ]);
              downloadCSV(`payroll-${statusTab.toLowerCase()}-${todayLocalDateStr()}.csv`, headers, rows);
            }}
            disabled={filtered.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={() => {
              const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
              const periodFrom = sorted[0]?.date ?? '';
              const periodTo = sorted[sorted.length - 1]?.date ?? '';
              const byRep = new Map<string, { repName: string; gross: number; chargebacks: number; count: number }>();
              for (const e of filtered) {
                const key = e.repId;
                const row = byRep.get(key) ?? { repName: e.repName, gross: 0, chargebacks: 0, count: 0 };
                if (e.amount < 0) row.chargebacks += Math.abs(e.amount);
                else row.gross += e.amount;
                row.count += 1;
                byRep.set(key, row);
              }
              const adpHeaders = ['Employee Name', 'Gross Pay', 'Deductions', 'Net Pay', 'Pay Period From', 'Pay Period To', 'Entry Count'];
              const adpRows = Array.from(byRep.values())
                .sort((a, b) => a.repName.localeCompare(b.repName))
                .map(({ repName, gross, chargebacks, count }) => [
                  repName,
                  gross.toFixed(2),
                  chargebacks.toFixed(2),
                  (gross - chargebacks).toFixed(2),
                  periodFrom,
                  periodTo,
                  String(count),
                ]);
              const filename = `adp-payroll-${periodFrom || todayLocalDateStr()}-to-${periodTo || todayLocalDateStr()}.csv`;
              downloadCSV(filename, adpHeaders, adpRows);
            }}
            disabled={filtered.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Download className="w-4 h-4" /> ADP
          </button>
          <button
            onClick={() => window.print()}
            disabled={filtered.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      )}

      {/* ── Grouped entry list ── */}
      {groupedByRep.length === 0 ? (
        <p className="text-base text-center py-8" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No {statusTab.toLowerCase()} entries.</p>
      ) : (
        <div className="space-y-6">
          {groupedByRep.map((group) => (
            <div key={group.repName} className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
              {/* Rep group header */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-base font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{group.repName}</p>
                <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(group.total)}</p>
              </div>

              {/* Entries */}
              <div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={effectiveRole === 'admin' ? () => setSelectedEntry(entry) : undefined}
                    className="w-full flex items-center justify-between py-3 text-left active:opacity-80 transition-colors"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    {(() => {
                      const kind = entryTypeTab(entry);
                      const stageSuffix = kind === 'Deal' ? entry.paymentStage : null;
                      return (
                        <span className="flex items-center gap-2 min-w-0 mr-2">
                          <PaymentTypeBadge kind={kind} stage={stageSuffix} showIcon={false} />
                          <span className="text-base text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                            {entry.customerName || (entry.notes || (entry.type === 'Bonus' ? 'Bonus' : '—'))}
                          </span>
                        </span>
                      );
                    })()}
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className="text-lg font-bold tabular-nums"
                        style={{
                          color: entry.amount < 0 ? 'var(--accent-red-text)' : 'var(--text-primary)',
                          fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                        }}
                      >{fmt$(entry.amount)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Sticky bottom action (admin only) — premium glass bar with
          an outlined emerald CTA. The action stays prominent (sticky +
          centered + full-width) but the chrome no longer screams. */}
      {effectiveRole === 'admin' && ctaMounted && (
        <div
          className={`fixed bottom-0 left-0 right-0 px-4 z-40 ${ctaExiting ? 'cta-bar-exit' : 'cta-bar-enter'}`}
          style={{
            paddingTop: '12px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            background: 'color-mix(in srgb, var(--surface-page) 88%, transparent)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={() => statusTab === 'Pending' ? setShowPublishConfirm(true) : setShowApproveAllConfirm(true)}
            className="w-full min-h-[44px] rounded-full text-[13px] font-semibold tracking-wide active:scale-[0.98] transition-all duration-150"
            style={{
              background: 'color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)',
              color: 'var(--accent-emerald-text)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {statusTab === 'Pending' ? 'Publish Payroll' : 'Approve All'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showPublishConfirm}
        title="Publish Payroll?"
        message={`This will mark ${filtered.filter((e) => e.status === 'Pending').length} pending ${filtered.filter((e) => e.status === 'Pending').length === 1 ? 'entry' : 'entries'} as Paid. This action cannot be undone.`}
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
            {selectedEntry.status === 'Paid' && (
              <MobileBottomSheet.Item
                label="Edit Entry"
                icon={Pencil}
                onTap={() => openEditEntry(selectedEntry)}
              />
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
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep</label>
            <select
              value={paymentForm.repId}
              onChange={(e) => setPaymentForm((f) => ({ ...f, repId: e.target.value }))}
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              <option value="">Select rep...</option>
              {reps.filter((r) => r.active !== false).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Type</label>
            <div className="flex gap-2">
              {(['Deal', 'Bonus', 'Chargeback', 'Charge'] as const).map((t) => {
                const selected = paymentForm.type === t;
                const isNegativeBtn = t === 'Chargeback' || t === 'Charge';
                const selectedBg = t === 'Chargeback' || t === 'Charge'
                  ? 'var(--accent-red-solid)'
                  : t === 'Bonus' ? 'var(--accent-amber-solid)'
                  : 'var(--accent-emerald-solid)';
                const nextStage = t === 'Bonus' ? 'Bonus' : t === 'Charge' ? 'Charge' : paymentForm.stage && paymentForm.stage !== 'Bonus' && paymentForm.stage !== 'Charge' ? paymentForm.stage : 'M1';
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPaymentForm((f) => ({ ...f, type: t, stage: nextStage }))}
                    className="flex-1 min-h-[48px] rounded-xl text-xs font-medium transition-colors"
                    style={{
                      background: selected ? selectedBg : 'var(--surface-card)',
                      color: selected ? (isNegativeBtn ? '#fff' : '#000') : 'var(--text-muted)',
                      border: selected ? 'none' : '1px solid var(--border-subtle)',
                      fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {paymentForm.type === 'Chargeback' && (
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Clawback of a paid milestone on a cancelled deal. Positive dollars; stored as negative.</p>
            )}
            {paymentForm.type === 'Charge' && (
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>One-off deduction (no project). Pick a category below. Stored as a negative Draft entry.</p>
            )}
          </div>
          {paymentForm.type === 'Charge' && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Category</label>
              <select
                value={paymentForm.chargeCategory}
                onChange={(e) => setPaymentForm((f) => ({ ...f, chargeCategory: e.target.value as typeof f.chargeCategory }))}
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                <option value="equipment_damage">Equipment damage</option>
                <option value="reimbursement_clawback">Reimbursement clawback</option>
                <option value="customer_dispute">Customer dispute</option>
                <option value="misc">Misc</option>
              </select>
            </div>
          )}
          {(paymentForm.type === 'Deal' || paymentForm.type === 'Chargeback') && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Stage</label>
              <div className="flex gap-2">
                {['M1', 'M2', 'M3'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPaymentForm((f) => ({ ...f, stage: s }))}
                    className="flex-1 min-h-[44px] rounded-xl text-base font-medium transition-colors"
                    style={{
                      background: paymentForm.stage === s ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
                      color: paymentForm.stage === s ? '#000' : 'var(--text-muted)',
                      border: paymentForm.stage === s ? 'none' : '1px solid var(--border-subtle)',
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
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Project</label>
              <select
                value={paymentForm.projectId}
                onChange={(e) => setPaymentForm((f) => ({ ...f, projectId: e.target.value }))}
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                <option value="">Select project...</option>
                {projects
                  .filter((p) => paymentForm.type === 'Chargeback' ? p.phase === 'Cancelled' : p.phase !== 'Cancelled' && p.phase !== 'On Hold')
                  .filter((p) => !paymentForm.repId || p.repId === paymentForm.repId || p.setterId === paymentForm.repId || p.additionalClosers?.some((c) => c.userId === paymentForm.repId) || p.additionalSetters?.some((s) => s.userId === paymentForm.repId))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.customerName}</option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
            <input
              type="number"
              step="0.01"
              required
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
            <input
              type="date"
              value={paymentForm.date}
              onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))}
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</label>
            <input
              type="text"
              value={paymentForm.notes}
              onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional note"
              className={`${inputCls} min-h-[48px]`}
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl text-base font-semibold active:opacity-90 transition-colors"
            style={{
              background: 'var(--accent-emerald-solid)',
              color: 'var(--text-on-accent)',
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
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
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
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
              <input
                type="date"
                required
                value={editEntryForm.date}
                onChange={(e) => setEditEntryForm((f) => ({ ...f, date: e.target.value }))}
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</label>
              <input
                type="text"
                value={editEntryForm.notes}
                onChange={(e) => setEditEntryForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional note"
                className={`${inputCls} min-h-[48px]`}
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[52px] rounded-2xl text-base font-semibold active:opacity-90 transition-colors"
              style={{
                background: 'var(--accent-emerald-solid)',
                color: 'var(--text-on-accent)',
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

      <PaidCorrectionModal
        entry={paidCorrectionEntry}
        onClose={() => setPaidCorrectionEntry(null)}
        onCorrected={handlePaidCorrected}
        onOpenChargeback={openChargebackForEntry}
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
/** Compact currency for narrow mobile cards. The 3-up summary grid
 *  on a phone leaves ~80px of content width per tile, so anything
 *  with 4-digit-plus dollars + cents truncates ("$5,118.04" → "$5,11…").
 *  Tiered formatting:
 *    ≥ $1M  → $1.83M (1–2 sig figs)
 *    ≥ $10K → $15K
 *    ≥ $1K  → $5,118 (drop cents — cents are noise at the summary level)
 *    < $1K  → $128 (full precision)
 *  Full untruncated value stays available via the title= tooltip. */
function compactCurrency(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toLocaleString()}`;
}

function SummaryCard({ label, total, tone, breakdown, pending = false }: {
  label: string;
  total: number;
  tone: string;
  breakdown: StatusBreakdown;
  pending?: boolean;
}) {
  // Use compact currency ($65.6K) for breakdown lines so multi-figure
  // totals like "$65,556" don't get truncated at the 3-card grid width.
  // Cents would be noise here regardless of formatting.
  const fmtBreakdown = (n: number) => {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    return `${sign}${compactCurrency(abs)}`;
  };
  const lines: string[] = [];
  if (breakdown.deal !== 0) {
    let line = `Deals ${fmtBreakdown(breakdown.deal)}`;
    if (breakdown.chargebacks !== 0) {
      line += ` (−${compactCurrency(Math.abs(breakdown.chargebacks))} ${pending ? 'pending cb' : 'cb'})`;
    }
    lines.push(line);
  }
  if (breakdown.bonus !== 0) lines.push(`Bonus ${fmtBreakdown(breakdown.bonus)}`);
  if (breakdown.trainer !== 0) lines.push(`Trainer ${fmtBreakdown(breakdown.trainer)}`);

  return (
    <div className="rounded-2xl p-3 min-w-0 overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
      <p className="text-[10px] uppercase tracking-widest font-semibold truncate" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</p>
      <p
        className="text-base font-bold tabular-nums mt-1 leading-none truncate"
        title={`$${total.toLocaleString()}`}
        style={{ color: tone, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
      >
        {compactCurrency(total)}
      </p>
      <div className="mt-2 space-y-0.5">
        {lines.length === 0
          ? <p className="text-[10px]" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>—</p>
          : lines.map((l) => (
              <p key={l} className="text-[10px] truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{l}</p>
            ))}
      </div>
    </div>
  );
}
