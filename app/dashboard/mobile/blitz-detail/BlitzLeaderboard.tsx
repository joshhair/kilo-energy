'use client';

import { useRouter } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { formatCurrency } from '../../../../lib/utils';
import type { LeaderboardEntry } from '../../../../lib/blitzComputed';

const RANK_GRAD = [
  'linear-gradient(135deg, #fbbf24, #d97706)',
  'linear-gradient(135deg, #cbd5e1, #64748b)',
  'linear-gradient(135deg, #d97706, #92400e)',
];

interface Props {
  entries: LeaderboardEntry[];
  showPayout: boolean;
}

export default function BlitzLeaderboard({ entries, showPayout }: Props) {
  const router = useRouter();
  if (entries.length === 0) return (
    <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
      <Trophy className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--accent-gold-text)', opacity: 0.2 }} />
      <p className="text-sm font-semibold text-[var(--text-primary)]">No deals yet</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Rankings appear once reps start closing.</p>
    </div>
  );

  const maxKW = Math.max(...entries.map(e => e.kW), 1);
  const RANK_BG = ['rgba(251,191,36,0.10)', 'rgba(203,213,225,0.07)', 'rgba(251,146,60,0.09)'];

  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-3.5 h-3.5" style={{ color: 'var(--accent-gold-text)' }} />
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Leaderboard</span>
      </div>
      <div className="space-y-1.5">
        {entries.slice(0, 5).map((rep, idx) => {
          const rank = idx + 1;
          const isTop3 = rank <= 3;
          return (
            <button
              key={rep.userId}
              onClick={() => router.push(`/dashboard/users/${rep.userId}`)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg active:opacity-70 relative overflow-hidden"
              style={{
                background: isTop3 ? 'var(--surface-pressed)' : 'transparent',
                animation: 'fadeUpIn 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
                animationDelay: `${idx * 50}ms`,
              }}
            >
              <span aria-hidden className="bar-grow-anim absolute inset-y-0 left-0 rounded-lg" style={{ '--bar-w': `${Math.max(8, Math.round((rep.kW / maxKW) * 100))}%`, '--bar-delay': `${idx * 70}ms`, background: isTop3 ? RANK_BG[rank - 1] : 'color-mix(in srgb, var(--text-primary) 4%, transparent)' } as React.CSSProperties} />
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{
                  background: isTop3 ? RANK_GRAD[rank - 1] : 'var(--border-subtle)',
                  color: isTop3 ? '#000' : 'var(--text-muted)',
                  fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                }}
              >
                {rank}
              </span>
              <span className="flex-1 text-sm font-semibold truncate text-left" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                {rep.name}
              </span>
              <span className="text-xs tabular-nums shrink-0" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                {rep.deals}d · {rep.kW.toFixed(1)}kW
              </span>
              {showPayout && rep.payout > 0 && (
                <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {formatCurrency(Math.round(rep.payout))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
