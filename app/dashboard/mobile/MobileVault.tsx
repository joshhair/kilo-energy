'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { PayrollEntry } from '../../../lib/data';
import { Banknote } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileEmptyState from './shared/MobileEmptyState';

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
  if (status === 'Paid') return 'text-emerald-400';
  if (status === 'Pending') return 'text-amber-400';
  return 'text-slate-400';
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
      <div className="px-5 pt-4 pb-28">
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-slate-500 text-sm">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-8">
      <MobilePageHeader title="My Pay" />

      {/* ── Hero (no card wrapper) ── */}
      <div>
        <p className="text-4xl font-black text-emerald-400 tabular-nums">{fmt$(nextPayoutTotal)}</p>
        <p className="text-xs text-slate-500 mt-1">Next payout</p>
        <p className="text-sm text-slate-400 mt-0.5">
          {formatFridayLabel(nextFridayStr)} &middot; {daysLabel}
        </p>
      </div>

      {/* ── Inline stats (2x2 text grid, no cards) ── */}
      <div className="grid grid-cols-2 gap-y-3 gap-x-6">
        <div>
          <p className="text-sm font-semibold text-emerald-400 tabular-nums">{fmt$(lifetimeEarned)}</p>
          <p className="text-xs text-slate-500">Lifetime</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-blue-400 tabular-nums">{fmt$(pipelineTotal)}</p>
          <p className="text-xs text-slate-500">Pipeline</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-400 tabular-nums">{fmt$(pendingTotal)}</p>
          <p className="text-xs text-slate-500">Pending</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-400 tabular-nums">{fmt$(draftTotal)}</p>
          <p className="text-xs text-slate-500">Draft</p>
        </div>
      </div>

      {/* ── New Request button ── */}
      <button
        onClick={() => router.push('/dashboard/vault?reimb=new')}
        className="w-full min-h-[52px] flex items-center justify-center rounded-2xl bg-blue-600 text-white text-sm font-semibold active:bg-blue-700 transition-colors"
      >
        New Request
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
          <div className="space-y-6">
            {payPeriods.map((period) => (
              <div key={period.friday}>
                {/* Friday group header */}
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold text-white">
                    {formatFridayLabel(period.friday)}
                  </p>
                  <p className="text-sm font-bold text-slate-400 tabular-nums">{fmt$(period.total)}</p>
                </div>

                {/* Entries */}
                <div>
                  {period.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between py-3 border-b border-slate-800/20"
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {entry.customerName || (entry.type === 'Bonus' ? 'Bonus' : '--')}
                        </p>
                        <p className="text-xs text-slate-500">
                          {entry.paymentStage} &middot; {entry.date}
                        </p>
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${statusColor(entry.status)}`}>
                        {fmt$(entry.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
