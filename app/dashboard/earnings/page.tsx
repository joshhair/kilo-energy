'use client';

import { useState, useRef, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery, useSearchParamTab } from '../../../lib/hooks';
import MobileEarnings from '../mobile/MobileEarnings';
import { useToast } from '../../../lib/toast';
import { Reimbursement } from '../../../lib/data';
import { type Period, PERIODS, isInPeriod } from '../components/dashboard-utils';
import { formatDate, downloadCSV, fmt$, todayLocalDateStr, localDateString } from '../../../lib/utils';
import { ReimbursementModal } from '../components/ReimbursementModal';
import { RelativeDate } from '../components/RelativeDate';
import {
  DollarSign, TrendingUp, Receipt,
  X, Building2, CheckCircle2, XCircle,
  Clock, ArrowRight, Users, Download,
} from 'lucide-react';
import { PaginationBar } from '../components/PaginationBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { EarningsSkeleton } from './components/EarningsSkeleton';
import { SubDealerEarningsView } from './components/SubDealerEarningsView';
import { MonthlyEarningsBarChart, computeMonthlyBarData, MONTH_LABELS } from './components/MonthlyEarningsBarChart';
import { sumPaid } from '../../../lib/aggregators';
import {
  SortIcon,
  PayrollStatusBadge,
  ReimbStatusBadge,
  getPayrollRowAccent,
  SparklineWithTooltip,
  getNextFriday,
  formatPayoutDate,
  daysUntilDate,
  computeMonthlySparklineData,
  type SortDir,
} from './components/primitives';

// ── Shared constants ───────────────────────────────────────────────────────────


/** Maps Tailwind accent-gradient class strings to an RGBA radial glow for --card-accent */
const ACCENT_COLOR_MAP: Record<string, string> = {
  'from-emerald-500 to-emerald-400': 'rgba(16,185,129,0.08)',
  'from-yellow-500 to-yellow-400':   'rgba(234,179,8,0.08)',
  'from-blue-500 to-blue-400':       'rgba(59,130,246,0.08)',
  'from-violet-500 to-violet-400':   'rgba(139,92,246,0.08)',
};

// ── Types ──────────────────────────────────────────────────────────────────────

type DealSortKey  = 'customerName' | 'paymentStage' | 'notes' | 'amount' | 'status' | 'date';
type BonusSortKey = 'notes' | 'amount' | 'status' | 'date';

// ── Monthly bar-chart data helper ─────────────────────────────────────────────


// ── Rep Earnings View ──────────────────────────────────────────────────────────

function RepEarningsView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { effectiveRepId, effectiveRepName, payrollEntries, reimbursements, setReimbursements, dbReady } = useApp();
  const isHydrated = useIsHydrated();
  const { toast } = useToast();

  type Tab = 'deal' | 'bonus' | 'reimbursements';
  const REP_TABS = ['deal', 'bonus', 'reimbursements'] as const;
  const rawTab = searchParams.get('tab');
  const [tab, setTabState] = useSearchParamTab(rawTab, REP_TABS, 'deal');
  const setTab = (t: Tab) => {
    setTabState(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const [showReimbModal, setShowReimbModal] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);

  const monthFilterLabel = useMemo(() => {
    if (!monthFilter) return null;
    const [y, m] = monthFilter.split('-');
    return `${MONTH_LABELS[parseInt(m, 10) - 1]} ${y}`;
  }, [monthFilter]);

  const myPayroll     = payrollEntries.filter((p) => p.repId === effectiveRepId);

  // Next-payout countdown (next Friday on or after today)
  const today          = new Date();
  const todayStr        = localDateString(today);
  const nextFriday     = getNextFriday(today);
  const nextFridayDate = `${nextFriday.getFullYear()}-${String(nextFriday.getMonth() + 1).padStart(2, '0')}-${String(nextFriday.getDate()).padStart(2, '0')}`;

  const pendingItems      = myPayroll.filter((p) => p.status === 'Pending');
  const totalPaid         = sumPaid(myPayroll);
  const totalPending      = pendingItems.reduce((s, p) => s + p.amount, 0);
  const pendingCount      = pendingItems.length;
  const nextPayoutItems   = myPayroll.filter((p) => p.status === 'Pending' && p.date === nextFridayDate);
  const nextPayoutTotal   = nextPayoutItems.reduce((s, p) => s + p.amount, 0);
  const nextPayoutCount   = nextPayoutItems.length;
  const myReimbs      = useMemo(() => reimbursements.filter((r) => r.repId === effectiveRepId), [reimbursements, effectiveRepId]);
  const filteredReimbs = useMemo(() => monthFilter ? myReimbs.filter((r) => r.date.startsWith(monthFilter)) : myReimbs, [myReimbs, monthFilter]);

  const currentYYYYMM  = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthEarned = sumPaid(myPayroll.filter((p) => p.date.startsWith(monthFilter ?? currentYYYYMM)));
  const approvedReimbs  = filteredReimbs.filter((r) => r.status === 'Approved').reduce((s, r) => s + r.amount, 0);
  const nextFridayStr  = formatPayoutDate(nextFriday);
  const daysLeft       = daysUntilDate(nextFriday, today);

  // Monthly sparkline data: last 6 calendar months per summary-card category
  const earnedMonthlyData  = useMemo(() => computeMonthlySparklineData(payrollEntries.filter((p) => p.repId === effectiveRepId && p.status === 'Paid' && p.date <= todayStr)),    [payrollEntries, effectiveRepId, todayStr]);
  const pendingMonthlyData = useMemo(() => computeMonthlySparklineData(payrollEntries.filter((p) => p.repId === effectiveRepId && p.status === 'Pending')), [payrollEntries, effectiveRepId]);
  const reimbMonthlyData   = useMemo(() => computeMonthlySparklineData(reimbursements.filter((r) => r.repId === effectiveRepId && r.status === 'Approved')), [reimbursements, effectiveRepId]);
  const thisMonthPaidData  = useMemo(() => computeMonthlySparklineData(payrollEntries.filter((p) => p.repId === effectiveRepId && p.status === 'Paid' && p.date.slice(0, 7) <= (monthFilter ?? currentYYYYMM))), [payrollEntries, effectiveRepId, monthFilter, currentYYYYMM]);

  // Monthly bar-chart data (last 6 months, paid vs pending vs reimbursements)
  const monthlyBarData = useMemo(
    () => computeMonthlyBarData(payrollEntries, reimbursements, effectiveRepId),
    [payrollEntries, reimbursements, effectiveRepId],
  );

  // Deal table sort + pagination
  const [dealSortKey, setDealSortKey]   = useState<DealSortKey>('date');
  const [dealSortDir, setDealSortDir]   = useState<SortDir>('desc');
  const [dealPage, setDealPage]         = useState(1);
  const [dealPageSize, setDealPageSize] = useState(10);
  const [dealRoleFilter, setDealRoleFilter] = useState<string | null>(null);

  const handleDealSort = (key: DealSortKey) => {
    setDealPage(1);
    if (dealSortKey === key) { setDealSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setDealSortKey(key); setDealSortDir('asc'); }
  };

  type DealRow = | { kind: 'payroll'; entry: (typeof payrollEntries)[0] } | { kind: 'reimb'; entry: (typeof myReimbs)[0] };

  const sortedDealsBase = useMemo((): DealRow[] => {
    const allPayrollRows: DealRow[] = payrollEntries.filter((p) => p.repId === effectiveRepId && p.type === 'Deal').map((e) => ({ kind: 'payroll' as const, entry: e }));
    const payrollRows = monthFilter ? allPayrollRows.filter((r) => r.entry.date.startsWith(monthFilter)) : allPayrollRows;
    const reimbRows: DealRow[] = (monthFilter ? myReimbs.filter((r) => r.date.startsWith(monthFilter)) : myReimbs).map((e) => ({ kind: 'reimb' as const, entry: e }));
    return [...payrollRows, ...reimbRows].sort((a, b) => {
      const aDate = a.entry.date; const bDate = b.entry.date;
      const aAmt  = a.entry.amount; const bAmt = b.entry.amount;
      const aName = a.kind === 'payroll' ? (a.entry.customerName ?? '') : a.entry.description;
      const bName = b.kind === 'payroll' ? (b.entry.customerName ?? '') : b.entry.description;
      const aStatus = a.entry.status; const bStatus = b.entry.status;
      const aStage  = a.kind === 'payroll' ? (a.entry.paymentStage ?? '') : 'Reimb';
      const bStage  = b.kind === 'payroll' ? (b.entry.paymentStage ?? '') : 'Reimb';
      const aNotes  = a.kind === 'payroll' ? (a.entry.notes ?? '') : 'Reimbursement';
      const bNotes  = b.kind === 'payroll' ? (b.entry.notes ?? '') : 'Reimbursement';
      let cmp = 0;
      switch (dealSortKey) {
        case 'customerName': cmp = aName.localeCompare(bName); break;
        case 'paymentStage': cmp = aStage.localeCompare(bStage); break;
        case 'notes':        cmp = aNotes.localeCompare(bNotes); break;
        case 'amount':       cmp = aAmt - bAmt; break;
        case 'status':       cmp = aStatus.localeCompare(bStatus); break;
        case 'date':         cmp = aDate.localeCompare(bDate); break;
      }
      return dealSortDir === 'asc' ? cmp : -cmp;
    });
  }, [payrollEntries, myReimbs, effectiveRepId, dealSortKey, dealSortDir, monthFilter]);

  const sortedDeals = useMemo(() =>
    sortedDealsBase.filter((row) => {
      if (!dealRoleFilter) return true;
      if (dealRoleFilter === 'Reimb.')  return row.kind === 'reimb';
      const role = row.kind === 'payroll' ? (row.entry.notes ?? '') : '';
      if (dealRoleFilter === 'Setter')  return role === 'Setter' || role.startsWith('Co-setter');
      if (dealRoleFilter === 'Trainer') return role.startsWith('Trainer override');
      return role !== 'Setter' && !role.startsWith('Co-setter') && !role.startsWith('Trainer override') && row.kind !== 'reimb'; // Closer
    }),
  [sortedDealsBase, dealRoleFilter]);

  const isSetterNote = (notes: string | null | undefined) => notes === 'Setter' || (notes ?? '').startsWith('Co-setter');
  const closerCount  = sortedDealsBase.filter(r => r.kind === 'payroll' && !isSetterNote(r.entry.notes) && !(r.entry.notes ?? '').startsWith('Trainer override')).length;
  const setterCount  = sortedDealsBase.filter(r => r.kind === 'payroll' && isSetterNote(r.entry.notes)).length;
  const trainerCount = sortedDealsBase.filter(r => r.kind === 'payroll' && (r.entry.notes ?? '').startsWith('Trainer override')).length;
  const reimbCount   = sortedDealsBase.filter(r => r.kind === 'reimb').length;

  const dealTotal      = sortedDeals.length;
  const dealTotalPages = Math.max(1, Math.ceil(dealTotal / dealPageSize));
  const dealSafePage   = Math.min(dealPage, dealTotalPages);
  const dealStart      = (dealSafePage - 1) * dealPageSize;
  const dealEnd        = Math.min(dealStart + dealPageSize, dealTotal);
  const pagedDeals     = sortedDeals.slice(dealStart, dealEnd);

  // Bonus table sort + pagination
  const [bonusSortKey, setBonusSortKey]   = useState<BonusSortKey>('date');
  const [bonusSortDir, setBonusSortDir]   = useState<SortDir>('desc');
  const [bonusPage, setBonusPage]         = useState(1);
  const [bonusPageSize, setBonusPageSize] = useState(10);
  const [reimbPage, setReimbPage]         = useState(1);
  const [reimbPageSize, setReimbPageSize] = useState(10);

  const handleBonusSort = (key: BonusSortKey) => {
    setBonusPage(1);
    if (bonusSortKey === key) { setBonusSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setBonusSortKey(key); setBonusSortDir('asc'); }
  };

  const sortedBonuses = useMemo(() => {
    return payrollEntries.filter((p) => p.repId === effectiveRepId && p.type === 'Bonus')
      .filter((p) => !monthFilter || p.date.startsWith(monthFilter))
      .sort((a, b) => {
      let cmp = 0;
      switch (bonusSortKey) {
        case 'notes':  cmp = (a.notes ?? '').localeCompare(b.notes ?? ''); break;
        case 'amount': cmp = a.amount - b.amount; break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'date':   cmp = a.date.localeCompare(b.date); break;
      }
      return bonusSortDir === 'asc' ? cmp : -cmp;
    });
  }, [payrollEntries, effectiveRepId, bonusSortKey, bonusSortDir, monthFilter]);

  const bonusTotal      = sortedBonuses.length;
  const bonusTotalPages = Math.max(1, Math.ceil(bonusTotal / bonusPageSize));
  const bonusSafePage   = Math.min(bonusPage, bonusTotalPages);
  const bonusStart      = (bonusSafePage - 1) * bonusPageSize;
  const bonusEnd        = Math.min(bonusStart + bonusPageSize, bonusTotal);
  const pagedBonuses    = sortedBonuses.slice(bonusStart, bonusEnd);

  const reimbTotal      = filteredReimbs.length;
  const reimbTotalPages = Math.max(1, Math.ceil(reimbTotal / reimbPageSize));
  const reimbSafePage   = Math.min(reimbPage, reimbTotalPages);
  const reimbStart      = (reimbSafePage - 1) * reimbPageSize;
  const reimbEnd        = Math.min(reimbStart + reimbPageSize, reimbTotal);
  const pagedReimbs     = filteredReimbs.slice(reimbStart, reimbEnd);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const TABS = ['deal', 'bonus', 'reimbursements'] as const;
    const idx = TABS.indexOf(tab);
    const el = tabRefs.current[idx];
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab, isHydrated]);

  useEffect(() => { setDealPage(1); setBonusPage(1); setDealRoleFilter(null); }, [monthFilter]);
  useEffect(() => { setDealPage(1); }, [dealRoleFilter]);

  // Gate on both client-hydrate AND /api/data ready so the fade-in
  // runs on populated content instead of an empty shell.
  if (!isHydrated || !dbReady) return <EarningsSkeleton />;

  return (
    <div className="p-4 md:p-8 pb-24 animate-fade-in-up">
      <ReimbursementModal
        open={showReimbModal}
        onClose={() => setShowReimbModal(false)}
        repId={effectiveRepId ?? ''}
        repName={effectiveRepName ?? ''}
        onSubmit={async (data) => {
          const tempId = `reimb_${Date.now()}`;
          const { receiptFile, ...displayData } = data;
          const newReimb: Reimbursement = { id: tempId, ...displayData, status: 'Pending' };
          setReimbursements((prev) => [...prev, newReimb]);
          setShowReimbModal(false);
          try {
            const res = await fetch('/api/reimbursements', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repId: data.repId, amount: data.amount, description: data.description, date: data.date, receiptName: data.receiptName }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const created = await res.json() as Reimbursement;
            setReimbursements((prev) => prev.map((r) => r.id === tempId ? created : r));
            if (receiptFile) {
              const form = new FormData();
              form.append('file', receiptFile);
              const upRes = await fetch(`/api/reimbursements/${created.id}/receipt`, { method: 'POST', body: form });
              if (upRes.ok) {
                const withReceipt = await upRes.json() as Reimbursement;
                setReimbursements((prev) => prev.map((r) => r.id === created.id ? withReceipt : r));
                toast('Reimbursement submitted with receipt', 'success');
              } else {
                toast('Submitted — receipt upload failed, try re-uploading', 'error');
              }
            } else {
              toast('Reimbursement request submitted', 'success');
            }
          } catch (err) {
            console.error(err);
            setReimbursements((prev) => prev.filter((r) => r.id !== tempId));
            toast('Failed to save reimbursement', 'error');
          }
        }}
      />

      {/* Header */}
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
              <DollarSign className="w-5 h-5 text-[var(--accent-green)]" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Earnings</h1>
              <p className="text-[var(--text-secondary)] text-sm font-medium mt-0.5 tracking-wide">Your commission, bonus, and reimbursement history</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                const dateStr = localDateString(new Date());
                if (tab === 'bonus') {
                  const headers = ['Type', 'Note', 'Amount', 'Status', 'Date'];
                  const rows = sortedBonuses.map((e) => ['Bonus', e.notes || '', `$${e.amount.toFixed(2)}`, e.status, formatDate(e.date)]);
                  downloadCSV(`my-bonuses-${dateStr}.csv`, headers, rows);
                } else if (tab === 'reimbursements') {
                  const headers = ['Description', 'Amount', 'Status', 'Date'];
                  const rows = filteredReimbs.map((r) => [r.description, `$${r.amount.toFixed(2)}`, r.status, formatDate(r.date)]);
                  downloadCSV(`my-reimbursements-${dateStr}.csv`, headers, rows);
                } else {
                  const headers = ['Type', 'Customer / Note', 'Stage', 'Amount', 'Status', 'Date'];
                  const rows = sortedDeals.map((row) => {
                    if (row.kind === 'payroll') {
                      const e = row.entry as (typeof payrollEntries)[0];
                      return [e.type, e.customerName || e.notes || '', e.paymentStage || '', `$${e.amount.toFixed(2)}`, e.status, formatDate(e.date)];
                    }
                    const r = row.entry as (typeof myReimbs)[0];
                    return ['Reimbursement', r.description, 'Reimb', `$${r.amount.toFixed(2)}`, r.status, formatDate(r.date)];
                  });
                  downloadCSV(`my-earnings-${dateStr}.csv`, headers, rows);
                }
              }}
              disabled={tab === 'bonus' ? sortedBonuses.length === 0 : tab === 'reimbursements' ? filteredReimbs.length === 0 : sortedDeals.length === 0}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] px-3 py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download earnings as CSV"
            >
              <Download className="w-3.5 h-3.5" /> CSV{tab !== 'bonus' && tab !== 'reimbursements' && dealRoleFilter ? ` (${dealRoleFilter})` : ''}
            </button>
            <button
              onClick={() => setShowReimbModal(true)}
              className="flex items-center gap-2 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-white font-medium px-4 py-2.5 rounded-xl text-sm transition-colors shrink-0"
            >
              <Receipt className="w-4 h-4 text-violet-400" />
              Request Reimbursement
            </button>
          </div>
        </div>
      </div>

      {/* ── Next Payout Hero Card ─────────────────────────────────────────── */}
      {nextPayoutTotal > 0 ? (
        <div
          className="card-surface rounded-2xl p-6 mb-5 animate-slide-in-scale stagger-1"
          style={{ '--card-accent': 'rgba(16,185,129,0.18)' } as React.CSSProperties}
        >
          {/* emerald top accent bar */}
          <div className="h-[3px] w-16 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-5" />

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
            {/* Left — amount + labels */}
            <div>
              <p className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-widest mb-2">Next Payout</p>
              <p className="stat-value stat-value-glow stat-glow-emerald text-4xl font-black tabular-nums tracking-tight animate-count-up" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--accent-green)' }}>
                ${nextPayoutTotal.toLocaleString()}
              </p>
              <p className="text-[var(--text-secondary)] text-sm mt-2.5">
                Expected Friday,{' '}
                <span className="text-[var(--text-secondary)] font-medium">{nextFridayStr}</span>
              </p>
              <p className="text-[var(--text-muted)] text-xs mt-1">
                {nextPayoutCount} pending {nextPayoutCount === 1 ? 'entry' : 'entries'}
              </p>
            </div>

            {/* Right — countdown badge */}
            <div className="sm:pb-1">
              <span className="inline-flex items-center gap-1.5 bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20 text-[var(--accent-green)] text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {daysLeft === 0 ? 'Today!' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days away`}
              </span>
            </div>
          </div>
        </div>
      ) : totalPending > 0 ? (
        <div
          className="card-surface rounded-2xl p-6 mb-5 animate-slide-in-scale stagger-1"
          style={{ '--card-accent': 'rgba(16,185,129,0.07)' } as React.CSSProperties}
        >
          <div className="h-[3px] w-16 rounded-full bg-gradient-to-r from-emerald-500/30 to-emerald-400/30 mb-5" />
          <div className="flex flex-col items-center py-3 text-center gap-3">
            <p className="text-[var(--text-secondary)] text-sm font-medium leading-relaxed">
              ${totalPending.toLocaleString()} pending across {pendingCount} {pendingCount === 1 ? 'entry' : 'entries'} — nothing due this Friday
            </p>
          </div>
        </div>
      ) : (
        <div
          className="card-surface rounded-2xl p-6 mb-5 animate-slide-in-scale stagger-1"
          style={{ '--card-accent': 'rgba(16,185,129,0.07)' } as React.CSSProperties}
        >
          <div className="h-[3px] w-16 rounded-full bg-gradient-to-r from-emerald-500/30 to-emerald-400/30 mb-5" />
          <div className="flex flex-col items-center py-3 text-center gap-3">
            <p className="text-[var(--text-secondary)] text-sm font-medium leading-relaxed">
              No pending payouts — close a deal to start earning
            </p>
            <Link
              href="/dashboard/new-deal"
              className="inline-flex items-center gap-1.5 text-[var(--accent-green)] hover:text-emerald-300 text-sm font-semibold transition-colors"
            >
              Close a deal <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* ── Summary stat cards with sparklines ───────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">

        {/* 1 — Total Earned (emerald) */}
        <div
          className="card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-1"
          style={{ '--card-accent': ACCENT_COLOR_MAP['from-emerald-500 to-emerald-400'] } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">Total Earned</span>
            <DollarSign className="w-4 h-4 text-[var(--accent-green)] shrink-0" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight text-[var(--accent-green)] animate-count-up">
            ${totalPaid.toLocaleString()}
          </p>
          <SparklineWithTooltip data={earnedMonthlyData} stroke="var(--accent-green)" />
        </div>

        {/* 2 — Pending (yellow) */}
        <div
          className="card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-2"
          style={{ '--card-accent': ACCENT_COLOR_MAP['from-yellow-500 to-yellow-400'] } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">Pending</span>
            <TrendingUp className="w-4 h-4 text-yellow-400 shrink-0" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight text-yellow-400 animate-count-up">
            ${totalPending.toLocaleString()}
          </p>
          <SparklineWithTooltip data={pendingMonthlyData} stroke="#eab308" />
        </div>

        {/* 3 — This Month (blue) */}
        <div
          className="card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-3"
          style={{ '--card-accent': ACCENT_COLOR_MAP['from-blue-500 to-blue-400'] } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">{monthFilterLabel ?? 'This Month'}</span>
            <DollarSign className="w-4 h-4 text-[var(--accent-green)] shrink-0" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight text-[var(--accent-green)] animate-count-up">
            ${thisMonthEarned.toLocaleString()}
          </p>
          <SparklineWithTooltip data={thisMonthPaidData} stroke="var(--accent-cyan)" />
        </div>

        {/* 4 — Reimbursements approved (violet) */}
        <div
          className="card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-4"
          style={{ '--card-accent': ACCENT_COLOR_MAP['from-violet-500 to-violet-400'] } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-violet-500 to-violet-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">Reimbursements</span>
            <Receipt className="w-4 h-4 text-violet-400 shrink-0" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight text-violet-400 animate-count-up">
            ${approvedReimbs.toLocaleString()}
          </p>
          <SparklineWithTooltip data={reimbMonthlyData} stroke="#8b5cf6" />
        </div>

      </div>

      {/* ── Monthly Earnings Bar Chart ──────────────────────────────────────── */}
      <MonthlyEarningsBarChart
        data={monthlyBarData}
        selectedMonth={monthFilter}
        onMonthClick={(key) => setMonthFilter((prev) => prev === key ? null : key)}
      />

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container">
        {indicatorStyle && <div className="tab-indicator" style={indicatorStyle} />}
        {(['deal', 'bonus', 'reimbursements'] as const).map((t, i) => (
          <button key={t} ref={(el) => { tabRefs.current[i] = el; }} onClick={() => setTab(t)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] min-w-0 overflow-hidden ${tab === t ? 'text-white' : 'text-[var(--text-secondary)] hover:text-white'}`}>
            <span className="block truncate">{t === 'deal' ? `Payroll Report (${sortedDealsBase.length})` : t === 'bonus' ? `Bonuses (${sortedBonuses.length})` : `Reimb. History (${filteredReimbs.length})`}</span>
          </button>
        ))}
      </div>

      {/* Active month filter chip */}
      {monthFilter && (
        <div className="flex items-center gap-2 mb-3 animate-fade-in">
          <span className="inline-flex items-center gap-1.5 text-xs bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] px-3 py-1.5 rounded-full font-medium">
            Showing
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-300 px-3 py-1.5 rounded-full font-medium">
            {monthFilterLabel}
            <button onClick={() => setMonthFilter(null)} className="ml-0.5 hover:text-white transition-colors" aria-label="Clear month filter">
              <X className="w-3 h-3" />
            </button>
          </span>
          <span className="text-xs text-[var(--text-dim)]">
            {tab === 'deal' ? `${sortedDeals.length} entries` : tab === 'reimbursements' ? `${filteredReimbs.length} entries` : `${sortedBonuses.length} entries`}
          </span>
        </div>
      )}

      {/* Tab content */}
      <div className="overflow-hidden">

        {/* Payroll Report tab */}
        {tab === 'deal' && (
          <div key="deal" className="animate-tab-enter relative card-surface rounded-2xl overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-900/90 to-transparent z-10 rounded-r-2xl" />
            <div className="flex items-center gap-1.5 px-5 py-3 border-b border-[var(--border-subtle)]/50 flex-wrap">
              {[
                { key: null,       label: 'All' },
                { key: 'Closer',   label: `Closer (${closerCount})` },
                { key: 'Setter',   label: `Setter (${setterCount})` },
                { key: 'Trainer',  label: `Trainer (${trainerCount})` },
                { key: 'Reimb.',   label: `Reimb. (${reimbCount})` },
              ].filter(p => p.key === null || (p.key === 'Closer' ? closerCount > 0 : p.key === 'Setter' ? setterCount > 0 : p.key === 'Trainer' ? trainerCount > 0 : reimbCount > 0))
              .map(({ key, label }) => (
                <button key={key ?? 'all'} onClick={() => { setDealRoleFilter(key); setDealPage(1); }}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                    dealRoleFilter === key
                      ? 'bg-[var(--border)] text-white border border-[var(--border-subtle)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto scroll-smooth">
              <table className="w-full text-sm">
                <thead className="table-header-frost">
                  <tr className="border-b border-[var(--border-subtle)]">
                    {([
                      { key: 'customerName' as DealSortKey, label: 'Customer' },
                      { key: 'paymentStage' as DealSortKey, label: 'Stage' },
                      { key: 'notes'        as DealSortKey, label: 'Role' },
                      { key: 'amount'       as DealSortKey, label: 'Amount' },
                      { key: 'status'       as DealSortKey, label: 'Status' },
                      { key: 'date'         as DealSortKey, label: 'Date' },
                    ] as { key: DealSortKey; label: string }[]).map(({ key, label }) => (
                      <th key={key} onClick={() => handleDealSort(key)}
                        className={`text-left px-5 py-3 font-medium cursor-pointer select-none transition-colors hover:text-white whitespace-nowrap ${dealSortKey === key ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                        {label}<SortIcon colKey={key} sortKey={dealSortKey} sortDir={dealSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedDeals.map((row, i) => {
                    const isReim = row.kind === 'reimb';
                    const name   = isReim ? row.entry.description : (row.entry.customerName || '—');
                    const stage  = isReim ? '—' : (row.entry.paymentStage ?? '—');
                    const role   = isReim ? 'Reimbursement' : (row.entry.notes ?? '');
                    const amt    = row.entry.amount;
                    const status = row.entry.status;
                    const date   = row.entry.date;
                    return (
                      <tr
                        key={row.entry.id}
                        style={!isReim ? ({ '--row-accent': getPayrollRowAccent(status) } as React.CSSProperties) : undefined}
                        className={`table-row-enter row-stagger-${i % 25} relative border-b border-[var(--border-subtle)]/50 ${isReim ? 'bg-violet-900/5' : 'odd:bg-[var(--surface)]/30 even:bg-[var(--surface-card)]/30'} hover:bg-[var(--surface-card)]/40 hover:shadow-[inset_3px_0_0_rgba(59,130,246,0.5)] transition-colors duration-150 cursor-default`}
                      >
                        <td className="px-5 py-3 text-white">{name}</td>
                        <td className="px-5 py-3"><span className="bg-[var(--border)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap">{stage}</span></td>
                        <td className="px-5 py-3 text-xs">
                          {isReim ? <span className="text-violet-400">Reimb.</span>
                            : role.startsWith('Co-setter') ? <span className="text-sky-400">Co-setter</span>
                            : role === 'Setter' ? <span className="text-[var(--accent-green)]">Setter</span>
                            : role.startsWith('Co-closer') ? <span className="text-sky-400">Co-closer</span>
                            : role.startsWith('Trainer override') ? <span className="text-amber-400">Trainer</span>
                            : <span className="text-[var(--accent-green)]">Closer</span>}
                        </td>
                        <td className="px-5 py-3 text-[var(--accent-green)] font-semibold whitespace-nowrap">${amt.toLocaleString()}</td>
                        <td className="px-5 py-3">{isReim ? <ReimbStatusBadge status={status} /> : <PayrollStatusBadge status={status} />}</td>
                        <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap">{formatDate(date)}</td>
                      </tr>
                    );
                  })}
                  {sortedDeals.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10 text-center">
                      <div className="flex justify-center">
                        <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — empty wallet / coin stack */}
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
                          <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">Your earnings will appear here</p>
                          <p className="text-[var(--text-muted)] text-xs leading-relaxed">Earnings will appear here once deals are processed and commissions are recorded.</p>
                          <Link
                            href="/dashboard/projects"
                            className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            View Projects
                          </Link>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {sortedDeals.length > 0 && (
              <PaginationBar totalResults={dealTotal} startIdx={dealStart} endIdx={dealEnd}
                currentPage={dealSafePage} totalPages={dealTotalPages} rowsPerPage={dealPageSize}
                onPageChange={setDealPage} onRowsPerPageChange={(n) => { setDealPageSize(n); setDealPage(1); }} />
            )}
          </div>
        )}

        {/* Bonuses tab */}
        {tab === 'bonus' && (
          <div key="bonus" className="animate-tab-enter relative card-surface rounded-2xl overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-900/90 to-transparent z-10 rounded-r-2xl" />
            <div className="overflow-x-auto scroll-smooth">
              <table className="w-full text-sm">
                <thead className="table-header-frost">
                  <tr className="border-b border-[var(--border-subtle)]">
                    {([
                      { key: 'notes'  as BonusSortKey, label: 'Description' },
                      { key: 'amount' as BonusSortKey, label: 'Amount' },
                      { key: 'status' as BonusSortKey, label: 'Status' },
                      { key: 'date'   as BonusSortKey, label: 'Date' },
                    ] as { key: BonusSortKey; label: string }[]).map(({ key, label }) => (
                      <th key={key} onClick={() => handleBonusSort(key)}
                        className={`text-left px-5 py-3 font-medium cursor-pointer select-none transition-colors hover:text-white whitespace-nowrap ${bonusSortKey === key ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                        {label}<SortIcon colKey={key} sortKey={bonusSortKey} sortDir={bonusSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedBonuses.map((b, i) => (
                    <tr key={b.id} className={`table-row-enter row-stagger-${i % 25} relative border-b border-[var(--border-subtle)]/50 odd:bg-[var(--surface)]/30 even:bg-[var(--surface-card)]/30 hover:bg-[var(--surface-card)]/40 hover:shadow-[inset_3px_0_0_rgba(59,130,246,0.5)] transition-colors duration-150 cursor-default`}>
                      <td className="px-5 py-3 text-white">{b.notes || '—'}</td>
                      <td className="px-5 py-3 text-[var(--accent-green)] font-semibold whitespace-nowrap">{fmt$(b.amount)}</td>
                      <td className="px-5 py-3"><PayrollStatusBadge status={b.status} /></td>
                      <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap"><RelativeDate date={b.date} /></td>
                    </tr>
                  ))}
                  {sortedBonuses.length === 0 && (
                    <tr><td colSpan={4} className="px-5 py-10 text-center">
                      <div className="flex justify-center">
                        <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — trophy / award */}
                          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                            {/* Trophy cup */}
                            <path d="M28 16 L52 16 L52 42 C52 50.8 46.6 56 40 56 C33.4 56 28 50.8 28 42 Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            {/* Trophy handles */}
                            <path d="M28 22 C20 22 16 28 16 34 C16 40 20 42 26 42" stroke="#334155" strokeWidth="2" strokeLinecap="round" fill="none"/>
                            <path d="M52 22 C60 22 64 28 64 34 C64 40 60 42 54 42" stroke="#334155" strokeWidth="2" strokeLinecap="round" fill="none"/>
                            {/* Stem */}
                            <rect x="36" y="56" width="8" height="8" fill="#334155"/>
                            {/* Base */}
                            <rect x="28" y="64" width="24" height="4" rx="2" fill="#334155"/>
                            {/* Star inside */}
                            <path d="M40 26 L41.8 31.6 L47.7 31.6 L43 35 L44.8 40.6 L40 37.2 L35.2 40.6 L37 35 L32.3 31.6 L38.2 31.6 Z" fill="var(--surface-card)" stroke="var(--accent-cyan)" strokeWidth="1" strokeOpacity="0.5"/>
                          </svg>
                          <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">Your earnings will appear here</p>
                          <p className="text-[var(--text-muted)] text-xs leading-relaxed">Bonus payments will appear here once deals are processed and your admin awards them.</p>
                          <Link
                            href="/dashboard/projects"
                            className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            View Projects
                          </Link>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {sortedBonuses.length > 0 && (
              <PaginationBar totalResults={bonusTotal} startIdx={bonusStart} endIdx={bonusEnd}
                currentPage={bonusSafePage} totalPages={bonusTotalPages} rowsPerPage={bonusPageSize}
                onPageChange={setBonusPage} onRowsPerPageChange={(n) => { setBonusPageSize(n); setBonusPage(1); }} />
            )}
          </div>
        )}

        {/* Reimbursements History tab */}
        {tab === 'reimbursements' && (
          <div key="reimbursements" className="animate-tab-enter card-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h2 className="text-white font-bold tracking-tight text-base">Submission History</h2>
              <button onClick={() => setShowReimbModal(true)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] px-3 py-1.5 rounded-lg transition-colors">
                <Receipt className="w-3.5 h-3.5 text-violet-400" />
                New Request
              </button>
            </div>
            <div className="overflow-x-auto scroll-smooth">
              <table className="w-full text-sm">
                <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Description</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Amount</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Date</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Receipt</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedReimbs.map((r, i) => (
                    <tr key={r.id} className={`table-row-enter row-stagger-${i % 25} animate-slide-in-scale stagger-${Math.min(i + 1, 6)} relative border-b border-[var(--border-subtle)]/50 odd:bg-[var(--surface)]/30 even:bg-[var(--surface-card)]/30 hover:bg-[var(--surface-card)]/40 hover:shadow-[inset_3px_0_0_rgba(139,92,246,0.5)] transition-colors duration-150 cursor-default`}>
                      <td className="px-5 py-3 text-white">{r.description}</td>
                      <td className="px-5 py-3 text-[var(--accent-green)] font-semibold whitespace-nowrap">${r.amount.toFixed(2)}</td>
                      <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap"><RelativeDate date={r.date} /></td>
                      <td className="px-5 py-3 text-[var(--text-secondary)] text-xs">{r.receiptName || '—'}</td>
                      <td className="px-5 py-3"><ReimbStatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                  {filteredReimbs.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-10 text-center">
                      <div className="flex justify-center">
                        <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — receipt / document */}
                          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                            {/* Receipt body */}
                            <path d="M18 14 L62 14 L62 66 L54 62 L46 66 L38 62 L30 66 L22 62 L18 66 Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            {/* Lines on receipt */}
                            <line x1="26" y1="26" x2="54" y2="26" stroke="#334155" strokeWidth="2" strokeLinecap="round"/>
                            <line x1="26" y1="34" x2="54" y2="34" stroke="#334155" strokeWidth="2" strokeLinecap="round"/>
                            <line x1="26" y1="42" x2="42" y2="42" stroke="#334155" strokeWidth="2" strokeLinecap="round"/>
                            {/* Amount line */}
                            <line x1="26" y1="50" x2="54" y2="50" stroke="var(--surface-card)" strokeWidth="2.5" strokeLinecap="round"/>
                            {/* Dollar badge */}
                            <circle cx="58" cy="22" r="9" fill="var(--surface-card)" stroke="#7c3aed" strokeWidth="1.5" strokeOpacity="0.5"/>
                            <text x="58" y="26.5" textAnchor="middle" fill="#a78bfa" fontSize="11" fontWeight="bold" fontFamily="sans-serif">$</text>
                          </svg>
                          <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">Your earnings will appear here</p>
                          <p className="text-[var(--text-muted)] text-xs leading-relaxed">Submit a reimbursement request and it will appear here for tracking once processed.</p>
                          <button
                            onClick={() => setShowReimbModal(true)}
                            className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Submit Request
                          </button>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredReimbs.length > 0 && (
              <PaginationBar totalResults={reimbTotal} startIdx={reimbStart} endIdx={reimbEnd}
                currentPage={reimbSafePage} totalPages={reimbTotalPages} rowsPerPage={reimbPageSize}
                onPageChange={setReimbPage} onRowsPerPageChange={(n) => { setReimbPageSize(n); setReimbPage(1); }} />
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Earnings Skeleton ─────────────────────────────────────────────────────────


// ── Admin Financials View ─────────────────────────────────────────────────────

function AdminFinancialsView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { payrollEntries, setPayrollEntries, reimbursements, setReimbursements, reps } = useApp();
  const isHydrated = useIsHydrated();
  const { toast } = useToast();

  type AdminTab = 'payroll' | 'reimbursements' | 'by-rep';
  const ADMIN_TABS = ['payroll', 'reimbursements', 'by-rep'] as const;
  const rawTab = searchParams.get('tab');
  const [tab, setTabState] = useSearchParamTab(rawTab, ADMIN_TABS, 'payroll');
  const setTab = (t: AdminTab) => {
    setTabState(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Payroll tab filters + pagination
  const [repFilter,    setRepFilter]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [payrollPage,  setPayrollPage]  = useState(1);
  const [payrollPageSize, setPayrollPageSize] = useState(25);
  const [payrollSortKey, setPayrollSortKey] = useState<'repName' | 'customerName' | 'paymentStage' | 'amount' | 'status' | 'date'>('date');
  const [payrollSortDir, setPayrollSortDir] = useState<SortDir>('desc');
  const [markAllConfirmOpen, setMarkAllConfirmOpen] = useState(false);
  const [deleteReimConfirm, setDeleteReimConfirm] = useState<{ id: string; label: string } | null>(null);

  const handlePayrollSort = (key: typeof payrollSortKey) => {
    setPayrollPage(1);
    if (payrollSortKey === key) { setPayrollSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setPayrollSortKey(key); setPayrollSortDir('asc'); }
  };

  const filteredPayroll = useMemo(() => {
    return payrollEntries
      .filter((e) => (!repFilter || e.repId === repFilter) && (!statusFilter || e.status === statusFilter))
      .sort((a, b) => {
        let cmp = 0;
        switch (payrollSortKey) {
          case 'repName':      cmp = (a.repName ?? '').localeCompare(b.repName ?? ''); break;
          case 'customerName': cmp = (a.customerName ?? '').localeCompare(b.customerName ?? ''); break;
          case 'paymentStage': cmp = (a.paymentStage ?? '').localeCompare(b.paymentStage ?? ''); break;
          case 'amount':       cmp = a.amount - b.amount; break;
          case 'status':       cmp = a.status.localeCompare(b.status); break;
          case 'date':         cmp = a.date.localeCompare(b.date); break;
        }
        return payrollSortDir === 'asc' ? cmp : -cmp;
      });
  }, [payrollEntries, repFilter, statusFilter, payrollSortKey, payrollSortDir]);

  const payrollTotal      = filteredPayroll.length;
  const payrollTotalPages = Math.max(1, Math.ceil(payrollTotal / payrollPageSize));
  const payrollSafePage   = Math.min(payrollPage, payrollTotalPages);
  const payrollStart      = (payrollSafePage - 1) * payrollPageSize;
  const payrollEnd        = Math.min(payrollStart + payrollPageSize, payrollTotal);
  const pagedPayroll      = filteredPayroll.slice(payrollStart, payrollEnd);

  // Reimbursements tab filters + pagination
  const [reimbRepFilter,    setReimbRepFilter]    = useState('');
  const [reimbStatusFilter, setReimbStatusFilter] = useState('');
  const [reimbShowArchived, setReimbShowArchived] = useState(false);
  const [reimbPage,         setReimbPage]         = useState(1);
  const [reimbPageSize,     setReimbPageSize]     = useState(25);

  const filteredReimbs = useMemo(() => {
    return reimbursements.filter((r) =>
      (!reimbRepFilter || r.repId === reimbRepFilter) &&
      (!reimbStatusFilter || r.status === reimbStatusFilter) &&
      // Default list hides archived rows. Toggle the "Show archived"
      // chip to surface them (for undo, audit, or hard-delete).
      (reimbShowArchived ? true : !r.archivedAt)
    ).sort((a, b) => b.date.localeCompare(a.date));
  }, [reimbursements, reimbRepFilter, reimbStatusFilter, reimbShowArchived]);

  // Stats — computed from rep-filtered (not status-filtered) data so status breakdown is always accurate
  const repFilteredPayroll = repFilter ? payrollEntries.filter((e) => e.repId === repFilter) : payrollEntries;
  const todayStr      = todayLocalDateStr();
  const totalPaid     = repFilteredPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((s, p) => s + p.amount, 0);
  const totalPending  = repFilteredPayroll.filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0);
  const totalDraft    = repFilteredPayroll.filter((p) => p.status === 'Draft').reduce((s, p) => s + p.amount, 0);
  const repFilteredReimbs = repFilter ? reimbursements.filter((r) => r.repId === repFilter) : reimbursements;
  const pendingReimbs = repFilteredReimbs.filter((r) => r.status === 'Pending').reduce((s, r) => s + r.amount, 0);

  const reimbTotal      = filteredReimbs.length;
  const reimbTotalPages = Math.max(1, Math.ceil(reimbTotal / reimbPageSize));
  const reimbSafePage   = Math.min(reimbPage, reimbTotalPages);
  const reimbStart      = (reimbSafePage - 1) * reimbPageSize;
  const reimbEnd        = Math.min(reimbStart + reimbPageSize, reimbTotal);
  const pagedReimbs     = filteredReimbs.slice(reimbStart, reimbEnd);

  const markPaid = (id: string) => {
    setPayrollEntries((prev) => prev.map((e) => e.id === id && e.status === 'Pending' ? { ...e, status: 'Paid' } : e));
    fetch(`/api/payroll/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Paid' }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Marked as paid', 'success'); })
      .catch((err) => { console.error(err); setPayrollEntries((prev) => prev.map((e) => e.id === id && e.status === 'Paid' ? { ...e, status: 'Pending' } : e)); toast('Failed to mark as paid', 'error'); });
  };

  const markAllPendingPaid = async () => {
    const pending = filteredPayroll.filter((e) => e.status === 'Pending').map((e) => e.id);
    if (!pending.length) return;
    const idSet = new Set(pending);
    setPayrollEntries((prev) => prev.map((e) => idSet.has(e.id) ? { ...e, status: 'Paid' } : e));
    const results = await Promise.allSettled(
      pending.map((id) =>
        fetch(`/api/payroll/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Paid' }) })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return id; })
      )
    );
    const failedIds = new Set(
      results.flatMap((r, i) => r.status === 'rejected' ? [pending[i]] : [])
    );
    if (failedIds.size > 0) {
      setPayrollEntries((prev) => prev.map((e) => failedIds.has(e.id) ? { ...e, status: 'Pending' } : e));
      toast(`${failedIds.size} entr${failedIds.size === 1 ? 'y' : 'ies'} failed to update`, 'error');
    }
    const successCount = pending.length - failedIds.size;
    if (successCount > 0) toast(`Marked ${successCount} entr${successCount === 1 ? 'y' : 'ies'} as paid`, 'success');
  };

  const approveReim = (id: string) => {
    const originalStatus = reimbursements.find((r) => r.id === id)?.status ?? 'Pending';
    setReimbursements((prev) => prev.map((r) => r.id === id ? { ...r, status: 'Approved' } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Approved' }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement approved', 'success'); })
      .catch((err) => { console.error(err); setReimbursements((prev) => prev.map((r) => r.id === id ? { ...r, status: originalStatus } : r)); toast('Failed to approve reimbursement', 'error'); });
  };

  const rejectReim = (id: string) => {
    const originalStatus = reimbursements.find((r) => r.id === id)?.status ?? 'Pending';
    setReimbursements((prev) => prev.map((r) => r.id === id ? { ...r, status: 'Denied' } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Denied' }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement rejected', 'info'); })
      .catch((err) => { console.error(err); setReimbursements((prev) => prev.map((r) => r.id === id ? { ...r, status: originalStatus } : r)); toast('Failed to reject reimbursement', 'error'); });
  };

  // Soft-archive. Default list hides archived rows; the "Show archived"
  // toggle surfaces them. Preferred over hard delete for all but typo cleanup.
  const archiveReim = (id: string) => {
    const row = reimbursements.find((r) => r.id === id);
    if (!row) return;
    const nowIso = new Date().toISOString();
    setReimbursements((prev) => prev.map((r) => r.id === id ? { ...r, archivedAt: nowIso } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement archived', 'success'); })
      .catch((err) => { console.error(err); setReimbursements((prev) => prev.map((r) => r.id === id ? row : r)); toast('Failed to archive', 'error'); });
  };

  // Unarchive — for undo. Only reachable when "Show archived" is on.
  const unarchiveReim = (id: string) => {
    const row = reimbursements.find((r) => r.id === id);
    if (!row) return;
    setReimbursements((prev) => prev.map((r) => r.id === id ? { ...r, archivedAt: undefined } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement restored', 'success'); })
      .catch((err) => { console.error(err); setReimbursements((prev) => prev.map((r) => r.id === id ? row : r)); toast('Failed to restore', 'error'); });
  };

  // Destructive hard delete — typo cleanup only. Most cases should archive.
  const deleteReim = (id: string) => {
    const row = reimbursements.find((r) => r.id === id);
    if (!row) return;
    const label = `${row.repName} — $${row.amount.toFixed(2)} — ${row.description}`;
    setDeleteReimConfirm({ id, label });
  };

  const confirmDeleteReim = () => {
    if (!deleteReimConfirm) return;
    const { id } = deleteReimConfirm;
    const row = reimbursements.find((r) => r.id === id);
    setDeleteReimConfirm(null);
    if (!row) return;
    setReimbursements((prev) => prev.filter((r) => r.id !== id));
    fetch(`/api/reimbursements/${id}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement deleted', 'success'); })
      .catch((err) => { console.error(err); setReimbursements((prev) => [...prev, row]); toast('Failed to delete — rolled back', 'error'); });
  };

  // By Rep summary — period filter scopes paid/pending/draft to entries
  // whose `date` falls in the selected window. Reimbursements use their
  // own `date` field; "All time" shows everything (default). Mobile
  // already exposes this same filter on MobileEarnings.
  const [byRepPeriod, setByRepPeriod] = useState<Period>('all');
  const repSummary = useMemo(() => {
    return reps.map((rep) => {
      const entries = payrollEntries.filter((e) => e.repId === rep.id && isInPeriod(e.date, byRepPeriod));
      const paid    = entries.filter((e) => e.status === 'Paid' && e.date <= todayStr).reduce((s, e) => s + e.amount, 0);
      const pending = entries.filter((e) => e.status === 'Pending').reduce((s, e) => s + e.amount, 0);
      const draft   = entries.filter((e) => e.status === 'Draft').reduce((s, e) => s + e.amount, 0);
      const reimbs  = reimbursements.filter((r) => r.repId === rep.id && isInPeriod(r.date, byRepPeriod) && !r.archivedAt);
      const reimbPending = reimbs.filter((r) => r.status === 'Pending').reduce((s, r) => s + r.amount, 0);
      return { rep, paid, pending, draft, reimbPending, total: paid + pending + draft };
    }).sort((a, b) => b.total - a.total);
  }, [reps, payrollEntries, reimbursements, todayStr, byRepPeriod]);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const TABS = ['payroll', 'reimbursements', 'by-rep'] as const;
    const idx = TABS.indexOf(tab);
    const el = tabRefs.current[idx];
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab, isHydrated]);

  const pendingPayrollCount = repFilteredPayroll.filter((e) => e.status === 'Pending').length;
  const pendingReimbCount   = repFilteredReimbs.filter((r) => r.status === 'Pending').length;

  const payrollFilterLabel = repFilter ? (reps.find((r) => r.id === repFilter)?.name ?? null) : null;

  const selectCls = 'bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none transition-all input-focus-glow';

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      {/* Header */}
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <Building2 className="w-5 h-5 text-[var(--accent-green)]" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Financials</h1>
        </div>
        <p className="text-[var(--text-secondary)] text-sm font-medium ml-12 tracking-wide">Company payroll, reimbursements, and rep summaries</p>
      </div>

      {/* Stat cards — 4 across */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card-surface card-surface-stat rounded-2xl p-5 h-full animate-slide-in-scale stagger-1" style={{ '--card-accent': 'rgba(16,185,129,0.12)' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-3" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Total Paid</span>
            <DollarSign className="w-4 h-4 text-[var(--accent-green)]" />
          </div>
          <p className="text-2xl font-black tabular-nums tracking-tight text-[var(--accent-green)]">${totalPaid.toLocaleString()}</p>
          {payrollFilterLabel && <p className="text-xs text-[var(--text-muted)] mt-1">{payrollFilterLabel}</p>}
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-5 h-full animate-slide-in-scale stagger-2" style={{ '--card-accent': 'rgba(234,179,8,0.12)' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 mb-3" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Pending Payroll</span>
            <TrendingUp className="w-4 h-4 text-yellow-400" />
          </div>
          <p className="text-2xl font-black tabular-nums tracking-tight text-yellow-400">${totalPending.toLocaleString()}</p>
          {pendingPayrollCount > 0 && <p className="text-xs text-[var(--text-muted)] mt-1">{pendingPayrollCount} entries</p>}
          {payrollFilterLabel && <p className="text-xs text-[var(--text-muted)] mt-1">{payrollFilterLabel}</p>}
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-5 h-full animate-slide-in-scale stagger-3" style={{ '--card-accent': 'rgba(100,116,139,0.12)' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-slate-500 to-slate-400 mb-3" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Draft</span>
            <DollarSign className="w-4 h-4 text-[var(--text-secondary)]" />
          </div>
          <p className="text-2xl font-black tabular-nums tracking-tight text-[var(--text-secondary)]">${totalDraft.toLocaleString()}</p>
          {payrollFilterLabel && <p className="text-xs text-[var(--text-muted)] mt-1">{payrollFilterLabel}</p>}
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-5 h-full animate-slide-in-scale stagger-4" style={{ '--card-accent': 'rgba(139,92,246,0.12)' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-violet-500 to-violet-400 mb-3" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Reimbs Pending</span>
            <Receipt className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-2xl font-black tabular-nums tracking-tight text-violet-400">${pendingReimbs.toLocaleString()}</p>
          {pendingReimbCount > 0 && <p className="text-xs text-[var(--text-muted)] mt-1">{pendingReimbCount} requests</p>}
          {payrollFilterLabel && <p className="text-xs text-[var(--text-muted)] mt-1">{payrollFilterLabel}</p>}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container">
        {indicatorStyle && <div className="tab-indicator" style={indicatorStyle} />}
        {(['payroll', 'reimbursements', 'by-rep'] as const).map((t, i) => (
          <button key={t} ref={(el) => { tabRefs.current[i] = el; }} onClick={() => setTab(t)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${tab === t ? 'text-white' : 'text-[var(--text-secondary)] hover:text-white'}`}>
            {t === 'payroll' ? `Payroll (${filteredPayroll.length})` : t === 'reimbursements' ? `Reimbursements (${filteredReimbs.length})` : 'By Rep'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-hidden">

        {/* Payroll tab */}
        {tab === 'payroll' && (
          <div key="payroll" className="animate-tab-enter space-y-3">
            {/* Filters + actions */}
            <div className="flex flex-wrap items-center gap-3">
              <select value={repFilter} onChange={(e) => { setRepFilter(e.target.value); setPayrollPage(1); }} className={selectCls}>
                <option value="">All reps</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPayrollPage(1); }} className={selectCls}>
                <option value="">All statuses</option>
                <option value="Pending">Pending</option>
                <option value="Paid">Paid</option>
                <option value="Draft">Draft</option>
              </select>
              {filteredPayroll.some((e) => e.status === 'Pending') && (
                <button onClick={() => setMarkAllConfirmOpen(true)}
                  className="ml-auto flex items-center gap-1.5 bg-emerald-900/30 hover:bg-emerald-800/40 border border-emerald-700/40 text-emerald-300 font-medium px-3 py-1.5 rounded-lg text-sm transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark All Pending Paid
                </button>
              )}
            </div>
            <div className="relative card-surface rounded-2xl overflow-hidden">
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-900/90 to-transparent z-10 rounded-r-2xl" />
              <div className="overflow-x-auto scroll-smooth">
                <table className="w-full text-sm">
                  <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                    <tr className="border-b border-[var(--border-subtle)]">
                      {([
                        { key: 'repName' as const,      label: 'Rep' },
                        { key: 'customerName' as const, label: 'Customer' },
                        { key: 'paymentStage' as const, label: 'Stage' },
                        { key: 'amount' as const,       label: 'Amount' },
                        { key: 'status' as const,       label: 'Status' },
                        { key: 'date' as const,         label: 'Date' },
                      ]).map(({ key, label }) => (
                        <th key={key} onClick={() => handlePayrollSort(key)}
                          className={`text-left px-5 py-3 font-medium cursor-pointer select-none transition-colors hover:text-white whitespace-nowrap ${payrollSortKey === key ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                          {label}<SortIcon colKey={key} sortKey={payrollSortKey} sortDir={payrollSortDir} />
                        </th>
                      ))}
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPayroll.map((e, i) => (
                      <tr key={e.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[var(--border-subtle)]/50 odd:bg-[var(--surface)]/30 even:bg-[var(--surface-card)]/30 hover:bg-[var(--accent-green)]/[0.03] hover:shadow-[inset_3px_0_0_rgba(59,130,246,0.5)] transition-colors duration-150`}>
                        <td className="px-5 py-3 text-white font-medium">{e.repName}</td>
                        <td className="px-5 py-3 text-[var(--text-secondary)]">{e.customerName || '—'}</td>
                        <td className="px-5 py-3"><span className="bg-[var(--border)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded font-medium">{e.paymentStage || e.type}</span></td>
                        <td className="px-5 py-3 text-[var(--accent-green)] font-semibold whitespace-nowrap">{fmt$(e.amount)}</td>
                        <td className="px-5 py-3"><PayrollStatusBadge status={e.status} /></td>
                        <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap"><RelativeDate date={e.date} /></td>
                        <td className="px-5 py-3">
                          {e.status === 'Pending' && (
                            <button onClick={() => markPaid(e.id)}
                              className="flex items-center gap-1 text-xs text-[var(--accent-green)] hover:text-emerald-300 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-700/30 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredPayroll.length === 0 && (
                      <tr><td colSpan={7} className="px-5 py-10 text-center">
                        <div className="flex justify-center">
                          <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                            {/* Illustration — filter funnel with empty list */}
                            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                              {/* Funnel */}
                              <path d="M14 18 L66 18 L46 42 L46 62 L34 56 L34 42 Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5" strokeLinejoin="round"/>
                              {/* Empty lines below funnel */}
                              <line x1="20" y1="70" x2="36" y2="70" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                              <line x1="20" y1="76" x2="28" y2="76" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                              {/* X on funnel */}
                              <line x1="35" y1="28" x2="45" y2="38" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.4"/>
                              <line x1="45" y1="28" x2="35" y2="38" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.4"/>
                            </svg>
                            <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">No entries match your filters</p>
                            <p className="text-[var(--text-muted)] text-xs leading-relaxed">Try adjusting the rep or status filters to find the payroll entries you need.</p>
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredPayroll.length > 0 && (
                <PaginationBar totalResults={payrollTotal} startIdx={payrollStart} endIdx={payrollEnd}
                  currentPage={payrollSafePage} totalPages={payrollTotalPages} rowsPerPage={payrollPageSize}
                  onPageChange={setPayrollPage} onRowsPerPageChange={(n) => { setPayrollPageSize(n); setPayrollPage(1); }} />
              )}
            </div>
          </div>
        )}

        {/* Reimbursements tab */}
        {tab === 'reimbursements' && (
          <div key="reimbursements" className="animate-tab-enter space-y-3">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <select value={reimbRepFilter} onChange={(e) => { setReimbRepFilter(e.target.value); setReimbPage(1); }} className={selectCls}>
                <option value="">All reps</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={reimbStatusFilter} onChange={(e) => { setReimbStatusFilter(e.target.value); setReimbPage(1); }} className={selectCls}>
                <option value="">All statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Denied">Denied</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none px-2 py-1 rounded-lg hover:bg-[var(--surface-card)] transition-colors">
                <input
                  type="checkbox"
                  checked={reimbShowArchived}
                  onChange={(e) => { setReimbShowArchived(e.target.checked); setReimbPage(1); }}
                  className="accent-[var(--accent-green)]"
                />
                Show archived
              </label>
            </div>
            <div className="relative card-surface rounded-2xl overflow-hidden">
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-900/90 to-transparent z-10 rounded-r-2xl" />
              <div className="overflow-x-auto scroll-smooth">
                <table className="w-full text-sm">
                  <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Rep</th>
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Description</th>
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Amount</th>
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Date</th>
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Receipt</th>
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Status</th>
                      <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedReimbs.map((r, i) => (
                      <tr key={r.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[var(--border-subtle)]/50 odd:bg-[var(--surface)]/30 even:bg-[var(--surface-card)]/30 hover:bg-[var(--accent-green)]/[0.03] hover:shadow-[inset_3px_0_0_rgba(139,92,246,0.5)] transition-colors duration-150`}>
                        <td className="px-5 py-3 text-white font-medium">{r.repName}</td>
                        <td className="px-5 py-3 text-[var(--text-secondary)]">{r.description}</td>
                        <td className="px-5 py-3 text-[var(--accent-green)] font-semibold whitespace-nowrap">${r.amount.toFixed(2)}</td>
                        <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap"><RelativeDate date={r.date} /></td>
                        <td className="px-5 py-3 text-[var(--text-secondary)] text-xs">{r.receiptName || '—'}</td>
                        <td className="px-5 py-3"><ReimbStatusBadge status={r.status} /></td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {r.status === 'Pending' && (
                              <>
                                <button onClick={() => approveReim(r.id)}
                                  className="flex items-center gap-1 text-xs text-[var(--accent-green)] hover:text-emerald-300 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-700/30 px-2 py-1 rounded-lg transition-colors">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Approve
                                </button>
                                <button onClick={() => rejectReim(r.id)}
                                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 border border-red-700/30 px-2 py-1 rounded-lg transition-colors">
                                  <XCircle className="w-3.5 h-3.5" />
                                  Reject
                                </button>
                              </>
                            )}
                            {r.archivedAt ? (
                              <button onClick={() => unarchiveReim(r.id)}
                                className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-slate-700/20 hover:bg-slate-700/40 border border-slate-600/40 px-2 py-1 rounded-lg transition-colors">
                                Restore
                              </button>
                            ) : (
                              <button onClick={() => archiveReim(r.id)}
                                title="Hide from default list; can be restored"
                                className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-slate-700/20 hover:bg-slate-700/40 border border-slate-600/40 px-2 py-1 rounded-lg transition-colors">
                                Archive
                              </button>
                            )}
                            <button onClick={() => deleteReim(r.id)}
                              title="Permanently delete — typo cleanup only"
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 bg-red-900/10 hover:bg-red-900/30 border border-red-900/30 px-2 py-1 rounded-lg transition-colors">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredReimbs.length === 0 && (
                      <tr><td colSpan={7} className="px-5 py-10 text-center">
                        <div className="flex justify-center">
                          <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                            {/* Illustration — filter funnel with empty receipt */}
                            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                              {/* Funnel */}
                              <path d="M12 16 L58 16 L40 38 L40 56 L30 50 L30 38 Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5" strokeLinejoin="round"/>
                              {/* Receipt stub to the right */}
                              <rect x="52" y="34" width="18" height="24" rx="3" fill="#0f172a" stroke="#334155" strokeWidth="1.5"/>
                              <line x1="56" y1="41" x2="66" y2="41" stroke="#334155" strokeWidth="1.5" strokeLinecap="round"/>
                              <line x1="56" y1="46" x2="62" y2="46" stroke="#334155" strokeWidth="1.5" strokeLinecap="round"/>
                              {/* X on funnel */}
                              <line x1="28" y1="23" x2="36" y2="31" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.4"/>
                              <line x1="36" y1="23" x2="28" y2="31" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.4"/>
                            </svg>
                            <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">No reimbursements match your filters</p>
                            <p className="text-[var(--text-muted)] text-xs leading-relaxed">Try adjusting the rep or status filters to find the reimbursement requests you need.</p>
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredReimbs.length > 0 && (
                <PaginationBar totalResults={reimbTotal} startIdx={reimbStart} endIdx={reimbEnd}
                  currentPage={reimbSafePage} totalPages={reimbTotalPages} rowsPerPage={reimbPageSize}
                  onPageChange={setReimbPage} onRowsPerPageChange={(n) => { setReimbPageSize(n); setReimbPage(1); }} />
              )}
            </div>
          </div>
        )}

        {/* By Rep tab */}
        {tab === 'by-rep' && (
          <div key="by-rep" className="animate-tab-enter space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={byRepPeriod}
                onChange={(e) => setByRepPeriod(e.target.value as Period)}
                className={selectCls}
                aria-label="Period"
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <span className="text-xs text-[var(--text-muted)]">
                Paid/Pending/Draft scoped to this period · {repSummary.filter((s) => s.total > 0).length} active rep{repSummary.filter((s) => s.total > 0).length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="card-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto scroll-smooth">
              <table className="w-full text-sm">
                <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Rep</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Paid</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Pending</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Draft</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Reimbs Pending</th>
                    <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">Total Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {repSummary.map((s, i) => (
                    <tr key={s.rep.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} border-b border-[var(--border-subtle)]/50 odd:bg-[var(--surface)]/30 even:bg-[var(--surface-card)]/30 hover:bg-[var(--accent-green)]/[0.03] hover:shadow-[inset_3px_0_0_rgba(59,130,246,0.5)] transition-colors duration-150`}>
                      <td className="px-5 py-3">
                        <div>
                          <p className="text-white font-medium">{s.rep.name}</p>
                          <p className="text-[var(--text-muted)] text-xs capitalize">{s.rep.repType}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-[var(--accent-green)] font-semibold whitespace-nowrap">{fmt$(s.paid)}</td>
                      <td className="px-5 py-3 text-yellow-400 font-medium whitespace-nowrap">{fmt$(s.pending)}</td>
                      <td className="px-5 py-3 text-[var(--text-secondary)] whitespace-nowrap">{fmt$(s.draft)}</td>
                      <td className="px-5 py-3 text-violet-400 whitespace-nowrap">{s.reimbPending > 0 ? fmt$(s.reimbPending) : '—'}</td>
                      <td className="px-5 py-3 text-white font-semibold whitespace-nowrap">{fmt$(s.total)}</td>
                    </tr>
                  ))}
                  {repSummary.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="w-10 h-10 text-[var(--text-dim)]" />
                        <p className="text-sm font-semibold text-white">No reps found</p>
                        <p className="text-xs text-[var(--text-muted)]">Rep earnings will appear here once deals are submitted and payroll is processed</p>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        )}

      </div>

      <ConfirmDialog
        open={markAllConfirmOpen}
        onClose={() => setMarkAllConfirmOpen(false)}
        onConfirm={() => { setMarkAllConfirmOpen(false); markAllPendingPaid(); }}
        title="Mark All Pending Paid"
        message={`Mark all ${filteredPayroll.filter((e) => e.status === 'Pending').length} pending entr${filteredPayroll.filter((e) => e.status === 'Pending').length === 1 ? 'y' : 'ies'} as paid?`}
        confirmLabel="Mark Paid"
      />
      <ConfirmDialog
        open={!!deleteReimConfirm}
        onClose={() => setDeleteReimConfirm(null)}
        onConfirm={confirmDeleteReim}
        title="Delete Reimbursement"
        message={`Permanently delete this reimbursement?\n\n${deleteReimConfirm?.label ?? ''}\n\nThis also deletes any attached receipt file. Cannot be undone. Use "Archive" for reversible hide.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function EarningsPage() {
  return (
    <Suspense>
      <EarningsPageInner />
    </Suspense>
  );
}

// ── Sub-Dealer Earnings View ─────────────────────────────────────────────────

function EarningsPageInner() {
  const { effectiveRole, dbReady } = useApp();
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  useEffect(() => { document.title = 'Earnings | Kilo Energy'; }, []);

  if (!isHydrated || !dbReady) return <EarningsSkeleton />;

  if (isMobile) {
    if (effectiveRole === 'sub-dealer') return <SubDealerEarningsView />;
    return <MobileEarnings />;
  }

  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }
  if (effectiveRole === 'admin') return <AdminFinancialsView />;
  if (effectiveRole === 'sub-dealer') return <SubDealerEarningsView />;
  return <RepEarningsView />;
}

