'use client';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { formatCurrency } from '../../../../lib/utils';

type LeaderboardEntry = { userId: string; name: string; initials: string; deals: number; kW: number; payout: number };

const RANK_GRADIENTS = ['from-yellow-400 to-amber-600', 'from-slate-300 to-slate-500', 'from-amber-600 to-amber-800'];
const RANK_BG = ['bg-yellow-900/20 border-yellow-600/30', 'bg-[var(--surface-card)]/40 border-[var(--border)]/30', 'bg-amber-900/20 border-amber-700/30'];
const RANK_TEXT = ['text-yellow-400', 'text-[var(--text-secondary)]', 'text-amber-400'];

export function BlitzLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="card-surface rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
        <Trophy className="w-3.5 h-3.5 text-amber-400" /> Leaderboard
      </h3>
      <div className="space-y-2">
        {entries.slice(0, 5).map((rep, idx) => {
          const rank = idx + 1;
          const isTop3 = rank <= 3;
          return (
            <div key={rep.userId} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-150 hover:scale-[1.004] ${
              isTop3 ? RANK_BG[rank - 1] : 'bg-[var(--surface)]/40 border-[var(--border-subtle)]/40'
            }`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                isTop3 ? `bg-gradient-to-br ${RANK_GRADIENTS[rank - 1]} text-white` : 'bg-[var(--surface-card)] text-[var(--text-secondary)]'
              }`}>{rank}</span>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                isTop3 ? `bg-gradient-to-br ${RANK_GRADIENTS[rank - 1]} text-white` : 'bg-[var(--border)] text-[var(--text-secondary)]'
              }`}>{rep.initials}</div>
              <Link href={`/dashboard/users/${rep.userId}`} className={`flex-1 text-sm font-medium truncate hover:text-[var(--accent-cyan-solid)] transition-colors ${
                isTop3 ? RANK_TEXT[rank - 1] : 'text-[var(--text-secondary)]'
              }`}>{rep.name}</Link>
              <span className="text-xs text-[var(--text-secondary)] tabular-nums whitespace-nowrap">{rep.deals} deal{rep.deals !== 1 ? 's' : ''}</span>
              <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">{rep.kW.toFixed(1)} kW</span>
              {rep.payout > 0 && (
                <span className="hidden xl:inline text-xs font-semibold tabular-nums text-[var(--accent-emerald-solid)] whitespace-nowrap">{formatCurrency(rep.payout)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
