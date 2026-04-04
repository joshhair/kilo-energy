'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { PayrollEntry } from '../../../lib/data';
import { Receipt, Banknote, Clock, ChevronDown } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
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

// ── Status / Stage badges ────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Paid:    { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Pending: { bg: 'bg-yellow-500/10 border-yellow-500/20',   text: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  Draft:   { bg: 'bg-slate-500/10 border-slate-500/20',     text: 'text-slate-400',   dot: 'bg-slate-400'   },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.Draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${s.bg} ${s.text}`}>
      <span className={`w-1 h-1 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const color = stage === 'M1' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
    : stage === 'M2' ? 'text-violet-400 bg-violet-500/10 border-violet-500/20'
    : stage === 'M3' ? 'text-teal-400 bg-teal-500/10 border-teal-500/20'
    : 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${color}`}>
      {stage}
    </span>
  );
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

  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const nextFriday = useMemo(() => getNextFriday(), []);
  const nextFridayStr = useMemo(() => nextFriday.toISOString().split('T')[0], [nextFriday]);

  // ── Filter entries to this rep ──
  const myEntries = useMemo(() =>
    payrollEntries.filter((p) => p.repId === effectiveRepId),
    [payrollEntries, effectiveRepId]
  );

  // ── Overview stats ──
  const lifetimeEarned = useMemo(() =>
    payrollEntries.filter((p) => p.repId === effectiveRepId && p.status === 'Paid' && p.date <= todayStr && p.amount > 0)
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, todayStr]
  );

  const pendingTotal = useMemo(() =>
    payrollEntries.filter((p) => p.repId === effectiveRepId && (p.status === 'Pending' || (p.status === 'Paid' && p.date > todayStr)))
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, todayStr]
  );

  const draftTotal = useMemo(() =>
    payrollEntries.filter((p) => p.repId === effectiveRepId && p.status === 'Draft')
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId]
  );

  const nextPayoutTotal = useMemo(() =>
    payrollEntries.filter((p) => p.repId === effectiveRepId && p.date === nextFridayStr && p.status !== 'Draft')
      .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, nextFridayStr]
  );

  // ── Pipeline projection ──
  const myProjects = useMemo(() =>
    projects.filter((p) => (p.repId === effectiveRepId || p.setterId === effectiveRepId) && p.phase !== 'Cancelled' && p.phase !== 'On Hold'),
    [projects, effectiveRepId]
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

  // ── Reimbursements ──
  const myReimbs = useMemo(() =>
    reimbursements.filter((r) => r.repId === effectiveRepId),
    [reimbursements, effectiveRepId]
  );
  const pendingReimbs = myReimbs.filter((r) => r.status === 'Pending');

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
      <div className="px-4 pt-4 pb-20">
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-slate-500 text-sm">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-20">
      <MobilePageHeader title="My Pay" />

      {/* ── Next Payout Hero ── */}
      <MobileCard className="mb-4" accent="emerald">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Next Payout</p>
        <p className="text-2xl font-bold text-emerald-400 tabular-nums">{fmt$(nextPayoutTotal)}</p>
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-slate-400">{formatFridayLabel(nextFridayStr)}</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />
            {daysUntilFriday === 0 ? 'Today!' : daysUntilFriday === 1 ? 'Tomorrow' : `${daysUntilFriday} days`}
          </span>
        </div>
      </MobileCard>

      {/* ── 2x2 Stat Grid ── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <MobileStatCard label="Lifetime" value={fmt$(lifetimeEarned)} color="text-emerald-400" />
        <MobileStatCard label="Pipeline" value={fmt$(pipelineTotal)} color="text-blue-400" />
        <MobileStatCard label="Pending" value={fmt$(pendingTotal)} color="text-amber-400" />
        <MobileStatCard label="Draft" value={fmt$(draftTotal)} color="text-slate-400" />
      </div>

      {/* ── Reimbursements ── */}
      <MobileCard className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-violet-400" />
            <p className="text-sm text-white font-medium">Pending Reimbursements</p>
          </div>
          {pendingReimbs.length > 0 && (
            <span className="text-[10px] font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5">
              {pendingReimbs.length}
            </span>
          )}
        </div>
        <button
          onClick={() => router.push('/dashboard/vault?reimb=new')}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 text-sm font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-xl active:bg-violet-500/20 transition-colors"
        >
          <Receipt className="w-4 h-4" />
          New Request
        </button>
      </MobileCard>

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
              <div key={period.friday}>
                {/* Friday date header */}
                <div className="sticky top-0 z-10 flex items-center justify-between py-1.5 mb-1">
                  <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">
                    {formatFridayLabel(period.friday)}
                  </p>
                  <p className="text-xs font-bold text-slate-400 tabular-nums">{fmt$(period.total)}</p>
                </div>

                {/* Entry cards */}
                <div className="space-y-1">
                  {period.entries.map((entry) => {
                    const isExpanded = expandedEntry === entry.id;
                    return (
                      <MobileCard
                        key={entry.id}
                        onTap={() => setExpandedEntry(isExpanded ? null : entry.id)}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-white truncate mr-2">
                            {entry.customerName || (entry.type === 'Bonus' ? 'Bonus' : '--')}
                          </p>
                          <p className={`text-sm font-bold tabular-nums shrink-0 ${entry.amount < 0 ? 'text-red-400' : entry.status === 'Paid' && entry.date <= todayStr ? 'text-emerald-400' : 'text-white'}`}>
                            {fmt$(entry.amount)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StageBadge stage={entry.paymentStage} />
                          <StatusBadge status={entry.status} />
                          <span className="text-xs text-slate-500 ml-auto">{entry.date}</span>
                          <ChevronDown className={`w-3 h-3 text-slate-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-slate-800/50 space-y-2">
                            {entry.projectId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/dashboard/projects/${entry.projectId}`);
                                }}
                                className="text-xs text-blue-400 font-medium"
                              >
                                View Project
                              </button>
                            )}
                            {entry.notes && (
                              <p className="text-xs text-slate-500">{entry.notes}</p>
                            )}
                            {!entry.projectId && !entry.notes && (
                              <p className="text-xs text-slate-600 italic">No additional details</p>
                            )}
                          </div>
                        )}
                      </MobileCard>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
