'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../../../lib/context';
import {
  computeIncentiveProgress,
  formatIncentiveMetric,
  Incentive,
  IncentiveMetric,
  IncentivePeriod,
  IncentiveType,
  Project,
  PayrollEntry,
  Rep,
} from '../../../lib/data';
import { useToast } from '../../../lib/toast';
import { Trophy, Plus, Gift, Target, Loader2, Zap } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

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

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MobileIncentives() {
  const {
    currentRole,
    effectiveRole,
    currentRepId,
    incentives,
    setIncentives,
    projects,
    payrollEntries,
    reps,
  } = useApp();
  const { toast } = useToast();

  const isAdmin = currentRole === 'admin';
  const [showCreate, setShowCreate] = useState(false);

  // Pending Rewards — admin-only. Milestones where progress crossed the
  // threshold but admin hasn't yet flipped achieved=true. Parity with
  // the desktop incentives page.
  //
  // Hook order rule: this useMemo must run on EVERY render, including
  // when the PM guard below returns early. Placing it above the early
  // return keeps the hook ordering stable — React counts hook calls by
  // position, and a conditional hook triggers "called conditionally"
  // rules-of-hooks violations.
  const pendingRewards = useMemo(() => {
    if (!isAdmin) return [] as { incentive: Incentive; milestone: Incentive['milestones'][number]; progress: number }[];
    const items: { incentive: Incentive; milestone: Incentive['milestones'][number]; progress: number }[] = [];
    for (const inc of incentives) {
      if (!inc.active || isExpired(inc.endDate)) continue;
      const progress = computeIncentiveProgress(inc, projects, payrollEntries);
      for (const ms of inc.milestones) {
        if (progress >= ms.threshold && !ms.achieved) {
          items.push({ incentive: inc, milestone: ms, progress });
        }
      }
    }
    return items;
  }, [isAdmin, incentives, projects, payrollEntries]);

  // PM guard — rendered AFTER hooks so hook ordering stays stable.
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

  const markMilestoneFulfilled = (incId: string, milestoneId: string) => {
    // Optimistic — matches the desktop page handler pattern. Sets achieved
    // locally, then PATCHes the incentive with the updated milestones list.
    const target = incentives.find((i) => i.id === incId);
    if (!target) return;
    const prev = target.milestones;
    const next = target.milestones.map((m) => m.id === milestoneId ? { ...m, achieved: true } : m);
    setIncentives((list) => list.map((i) => i.id === incId ? { ...i, milestones: next } : i));
    fetch(`/api/incentives/${incId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: target.title,
        description: target.description,
        active: target.active,
        endDate: target.endDate,
        metric: target.metric,
        period: target.period,
        startDate: target.startDate,
        type: target.type,
        targetRepId: target.targetRepId,
        milestones: next.map((m) => ({ ...(m.id ? { id: m.id } : {}), threshold: m.threshold, reward: m.reward, achieved: m.achieved })),
      }),
    })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reward marked fulfilled', 'success'); })
      .catch(() => { setIncentives((list) => list.map((i) => i.id === incId ? { ...i, milestones: prev } : i)); toast('Failed to update', 'error'); });
  };

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader
        title="Incentives"
        right={isAdmin ? (
          <button
            onClick={() => setShowCreate(true)}
            aria-label="Add incentive"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-[0.92] transition-transform"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 4px 14px rgba(0,229,160,0.3)',
            }}
          >
            <Plus className="w-5 h-5 text-white" />
          </button>
        ) : undefined}
      />

      {/* Pending Rewards (admin only) — milestones whose progress crossed
          the threshold but haven't been marked achieved yet. One-tap
          "Mark Fulfilled" matches the desktop page. */}
      {isAdmin && pendingRewards.length > 0 && (
        <MobileSection title="Pending Rewards" count={pendingRewards.length} collapsible defaultOpen>
          <div className="space-y-2">
            {pendingRewards.map(({ incentive, milestone }) => (
              <div
                key={`${incentive.id}-${milestone.id}`}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.22)',
                }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,158,11,0.2)' }}>
                      <Zap className="w-4 h-4" style={{ color: 'var(--accent-amber)' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{incentive.title}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                        At {formatIncentiveMetric(incentive.metric, milestone.threshold)}
                        <span style={{ color: 'var(--accent-amber)' }}> · {milestone.reward}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => markMilestoneFulfilled(incentive.id, milestone.id)}
                  className="w-full min-h-[40px] rounded-lg text-xs font-semibold"
                  style={{
                    background: 'rgba(0,229,160,0.15)',
                    color: 'var(--accent-emerald)',
                  }}
                >
                  Mark Fulfilled
                </button>
              </div>
            ))}
          </div>
        </MobileSection>
      )}

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

      {/* Admin: create-incentive bottom sheet */}
      {isAdmin && (
        <CreateIncentiveSheet
          open={showCreate}
          onClose={() => setShowCreate(false)}
          reps={reps}
          onCreated={(created) => {
            setIncentives((prev) => [...prev, created]);
            toast('Incentive created', 'success');
            setShowCreate(false);
          }}
          onError={(msg) => toast(msg, 'error')}
        />
      )}
    </div>
  );
}

// ─── Create-Incentive Bottom Sheet ──────────────────────────────────────────

function CreateIncentiveSheet({
  open,
  onClose,
  reps,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  reps: { id: string; name: string; active?: boolean }[];
  onCreated: (incentive: Incentive) => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<IncentiveType>('company');
  const [metric, setMetric] = useState<IncentiveMetric>('deals');
  const [period, setPeriod] = useState<IncentivePeriod>('month');
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [endDate, setEndDate] = useState<string>('');
  const [targetRepId, setTargetRepId] = useState<string>('');
  const [threshold, setThreshold] = useState<string>('');
  const [reward, setReward] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(''); setType('company'); setMetric('deals'); setPeriod('month');
    setStartDate(todayISO()); setEndDate(''); setTargetRepId('');
    setThreshold(''); setReward(''); setSubmitting(false);
  };

  const canSubmit =
    title.trim().length > 0 &&
    threshold.trim().length > 0 &&
    Number(threshold) > 0 &&
    reward.trim().length > 0 &&
    (type === 'company' || !!targetRepId);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: '',
        type,
        metric,
        period,
        startDate: period === 'alltime' ? todayISO() : startDate,
        endDate: endDate || undefined,
        targetRepId: type === 'personal' ? targetRepId : undefined,
        active: true,
        milestones: [{ threshold: Number(threshold), reward: reward.trim() }],
      };
      const res = await fetch('/api/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) {
            detail = body.error;
            if (Array.isArray(body.issues) && body.issues.length > 0) {
              detail += ' · ' + body.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join(', ');
            }
          }
        } catch { /* keep status */ }
        throw new Error(detail);
      }
      const created: Incentive = await res.json();
      onCreated(created);
      reset();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create incentive');
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald)]';
  const inputStyle: React.CSSProperties = {
    background: 'var(--m-surface, var(--surface))',
    border: '1px solid var(--m-border, var(--border-mobile))',
    color: '#fff',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };
  const labelCls = 'block text-xs font-medium uppercase tracking-wider mb-1.5 text-[var(--m-text-muted,var(--text-mobile-muted))]';

  return (
    <MobileBottomSheet
      open={open}
      onClose={() => { if (!submitting) { reset(); onClose(); } }}
      title="New Incentive"
    >
      <div className="px-5 space-y-3 max-h-[70vh] overflow-y-auto pb-3">
        {/* Title */}
        <div>
          <label className={labelCls}>Title</label>
          <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q2 Closer Bonus" />
        </div>

        {/* Type */}
        <div>
          <label className={labelCls}>Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(['company', 'personal'] as IncentiveType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`py-2.5 rounded-lg text-sm transition-colors ${type === t ? 'filter-tab-active' : ''}`}
                style={type !== t ? inputStyle : undefined}
              >
                {t === 'company' ? 'Company-wide' : 'Personal'}
              </button>
            ))}
          </div>
        </div>

        {/* Target rep (only for personal) */}
        {type === 'personal' && (
          <div>
            <label className={labelCls}>Target Rep</label>
            <select className={inputCls} style={inputStyle} value={targetRepId} onChange={(e) => setTargetRepId(e.target.value)}>
              <option value="">— Select rep —</option>
              {reps.filter((r) => r.active !== false).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Metric */}
        <div>
          <label className={labelCls}>Metric</label>
          <select className={inputCls} style={inputStyle} value={metric} onChange={(e) => setMetric(e.target.value as IncentiveMetric)}>
            <option value="deals">Deals</option>
            <option value="kw">kW Sold</option>
            <option value="commission">Commission ($)</option>
            <option value="revenue">Revenue ($)</option>
          </select>
        </div>

        {/* Period */}
        <div>
          <label className={labelCls}>Period</label>
          <select className={inputCls} style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value as IncentivePeriod)}>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="year">Yearly</option>
            <option value="alltime">All Time</option>
          </select>
        </div>

        {/* Dates (hide start when alltime) */}
        {period !== 'alltime' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Start</label>
              <input type="date" className={inputCls} style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End (optional)</label>
              <input type="date" className={inputCls} style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        )}

        {/* Single milestone (multi-milestone editing happens on desktop) */}
        <div>
          <label className={labelCls}>Goal</label>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <input className={inputCls} style={inputStyle} type="number" min="0" placeholder="10" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <input className={inputCls} style={inputStyle} placeholder="Reward (e.g. $500)" value={reward} onChange={(e) => setReward(e.target.value)} />
          </div>
          <p className="text-[11px] text-[var(--m-text-dim,#445577)] mt-1">Need multiple goal tiers? Add them on the desktop view after creating.</p>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="w-full mt-2 min-h-[48px] flex items-center justify-center gap-2 text-base font-semibold rounded-xl text-white active:scale-[0.97] transition-transform disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))' }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Creating…' : 'Create Incentive'}
        </button>
      </div>
    </MobileBottomSheet>
  );
}

// ─── Incentive Card (unchanged) ─────────────────────────────────────────────

function IncentiveCard({
  incentive,
  projects,
  payrollEntries,
  reps,
  expired,
}: {
  incentive: Incentive;
  projects: Project[];
  payrollEntries: PayrollEntry[];
  reps: Rep[];
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
    </MobileCard>
  );
}
