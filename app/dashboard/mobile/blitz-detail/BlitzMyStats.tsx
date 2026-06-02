'use client';

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Mirrors the dynamic blitz project shape from /api/blitzes/[id]. */

import { useState, useEffect, useMemo } from 'react';
import { formatCurrency, formatCompactKWParts } from '../../../../lib/utils';

interface Props {
  visibleProjects: any[];
  effectiveRepId: string | null | undefined;
}

export default function BlitzMyStats({ visibleProjects, effectiveRepId }: Props) {
  const myPay = useMemo(() => visibleProjects.reduce((s: number, p: any) => {
    const ccEntry = (p.additionalClosers ?? []).find((cc: any) => cc.userId === effectiveRepId);
    const csEntry = (p.additionalSetters ?? []).find((cs: any) => cs.userId === effectiveRepId);
    return s + (p.closer?.id === effectiveRepId
      ? (p.setter?.id === effectiveRepId
        ? (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0)
        : (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0))
      : (p.setter?.id === effectiveRepId
        ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0)
        : (ccEntry ? (ccEntry.m1Amount ?? 0) + (ccEntry.m2Amount ?? 0) + (ccEntry.m3Amount ?? 0)
          : (csEntry ? (csEntry.m1Amount ?? 0) + (csEntry.m2Amount ?? 0) + (csEntry.m3Amount ?? 0) : 0))));
  }, 0), [visibleProjects, effectiveRepId]);

  const myKW = useMemo(() => visibleProjects.reduce((s: number, p: any) => {
    const isAdditionalCloser = (p.additionalClosers ?? []).some((cc: any) => cc.userId === effectiveRepId);
    return s + (p.closer?.id === effectiveRepId || isAdditionalCloser ? p.kWSize : 0);
  }, 0), [visibleProjects, effectiveRepId]);

  const [displayPay, setDisplayPay] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayPay(myPay); return;
    }
    const start = performance.now();
    const duration = 500;
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setDisplayPay(Math.round(eased * myPay));
      if (t < 1) { raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [myPay]);

  const kwParts = formatCompactKWParts(myKW);

  return (
    <div className="rounded-xl p-4 border-l-2" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderLeftColor: 'color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)' }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Your Blitz Summary</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="blitz-stat-0">
          <p className="text-xl font-bold text-[var(--text-primary)] leading-none" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{visibleProjects.length}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Deal{visibleProjects.length !== 1 ? 's' : ''} Attributed</p>
        </div>
        <div className="blitz-stat-1">
          <p className="text-xl font-bold text-[var(--text-primary)] leading-none" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{kwParts.value}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{kwParts.unit} Sold</p>
        </div>
        <div className="blitz-stat-2">
          <p className="text-xl font-bold leading-none" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(displayPay)}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>My Pay</p>
        </div>
      </div>
    </div>
  );
}
