'use client';

import { useState } from 'react';
import { useApp } from '../../../lib/context';
import { formatDate } from '../../../lib/utils';
import {
  formatIncentiveMetric,
  Incentive,
  IncentiveMetric,
} from '../../../lib/data';
import { Trophy, CheckCircle, ChevronDown, Pencil, Copy, Trash2, Square, CheckSquare, AlertTriangle, Clock } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const QUARTERS = [
  { value: 'Q1', startMonth: 0 },
  { value: 'Q2', startMonth: 3 },
  { value: 'Q3', startMonth: 6 },
  { value: 'Q4', startMonth: 9 },
];

function isExpired(endDate: string | null): boolean {
  if (!endDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = endDate.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  return end < today;
}

function isEndingSoon(endDate: string | null): boolean {
  if (!endDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = endDate.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  if (end < today) return false;
  const diff = (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= 7;
}

function getPeriodDisplayLabel(incentive: Incentive): string {
  const { period, startDate } = incentive;
  if (period === 'alltime') return 'All Time';
  if (!startDate) return '';
  const [y, m] = startDate.split('-').map(Number);
  if (period === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (period === 'quarter') {
    const q = QUARTERS.find((qq) => qq.startMonth === m - 1);
    return q ? `${q.value} ${y}` : `${y}`;
  }
  return `${y}`;
}

export function IncentiveCard({
  incentive,
  progress,
  isAdmin,
  cardIndex,
  onDelete,
  onToggle,
  onMilestoneAchieved,
  onEdit,
  onDuplicate,
  selectMode,
  selected,
  onToggleSelect,
}: {
  incentive: Incentive;
  progress: number;
  isAdmin: boolean;
  cardIndex: number;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onMilestoneAchieved: (incId: string, milestoneId: string, achieved: boolean) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { reps } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [expandGen, setExpandGen] = useState(0);
  const maxThreshold = incentive.milestones.length ? Math.max(...incentive.milestones.map(m => m.threshold)) : 1;
  const pct = Math.min(100, (progress / maxThreshold) * 100);

  const rep = incentive.targetRepId ? reps.find((r) => r.id === incentive.targetRepId) : null;
  const expired = isExpired(incentive.endDate);
  const endingSoon = !expired && isEndingSoon(incentive.endDate);
  const periodDisplay = getPeriodDisplayLabel(incentive);

  const metricLabel: Record<IncentiveMetric, string> = {
    deals: 'deals',
    kw: 'kW',
    commission: 'commission paid',
    revenue: 'revenue',
  };

  return (
    <div
      className={`relative rounded-2xl border overflow-hidden transition-[transform,box-shadow] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 hover:translate-y-[-3px] hover:shadow-[0_0_28px_color-mix(in srgb, var(--accent-emerald-solid) 13%, transparent),0_8px_32px_rgba(0,0,0,0.32)] active:scale-[0.98] active:shadow-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-[var(--accent-emerald-solid)]/30 after:to-transparent after:opacity-0 hover:after:opacity-100 after:transition-opacity animate-slide-in-scale stagger-${Math.min(cardIndex, 6)} ${!incentive.active ? 'opacity-50' : ''}`}
      style={{ borderColor: incentive.type === 'company' ? 'color-mix(in srgb, var(--accent-blue-solid) 30%, transparent)' : 'color-mix(in srgb, var(--accent-purple-solid) 30%, transparent)', background: 'var(--surface)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer"
        onClick={() => { setExpanded((v) => { const next = !v; if (next) setExpandGen((g) => g + 1); return next; }); }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {selectMode && isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(incentive.id); }}
              className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--accent-emerald-text)] transition-colors"
            >
              {selected ? <CheckSquare className="w-4 h-4 text-[var(--accent-emerald-text)]" /> : <Square className="w-4 h-4" />}
            </button>
          )}
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: incentive.type === 'company' ? 'var(--accent-blue-solid)' : 'var(--accent-purple-solid)' }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[var(--text-primary)] font-semibold">{incentive.title}</p>
              {periodDisplay && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-card)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                  {periodDisplay}
                </span>
              )}
              {expired && (
                <span className="text-xs bg-[var(--accent-red-soft)] text-[var(--accent-red-text)] border border-red-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expired
                </span>
              )}
              {endingSoon && (
                <span className="text-xs bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)] border border-amber-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Ending Soon
                </span>
              )}
              {!incentive.active && (
                <span className="text-xs bg-[var(--border)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full">Inactive</span>
              )}
              {rep && (
                <span className="text-xs bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)] border border-amber-500/30 px-2 py-0.5 rounded-full">
                  {rep.name}
                </span>
              )}
            </div>
            <p className="text-[var(--text-secondary)] text-xs mt-0.5">{incentive.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          {/* Collapsed progress indicator */}
          {!expanded && (
            <div className="flex items-center gap-2.5">
              <div className="w-24 xl:w-36 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100
                      ? 'linear-gradient(90deg, var(--accent-emerald-solid), var(--accent-teal-solid))'
                      : 'linear-gradient(90deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
                  }}
                />
              </div>
              <span className="text-xs font-bold tabular-nums min-w-[2.5rem] xl:min-w-[3.5rem] text-right" style={{ color: pct >= 100 ? 'var(--accent-emerald-solid)' : 'var(--accent-cyan-solid)' }}>
                {Math.round(pct)}%
              </span>
              <span className="hidden xl:inline text-[10px] text-[var(--text-dim)] tabular-nums">
                {formatIncentiveMetric(incentive.metric, progress)}
              </span>
            </div>
          )}
          {isAdmin && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(incentive.id); }}
                className="text-[var(--text-dim)] hover:text-[var(--accent-emerald-text)] transition-colors p-1"
                title="Edit incentive"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate(incentive.id); }}
                className="text-[var(--text-dim)] hover:text-[var(--accent-emerald-text)] transition-colors p-1"
                title="Duplicate incentive"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(incentive.id); }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--surface-card)] hover:bg-[var(--border)] px-2.5 py-1 rounded-lg transition-colors"
              >
                {incentive.active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(incentive.id); }}
                className="text-[var(--text-dim)] hover:text-[var(--accent-red-text)] transition-colors p-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <ChevronDown
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-[300ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
        <div className="px-5 pb-5">
          {/* Progress bar — prominent */}
          <div key={expandGen} className="mb-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[var(--text-secondary)]">
                Progress: <span className="text-[var(--text-primary)] font-semibold">{formatIncentiveMetric(incentive.metric, progress)}</span>
                {' '}/ {formatIncentiveMetric(incentive.metric, maxThreshold)} {metricLabel[incentive.metric]}
              </span>
              <span className="font-bold text-base tabular-nums" style={{ color: pct >= 100 ? 'var(--accent-emerald-solid)' : 'var(--accent-cyan-solid)' }}>{Math.round(pct)}%</span>
            </div>
            <div className="relative h-3.5">
              <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full animate-progress-grow animate-progress-shimmer"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100
                      ? 'linear-gradient(90deg, var(--accent-emerald-solid), var(--accent-teal-solid))'
                      : 'linear-gradient(90deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
                    animationDelay: `${cardIndex * 120}ms`,
                  }}
                />
              </div>
              {/* Milestone tick markers (outside overflow-hidden so they render) */}
              {incentive.milestones.map((ms) => {
                const tickPct = Math.min(100, (ms.threshold / maxThreshold) * 100);
                return (
                  <div
                    key={ms.id}
                    className="absolute top-0 h-full w-0.5 rounded-full"
                    style={{
                      left: `${tickPct}%`,
                      backgroundColor: ms.achieved ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                    }}
                  />
                );
              })}
            </div>
            {/* Milestone threshold labels below bar */}
            <div className="relative h-4 mt-0.5">
              {incentive.milestones.map((ms) => {
                const tickPct = Math.min(100, (ms.threshold / maxThreshold) * 100);
                return (
                  <span
                    key={ms.id}
                    className="absolute text-[9px] font-medium tabular-nums -translate-x-1/2"
                    style={{ color: ms.achieved ? 'var(--accent-emerald-solid)' : 'var(--text-muted)', left: `${tickPct}%` }}
                  >
                    {formatIncentiveMetric(incentive.metric, ms.threshold)}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Milestones */}
          <div key={expandGen} className="space-y-2">
            {incentive.milestones.map((milestone, index) => {
              const hit = progress >= milestone.threshold;
              return (
                <div
                  key={milestone.id}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 ${milestone.achieved ? 'animate-milestone-achieve' : ''} animate-stagger-fade-slide`}
                  style={{
                    '--stagger-i': String(index),
                    border: milestone.achieved
                      ? '1px solid color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)'
                      : hit
                      ? '1px solid color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)'
                      : '1px solid rgba(39,43,53,0.5)',
                    background: milestone.achieved
                      ? 'color-mix(in srgb, var(--accent-emerald-solid) 6%, transparent)'
                      : hit
                      ? 'color-mix(in srgb, var(--accent-amber-solid) 6%, transparent)'
                      : 'rgba(29,32,40,0.3)',
                  } as React.CSSProperties}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: milestone.achieved ? 'color-mix(in srgb, var(--accent-emerald-solid) 20%, transparent)' : hit ? 'color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)' : 'color-mix(in srgb, var(--text-muted) 15%, transparent)',
                      }}
                    >
                      {milestone.achieved ? (
                        <CheckCircle className="w-4 h-4 animate-milestone-check-pop" style={{ color: 'var(--accent-emerald-text)' }} />
                      ) : (
                        <Trophy className="w-3.5 h-3.5" style={{ color: hit ? 'var(--accent-amber-solid)' : 'var(--text-muted)' }} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: milestone.achieved ? 'var(--accent-emerald-solid)' : hit ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {milestone.reward}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        At {formatIncentiveMetric(incentive.metric, milestone.threshold)}
                      </p>
                    </div>
                  </div>
                  {isAdmin && hit && (
                    <button
                      onClick={() => onMilestoneAchieved(incentive.id, milestone.id, !milestone.achieved)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        milestone.achieved
                          ? 'bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent-red-text)]'
                          : 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)] hover:bg-emerald-800/60'
                      }`}
                    >
                      {milestone.achieved ? 'Undo' : 'Mark Achieved'}
                    </button>
                  )}
                  {!isAdmin && milestone.achieved && (
                    <span className="text-[var(--accent-emerald-text)] text-xs font-semibold">Achieved</span>
                  )}
                  {!isAdmin && !milestone.achieved && hit && (
                    <span className="text-[var(--accent-emerald-text)] text-xs font-semibold">Unlocked!</span>
                  )}
                </div>
              );
            })}
          </div>

          {incentive.endDate && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
              Period: {formatDate(incentive.startDate)} — {formatDate(incentive.endDate)}
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
