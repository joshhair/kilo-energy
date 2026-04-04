'use client';

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { fmt$ } from '../../../lib/utils';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';

// ── Period helpers ──────────────────────────────────────────────────────────

type Period = 'all' | 'this_month' | 'last_month' | 'this_year';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
];

function matchesPeriod(dateStr: string, period: Period): boolean {
  if (period === 'all') return true;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const ym = dateStr.slice(0, 7); // "YYYY-MM"
  const dy = dateStr.slice(0, 4); // "YYYY"

  if (period === 'this_month') {
    return ym === `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  if (period === 'last_month') {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    return ym === `${ly}-${String(lm + 1).padStart(2, '0')}`;
  }
  if (period === 'this_year') {
    return dy === String(y);
  }
  return true;
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'Paid' ? 'bg-emerald-400' :
    status === 'Pending' ? 'bg-yellow-400' :
    status === 'Approved' ? 'bg-emerald-400' :
    status === 'Denied' ? 'bg-red-400' :
    'bg-slate-400';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-slate-400`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      {status}
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileEarnings() {
  const {
    effectiveRole,
    effectiveRepId,
    payrollEntries,
    reimbursements,
  } = useApp();
  const isHydrated = useIsHydrated();

  useEffect(() => { document.title = 'Earnings | Kilo Energy'; }, []);

  const [period, setPeriod] = useState<Period>('all');

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-28">
        <MobilePageHeader title="Earnings" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm text-slate-500">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const myPayroll = payrollEntries.filter((p) => p.repId === effectiveRepId);
  const dealPayments = myPayroll.filter((p) => p.type === 'Deal' && matchesPeriod(p.date, period));
  const bonusPayments = myPayroll.filter((p) => p.type === 'Bonus' && matchesPeriod(p.date, period));
  const myReimbs = reimbursements.filter((r) => r.repId === effectiveRepId && matchesPeriod(r.date, period));

  const totalEarned = myPayroll
    .filter((p) => p.status === 'Paid' && matchesPeriod(p.date, period))
    .reduce((s, p) => s + p.amount, 0);

  const sortedDeals = [...dealPayments].sort((a, b) => b.date.localeCompare(a.date));
  const sortedBonuses = [...bonusPayments].sort((a, b) => b.date.localeCompare(a.date));
  const sortedReimbs = [...myReimbs].sort((a, b) => b.date.localeCompare(a.date));

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-8">
        <MobilePageHeader title="Earnings" />
        <div className="rounded-2xl p-5 bg-slate-900/60 border border-slate-800/20 h-24 animate-pulse" />
        <div className="rounded-2xl p-5 bg-slate-900/60 border border-slate-800/20 h-48 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-8">
      <MobilePageHeader title="Earnings" />

      {/* ── Hero total ──────────────────────────────────────────────────── */}
      <MobileCard>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Earned</p>
        <p className="text-4xl font-black text-emerald-400 tabular-nums">
          {fmt$(totalEarned)}
        </p>
      </MobileCard>

      {/* ── Period tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`min-h-[48px] px-4 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              period === p.key
                ? 'bg-slate-800 text-white'
                : 'text-slate-500 active:bg-slate-800/40'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Deal Payments ───────────────────────────────────────────────── */}
      <MobileSection title="Deal Payments" count={sortedDeals.length} collapsible defaultOpen>
        {sortedDeals.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">No deal payments for this period</p>
        ) : (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800/20 divide-y divide-slate-800/30 overflow-hidden">
            {sortedDeals.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{entry.customerName || entry.notes || 'Deal'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    {entry.paymentStage && (
                      <span className="text-xs text-slate-600">{entry.paymentStage}</span>
                    )}
                    <span className="text-xs text-slate-600">{entry.date}</span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-white tabular-nums whitespace-nowrap">
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Bonuses ─────────────────────────────────────────────────────── */}
      <MobileSection title="Bonuses" count={sortedBonuses.length} collapsible defaultOpen>
        {sortedBonuses.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">No bonuses for this period</p>
        ) : (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800/20 divide-y divide-slate-800/30 overflow-hidden">
            {sortedBonuses.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{entry.notes || 'Bonus'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-xs text-slate-600">{entry.date}</span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-white tabular-nums whitespace-nowrap">
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Reimbursements ──────────────────────────────────────────────── */}
      <MobileSection title="Reimbursements" count={sortedReimbs.length} collapsible defaultOpen>
        {sortedReimbs.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">No reimbursements for this period</p>
        ) : (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800/20 divide-y divide-slate-800/30 overflow-hidden">
            {sortedReimbs.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{entry.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-xs text-slate-600">{entry.date}</span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-white tabular-nums whitespace-nowrap">
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
