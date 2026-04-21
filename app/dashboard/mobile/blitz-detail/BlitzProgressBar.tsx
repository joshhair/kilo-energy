'use client';

import { useState, useEffect } from 'react';
import { formatDate } from '../../../../lib/utils';

interface Props {
  startDate: string;
  endDate: string;
  status: string;
}

export default function BlitzProgressBar({ startDate, endDate, status }: Props) {
  const startMs = new Date(startDate + 'T00:00:00').getTime();
  const endMs   = new Date(endDate   + 'T00:00:00').getTime();
  const nowMs   = new Date().setHours(0, 0, 0, 0);
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
  const elapsed   = Math.max(0, Math.min(totalDays, Math.round((nowMs - startMs) / 86400000) + 1));
  const targetPct = status === 'completed' ? 100 : Math.round((elapsed / totalDays) * 100);

  const [displayPct, setDisplayPct] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDisplayPct(targetPct));
    return () => cancelAnimationFrame(id);
  }, [targetPct]);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Progress</p>
        <p className="text-xs" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {status === 'completed' ? 'Completed' : `Day ${elapsed} of ${totalDays}`}
        </p>
      </div>
      <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--m-border, var(--border-mobile))' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${displayPct}%`,
            background: 'var(--accent-emerald)',
            transition: 'width 700ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[11px]" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span>{formatDate(startDate)}</span>
        <span>{formatDate(endDate)}</span>
      </div>
    </div>
  );
}
