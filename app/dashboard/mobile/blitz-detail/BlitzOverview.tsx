'use client';

import { formatCompactKW } from '../../../../lib/utils';

interface Props {
  participantCount: number;
  totalDeals: number;
  totalKW: number;
  notes?: string | null;
}

export default function BlitzOverview({ participantCount, totalDeals, totalKW, notes }: Props) {
  return (
    <div className="space-y-6">
      <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{participantCount}</span> participant{participantCount !== 1 ? 's' : ''}
        {' \u00B7 '}
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{totalDeals}</span> deal{totalDeals !== 1 ? 's' : ''}
        {' \u00B7 '}
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCompactKW(totalKW)}</span>
      </p>

      {notes && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</p>
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{notes}</p>
        </div>
      )}
    </div>
  );
}
