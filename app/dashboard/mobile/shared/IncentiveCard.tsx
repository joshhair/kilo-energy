'use client';

import { useMemo } from 'react';
import {
  computeIncentiveProgress,
  formatIncentiveMetric,
  Incentive,
  IncentiveMetric,
  Project,
  PayrollEntry,
  Rep,
} from '../../../../lib/data';
import { CheckSquare, Gift, Target, Pencil, Copy, Trash2 } from 'lucide-react';
import MobileCard from './MobileCard';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const QUARTERS = [
  { value: 'Q1', startMonth: 0 },
  { value: 'Q2', startMonth: 3 },
  { value: 'Q3', startMonth: 6 },
  { value: 'Q4', startMonth: 9 },
];

function getPeriodLabel(inc: Incentive): string {
  const { period, startDate } = inc;
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

function metricLabel(metric: IncentiveMetric): string {
  if (metric === 'deals') return 'Deals';
  if (metric === 'kw') return 'kW Sold';
  if (metric === 'commission') return 'Commission';
  if (metric === 'revenue') return 'Revenue';
  return metric;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function IncentiveCard({
  incentive,
  projects,
  payrollEntries,
  reps,
  expired,
  isAdmin,
  onEdit,
  onDuplicate,
  onToggleActive,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
}: {
  incentive: Incentive;
  projects: Project[];
  payrollEntries: PayrollEntry[];
  reps: Rep[];
  expired?: boolean;
  isAdmin?: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onToggleActive?: () => void;
  onDelete?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const progress = useMemo(
    () => computeIncentiveProgress(incentive, projects, payrollEntries),
    [incentive, projects, payrollEntries],
  );

  const maxThreshold = incentive.milestones.length > 0
    ? Math.max(...incentive.milestones.map((m) => m.threshold))
    : 1;
  const pct = Math.min((progress / maxThreshold) * 100, 100);

  const targetRepName = incentive.targetRepId
    ? reps.find((r) => r.id === incentive.targetRepId)?.name ?? 'Unknown Rep'
    : null;

  const typeBadgeStyle: React.CSSProperties = incentive.type === 'company'
    ? { background: 'var(--accent-cyan-soft)', color: 'var(--accent-cyan-text)' }
    : { background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' };

  const barFill = expired
    ? 'var(--text-dim)'
    : pct >= 100
      ? 'var(--accent-emerald-solid)'
      : 'var(--accent-cyan-solid)';

  return (
    <MobileCard className={expired ? 'opacity-60' : ''} onTap={selectMode ? () => onToggleSelect?.(incentive.id) : undefined}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className={`rounded flex items-center justify-center overflow-hidden ${
              selectMode ? 'w-5 h-5 opacity-100 mr-0' : 'w-0 h-5 opacity-0 -mr-2'
            }`}
            style={{
              border: selectMode ? '1.5px solid var(--border-subtle)' : '1.5px solid transparent',
              background: selected ? 'var(--accent-cyan-solid)' : 'transparent',
              transition: 'width 200ms ease-out, opacity 200ms ease-out, margin-right 200ms ease-out, background 150ms ease',
            }}
          >
            {selected && <CheckSquare className="w-3.5 h-3.5" style={{ color: 'var(--text-on-accent)' }} />}
          </div>
          <p className="text-base font-semibold leading-snug truncate" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{incentive.title}</p>
        </div>
        <span
          className="inline-flex items-center px-2.5 py-0.5 text-base font-semibold rounded-lg shrink-0"
          style={typeBadgeStyle}
        >
          {incentive.type === 'company' ? 'Company' : 'Personal'}
        </span>
      </div>

      {/* Target rep for personal incentives */}
      {targetRepName && (
        <p className="text-base mb-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{targetRepName}</p>
      )}

      {/* Metric + Period */}
      <p className="text-base mb-3" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        {metricLabel(incentive.metric)} &middot; {getPeriodLabel(incentive)}
      </p>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-base font-medium" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
            {formatIncentiveMetric(incentive.metric, progress)}
          </p>
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            / {formatIncentiveMetric(incentive.metric, maxThreshold)}
          </p>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: barFill }}
          />
        </div>
      </div>

      {/* Milestones */}
      {incentive.milestones.length > 0 && (
        <div className="space-y-1.5">
          {incentive.milestones.map((ms) => {
            const reached = progress >= ms.threshold;
            return (
              <div key={ms.id} className="flex items-center gap-2 min-h-[28px]">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: ms.achieved
                      ? 'var(--accent-emerald-glow)'
                      : reached
                        ? 'var(--accent-amber-glow)'
                        : 'var(--border-subtle)',
                  }}
                >
                  {ms.achieved ? (
                    <Gift className="w-3 h-3" style={{ color: 'var(--accent-emerald-text)' }} />
                  ) : reached ? (
                    <Target className="w-3 h-3" style={{ color: 'var(--accent-amber-text)' }} />
                  ) : (
                    <Target className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <p
                  className={`text-base flex-1 ${ms.achieved ? 'line-through' : ''}`}
                  style={{
                    color: ms.achieved
                      ? 'var(--accent-emerald-solid)'
                      : reached
                        ? 'var(--accent-amber-solid)'
                        : 'var(--text-muted)',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {formatIncentiveMetric(incentive.metric, ms.threshold)} &rarr; {ms.reward}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={onEdit}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            style={{ background: 'var(--accent-cyan-soft)', color: 'var(--accent-cyan-text)' }}
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            onClick={onDuplicate}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            style={{ background: 'var(--accent-purple-soft)', color: 'var(--accent-purple-text)' }}
          >
            <Copy className="w-3.5 h-3.5" /> Duplicate
          </button>
          <button
            onClick={onToggleActive}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            style={incentive.active
              ? { background: 'var(--accent-amber-soft)', color: 'var(--accent-amber-text)' }
              : { background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' }}
          >
            {incentive.active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={onDelete}
            className="w-9 min-h-[36px] rounded-lg flex items-center justify-center shrink-0 active:scale-[0.97] transition-transform"
            style={{ background: 'var(--accent-red-soft)', color: 'var(--accent-red-text)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </MobileCard>
  );
}
