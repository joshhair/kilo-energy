'use client';

import { useEffect, useState } from 'react';

function useCountUp(target: number, duration: number, delay: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let rafId: number;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(Math.max((elapsed - delay) / duration, 0), 1);
      const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(Math.round(target * ease));
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration, delay]);
  return value;
}

type GradCardProps = {
  label: string;
  rawValue: number;
  formatter: (v: number) => string;
  gradient: string;
  borderColor: string;
  valueColor: string;
  delay: number;
};

export function GradCard({ label, rawValue, formatter, gradient, borderColor, valueColor, delay }: GradCardProps) {
  const animated = useCountUp(rawValue, 900, delay);
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: gradient, border: `1px solid ${borderColor}` }}>
      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
      <span className="text-2xl font-bold" style={{ fontFamily: "'DM Serif Display', serif", color: valueColor, textShadow: `0 0 20px ${valueColor}50` }}>
        {formatter(animated)}
      </span>
    </div>
  );
}
