'use client';

import React, { useState, useRef } from 'react';
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
  MOBILE_MONTHS,
  MOBILE_QUARTERS,
  mobileComputeDatesForPeriod,
  INCENTIVE_TEMPLATES,
} from './incentive-sheet-utils';

export default function CreateIncentiveSheet({
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
  const milestoneNextKey = useRef(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IncentiveType>('company');
  const [metric, setMetric] = useState<IncentiveMetric>('deals');
  const [period, setPeriod] = useState<IncentivePeriod>('month');
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth());
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => MOBILE_QUARTERS[Math.floor(new Date().getMonth() / 3)].value);
  const [targetRepId, setTargetRepId] = useState<string>('');
  const [milestones, setMilestones] = useState<{ _key: number; threshold: string; reward: string }[]>([{ _key: milestoneNextKey.current++, threshold: '', reward: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);

  const reset = () => {
    const _now = new Date();
    setTitle(''); setDescription(''); setType('company'); setMetric('deals'); setPeriod('month');
    setSelectedYear(_now.getFullYear()); setSelectedMonth(_now.getMonth()); setSelectedQuarter(MOBILE_QUARTERS[Math.floor(_now.getMonth() / 3)].value); setTargetRepId('');
    setMilestones([{ _key: milestoneNextKey.current++, threshold: '', reward: '' }]); setSubmitting(false);
    setAppliedTemplate(null);
  };

  const canSubmit =
    title.trim().length > 0 &&
    milestones.length > 0 &&
    milestones.every((m) => Number(m.threshold) > 0 && m.reward.trim().length > 0) &&
    (type === 'company' || !!targetRepId);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const { startDate: computedStart, endDate: computedEnd } = mobileComputeDatesForPeriod(period, selectedYear, selectedMonth, selectedQuarter);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        type,
        metric,
        period,
        startDate: computedStart,
        endDate: computedEnd || undefined,
        targetRepId: type === 'personal' ? targetRepId : undefined,
        active: true,
        milestones: milestones.map(({ threshold, reward }) => ({ threshold: Number(threshold), reward: reward.trim() })),
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
      onClose={() => { if (!submitting) { reset(); onClose(); } }}
      title="New Incentive"
    >
      <div className="px-5 space-y-3 max-h-[70vh] overflow-y-auto pb-3">
        {/* Templates */}
        <div>
          <label className={labelCls}>Quick Start</label>
          <div className="flex flex-wrap gap-1.5">
            {INCENTIVE_TEMPLATES.map((tpl) => {
              const isActive = appliedTemplate === tpl.label;
              return (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => {
                    setTitle(tpl.title);
                    setMetric(tpl.metric);
                    setPeriod(tpl.period);
                    setMilestones(tpl.milestones.map((m) => ({ _key: milestoneNextKey.current++, ...m })));
                    setAppliedTemplate(tpl.label);
                    setTimeout(() => setAppliedTemplate(null), 350);
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium active:scale-[0.91] motion-safe:transition-all motion-safe:duration-[200ms]"
                  style={{
                    background: isActive ? 'var(--accent-emerald-solid)' : 'var(--accent-emerald-soft)',
                    color: isActive ? 'var(--text-primary)' : 'var(--accent-emerald-text)',
                    border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)',
                    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {tpl.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className={labelCls}>Title</label>
          <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q2 Closer Bonus" />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description (optional)</label>
          <textarea className={inputCls} style={{ ...inputStyle, resize: 'none' }} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this incentive" />
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
            <label className={labelCls} style={{ marginBottom: 0 }}>Goals</label>
            <button
              onClick={() => setMilestones((prev) => [...prev, { _key: milestoneNextKey.current++, threshold: '', reward: '' }])}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' }}
            >
              + Add
            </button>
          </div>
          <div className="space-y-2">
            {milestones.map((ms, idx) => (
              <div key={ms._key} className="flex items-center gap-2 animate-slide-in-row motion-safe:animate-[slide-in-row_200ms_cubic-bezier(0.16,1,0.3,1)_both]">
                <input
                  className="px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] w-20 shrink-0"
                  style={inputStyle}
                  type="number"
                  min="0"
                  placeholder="Goal"
                  value={ms.threshold}
                  onChange={(e) => setMilestones((prev) => prev.map((m, i) => i === idx ? { ...m, threshold: e.target.value } : m))}
                />
                <input
                  className="px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] flex-1 min-w-0"
                  style={inputStyle}
                  placeholder="Reward (e.g. $500)"
                  value={ms.reward}
                  onChange={(e) => setMilestones((prev) => prev.map((m, i) => i === idx ? { ...m, reward: e.target.value } : m))}
                />
                {milestones.length > 1 && (
                  <button
                    onClick={() => setMilestones((prev) => prev.filter((_, i) => i !== idx))}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
                    style={{ background: 'var(--accent-red-soft)', color: 'var(--accent-red-text)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="w-full mt-2 min-h-[48px] flex items-center justify-center gap-2 text-base font-semibold rounded-xl text-[var(--text-primary)] active:scale-[0.97] transition-transform disabled:opacity-40"
          style={{ background: 'var(--accent-emerald-solid)' }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Creating…' : 'Create Incentive'}
        </button>
      </div>
    </MobileBottomSheet>
  );
}
