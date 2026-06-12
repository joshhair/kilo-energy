'use client';

import { useState, useRef, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { SegmentedPills } from '../../../components/ui';
import { PaymentTypeBadge } from '../../../components/ui/PaymentTypeBadge';
import { useIsHydrated, useFocusTrap, useMediaQuery } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { PayrollEntry, Reimbursement } from '../../../lib/data';
import { formatDate, downloadCSV, fmt$, localDateString, todayLocalDateStr } from '../../../lib/utils';
import { sumPaid, sumPending, sumDraft, breakdownByType } from '../../../lib/aggregators';
import { RelativeDate } from '../components/RelativeDate';
import { X, CreditCard, AlertTriangle, ArrowRight, Download, Printer, Trash2, ChevronDown } from 'lucide-react';
import { PaginationBar } from '../components/PaginationBar';
import { RepSelector } from '../components/RepSelector';
import { DateRangeFilter } from '../components/DateRangeFilter';
import ConfirmDialog from '../components/ConfirmDialog';
import PaidCorrectionModal from '../components/PaidCorrectionModal';
import Link from 'next/link';
import MobilePayroll from '../mobile/MobilePayroll';
import { PayrollSkeleton } from './components/PayrollSkeleton';
import { StatCard } from './components/StatCard';
import { GradCards } from './components/GradCards';
import { ReimbursementsView } from './components/ReimbursementsView';
import { ManualPaymentModal } from './components/ManualPaymentModal';
import { EditEntryModal } from './components/EditEntryModal';

type StatusTab = 'Draft' | 'Pending' | 'Paid';
type TypeTab = 'All' | 'Deal' | 'Bonus' | 'Trainer' | 'Charge';

// Classifies a PayrollEntry into one of the four type kinds (excluding
// 'All', which is the no-filter sentinel). Order of precedence:
//   1. Standalone one-off charge (chargeCategory set)        → 'Charge'
//   2. Trainer override stored as type='Deal'+stage='Trainer' → 'Trainer'
//   3. Bonus row                                              → 'Bonus'
//   4. Anything else (regular milestone deal)                 → 'Deal'
// Trainer overrides land at #2 because legacy rows pre-date the explicit
// chargeCategory field; bonus check at #3 covers the operator-recorded
// post-window bonuses. 2026-04-23, extended 2026-05-21 for Charge.
function entryTypeTab(entry: { type?: string; paymentStage?: string; chargeCategory?: string | null }): Exclude<TypeTab, 'All'> {
  if (entry.chargeCategory != null) return 'Charge';
  if (entry.paymentStage === 'Trainer') return 'Trainer';
  if (entry.type === 'Bonus') return 'Bonus';
  return 'Deal';
}
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
}
@keyframes slideInFromRight {
  from { opacity: 0; transform: translateX(18px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes slideInFromLeft {
  from { opacity: 0; transform: translateX(-18px); }
  to   { opacity: 1; transform: translateX(0); }
}
.animate-tab-forward  { animation: slideInFromRight 220ms cubic-bezier(0.16,1,0.3,1) both; }
.animate-tab-backward { animation: slideInFromLeft  220ms cubic-bezier(0.16,1,0.3,1) both; }
@media (prefers-reduced-motion: reduce) {
  .animate-tab-forward, .animate-tab-backward { animation: none; }
}
@keyframes rowExitFade {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-3px); }
}
.animate-row-exit {
  animation: rowExitFade 120ms cubic-bezier(0.4, 0, 1, 1) forwards;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .animate-row-exit { animation: none; opacity: 0; }
}`;


export default function PayrollPage() {
  return (
    <Suspense>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <PayrollPageInner />
    </Suspense>
  );
}

const TAB_IDX: Record<StatusTab, number> = { Draft: 0, Pending: 1, Paid: 2 };
const PAGE_IDX: Record<PageView, number> = { payroll: 0, reimbursements: 1 };

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
  const initialView = (searchParams.get('view') === 'reimbursements' ? 'reimbursements' : 'payroll') as PageView;
  const initialPage = (() => {
    const p = searchParams.get('page');
    return p ? Math.max(1, parseInt(p, 10) || 1) : 1;
  })();
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';

  const [pageView, setPageView] = useState<PageView>(initialView);
  const [tabDir, setTabDir] = useState<'forward' | 'backward'>('forward');
  const [pageDir, setPageDir] = useState<'forward' | 'backward'>('forward');
  const [statusTab, setStatusTab] = useState<StatusTab>(['Draft', 'Pending', 'Paid'].includes(initialStatus) ? initialStatus : 'Draft');
  const [typeTab, setTypeTab] = useState<TypeTab>((['All', 'Deal', 'Bonus', 'Trainer', 'Charge'] as const).includes(initialType as TypeTab) ? (initialType as TypeTab) : 'All');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Which reps are expanded in the grouped payroll table. Default:
  // all collapsed (one summary row per rep). Josh flagged the flat
  // table as overwhelming when a rep has many entries; clicking a
  // summary row expands into the per-entry breakdown.
  const [expandedRepIds, setExpandedRepIds] = useState<Set<string>>(new Set());
  const [collapsingRepIds, setCollapsingRepIds] = useState<Set<string>>(new Set());
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const [actionBarMounted, setActionBarMounted] = useState(false);
  const [actionBarVisible, setActionBarVisible] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const paymentSubmitting = useRef(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishingPayroll, setPublishingPayroll] = useState(false);
  const publishingPayrollRef = useRef(false);
  // Which Pending entries are checked for publish in the confirm modal.
  // Initialized on modal open: past + today checked, future unchecked.
  // User can override per row before confirming.
  const [publishSelectedIds, setPublishSelectedIds] = useState<Set<string>>(new Set());
  const [markingForPayroll, setMarkingForPayroll] = useState(false);
  const markingForPayrollRef = useRef(false);
  // Unified add-payment form — covers Deal (requires project + stage) and
  // Bonus (just amount + notes + date). Toggle in the modal switches the
  // field set. Replaced the standalone Add Bonus modal in Batch 4.
  const [paymentForm, setPaymentForm] = useState({
    type: 'Deal' as 'Deal' | 'Bonus' | 'Chargeback' | 'Charge',
    repId: '',
    projectId: '',
    amount: '',
    stage: 'M1' as 'M1' | 'M2' | 'M3',
    date: '',
    notes: '',
    // Standalone-charge category — only meaningful when type==='Charge'.
    chargeCategory: 'misc' as 'equipment_damage' | 'reimbursement_clawback' | 'customer_dispute' | 'misc',
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

  // Paid-correction modal (admin-only retroactive edit of Paid entries).
  // Distinct from the 24h grace-window Paid→Pending reversal — this
  // handles the case where the recorded amount diverged from what was
  // actually paid (Glide-import typos, kW changes, manual entry errors).
  const [paidCorrectionEntry, setPaidCorrectionEntry] = useState<PayrollEntry | null>(null);
  const editEntryPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(editEntryPanelRef, editingEntry !== null);

  // Reimbursements date filter
  const [reimFilterFrom, setReimFilterFrom] = useState('');
  const [reimFilterTo, setReimFilterTo] = useState('');
  const [reimFilterStatus, setReimFilterStatus] = useState<'All' | 'Pending' | 'Approved' | 'Denied'>('Pending');
  const [processingReimIds, setProcessingReimIds] = useState<Set<string>>(new Set());
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<PayrollEntry | null>(null);
  const [pendingDeleteReim, setPendingDeleteReim] = useState<Reimbursement | null>(null);
  // Archived-visibility toggle for reimbursements.
  //   false  → hide archived (default)
  //   true   → show everything (archived mixed in)
  //   'only' → show only archived
  const [showArchivedReim, setShowArchivedReim] = useState<false | true | 'only'>(false);

  // Rep-view filters (non-admin)
  const [repTypeFilter, setRepTypeFilter] = useState<'All' | 'Deal' | 'Bonus' | 'Trainer' | 'Charge'>('All');
  const [repStatusFilter, setRepStatusFilter] = useState<'All' | 'Draft' | 'Pending' | 'Paid'>('All');

  // Payroll entries date filter
  const [payFilterFrom, setPayFilterFrom] = useState(initialFrom);
  const [payFilterTo, setPayFilterTo] = useState(initialTo);

  // Pagination for admin payroll table
  const [adminPage, setAdminPage] = useState(initialPage);
  const [adminRowsPerPage, setAdminRowsPerPage] = useState(25);

  // Rep filter (admin)
  const [filterRepId, setFilterRepId] = useState(initialRep);

  // Re-sync state when browser back/forward changes searchParams.
  // Covers: status tab, type tab, rep filter, page-view (payroll vs
  // reimbursements), admin page number, date range. Everything Josh
  // might want to preserve across a refresh lives in the URL.
  useEffect(() => {
    const s = (searchParams.get('status') ?? 'Draft') as StatusTab;
    const t = (searchParams.get('type') ?? 'Deal') as TypeTab;
    const r = searchParams.get('rep') ?? '';
    const v = (searchParams.get('view') ?? 'payroll') as PageView;
    const pageStr = searchParams.get('page');
    const from = searchParams.get('from') ?? '';
    const to = searchParams.get('to') ?? '';
    setStatusTab(['Draft', 'Pending', 'Paid'].includes(s) ? s : 'Draft');
    setTypeTab(['All', 'Deal', 'Bonus', 'Trainer', 'Charge'].includes(t) ? t : 'Deal');
    setFilterRepId(r);
    setPageView(v === 'reimbursements' ? 'reimbursements' : 'payroll');
    const parsedPage = pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1;
    setAdminPage(parsedPage);
    setPayFilterFrom(from);
    setPayFilterTo(to);
    setSelectedIds(new Set());
  }, [searchParams]);

  // Sync state → URL. Only the params that changed get written so the
  // URL stays clean (no page=1, no from=, etc on default-value state).
  // router.replace keeps the existing entry in history rather than
  // adding one per keystroke in the date picker.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (pageView === 'reimbursements') params.set('view', 'reimbursements'); else params.delete('view');
    if (adminPage > 1) params.set('page', String(adminPage)); else params.delete('page');
    if (payFilterFrom) params.set('from', payFilterFrom); else params.delete('from');
    if (payFilterTo) params.set('to', payFilterTo); else params.delete('to');
    const nextQs = params.toString();
    const currentQs = searchParams.toString();
    if (nextQs !== currentQs) {
      router.replace(nextQs ? `?${nextQs}` : '?', { scroll: false });
    }
    // Intentional: effect runs whenever persisted state changes — searchParams
    // comes from the router itself and we only read it for diffing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageView, adminPage, payFilterFrom, payFilterTo]);

  // Wrappers that sync tab/filter state to URL params
  const changeStatusTab = (v: StatusTab) => {
    setTabDir(TAB_IDX[v] >= TAB_IDX[statusTab] ? 'forward' : 'backward');
    setStatusTab(v);
    setSelectedIds(new Set());
    setExpandedRepIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const changeTypeTab = (v: TypeTab) => {
    setTypeTab(v);
    setSelectedIds(new Set());
    setExpandedRepIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const changeFilterRepId = (v: string) => {
    setFilterRepId(v);
    setSelectedIds(new Set());
    setExpandedRepIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set('rep', v); else params.delete('rep');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Sliding tab indicators are owned by SegmentedPills.

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

  const { filtered, filteredByDateRep, allTypesInScope, combinedTotalPaid, combinedPaidCount, draftBreakdown, pendingBreakdown, paidBreakdown, draftCount, combinedPendingCount } = useMemo(() => {
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
      if (typeTab !== 'All' && entryTypeTab(p) !== typeTab) continue;
      filteredByDateRep.push(p);

      if (p.status === statusTab && (statusTab !== 'Paid' || p.date <= today)) {
        filtered.push(p);
      }
    }

    // Combined across all types (Deal + Bonus + Trainer + Charge) — the summary-
    // card view admins scan at a glance. Cards always show combined so
    // the top-line number doesn't lie about what's owed across all types.
    // The per-type tab below still filters the row list for drill-down.
    const combinedTotalPaid = sumPaid(allTypesInScope, { asOf: today });
    const combinedPaidCount = allTypesInScope.filter((p) => p.status === 'Paid' && p.date <= today).length;
    const draftBreakdown = breakdownByType(allTypesInScope, 'Draft', { asOf: today });
    const pendingBreakdown = breakdownByType(allTypesInScope, 'Pending', { asOf: today });
    const paidBreakdown = breakdownByType(allTypesInScope, 'Paid', { asOf: today });
    const draftCount = allTypesInScope.filter((p) => p.status === 'Draft').length;
    const combinedPendingCount = allTypesInScope.filter((p) => p.status === 'Pending').length;

    return { filtered, filteredByDateRep, allTypesInScope, combinedTotalPaid, combinedPaidCount, draftBreakdown, pendingBreakdown, paidBreakdown, draftCount, combinedPendingCount };
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

  // When the publish modal opens, default-select every Pending entry whose
  // pay date is today or earlier. Future-dated entries stay unchecked so
  // admins must explicitly opt in to publish them early. Reset on close.
  useEffect(() => {
    if (!showPublishConfirm) {
      setPublishSelectedIds(new Set());
      return;
    }
    const defaults = new Set<string>();
    for (const p of allTypesInScope) {
      if (p.status === 'Pending' && p.date <= today) defaults.add(p.id);
    }
    setPublishSelectedIds(defaults);
  }, [showPublishConfirm, allTypesInScope, today]);

  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // Hold the skeleton until both client-hydrate AND the API's first
  // /api/data round-trip resolve. Otherwise the page mounts with empty
  // arrays, runs its fade-in on a blank surface, and real data pops in
  // without animation — same flash behavior Dashboard + Projects
  // already avoid with this pattern.
  if (!isHydrated || !dbReady) {
    return <PayrollSkeleton />;
  }

  if (isMobile) return <MobilePayroll />;

  // Group ALL filtered entries by rep so each rep shows their full total
  // regardless of how many pages their entries would have spanned before.
  const groupedByRep = (() => {
    const map = new Map<string, { repId: string; repName: string; entries: typeof filtered; total: number }>();
    for (const entry of filtered) {
      const key = entry.repId;
      const existing = map.get(key);
      if (existing) {
        existing.entries.push(entry);
        existing.total += entry.amount;
      } else {
        map.set(key, { repId: key, repName: entry.repName, entries: [entry], total: entry.amount });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.entries.length - a.entries.length || a.repName.localeCompare(b.repName));
  })();

  // Paginate the groups (one summary row per rep) rather than raw entries.
  const adminTotalPages = Math.max(1, Math.ceil(groupedByRep.length / adminRowsPerPage));
  const adminStartIdx = (adminPage - 1) * adminRowsPerPage;
  const adminEndIdx = Math.min(adminStartIdx + adminRowsPerPage, groupedByRep.length);
  const paginatedGroups = groupedByRep.slice(adminStartIdx, adminEndIdx);
  // Flat entry list for the visible groups — drives header checkbox and Shift+A.
  const paginatedFiltered = paginatedGroups.flatMap((g) => g.entries);
  // Header checkbox state: considers only the visible page entries.
  const allPageSelected = paginatedFiltered.length > 0 && paginatedFiltered.every((e) => selectedIds.has(e.id));

  const toggleRepExpanded = (repId: string) => {
    if (expandedRepIds.has(repId)) {
      setCollapsingRepIds((prev) => new Set(prev).add(repId));
      setTimeout(() => {
        setExpandedRepIds((prev) => { const s = new Set(prev); s.delete(repId); return s; });
        setCollapsingRepIds((prev) => { const s = new Set(prev); s.delete(repId); return s; });
      }, 120);
    } else {
      setExpandedRepIds((prev) => new Set(prev).add(repId));
    }
  };
  const allGroupEntrySelected = (entries: typeof paginatedFiltered): boolean =>
    entries.length > 0 && entries.every((e) => selectedIds.has(e.id));
  const toggleGroupSelection = (entries: typeof paginatedFiltered) => {
    const ids = entries.map((e) => e.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) { for (const id of ids) next.delete(id); } else { for (const id of ids) next.add(id); }
      return next;
    });
  };

  const handlePublish = async () => {
    if (publishingPayrollRef.current) return;
    publishingPayrollRef.current = true;
    setPublishingPayroll(true);
    // Publish the entries the user explicitly checked in the modal.
    // Defaults exclude future-dated entries, but the user can opt them in.
    const pendingVisible = allTypesInScope.filter((e) => e.status === 'Pending' && publishSelectedIds.has(e.id));
    const ids = pendingVisible.map((e) => e.id);
    const amount = pendingVisible.reduce((s, e) => s + e.amount, 0);
    setPayrollEntries((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Paid' } : p))
    );
    setShowPublishConfirm(false);
    setAdminPage(1);
    changeStatusTab('Paid');
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
        changeStatusTab('Pending');
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
      changeStatusTab('Pending');
      toast(`Payroll failed to save — rolled back`, 'error');
    } finally {
      publishingPayrollRef.current = false;
      setPublishingPayroll(false);
    }
  };

  const handleMarkForPayroll = async () => {
    if (markingForPayrollRef.current) return;
    markingForPayrollRef.current = true;
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
      markingForPayrollRef.current = false;
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

  const handleDeleteEntry = (entry: PayrollEntry) => {
    if (entry.status === 'Paid') { toast('Paid entries cannot be deleted', 'error'); return; }
    setPendingDeleteEntry(entry);
  };

  const confirmDeleteEntry = async () => {
    const entry = pendingDeleteEntry;
    if (!entry) return;
    setPendingDeleteEntry(null);
    if (processingEntryIds.has(entry.id)) return;
    setProcessingEntryIds((prev) => new Set(prev).add(entry.id));
    const snapshot = entry;
    let snapshotIndex = -1;
    setPayrollEntries((prev) => { snapshotIndex = prev.findIndex((e) => e.id === entry.id); return prev.filter((e) => e.id !== entry.id); });
    setSelectedIds((prev) => { const s = new Set(prev); s.delete(entry.id); return s; });
    try {
      const res = await fetch(`/api/payroll/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Entry deleted', 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to delete — restoring', 'error');
      setPayrollEntries((prev) => { const next = [...prev]; next.splice(snapshotIndex === -1 ? prev.length : snapshotIndex, 0, snapshot); return next; });
    } finally {
      setProcessingEntryIds((prev) => { const s = new Set(prev); s.delete(entry.id); return s; });
    }
  };

  const confirmDeleteReim = async () => {
    const reim = pendingDeleteReim;
    if (!reim) return;
    setPendingDeleteReim(null);
    setProcessingReimIds((prev) => new Set(prev).add(reim.id));
    let snapshotIndex = -1;
    setReimbursements((prev) => {
      snapshotIndex = prev.findIndex((x) => x.id === reim.id);
      return prev.filter((x) => x.id !== reim.id);
    });
    try {
      const res = await fetch(`/api/reimbursements/${reim.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Reimbursement deleted', 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to delete — restoring', 'error');
      setReimbursements((prev) => {
        const next = [...prev];
        next.splice(snapshotIndex === -1 ? next.length : snapshotIndex, 0, reim);
        return next;
      });
    } finally {
      setProcessingReimIds((prev) => { const s = new Set(prev); s.delete(reim.id); return s; });
    }
  };

  const openEditEntry = (entry: PayrollEntry) => {
    if (entry.status === 'Paid') {
      // Admin path: open the dedicated paid-correction modal which
      // surfaces both intents (data correction vs. real-money chargeback)
      // and routes each to the right server endpoint.
      // Non-admin path: the original toast — the surface is admin-only
      // at the API layer regardless, but a clearer no-op message here
      // saves a confused round-trip.
      if (effectiveRole === 'admin') {
        setPaidCorrectionEntry(entry);
      } else {
        toast('Paid entries cannot be edited — ask an admin to correct or add a chargeback.', 'error');
      }
      return;
    }
    setEditEntryForm({
      amount: String(entry.amount),
      date: entry.date,
      notes: entry.notes ?? '',
    });
    setEditingEntry(entry);
  };

  const handlePaidCorrected = (updated: PayrollEntry) => {
    setPayrollEntries((prev) => prev.map((e) => e.id === updated.id ? updated : e));
  };

  const openChargebackForEntry = (entry: PayrollEntry) => {
    // Pre-fill the existing unified add-payment form in Chargeback mode
    // with the entry's rep + project so the admin doesn't have to re-pick.
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
    setShowPaymentModal(true);
  };

  const handleSaveEditEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    const amt = parseFloat(editEntryForm.amount);
    const isChargebackEntry = editingEntry.amount < 0;
    if (!Number.isFinite(amt) || amt === 0 || (isChargebackEntry ? amt > 0 : amt < 0)) { toast(isChargebackEntry ? 'Chargeback amount must be negative' : 'Amount must be greater than $0', 'error'); return; }
    if (!editEntryForm.date) { toast('Date is required', 'error'); return; }
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
    const isCharge = paymentForm.type === 'Charge';
    const project = (!isBonus && !isCharge) ? projects.find((p) => p.id === paymentForm.projectId) : undefined;

    // Manual chargebacks are project-scoped clawbacks — the server requires
    // a chargebackOfId, chargeCategory, OR projectId. The payroll-page flow
    // supplies the projectId, so guard it here with a clear message rather
    // than letting the request fail with the generic "failed to save" toast.
    if (isChargeback && !paymentForm.projectId) { paymentSubmitting.current = false; toast('Select the deal to charge back', 'error'); return; }

    if (!isBonus && !isCharge && paymentForm.stage === 'M3') {
      if (!paymentForm.projectId || !project) { paymentSubmitting.current = false; toast('M3 payments require a linked project', 'error'); return; }
      const installerName = project.installer ?? '';
      const payPct = installerPayConfigs[installerName]?.installPayPct ?? 100;
      if (payPct >= 100) { paymentSubmitting.current = false; toast('M3 payments are only allowed for installers with a partial install payment percentage (installPayPct < 100)', 'error'); return; }
    }

    // Negative-amount entries (chargebacks + standalone charges) — admin
    // enters the positive dollar amount for UX, we negate before persisting.
    const rawAmount = parseFloat(paymentForm.amount);
    const signedAmount = (isChargeback || isCharge) ? -rawAmount : rawAmount;
    const dbType: 'Deal' | 'Bonus' = isBonus ? 'Bonus' : 'Deal';
    const dbStage: PayrollEntry['paymentStage'] =
      isBonus ? 'Bonus' : isCharge ? 'Charge' : paymentForm.stage;
    const chargebackNote = isChargeback
      ? `Chargeback — manual${paymentForm.notes ? ` · ${paymentForm.notes}` : ''}`
      : paymentForm.notes;

    const newEntry: PayrollEntry = {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      repId: paymentForm.repId,
      repName: rep?.name ?? '',
      projectId: (isBonus || isCharge) ? null : (paymentForm.projectId || null),
      customerName: project?.customerName ?? '',
      amount: signedAmount,
      type: dbType,
      paymentStage: dbStage,
      status: 'Draft',
      date: paymentForm.date || localDateString(new Date()),
      notes: chargebackNote,
      isChargeback: isChargeback || isCharge,
      chargebackOfId: null,
      chargeCategory: isCharge ? paymentForm.chargeCategory : null,
    };
    setPayrollEntries((prev) => [...prev, newEntry]);
    setShowPaymentModal(false);
    setPaymentForm({ type: 'Deal', repId: '', projectId: '', amount: '', stage: 'M1', date: '', notes: '', chargeCategory: 'misc' });
    setStatusTab('Draft');
    // Navigate to the pill that surfaces this entry. 'All' would also work
    // but jumping to the type-specific pill confirms the row exists at the
    // shape the admin expected.
    setTypeTab(isCharge ? 'Charge' : isBonus ? 'Bonus' : isChargeback ? 'Deal' : 'Deal');
    setFilterRepId('');
    setSelectedIds(new Set());
    setAdminPage(1);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('status', 'Draft');
    nextParams.set('type', isCharge ? 'Charge' : isBonus ? 'Bonus' : 'Deal');
    nextParams.delete('rep');
    router.replace(`?${nextParams.toString()}`, { scroll: false });
    paymentSubmitting.current = false;
    const label = isCharge ? 'Charge' : isChargeback ? 'Chargeback' : isBonus ? 'Bonus' : 'Payment';
    toast(`${label} draft added for ${rep?.name ?? 'rep'} — $${Math.abs(signedAmount).toLocaleString()}`, 'success');
    // Persist to DB via context helper — registers temp ID in resolution map so
    // markForPayroll awaits the real DB id before sending PATCH (prevents phantom temp ID bug)
    persistPayrollEntry(newEntry);
  };

  // inputCls/labelCls moved to components/form-styles.ts (T4.1) — only the
  // extracted modals consume them.

  // ── Non-admin guard ──────────────────────────────────────────────────────────
  // Reps can view only their own entries in a read-only mode; no admin actions.
  const isAdmin = effectiveRole === 'admin';
  if (!isAdmin) {
    const myEntries = payrollEntries.filter((p) => p.repId === effectiveRepId);
    const myTypeFiltered = myEntries.filter((p) => repTypeFilter === 'All' || entryTypeTab(p) === repTypeFilter);
    const myDraft = sumDraft(myTypeFiltered, { asOf: today });
    const myPending = sumPending(myTypeFiltered, { asOf: today });
    const myPaid = sumPaid(myTypeFiltered, { asOf: today });
    const myFiltered = myTypeFiltered
      .filter((p) => (repStatusFilter === 'All' || p.status === repStatusFilter) && (p.status !== 'Paid' || p.date <= today))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue-solid) 15%, transparent)' }}>
            <CreditCard className="w-5 h-5 text-[var(--accent-emerald-text)]" />
          </div>
          <div>
            <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>My Payroll</h1>
            <p className="text-[var(--text-secondary)] text-sm font-medium tracking-wide">Your commission and bonus payment history</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Draft" value={myDraft} color="text-[var(--text-secondary)]" accentGradient="from-blue-500 to-blue-400" className="animate-slide-in-scale stagger-1" />
          <StatCard label="Pending" value={myPending} color="text-[var(--accent-amber-text)]" accentGradient="from-yellow-500 to-yellow-400" className="animate-slide-in-scale stagger-2" />
          <StatCard label="Paid" value={myPaid} color="text-[var(--accent-emerald-text)]" accentGradient="from-emerald-500 to-emerald-400" className="animate-slide-in-scale stagger-3" />
        </div>
        {/* Type and status filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
            {(['All', 'Deal', 'Bonus', 'Trainer', 'Charge'] as const).map((t) => (
              <button key={t} onClick={() => setRepTypeFilter(t)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150"
                style={repTypeFilter === t ? { background: 'var(--accent-blue-solid)', color: 'var(--text-on-accent)' } : { color: 'var(--text-muted)' }}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
            {(['All', 'Draft', 'Pending', 'Paid'] as const).map((s) => (
              <button key={s} onClick={() => setRepStatusFilter(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150"
                style={repStatusFilter === s
                  ? s === 'Paid' ? { background: 'color-mix(in srgb, var(--accent-emerald-solid) 20%, transparent)', color: 'var(--accent-emerald-text)' }
                    : s === 'Pending' ? { background: 'color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)', color: 'var(--accent-amber-text)' }
                    : s === 'Draft' ? { background: 'color-mix(in srgb, var(--accent-blue-solid) 20%, transparent)', color: 'var(--accent-blue-text)' }
                    : { background: 'var(--accent-blue-solid)', color: 'var(--text-on-accent)' }
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
                <rect x="10" y="24" width="52" height="34" rx="6" fill="var(--surface-pressed)" stroke="var(--border-strong)" strokeWidth="1.5"/>
                <rect x="10" y="30" width="52" height="4" fill="var(--border-strong)"/>
                {/* Coin pocket */}
                <rect x="44" y="34" width="18" height="16" rx="4" fill="var(--surface-page)" stroke="var(--border-strong)" strokeWidth="1.5"/>
                <circle cx="53" cy="42" r="4" fill="var(--surface-card)" stroke="var(--accent-cyan-solid)" strokeWidth="1.5" strokeOpacity="0.5"/>
                {/* Dashed lines — empty content indicator */}
                <line x1="17" y1="40" x2="36" y2="40" stroke="var(--border-default)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                <line x1="17" y1="46" x2="30" y2="46" stroke="var(--border-default)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                {/* Dollar sign badge */}
                <circle cx="60" cy="22" r="9" fill="var(--surface-card)" stroke="var(--accent-emerald-solid)" strokeWidth="1.5" strokeOpacity="0.5"/>
                <text x="60" y="26.5" textAnchor="middle" fill="var(--accent-blue-text)" fontSize="11" fontWeight="bold" fontFamily="sans-serif">$</text>
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
                  <tr key={entry.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150`} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'color-mix(in srgb, var(--surface-card) 35%, var(--surface-page))' }}>
                    <td className="px-5 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {entry.type === 'Deal' && entry.customerName && entry.projectId ? (
                        <Link href={`/dashboard/projects/${entry.projectId}`} className="hover:underline" style={{ color: 'var(--accent-cyan-text)' }}>
                          {entry.customerName}
                        </Link>
                      ) : (
                        entry.type === 'Deal' ? entry.customerName : (entry.notes || '—')
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: entry.type === 'Bonus' ? 'color-mix(in srgb, var(--accent-purple-solid) 15%, transparent)' : 'color-mix(in srgb, var(--accent-blue-solid) 15%, transparent)', color: entry.type === 'Bonus' ? 'var(--accent-purple-text)' : 'var(--accent-blue-text)' }}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)' }}>
                        {entry.paymentStage}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold" style={{ color: entry.amount < 0 ? '#ef4444' : 'var(--accent-emerald-display)', fontFamily: "'DM Serif Display', serif" }}>{fmt$(entry.amount)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded`} style={
                        entry.status === 'Paid'
                          ? { background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-text)' }
                          : entry.status === 'Pending'
                          ? { background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-text)' }
                          : { background: 'var(--surface-card)', color: 'var(--accent-blue-text)' }
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
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue-solid) 15%, transparent)' }}>
            <CreditCard className="w-5 h-5 text-[var(--accent-emerald-text)]" />
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
              disabled={combinedPendingCount === 0}
              className="font-semibold px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ background: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)' }}
            >
              Publish Payroll
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

                // Group: repId → { repName, gross, chargebacks, entries }
                const byRep = new Map<string, { repName: string; gross: number; chargebacks: number; count: number }>();
                for (const e of filtered) {
                  const key = e.repId;
                  const row = byRep.get(key) ?? { repName: e.repName, gross: 0, chargebacks: 0, count: 0 };
                  if (e.amount < 0) row.chargebacks += Math.abs(e.amount);
                  else row.gross += e.amount;
                  row.count += 1;
                  byRep.set(key, row);
                }

                // ADP import template columns. Adjust per your specific
                // ADP instance — the four below are the universal core.
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

      {/* Top-level page view switcher — shared SegmentedPills */}
      <div className="mb-8">
        <SegmentedPills<PageView>
          options={[
            { value: 'payroll', label: 'Payroll' },
            { value: 'reimbursements', label: 'Reimbursements', badge: pendingReimCount > 0 ? pendingReimCount : undefined },
          ]}
          value={pageView}
          onChange={(v) => { setPageDir(PAGE_IDX[v] >= PAGE_IDX[pageView] ? 'forward' : 'backward'); setPageView(v); }}
          size="sm"
          ariaLabel="Payroll page view"
        />
      </div>

      {/* ── Reimbursements view ──────────────────────────────────────────────── */}
      {pageView === 'reimbursements' && (
        <div key={pageView} className={pageDir === 'forward' ? 'animate-tab-forward' : 'animate-tab-backward'}>
          {/* Reimbursements content — extracted to components/ReimbursementsView
              (T4.1). Gate + tab-animation wrapper stay here. */}
          <ReimbursementsView
            reimbursements={reimbursements}
            filteredReimbursements={filteredReimbursements}
            reimFilterStatus={reimFilterStatus}
            setReimFilterStatus={setReimFilterStatus}
            reimFilterFrom={reimFilterFrom}
            setReimFilterFrom={setReimFilterFrom}
            reimFilterTo={reimFilterTo}
            setReimFilterTo={setReimFilterTo}
            showArchivedReim={showArchivedReim}
            setShowArchivedReim={setShowArchivedReim}
            processingReimIds={processingReimIds}
            setProcessingReimIds={setProcessingReimIds}
            setPendingDeleteReim={setPendingDeleteReim}
            setReimbursements={setReimbursements}
            toast={toast}
          />
        </div>
      )}

      {pageView === 'payroll' && <div key={pageView} className={pageDir === 'forward' ? 'animate-tab-forward' : 'animate-tab-backward'}>

      {/* GradCards — all three now show COMBINED totals across Deal +
          Bonus + Trainer with a per-type sub-line so admins can see what
          they owe without swapping type tabs. Matches the Paid-card
          pattern. The per-type tab below still filters the row list for
          drill-down. 2026-04-23. */}
      <GradCards
        draftBreakdown={draftBreakdown}
        pendingBreakdown={pendingBreakdown}
        paidBreakdown={paidBreakdown}
        draftCount={draftCount}
        combinedPendingCount={combinedPendingCount}
        combinedPaidCount={combinedPaidCount}
        combinedTotalPaid={combinedTotalPaid}
      />

      {/* Status + Type tabs — shared SegmentedPills with per-tab counts */}
      <div className="mb-4">
        <SegmentedPills<StatusTab>
          options={(['Draft', 'Pending', 'Paid'] as StatusTab[]).map((s) => ({
            value: s,
            label: s,
            badge: filteredByDateRep.filter((p) => p.status === s && (typeTab === 'All' || entryTypeTab(p) === typeTab) && (s !== 'Paid' || p.date <= today)).length,
          }))}
          value={statusTab}
          onChange={changeStatusTab}
          size="sm"
          ariaLabel="Payroll status"
        />
      </div>
      <div className="mb-6">
        <SegmentedPills<TypeTab>
          options={[
            { value: 'All', label: 'All' },
            { value: 'Deal', label: 'Deal' },
            { value: 'Bonus', label: 'Bonus' },
            { value: 'Trainer', label: 'Trainer' },
            { value: 'Charge', label: 'Charge' },
          ]}
          value={typeTab}
          onChange={changeTypeTab}
          size="sm"
          ariaLabel="Payroll type filter"
        />
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
              className="text-xs hover:text-[var(--text-primary)] underline transition-colors"
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
      <div key={statusTab} className={tabDir === 'forward' ? 'animate-tab-forward' : 'animate-tab-backward'}>
      {filtered.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              No {statusTab.toLowerCase()} {typeTab === 'All' ? 'payments' : `${typeTab.toLowerCase()} payments`}
            </p>
            <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {statusTab === 'Draft' ? 'Draft entries are auto-created when projects hit milestones. Use + Add Payment to record a bonus or charge.' : statusTab === 'Pending' ? 'Select Draft entries and mark them for payroll' : 'Publish pending payroll to move entries here'}
            </p>
            {statusTab === 'Draft' && (
              <button
                onClick={() => {
                  paymentSubmitting.current = false;
                  // Pre-select the form type from the active filter when it's
                  // unambiguous; otherwise default to Deal and let the user
                  // toggle inside the modal.
                  const presetType: 'Deal' | 'Bonus' | 'Charge' | 'Chargeback' =
                    typeTab === 'Bonus' ? 'Bonus' : typeTab === 'Charge' ? 'Charge' : 'Deal';
                  setPaymentForm((p) => ({ ...p, type: presetType }));
                  setShowPaymentModal(true);
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-lg transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ background: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)' }}
              >
                <ArrowRight className="w-3.5 h-3.5" /> Add Payment
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
                    <input type="checkbox" checked={allPageSelected} onChange={selectAll} style={{ accentColor: 'var(--accent-emerald-solid)', cursor: 'pointer' }} />
                  </th>
                )}
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Rep</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Type</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Detail</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Amount</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Status</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedGroups.flatMap((group, groupIdx) => {
                const expanded = expandedRepIds.has(group.repId);
                const groupAllSelected = allGroupEntrySelected(group.entries);
                const summaryRow = (
                  <tr
                    key={`rep-${group.repId}`}
                    onMouseEnter={() => setHoveredGroupId(group.repId)}
                    onMouseLeave={() => setHoveredGroupId(null)}
                    style={{
                      background: hoveredGroupId === group.repId
                        ? 'color-mix(in srgb, var(--accent-emerald-solid) 6%, var(--surface-card))'
                        : groupIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-pressed)',
                      borderBottom: '1px solid var(--border)',
                      borderLeft: hoveredGroupId === group.repId
                        ? '3px solid color-mix(in srgb, var(--accent-emerald-solid) 65%, transparent)'
                        : '3px solid transparent',
                      cursor: 'pointer',
                      transition: 'background-color 140ms ease, border-left-color 140ms ease',
                    }}
                    onClick={() => toggleRepExpanded(group.repId)}
                  >
                    {statusTab === 'Draft' && (
                      <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={groupAllSelected}
                          onChange={() => toggleGroupSelection(group.entries)}
                          style={{ accentColor: 'var(--accent-emerald-solid)', cursor: 'pointer' }}
                          title={groupAllSelected ? 'Deselect all of this rep\'s entries' : 'Select all of this rep\'s entries'}
                        />
                      </td>
                    )}
                    <td style={{ padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif" }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ChevronDown
                          className="w-3.5 h-3.5"
                          style={{
                            color: hoveredGroupId === group.repId ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                            transition: 'transform 200ms, color 140ms ease',
                            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: hoveredGroupId === group.repId ? 'var(--accent-emerald-text)' : 'var(--text-primary)', fontWeight: 700, transition: 'color 140ms ease' }}>{group.repName}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: 'var(--text-muted)' }}>
                      {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                    </td>
                    <td style={{ padding: '12px 14px' }}></td>
                    <td style={{ padding: '12px 14px', fontSize: 18, fontFamily: "'DM Sans',sans-serif", textAlign: 'right' }}>
                      <span style={{ color: group.total < 0 ? '#ef4444' : 'var(--accent-emerald-display)', fontWeight: 700, fontFamily: "'DM Serif Display',serif" }}>
                        {fmt$(group.total)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}></td>
                    <td style={{ padding: '12px 14px' }}></td>
                    <td style={{ padding: '12px 14px' }}></td>
                  </tr>
                );
                const isCollapsing = collapsingRepIds.has(group.repId);
                if (!expanded && !isCollapsing) return [summaryRow];
                const detailRows = group.entries.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={isCollapsing ? 'animate-row-exit' : `table-row-enter row-stagger-${Math.min(i, 24)}`}
                  onMouseEnter={() => setHoveredEntryId(entry.id)}
                  onMouseLeave={() => setHoveredEntryId(null)}
                  style={{
                    background: selectedIds.has(entry.id)
                      ? 'var(--accent-emerald-soft)'
                      : hoveredEntryId === entry.id
                      ? 'color-mix(in srgb, var(--accent-emerald-solid) 4%, var(--surface-card))'
                      : i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-pressed)',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'background-color 140ms ease',
                  }}
                  onClick={() => statusTab === 'Draft' && toggleEntry(entry.id)}
                >
                  {statusTab === 'Draft' && (
                    <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                      <input type="checkbox" checked={selectedIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: 'var(--accent-emerald-solid)', cursor: 'pointer' }} />
                    </td>
                  )}
                  <td style={{ padding: '12px 14px 12px 40px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-muted)' }}>↳</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>
                    {(() => {
                      const kind = entryTypeTab(entry);
                      // Only Deal entries have a meaningful stage suffix
                      // (M1/M2/M3). For Trainer/Bonus/Charge the paymentStage
                      // equals the kind and would just duplicate the label.
                      const stageSuffix = kind === 'Deal' ? entry.paymentStage : null;
                      return <PaymentTypeBadge kind={kind} stage={stageSuffix} />;
                    })()}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }} onClick={(e) => e.stopPropagation()}>
                    {entry.customerName && entry.projectId ? (
                      <Link
                        href={`/dashboard/projects/${entry.projectId}`}
                        className="hover:underline"
                        style={{ color: 'var(--accent-cyan-text)' }}
                        title="Open project"
                      >
                        {entry.customerName}
                      </Link>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>{entry.notes || '\u2014'}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 18, fontFamily: "'DM Sans',sans-serif", textAlign: 'right' }}><span style={{ color: entry.amount < 0 ? '#ef4444' : 'var(--accent-emerald-display)', fontWeight: 700, fontFamily: "'DM Serif Display',serif" }}>{fmt$(entry.amount)}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-muted)' }}><RelativeDate date={entry.date} /></span></td>
                  <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>
                    <span style={
                      entry.status === 'Paid'
                        ? { background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-display)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                        : entry.status === 'Pending'
                        ? { background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-display)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                        : { background: 'var(--accent-blue-soft)', color: 'var(--accent-blue-display)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
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
                      {entry.status === 'Paid' && (
                        <button
                          disabled={processingEntryIds.has(entry.id)}
                          onClick={() => openEditEntry(entry)}
                          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--accent-amber-text)' }}
                          title="Correct paid amount or initiate chargeback"
                        >
                          Correct
                        </button>
                      )}
                      {entry.status === 'Pending' && (
                        <button
                          disabled={processingEntryIds.has(entry.id)}
                          onClick={() => handleReverseEntry(entry)}
                          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--accent-amber-text)' }}
                          title="Move back to Draft"
                        >
                          Reverse
                        </button>
                      )}
                      {entry.status !== 'Paid' && (
                        <button
                          disabled={processingEntryIds.has(entry.id)}
                          onClick={() => handleDeleteEntry(entry)}
                          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40 hover:text-[var(--accent-red-text)] hover:bg-red-500/10"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-dim)' }}
                          title="Delete entry"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ));
                return [summaryRow, ...detailRows];
              })}
            </tbody>
          </table>
        </div>
        {groupedByRep.length > adminRowsPerPage && (
          <div className="card-surface rounded-2xl overflow-hidden mt-4">
            <PaginationBar
              totalResults={groupedByRep.length}
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
        // Show every Pending entry the user can see (no date filter at
        // display time). Default-checked are past+today (set in the
        // useEffect that watches showPublishConfirm); future-dated rows
        // are shown but unchecked so the admin can opt them in per row.
        const pendingEntries = allTypesInScope
          .filter((p) => p.status === 'Pending')
          .sort((a, b) => a.repName.localeCompare(b.repName) || a.date.localeCompare(b.date));
        const byRep = pendingEntries.reduce((map, e) => {
          if (!map.has(e.repId)) map.set(e.repId, { name: e.repName, entries: [] as typeof pendingEntries });
          map.get(e.repId)!.entries.push(e);
          return map;
        }, new Map<string, { name: string; entries: typeof pendingEntries }>());
        const repGroups = Array.from(byRep.entries()).map(([id, g]) => ({
          id, name: g.name, entries: g.entries,
        })).sort((a, b) => a.name.localeCompare(b.name));

        const selectedEntries = pendingEntries.filter((e) => publishSelectedIds.has(e.id));
        const selectedTotal = selectedEntries.reduce((s, e) => s + e.amount, 0);
        const allIds = pendingEntries.map((e) => e.id);
        const pastIds = pendingEntries.filter((e) => e.date <= today).map((e) => e.id);
        const futureCount = pendingEntries.length - pastIds.length;

        const toggleOne = (id: string) => {
          setPublishSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        };
        const selectAll = () => setPublishSelectedIds(new Set(allIds));
        const selectPastOnly = () => setPublishSelectedIds(new Set(pastIds));
        const clearAll = () => setPublishSelectedIds(new Set());

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-[var(--accent-amber-soft)]">
                  <AlertTriangle className="w-5 h-5 text-[var(--accent-amber-text)]" />
                </div>
                <h2 className="text-[var(--text-primary)] font-semibold text-lg">Publish Payroll?</h2>
              </div>
              <p className="text-[var(--text-secondary)] text-sm mb-3">
                <span className="text-[var(--accent-emerald-text)] font-semibold">{selectedEntries.length}</span> of {pendingEntries.length} pending {pendingEntries.length === 1 ? 'entry' : 'entries'} selected. This action cannot be undone.
                {futureCount > 0 && (
                  <> <span className="text-[var(--accent-amber-text)]">{futureCount} future-dated</span> {futureCount === 1 ? 'entry is' : 'entries are'} unchecked by default — opt in per row to include.</>
                )}
              </p>

              {filterRepId && (() => {
                const filteredRepName = reps.find((r) => r.id === filterRepId)?.name ?? 'selected rep';
                return (
                  <div className="flex items-start gap-2 bg-[var(--accent-amber-soft)] border border-yellow-700/40 rounded-lg px-3 py-2.5 mb-3">
                    <AlertTriangle className="w-4 h-4 text-[var(--accent-amber-text)] shrink-0 mt-0.5" />
                    <p className="text-[var(--accent-amber-text)] text-xs leading-relaxed">
                      <span className="font-semibold">Rep filter is active.</span> Only entries for <span className="font-semibold">{filteredRepName}</span> are shown.
                    </p>
                  </div>
                );
              })()}

              {(payFilterFrom || payFilterTo) && (
                <div className="flex items-start gap-2 bg-[var(--accent-amber-soft)] border border-yellow-700/40 rounded-lg px-3 py-2.5 mb-3">
                  <AlertTriangle className="w-4 h-4 text-[var(--accent-amber-text)] shrink-0 mt-0.5" />
                  <p className="text-[var(--accent-amber-text)] text-xs leading-relaxed">
                    <span className="font-semibold">Date filter is active.</span> Only entries{payFilterFrom && <> from <span className="font-semibold">{payFilterFrom}</span></>}{payFilterTo && <> to <span className="font-semibold">{payFilterTo}</span></>} are shown.
                  </p>
                </div>
              )}

              {/* Bulk selection controls */}
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-[var(--text-dim)] mr-1">Bulk:</span>
                <button type="button" onClick={selectAll} className="px-2 py-1 rounded-md bg-[var(--surface-card)] border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">All ({allIds.length})</button>
                <button type="button" onClick={selectPastOnly} className="px-2 py-1 rounded-md bg-[var(--surface-card)] border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">Past + today ({pastIds.length})</button>
                <button type="button" onClick={clearAll} className="px-2 py-1 rounded-md bg-[var(--surface-card)] border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">None</button>
              </div>

              {/* Per-rep entries with checkboxes */}
              {repGroups.length > 0 && (
                <div className="bg-[var(--surface-card)]/60 border border-[var(--border)]/60 rounded-xl mb-4 overflow-hidden flex-1 flex flex-col min-h-0">
                  <div className="divide-y divide-slate-800/60 overflow-y-auto flex-1">
                    {repGroups.map((rep) => {
                      const repSelected = rep.entries.filter((e) => publishSelectedIds.has(e.id));
                      const repSelectedTotal = repSelected.reduce((s, e) => s + e.amount, 0);
                      return (
                        <div key={rep.id} className="px-3 py-2">
                          <div className="flex items-center justify-between px-1 py-1 mb-1">
                            <p className="text-[var(--text-primary)] text-sm font-semibold">{rep.name}</p>
                            <p className="text-[var(--text-muted)] text-xs">{repSelected.length}/{rep.entries.length} · <span className="text-[var(--accent-emerald-text)] font-bold tabular-nums">{repSelectedTotal < 0 ? '-' : ''}${Math.abs(repSelectedTotal).toLocaleString()}</span></p>
                          </div>
                          <div className="space-y-0.5">
                            {rep.entries.map((e) => {
                              const isFuture = e.date > today;
                              const checked = publishSelectedIds.has(e.id);
                              return (
                                <label key={e.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--surface-card)] cursor-pointer">
                                  <input type="checkbox" checked={checked} onChange={() => toggleOne(e.id)} className="shrink-0 accent-[var(--accent-emerald-solid)]" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[var(--text-secondary)] truncate">
                                      {e.paymentStage}{e.customerName ? ` · ${e.customerName}` : ''}{e.notes ? ` · ${e.notes}` : ''}
                                    </p>
                                    <p className="text-[11px] text-[var(--text-dim)]">
                                      {e.date}
                                      {isFuture && <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)] font-semibold">Future</span>}
                                    </p>
                                  </div>
                                  <span className={`text-sm font-bold tabular-nums shrink-0 ${e.amount < 0 ? 'text-[var(--accent-red-text)]' : 'text-[var(--accent-emerald-text)]'}`}>{e.amount < 0 ? '-' : ''}${Math.abs(e.amount).toLocaleString()}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 py-2.5 border-t border-[var(--border)]/60 flex items-center justify-between bg-[var(--surface-card)]/40">
                    <span className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Selected total</span>
                    <span className="text-[var(--text-primary)] font-black tabular-nums">{selectedTotal < 0 ? '-' : ''}${Math.abs(selectedTotal).toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handlePublish}
                  disabled={publishingPayroll || selectedEntries.length === 0}
                  className="btn-primary flex-1 font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald-solid)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)' }}
                >
                  {publishingPayroll ? 'Publishing…' : `Publish ${selectedEntries.length} ${selectedEntries.length === 1 ? 'entry' : 'entries'}`}
                </button>
                <button
                  onClick={() => setShowPublishConfirm(false)}
                  className="btn-secondary flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-[var(--text-primary)] font-medium py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald-solid)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
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
      {/* Manual Payment Modal — extracted to components/ManualPaymentModal
          (T4.1). handleAddPayment + paymentForm state + focus trap stay here. */}
      {showPaymentModal && (
        <ManualPaymentModal
          paymentForm={paymentForm}
          setPaymentForm={setPaymentForm}
          setShowPaymentModal={setShowPaymentModal}
          handleAddPayment={handleAddPayment}
          paymentPanelRef={paymentPanelRef}
          projects={projects}
          reps={reps}
        />
      )}

      {/* Row-level Edit modal — extracted to components/EditEntryModal (T4.1). */}
      {editingEntry && (
        <EditEntryModal
          editingEntry={editingEntry}
          setEditingEntry={setEditingEntry}
          editEntryForm={editEntryForm}
          setEditEntryForm={setEditEntryForm}
          handleSaveEditEntry={handleSaveEditEntry}
          editEntryPanelRef={editEntryPanelRef}
        />
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
            <span className="flex items-center gap-1.5 bg-[var(--accent-emerald-solid)]/15 border border-[var(--accent-emerald-solid)]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
              <span key={selectedIds.size} className="text-[var(--text-primary)] font-bold tabular-nums animate-badge-pop">{selectedIds.size}</span>
              <span className="text-[var(--accent-emerald-text)] font-medium">selected</span>
              {selectedTotal > 0 && (
                <>
                  <span className="text-[var(--text-dim)] mx-0.5">·</span>
                  <span key={selectedTotal} className="text-[var(--accent-emerald-text)] font-semibold tabular-nums animate-badge-pop">${selectedTotal.toLocaleString()}</span>
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
                className="btn-primary font-semibold px-4 py-1.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald-solid)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)' }}
              >
                Mark for Payroll →
              </button>
            )}

            {/* Dismiss / deselect-all × button */}
            <button
              onClick={() => setSelectedIds(new Set())}
              aria-label="Deselect all and dismiss toolbar"
              className="btn-secondary p-1.5 rounded-lg bg-[var(--border)]/60 hover:bg-[var(--text-dim)]/80 border border-[var(--border)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>

          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteEntry !== null}
        onClose={() => setPendingDeleteEntry(null)}
        onConfirm={confirmDeleteEntry}
        title="Delete payment entry"
        message={pendingDeleteEntry ? `${pendingDeleteEntry.repName} — $${pendingDeleteEntry.amount.toFixed(2)}${pendingDeleteEntry.notes || pendingDeleteEntry.customerName ? `\n${pendingDeleteEntry.notes || pendingDeleteEntry.customerName}` : ''}\n\nThis cannot be undone.` : ''}
        confirmLabel="Delete"
        danger
      />
      <ConfirmDialog
        open={pendingDeleteReim !== null}
        onClose={() => setPendingDeleteReim(null)}
        onConfirm={confirmDeleteReim}
        title="Delete reimbursement"
        message={pendingDeleteReim ? `$${pendingDeleteReim.amount.toFixed(2)} for ${pendingDeleteReim.repName}\n\nThis cannot be undone. Prefer Archive unless this is a typo.` : ''}
        confirmLabel="Delete"
        danger
      />
      <PaidCorrectionModal
        entry={paidCorrectionEntry}
        onClose={() => setPaidCorrectionEntry(null)}
        onCorrected={handlePaidCorrected}
        onOpenChargeback={openChargebackForEntry}
      />
    </div>
  );
}


