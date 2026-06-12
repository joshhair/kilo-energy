'use client';

import { formatCompactKWParts, formatCurrency } from '../../../../lib/utils';

interface Props {
  participantCount: number;
  totalDeals: number;
  totalKW: number;
  notes?: string | null;
  isAdmin?: boolean;
  netProfit?: number;
}

export default function BlitzOverview({ participantCount, totalDeals, totalKW, notes, isAdmin, netProfit }: Props) {
  const kw = formatCompactKWParts(totalKW);
  const stats: { value: string | number; label: string; valueClass?: string }[] = [
    { value: participantCount, label: participantCount !== 1 ? 'Participants' : 'Participant' },
    { value: totalDeals, label: totalDeals !== 1 ? 'Deals' : 'Deal' },
    { value: kw.value, label: `Total ${kw.unit}` },
    ...(isAdmin && netProfit !== undefined
      ? [{ value: formatCurrency(netProfit), label: 'Net Profit', valueClass: netProfit >= 0 ? 'var(--accent-emerald-solid)' : 'var(--accent-red-solid)' }]
      : []),
  ];
  return (
    <div className="space-y-4">
      <div className={`grid gap-2 [&>*]:min-w-0 ${stats.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="rounded-xl p-3 text-center"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              animation: 'fadeUpIn 350ms cubic-bezier(0.16, 1, 0.3, 1) both',
              animationDelay: `${i * 70}ms`,
            }}
          >
            <p
              className="text-xl font-bold leading-none whitespace-nowrap"
              style={{ color: stat.valueClass ?? 'var(--text-primary)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
            >
              {stat.value}
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {notes && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</p>
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{notes}</p>
        </div>
      )}
    </div>
  );
}
