'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { ACTIVE_PHASES } from '../../../lib/data';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileBadge from './shared/MobileBadge';
import MobileAdminDashboard from './MobileAdminDashboard';

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

function stalledDays(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileDashboard() {
  const {
    projects,
    payrollEntries,
    effectiveRole,
    effectiveRepId,
  } = useApp();
  const router = useRouter();

  if (effectiveRole === 'admin') return <MobileAdminDashboard />;

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
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Dashboard" />

        {/* Inline stats — NO cards, just text */}
        <div className="grid grid-cols-2 gap-y-4 gap-x-8">
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">{activeProjects.length}</p>
            <p className="text-base text-slate-400">Active Projects</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">{myProjects.length}</p>
            <p className="text-base text-slate-400">Total Projects</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">{totalKW.toFixed(1)}</p>
            <p className="text-base text-slate-400">Total kW</p>
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${flaggedProjects.length > 0 ? 'text-red-400' : 'text-white'}`}>
              {flaggedProjects.length}
            </p>
            <p className="text-base text-slate-400">Flagged</p>
          </div>
        </div>

        {/* Pipeline phase bars */}
        <MobileSection title="Pipeline">
          <div className="space-y-1">
            {ACTIVE_PHASES.map((phase) => {
              const count = phaseCounts[phase] || 0;
              const pct =
                myProjects.length > 0
                  ? (count / myProjects.length) * 100
                  : 0;
              return (
                <div key={phase} className="flex items-center gap-3 py-2">
                  <span className="text-base text-slate-400 w-28 shrink-0">{phase}</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full">
                    <div
                      className="h-full bg-blue-500/60 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-lg font-bold text-slate-400 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </MobileSection>

        {/* Needs Attention */}
        <MobileSection title="Needs Attention" collapsible count={flaggedProjects.length}>
          {flaggedProjects.length === 0 ? (
            <p className="text-base text-slate-400">All clear — no flagged projects.</p>
          ) : (
            <div>
              {flaggedProjects.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors ${
                    i < flaggedProjects.length - 1 ? 'border-b border-slate-800/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <p className="text-base font-semibold text-white truncate">{p.customerName}</p>
                    <MobileBadge value={p.phase} />
                  </div>
                  <span className="text-base text-slate-400 shrink-0 ml-2">Stalled {stalledDays(p.soldDate)}d</span>
                </button>
              ))}
            </div>
          )}
        </MobileSection>

        {/* Recent */}
        <MobileSection title="Recent">
          {myProjects.length === 0 ? (
            <p className="text-base text-slate-400">No projects yet.</p>
          ) : (
            <div>
              {[...myProjects]
                .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
                .slice(0, 5)
                .map((p, i, arr) => (
                  <button
                    key={p.id}
                    onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                    className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors ${
                      i < arr.length - 1 ? 'border-b border-slate-800/30' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-base text-white">{p.customerName}</span>
                      <span className="text-base text-slate-400"> → {p.phase}</span>
                    </div>
                    <span className="text-base text-slate-400 shrink-0 ml-2">{relativeTime(p.soldDate)}</span>
                  </button>
                ))}
            </div>
          )}
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
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [daysUntilPayday]);

  // Recent activity — last 5 by soldDate
  const recentProjects = useMemo(
    () =>
      [...myProjects]
        .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
        .slice(0, 5),
    [myProjects],
  );

  // ── Sub-dealer layout ─────────────────────────────────────────────────────

  if (effectiveRole === 'sub-dealer') {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Dashboard" />

        {/* Hero — next payout, no card wrapper */}
        <div>
          <p className="text-4xl font-black text-emerald-400 tabular-nums">{fmt$(pendingPayrollTotal)}</p>
          <p className="text-base text-slate-400 mt-1">Next payout &middot; {nextFridayLabel}</p>
          <div className="mt-3 h-1.5 bg-slate-800 rounded-full">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, ((7 - daysUntilPayday) / 7) * 100))}%` }}
            />
          </div>
          <p className="text-base text-slate-400 mt-1">{daysUntilPayday} days</p>
        </div>

        {/* Inline stats */}
        <div className="grid grid-cols-2 gap-y-4 gap-x-8 mt-6">
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">{fmt$(totalPaid)}</p>
            <p className="text-base text-slate-400">Paid</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">{totalKW.toFixed(1)}</p>
            <p className="text-base text-slate-400">kW Sold</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">{activeProjects.length}</p>
            <p className="text-base text-slate-400">Active Deals</p>
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${flaggedProjects.length > 0 ? 'text-red-400' : 'text-white'}`}>
              {flaggedProjects.length}
            </p>
            <p className="text-base text-slate-400">Flagged</p>
          </div>
        </div>

        {/* Recent */}
        <MobileSection title="Recent">
          {recentProjects.length === 0 ? (
            <p className="text-base text-slate-400">No projects yet.</p>
          ) : (
            <div>
              {recentProjects.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors ${
                    i < recentProjects.length - 1 ? 'border-b border-slate-800/30' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <span className="text-base text-white">{p.customerName}</span>
                    <span className="text-base text-slate-400"> → {p.phase}</span>
                  </div>
                  <span className="text-base text-slate-400 shrink-0 ml-2">{relativeTime(p.soldDate)}</span>
                </button>
              ))}
            </div>
          )}
        </MobileSection>
      </div>
    );
  }

  // ── Rep layout (full) ─────────────────────────────────────────────────────

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Dashboard" />

      {/* Hero — next payout, no card wrapper */}
      <div>
        <p className="text-4xl font-black text-emerald-400 tabular-nums">{fmt$(pendingPayrollTotal)}</p>
        <p className="text-base text-slate-400 mt-1">Next payout &middot; {nextFridayLabel}</p>
        <div className="mt-3 h-1.5 bg-slate-800 rounded-full">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, ((7 - daysUntilPayday) / 7) * 100))}%` }}
          />
        </div>
        <p className="text-base text-slate-400 mt-1">{daysUntilPayday} days</p>
      </div>

      {/* Inline stats — no cards */}
      <div className="grid grid-cols-2 gap-y-4 gap-x-8 mt-6">
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{fmt$(totalPaid)}</p>
          <p className="text-base text-slate-400">Paid</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{totalKW.toFixed(1)}</p>
          <p className="text-base text-slate-400">kW Sold</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{activeProjects.length}</p>
          <p className="text-base text-slate-400">Active Deals</p>
        </div>
        <div>
          <p className={`text-2xl font-bold tabular-nums ${flaggedProjects.length > 0 ? 'text-red-400' : 'text-white'}`}>
            {flaggedProjects.length}
          </p>
          <p className="text-base text-slate-400">Flagged</p>
        </div>
      </div>

      {/* Needs Attention */}
      <MobileSection title="Needs Attention" collapsible count={flaggedProjects.length}>
        {flaggedProjects.length === 0 ? (
          <p className="text-base text-slate-400">All clear — no flagged projects.</p>
        ) : (
          <div>
            {flaggedProjects.map((p, i) => (
              <button
                key={p.id}
                onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors ${
                  i < flaggedProjects.length - 1 ? 'border-b border-slate-800/30' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <p className="text-base font-semibold text-white truncate">{p.customerName}</p>
                  <MobileBadge value={p.phase} />
                </div>
                <span className="text-base text-slate-400 shrink-0 ml-2">Stalled {stalledDays(p.soldDate)}d</span>
              </button>
            ))}
          </div>
        )}
      </MobileSection>

      {/* Recent */}
      <MobileSection title="Recent">
        {recentProjects.length === 0 ? (
          <p className="text-base text-slate-400">No projects yet.</p>
        ) : (
          <div>
            {recentProjects.map((p, i) => (
              <button
                key={p.id}
                onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors ${
                  i < recentProjects.length - 1 ? 'border-b border-slate-800/30' : ''
                }`}
              >
                <div className="min-w-0">
                  <span className="text-base text-white">{p.customerName}</span>
                  <span className="text-base text-slate-400"> → {p.phase}</span>
                </div>
                <span className="text-base text-slate-400 shrink-0 ml-2">{relativeTime(p.soldDate)}</span>
              </button>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
