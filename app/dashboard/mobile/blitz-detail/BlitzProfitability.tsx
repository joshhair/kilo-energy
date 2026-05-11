'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '../../../../lib/utils';
import { getBlitzProjectBaselines } from '../../../../lib/blitzComputed';

const COST_BAR: Record<string, string> = {
  housing: 'var(--accent-emerald-solid)',
  travel: 'var(--accent-purple-solid)',
  gas: 'var(--accent-amber-solid)',
  meals: 'var(--accent-emerald-solid)',
  incentives: 'var(--accent-red-solid)',
  swag: 'var(--accent-amber-text)',
  other: 'var(--text-dim)',
};

interface Props {
  approvedVisibleProjects: any[];
  approvedParticipantIds: Set<string>;
  approvedParticipants: any[];
  leaderboard: any[];
  totalCosts: number;
  kiloMargin: number;
  costsByCategory: Record<string, number>;
  solarTechProducts: any[];
  productCatalogProducts: any[];
  installerPricingVersions: any[];
}

export default function BlitzProfitability({
  approvedVisibleProjects,
  approvedParticipantIds,
  approvedParticipants,
  leaderboard,
  totalCosts,
  kiloMargin,
  costsByCategory,
  solarTechProducts,
  productCatalogProducts,
  installerPricingVersions,
}: Props) {
  const router = useRouter();
  const netProfit = kiloMargin - totalCosts;
  const roi = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;
  const deps = { solarTechProducts, productCatalogProducts, installerPricingVersions };

  const categories = Object.entries(costsByCategory).sort((a, b) => b[1] - a[1]);

  const perProject = approvedVisibleProjects
    .map((p: any) => {
      const isSelfGen = p.closer?.id && p.closer?.id === p.setter?.id;
      const closerApproved = p.closer?.id && approvedParticipantIds.has(p.closer.id);
      const anyAddl = (p.additionalClosers ?? []).some((cc: any) => approvedParticipantIds.has(cc.userId));
      if (!isSelfGen && !closerApproved && !anyAddl) return null;
      const { closerPerW, kiloPerW } = getBlitzProjectBaselines(p, deps);
      const setterCost = (p.setter?.id && p.setter?.id !== p.closer?.id) ? 0.10 * p.kWSize * 1000 : 0;
      const margin = (closerPerW - kiloPerW) * p.kWSize * 1000 - setterCost;
      return { p, margin };
    })
    .filter((e): e is { p: any; margin: number } => e !== null)
    .sort((a, b) => b.margin - a.margin);

  const kpis = [
    { label: 'Kilo Margin', value: formatCurrency(Math.round(kiloMargin)), tone: 'emerald' as const, sub: 'Baseline spread × kW' },
    { label: 'Blitz Costs', value: formatCurrency(totalCosts), tone: 'amber' as const },
    { label: 'Net Profit', value: formatCurrency(Math.round(netProfit)), tone: netProfit >= 0 ? 'emerald' as const : 'red' as const, sub: 'Margin − Costs' },
    { label: 'ROI', value: `${roi.toFixed(0)}%`, tone: roi >= 0 ? 'emerald' as const : 'red' as const, icon: roi >= 0 },
  ];

  const toneColor = (t: 'emerald' | 'amber' | 'red') =>
    t === 'emerald' ? 'var(--accent-emerald-solid)' : t === 'amber' ? 'var(--accent-amber-text)' : 'var(--accent-red-text)';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className="rounded-xl p-3"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              animation: 'fadeUpIn 350ms cubic-bezier(0.16, 1, 0.3, 1) both',
              animationDelay: `${i * 70}ms`,
            }}
          >
            <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{k.label}</p>
            <p className="text-xl font-bold mt-1 flex items-center gap-1.5 leading-none" style={{ color: toneColor(k.tone), fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
              {k.value}
              {k.icon !== undefined && (k.icon ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />)}
            </p>
            {k.sub && <p className="text-[10px] mt-1" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Cost Breakdown</p>
          <div className="space-y-2.5">
            {categories.map(([cat, amt], idx) => {
              const pct = totalCosts > 0 ? (amt / totalCosts) * 100 : 0;
              const color = COST_BAR[cat] ?? COST_BAR.other;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs capitalize font-semibold" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{cat}</span>
                    <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{formatCurrency(amt)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                    <div
                      className="h-full rounded-full bar-grow-anim"
                      style={{ background: color, '--bar-w': `${pct}%`, '--bar-delay': `${80 + idx * 70}ms` } as React.CSSProperties}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {perProject.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Projects by margin</p>
          <div className="space-y-2">
            {perProject.map(({ p, margin }) => {
              const closerName = p.closer ? `${p.closer.firstName} ${p.closer.lastName}` : '—';
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 active:opacity-70 min-h-[56px]"
                  style={{ background: 'var(--surface-pressed)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{p.customerName}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{closerName} · {p.kWSize?.toFixed(1)} kW</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Margin</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: margin >= 0 ? 'var(--accent-emerald-solid)' : 'var(--accent-red-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(Math.round(margin))}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {approvedParticipants.length > 0 && leaderboard.length > 0 && (() => {
        const repStats = leaderboard.map((r) => ({ user: r.user, deals: r.deals, kw: r.kW, payout: r.payout }));
        const maxKW = Math.max(...repStats.map((r) => r.kw), 1);
        // Rank 1 = bright amber (top performer); rank 3 = darker amber.
        // Ranks 2 & 4+ collapse to dim so the gold/bronze podium reads.
        const barColors = ['var(--accent-amber-solid)', 'var(--text-dim)', 'var(--accent-amber-display)', 'var(--text-dim)'];
        return (
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep Performance</p>
            <div className="space-y-3">
              {repStats.map((rep, idx) => (
                <div key={rep.user.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: idx === 0 ? 'color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)' : 'rgba(68,85,119,0.3)', color: idx === 0 ? 'var(--accent-gold-text)' : 'var(--text-muted)', border: `1px solid ${idx === 0 ? 'color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)' : 'var(--border-subtle)'}` }}
                      >
                        {idx + 1}
                      </div>
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.user.firstName} {rep.user.lastName}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                      <span style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.deals}d · {rep.kw.toFixed(1)} kW</span>
                      <span className="font-semibold" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{formatCurrency(rep.payout)}</span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                    <div
                      className="h-full rounded-full bar-grow-anim"
                      style={{ background: barColors[Math.min(idx, barColors.length - 1)], '--bar-w': `${(rep.kw / maxKW) * 100}%`, '--bar-delay': `${idx * 60}ms` } as React.CSSProperties}
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
