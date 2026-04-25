'use client';

import { FolderKanban, Users } from 'lucide-react';
import { formatCompactKW } from '../../../lib/utils';
import { ACTIVE_PHASES } from '../../../lib/data';
import type { useApp } from '../../../lib/context';
import type { Period } from './dashboard-utils';

export function PMDashboard({
  projects,
  allProjects: _allProjects,
  period,
  setPeriod,
  PERIODS,
  totalReps,
}: {
  projects: ReturnType<typeof useApp>['projects'];
  allProjects: ReturnType<typeof useApp>['projects'];
  period: Period;
  setPeriod: (p: Period) => void;
  PERIODS: { value: Period; label: string }[];
  totalReps: number;
}) {
  const activeProjects = projects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  const phaseCounts = ACTIVE_PHASES.reduce((acc, phase) => {
    acc[phase] = projects.filter((p) => p.phase === phase).length;
    return acc;
  }, {} as Record<string, number>);
  const flaggedCount = projects.filter((p) => p.flagged).length;
  const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center gap-2">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => setPeriod(p.value)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${period === p.value ? 'filter-tab-active' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)]'}`}>{p.label}</button>
        ))}
      </div>

      {/* Summary cards — NO dollar amounts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Projects', value: activeProjects.length, color: 'text-[var(--accent-emerald-text)]' },
          { label: 'Total Projects', value: projects.length, color: 'text-[var(--text-secondary)]' },
          { label: 'Total kW', value: formatCompactKW(totalKW), color: 'text-[var(--accent-emerald-text)]' },
          { label: 'Flagged', value: flaggedCount, color: flaggedCount > 0 ? 'text-[var(--accent-red-text)]' : 'text-[var(--text-muted)]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card-surface rounded-2xl p-5">
            <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline breakdown */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-[var(--text-primary)] font-semibold mb-4 flex items-center gap-2"><FolderKanban className="w-4 h-4 text-[var(--accent-emerald-text)]" /> Pipeline</h2>
        <div className="space-y-2">
          {ACTIVE_PHASES.map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct = activeProjects.length > 0 ? (count / activeProjects.length) * 100 : 0;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className="text-xs text-[var(--text-secondary)] w-28 shrink-0">{phase}</span>
                <div className="flex-1 h-2 bg-[var(--surface-card)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--accent-emerald-solid)]/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-[var(--text-muted)] tabular-nums w-8 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team overview */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-[var(--text-primary)] font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-[var(--accent-emerald-text)]" /> Team</h2>
        <p className="text-[var(--text-secondary)] text-sm">{totalReps} active reps</p>
      </div>
    </div>
  );
}
