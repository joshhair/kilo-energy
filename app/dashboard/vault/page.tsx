'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { formatDate, getM1PayDate, getM2PayDate } from '../../../lib/utils';
import { PayrollEntry, Reimbursement } from '../../../lib/data';
import {
  Vault as VaultIcon, DollarSign, Clock, TrendingUp, ChevronDown, ChevronRight,
  Search, Filter, ArrowRight, Receipt, Banknote, Calendar, ChevronLeft,
  Upload, X,
} from 'lucide-react';
import { buildPageRange } from '../components/PaginationBar';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNextFriday(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = ((5 - day + 7) % 7) || 7;
  const nf = new Date(d);
  nf.setDate(d.getDate() + diff);
  return nf;
}

function getFridayForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = ((5 - day + 7) % 7) || 7;
  if (day === 5) return dateStr;
  const nf = new Date(d);
  nf.setDate(d.getDate() + diff);
  return nf.toISOString().split('T')[0];
}

function formatFridayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFridayLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Pay Period Group ─────────────────────────────────────────────────────────

interface PayPeriod {
  friday: string;
  entries: PayrollEntry[];
  total: number;
  isUpcoming: boolean;
  isPast: boolean;
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Paid:    { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Pending: { bg: 'bg-yellow-500/10 border-yellow-500/20',   text: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  Draft:   { bg: 'bg-slate-500/10 border-slate-500/20',     text: 'text-slate-400',   dot: 'bg-slate-400'   },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

// ── Stage badge ──────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const color = stage === 'M1' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
    : stage === 'M2' ? 'text-violet-400 bg-violet-500/10 border-violet-500/20'
    : stage === 'M3' ? 'text-teal-400 bg-teal-500/10 border-teal-500/20'
    : 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {stage}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function VaultPage() {
  const { currentRole, currentRepId, currentRepName, payrollEntries, projects, reimbursements, setReimbursements } = useApp();
  const isHydrated = useIsHydrated();
  const { toast } = useToast();
  useEffect(() => { document.title = 'My Pay | Kilo Energy'; }, []);

  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [showReimbModal, setShowReimbModal] = useState(false);
  const [reimbForm, setReimbForm] = useState({ amount: '', description: '', date: new Date().toISOString().split('T')[0], fileName: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'M1' | 'M2' | 'M3' | 'Bonus'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Draft' | 'Pending' | 'Paid'>('all');
  const [payFilterFrom, setPayFilterFrom] = useState('');
  const [payFilterTo, setPayFilterTo] = useState('');
  const [periodPage, setPeriodPage] = useState(1);
  const periodsPerPage = 10;

  // ── Refs ──
  const searchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Keyboard shortcut: '/' focuses the search input ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Reimbursement modal: auto-focus amount + Escape to close ──
  useEffect(() => {
    if (showReimbModal) {
      requestAnimationFrame(() => amountRef.current?.focus());
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setShowReimbModal(false);
      };
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [showReimbModal]);

  const todayStr = new Date().toISOString().split('T')[0];
  // Wrap in useMemo so the React Compiler can treat nextFriday/nextFridayStr as
  // stable memoized values — without this the compiler flags any useMemo that
  // lists nextFridayStr as a dep with "Existing memoization could not be preserved".
  const nextFriday = useMemo(() => getNextFriday(), []);
  const nextFridayStr = useMemo(() => nextFriday.toISOString().split('T')[0], [nextFriday]);

  // ── Filter entries to this rep ──
  const myEntries = useMemo(() => {
    let entries = payrollEntries.filter((p) => p.repId === currentRepId);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter((e) =>
        (e.customerName ?? '').toLowerCase().includes(q) ||
        (e.notes ?? '').toLowerCase().includes(q) ||
        (e.repName ?? '').toLowerCase().includes(q)
      );
    }
    if (filterType !== 'all') {
      entries = entries.filter((e) => e.paymentStage === filterType);
    }
    if (filterStatus !== 'all') {
      entries = entries.filter((e) => e.status === filterStatus);
    }
    return entries;
  }, [payrollEntries, currentRepId, searchQuery, filterType, filterStatus]);

  // ── Group into pay periods (Friday weeks) ──
  const payPeriods = useMemo((): PayPeriod[] => {
    const groups = new Map<string, PayrollEntry[]>();
    for (const entry of myEntries) {
      const friday = getFridayForDate(entry.date);
      if (!groups.has(friday)) groups.set(friday, []);
      groups.get(friday)!.push(entry);
    }
    return [...groups.entries()]
      .map(([friday, entries]) => ({
        friday,
        entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
        total: entries.reduce((s, e) => s + e.amount, 0),
        isUpcoming: friday === nextFridayStr,
        isPast: friday < todayStr,
      }))
      .sort((a, b) => b.friday.localeCompare(a.friday)) // newest first
      .filter((pp) => {
        if (payFilterFrom && pp.friday < payFilterFrom) return false;
        if (payFilterTo && pp.friday > payFilterTo) return false;
        return true;
      });
  }, [myEntries, nextFridayStr, todayStr, payFilterFrom, payFilterTo]);

  // ── Paginate periods ──
  const totalPeriodPages = Math.max(1, Math.ceil(payPeriods.length / periodsPerPage));
  const safePeriodPage = Math.min(periodPage, totalPeriodPages);
  const pagedPeriods = payPeriods.slice((safePeriodPage - 1) * periodsPerPage, safePeriodPage * periodsPerPage);

  // ── Overview stats ──
  const lifetimeEarned = useMemo(() =>
    payrollEntries.filter((p) => p.repId === currentRepId && p.status === 'Paid' && p.date <= todayStr && p.amount > 0)
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, currentRepId, todayStr]
  );

  const chargebackTotal = useMemo(() =>
    Math.abs(payrollEntries.filter((p) => p.repId === currentRepId && p.amount < 0)
      .reduce((s, p) => s + p.amount, 0)),
    [payrollEntries, currentRepId]
  );

  const pendingTotal = useMemo(() =>
    payrollEntries.filter((p) => p.repId === currentRepId && (p.status === 'Pending' || (p.status === 'Paid' && p.date > todayStr)))
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, currentRepId, todayStr]
  );

  const draftTotal = useMemo(() =>
    payrollEntries.filter((p) => p.repId === currentRepId && p.status === 'Draft')
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, currentRepId]
  );

  const nextPayoutTotal = useMemo(() =>
    payrollEntries.filter((p) => p.repId === currentRepId && p.date === nextFridayStr && p.status !== 'Draft')
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, currentRepId, nextFridayStr]
  );

  // ── Projected outlook: deals in pipeline not yet at milestones ──
  const myProjects = useMemo(() =>
    projects.filter((p) => (p.repId === currentRepId || p.setterId === currentRepId) && p.phase !== 'Cancelled' && p.phase !== 'On Hold'),
    [projects, currentRepId]
  );

  const projectedM1 = useMemo(() => {
    const preAcceptance = ['New'];
    return myProjects
      .filter((p) => preAcceptance.includes(p.phase))
      .reduce((s, p) => s + (p.m1Amount ?? 0), 0);
  }, [myProjects]);

  const projectedM2 = useMemo(() => {
    const preInstalled = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install'];
    return myProjects
      .filter((p) => preInstalled.includes(p.phase))
      .reduce((s, p) => s + (p.m2Amount ?? 0), 0);
  }, [myProjects]);

  // ── Annual Projection ──
  // Uses multiple signals: deal closing pace, average commission per deal, paid history, and pipeline.
  const annualProjection = useMemo(() => {
    const now = new Date();
    const allMyProjects = projects.filter((p) =>
      (p.repId === currentRepId || p.setterId === currentRepId) && p.phase !== 'Cancelled'
    );

    // --- Signal 1: Deal closing pace ---
    // How many deals has the rep closed, and over what time span?
    const sortedByDate = [...allMyProjects].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const totalDeals = sortedByDate.length;

    if (totalDeals === 0) {
      return { annual: 0, monthlyAvg: 0, basis: 'none' as const, details: '' };
    }

    // Average commission per deal (M1 + M2)
    const avgCommissionPerDeal = allMyProjects.reduce((s, p) => s + (p.m1Amount ?? 0) + (p.m2Amount ?? 0), 0) / totalDeals;

    // --- Signal 2: Deals per month pace ---
    const firstDealDate = new Date(sortedByDate[0].soldDate + 'T12:00:00');
    const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / (1000 * 60 * 60 * 24), 1);
    // If rep started very recently (< 30 days), project based on their actual pace but min 30 day window
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;

    // --- Signal 3: Actual paid history ---
    const totalPaidPositive = payrollEntries
      .filter((p) => p.repId === currentRepId && p.status === 'Paid' && p.amount > 0 && p.date <= todayStr)
      .reduce((s, p) => s + p.amount, 0);

    // --- Calculate projection ---
    // Pace-based: deals/month × avg commission × 12 months
    const paceBasedAnnual = dealsPerMonth * avgCommissionPerDeal * 12;

    // If we have meaningful paid history (at least 60 days), blend with actual earnings rate
    let annual: number;
    let monthlyAvg: number;
    let basis: 'pace' | 'blended' | 'none';
    let details: string;

    if (daysSinceFirst >= 60 && totalPaidPositive > 0) {
      // Blended: 60% pace-based + 40% actual paid rate
      const paidMonthlyRate = (totalPaidPositive / daysSinceFirst) * 30.44;
      monthlyAvg = Math.round(paceBasedAnnual / 12 * 0.6 + paidMonthlyRate * 0.4);
      annual = Math.round(monthlyAvg * 12);
      basis = 'blended';
      details = `${dealsPerMonth.toFixed(1)} deals/mo × $${Math.round(avgCommissionPerDeal).toLocaleString()} avg`;
    } else {
      // Pure pace-based (new rep or no paid history yet)
      monthlyAvg = Math.round(paceBasedAnnual / 12);
      annual = Math.round(paceBasedAnnual);
      basis = 'pace';
      details = `${dealsPerMonth.toFixed(1)} deals/mo × $${Math.round(avgCommissionPerDeal).toLocaleString()} avg`;
    }

    // Add pipeline boost: active deals not yet at milestones add to the projection
    const pipelineBoost = Math.round((projectedM1 + projectedM2) * 0.15); // conservative 15%
    annual += pipelineBoost;

    return { annual, monthlyAvg, basis, details };
  }, [projects, payrollEntries, currentRepId, todayStr, projectedM1, projectedM2]);

  const daysUntilFriday = (() => {
    const today = new Date();
    const ms = nextFriday.getTime() - today.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  })();

  // ── Monthly earnings for mini chart ──
  const monthlyEarnings = useMemo(() => {
    const months = new Map<string, number>();
    for (const e of payrollEntries.filter((p) => p.repId === currentRepId && p.status === 'Paid' && p.date <= todayStr)) {
      const m = e.date.slice(0, 7);
      months.set(m, (months.get(m) ?? 0) + e.amount);
    }
    return [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  }, [payrollEntries, currentRepId, todayStr]);

  const maxMonthly = Math.max(...monthlyEarnings.map(([, v]) => v), 1);

  // ── Reimbursements ──
  const myReimbs = useMemo(() =>
    reimbursements.filter((r) => r.repId === currentRepId),
    [reimbursements, currentRepId]
  );
  const pendingReimbs = myReimbs.filter((r) => r.status === 'Pending');
  const approvedReimbTotal = myReimbs.filter((r) => r.status === 'Approved').reduce((s, r) => s + r.amount, 0);

  const handleSubmitReimb = () => {
    const amount = parseFloat(reimbForm.amount);
    if (!amount || amount <= 0 || !reimbForm.description.trim()) return;
    const newReimb: Reimbursement = {
      id: `reimb_${Date.now()}`,
      repId: currentRepId ?? '',
      repName: currentRepName ?? '',
      amount,
      description: reimbForm.description.trim(),
      date: reimbForm.date || new Date().toISOString().split('T')[0],
      status: 'Pending',
      receiptName: reimbForm.fileName || undefined,
    };
    setReimbursements((prev) => [...prev, newReimb]);
    toast('Reimbursement submitted', 'success');
    setShowReimbModal(false);
    setReimbForm({ amount: '', description: '', date: new Date().toISOString().split('T')[0], fileName: '' });
  };

  if (!isHydrated) return <VaultSkeleton />;

  if (currentRole !== 'rep') {
    return (
      <div className="p-8 text-center">
        <p className="text-slate-500 text-sm">My Pay is only available in the rep view.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl animate-fade-in-up">
      {/* ── Reimbursement Modal ── */}
      {showReimbModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowReimbModal(false); }}>
          <div className="card-surface rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-violet-400" />
                <h2 className="text-white font-bold text-base">Request Reimbursement</h2>
              </div>
              <button onClick={() => setShowReimbModal(false)} aria-label="Close reimbursement modal" className="text-slate-400 hover:text-white transition-colors rounded-lg p-1 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Amount ($)</label>
                  <input ref={amountRef} type="number" step="0.01" min="0.01" placeholder="0.00" value={reimbForm.amount}
                    onChange={(e) => setReimbForm((p) => ({ ...p, amount: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder-slate-500 input-focus-glow" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Date</label>
                  <input type="date" value={reimbForm.date}
                    onChange={(e) => setReimbForm((p) => ({ ...p, date: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 input-focus-glow" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Description</label>
                <input type="text" placeholder="e.g. Gas mileage, office supplies..." value={reimbForm.description}
                  onChange={(e) => setReimbForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder-slate-500 input-focus-glow" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Receipt <span className="text-slate-600 font-normal normal-case">(optional)</span></label>
                <label className="flex items-center gap-2 bg-slate-800 border border-slate-700 border-dashed rounded-xl px-4 py-2.5 cursor-pointer hover:border-slate-600 transition-colors">
                  <Upload className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span className="text-slate-500 text-sm truncate">{reimbForm.fileName || 'Attach file...'}</span>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                    onChange={(e) => setReimbForm((p) => ({ ...p, fileName: e.target.files?.[0]?.name ?? '' }))} />
                </label>
              </div>
              <div className="flex gap-3 pt-1">
                <div className="relative inline-flex flex-1">
                  <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 opacity-25 blur-md animate-pulse" />
                  <button onClick={handleSubmitReimb}
                    className="relative w-full btn-primary text-white font-semibold px-5 py-2.5 rounded-xl text-sm active:scale-[0.97]">
                    Submit Request
                  </button>
                </div>
                <button onClick={() => setShowReimbModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium px-5 py-2.5 rounded-xl text-sm transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero Banner — Next Payout + Page Title ── */}
      <div className="card-surface rounded-2xl mb-4 animate-slide-in-scale border-b-2 border-blue-500/15">
        <div className="px-6 py-6 md:px-8 md:py-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 rounded-xl" style={{ backgroundColor: 'rgba(59,130,246,0.12)' }}>
              <VaultIcon className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-gradient-brand tracking-tight">My Pay</h1>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest mb-1.5">Next Payout</p>
              <p className="text-4xl md:text-5xl font-black tabular-nums tracking-tight text-gradient-emerald leading-none"
                 style={{ textShadow: '0 0 32px rgba(16,185,129,0.30)' }}>
                ${nextPayoutTotal.toLocaleString()}
              </p>
              <p className="text-slate-500 text-xs mt-2">{formatFridayLong(nextFridayStr)}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap self-start sm:self-end">
              <Clock className="w-3 h-3 shrink-0" />
              {daysUntilFriday === 0 ? 'Today!' : daysUntilFriday === 1 ? 'Tomorrow' : `${daysUntilFriday} days away`}
            </span>
          </div>
        </div>
      </div>

      {/* ── Gradient divider ── */}
      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mb-4" />

      {/* ── Financial Summary ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {/* Lifetime Earned — anchor card with emerald left border */}
        <div className="card-surface card-surface-stat rounded-2xl p-5 animate-slide-in-scale stagger-1 border-l-2 border-l-emerald-500/40"
             style={{ '--card-accent': 'rgba(16,185,129,0.08)' } as React.CSSProperties}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest">Lifetime Earned</p>
            <DollarSign className="w-4 h-4 text-emerald-400/50" />
          </div>
          <p className="text-3xl font-black tabular-nums text-emerald-400 stat-value"
             style={{ textShadow: '0 0 20px rgba(16,185,129,0.25)' }}>${lifetimeEarned.toLocaleString()}</p>
          {chargebackTotal > 0 && (
            <p className="text-red-400/70 text-[10px] font-semibold mt-1.5 tabular-nums">- ${chargebackTotal.toLocaleString()} chargebacks</p>
          )}
        </div>
        {/* On Pace For — standout card with amber left border + larger number */}
        <div className="card-surface card-surface-stat rounded-2xl p-5 animate-slide-in-scale stagger-2 border-l-2 border-l-amber-500/40"
             style={{ '--card-accent': 'rgba(245,158,11,0.10)' } as React.CSSProperties}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest">On Pace For</p>
            <TrendingUp className="w-4 h-4 text-amber-400/50" />
          </div>
          <p className="text-3xl font-black tabular-nums text-amber-400 stat-value"
             style={{ textShadow: '0 0 20px rgba(245,158,11,0.25)' }}>
            {annualProjection.annual > 0 ? `$${annualProjection.annual.toLocaleString()}` : '—'}
          </p>
          <p className="text-slate-600 text-[10px] mt-1.5">
            {annualProjection.basis === 'blended'
              ? `${new Date().getFullYear()} · $${annualProjection.monthlyAvg.toLocaleString()}/mo avg`
              : annualProjection.basis === 'pace'
              ? `${new Date().getFullYear()} · ${annualProjection.details}`
              : 'Close deals to see projection'}
          </p>
        </div>
        {/* Pipeline — blue left border */}
        <div className="card-surface card-surface-stat rounded-2xl p-5 animate-slide-in-scale stagger-3 border-l-2 border-l-blue-500/40"
             style={{ '--card-accent': 'rgba(59,130,246,0.08)' } as React.CSSProperties}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest">Pipeline</p>
            <TrendingUp className="w-4 h-4 text-blue-400/50" />
          </div>
          <p className="text-2xl font-black tabular-nums text-blue-400 stat-value"
             style={{ textShadow: '0 0 16px rgba(59,130,246,0.3)' }}>${(projectedM1 + projectedM2).toLocaleString()}</p>
          <p className="text-slate-600 text-[10px] mt-1">Projected from {myProjects.length} deals</p>
        </div>
      </div>

      {/* ── Earnings Timeline + Pipeline (side by side on lg) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        {/* Monthly chart */}
        {monthlyEarnings.length > 1 && (
          <div className="card-surface rounded-2xl p-5 animate-slide-in-scale stagger-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Monthly Earnings</p>
              </div>
              <p className="text-emerald-400 text-xs font-bold tabular-nums">
                ${monthlyEarnings[monthlyEarnings.length - 1]?.[1]?.toLocaleString() ?? '0'}
                <span className="text-slate-600 font-normal ml-1">latest</span>
              </p>
            </div>
            <div className="flex items-end gap-3 h-24">
              {monthlyEarnings.map(([month, amount], i) => {
                const pct = (amount / maxMonthly) * 100;
                const label = new Date(month + '-15').toLocaleDateString('en-US', { month: 'short' });
                const isLatest = i === monthlyEarnings.length - 1;
                return (
                  <div key={month} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className={`w-full rounded-lg relative group transition-all duration-300 ${isLatest ? 'bg-emerald-500/30' : 'bg-emerald-500/15 hover:bg-emerald-500/25'}`}
                         style={{ height: `${Math.max(pct, 6)}%` }}>
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 card-surface text-white text-[10px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        ${amount.toLocaleString()}
                      </div>
                      {isLatest && <div className="absolute inset-0 rounded-lg bg-emerald-500/20 animate-pulse" />}
                    </div>
                    <span className={`text-[10px] font-medium ${isLatest ? 'text-emerald-400' : 'text-slate-600'}`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Projected pipeline */}
        {(projectedM1 > 0 || projectedM2 > 0) && (
          <div className="card-surface rounded-2xl p-5 animate-slide-in-scale stagger-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-blue-400" />
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Projected Pipeline</p>
            </div>
            <p className="text-slate-500 text-xs mb-4">Expected if deals progress through milestones</p>
            <div className="space-y-3">
              {projectedM1 > 0 && (
                <div className="card-surface rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <span className="text-blue-400 text-xs font-bold">M1</span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">Pending M1</p>
                      <p className="text-slate-600 text-[10px]">Awaiting Acceptance</p>
                    </div>
                  </div>
                  <p className="text-blue-400 font-bold tabular-nums" style={{ textShadow: '0 0 12px rgba(59,130,246,0.3)' }}>
                    ${projectedM1.toLocaleString()}
                  </p>
                </div>
              )}
              {projectedM2 > 0 && (
                <div className="card-surface rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <span className="text-violet-400 text-xs font-bold">M2</span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">Pending M2</p>
                      <p className="text-slate-600 text-[10px]">Awaiting Installation</p>
                    </div>
                  </div>
                  <p className="text-violet-400 font-bold tabular-nums" style={{ textShadow: '0 0 12px rgba(139,92,246,0.3)' }}>
                    ${projectedM2.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Reimbursements quick status ── */}
      {(pendingReimbs.length > 0 || approvedReimbTotal > 0) && (
        <div className="card-surface rounded-2xl p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt className="w-4 h-4 text-violet-400" />
            <div>
              <p className="text-white text-sm font-medium">Reimbursements</p>
              <p className="text-slate-500 text-xs">{pendingReimbs.length} pending{approvedReimbTotal > 0 ? ` · $${approvedReimbTotal.toLocaleString()} approved` : ''}</p>
            </div>
          </div>
          <button onClick={() => setShowReimbModal(true)} className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
            + New Request
          </button>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search payments..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPeriodPage(1); }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl pl-10 pr-8 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder-slate-600"
          />
          {!searchQuery && !searchFocused && (
            <kbd
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 px-1.5 rounded border border-slate-600 bg-slate-700/60 text-slate-400 font-mono text-[11px] leading-none select-none"
              aria-hidden="true"
            >
              /
            </kbd>
          )}
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium uppercase tracking-wider whitespace-nowrap">Pay Period From</label>
            <input
              type="date"
              value={payFilterFrom}
              onChange={(e) => { setPayFilterFrom(e.target.value); setPeriodPage(1); }}
              className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium uppercase tracking-wider whitespace-nowrap">Pay Period To</label>
            <input
              type="date"
              value={payFilterTo}
              onChange={(e) => { setPayFilterTo(e.target.value); setPeriodPage(1); }}
              className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>
        {(payFilterFrom || payFilterTo) && (
          <button
            onClick={() => { setPayFilterFrom(''); setPayFilterTo(''); setPeriodPage(1); }}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors whitespace-nowrap"
          >
            Clear
          </button>
        )}
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value as typeof filterType); setPeriodPage(1); }}
          className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          <option value="all">All Types</option>
          <option value="M1">M1 Only</option>
          <option value="M2">M2 Only</option>
          <option value="M3">M3 Only</option>
          <option value="Bonus">Bonus Only</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value as typeof filterStatus); setPeriodPage(1); }}
          className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          <option value="all">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Pending">Pending</option>
          <option value="Paid">Paid</option>
        </select>
      </div>

      {/* ── Pay Period List ── */}
      <div className="space-y-3">
        {pagedPeriods.length === 0 && (
          <div className="card-surface rounded-2xl p-8 text-center">
            <Banknote className="w-8 h-8 text-slate-700 mx-auto mb-3" />
            {myProjects.length > 0 ? (
              <>
                <p className="text-slate-400 text-sm font-medium">
                  You have <span className="text-blue-400 font-semibold">{myProjects.length}</span> active deal{myProjects.length !== 1 ? 's' : ''} worth ~<span className="text-emerald-400 font-semibold">${(projectedM1 + projectedM2).toLocaleString()}</span> in projected commissions.
                </p>
                <p className="text-slate-500 text-xs mt-1">
                  Payroll entries will appear here as your deals hit milestones.
                </p>
                <div className="flex items-center justify-center gap-4 mt-4">
                  {(() => {
                    const preAccCount = myProjects.filter((p) => ['New'].includes(p.phase)).length;
                    return preAccCount > 0 ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                        <Clock className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-blue-400 text-xs font-medium">{preAccCount} awaiting M1</span>
                      </div>
                    ) : null;
                  })()}
                  {(() => {
                    const preInstCount = myProjects.filter((p) => ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install'].includes(p.phase)).length;
                    return preInstCount > 0 ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
                        <TrendingUp className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-violet-400 text-xs font-medium">{preInstCount} awaiting M2</span>
                      </div>
                    ) : null;
                  })()}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto mb-3">
                  <Banknote className="w-6 h-6 text-slate-600 animate-pulse" />
                </div>
                <p className="text-white font-bold text-sm mb-1">No earnings yet</p>
                <p className="text-slate-500 text-xs mb-4">Payroll entries will appear here as your deals hit milestones</p>
                <Link
                  href="/dashboard/new-deal"
                  className="btn-primary inline-flex items-center gap-2 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  + New Deal
                </Link>
              </div>
            )}
          </div>
        )}

        {pagedPeriods.map((period) => {
          const isOpen = expandedPeriod === period.friday;
          const entryCount = period.entries.length;
          return (
            <div
              key={period.friday}
              className={`card-surface rounded-2xl overflow-hidden border-l-2 transition-colors ${
                isOpen ? 'border-l-blue-500/40' : 'border-l-transparent'
              } ${period.isUpcoming ? 'border border-emerald-500/20' : ''} ${
                isOpen ? 'bg-gradient-to-r from-blue-500/5 to-transparent' : ''
              }`}
            >
              {/* Period header — clickable to expand */}
              <button
                type="button"
                onClick={() => setExpandedPeriod(isOpen ? null : period.friday)}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} pay period ${formatFridayLabel(period.friday)}`}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-800/30 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:outline-none rounded-2xl"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  period.isUpcoming ? 'bg-emerald-500/15' : period.isPast ? 'bg-slate-800' : 'bg-blue-500/10'
                }`}>
                  {period.isUpcoming ? (
                    <Clock className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <DollarSign className={`w-4 h-4 ${period.isPast ? 'text-slate-500' : 'text-blue-400'}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-semibold">
                      {period.isUpcoming ? 'Upcoming Pay Period' : 'Pay Period'} — {formatFridayLabel(period.friday)}
                    </p>
                    {period.isUpcoming && (
                      <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                        Next
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</p>
                </div>
                <p className={`text-lg font-bold tabular-nums shrink-0 ${period.isUpcoming ? 'text-emerald-400' : period.isPast ? 'text-slate-400' : 'text-white'}`}>
                  ${period.total.toLocaleString()}
                </p>
                <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 nav-chevron-spring ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
              </button>

              {/* Expanded entries — always mounted for smooth grid-rows transition */}
              <div
                className="grid transition-[grid-template-rows] duration-300"
                style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <div className="border-t border-slate-800/50">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-800/50">
                            <th className="text-left px-5 py-2.5 text-slate-500 font-medium text-xs uppercase tracking-wider">Customer</th>
                            <th className="text-left px-3 py-2.5 text-slate-500 font-medium text-xs uppercase tracking-wider">Stage</th>
                            <th className="text-left px-3 py-2.5 text-slate-500 font-medium text-xs uppercase tracking-wider">Status</th>
                            <th className="text-right px-5 py-2.5 text-slate-500 font-medium text-xs uppercase tracking-wider">Amount</th>
                            <th className="text-left px-3 py-2.5 text-slate-500 font-medium text-xs uppercase tracking-wider">Date</th>
                            <th className="text-left px-3 py-2.5 text-slate-500 font-medium text-xs uppercase tracking-wider">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {period.entries.map((entry) => (
                            <tr key={entry.id} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors">
                              <td className="px-5 py-3">
                                {entry.projectId ? (
                                  <Link href={`/dashboard/projects/${entry.projectId}`} className="text-white hover:text-emerald-400 transition-colors font-medium text-xs">
                                    {entry.customerName || '—'}
                                  </Link>
                                ) : (
                                  <span className="text-slate-400 text-xs">{entry.customerName ? entry.customerName : (entry.type === 'Bonus' ? 'Bonus' : '—')}</span>
                                )}
                              </td>
                              <td className="px-3 py-3"><StageBadge stage={entry.paymentStage} /></td>
                              <td className="px-3 py-3"><StatusBadge status={entry.status} /></td>
                              <td className="px-5 py-3 text-right">
                                <span className={`font-semibold tabular-nums ${entry.status === 'Paid' && entry.date <= todayStr ? 'text-emerald-400' : 'text-white'}`}>
                                  ${entry.amount.toLocaleString()}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(entry.date)}</td>
                              <td className="px-3 py-3 text-slate-600 text-xs truncate max-w-[150px]">{entry.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Pagination ── */}
      {totalPeriodPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPeriodPage((p) => Math.max(1, p - 1))}
            disabled={safePeriodPage <= 1}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {buildPageRange(safePeriodPage, totalPeriodPages).map((page, idx) =>
            page === '...' ? (
              <span key={`e-${idx}`} className="px-2 text-slate-600 text-sm">...</span>
            ) : (
              <button
                key={page}
                onClick={() => setPeriodPage(page)}
                className={`min-w-[2rem] px-2 py-1 rounded-lg text-sm font-medium transition-colors ${
                  page === safePeriodPage ? 'text-white bg-emerald-600' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {page}
              </button>
            )
          )}
          <button
            onClick={() => setPeriodPage((p) => Math.min(totalPeriodPages, p + 1))}
            disabled={safePeriodPage >= totalPeriodPages}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Footer stat ── */}
      <div className="mt-6 text-center">
        <p className="text-slate-600 text-xs">
          {myEntries.length} total {myEntries.length === 1 ? 'entry' : 'entries'} across {payPeriods.length} pay {payPeriods.length === 1 ? 'period' : 'periods'}
        </p>
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function VaultSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-slate-800 mb-3 animate-skeleton" />
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-slate-800/60 animate-skeleton"><div className="w-5 h-5" /></div>
          <div>
            <div className="h-8 w-24 bg-slate-800 rounded animate-skeleton" />
            <div className="h-3 w-48 bg-slate-800/70 rounded mt-1 animate-skeleton" style={{ animationDelay: '50ms' }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-surface rounded-2xl p-4">
            <div className="h-2 w-20 bg-slate-800 rounded animate-skeleton mb-2" style={{ animationDelay: `${i * 50}ms` }} />
            <div className="h-7 w-28 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${i * 50 + 25}ms` }} />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card-surface rounded-2xl p-5 mb-3">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-slate-800 animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="flex-1">
              <div className="h-4 w-48 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${i * 75 + 25}ms` }} />
              <div className="h-3 w-24 bg-slate-800/70 rounded mt-1 animate-skeleton" style={{ animationDelay: `${i * 75 + 50}ms` }} />
            </div>
            <div className="h-6 w-20 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${i * 75 + 25}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
