'use client';

import { useMemo } from 'react';
import { useApp } from '../../../lib/context';
import {
  computeIncentiveProgress,
  formatIncentiveMetric,
  Incentive,
  IncentiveMetric,
} from '../../../lib/data';
import { Trophy, Plus, Gift, Target } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';

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

function isExpired(endDate: string | null): boolean {
  if (!endDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = endDate.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  return end < today;
}

function metricLabel(metric: IncentiveMetric): string {
  if (metric === 'deals') return 'Deals';
  if (metric === 'kw') return 'kW Sold';
  if (metric === 'commission') return 'Commission';
  if (metric === 'revenue') return 'Revenue';
  return metric;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MobileIncentives() {
  const {
    currentRole,
    effectiveRole,
    currentRepId,
    incentives,
    projects,
    payrollEntries,
    reps,
  } = useApp();

  const isAdmin = currentRole === 'admin';

  // PM guard
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Incentives" />
        <MobileEmptyState
          icon={Trophy}
          title="Access Denied"
          subtitle="You don't have permission to view this page."
        />
      </div>
    );
  }

  // Visible incentives: admin sees all, rep sees active company + their personal
  const visible = isAdmin
    ? incentives
    : incentives.filter(
        (inc) => inc.active && (inc.type === 'company' || inc.targetRepId === currentRepId)
      );

  const activeIncentives = visible.filter((i) => !isExpired(i.endDate) && i.active);
  const expiredIncentives = visible.filter((i) => isExpired(i.endDate));

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Incentives" />

      {/* Active Incentives */}
      <MobileSection title="Active Incentives" count={activeIncentives.length}>
        {activeIncentives.length === 0 ? (
          <MobileEmptyState
            icon={Trophy}
            title="No active incentives"
            subtitle="Check back later for new challenges."
          />
        ) : (
          <div className="space-y-3">
            {activeIncentives.map((inc) => (
              <IncentiveCard key={inc.id} incentive={inc} projects={projects} payrollEntries={payrollEntries} reps={reps} />
            ))}
          </div>
        )}
      </MobileSection>

      {/* Expired / Past Incentives */}
      {expiredIncentives.length > 0 && (
        <MobileSection title="Past Incentives" count={expiredIncentives.length} collapsible defaultOpen={false}>
          <div className="space-y-3">
            {expiredIncentives.map((inc) => (
              <IncentiveCard key={inc.id} incentive={inc} projects={projects} payrollEntries={payrollEntries} reps={reps} expired />
            ))}
          </div>
        </MobileSection>
      )}
    </div>
  );
}

// ─── Incentive Card ─────────────────────────────────────────────────────────

function IncentiveCard({
  incentive,
  projects,
  payrollEntries,
  reps,
  expired,
}: {
  incentive: Incentive;
  projects: any[];
  payrollEntries: any[];
  reps: any[];
  expired?: boolean;
}) {
  const progress = useMemo(
    () => computeIncentiveProgress(incentive, projects, payrollEntries),
    [incentive, projects, payrollEntries],
  );

  const maxThreshold = incentive.milestones.length > 0
    ? incentive.milestones[incentive.milestones.length - 1].threshold
    : 1;
  const pct = Math.min((progress / maxThreshold) * 100, 100);

  const targetRepName = incentive.targetRepId
    ? reps.find((r: any) => r.id === incentive.targetRepId)?.name ?? 'Unknown Rep'
    : null;

  const typeBadgeStyle: React.CSSProperties = incentive.type === 'company'
    ? { background: 'rgba(0,180,216,0.15)', color: 'var(--m-accent2, #00b4d8)' }
    : { background: 'rgba(0,229,160,0.15)', color: 'var(--m-accent, #00e5a0)' };

  const barFill = expired
    ? 'var(--m-text-dim, #445577)'
    : pct >= 100
      ? 'var(--m-accent, #00e5a0)'
      : 'var(--m-accent2, #00b4d8)';

  return (
    <MobileCard className={expired ? 'opacity-60' : ''}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-base font-semibold text-white leading-snug" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{incentive.title}</p>
        <span
          className="inline-flex items-center px-2.5 py-0.5 text-base font-semibold rounded-lg shrink-0"
          style={typeBadgeStyle}
        >
          {incentive.type === 'company' ? 'Company' : 'Personal'}
        </span>
      </div>

      {/* Target rep for personal incentives */}
      {targetRepName && (
        <p className="text-base mb-1" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{targetRepName}</p>
      )}

      {/* Metric + Period */}
      <p className="text-base mb-3" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        {metricLabel(incentive.metric)} &middot; {getPeriodLabel(incentive)}
      </p>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-base font-medium text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
            {formatIncentiveMetric(incentive.metric, progress)}
          </p>
          <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            / {formatIncentiveMetric(incentive.metric, maxThreshold)}
          </p>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--m-border, #1a2840)' }}>
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
                        : 'var(--m-border, #1a2840)',
                  }}
                >
                  {ms.achieved ? (
                    <Gift className="w-3 h-3" style={{ color: 'var(--m-accent, #00e5a0)' }} />
                  ) : reached ? (
                    <Target className="w-3 h-3" style={{ color: 'var(--m-warning, #f5a623)' }} />
                  ) : (
                    <Target className="w-3 h-3" style={{ color: 'var(--m-text-muted, #8899aa)' }} />
                  )}
                </div>
                <p
                  className={`text-base flex-1 ${ms.achieved ? 'line-through' : ''}`}
                  style={{
                    color: ms.achieved
                      ? 'var(--m-accent, #00e5a0)'
                      : reached
                        ? 'var(--m-warning, #f5a623)'
                        : 'var(--m-text-muted, #8899aa)',
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
    </MobileCard>
  );
}
