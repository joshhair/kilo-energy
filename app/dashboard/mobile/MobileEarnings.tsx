'use client';

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { fmt$, localDateString, downloadCSV } from '../../../lib/utils';
import { CheckCircle2, XCircle, Archive, Download, Clock } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { MonthlyEarningsBarChart, computeMonthlyBarData, MONTH_LABELS } from '../earnings/components/MonthlyEarningsBarChart';
import { getNextFriday, formatPayoutDate, daysUntilDate } from '../earnings/components/primitives';

// ── Sort types ─────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type DealSortKey = 'customerName' | 'paymentStage' | 'notes' | 'amount' | 'status' | 'date';
type BonusSortKey = 'notes' | 'amount' | 'status' | 'date';

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
    status === 'Paid' ? 'var(--accent-emerald-solid)' :
    status === 'Pending' ? 'var(--accent-amber-solid)' :
    status === 'Approved' ? 'var(--accent-emerald-solid)' :
    status === 'Denied' ? 'var(--accent-red-solid)' :
    status === 'Draft' ? 'var(--text-muted)' :
    'var(--text-muted)';
  return (
    <span className="inline-flex items-center gap-1.5 text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
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
  const [dealRoleFilter, setDealRoleFilter] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [dealSortKey, setDealSortKey] = useState<DealSortKey>('date');

  useEffect(() => { setMonthFilter(null); }, [period]);
  const [dealSortDir, setDealSortDir] = useState<SortDir>('desc');
  const [bonusSortKey, setBonusSortKey] = useState<BonusSortKey>('date');
  const [bonusSortDir, setBonusSortDir] = useState<SortDir>('desc');

  const monthlyBarData = useMemo(
    () => computeMonthlyBarData(payrollEntries, reimbursements, effectiveRepId),
    [payrollEntries, reimbursements, effectiveRepId],
  );

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-28">
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const myPayroll = payrollEntries.filter((p) => p.repId === effectiveRepId);
  const matchesFilter = (date: string) => monthFilter ? date.startsWith(monthFilter) : matchesPeriod(date, period);
  const dealPayments = myPayroll.filter((p) => p.type === 'Deal' && matchesFilter(p.date));
  const bonusPayments = myPayroll.filter((p) => p.type === 'Bonus' && matchesFilter(p.date));
  const myReimbs = reimbursements.filter((r) => r.repId === effectiveRepId && matchesFilter(r.date));

  const today    = new Date();
  const todayStr = localDateString(today);
  const totalEarned = myPayroll
    .filter((p) => p.status === 'Paid' && p.date <= todayStr)
    .reduce((s, p) => s + p.amount, 0);

  const nextFriday     = getNextFriday(today);
  const nextFridayDate = `${nextFriday.getFullYear()}-${String(nextFriday.getMonth() + 1).padStart(2, '0')}-${String(nextFriday.getDate()).padStart(2, '0')}`;
  const nextFridayStr  = formatPayoutDate(nextFriday);
  const daysLeft       = daysUntilDate(nextFriday, today);
  const nextPayoutItems  = myPayroll.filter((p) => p.status === 'Pending' && p.date === nextFridayDate);
  const nextPayoutTotal  = nextPayoutItems.reduce((s, p) => s + p.amount, 0);
  const nextPayoutCount  = nextPayoutItems.length;

  const isSetterNote = (notes: string | null | undefined) => notes === 'Setter' || (notes ?? '').startsWith('Co-setter');
  const closerCount  = dealPayments.filter((p) => !isSetterNote(p.notes) && !(p.notes ?? '').startsWith('Trainer override')).length;
  const setterCount  = dealPayments.filter((p) => isSetterNote(p.notes)).length;
  const trainerCount = dealPayments.filter((p) => (p.notes ?? '').startsWith('Trainer override')).length;
  const reimbCount   = myReimbs.length;

  const filteredDeals = dealRoleFilter
    ? dealPayments.filter((p) => {
        if (dealRoleFilter === 'Setter') return isSetterNote(p.notes);
        if (dealRoleFilter === 'Trainer') return (p.notes ?? '').startsWith('Trainer override');
        return !isSetterNote(p.notes) && !(p.notes ?? '').startsWith('Trainer override'); // Closer
      })
    : dealPayments;
  const sortedDeals = [...filteredDeals].sort((a, b) => {
    let cmp = 0;
    switch (dealSortKey) {
      case 'customerName': cmp = (a.customerName ?? '').localeCompare(b.customerName ?? ''); break;
      case 'paymentStage': cmp = (a.paymentStage ?? '').localeCompare(b.paymentStage ?? ''); break;
      case 'notes': cmp = (a.notes ?? '').localeCompare(b.notes ?? ''); break;
      case 'amount': cmp = a.amount - b.amount; break;
      case 'status': cmp = a.status.localeCompare(b.status); break;
      case 'date': cmp = a.date.localeCompare(b.date); break;
    }
    return dealSortDir === 'asc' ? cmp : -cmp;
  });
  const sortedBonuses = [...bonusPayments].sort((a, b) => {
    let cmp = 0;
    switch (bonusSortKey) {
      case 'notes': cmp = (a.notes ?? '').localeCompare(b.notes ?? ''); break;
      case 'amount': cmp = a.amount - b.amount; break;
      case 'status': cmp = a.status.localeCompare(b.status); break;
      case 'date': cmp = a.date.localeCompare(b.date); break;
    }
    return bonusSortDir === 'asc' ? cmp : -cmp;
  });
  const sortedReimbs = [...myReimbs].sort((a, b) => b.date.localeCompare(a.date));

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="My Pay" />
        <div className="rounded-2xl p-5 h-24 animate-pulse" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }} />
        <div className="rounded-2xl p-5 h-48 animate-pulse" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }} />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader title="My Pay" />

      {/* ── Next Payout Hero ────────────────────────────────────────────── */}
      {nextPayoutTotal > 0 && (
        <MobileCard hero>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Next Payout</p>
              <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                {fmt$(nextPayoutTotal)}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                Friday, {nextFridayStr}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                {nextPayoutCount} pending {nextPayoutCount === 1 ? 'entry' : 'entries'}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 20%, transparent)', color: 'var(--accent-emerald-text)' }}>
              <Clock className="w-3 h-3" />
              {daysLeft === 0 ? 'Today!' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days away`}
            </span>
          </div>
        </MobileCard>
      )}

      {/* ── Hero total ──────────────────────────────────────────────────── */}
      <MobileCard hero>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Total Earned</p>
        <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
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
              background: period === p.key ? 'var(--accent-emerald-solid)' : 'transparent',
              color: period === p.key ? '#000' : 'var(--text-muted)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Monthly Earnings Bar Chart ──────────────────────────────────── */}
      {monthlyBarData.length > 0 && (
        <MonthlyEarningsBarChart
          data={monthlyBarData}
          selectedMonth={monthFilter}
          onMonthClick={(key) => setMonthFilter((prev) => prev === key ? null : key)}
        />
      )}
      {monthFilter && (
        <div className="flex items-center gap-2 -mt-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {MONTH_LABELS[parseInt(monthFilter.slice(5, 7), 10) - 1]} {monthFilter.slice(0, 4)}
          </span>
          <button
            onClick={() => setMonthFilter(null)}
            className="text-xs underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Deal Payments ───────────────────────────────────────────────── */}
      <MobileSection title="Deal Payments" count={dealPayments.length + myReimbs.length} collapsible defaultOpen>
        <div className="flex justify-end mb-2">
          <button
            onClick={() => {
              const dateStr = localDateString(new Date());
              const headers = ['Type', 'Customer / Note', 'Stage', 'Amount', 'Status', 'Date'];
              const dealRows = sortedDeals.map((e) => [e.type, e.customerName || e.notes || '', e.paymentStage || '', `$${e.amount.toFixed(2)}`, e.status, e.date]);
              const reimbRows = sortedReimbs.map((r) => ['Reimbursement', r.description, 'Reimb', `$${r.amount.toFixed(2)}`, r.status, r.date]);
              downloadCSV(`my-earnings-${dateStr}.csv`, headers, [...dealRows, ...reimbRows]);
            }}
            disabled={sortedDeals.length === 0 && sortedReimbs.length === 0}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--surface-card)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1">
          {([['date', 'Date'], ['customerName', 'Name'], ['paymentStage', 'Stage'], ['amount', '$'], ['status', 'Status']] as [DealSortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                if (dealSortKey === key) setDealSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                else { setDealSortKey(key); setDealSortDir('desc'); }
              }}
              className="min-h-[32px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
              style={{
                background: dealSortKey === key ? 'var(--accent-emerald-soft)' : 'var(--surface-card)',
                color: dealSortKey === key ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {label}{dealSortKey === key ? (dealSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
        {dealPayments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {[
              { key: null,       label: 'All' },
              { key: 'Closer',   label: `Closer (${closerCount})`,   show: closerCount > 0 },
              { key: 'Setter',   label: `Setter (${setterCount})`,   show: setterCount > 0 },
              { key: 'Trainer',  label: `Trainer (${trainerCount})`, show: trainerCount > 0 },
              { key: 'Reimb.',   label: `Reimb. (${reimbCount})`,    show: reimbCount > 0 },
            ].filter((p) => p.key === null || p.show).map(({ key, label }) => (
              <button
                key={key ?? 'all'}
                onClick={() => setDealRoleFilter(key)}
                className="min-h-[36px] px-3 rounded-xl text-sm font-medium whitespace-nowrap transition-colors"
                style={{
                  background: dealRoleFilter === key ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
                  color: dealRoleFilter === key ? '#000' : 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {dealRoleFilter === 'Reimb.' ? (
          sortedReimbs.length === 0 ? (
            <p className="text-base py-4 text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No reimbursements for this period</p>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
              {sortedReimbs.map((entry, idx) => (
                <div
                  key={entry.id}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                  style={{ borderBottom: idx < sortedReimbs.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusDot status={entry.status} />
                      <span className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Reimb.</span>
                      <span className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                    </div>
                  </div>
                  <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                    {fmt$(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
          )
        ) : sortedDeals.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No deal payments for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            {sortedDeals.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedDeals.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.customerName || entry.notes || 'Deal'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    {entry.paymentStage && (
                      <span className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.paymentStage}</span>
                    )}
                    <span className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Bonuses ─────────────────────────────────────────────────────── */}
      <MobileSection title="Bonuses" count={sortedBonuses.length} collapsible defaultOpen>
        <div className="flex justify-end mb-2">
          <button
            onClick={() => {
              const dateStr = localDateString(new Date());
              const headers = ['Type', 'Note', 'Amount', 'Status', 'Date'];
              const rows = sortedBonuses.map((e) => ['Bonus', e.notes || '', `$${e.amount.toFixed(2)}`, e.status, e.date]);
              downloadCSV(`my-bonuses-${dateStr}.csv`, headers, rows);
            }}
            disabled={sortedBonuses.length === 0}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--surface-card)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1">
          {([['date', 'Date'], ['notes', 'Type'], ['amount', '$'], ['status', 'Status']] as [BonusSortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                if (bonusSortKey === key) setBonusSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                else { setBonusSortKey(key); setBonusSortDir('desc'); }
              }}
              className="min-h-[32px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
              style={{
                background: bonusSortKey === key ? 'var(--accent-emerald-soft)' : 'var(--surface-card)',
                color: bonusSortKey === key ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {label}{bonusSortKey === key ? (bonusSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
        {sortedBonuses.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No bonuses for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            {sortedBonuses.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedBonuses.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.notes || 'Bonus'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Reimbursements ──────────────────────────────────────────────── */}
      <MobileSection title="Reimbursements" count={sortedReimbs.length} collapsible defaultOpen>
        <div className="flex justify-end mb-2">
          <button
            onClick={() => {
              const dateStr = localDateString(new Date());
              const headers = ['Description', 'Amount', 'Status', 'Date'];
              const rows = sortedReimbs.map((r) => [r.description, `$${r.amount.toFixed(2)}`, r.status, r.date]);
              downloadCSV(`my-reimbursements-${dateStr}.csv`, headers, rows);
            }}
            disabled={sortedReimbs.length === 0}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--surface-card)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        {sortedReimbs.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No reimbursements for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            {sortedReimbs.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedReimbs.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
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

// ── Admin Earnings View (mobile) ─────────────────────────────────────────────

export function MobileAdminEarnings() {
  const { reimbursements, setReimbursements } = useApp();
  const { toast } = useToast();
  const [adminShowArchived, setAdminShowArchived] = useState(false);
  const [deleteReimbId, setDeleteReimbId] = useState<string | null>(null);

  useEffect(() => { document.title = 'Earnings | Kilo Energy'; }, []);

  const adminReimbsForReview = useMemo(() => {
    return reimbursements
      .filter((r) => adminShowArchived ? true : !r.archivedAt)
      .sort((a, b) => {
        const rank = (s: string) => s === 'Pending' ? 0 : s === 'Approved' ? 1 : s === 'Denied' ? 2 : 3;
        const d = rank(a.status) - rank(b.status);
        if (d !== 0) return d;
        return b.date.localeCompare(a.date);
      });
  }, [reimbursements, adminShowArchived]);

  const undoReimbStatus = (id: string, revertTo: 'Pending' | 'Approved' | 'Denied') => {
    const currentRow = reimbursements.find((r) => r.id === id);
    if (!currentRow) return;
    const currentStatus = currentRow.status;
    setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, status: revertTo } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: revertTo }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reverted', 'info'); })
      .catch(() => { setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, status: currentStatus } : r)); toast('Undo failed — reload to see current state', 'error'); });
  };

  const setReimbStatus = (id: string, status: 'Approved' | 'Denied') => {
    const prev = reimbursements.find((r) => r.id === id)?.status ?? 'Pending';
    setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, status } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(`Reimbursement ${status.toLowerCase()}`, 'success', { label: 'Undo', onClick: () => undoReimbStatus(id, prev as 'Pending' | 'Approved' | 'Denied') }); })
      .catch(() => { setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, status: prev } : r)); toast(`Failed to ${status.toLowerCase()}`, 'error'); });
  };

  const archiveReimbAdmin = (id: string) => {
    const row = reimbursements.find((r) => r.id === id);
    if (!row) return;
    const already = !!row.archivedAt;
    const nowIso = new Date().toISOString();
    setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, archivedAt: already ? undefined : nowIso } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: !already }) })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (already) {
          toast('Reimbursement restored', 'success');
        } else {
          toast('Reimbursement archived', 'success', { label: 'Undo', onClick: () => archiveReimbAdmin(id) });
        }
      })
      .catch(() => { setReimbursements((rs) => rs.map((r) => r.id === id ? row : r)); toast('Failed to update', 'error'); });
  };

  const confirmDeleteReimb = () => {
    const id = deleteReimbId;
    if (!id) return;
    const row = reimbursements.find((r) => r.id === id);
    if (!row) { setDeleteReimbId(null); return; }
    setDeleteReimbId(null);
    setReimbursements((rs) => rs.filter((r) => r.id !== id));
    fetch(`/api/reimbursements/${id}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement deleted', 'success'); })
      .catch(() => { setReimbursements((rs) => [...rs, row]); toast('Failed to delete — rolled back', 'error'); });
  };

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader title="Earnings" />
      <MobileSection
        title="Reimbursement Review"
        count={adminReimbsForReview.filter((r) => r.status === 'Pending').length}
        collapsible
        defaultOpen
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {adminReimbsForReview.filter((r) => r.status === 'Pending').length} pending · {adminReimbsForReview.length} total
          </span>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={adminShowArchived}
              onChange={(e) => setAdminShowArchived(e.target.checked)}
              className="accent-[var(--accent-emerald-solid)]"
            />
            Show archived
          </label>
        </div>
        {adminReimbsForReview.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            {adminShowArchived ? 'No reimbursements' : 'All caught up — no pending reimbursements'}
          </p>
        ) : (
          <div className="space-y-2">
            {adminReimbsForReview.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl p-3"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', opacity: r.archivedAt ? 0.55 : 1 }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{r.repName}</p>
                    <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{r.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusDot status={r.status} />
                      <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{r.date}</span>
                      {r.receiptName && <span className="text-xs" style={{ color: 'var(--text-dim)' }}>· 📎 receipt</span>}
                    </div>
                  </div>
                  <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                    {fmt$(r.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {r.status === 'Pending' && (
                    <>
                      <button
                        onClick={() => setReimbStatus(r.id, 'Approved')}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => setReimbStatus(r.id, 'Denied')}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: 'color-mix(in srgb, var(--accent-red-solid) 15%, transparent)', color: 'rgb(248,113,113)' }}
                      >
                        <XCircle className="w-3.5 h-3.5" /> Deny
                      </button>
                    </>
                  )}
                  {r.receiptUrl && (
                    <a
                      href={r.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--accent-cyan-soft)', color: 'var(--accent-cyan-text)' }}
                    >
                      View receipt
                    </a>
                  )}
                  <button
                    onClick={() => archiveReimbAdmin(r.id)}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    <Archive className="w-3.5 h-3.5" /> {r.archivedAt ? 'Restore' : 'Archive'}
                  </button>
                  <button
                    onClick={() => setDeleteReimbId(r.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: 'color-mix(in srgb, var(--accent-red-solid) 8%, transparent)', color: 'rgb(248,113,113)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 20%, transparent)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </MobileSection>
      <ConfirmDialog
        open={!!deleteReimbId}
        title="Delete Reimbursement"
        message={(() => { const r = reimbursements.find((x) => x.id === deleteReimbId); return r ? `Permanently delete this reimbursement?\n\n${r.repName} — $${r.amount.toFixed(2)} — ${r.description}\n\nAlso deletes any attached receipt. Cannot be undone.` : 'Permanently delete this reimbursement? Cannot be undone.'; })()}
        confirmLabel="Delete"
        onConfirm={confirmDeleteReimb}
        onClose={() => setDeleteReimbId(null)}
        danger
      />
    </div>
  );
}
