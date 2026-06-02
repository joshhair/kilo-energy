'use client';

import React, { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import MobileBottomSheet from './MobileBottomSheet';
import { SegmentedPills } from '../../../../components/ui';
import {
  Incentive,
  IncentiveType,
  IncentiveMetric,
  IncentivePeriod,
} from '../../../../lib/data';
import {
  todayISO,
  MOBILE_MONTHS,
  MOBILE_QUARTERS,
  mobileComputeDatesForPeriod,
} from './incentive-sheet-utils';

export default function EditIncentiveSheet({
  open,
  incentive,
  onClose,
  reps,
  onSaved,
  onError,
}: {
  open: boolean;
  incentive: Incentive;
  onClose: () => void;
  reps: { id: string; name: string; active?: boolean }[];
  onSaved: (updated: Incentive) => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(incentive.title);
  const [description, setDescription] = useState(incentive.description);
  const [type, setType] = useState<IncentiveType>(incentive.type);
  const [metric, setMetric] = useState<IncentiveMetric>(incentive.metric);
  const [period, setPeriod] = useState<IncentivePeriod>(incentive.period);
  const [selectedYear, setSelectedYear] = useState<number>(() => incentive.startDate ? parseInt(incentive.startDate.split('-')[0]) : new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => incentive.startDate ? parseInt(incentive.startDate.split('-')[1]) - 1 : new Date().getMonth());
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => {
    const m = incentive.startDate ? parseInt(incentive.startDate.split('-')[1]) - 1 : new Date().getMonth();
    return MOBILE_QUARTERS[Math.floor(m / 3)].value;
  });
  const [targetRepId, setTargetRepId] = useState<string>(incentive.targetRepId ?? '');
  const [milestones, setMilestones] = useState<{ id?: string; threshold: string; reward: string; achieved: boolean }[]>(
    incentive.milestones.map((m) => ({ id: m.id, threshold: String(m.threshold), reward: m.reward, achieved: m.achieved }))
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    title.trim().length > 0 &&
    milestones.length > 0 &&
    milestones.every((m) => Number(m.threshold) > 0 && m.reward.trim().length > 0) &&
    (type === 'company' || !!targetRepId);

  const handleSave = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const { startDate: computedStart, endDate: computedEnd } = mobileComputeDatesForPeriod(period, selectedYear, selectedMonth, selectedQuarter);
      const updated: Incentive = {
        ...incentive,
        title: title.trim(),
        description: description.trim(),
        type,
        metric,
        period,
        startDate: period === 'alltime' ? (incentive.startDate ?? todayISO()) : computedStart,
        endDate: computedEnd,
        targetRepId: type === 'personal' ? targetRepId : null,
        milestones: milestones.map((m) => ({
          id: m.id ?? '',
          threshold: Number(m.threshold),
          reward: m.reward.trim(),
          achieved: m.achieved,
        })),
      };
      await onSaved(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save incentive');
    } finally {
      setSubmitting(false);
    }
  };

  const addMilestone = () => setMilestones((prev) => [...prev, { threshold: '', reward: '', achieved: false }]);
  const removeMilestone = (idx: number) => setMilestones((prev) => prev.filter((_, i) => i !== idx));
  const updateMilestone = (idx: number, field: 'threshold' | 'reward', val: string) =>
    setMilestones((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));

  const inputCls = 'w-full px-3 py-2.5 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]';
  const inputStyle: React.CSSProperties = {
    background: 'var(--m-surface, var(--surface))',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };
  const labelCls = 'block text-xs font-medium uppercase tracking-wider mb-1.5 text-[var(--text-muted)]';

  return (
    <MobileBottomSheet
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      title="Edit Incentive"
    >
      <div className="px-5 space-y-3 max-h-[70vh] overflow-y-auto pb-3">
        {/* Title */}
        <div>
          <label className={labelCls}>Title</label>
          <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea
            rows={2}
            placeholder="Brief description of the goal..."
            className={`${inputCls} resize-none`}
            style={inputStyle}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Type */}
        <div>
          <label className={labelCls}>Type</label>
          <SegmentedPills<IncentiveType>
            options={[
              { value: 'company', label: 'Company-wide' },
              { value: 'personal', label: 'Personal' },
            ]}
            value={type}
            onChange={setType}
            size="sm"
            ariaLabel="Incentive type"
          />
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

        {/* Period-based date selectors */}
        {period !== 'alltime' && (
          period === 'month' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Month</label>
                <select className={inputCls} style={inputStyle} value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
                  {MOBILE_MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Year</label>
                <select className={inputCls} style={inputStyle} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          ) : period === 'quarter' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Quarter</label>
                <select className={inputCls} style={inputStyle} value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)}>
                  {MOBILE_QUARTERS.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Year</label>
                <select className={inputCls} style={inputStyle} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className={labelCls}>Year</label>
              <select className={inputCls} style={inputStyle} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )
        )}

        {/* Milestones */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={labelCls} style={{ marginBottom: 0 }}>Milestones</label>
            <button
              onClick={addMilestone}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' }}
            >
              + Add
            </button>
          </div>
          <div className="space-y-2">
            {milestones.map((ms, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  className="px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] w-20 shrink-0"
                  style={inputStyle}
                  type="number"
                  min="0"
                  placeholder="Goal"
                  value={ms.threshold}
                  onChange={(e) => updateMilestone(idx, 'threshold', e.target.value)}
                />
                <input
                  className="px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] flex-1 min-w-0"
                  style={inputStyle}
                  placeholder="Reward"
                  value={ms.reward}
                  onChange={(e) => updateMilestone(idx, 'reward', e.target.value)}
                />
                {milestones.length > 1 && (
                  <button onClick={() => removeMilestone(idx)} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: 'var(--accent-red-soft)', color: 'var(--accent-red-text)' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!canSubmit || submitting}
          className="w-full mt-2 min-h-[48px] flex items-center justify-center gap-2 text-base font-semibold rounded-xl text-[var(--text-primary)] active:scale-[0.97] transition-transform disabled:opacity-40"
          style={{ background: 'var(--accent-emerald-solid)' }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </MobileBottomSheet>
  );
}
