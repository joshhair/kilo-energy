'use client';

import { PlusCircle } from 'lucide-react';

export function DealEntryPage({ onStart, projects, currentRepId }: { onStart: () => void; projects: { soldDate: string; repId?: string; setterId?: string | null }[]; currentRepId: string | null | undefined }) {
  const today = new Date().toISOString().split('T')[0];
  const monthPrefix = today.slice(0, 7);
  const todayCount = currentRepId == null ? 0 : projects.filter((p) => p.soldDate === today && (p.repId === currentRepId || p.setterId === currentRepId)).length;
  const monthCount = currentRepId == null ? 0 : projects.filter((p) => p.soldDate?.startsWith(monthPrefix) && (p.repId === currentRepId || p.setterId === currentRepId)).length;

  return (
    <div className="p-4 md:p-8 max-w-2xl animate-slide-in-scale">
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-8 sm:px-8 sm:py-10 md:px-12 md:py-14">
          {/* Icon + heading */}
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
              <PlusCircle className="w-6 h-6 text-[var(--accent-emerald-solid)]" />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
              New Deal
            </h1>
          </div>

          <p className="text-[var(--text-secondary)] text-[15px] mb-8 max-w-sm leading-relaxed ml-[52px]">
            Log a closed solar deal and track commissions in seconds.
          </p>

          {/* Stats strip */}
          {(todayCount > 0 || monthCount > 0) && (
            <div className="flex items-center gap-6 mb-8 ml-[52px]">
              <div>
                <p className="text-2xl font-black text-white tabular-nums">{todayCount}</p>
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest mt-0.5">Today</p>
              </div>
              <div className="w-px h-8 bg-[var(--border)]/70" />
              <div>
                <p className="text-2xl font-black text-white tabular-nums">{monthCount}</p>
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest mt-0.5">This Month</p>
              </div>
            </div>
          )}

          {/* CTA — matches dashboard glow style */}
          <div className="ml-[52px]">
            <div className="relative inline-flex">
              <div className="absolute -inset-0.5 rounded-2xl opacity-[0.15] blur-[3px] animate-pulse" style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))' }} />
              <button
                onClick={onStart}
                className="relative inline-flex items-center gap-2.5 font-bold px-8 py-4 rounded-2xl text-base active:scale-[0.97] transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--surface-page)' }}
              >
                <PlusCircle className="w-5 h-5" />
                Submit a Deal
              </button>
            </div>
          </div>
          <span className="text-[var(--text-dim)] text-xs hidden sm:block">or press ⌘↵ on the form</span>
        </div>
      </div>
    </div>
  );
}
