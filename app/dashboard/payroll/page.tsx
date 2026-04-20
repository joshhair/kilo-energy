'use client';

import { useState, useRef, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useFocusTrap, useMediaQuery } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { PayrollEntry, Reimbursement } from '../../../lib/data';
import { formatDate, downloadCSV, fmt$, localDateString, todayLocalDateStr } from '../../../lib/utils';
import { sumPaid, sumPending, sumDraft } from '../../../lib/aggregators';
import { RelativeDate } from '../components/RelativeDate';
import { X, CreditCard, AlertTriangle, Receipt, Check, Filter, ArrowRight, Download, Printer, Trash2 } from 'lucide-react';
import { PaginationBar } from '../components/PaginationBar';
import { RepSelector } from '../components/RepSelector';
import { SearchableSelect } from '../components/SearchableSelect';
import { DateRangeFilter } from '../components/DateRangeFilter';
import Link from 'next/link';
import MobilePayroll from '../mobile/MobilePayroll';
import { PayrollSkeleton } from './components/PayrollSkeleton';
import { StatCard, ReimBadge } from './components/StatCard';

type StatusTab = 'Draft' | 'Pending' | 'Paid';
type TypeTab = 'Deal' | 'Bonus';
type PageView = 'payroll' | 'reimbursements';

/** Returns the Tailwind gradient string that matches the active status tab */
const _STATUS_ACCENT: Record<StatusTab, string> = {
  Draft:   'from-blue-500 to-blue-400',
  Pending: 'from-yellow-500 to-yellow-400',
  Paid:    'from-emerald-500 to-emerald-400',
};

const PRINT_STYLES = `
@media print {
  aside, nav, .tab-bar-container, button, [role="dialog"], .toast-item,
  [aria-label="Back to top"], [aria-label="Open navigation menu"] { display: none !important; }
  body, main, div { background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card-surface, .card-surface-stat { background: white !important; border: 1px solid #ddd !important; box-shadow: none !important; backdrop-filter: none !important; }
  table { width: 100% !important; border-collapse: collapse !important; }
  th, td { border: 1px solid #ccc !important; padding: 6px 10px !important; color: black !important; background: white !important; font-size: 11px !important; }
  th { background: #f0f0f0 !important; font-weight: 600 !important; }
  .text-gradient-brand, .text-gradient-emerald, .text-gradient-gold { background: none !important; -webkit-background-clip: unset !important; -webkit-text-fill-color: black !important; background-clip: unset !important; }
  .stat-value, .stat-value-glow { text-shadow: none !important; color: black !important; }
  main { padding: 0 !important; overflow: visible !important; width: 100% !important; }
  main::before { content: 'Kilo Energy — Payroll Summary'; display: block; text-align: center; font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 2px solid #333; margin-bottom: 16px; }
  * { animation: none !important; transition: none !important; }
  @page { margin: 1cm; size: landscape; }
}`;

export default function PayrollPage() {
  return (
    <Suspense>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <PayrollPageInner />
    </Suspense>
  );
}

function PayrollPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { effectiveRole, effectiveRepId, payrollEntries, setPayrollEntries, markForPayroll, persistPayrollEntry, reps, projects, reimbursements, setReimbursements, installerPayConfigs, dbReady } = useApp();
  const { toast } = useToast();
  const isHydrated = useIsHydrated();
  useEffect(() => { document.title = 'Payroll | Kilo Energy'; }, []);

  // URL-persisted state
  const initialStatus = (searchParams.get('status') ?? 'Draft') as StatusTab;
  const initialType = (searchParams.get('type') ?? 'Deal') as TypeTab;
  const initialRep = searchParams.get('rep') ?? '';

  const [pageView, setPageView] = useState<PageView>('payroll');
  const [statusTab, setStatusTab] = useState<StatusTab>(['Draft', 'Pending', 'Paid'].includes(initialStatus) ? initialStatus : 'Draft');
  const [typeTab, setTypeTab] = useState<TypeTab>(['Deal', 'Bonus'].includes(initialType) ? initialType : 'Deal');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionBarMounted, setActionBarMounted] = useState(false);
  const [actionBarVisible, setActionBarVisible] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const paymentSubmitting = useRef(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishingPayroll, setPublishingPayroll] = useState(false);
  const [markingForPayroll, setMarkingForPayroll] = useState(false);
  // Unified add-payment form — covers Deal (requires project + stage) and
  // Bonus (just amount + notes + date). Toggle in the modal switches the
  // field set. Replaced the standalone Add Bonus modal in Batch 4.
  const [paymentForm, setPaymentForm] = useState({
    type: 'Deal' as 'Deal' | 'Bonus' | 'Chargeback',
    repId: '',
    projectId: '',
    amount: '',
    stage: 'M1' as 'M1' | 'M2' | 'M3',
    date: '',
    notes: '',
  });
  const paymentPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(paymentPanelRef, showPaymentModal);

  // Row-level edit (Batch 4). Open with an entry reference; modal lets
  // admin change amount / date / notes (status is managed via the
  // Reverse and row-action buttons). Per-row processing set prevents
  // concurrent clicks on the same row.
  const [editingEntry, setEditingEntry] = useState<PayrollEntry | null>(null);
  const [editEntryForm, setEditEntryForm] = useState({ amount: '', date: '', notes: '' });
  const [processingEntryIds, setProcessingEntryIds] = useState<Set<string>>(new Set());
  const editEntryPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(editEntryPanelRef, editingEntry !== null);

  // Reimbursements date filter
  const [reimFilterFrom, setReimFilterFrom] = useState('');
  const [reimFilterTo, setReimFilterTo] = useState('');
  const [reimFilterStatus, setReimFilterStatus] = useState<'All' | 'Pending' | 'Approved' | 'Denied'>('Pending');
  const [processingReimIds, setProcessingReimIds] = useState<Set<string>>(new Set());
  // Archived-visibility toggle for reimbursements.
  //   false  → hide archived (default)
  //   true   → show everything (archived mixed in)
  //   'only' → show only archived
  const [showArchivedReim, setShowArchivedReim] = useState<false | true | 'only'>(false);

  // Rep-view filters (non-admin)
  const [repTypeFilter, setRepTypeFilter] = useState<'All' | 'Deal' | 'Bonus'>('All');
  const [repStatusFilter, setRepStatusFilter] = useState<'All' | 'Draft' | 'Pending' | 'Paid'>('All');

  // Payroll entries date filter
  const [payFilterFrom, setPayFilterFrom] = useState('');
  const [payFilterTo, setPayFilterTo] = useState('');

  // Pagination for admin payroll table
  const [adminPage, setAdminPage] = useState(1);
  const [adminRowsPerPage, setAdminRowsPerPage] = useState(25);

  // Rep filter (admin)
  const [filterRepId, setFilterRepId] = useState(initialRep);

  // Re-sync state when browser back/forward changes searchParams
  useEffect(() => {
    const s = (searchParams.get('status') ?? 'Draft') as StatusTab;
    const t = (searchParams.get('type') ?? 'Deal') as TypeTab;
    const r = searchParams.get('rep') ?? '';
    setStatusTab(['Draft', 'Pending', 'Paid'].includes(s) ? s : 'Draft');
    setTypeTab(['Deal', 'Bonus'].includes(t) ? t : 'Deal');
    setFilterRepId(r);
    setSelectedIds(new Set());
  }, [searchParams]);

  // Wrappers that sync tab/filter state to URL params
  const changeStatusTab = (v: StatusTab) => {
    setStatusTab(v);
    setSelectedIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const changeTypeTab = (v: TypeTab) => {
    setTypeTab(v);
    setSelectedIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const changeFilterRepId = (v: string) => {
    setFilterRepId(v);
    setSelectedIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set('rep', v); else params.delete('rep');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Page view tab indicators
  const pageViewRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pageViewIndicator, setPageViewIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = pageView === 'payroll' ? 0 : 1;
    const el = pageViewRefs.current[idx];
    if (el) setPageViewIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [pageView, isHydrated]);

  // Sliding tab indicators
  const statusTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [statusIndicator, setStatusIndicator] = useState<{ left: number; width: number } | null>(null);
  const typeTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [typeIndicator, setTypeIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const STATUS_TABS: StatusTab[] = ['Draft', 'Pending', 'Paid'];
    const idx = STATUS_TABS.indexOf(statusTab);
    const el = statusTabRefs.current[idx];
    if (el) setStatusIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [statusTab, isHydrated]);

  useEffect(() => {
    const TYPE_TABS: TypeTab[] = ['Deal', 'Bonus'];
    const idx = TYPE_TABS.indexOf(typeTab);
    const el = typeTabRefs.current[idx];
    if (el) setTypeIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [typeTab, isHydrated]);

  const isMobile = useMediaQuery('(max-width: 767px)');

  // Keyboard shortcuts: Escape → deselect, Enter → mark for payroll, Shift+A → select/deselect all
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // handleMarkForPayroll and selectAll are defined after both the isMobile and
      // project_manager early returns, so skip all shortcuts on those render paths
      // to avoid calling uninitialized bindings (TDZ ReferenceError).
      if (!isHydrated || !dbReady) return;
      if (isMobile || effectiveRole === 'project_manager') return;

      // Skip if an input element is focused
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        if (e.key === 'Escape') setSelectedIds(new Set());
        return;
      }

      if (e.key === 'Escape') {
        if (showPaymentModal) { setShowPaymentModal(false); return; }
        setSelectedIds(new Set());
        return;
      }

      // Enter → trigger "Mark for Payroll" when Draft entries are selected
      if (e.key === 'Enter' && statusTab === 'Draft' && selectedIds.size > 0) {
        e.preventDefault();
        handleMarkForPayroll();
        return;
      }

      // Shift+A → select/deselect all in current filtered view
      if (e.shiftKey && e.key.toUpperCase() === 'A') {
        e.preventDefault();
        selectAll();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, effectiveRole, statusTab, selectedIds, payrollEntries, typeTab, payFilterFrom, payFilterTo, filterRepId, adminPage, adminRowsPerPage, markingForPayroll, showPaymentModal]);

  // ── Single-pass filter + totals ───────────────────────────────────────
  // Was: 5 separate passes over payrollEntries (2700+ rows) per render:
  //   1. filter() for the visible status-filtered list
  //   2. filter() for the broader date+rep filter (used for totals)
  //   3-5. three .filter().reduce() pairs for Draft/Pending/Paid totals
  // Now: one walk through payrollEntries computes everything, memoized
  // on the inputs that actually matter.
  const today = todayLocalDateStr();

  const { filtered, filteredByDateRep, totalDraft, totalPending, combinedTotalPaid, combinedPaidCount } = useMemo(() => {
    const filtered: typeof payrollEntries = [];
    const filteredByDateRep: typeof payrollEntries = [];
    const allTypesInScope: typeof payrollEntries = [];
    // Walk once. filteredByDateRep keeps the legacy per-type semantic for
    // existing count badges. allTypesInScope is the same date+rep scope
    // without the type filter — feeds the combined "Total Paid" tile
    // (primary display; matches the dashboard "Paid Out" number).
    for (const p of payrollEntries) {
      if (payFilterFrom && p.date < payFilterFrom) continue;
      if (payFilterTo && p.date > payFilterTo) continue;
      if (filterRepId && p.repId !== filterRepId) continue;

      allTypesInScope.push(p);
      if (p.type !== typeTab) continue;
      filteredByDateRep.push(p);

      if (p.status === statusTab && (statusTab !== 'Paid' || p.date <= today)) {
        filtered.push(p);
      }
    }

    // Per-type totals for Draft / Pending tiles (the per-tab view).
    const totalDraft = sumDraft(filteredByDateRep, { asOf: today });
    const totalPending = sumPending(filteredByDateRep, { asOf: today });
    // Combined across all types (Deal + Bonus + Trainer). This is the
    // "Total Paid" card reps + admins see by default — matches the
    // dashboard tile when filters align.
    const combinedTotalPaid = sumPaid(allTypesInScope, { asOf: today });
    const combinedPaidCount = allTypesInScope.filter((p) => p.status === 'Paid' && p.date <= today).length;

    return { filtered, filteredByDateRep, totalDraft, totalPending, combinedTotalPaid, combinedPaidCount };
  }, [payrollEntries, statusTab, typeTab, payFilterFrom, payFilterTo, filterRepId, today]);

  // Derived selection state — used by the floating action bar.
  const { selectedTotal } = useMemo(() => {
    let total = 0;
    for (const e of filtered) {
      if (selectedIds.has(e.id)) total += e.amount;
    }
    return { selectedTotal: total };
  }, [filtered, selectedIds]);

  // Floating toolbar is visible whenever one or more Draft entries are selected.
  // Computed here (before early returns) so the useEffect below always fires — hooks
  // must not be called after conditional returns.
  const showActionBar = pageView === 'payroll' && statusTab === 'Draft' && selectedIds.size > 0;

  useEffect(() => {
    if (showActionBar) {
      setActionBarMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setActionBarVisible(true)));
    } else {
      setActionBarVisible(false);
      const t = setTimeout(() => setActionBarMounted(false), 260);
      return () => clearTimeout(t);
    }
  }, [showActionBar]);

  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  if (isMobile) return <MobilePayroll />;

  // Paginate the flat filtered list, then re-group by rep for display
  const adminTotalPages = Math.max(1, Math.ceil(filtered.length / adminRowsPerPage));
  const adminStartIdx = (adminPage - 1) * adminRowsPerPage;
  const adminEndIdx = Math.min(adminStartIdx + adminRowsPerPage, filtered.length);
  const paginatedFiltered = filtered.slice(adminStartIdx, adminEndIdx);
  // Header checkbox state: considers only the visible page entries.
  const allPageSelected = paginatedFiltered.length > 0 && paginatedFiltered.every((e) => selectedIds.has(e.id));

  // repGroups removed — flat table rendering uses paginatedFiltered directly

  const handlePublish = async () => {
    if (publishingPayroll) return;
    setPublishingPayroll(true);
    // Publish only Pending entries matching the active filters (same set the button's disabled state reflects)
    const pendingVisible = filteredByDateRep.filter((e) => e.status === 'Pending' && e.date <= today);
    const ids = pendingVisible.map((e) => e.id);
    const amount = pendingVisible.reduce((s, e) => s + e.amount, 0);
    setPayrollEntries((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Paid' } : p))
    );
    setShowPublishConfirm(false);
    setAdminPage(1);
    toast(`Payroll published — $${amount.toLocaleString()} marked as Paid`, 'success');
    // Persist to DB via bulk endpoint for atomicity
    try {
      const res = await fetch('/api/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: 'Paid' }),
      });
      if (!res.ok) {
        console.error('[handlePublish] Bulk PATCH failed:', res.status);
        // Re-fetch to get accurate DB state — some entries in ids may have already
        // been Paid in DB (stale local state), so a blind rollback to 'Pending' would
        // misrepresent those entries until page refresh.
        const refreshRes = await fetch('/api/data').catch(() => null);
        if (refreshRes?.ok) {
          const refreshData = await refreshRes.json().catch(() => null);
          if (refreshData?.payrollEntries) {
            setPayrollEntries(refreshData.payrollEntries);
          } else {
            setPayrollEntries((prev) =>
              prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Pending' } : p))
            );
          }
        } else {
          setPayrollEntries((prev) =>
            prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Pending' } : p))
          );
        }
        toast(`Payroll failed to save — rolled back`, 'error');
      } else {
        const data = await res.json();
        if (data.updated !== ids.length) {
          console.warn(`[handlePublish] Server updated ${data.updated} of ${ids.length} entries — re-fetching to reconcile`);
          // Skipped entries may be Draft (concurrent rollback) not just Paid — re-fetch to get true DB state.
          const refreshRes = await fetch('/api/data').catch(() => null);
          if (refreshRes?.ok) {
            const refreshData = await refreshRes.json().catch(() => null);
            if (refreshData?.payrollEntries) {
              setPayrollEntries(refreshData.payrollEntries);
            }
          }
          toast(`${data.updated} of ${ids.length} entries published`, 'success');
        }
      }
    } catch (err) {
      console.error('[handlePublish] Network error:', err);
      // Re-fetch to get accurate DB state rather than blindly rolling back to 'Pending'.
      const refreshRes = await fetch('/api/data').catch(() => null);
      if (refreshRes?.ok) {
        const refreshData = await refreshRes.json().catch(() => null);
        if (refreshData?.payrollEntries) {
          setPayrollEntries(refreshData.payrollEntries);
        } else {
          setPayrollEntries((prev) =>
            prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Pending' } : p))
          );
        }
      } else {
        setPayrollEntries((prev) =>
          prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Pending' } : p))
        );
      }
      toast(`Payroll failed to save — rolled back`, 'error');
    } finally {
      setPublishingPayroll(false);
    }
  };

  const handleMarkForPayroll = async () => {
    if (markingForPayroll) return;
    setMarkingForPayroll(true);
    const amount = filtered
      .filter((e) => selectedIds.has(e.id))
      .reduce((s, e) => s + e.amount, 0);
    const ids = filtered.filter((e) => selectedIds.has(e.id)).map((e) => e.id);
    try {
      await markForPayroll(ids);
      setSelectedIds(new Set());
      changeStatusTab('Pending');
      toast(`${ids.length} entries moved to Pending — $${amount.toLocaleString()}`, 'success');
    } catch {
      toast('Failed to move entries to Pending', 'error');
    } finally {
      setMarkingForPayroll(false);
    }
  };

  const toggleEntry = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Row-level actions (Batch 4) ─────────────────────────────────────────

  // Reverse a Pending entry back to Draft so admin can pull it out of
  // the current payroll batch before publish. Server enforces the
  // transition — Paid is never reversed here.
  const handleReverseEntry = async (entry: PayrollEntry) => {
    if (entry.status !== 'Pending') return;
    if (processingEntryIds.has(entry.id)) return;
    setProcessingEntryIds((prev) => new Set(prev).add(entry.id));
    setPayrollEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, status: 'Draft' } : e));
    try {
      const res = await fetch(`/api/payroll/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Draft' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Moved back to Draft', 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to reverse — try again', 'error');
      setPayrollEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, status: 'Pending' } : e));
    } finally {
      setProcessingEntryIds((prev) => { const s = new Set(prev); s.delete(entry.id); return s; });
    }
  };

  const handleDeleteEntry = async (entry: PayrollEntry) => {
    if (entry.status === 'Paid') { toast('Paid entries cannot be deleted', 'error'); return; }
    const ok = window.confirm(`Delete this ${entry.type.toLowerCase()} payment?\n\n${entry.repName} — $${entry.amount.toFixed(2)}\n${entry.notes || entry.customerName || ''}\n\nThis cannot be undone.`);
    if (!ok) return;
    if (processingEntryIds.has(entry.id)) return;
    setProcessingEntryIds((prev) => new Set(prev).add(entry.id));
    const snapshot = entry;
    setPayrollEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setSelectedIds((prev) => { const s = new Set(prev); s.delete(entry.id); return s; });
    try {
      const res = await fetch(`/api/payroll/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Entry deleted', 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to delete — restoring', 'error');
      setPayrollEntries((prev) => [...prev, snapshot]);
    } finally {
      setProcessingEntryIds((prev) => { const s = new Set(prev); s.delete(entry.id); return s; });
    }
  };

  const openEditEntry = (entry: PayrollEntry) => {
    if (entry.status === 'Paid') { toast('Paid entries cannot be edited — add a negative adjustment entry instead', 'error'); return; }
    setEditEntryForm({
      amount: String(entry.amount),
      date: entry.date,
      notes: entry.notes ?? '',
    });
    setEditingEntry(entry);
  };

  const handleSaveEditEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    const amt = parseFloat(editEntryForm.amount);
    const isChargebackEntry = editingEntry.amount < 0;
    if (!Number.isFinite(amt) || amt === 0 || (!isChargebackEntry && amt < 0)) { toast(isChargebackEntry ? 'Amount must be non-zero' : 'Amount must be greater than $0', 'error'); return; }
    if (processingEntryIds.has(editingEntry.id)) return;
    setProcessingEntryIds((prev) => new Set(prev).add(editingEntry.id));
    const snapshot = editingEntry;
    const patch = { amount: amt, date: editEntryForm.date, notes: editEntryForm.notes };
    setPayrollEntries((prev) => prev.map((e) => e.id === editingEntry.id ? { ...e, ...patch } : e));
    setEditingEntry(null);
    try {
      const res = await fetch(`/api/payroll/${editingEntry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Entry updated', 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to save — reverting', 'error');
      setPayrollEntries((prev) => prev.map((e) => e.id === snapshot.id ? snapshot : e));
    } finally {
      setProcessingEntryIds((prev) => { const s = new Set(prev); s.delete(snapshot.id); return s; });
    }
  };

  const selectAll = () => {
    const pageIds = paginatedFiltered.map((e) => e.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentSubmitting.current) return;
    paymentSubmitting.current = true;

    if (!paymentForm.repId) { paymentSubmitting.current = false; toast('Please select a rep', 'error'); return; }
    if (!paymentForm.amount || isNaN(parseFloat(paymentForm.amount)) || parseFloat(paymentForm.amount) <= 0) { paymentSubmitting.current = false; toast('Enter a valid amount greater than $0', 'error'); return; }

    const rep = reps.find((r) => r.id === paymentForm.repId);
    const isBonus = paymentForm.type === 'Bonus';
    const isChargeback = paymentForm.type === 'Chargeback';
    const project = !isBonus ? projects.find((p) => p.id === paymentForm.projectId) : undefined;

    if (!isBonus && paymentForm.stage === 'M3') {
      if (!paymentForm.projectId || !project) { paymentSubmitting.current = false; toast('M3 payments require a linked project', 'error'); return; }
      const installerName = project.installer ?? '';
      const payPct = installerPayConfigs[installerName]?.installPayPct ?? 100;
      if (payPct >= 100) { paymentSubmitting.current = false; toast('M3 payments are only allowed for installers with a partial install payment percentage (installPayPct < 100)', 'error'); return; }
    }

    // Chargebacks are stored as negative "Deal" entries (matches the
    // auto-generated shape from handleChargebacks). Admin enters the
    // dollar amount positively for UX; we negate here before persisting.
    const rawAmount = parseFloat(paymentForm.amount);
    const signedAmount = isChargeback ? -rawAmount : rawAmount;
    const dbType = isBonus ? 'Bonus' : 'Deal';
    const dbStage = isBonus ? 'Bonus' : paymentForm.stage;
    const chargebackNote = isChargeback ? `Chargeback — manual${paymentForm.notes ? ` · ${paymentForm.notes}` : ''}` : paymentForm.notes;

    const newEntry: PayrollEntry = {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      repId: paymentForm.repId,
      repName: rep?.name ?? '',
      projectId: isBonus ? null : (paymentForm.projectId || null),
      customerName: project?.customerName ?? '',
      amount: signedAmount,
      type: dbType,
      paymentStage: dbStage,
      status: 'Draft',
      date: paymentForm.date || localDateString(new Date()),
      notes: chargebackNote,
    };
    setPayrollEntries((prev) => [...prev, newEntry]);
    setShowPaymentModal(false);
    setPaymentForm({ type: 'Deal', repId: '', projectId: '', amount: '', stage: 'M1', date: '', notes: '' });
    setStatusTab('Draft');
    setTypeTab(isBonus ? 'Bonus' : 'Deal');
    setFilterRepId('');
    setSelectedIds(new Set());
    setAdminPage(1);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('status', 'Draft');
    nextParams.set('type', isBonus ? 'Bonus' : 'Deal');
    nextParams.delete('rep');
    router.replace(`?${nextParams.toString()}`, { scroll: false });
    paymentSubmitting.current = false;
    const label = isChargeback ? 'Chargeback' : isBonus ? 'Bonus' : 'Payment';
    toast(`${label} draft added for ${rep?.name ?? 'rep'} — $${Math.abs(signedAmount).toLocaleString()}`, 'success');
    // Persist to DB via context helper — registers temp ID in resolution map so
    // markForPayroll awaits the real DB id before sending PATCH (prevents phantom temp ID bug)
    persistPayrollEntry(newEntry);
  };

  const inputCls = 'w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-all duration-200 input-focus-glow';

  const labelCls = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider';

  // Hold the skeleton until both client-hydrate AND the API's first
  // /api/data round-trip resolve. Otherwise the page mounts with empty
  // arrays, runs its fade-in on a blank surface, and real data pops in
  // without animation — same flash behavior Dashboard + Projects
  // already avoid with this pattern.
  if (!isHydrated || !dbReady) {
    return <PayrollSkeleton />;
  }

  // ── Non-admin guard ──────────────────────────────────────────────────────────
  // Reps can view only their own entries in a read-only mode; no admin actions.
  const isAdmin = effectiveRole === 'admin';
  if (!isAdmin) {
    const myEntries = payrollEntries.filter((p) => p.repId === effectiveRepId);
    const myTypeFiltered = myEntries.filter((p) => repTypeFilter === 'All' || p.type === repTypeFilter);
    const myDraft = sumDraft(myTypeFiltered, { asOf: today });
    const myPending = sumPending(myTypeFiltered, { asOf: today });
    const myPaid = sumPaid(myTypeFiltered, { asOf: today });
    const myFiltered = myTypeFiltered
      .filter((p) => (repStatusFilter === 'All' || p.status === repStatusFilter) && (p.status !== 'Paid' || p.date <= today))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <CreditCard className="w-5 h-5 text-[var(--accent-green)]" />
          </div>
          <div>
            <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>My Payroll</h1>
            <p className="text-[var(--text-secondary)] text-sm font-medium tracking-wide">Your commission and bonus payment history</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Draft" value={myDraft} color="text-[var(--text-secondary)]" accentGradient="from-blue-500 to-blue-400" className="animate-slide-in-scale stagger-1" />
          <StatCard label="Pending" value={myPending} color="text-yellow-400" accentGradient="from-yellow-500 to-yellow-400" className="animate-slide-in-scale stagger-2" />
          <StatCard label="Paid" value={myPaid} color="text-[var(--accent-green)]" accentGradient="from-emerald-500 to-emerald-400" className="animate-slide-in-scale stagger-3" />
        </div>
        {/* Type and status filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
            {(['All', 'Deal', 'Bonus'] as const).map((t) => (
              <button key={t} onClick={() => setRepTypeFilter(t)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150"
                style={repTypeFilter === t ? { background: '#2563eb', color: '#fff' } : { color: 'var(--text-muted)' }}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
            {(['All', 'Draft', 'Pending', 'Paid'] as const).map((s) => (
              <button key={s} onClick={() => setRepStatusFilter(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150"
                style={repStatusFilter === s
                  ? s === 'Paid' ? { background: 'rgba(0,224,122,0.2)', color: 'var(--accent-green)' }
                    : s === 'Pending' ? { background: 'rgba(255,176,32,0.2)', color: 'var(--accent-amber)' }
                    : s === 'Draft' ? { background: 'rgba(77,159,255,0.2)', color: 'var(--accent-blue)' }
                    : { background: '#2563eb', color: '#fff' }
                  : { color: 'var(--text-muted)' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {myEntries.length === 0 ? (
          <div className="flex justify-center py-10">
            <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
              {/* Illustration — wallet with coins (no earnings yet) */}
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                {/* Wallet body */}
                <rect x="10" y="24" width="52" height="34" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                <rect x="10" y="30" width="52" height="4" fill="#334155"/>
                {/* Coin pocket */}
                <rect x="44" y="34" width="18" height="16" rx="4" fill="#0f172a" stroke="#334155" strokeWidth="1.5"/>
                <circle cx="53" cy="42" r="4" fill="var(--surface-card)" stroke="var(--accent-cyan)" strokeWidth="1.5" strokeOpacity="0.5"/>
                {/* Dashed lines — empty content indicator */}
                <line x1="17" y1="40" x2="36" y2="40" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                <line x1="17" y1="46" x2="30" y2="46" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                {/* Dollar sign badge */}
                <circle cx="60" cy="22" r="9" fill="var(--surface-card)" stroke="var(--accent-green)" strokeWidth="1.5" strokeOpacity="0.5"/>
                <text x="60" y="26.5" textAnchor="middle" fill="#60a5fa" fontSize="11" fontWeight="bold" fontFamily="sans-serif">$</text>
              </svg>
              <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug text-center">No payroll entries yet</p>
              <p className="text-[var(--text-muted)] text-xs leading-relaxed text-center">Your commissions and bonus payments will appear here once your admin processes them.</p>
            </div>
          </div>
        ) : myFiltered.length === 0 ? (
          <p className="text-center text-sm py-10" style={{ color: 'var(--text-muted)' }}>No entries match the selected filters.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Customer / Note</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Type</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stage</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {myFiltered.map((entry, i) => (
                  <tr key={entry.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150`} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : '#191c24' }}>
                    <td className="px-5 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {entry.type === 'Deal' && entry.customerName && entry.projectId ? (
                        <Link href={`/dashboard/projects/${entry.projectId}`} className="hover:underline" style={{ color: 'var(--accent-cyan)' }}>
                          {entry.customerName}
                        </Link>
                      ) : (
                        entry.type === 'Deal' ? entry.customerName : (entry.notes || '—')
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: entry.type === 'Bonus' ? 'rgba(168,85,247,0.15)' : 'rgba(37,99,235,0.15)', color: entry.type === 'Bonus' ? '#c084fc' : '#60a5fa' }}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)' }}>
                        {entry.paymentStage}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold" style={{ color: entry.amount < 0 ? '#ef4444' : 'var(--accent-green)', fontFamily: "'DM Serif Display', serif" }}>{fmt$(entry.amount)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded`} style={
                        entry.status === 'Paid'
                          ? { background: 'rgba(0,224,122,0.12)', color: 'var(--accent-green)' }
                          : entry.status === 'Pending'
                          ? { background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber)' }
                          : { background: 'var(--surface-card)', color: 'var(--accent-blue)' }
                      }>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-dim)' }}><RelativeDate date={entry.date} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const pendingReimCount = reimbursements.filter((r) => r.status === 'Pending').length;

  const filteredReimbursements = reimbursements.filter((r) => {
    if (!showArchivedReim && r.archivedAt) return false;
    if (showArchivedReim === 'only' && !r.archivedAt) return false;
    if (reimFilterStatus !== 'All' && r.status !== reimFilterStatus) return false;
    if (reimFilterFrom && r.date < reimFilterFrom) return false;
    if (reimFilterTo && r.date > reimFilterTo) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <CreditCard className="w-5 h-5 text-[var(--accent-green)]" />
          </div>
          <div>
            <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Financials</h1>
            <p className="text-[var(--text-secondary)] text-sm font-medium tracking-wide">Payroll and reimbursement management</p>
          </div>
        </div>
        {pageView === 'payroll' && (
          <div className="flex flex-col md:flex-row gap-2 md:gap-3 w-full md:w-auto">
            <button
              onClick={() => { paymentSubmitting.current = false; setShowPaymentModal(true); }}
              className="font-medium px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm active:scale-[0.97] whitespace-nowrap transition-colors"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              + Add Payment
            </button>
            <button
              onClick={() => setShowPublishConfirm(true)}
              disabled={totalPending === 0}
              className="font-semibold px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm shadow-lg active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#050d18' }}
            >
              Publish {typeTab} Payroll
            </button>
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
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
              title="Download filtered payroll as CSV (one row per entry)"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={() => {
                // ADP-shape CSV: one row per rep per pay period. Sums gross
                // pay (positive) and chargebacks (negative) separately so
                // deductions line up with ADP's import template.
                //
                // Pay Period From/To = min/max date in the filtered set.
                // If the user's filter spans multiple periods this
                // collapses to the outer envelope — intentional; admin
                // should filter to one period before export.
                const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
                const periodFrom = sorted[0]?.date ?? '';
                const periodTo = sorted[sorted.length - 1]?.date ?? '';

                // Group: repName → { gross, chargebacks, entries }
                const byRep = new Map<string, { gross: number; chargebacks: number; count: number }>();
                for (const e of filtered) {
                  const key = e.repName;
                  const row = byRep.get(key) ?? { gross: 0, chargebacks: 0, count: 0 };
                  if (e.amount < 0) row.chargebacks += Math.abs(e.amount);
                  else row.gross += e.amount;
                  row.count += 1;
                  byRep.set(key, row);
                }

                // ADP import template columns. Adjust per your specific
                // ADP instance — the four below are the universal core.
                const adpHeaders = ['Employee Name', 'Gross Pay', 'Deductions', 'Net Pay', 'Pay Period From', 'Pay Period To', 'Entry Count'];
                const adpRows = Array.from(byRep.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([repName, { gross, chargebacks, count }]) => [
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
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
              title="Export for ADP: one row per rep with gross/deductions/net, period-bounded"
            >
              <Download className="w-3.5 h-3.5" /> ADP
            </button>
            <button
              onClick={() => window.print()}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap print:hidden"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
              title="Print payroll summary"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        )}
      </div>

      {/* Top-level page view switcher */}
      <div className="flex gap-1 mb-8 rounded-xl p-1 w-fit tab-bar-container" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
        {pageViewIndicator && <div className="tab-indicator" style={pageViewIndicator} />}
        {(['payroll', 'reimbursements'] as PageView[]).map((v, i) => (
          <button
            key={v}
            ref={(el) => { pageViewRefs.current[i] = el; }}
            onClick={() => setPageView(v)}
            className="relative z-10 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={pageView === v
              ? {
                  background: 'linear-gradient(135deg, rgba(0, 224, 122, 0.18), rgba(0, 196, 240, 0.18))',
                  border: '1px solid rgba(0, 224, 122, 0.45)',
                  boxShadow: '0 0 12px rgba(0, 224, 122, 0.12)',
                  color: '#fff',
                  fontWeight: 600,
                }
              : { color: 'var(--text-secondary)' }
            }
          >
            {v === 'payroll' ? (
              <><CreditCard className="w-3.5 h-3.5" /> Payroll</>
            ) : (
              <><Receipt className="w-3.5 h-3.5" /> Reimbursements
                {pendingReimCount > 0 && (
                  <span className="ml-1 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">{pendingReimCount}</span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* ── Reimbursements view ──────────────────────────────────────────────── */}
      {pageView === 'reimbursements' && (
        <div key={pageView} className="animate-tab-enter">
          {/* Date + status filter */}
          <div className="flex items-center gap-3 mb-5">
            <Filter className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <select
              value={reimFilterStatus}
              onChange={(e) => setReimFilterStatus(e.target.value as 'All' | 'Pending' | 'Approved' | 'Denied')}
              className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Denied">Denied</option>
              <option value="All">All</option>
            </select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">From</label>
              <input
                type="date"
                value={reimFilterFrom}
                onChange={(e) => setReimFilterFrom(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">To</label>
              <input
                type="date"
                value={reimFilterTo}
                onChange={(e) => setReimFilterTo(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
            <select
              value={showArchivedReim === 'only' ? 'only' : showArchivedReim ? 'all' : 'active'}
              onChange={(e) => setShowArchivedReim(e.target.value === 'only' ? 'only' : e.target.value === 'all' ? true : false)}
              className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)] ml-auto"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              title="Archive visibility"
            >
              <option value="active">Active only</option>
              <option value="all">Include archived</option>
              <option value="only">Archived only</option>
            </select>
            {(reimFilterFrom || reimFilterTo || reimFilterStatus !== 'Pending') && (
              <button
                onClick={() => { setReimFilterFrom(''); setReimFilterTo(''); setReimFilterStatus('Pending'); }}
                className="text-xs text-[var(--text-muted)] hover:text-white underline transition-colors"
              >
                Clear
              </button>
            )}
            <span className="text-[var(--text-dim)] text-xs ml-auto">{filteredReimbursements.length} request{filteredReimbursements.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Rep</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Description</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Date</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Receipt</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReimbursements.map((r, i) => (
                  <tr key={r.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150`} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : '#191c24' }}>
                    <td className="px-5 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.repName}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-secondary)' }}>{r.description}</td>
                    <td className="px-5 py-3 font-semibold" style={{ color: 'var(--accent-green)', fontFamily: "'DM Serif Display', serif" }}>${r.amount.toFixed(2)}</td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{formatDate(r.date)}</td>
                    <td className="px-5 py-3 text-[var(--text-secondary)] text-xs">
                      {r.receiptUrl ? (
                        <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-cyan)] hover:underline">
                          {r.receiptName || 'Receipt'}
                        </a>
                      ) : (
                        r.receiptName || '—'
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <ReimBadge status={r.status} />
                      {r.archivedAt && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">· archived</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {(() => {
                        // Inline handler — shared by all state-transition buttons.
                        const patchReim = (updates: Partial<{ status: Reimbursement['status']; archived: boolean }>, successMsg: string, rollback: Partial<Reimbursement>) => {
                          if (processingReimIds.has(r.id)) return;
                          setProcessingReimIds((prev) => new Set(prev).add(r.id));
                          const optimistic: Partial<Reimbursement> = {};
                          if (updates.status) optimistic.status = updates.status;
                          if (updates.archived !== undefined) optimistic.archivedAt = updates.archived ? new Date().toISOString() : undefined;
                          setReimbursements((prev) => prev.map((x) => x.id === r.id ? { ...x, ...optimistic } : x));
                          fetch(`/api/reimbursements/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
                            .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(successMsg, 'success'); })
                            .catch((err) => { console.error(err); toast('Failed to persist change', 'error'); setReimbursements((prev) => prev.map((x) => x.id === r.id ? { ...x, ...rollback } : x)); })
                            .finally(() => setProcessingReimIds((prev) => { const s = new Set(prev); s.delete(r.id); return s; }));
                        };
                        const deleteReim = async () => {
                          // Native confirm — payroll page doesn't have a
                          // shared ConfirmDialog state machine. Matches the
                          // existing delete patterns elsewhere in this file.
                          const ok = window.confirm(
                            `Delete reimbursement permanently?\n\n$${r.amount.toFixed(2)} for ${r.repName}\n\nThis cannot be undone. Prefer Archive unless this is a typo.`,
                          );
                          if (!ok) return;
                          setProcessingReimIds((prev) => new Set(prev).add(r.id));
                          const snapshot = r;
                          setReimbursements((prev) => prev.filter((x) => x.id !== r.id));
                          try {
                            const res = await fetch(`/api/reimbursements/${r.id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            toast(`Reimbursement deleted`, 'success');
                          } catch (err) {
                            console.error(err);
                            toast('Failed to delete — restoring', 'error');
                            setReimbursements((prev) => [...prev, snapshot]);
                          } finally {
                            setProcessingReimIds((prev) => { const s = new Set(prev); s.delete(r.id); return s; });
                          }
                        };
                        const btnCls = 'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
                        return (
                          <div className="flex gap-2 flex-wrap">
                            {r.status === 'Pending' && (
                              <>
                                <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ status: 'Approved' }, `Reimbursement approved for ${r.repName}`, { status: 'Pending' })} className={`${btnCls} bg-emerald-900/50 hover:bg-emerald-800/60 text-[var(--accent-green)]`}>
                                  <Check className="w-3 h-3" /> Approve
                                </button>
                                <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ status: 'Denied' }, `Reimbursement denied for ${r.repName}`, { status: 'Pending' })} className={`${btnCls} bg-red-900/50 hover:bg-red-800/60 text-red-400`}>
                                  <X className="w-3 h-3" /> Deny
                                </button>
                              </>
                            )}
                            {(r.status === 'Approved' || r.status === 'Denied') && (
                              <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ status: 'Pending' }, `Reset to Pending`, { status: r.status })} className={`${btnCls} bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-secondary)] border border-[var(--border-subtle)]`}>
                                Reset
                              </button>
                            )}
                            {!r.archivedAt && (
                              <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ archived: true }, `Reimbursement archived`, { archivedAt: undefined })} className={`${btnCls} bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-muted)] border border-[var(--border-subtle)]`}>
                                Archive
                              </button>
                            )}
                            {r.archivedAt && (
                              <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ archived: false }, `Reimbursement unarchived`, { archivedAt: new Date().toISOString() })} className={`${btnCls} bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-secondary)] border border-[var(--border-subtle)]`}>
                                Unarchive
                              </button>
                            )}
                            <button disabled={processingReimIds.has(r.id)} onClick={deleteReim} className={`${btnCls} text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10`} title="Delete permanently">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
                {filteredReimbursements.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Receipt className="w-10 h-10 text-[var(--text-dim)]" />
                        <p className="text-sm font-semibold text-white">{reimbursements.length === 0 ? 'No reimbursement requests' : 'No requests match the selected filters'}</p>
                        <p className="text-xs text-[var(--text-muted)]">{reimbursements.length === 0 ? 'Reps can submit reimbursement requests from their My Pay page' : 'Try adjusting the status or date filters to find what you need'}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pageView === 'payroll' && <div key={pageView} className="animate-tab-enter">

      {/* GradCards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {/* Draft */}
        <div style={{ background: 'linear-gradient(135deg, #040c1c, #060e22)', border: '1px solid rgba(77,159,255,0.19)', borderRadius: 14, padding: '18px 22px', flex: 1 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(77,159,255,0.73)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Draft · {typeTab}</p>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: 'var(--accent-blue)', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(77,159,255,0.25)' }}>${totalDraft.toLocaleString()}</p>
          <p style={{ color: 'rgba(77,159,255,0.4)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{filteredByDateRep.filter((p) => p.status === 'Draft').length} entries</p>
        </div>
        {/* Pending */}
        <div style={{ background: 'linear-gradient(135deg, #120b00, #180e00)', border: '1px solid rgba(255,176,32,0.19)', borderRadius: 14, padding: '18px 22px', flex: 1 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,176,32,0.73)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Pending · {typeTab}</p>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: 'var(--accent-amber)', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(255,176,32,0.25)' }}>${totalPending.toLocaleString()}</p>
          <p style={{ color: 'rgba(255,176,32,0.4)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{filteredByDateRep.filter((p) => p.status === 'Pending').length} entries</p>
        </div>
        {/* Total Paid — combined across all types (Deal + Bonus + Trainer)
            by default. Matches the dashboard "Paid Out" tile when
            date/rep filters align. The per-tab breakdown is available
            in the Draft / Pending tiles beside it and in the table
            below (switchable via the Deal / Bonus tabs). */}
        <div style={{ background: 'linear-gradient(135deg, #00160d, #001c10)', border: '1px solid rgba(0,224,122,0.19)', borderRadius: 14, padding: '18px 22px', flex: 1 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,224,122,0.73)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Total Paid</p>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: 'var(--accent-green)', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(0,224,122,0.25)' }}>${combinedTotalPaid.toLocaleString()}</p>
          <p style={{ color: 'rgba(0,224,122,0.4)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{combinedPaidCount} entries · all types</p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 rounded-xl p-1 w-fit tab-bar-container" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
        {statusIndicator && <div className="tab-indicator" style={statusIndicator} />}
        {(['Draft', 'Pending', 'Paid'] as StatusTab[]).map((s, i) => (
          <button
            key={s}
            ref={(el) => { statusTabRefs.current[i] = el; }}
            onClick={() => changeStatusTab(s)}
            className="relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={statusTab === s
              ? {
                  background: 'linear-gradient(135deg, rgba(0, 224, 122, 0.18), rgba(0, 196, 240, 0.18))',
                  border: '1px solid rgba(0, 224, 122, 0.45)',
                  boxShadow: '0 0 12px rgba(0, 224, 122, 0.12)',
                  color: '#fff',
                  fontWeight: 600,
                }
              : { color: 'var(--text-secondary)' }
            }
          >
            {s}
            <span className="ml-1.5 text-xs opacity-70">
              ({filteredByDateRep.filter((p) => p.status === s && p.type === typeTab && (s !== 'Paid' || p.date <= today)).length})
            </span>
          </button>
        ))}
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-6 rounded-xl p-1 w-fit tab-bar-container" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
        {typeIndicator && <div className="tab-indicator" style={typeIndicator} />}
        {(['Deal', 'Bonus'] as TypeTab[]).map((t, i) => (
          <button
            key={t}
            ref={(el) => { typeTabRefs.current[i] = el; }}
            onClick={() => changeTypeTab(t)}
            className="relative z-10 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={typeTab === t
              ? {
                  background: 'linear-gradient(135deg, rgba(0, 224, 122, 0.18), rgba(0, 196, 240, 0.18))',
                  border: '1px solid rgba(0, 224, 122, 0.45)',
                  boxShadow: '0 0 12px rgba(0, 224, 122, 0.12)',
                  color: '#fff',
                  fontWeight: 600,
                }
              : { color: 'var(--text-muted)' }
            }
          >
            {t} Payments
          </button>
        ))}
      </div>

      {/* ── Filter bar — top of table card ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px 14px 0 0', padding: '14px 18px', borderBottom: 'none' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Rep filter */}
          <div style={{ flex: '0 0 180px' }}>
            <RepSelector
              value={filterRepId}
              onChange={(id) => changeFilterRepId(id)}
              reps={reps}
              placeholder="All Reps"
              clearLabel="All Reps"
            />
          </div>
          {/* Date filter */}
          <DateRangeFilter
            from={payFilterFrom}
            to={payFilterTo}
            onFromChange={(v) => { setPayFilterFrom(v); setAdminPage(1); setSelectedIds(new Set()); }}
            onToChange={(v) => { setPayFilterTo(v); setAdminPage(1); setSelectedIds(new Set()); }}
            onClear={() => { setPayFilterFrom(''); setPayFilterTo(''); setAdminPage(1); setSelectedIds(new Set()); }}
          />
          {/* Bulk actions (when selected) */}
          {statusTab === 'Draft' && (
            <button
              onClick={selectAll}
              className="text-xs hover:text-white underline transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              {allPageSelected ? 'Deselect All on Page' : 'Select All on Page'}
            </button>
          )}
          {/* Entry count */}
          <span style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: "'DM Sans',sans-serif", marginLeft: 'auto' }}>{filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}</span>
        </div>
        {/* Keyboard hints */}
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          {([['Enter','Mark for Payroll'],['Shift+A','Select All on Page'],['Esc','Clear']] as [string,string][]).map(([k,d]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: '2px 6px', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{k}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: "'DM Sans',sans-serif" }}>{d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Data table ── */}
      <div key={statusTab} className="animate-tab-enter">
      {filtered.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No {statusTab.toLowerCase()} {typeTab.toLowerCase()} payments</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {statusTab === 'Draft' ? (typeTab === 'Deal' ? 'Draft entries are auto-created when projects hit milestones' : 'Create a bonus entry for any rep') : statusTab === 'Pending' ? 'Select Draft entries and mark them for payroll' : 'Publish pending payroll to move entries here'}
            </p>
            {statusTab === 'Draft' && (
              <button
                onClick={() => {
                  paymentSubmitting.current = false;
                  setPaymentForm((p) => ({ ...p, type: typeTab === 'Bonus' ? 'Bonus' : 'Deal' }));
                  setShowPaymentModal(true);
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-lg transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#050d18' }}
              >
                <ArrowRight className="w-3.5 h-3.5" /> Add {typeTab === 'Bonus' ? 'Bonus' : 'Payment'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {statusTab === 'Draft' && (
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, width: 40 }}>
                    <input type="checkbox" checked={allPageSelected} onChange={selectAll} style={{ accentColor: 'var(--accent-green)', cursor: 'pointer' }} />
                  </th>
                )}
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Rep</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Type</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>{typeTab === 'Deal' ? 'Customer' : 'Note'}</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Amount</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Status</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFiltered.map((entry, i) => (
                <tr key={entry.id} style={{
                  background: selectedIds.has(entry.id) ? 'rgba(0,224,122,0.05)' : i % 2 === 0 ? 'var(--surface)' : '#191c24',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }} onClick={() => statusTab === 'Draft' && toggleEntry(entry.id)}>
                  {statusTab === 'Draft' && (
                    <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                      <input type="checkbox" checked={selectedIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: 'var(--accent-green)', cursor: 'pointer' }} />
                    </td>
                  )}
                  <td style={{ padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entry.repName}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-secondary)' }}>{entry.paymentStage}{entry.notes && typeTab === 'Deal' && (entry.notes === 'Setter' || entry.notes.startsWith('Trainer override')) ? ` (${entry.notes})` : ''}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }} onClick={(e) => e.stopPropagation()}>
                    {typeTab === 'Deal' && entry.customerName && entry.projectId ? (
                      <Link
                        href={`/dashboard/projects/${entry.projectId}`}
                        className="hover:underline"
                        style={{ color: 'var(--accent-cyan)' }}
                        title="Open project"
                      >
                        {entry.customerName}
                      </Link>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>{typeTab === 'Deal' ? entry.customerName : (entry.notes || '\u2014')}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 18, fontFamily: "'DM Sans',sans-serif", textAlign: 'right' }}><span style={{ color: 'var(--accent-green)', fontWeight: 700, fontFamily: "'DM Serif Display',serif" }}>{fmt$(entry.amount)}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-muted)' }}><RelativeDate date={entry.date} /></span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>
                    <span style={
                      entry.status === 'Paid'
                        ? { background: 'rgba(0,224,122,0.12)', color: 'var(--accent-green)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                        : entry.status === 'Pending'
                        ? { background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                        : { background: 'rgba(77,159,255,0.12)', color: 'var(--accent-blue)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                    }>{entry.status}</span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 12, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' as const, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      {entry.status !== 'Paid' && (
                        <button
                          disabled={processingEntryIds.has(entry.id)}
                          onClick={() => openEditEntry(entry)}
                          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                          title="Edit amount / date / notes"
                        >
                          Edit
                        </button>
                      )}
                      {entry.status === 'Pending' && (
                        <button
                          disabled={processingEntryIds.has(entry.id)}
                          onClick={() => handleReverseEntry(entry)}
                          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--accent-amber)' }}
                          title="Move back to Draft"
                        >
                          Reverse
                        </button>
                      )}
                      {entry.status !== 'Paid' && (
                        <button
                          disabled={processingEntryIds.has(entry.id)}
                          onClick={() => handleDeleteEntry(entry)}
                          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40 hover:text-red-400 hover:bg-red-500/10"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-dim)' }}
                          title="Delete entry"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > adminRowsPerPage && (
          <div className="card-surface rounded-2xl overflow-hidden mt-4">
            <PaginationBar
              totalResults={filtered.length}
              startIdx={adminStartIdx}
              endIdx={adminEndIdx}
              currentPage={adminPage}
              totalPages={adminTotalPages}
              rowsPerPage={adminRowsPerPage}
              onPageChange={setAdminPage}
              onRowsPerPageChange={(n) => { setAdminRowsPerPage(n); setAdminPage(1); }}
            />
          </div>
        )}
        </>
      )}
      </div> {/* end key={statusTab} */}

      </div> /* end pageView === 'payroll' */}

      {/* Publish Confirm Modal */}
      {showPublishConfirm && (() => {
        const pendingEntries = filteredByDateRep.filter((p) => p.status === 'Pending' && p.date <= today);
        // Build a per-rep summary sorted descending by total payout
        const repSummary = Array.from(
          pendingEntries.reduce((map, e) => {
            if (!map.has(e.repId)) map.set(e.repId, { name: e.repName, total: 0, count: 0 });
            const rec = map.get(e.repId)!;
            rec.total += e.amount;
            rec.count += 1;
            return map;
          }, new Map<string, { name: string; total: number; count: number }>())
        )
          .map(([id, v]) => ({ ...v, id }))
          .sort((a, b) => b.total - a.total);

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
            <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-yellow-900/30">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                </div>
                <h2 className="text-white font-semibold text-lg">Publish Payroll?</h2>
              </div>
              <p className="text-[var(--text-secondary)] text-sm mb-3">
                This will mark <span className="text-yellow-400 font-semibold">{pendingEntries.length} pending {typeTab.toLowerCase()} {pendingEntries.length === 1 ? 'entry' : 'entries'}</span> as <span className="text-[var(--accent-green)] font-semibold">Paid</span>. Only <span className="text-yellow-400 font-semibold">{typeTab}</span> entries are affected. This action cannot be undone.
              </p>
              {filterRepId && (() => {
                const filteredRepName = reps.find((r) => r.id === filterRepId)?.name ?? 'selected rep';
                return (
                  <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-3 py-2.5 mb-3">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-yellow-300 text-xs leading-relaxed">
                      <span className="font-semibold">Rep filter is active.</span> Only entries for <span className="font-semibold">{filteredRepName}</span> will be published. Other reps&apos; Pending entries will not be affected.
                    </p>
                  </div>
                );
              })()}

              {(payFilterFrom || payFilterTo) && (
                <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-3 py-2.5 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-yellow-300 text-xs leading-relaxed">
                    <span className="font-semibold">Date filter is active.</span> Only entries{payFilterFrom && <> from <span className="font-semibold">{payFilterFrom}</span></>}{payFilterTo && <> to <span className="font-semibold">{payFilterTo}</span></>} will be published. Pending entries outside this date range will not be affected.
                  </p>
                </div>
              )}

              {/* Per-rep breakdown */}
              {repSummary.length > 0 && (
                <div className="bg-[var(--surface-card)]/60 border border-[var(--border)]/60 rounded-xl mb-5 overflow-hidden">
                  <div className="px-4 py-2 border-b border-[var(--border)]/60 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Payout Breakdown</span>
                    <span className="text-xs text-[var(--text-muted)]">{repSummary.length} rep{repSummary.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-slate-800/60 max-h-48 overflow-y-auto">
                    {repSummary.map((rep) => (
                      <div key={rep.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-white text-sm font-medium">{rep.name}</p>
                          <p className="text-[var(--text-muted)] text-xs">{rep.count} {rep.count === 1 ? 'entry' : 'entries'}</p>
                        </div>
                        <span className="text-[var(--accent-green)] font-bold tabular-nums">${rep.total.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2.5 border-t border-[var(--border)]/60 flex items-center justify-between bg-[var(--surface-card)]/40">
                    <span className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Total</span>
                    <span className="text-white font-black tabular-nums">${pendingEntries.reduce((s, e) => s + e.amount, 0).toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handlePublish}
                  disabled={publishingPayroll}
                  className="btn-primary flex-1 text-black font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {publishingPayroll ? 'Publishing…' : 'Publish Payroll'}
                </button>
                <button
                  onClick={() => setShowPublishConfirm(false)}
                  className="btn-secondary flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-white font-medium py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bonus Modal */}
      {/* Spacer so content is never hidden behind the fixed action bar */}
      {showActionBar && <div className="h-20" />}

      {/* Manual Payment Modal */}
      {showPaymentModal && (() => {
        const isBonus = paymentForm.type === 'Bonus';
        const isChargeback = paymentForm.type === 'Chargeback';
        const closeAndReset = () => {
          setShowPaymentModal(false);
          setPaymentForm({ type: 'Deal', repId: '', projectId: '', amount: '', stage: 'M1', date: '', notes: '' });
        };
        const titleFor = isChargeback ? 'Chargeback' : isBonus ? 'Bonus' : 'Payment';
        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
          <div ref={paymentPanelRef} className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">Add {titleFor}</h2>
              <button onClick={closeAndReset} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddPayment} className="space-y-4">
              {/* Type toggle — Deal (project + stage) / Bonus (rep + amount only)
                  / Chargeback (project-linked, stored as negative Deal).
                  Mirrors the unified mobile pattern; replaces the old two-modal split. */}
              <div>
                <label className={labelCls}>Type</label>
                <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                  {(['Deal', 'Bonus', 'Chargeback'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPaymentForm((p) => ({ ...p, type: t }))}
                      className={`flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${paymentForm.type === t ? (t === 'Chargeback' ? 'text-white' : 'text-black') : 'text-[var(--text-secondary)]'}`}
                      style={{ background: paymentForm.type === t ? (t === 'Chargeback' ? 'var(--accent-red, #ef4444)' : 'var(--brand)') : 'transparent' }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {isChargeback && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1.5">Enter the positive dollar amount to claw back. Stored as a negative Draft entry — admin controls when it actually hits payroll.</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Rep</label>
                <RepSelector
                  value={paymentForm.repId}
                  onChange={(repId) => setPaymentForm((p) => ({ ...p, repId, projectId: '' }))}
                  reps={reps}
                  filterFn={(r) => r.active !== false}
                  placeholder="— Select rep —"
                  clearLabel="— Select rep —"
                />
              </div>
              {!isBonus && (
                <div>
                  <label className={labelCls}>Project</label>
                  <SearchableSelect
                    value={paymentForm.projectId}
                    onChange={(val) => setPaymentForm((p) => ({ ...p, projectId: val }))}
                    options={projects
                      .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
                      .filter((p) => !paymentForm.repId || p.repId === paymentForm.repId || p.setterId === paymentForm.repId)
                      .map((p) => ({ value: p.id, label: `${p.customerName} — ${p.installer} (${p.kWSize} kW) [${p.phase}]` }))}
                    placeholder="— Select project (optional) —"
                  />
                </div>
              )}
              <div className={isBonus ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className={labelCls}>Amount ($)</label>
                  <input required type="number" min="0.01" step="0.01"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))}
                    className={inputCls} />
                </div>
                {!isBonus && (
                  <div>
                    <label className={labelCls}>Stage</label>
                    <SearchableSelect
                      value={paymentForm.stage}
                      onChange={(val) => setPaymentForm((p) => ({ ...p, stage: val as 'M1' | 'M2' | 'M3' }))}
                      options={[
                        { value: 'M1', label: 'M1' },
                        { value: 'M2', label: 'M2' },
                        { value: 'M3', label: 'M3' },
                      ]}
                      placeholder="Select stage"
                      searchable={false}
                    />
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>{isBonus ? 'Date' : isChargeback ? 'Date' : 'Pay Date'}</label>
                <input type="date" value={paymentForm.date}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input type="text" placeholder={isBonus ? 'e.g. Monthly performance bonus' : isChargeback ? 'e.g. Deal cancelled by homeowner — M2 claw-back' : 'e.g. Additional payment — special circumstance'}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, notes: e.target.value }))}
                  className={inputCls + ' placeholder-slate-500'} />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit"
                  className={`flex-1 font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97] ${isChargeback ? 'text-white' : 'btn-primary text-black'}`}
                  style={{ backgroundColor: isChargeback ? 'var(--accent-red, #ef4444)' : 'var(--brand)' }}>
                  Add {titleFor}
                </button>
                <button type="button" onClick={closeAndReset}
                  className="btn-secondary flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-white font-medium py-2.5 rounded-xl text-sm active:scale-[0.97]">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* Row-level Edit modal — amount / date / notes (status is changed
          via the row buttons, not here). Paid entries are blocked at the
          open-modal step. */}
      {editingEntry && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
          <div ref={editEntryPanelRef} className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">Edit {editingEntry.type} Entry</h2>
              <button onClick={() => setEditingEntry(null)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[var(--text-muted)] text-xs mb-4">{editingEntry.repName} — {editingEntry.paymentStage}{editingEntry.customerName ? ` · ${editingEntry.customerName}` : ''}</p>
            <form onSubmit={handleSaveEditEntry} className="space-y-4">
              <div>
                <label className={labelCls}>Amount ($)</label>
                <input required type="number" min={editingEntry.amount < 0 ? undefined : "0.01"} step="0.01"
                  value={editEntryForm.amount}
                  onChange={(e) => setEditEntryForm((f) => ({ ...f, amount: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" value={editEntryForm.date}
                  onChange={(e) => setEditEntryForm((f) => ({ ...f, date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input type="text"
                  value={editEntryForm.notes}
                  onChange={(e) => setEditEntryForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls + ' placeholder-slate-500'} />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit"
                  className="btn-primary flex-1 text-black font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97]"
                  style={{ backgroundColor: 'var(--brand)' }}>
                  Save Changes
                </button>
                <button type="button" onClick={() => setEditingEntry(null)}
                  className="btn-secondary flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-white font-medium py-2.5 rounded-xl text-sm active:scale-[0.97]">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Floating batch-action toolbar ────────────────────────────────────
           Glass-morphism pill centred at the viewport bottom. Mounts with a
           spring-eased slide-up entrance whenever one or more Draft entries are
           selected. React unmounts it on deselection so the entrance animation
           fires fresh each time. Escape key and the × button both clear the
           selection.                                                            */}
      {actionBarMounted && (
        <div
          className="fixed bottom-6 left-1/2 z-30 backdrop-blur-xl bg-[var(--surface)]/80 border border-[var(--border)]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40"
          role="toolbar"
          aria-label="Batch actions for selected entries"
          style={{
            transition: 'transform 260ms cubic-bezier(0.16,1,0.3,1), opacity 220ms ease',
            transform: actionBarVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(20px)',
            opacity: actionBarVisible ? 1 : 0,
          }}
        >
          <div className="flex items-center gap-3">

            {/* Selection count badge — blue accent pill */}
            <span className="flex items-center gap-1.5 bg-[var(--accent-green)]/15 border border-[var(--accent-green)]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
              <span key={selectedIds.size} className="text-white font-bold tabular-nums animate-badge-pop">{selectedIds.size}</span>
              <span className="text-[var(--accent-green)] font-medium">selected</span>
              {selectedTotal > 0 && (
                <>
                  <span className="text-[var(--text-dim)] mx-0.5">·</span>
                  <span key={selectedTotal} className="text-[var(--accent-green)] font-semibold tabular-nums animate-badge-pop">${selectedTotal.toLocaleString()}</span>
                </>
              )}
            </span>

            {/* Visual divider */}
            <div className="h-5 w-px bg-[var(--border)]/80 flex-shrink-0" />

            {/* Mark for Payroll — primary action (always Draft context when bar is visible) */}
            {statusTab === 'Draft' && (
              <button
                onClick={handleMarkForPayroll}
                disabled={markingForPayroll}
                className="btn-primary text-black font-semibold px-4 py-1.5 rounded-xl text-sm shadow-lg shadow-blue-500/20 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Mark for Payroll →
              </button>
            )}

            {/* Dismiss / deselect-all × button */}
            <button
              onClick={() => setSelectedIds(new Set())}
              aria-label="Deselect all and dismiss toolbar"
              className="btn-secondary p-1.5 rounded-lg bg-[var(--border)]/60 hover:bg-[var(--text-dim)]/80 border border-[var(--border)]/40 text-[var(--text-secondary)] hover:text-white transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>

          </div>
        </div>
      )}
    </div>
  );
}


