'use client';

import { useRef, useState } from 'react';
import { todayLocalDateStr } from '../../../../lib/utils';

export const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export interface MonthlyBarDatum {
  key: string;        // "YYYY-MM"
  label: string;      // "Jan", "Feb", …
  paid: number;
  pending: number;
  reimbursement: number;
}

export function computeMonthlyBarData(
  payrollEntries: { date: string; amount: number; status: string; repId: string }[],
  reimbursements: { date: string; amount: number; status: string; repId: string }[],
  repId: string | null,
): MonthlyBarDatum[] {
  const today = todayLocalDateStr();
  const currentMonthKey = today.slice(0, 7);
  const map = new Map<string, MonthlyBarDatum>();

  for (const e of payrollEntries) {
    if (e.repId !== repId) continue;
    if (e.status === 'Draft') continue;
    if (e.status !== 'Pending' && e.date > today) continue;
    const key = e.date.slice(0, 7);
    if (!map.has(key)) {
      const monthIdx = parseInt(key.slice(5, 7), 10) - 1;
      map.set(key, { key, label: MONTH_LABELS[monthIdx], paid: 0, pending: 0, reimbursement: 0 });
    }
    const d = map.get(key)!;
    if (e.status === 'Paid') d.paid += e.amount;
    else if (e.status === 'Pending') d.pending += e.amount;
  }

  for (const r of reimbursements) {
    if (r.repId !== repId) continue;
    if (r.status !== 'Approved') continue;
    if (r.date > today) continue;
    const key = r.date.slice(0, 7);
    if (!map.has(key)) {
      const monthIdx = parseInt(key.slice(5, 7), 10) - 1;
      map.set(key, { key, label: MONTH_LABELS[monthIdx], paid: 0, pending: 0, reimbursement: 0 });
    }
    map.get(key)!.reimbursement += r.amount;
  }

  const sorted = [...map.entries()]
    .filter(([key]) => key <= currentMonthKey)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.slice(-6).map(([, v]) => v);
}

export function MonthlyEarningsBarChart({
  data,
  onMonthClick,
  selectedMonth,
}: {
  data: MonthlyBarDatum[];
  onMonthClick?: (monthKey: string) => void;
  selectedMonth?: string | null;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; datum: MonthlyBarDatum } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map((d) => Math.max(d.paid, d.pending, d.reimbursement)), 1);
  const chartH = 180;
  const barAreaTop = 20;

  const hasReimb = data.some((d) => d.reimbursement > 0);
  const barsPerGroup = hasReimb ? 3 : 2;

  return (
    <div className="card-surface rounded-2xl p-5 mb-8 animate-slide-in-scale">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="h-[2px] w-10 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-2" />
          <h3 className="text-[var(--text-primary)] font-bold text-sm tracking-wide">Monthly Earnings</h3>
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" />Paid</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" />Pending</span>
          {hasReimb && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" />Reimb.</span>}
        </div>
      </div>

      <div className="relative w-full" style={{ minHeight: chartH + 36 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 600 ${chartH + 36}`}
          preserveAspectRatio="none"
          className="w-full h-auto"
          onMouseLeave={() => setTooltip(null)}
        >
          {[0.25, 0.5, 0.75, 1].map((frac) => {
            const y = barAreaTop + (chartH - (chartH * frac));
            return <line key={frac} x1={0} x2={600} y1={y} y2={y} stroke="rgba(148,163,184,0.08)" strokeWidth={1} />;
          })}

          {data.map((d, i) => {
            const groupW = 600 / data.length;
            const groupX = i * groupW;
            const gap = 4;
            const totalGap = (barsPerGroup - 1) * gap;
            const barW = Math.min((groupW * 0.6 - totalGap) / barsPerGroup, 40);
            const groupBarW = barsPerGroup * barW + totalGap;
            const startX = groupX + (groupW - groupBarW) / 2;

            const bars = [
              { value: d.paid, color: 'var(--accent-emerald-text)', hoverColor: 'var(--accent-cyan-solid)' },
              { value: d.pending, color: '#eab308', hoverColor: '#facc15' },
              ...(hasReimb ? [{ value: d.reimbursement, color: '#8b5cf6', hoverColor: '#a78bfa' }] : []),
            ];

            return (
              <g
                key={d.key}
                className="cursor-pointer transition-opacity duration-150"
                style={{ opacity: selectedMonth && selectedMonth !== d.key ? 0.4 : 1 }}
                onClick={() => onMonthClick?.(d.key)}
                onMouseEnter={() => {
                  const svg = svgRef.current;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  const svgX = groupX + groupW / 2;
                  const pxX = (svgX / 600) * rect.width;
                  setTooltip({ x: pxX, y: 0, datum: d });
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                <rect x={groupX} y={0} width={groupW} height={chartH + 36} fill="transparent" />

                {bars.map((bar, bi) => {
                  const bh = (bar.value / maxVal) * (chartH - barAreaTop);
                  const bx = startX + bi * (barW + gap);
                  const by = barAreaTop + (chartH - barAreaTop) - bh;
                  return (
                    <rect
                      key={bi}
                      x={bx}
                      y={by}
                      width={barW}
                      height={Math.max(bh, 0)}
                      rx={3}
                      fill={bar.color}
                      className="bar-enter transition-all duration-150 hover:brightness-125"
                      style={{ animationDelay: `${(i * barsPerGroup + bi) * 55}ms` }}
                    />
                  );
                })}

                <text
                  x={groupX + groupW / 2}
                  y={chartH + 28}
                  textAnchor="middle"
                  className="fill-slate-500 text-[11px] font-medium"
                  style={{ fontSize: 11 }}
                >
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>

        {tooltip && (
          <div
            className="absolute z-20 pointer-events-none bg-[var(--surface-card)] border border-[var(--border)] rounded-xl px-3 py-2 shadow-xl text-xs whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: -4,
              transform: 'translateX(-50%)',
            }}
          >
            <p className="text-[var(--text-secondary)] font-semibold mb-1">{tooltip.datum.label}</p>
            <p className="text-[var(--accent-emerald-text)]">Paid: ${tooltip.datum.paid.toLocaleString()}</p>
            <p className="text-[var(--accent-amber-text)]">Pending: ${tooltip.datum.pending.toLocaleString()}</p>
            {tooltip.datum.reimbursement > 0 && (
              <p className="text-[var(--accent-purple-text)]">Reimb: ${tooltip.datum.reimbursement.toLocaleString()}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
