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
    ? { background: 'rgba(0,180,216,0.15)', color: 'var(--m-accent2, var(--accent-cyan2))' }
    : { background: 'rgba(0,229,160,0.15)', color: 'var(--m-accent, var(--accent-emerald))' };

  const barFill = expired
    ? 'var(--m-text-dim, #445577)'
    : pct >= 100
      ? 'var(--m-accent, var(--accent-emerald))'
      : 'var(--m-accent2, var(--accent-cyan2))';

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
              border: selectMode ? '1.5px solid var(--m-border, var(--border-mobile))' : '1.5px solid transparent',
              background: selected ? 'var(--accent-cyan2)' : 'transparent',
              transition: 'width 200ms ease-out, opacity 200ms ease-out, margin-right 200ms ease-out, background 150ms ease',
            }}
          >
            {selected && <CheckSquare className="w-3.5 h-3.5 text-white" />}
          </div>
          <p className="text-base font-semibold text-white leading-snug truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{incentive.title}</p>
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
        <p className="text-base mb-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{targetRepName}</p>
      )}

      {/* Metric + Period */}
      <p className="text-base mb-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        {metricLabel(incentive.metric)} &middot; {getPeriodLabel(incentive)}
      </p>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-base font-medium text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
            {formatIncentiveMetric(incentive.metric, progress)}
          </p>
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            / {formatIncentiveMetric(incentive.metric, maxThreshold)}
          </p>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--m-border, var(--border-mobile))' }}>
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
                      ? 'rgba(0,229,160,0.2)'
                      : reached
                        ? 'rgba(245,166,35,0.2)'
                        : 'var(--m-border, var(--border-mobile))',
                  }}
                >
                  {ms.achieved ? (
                    <Gift className="w-3 h-3" style={{ color: 'var(--m-accent, var(--accent-emerald))' }} />
                  ) : reached ? (
                    <Target className="w-3 h-3" style={{ color: 'var(--m-warning, #f5a623)' }} />
                  ) : (
                    <Target className="w-3 h-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
                  )}
                </div>
                <p
                  className={`text-base flex-1 ${ms.achieved ? 'line-through' : ''}`}
                  style={{
                    color: ms.achieved
                      ? 'var(--m-accent, var(--accent-emerald))'
                      : reached
                        ? 'var(--m-warning, #f5a623)'
                        : 'var(--m-text-muted, var(--text-mobile-muted))',
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
        <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
          <button
            onClick={onEdit}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            style={{ background: 'rgba(0,180,216,0.12)', color: 'var(--accent-cyan2)' }}
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            onClick={onDuplicate}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            style={{ background: 'rgba(160,108,246,0.12)', color: '#a06cf6' }}
          >
            <Copy className="w-3.5 h-3.5" /> Duplicate
          </button>
          <button
            onClick={onToggleActive}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            style={incentive.active
              ? { background: 'rgba(245,158,11,0.12)', color: 'var(--accent-amber, #f5a623)' }
              : { background: 'rgba(0,229,160,0.12)', color: 'var(--accent-emerald)' }}
          >
            {incentive.active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={onDelete}
            className="w-9 min-h-[36px] rounded-lg flex items-center justify-center shrink-0 active:scale-[0.97] transition-transform"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </MobileCard>
  );
}
