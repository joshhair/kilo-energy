'use client';
import { useEffect, useRef, useState } from 'react';

export function useCountUp(target: number, duration = 700, delay = 0): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setValue(target); return; }
    let startTime: number | null = null;
    const run = (now: number) => {
      if (startTime === null) startTime = now + delay;
      const elapsed = Math.max(0, now - startTime);
      const t = Math.min(elapsed / duration, 1);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // expo ease-out
      setValue(target * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(run);
    };
    rafRef.current = requestAnimationFrame(run);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target, duration, delay]);
  return value;
}
