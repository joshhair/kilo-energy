'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, getM1PayDate } from '../../../lib/utils';
import { ACTIVE_PHASES } from '../../../lib/data';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileBadge from './shared/MobileBadge';

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const diffMs = Date.now() - then.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const PIPELINE_BAR_COLORS: Record<string, string> = {
  'New':             'bg-sky-500',
  'Acceptance':      'bg-indigo-500',
  'Site Survey':     'bg-violet-500',
  'Design':          'bg-fuchsia-500',
  'Permitting':      'bg-amber-500',
  'Pending Install': 'bg-orange-500',
  'Installed':       'bg-teal-500',
  'PTO':             'bg-emerald-500',
  'Completed':       'bg-green-500',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileDashboard() {
  const {
    projects,
    payrollEntries,
    reps,
    effectiveRole,
    effectiveRepId,
  } = useApp();
  const router = useRouter();

  // Admin rendering handled by MobileAdminDashboard
  if (effectiveRole === 'admin') return null;

  // ── Shared data derivations ────────────────────────────────────────────────

  const myProjects = useMemo(
    () =>
      effectiveRole === 'project_manager'
        ? projects
        : projects.filter(
            (p) => p.repId === effectiveRepId || p.setterId === effectiveRepId,
          ),
    [projects, effectiveRole, effectiveRepId],
  );

  const activeProjects = useMemo(
    () => myProjects.filter((p) => ACTIVE_PHASES.includes(p.phase)),
    [myProjects],
  );

  const flaggedProjects = useMemo(
    () => myProjects.filter((p) => p.flagged),
    [myProjects],
  );

  // ── PM Dashboard ──────────────────────────────────────────────────────────

  if (effectiveRole === 'project_manager') {
    const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);
    const phaseCounts = ACTIVE_PHASES.reduce(
      (acc, phase) => {
        acc[phase] = myProjects.filter((p) => p.phase === phase).length;
        return acc;
      },
      {} as Record<string, number>,
    );

    return (
      <div className="px-4 pt-3 pb-24 space-y-6">
        <MobilePageHeader title="Dashboard" />

        {/* 2x2 stat grid — NO dollar amounts */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Active Projects" value={activeProjects.length} color="text-blue-400" />
          <MobileStatCard label="Total Projects" value={myProjects.length} color="text-slate-300" />
          <MobileStatCard label="Total kW" value={totalKW.toFixed(1)} color="text-emerald-400" />
          <MobileStatCard
            label="Flagged"
            value={flaggedProjects.length}
            color={flaggedProjects.length > 0 ? 'text-red-400' : 'text-slate-500'}
          />
        </div>

        {/* Pipeline phase bars */}
        <MobileSection title="Pipeline">
          <MobileCard>
            <div className="space-y-2">
              {ACTIVE_PHASES.map((phase) => {
                const count = phaseCounts[phase] || 0;
                const pct =
                  myProjects.length > 0
                    ? (count / myProjects.length) * 100
                    : 0;
                return (
                  <div key={phase} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-28 shrink-0">
                      {phase}
                    </span>
                    <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${PIPELINE_BAR_COLORS[phase] ?? 'bg-blue-500/60'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 tabular-nums w-8 text-right">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </MobileCard>
        </MobileSection>

        {/* Team */}
        <MobileSection title="Team">
          <MobileCard>
            <p className="text-sm text-slate-400">{reps.length} active reps</p>
          </MobileCard>
        </MobileSection>
      </div>
    );
  }

  // ── Rep / Sub-dealer shared data ──────────────────────────────────────────

  const todayStr = new Date().toISOString().split('T')[0];

  const myPayroll = useMemo(
    () => payrollEntries.filter((p) => p.repId === effectiveRepId),
    [payrollEntries, effectiveRepId],
  );

  const totalPaid = useMemo(
    () =>
      myPayroll
        .filter((p) => p.status === 'Paid' && p.date <= todayStr && p.amount > 0)
        .reduce((s, p) => s + p.amount, 0),
    [myPayroll, todayStr],
  );

  const totalKW = useMemo(
    () => myProjects.reduce((s, p) => s + p.kWSize, 0),
    [myProjects],
  );

  // Next payout calculation
  const nextFridayDate = useMemo(() => {
    const today = new Date();
    const d = ((5 - today.getDay() + 7) % 7) || 7;
    const nf = new Date(today);
    nf.setDate(today.getDate() + d);
    return nf.toISOString().split('T')[0];
  }, []);

  const pendingPayrollTotal = useMemo(
    () =>
      payrollEntries
        .filter(
          (p) =>
            p.repId === effectiveRepId &&
            p.date === nextFridayDate &&
            (p.status === 'Pending' || p.status === 'Paid'),
        )
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, nextFridayDate],
  );

  const daysUntilPayday = useMemo(() => {
    const today = new Date();
    return ((5 - today.getDay() + 7) % 7) || 7;
  }, []);

  const nextFridayLabel = useMemo(() => {
    const today = new Date();
    const nf = new Date(today);
    nf.setDate(today.getDate() + daysUntilPayday);
    return nf.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [daysUntilPayday]);

  const paydayCountdown =
    daysUntilPayday === 1
      ? 'Tomorrow'
      : daysUntilPayday === 0
        ? 'Today'
        : `${daysUntilPayday} days`;

  // Recent activity — last 5 by soldDate
  const recentProjects = useMemo(
    () =>
      [...myProjects]
        .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
        .slice(0, 5),
    [myProjects],
  );

  // ── Sub-dealer layout (simpler) ───────────────────────────────────────────

  if (effectiveRole === 'sub-dealer') {
    return (
      <div className="px-4 pt-3 pb-24 space-y-6">
        <MobilePageHeader title="Dashboard" />

        {/* Next Payout */}
        <MobileCard>
          <p className="text-xs text-slate-500 mb-1">Next Payout</p>
          <p className="text-2xl font-bold text-emerald-400 tabular-nums">
            {fmt$(pendingPayrollTotal)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {nextFridayLabel} &middot; {paydayCountdown}
          </p>
        </MobileCard>

        {/* 2x2 stat grid */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Total Paid" value={fmt$(totalPaid)} color="text-emerald-400" />
          <MobileStatCard label="kW Sold" value={totalKW.toFixed(1)} color="text-blue-400" />
          <MobileStatCard label="Active Deals" value={activeProjects.length} color="text-white" />
          <MobileStatCard
            label="Flagged"
            value={flaggedProjects.length}
            color={flaggedProjects.length > 0 ? 'text-red-400' : 'text-slate-500'}
          />
        </div>

        {/* Recent Activity */}
        <MobileSection title="Recent Activity">
          <MobileCard className="divide-y divide-slate-800/60 !p-0 overflow-hidden">
            {recentProjects.length === 0 ? (
              <p className="text-sm text-slate-500 p-4">No projects yet.</p>
            ) : (
              recentProjects.map((p) => (
                <MobileListItem
                  key={p.id}
                  title={p.customerName}
                  subtitle={relativeTime(p.soldDate)}
                  right={<MobileBadge value={p.phase} />}
                  onTap={() => router.push(`/dashboard/projects/${p.id}`)}
                />
              ))
            )}
          </MobileCard>
        </MobileSection>
      </div>
    );
  }

  // ── Rep layout (full) ─────────────────────────────────────────────────────

  return (
    <div className="px-4 pt-3 pb-24 space-y-6">
      <MobilePageHeader title="Dashboard" />

      {/* Next Payout */}
      <MobileCard>
        <p className="text-xs text-slate-500 mb-1">Next Payout</p>
        <p className="text-2xl font-bold text-emerald-400 tabular-nums">
          {fmt$(pendingPayrollTotal)}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {nextFridayLabel} &middot; {paydayCountdown}
        </p>
      </MobileCard>

      {/* 2x2 stat grid */}
      <div className="grid grid-cols-2 gap-3">
        <MobileStatCard label="Total Paid" value={fmt$(totalPaid)} color="text-emerald-400" />
        <MobileStatCard label="kW Sold" value={totalKW.toFixed(1)} color="text-blue-400" />
        <MobileStatCard label="Active Deals" value={activeProjects.length} color="text-white" />
        <MobileStatCard
          label="Flagged"
          value={flaggedProjects.length}
          color={flaggedProjects.length > 0 ? 'text-red-400' : 'text-slate-500'}
        />
      </div>

      {/* Needs Attention */}
      <MobileSection
        title="Needs Attention"
        collapsible
        count={flaggedProjects.length}
      >
        <MobileCard className="divide-y divide-slate-800/60 !p-0 overflow-hidden">
          {flaggedProjects.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">All clear — no flagged projects.</p>
          ) : (
            flaggedProjects.map((p) => (
              <MobileListItem
                key={p.id}
                title={p.customerName}
                subtitle="Flagged for review"
                accent="red"
                onTap={() => router.push(`/dashboard/projects/${p.id}`)}
              />
            ))
          )}
        </MobileCard>
      </MobileSection>

      {/* Recent Activity */}
      <MobileSection title="Recent Activity">
        <MobileCard className="divide-y divide-slate-800/60 !p-0 overflow-hidden">
          {recentProjects.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">No projects yet.</p>
          ) : (
            recentProjects.map((p) => (
              <MobileListItem
                key={p.id}
                title={p.customerName}
                subtitle={relativeTime(p.soldDate)}
                right={<MobileBadge value={p.phase} />}
                onTap={() => router.push(`/dashboard/projects/${p.id}`)}
              />
            ))
          )}
        </MobileCard>
      </MobileSection>
    </div>
  );
}
