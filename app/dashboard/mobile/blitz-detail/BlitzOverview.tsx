'use client';

import { formatCompactKWValue } from '../../../../lib/utils';

interface Props {
  participantCount: number;
  totalDeals: number;
  totalKW: number;
  notes?: string | null;
}

export default function BlitzOverview({ participantCount, totalDeals, totalKW, notes }: Props) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
        {([
          { value: participantCount, label: participantCount !== 1 ? 'Participants' : 'Participant' },
          { value: totalDeals, label: totalDeals !== 1 ? 'Deals' : 'Deal' },
          { value: formatCompactKWValue(totalKW), label: 'Total kW' },
        ] as const).map((stat, i) => (
          <div
            key={stat.label}
            className="rounded-xl p-3 text-center"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              animation: 'fadeUpIn 350ms cubic-bezier(0.16, 1, 0.3, 1) both',
              animationDelay: `${i * 70}ms`,
            }}
          >
            <p
              className="text-xl font-bold text-white leading-none whitespace-nowrap"
              style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
            >
              {stat.value}
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {notes && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</p>
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{notes}</p>
        </div>
      )}
    </div>
  );
}
