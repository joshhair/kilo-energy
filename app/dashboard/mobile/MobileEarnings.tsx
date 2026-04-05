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
    status === 'Paid' ? '#00e5a0' :
    status === 'Pending' ? '#f5a623' :
    status === 'Approved' ? '#00e5a0' :
    status === 'Denied' ? '#ff6b6b' :
    '#8899aa';
  return (
    <span className="inline-flex items-center gap-1.5 text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
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

  useEffect(() => { document.title = 'My Pay | Kilo Energy'; }, []);

  const [period, setPeriod] = useState<Period>('all');

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24">
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
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
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="My Pay" />
        <div className="rounded-2xl p-5 h-24 animate-pulse" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }} />
        <div className="rounded-2xl p-5 h-48 animate-pulse" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }} />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="My Pay" />

      {/* ── Hero total ──────────────────────────────────────────────────── */}
      <MobileCard hero>
        <p className="text-base uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Total Earned</p>
        <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
          {fmt$(totalEarned)}
        </p>
      </MobileCard>

      {/* ── Period tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="min-h-[48px] px-4 rounded-xl text-base font-medium whitespace-nowrap transition-colors"
            style={{
              background: period === p.key ? '#00e5a0' : 'transparent',
              color: period === p.key ? '#000' : 'var(--m-text-muted, #8899aa)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Deal Payments ───────────────────────────────────────────────── */}
      <MobileSection title="Deal Payments" count={sortedDeals.length} collapsible defaultOpen>
        {sortedDeals.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No deal payments for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }}>
            {sortedDeals.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedDeals.length - 1 ? '1px solid var(--m-border, #1a2840)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.customerName || entry.notes || 'Deal'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    {entry.paymentStage && (
                      <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.paymentStage}</span>
                    )}
                    <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
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
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No bonuses for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }}>
            {sortedBonuses.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedBonuses.length - 1 ? '1px solid var(--m-border, #1a2840)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.notes || 'Bonus'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
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
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No reimbursements for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }}>
            {sortedReimbs.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedReimbs.length - 1 ? '1px solid var(--m-border, #1a2840)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
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
