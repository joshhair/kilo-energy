'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { PayrollEntry } from '../../../lib/data';
import { Banknote } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileEmptyState from './shared/MobileEmptyState';

// ── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--m-accent, #00e5a0)';
const ACCENT2 = 'var(--m-accent2, #00b4d8)';
const MUTED = 'var(--m-text-muted, #8899aa)';
const DIM = 'var(--m-text-dim, #445577)';
const WARNING = 'var(--m-warning, #f5a623)';

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
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function statusColor(status: string): string {
  if (status === 'Paid') return ACCENT;
  if (status === 'Pending') return WARNING;
  return MUTED;
}

// ── Pay Period Group ─────────────────────────────────────────────────────────

interface PayPeriod {
  friday: string;
  entries: PayrollEntry[];
  total: number;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MobileVault() {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, payrollEntries, projects, reimbursements } = useApp();

  const todayStr = new Date().toISOString().split('T')[0];
  const nextFriday = useMemo(() => getNextFriday(), []);
  const nextFridayStr = useMemo(() => nextFriday.toISOString().split('T')[0], [nextFriday]);

  // ── Filter entries to this rep ──
  const myEntries = useMemo(
    () => payrollEntries.filter((p) => p.repId === effectiveRepId),
    [payrollEntries, effectiveRepId],
  );

  // ── Overview stats ──
  const lifetimeEarned = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.status === 'Paid' && p.date <= todayStr && p.amount > 0)
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, todayStr],
  );

  const pendingTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && (p.status === 'Pending' || (p.status === 'Paid' && p.date > todayStr)))
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, todayStr],
  );

  const draftTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.status === 'Draft')
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId],
  );

  const nextPayoutTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.date === nextFridayStr && p.status !== 'Draft')
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, nextFridayStr],
  );

  // ── Pipeline projection ──
  const myProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          (p.repId === effectiveRepId || p.setterId === effectiveRepId) &&
          p.phase !== 'Cancelled' &&
          p.phase !== 'On Hold',
      ),
    [projects, effectiveRepId],
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

  const pipelineTotal = projectedM1 + projectedM2;

  const daysUntilFriday = (() => {
    const today = new Date();
    const ms = nextFriday.getTime() - today.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  })();

  const daysLabel =
    daysUntilFriday === 0 ? 'Today' : daysUntilFriday === 1 ? '1 day' : `${daysUntilFriday} days`;

  // ── Group entries into pay periods ──
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
      }))
      .sort((a, b) => b.friday.localeCompare(a.friday));
  }, [myEntries]);

  // ── PM guard ──
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
      <MobilePageHeader title="My Pay" />

      {/* ── Hero — next payout ── */}
      <MobileCard hero>
        <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
        <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '2.5rem', color: ACCENT, lineHeight: 1.1 }}>{fmt$(nextPayoutTotal)}</p>
        <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem', marginTop: '0.5rem' }}>
          {formatFridayLabel(nextFridayStr)} &middot; {daysLabel}
        </p>
      </MobileCard>

      {/* ── Stat grid — 2x2 ── */}
      <div className="grid grid-cols-2 gap-3">
        <MobileStatCard label="Lifetime" value={fmt$(lifetimeEarned)} color={ACCENT} />
        <MobileStatCard label="Pipeline" value={fmt$(pipelineTotal)} color={ACCENT2} />
        <MobileStatCard label="Pending" value={fmt$(pendingTotal)} color={WARNING} />
        <MobileStatCard label="Draft" value={fmt$(draftTotal)} color={MUTED} />
      </div>

      {/* ── Reimbursement link — v0 style button ── */}
      <button
        onClick={() => router.push('/dashboard/reimbursement')}
        className="w-full rounded-xl py-3.5 px-5 text-left active:opacity-70 transition-opacity"
        style={{
          background: 'var(--m-card, #0d1525)',
          border: '1px solid var(--m-border, #1a2840)',
          color: ACCENT,
          fontFamily: FONT_BODY,
          fontSize: '1rem',
          fontWeight: 500,
        }}
      >
        Request reimbursement &rarr;
      </button>

      {/* ── Pay History ── */}
      <MobileSection title="Pay History" count={myEntries.length} collapsible defaultOpen>
        {payPeriods.length === 0 ? (
          <MobileEmptyState
            icon={Banknote}
            title="No earnings yet"
            subtitle="Payroll entries will appear here as your deals hit milestones."
          />
        ) : (
          <div className="space-y-4">
            {payPeriods.map((period) => (
              <MobileCard key={period.friday}>
                {/* Friday group header */}
                <div className="flex items-center justify-between mb-3 pb-2 border-b" style={{ borderColor: 'var(--m-border, #1a2840)' }}>
                  <p className="font-bold text-white" style={{ fontFamily: FONT_BODY, fontSize: '0.9rem' }}>
                    {formatFridayLabel(period.friday)}
                  </p>
                  <p className="tabular-nums" style={{ color: '#fff', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{fmt$(period.total)}</p>
                </div>

                {/* Entries */}
                <div>
                  {period.entries.map((entry, i) => (
                    <div
                      key={entry.id}
                      className={`flex items-center justify-between py-3 ${i < period.entries.length - 1 ? 'border-b' : ''}`}
                      style={{ borderColor: 'var(--m-border, #1a2840)' }}
                    >
                      <div>
                        <p className="font-semibold text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>
                          {entry.customerName || (entry.type === 'Bonus' ? 'Bonus' : '--')}
                        </p>
                        <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>
                          {entry.paymentStage} &middot; {entry.date}
                        </p>
                      </div>
                      <p className="font-bold tabular-nums" style={{ color: statusColor(entry.status), fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>
                        {fmt$(entry.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              </MobileCard>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
