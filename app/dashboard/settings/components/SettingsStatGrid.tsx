'use client';

import { useEffect, useRef, useState } from 'react';

interface StatItem {
  label: string;
  value: number;
  color: string;
  bg: string;
}

interface Props { items: StatItem[] }

function useCountUp(target: number, duration = 600): number {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setCount(target); return; }
    const start = performance.now();
    const ease = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setCount(Math.round(ease(p) * target));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return count;
}

function StatCard({ label, value, color, bg, index }: StatItem & { index: number }) {
  const displayVal = useCountUp(value, 600);
  return (
    <div
      className={`${bg} border rounded-2xl p-4 flex flex-col gap-1 animate-stat-card-enter hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 cursor-default`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <span
        className={`text-3xl xl:text-4xl font-black tabular-nums leading-none ${color}`}
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >{displayVal}</span>
      <span className="text-xs text-[var(--text-muted)] leading-tight">{label}</span>
    </div>
  );
}

export function SettingsStatGrid({ items }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {items.map((item, index) => (
        <StatCard key={item.label} {...item} index={index} />
      ))}
    </div>
  );
}
