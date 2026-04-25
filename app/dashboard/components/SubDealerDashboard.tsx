'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { TrendingUp, Zap, DollarSign, FolderKanban, PlusCircle } from 'lucide-react';
import { formatCompactKW, fmt$, todayLocalDateStr } from '../../../lib/utils';
import { Project, ACTIVE_PHASES } from '../../../lib/data';
import type { useApp } from '../../../lib/context';
import { type Period, getGreeting } from './dashboard-utils';
import { MyTasksSection, PipelineOverview, PhaseBadge, MilestoneDot, type MentionItem, ACCENT_COLOR_MAP } from '../page';

export function SubDealerDashboard({
  projects,
  allProjects: _allProjects,
  payroll,
  mentions,
  setMentions,
  period,
  setPeriod,
  PERIODS,
  currentRepId,
  currentRepName,
}: {
  projects: Project[];
  allProjects: Project[];
  payroll: ReturnType<typeof useApp>['payrollEntries'];
  mentions: MentionItem[];
  setMentions: React.Dispatch<React.SetStateAction<MentionItem[]>>;
  period: Period;
  setPeriod: (p: Period) => void;
  PERIODS: { value: Period; label: string }[];
  currentRepId: string | null;
  currentRepName: string | null;
}) {
  const periodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [periodIndicator, setPeriodIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = PERIODS.findIndex((p) => p.value === period);
    const el = periodTabRefs.current[idx];
    if (el) setPeriodIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period, PERIODS]);

  // Filter to sub-dealer's own deals
  const myProjects = projects.filter((p) => p.subDealerId === currentRepId || p.repId === currentRepId);
  const myPayroll = payroll.filter((p) => p.repId === currentRepId);
  const activeProjects = myProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));

  // Stats
  const totalDeals = myProjects.length;
  const activePipeline = activeProjects.length;
  const totalKW = myProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((sum, p) => sum + p.kWSize, 0);
  const today = todayLocalDateStr();
  // Sub-dealers earn M1 when acting as setter; include those entries too
  const setterProjectIds = new Set(myProjects.filter((p) => p.setterId === currentRepId).map((p) => p.id));
  const closerProjectIds = new Set(myProjects.filter((p) => p.repId === currentRepId).map((p) => p.id));
  const totalEarned = myPayroll
    .filter((e) => e.status === 'Paid' && e.date <= today && (
      e.paymentStage === 'M2' ||
      e.paymentStage === 'M3' ||
      (e.paymentStage === 'M1' && e.projectId !== null && (setterProjectIds.has(e.projectId) || closerProjectIds.has(e.projectId)))
    ))
    .reduce((sum, e) => sum + e.amount, 0);

  const stats = [
    { label: 'Total Deals', value: totalDeals.toString(), icon: FolderKanban, color: 'text-[var(--accent-emerald-text)]', accentGradient: 'from-blue-500 to-blue-400' },
    { label: 'Active Pipeline', value: activePipeline.toString(), icon: TrendingUp, color: 'text-purple-400', accentGradient: 'from-purple-500 to-purple-400' },
    { label: 'Total kW', value: formatCompactKW(totalKW), icon: Zap, color: 'text-yellow-400', accentGradient: 'from-yellow-500 to-yellow-400' },
    { label: 'Total Earned', value: fmt$(totalEarned), icon: DollarSign, color: 'text-[var(--accent-emerald-text)]', accentGradient: 'from-emerald-500 to-emerald-400' },
  ];

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      {/* Welcome Banner */}
      <div className="card-surface rounded-2xl mb-6">
        <div className="px-6 py-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[var(--text-secondary)] text-sm font-medium tracking-wide mb-1">{getGreeting(currentRepName)}</p>
            <p className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em' }}>
              <span style={{ color: 'var(--text-primary)' }}>Sub-Dealer Dashboard</span>
            </p>
            <p className="text-[var(--text-muted)] text-xs mt-1">Submit deals, track your pipeline and pay</p>
          </div>
          <div className="relative inline-flex shrink-0">
            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-[0.06] blur-[2px] animate-pulse" />
            <Link
              href="/dashboard/new-deal"
              className="relative inline-flex items-center gap-2.5 btn-primary text-black font-bold px-6 py-3 rounded-2xl text-sm"
            >
              <PlusCircle className="w-5 h-5" />
              Submit a Deal
            </Link>
          </div>
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex justify-end mb-6">
        <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 tab-bar-container">
          {periodIndicator && <div className="tab-indicator" style={periodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { periodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${
                period === p.value ? 'text-black font-bold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`card-surface card-surface-stat rounded-2xl p-5 h-full animate-slide-in-scale stagger-${i + 1}`}
              style={{ '--card-accent': ACCENT_COLOR_MAP[stat.accentGradient] ?? 'transparent' } as CSSProperties}
            >
              <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${stat.accentGradient}`} />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">{stat.label}</span>
                <Icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <p className={`stat-value text-3xl font-black tabular-nums tracking-tight ${stat.color}`}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* My Tasks — chatter check items assigned to this sub-dealer */}
      <MyTasksSection
        mentions={mentions}
        onToggleTask={(projectId, messageId, checkItemId, completed) => {
          return fetch(`/api/projects/${projectId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkItemId, completed, completedBy: currentRepId }),
          }).then((res) => {
            if (!res.ok) throw new Error('Failed to update task');
            setMentions((prev) =>
              prev.map((m) =>
                m.messageId === messageId
                  ? { ...m, checkItems: m.checkItems.map((ci) => ci.id === checkItemId ? { ...ci, completed } : ci) }
                  : m
              )
            );
          });
        }}
      />

      {/* Pipeline Overview */}
      {activeProjects.length > 0 && (
        <div className="card-surface rounded-2xl mb-6">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
              <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
                <FolderKanban className="w-4 h-4 text-[var(--accent-emerald-text)]" />
              </div>
              <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base">Pipeline Overview</h2>
            </div>
            <Link href="/dashboard/projects" className="text-[var(--accent-emerald-text)] hover:text-[var(--accent-cyan-text)] text-xs transition-colors">
              View All &rarr;
            </Link>
          </div>
          <div className="divider-gradient-animated" />
          <div className="p-5">
            <PipelineOverview activeProjects={activeProjects} />
          </div>
        </div>
      )}

      {/* Recent Projects */}
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
            <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
              <FolderKanban className="w-4 h-4 text-[var(--accent-emerald-text)]" />
            </div>
            <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base">Recent Projects</h2>
          </div>
          <Link href="/dashboard/projects" className="text-[var(--accent-emerald-text)] hover:text-[var(--accent-cyan-text)] text-xs transition-colors">
            View All &rarr;
          </Link>
        </div>
        <div className="divider-gradient-animated" />
        {myProjects.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-[var(--border-subtle)] rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[var(--surface-card)]/80 flex items-center justify-center mx-auto mb-3">
                <FolderKanban className="w-6 h-6 text-[var(--text-dim)] animate-pulse" />
              </div>
              <p className="text-[var(--text-primary)] font-bold text-sm mb-1">No projects yet</p>
              <p className="text-[var(--text-muted)] text-xs mb-4">Submit your first deal to see it here</p>
              <Link
                href="/dashboard/new-deal"
                className="btn-primary inline-flex items-center gap-2 text-black font-semibold px-5 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                + New Deal
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {[...myProjects].sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? '')).slice(0, 8).map((proj) => {
              const isSubDealerSourced = proj.subDealerId === currentRepId && proj.repId !== currentRepId && proj.setterId !== currentRepId;
              const subDealerPayroll = isSubDealerSourced
                ? myPayroll.filter((e) => e.projectId === proj.id && (e.paymentStage === 'M2' || e.paymentStage === 'M3'))
                : [];
              const estPay = proj.setterId === currentRepId
                ? (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0)
                : isSubDealerSourced
                  ? subDealerPayroll.reduce((s, e) => s + e.amount, 0)
                  : (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0);
              const soldLabel = (() => {
                if (!proj.soldDate) return '—';
                const [y, m, d] = proj.soldDate.split('-').map(Number);
                const sold = new Date(y, m - 1, d);
                const diff = Math.floor((Date.now() - sold.getTime()) / 86_400_000);
                if (diff < 1) return 'Today';
                if (diff === 1) return '1d ago';
                if (diff < 7) return `${diff}d ago`;
                if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
                return sold.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              })();
              return (
                <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} className="block group">
                  <div className="px-5 py-3.5 hover:bg-[var(--accent-emerald-solid)]/[0.03] transition-colors">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-[var(--text-primary)] font-medium text-sm truncate group-hover:text-[var(--accent-cyan-text)] transition-colors">{proj.customerName}</span>
                        <PhaseBadge phase={proj.phase} />
                      </div>
                      <span className="text-[var(--text-muted)] text-xs whitespace-nowrap flex-shrink-0">{soldLabel}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[var(--text-muted)]">{proj.kWSize} kW</span>
                      <span className="text-[var(--text-dim)]">&middot;</span>
                      <span className="text-[var(--accent-emerald-text)] font-semibold">${estPay.toLocaleString()}</span>
                      <div className="flex items-center gap-2.5 ml-auto">
                        {proj.setterId === currentRepId ? (
                          <>
                            {(proj.setterM1Amount ?? 0) > 0 && (
                              <MilestoneDot label="M1" paid={proj.m1Paid} amount={proj.setterM1Amount ?? 0} />
                            )}
                            <MilestoneDot label="M2" paid={proj.m2Paid} amount={proj.setterM2Amount ?? 0} />
                            {(proj.setterM3Amount ?? 0) > 0 && (
                              <MilestoneDot label="M3" paid={proj.m3Paid} amount={proj.setterM3Amount ?? 0} />
                            )}
                          </>
                        ) : isSubDealerSourced ? (
                          <>
                            {subDealerPayroll.filter((e) => e.paymentStage === 'M2').map((e) => (
                              <MilestoneDot key={e.id} label="M2" paid={e.status === 'Paid'} amount={e.amount} />
                            ))}
                            {subDealerPayroll.filter((e) => e.paymentStage === 'M3').map((e) => (
                              <MilestoneDot key={e.id} label="M3" paid={e.status === 'Paid'} amount={e.amount} />
                            ))}
                          </>
                        ) : (
                          <>
                            <MilestoneDot label="M2" paid={proj.m2Paid} amount={proj.m2Amount ?? 0} />
                            {(proj.m3Amount ?? 0) > 0 && (
                              <MilestoneDot label="M3" paid={proj.m3Paid} amount={proj.m3Amount ?? 0} />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
