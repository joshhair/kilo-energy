'use client';

import { Trophy, Award } from 'lucide-react';

const RANK_GRADIENTS = [
  'from-yellow-400 to-amber-600', // gold  – #1
  'from-slate-300 to-slate-500',  // silver – #2
  'from-amber-600 to-amber-800',  // bronze – #3
];

const PODIUM_BREATH_CLS: Record<number, string> = {
  1: 'animate-podium-breath-gold',
  2: 'animate-podium-breath-silver',
  3: 'animate-podium-breath-bronze',
};

export type PodiumEntry = {
  rep: { id: string; name: string };
  paid: number;
  rank: number;
  order: number;
};

export function TopPerformersPodium({ entries }: { entries: PodiumEntry[] }) {
  if (entries.length !== 3) return null;
  return (
    <div className="card-surface rounded-2xl p-5 mb-8 animate-slide-in-scale" style={{ animationDelay: 'var(--podium-delay, 300ms)' }}>
      <div className="h-[3px] w-10 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 mb-3" />
      <div className="flex items-center gap-2 mb-5">
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(234,179,8,0.15)' }}>
          <Trophy className="w-4 h-4 text-[var(--accent-amber-text)]" />
        </div>
        <h2 className="text-[var(--text-primary)] font-bold text-base tracking-tight">Top Performers</h2>
      </div>

      <div className="flex items-end justify-center gap-3">
        {entries.map(({ rep, paid, rank, order }) => {
          const isFirst = rank === 1;
          const gradient = RANK_GRADIENTS[rank - 1];
          const initials = rep.name.split(' ').map((n) => n[0]).join('');
          return (
            <div
              key={rep.id}
              className={`relative flex flex-col items-center gap-2 card-surface rounded-2xl p-4 flex-1 max-w-[160px] overflow-hidden animate-slide-in-scale stagger-${order} ${PODIUM_BREATH_CLS[rank]}${isFirst ? ' scale-105' : ''}`}
              style={{ order }}
            >
              <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${gradient}${isFirst ? ' animate-podium-glow' : ''}`} />

              {isFirst && <Award className="w-4 h-4 text-[var(--accent-amber-text)]" />}

              <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} p-[2px] flex-shrink-0`}>
                <div
                  className="w-full h-full rounded-full flex items-center justify-center text-[var(--text-primary)] font-bold text-lg"
                  style={{ backgroundColor: 'var(--surface-pressed)' }}
                >
                  {initials}
                </div>
              </div>

              <div className={`text-[10px] font-black text-[var(--text-primary)] px-2 py-0.5 rounded-full bg-gradient-to-br ${gradient}`}>
                #{rank}
              </div>

              <p className="font-bold text-[var(--text-primary)] text-sm text-center leading-tight">{rep.name}</p>

              <p className="text-gradient-brand font-black text-sm">${paid.toLocaleString()}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
