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

  const typeBadgeColor = incentive.type === 'company'
    ? 'bg-blue-900/30 text-blue-300'
    : 'bg-purple-900/30 text-purple-300';

  const barFill = expired
    ? 'bg-slate-600'
    : pct >= 100
      ? 'bg-emerald-500'
      : 'bg-blue-500';

  return (
    <MobileCard className={expired ? 'opacity-60' : ''}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-base font-semibold text-white leading-snug">{incentive.title}</p>
        <span className={`inline-flex items-center px-2.5 py-0.5 text-sm font-semibold rounded-lg shrink-0 ${typeBadgeColor}`}>
          {incentive.type === 'company' ? 'Company' : 'Personal'}
        </span>
      </div>

      {/* Target rep for personal incentives */}
      {targetRepName && (
        <p className="text-sm text-slate-500 mb-1">{targetRepName}</p>
      )}

      {/* Metric + Period */}
      <p className="text-sm text-slate-500 mb-3">
        {metricLabel(incentive.metric)} &middot; {getPeriodLabel(incentive)}
      </p>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-sm font-medium text-white">
            {formatIncentiveMetric(incentive.metric, progress)}
          </p>
          <p className="text-base text-slate-400">
            / {formatIncentiveMetric(incentive.metric, maxThreshold)}
          </p>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barFill}`}
            style={{ width: `${pct}%` }}
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
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                  ms.achieved
                    ? 'bg-emerald-500/20'
                    : reached
                      ? 'bg-amber-500/20'
                      : 'bg-slate-800'
                }`}>
                  {ms.achieved ? (
                    <Gift className="w-3 h-3 text-emerald-400" />
                  ) : reached ? (
                    <Target className="w-3 h-3 text-amber-400" />
                  ) : (
                    <Target className="w-3 h-3 text-slate-500" />
                  )}
                </div>
                <p className={`text-sm flex-1 ${ms.achieved ? 'text-emerald-400 line-through' : reached ? 'text-amber-300' : 'text-slate-500'}`}>
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
