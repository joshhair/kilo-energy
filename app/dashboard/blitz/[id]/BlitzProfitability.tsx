'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '../../../../lib/utils';

const COST_CATEGORY_STYLES: Record<string, { badge: string; bar: string }> = {
  housing:    { badge: 'bg-[var(--accent-blue-soft)] text-[var(--accent-cyan-text)] border border-blue-700/30',       bar: 'bg-[var(--accent-emerald-solid)]' },
  travel:     { badge: 'bg-[var(--accent-purple-soft)] text-[var(--accent-purple-text)] border border-purple-700/30',  bar: 'bg-purple-500' },
  gas:        { badge: 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)] border border-amber-700/30',     bar: 'bg-amber-500' },
  meals:      { badge: 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)] border border-emerald-700/30', bar: 'bg-[var(--accent-emerald-solid)]' },
  incentives: { badge: 'bg-[var(--accent-purple-soft)] text-[var(--accent-purple-text)] border border-pink-700/30',        bar: 'bg-pink-500' },
  swag:       { badge: 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)] border border-orange-700/30',  bar: 'bg-orange-500' },
  other:      { badge: 'bg-[var(--surface-card)]/60 text-[var(--text-secondary)] border border-[var(--border)]/30', bar: 'bg-[var(--text-muted)]' },
};

interface BlitzProfitabilityProps {
  blitz: any;
  leaderboard: any[];
  approvedParticipants: any[];
  approvedParticipantIds: Set<string>;
  approvedVisibleProjects: any[];
  totalCosts: number;
  kiloMargin: number;
  netProfit: number;
  roi: number;
  costsByCategory: Record<string, number>;
  getBlitzProjectBaselines: (p: any) => { closerPerW: number; kiloPerW: number };
  animKey: number;
}

export function BlitzProfitability({
  blitz,
  leaderboard,
  approvedParticipants,
  approvedParticipantIds,
  approvedVisibleProjects,
  totalCosts,
  kiloMargin,
  netProfit,
  roi,
  costsByCategory,
  getBlitzProjectBaselines,
  animKey,
}: BlitzProfitabilityProps) {
  return (
    <div key={animKey} className="animate-tab-enter space-y-6">
      {/* Top-level P&L */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-0" style={{ '--card-accent': 'var(--accent-cyan-solid)' } as React.CSSProperties}>
          <p className="text-xs text-[var(--text-muted)] mb-1">Kilo Margin</p>
          <p className="text-2xl font-bold text-[var(--accent-emerald-text)]">{formatCurrency(Math.round(kiloMargin))}</p>
          <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Baseline spread × kW</p>
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-1" style={{ '--card-accent': 'var(--accent-amber-solid)' } as React.CSSProperties}>
          <p className="text-xs text-[var(--text-muted)] mb-1">Blitz Costs</p>
          <p className="text-2xl font-bold text-[var(--accent-amber-text)]">{formatCurrency(totalCosts)}</p>
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-2" style={{ '--card-accent': 'var(--accent-emerald-solid)' } as React.CSSProperties}>
          <p className="text-xs text-[var(--text-muted)] mb-1">Net Profit</p>
          <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}`}>{formatCurrency(Math.round(netProfit))}</p>
          <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Margin − Costs</p>
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-3" style={{ '--card-accent': 'var(--accent-purple-solid)' } as React.CSSProperties}>
          <p className="text-xs text-[var(--text-muted)] mb-1">ROI</p>
          <p className={`text-2xl font-bold flex items-center gap-1.5 ${roi > 100 ? 'text-[var(--accent-emerald-text)]' : roi >= 0 ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}`}>
            {roi.toFixed(0)}%
            {roi >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          </p>
        </div>
      </div>

      {/* Cost breakdown */}
      {Object.keys(costsByCategory).length > 0 && (
        <div className="card-surface rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">Cost Breakdown</h3>
          <div className="space-y-2">
            {Object.entries(costsByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt], idx) => {
              const pct = totalCosts > 0 ? (amt / totalCosts) * 100 : 0;
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full w-22 text-center ${COST_CATEGORY_STYLES[cat]?.badge ?? COST_CATEGORY_STYLES.other.badge}`}>{cat}</span>
                  <div className="flex-1 bg-[var(--surface-card)] rounded-full h-2 overflow-hidden">
                    <div
                      className={`${COST_CATEGORY_STYLES[cat]?.bar ?? 'bg-[var(--text-muted)]'} h-full rounded-full bar-grow-anim`}
                      style={{ '--bar-w': pct + '%', '--bar-delay': (idx * 80) + 'ms' } as React.CSSProperties}
                    />
                  </div>
                  <span className="text-sm font-medium text-[var(--text-primary)] w-20 text-right">{formatCurrency(amt)}</span>
                  <span className="text-xs text-[var(--text-muted)] w-12 text-right">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-project margin breakdown */}
      {approvedVisibleProjects.length > 0 && (
        <div className="card-surface rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">Projects in this blitz</h3>
          <div className="space-y-2">
            {approvedVisibleProjects.map((p: any) => {
              const closerApproved = p.closer?.id && approvedParticipantIds.has(p.closer.id);
              const anyAdditionalCloserApproved = (p.additionalClosers ?? []).some((cc: any) => approvedParticipantIds.has(cc.userId));
              if (!closerApproved && !anyAdditionalCloserApproved) return null;
              const { closerPerW, kiloPerW } = getBlitzProjectBaselines(p);
              const setterCost = (p.setter?.id && p.setter?.id !== p.closer?.id) ? 0.10 * p.kWSize * 1000 : 0;
              const margin = (closerPerW - kiloPerW) * p.kWSize * 1000 - setterCost;
              const closerName = p.closer ? `${p.closer.firstName} ${p.closer.lastName}` : '—';
              return (
                <Link
                  key={p.id}
                  href={`/dashboard/projects/${p.id}`}
                  className="flex items-center justify-between bg-[var(--surface-card)]/50 hover:bg-[var(--surface-card)] rounded-xl px-4 py-2.5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-primary)] font-medium truncate">{p.customerName}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{closerName} · {p.kWSize?.toFixed(1)} kW · ${p.netPPW?.toFixed(2)}/W</p>
                  </div>
                  <div className="text-right shrink-0 pl-3">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Kilo margin</p>
                    <p className={`text-sm font-bold ${margin >= 0 ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}`}>{formatCurrency(Math.round(margin))}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-rep performance */}
      {approvedParticipants.length > 0 && blitz.projects?.length > 0 && (() => {
        const repStats = leaderboard.map((r) => ({ user: r.user, deals: r.deals, kw: r.kW, payout: r.payout }));
        const maxKW = Math.max(...repStats.map((r) => r.kw), 1);

        return (
          <div className="card-surface rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">Rep Performance</h3>
            <div className="space-y-3">
              {repStats.map((rep: { user: { id: string; firstName: string; lastName: string }; deals: number; kw: number; payout: number }, idx: number) => (
                <div key={rep.user.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-amber-500/20 text-[var(--accent-amber-text)] border border-amber-500/30' : idx === 1 ? 'bg-[var(--text-muted)]/20 text-[var(--text-secondary)] border border-[var(--border-subtle)]/30' : idx === 2 ? 'bg-orange-800/30 text-[var(--accent-amber-text)] border border-orange-700/30' : 'bg-[var(--surface-card)] text-[var(--text-muted)] border border-[var(--border)]'}`}>
                        {idx + 1}
                      </div>
                      <Link href={`/dashboard/users/${rep.user.id}`} className="text-sm text-[var(--text-primary)] font-medium hover:text-[var(--accent-cyan-text)] transition-colors">{rep.user.firstName} {rep.user.lastName}</Link>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-[var(--text-secondary)]">{rep.deals} deal{rep.deals !== 1 ? 's' : ''}</span>
                      <span className="text-[var(--text-secondary)] font-semibold">{rep.kw.toFixed(1)} kW</span>
                      <span className="text-[var(--accent-emerald-text)] font-semibold">{formatCurrency(rep.payout)}</span>
                    </div>
                  </div>
                  <div className="w-full bg-[var(--surface-card)] rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full bar-grow-anim ${idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-[var(--text-muted)]' : idx === 2 ? 'bg-orange-600' : 'bg-[var(--text-dim)]'}`}
                      style={{ '--bar-w': ((rep.kw / maxKW) * 100) + '%', '--bar-delay': (idx * 60) + 'ms' } as React.CSSProperties}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
