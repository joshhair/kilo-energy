'use client';
import { type CSSProperties } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Sparkline } from '../../../../lib/sparkline';
import { useCountUp } from '../../../../lib/use-count-up';

interface StatCardProps {
  label: string;
  rawValue: number;
  formatter: (n: number) => string;
  accentColor: string;
  glowClass: string;
  accentGradient: string;
  trend: number | null;
  trendLabel: string;
  sparkData: number[] | null;
  sparkStroke: string;
  cardIndex: number;
}

export function StatCard({ label, rawValue, formatter, accentColor, glowClass, accentGradient, trend, trendLabel, sparkData, sparkStroke, cardIndex }: StatCardProps) {
  const animated = useCountUp(rawValue, 700, cardIndex * 60);
  return (
    <div
      className="card-surface card-surface-stat rounded-2xl p-4 transition-all duration-200 hover:translate-y-[-2px] motion-safe:animate-stat-card-enter"
      style={{ '--card-accent': accentColor, animationDelay: `${cardIndex * 60}ms` } as CSSProperties}
    >
      <div className={`h-[2px] w-8 rounded-full bg-gradient-to-r mb-2 ${accentGradient}`} />
      <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className={`stat-value stat-value-glow ${glowClass} text-xl font-bold tabular-nums`}>
          {formatter(animated)}
        </p>
        {trend !== null && trend > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent-emerald-solid)]/15 text-[var(--accent-emerald-text)]">
            <TrendingUp className="w-2.5 h-2.5" /> +{trendLabel === 'kW' ? trend.toFixed(1) : Math.round(trend)}
          </span>
        )}
        {trend !== null && trend < 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-[var(--accent-red-text)]">
            <TrendingDown className="w-2.5 h-2.5" /> {trendLabel === 'kW' ? trend.toFixed(1) : Math.round(trend)}
          </span>
        )}
      </div>
      {sparkData && <Sparkline data={sparkData} stroke={sparkStroke} />}
    </div>
  );
}
