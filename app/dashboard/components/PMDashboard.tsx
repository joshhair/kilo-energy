'use client';

import { FolderKanban, Users } from 'lucide-react';
import { formatCompactKW } from '../../../lib/utils';
import { ACTIVE_PHASES } from '../../../lib/data';
import type { useApp } from '../../../lib/context';
import type { Period } from './dashboard-utils';

export function PMDashboard({
  projects,
  allProjects,
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
  const flaggedCount = allProjects.filter((p) => p.flagged).length;
  const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center gap-2">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => setPeriod(p.value)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${period === p.value ? 'bg-[#00e07a] text-black font-bold' : 'text-[#c2c8d8] hover:text-white hover:bg-[#1d2028]'}`}>{p.label}</button>
        ))}
      </div>

      {/* Summary cards — NO dollar amounts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Projects', value: activeProjects.length, color: 'text-[#00e07a]' },
          { label: 'Total Projects', value: projects.length, color: 'text-[#c2c8d8]' },
          { label: 'Total kW', value: formatCompactKW(totalKW), color: 'text-[#00e07a]' },
          { label: 'Flagged', value: flaggedCount, color: flaggedCount > 0 ? 'text-red-400' : 'text-[#8891a8]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card-surface rounded-2xl p-5">
            <p className="text-xs text-[#8891a8] mb-1">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline breakdown */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2"><FolderKanban className="w-4 h-4 text-[#00e07a]" /> Pipeline</h2>
        <div className="space-y-2">
          {ACTIVE_PHASES.map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct = activeProjects.length > 0 ? (count / activeProjects.length) * 100 : 0;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className="text-xs text-[#c2c8d8] w-28 shrink-0">{phase}</span>
                <div className="flex-1 h-2 bg-[#1d2028] rounded-full overflow-hidden">
                  <div className="h-full bg-[#00e07a]/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-[#8891a8] tabular-nums w-8 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team overview */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-[#00e07a]" /> Team</h2>
        <p className="text-[#c2c8d8] text-sm">{totalReps} active reps</p>
      </div>
    </div>
  );
}
