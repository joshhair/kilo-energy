'use client';

import { useState, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SubmittedDeal {
  projectId: string;
  customerName: string;
  installer: string;
  financer: string;
  productType: string;
  kW: number;
  soldPPW: number;
  closerTotal: number;
  closerM1: number;
  closerM2: number;
  closerM3: number;
  setterTotal: number;
  setterM1: number;
  setterM2: number;
  setterM3: number;
  setterName: string;
  repName: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const DEAL_STEPS = ['People', 'Deal Details', 'Review & Notes'] as const;

// ── Validation ───────────────────────────────────────────────────────────────

export function validateField(field: string, value: string): string {
  switch (field) {
    case 'repId':        return value ? '' : 'Closer is required';
    case 'customerName': return value.trim() ? '' : 'Customer name is required';
    case 'soldDate':     return value ? '' : 'Sold date is required';
    case 'installer':    return value ? '' : 'Installer is required';
    case 'financer':     return value ? '' : 'Financer is required'; // skipped at call-site when product type is Cash
    case 'productType':  return value ? '' : 'Product type is required';
    case 'solarTechFamily':    return value ? '' : 'Product family is required';
    case 'solarTechProductId': return value ? '' : 'Product is required';
    case 'pcFamily':           return value ? '' : 'Product family is required';
    case 'installerProductId': return value ? '' : 'Product is required';
    case 'prepaidSubType':     return value ? '' : 'Prepaid type is required';
    case 'blitzId':            return value ? '' : 'Blitz is required';
    case 'kWSize':
      if (!value) return 'kW size is required';
      if (isNaN(parseFloat(value)) || parseFloat(value) < 1) return 'Must be at least 1 kW';
      return '';
    case 'netPPW':
      if (!value) return 'Net PPW is required';
      if (isNaN(parseFloat(value)) || parseFloat(value) <= 0) return 'Must be greater than 0';
      return '';
    default: return '';
  }
}

export function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${rand}`;
}

// ── Small UI Components ──────────────────────────────────────────────────────

export function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? (
    <p id={`${field}-error`} className="text-red-500 text-sm mt-1" role="alert">
      {errors[field]}
    </p>
  ) : null;
}

export function PpwHint({ soldPPW, closerPerW, hasError }: { soldPPW: number; closerPerW: number; hasError: boolean }) {
  if (hasError || soldPPW <= 0 || closerPerW <= 0) return null;
  const above = soldPPW >= closerPerW;
  const diff = Math.abs(soldPPW - closerPerW).toFixed(2);
  return (
    <p id="netPPW-hint" className={`text-xs mt-1 ${above ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-amber-text)]'}`}>
      {above ? `$${diff}/W above baseline \u2713` : `$${diff}/W below baseline \u2014 no commission`}
    </p>
  );
}

export function SectionHeader({ step, label }: { step: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)', color: 'var(--accent-emerald-text)' }}>
        {step}
      </span>
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
    </div>
  );
}

// ── TickerAmount ──────────────────────────────────────────────────────────────
// Wraps a formatted dollar amount in a span with tabular-nums and a brief
// opacity fade whenever the underlying number changes — gives the live
// commission preview a "premium ticker" feel without an animation library.

export function TickerAmount({ amount, className }: { amount: number; className?: string }) {
  const [visible, setVisible] = useState(true);
  const prevRef = useRef(amount);

  useEffect(() => {
    if (prevRef.current === amount) return;
    prevRef.current = amount;
    const t1 = setTimeout(() => setVisible(false), 0);
    const t2 = setTimeout(() => setVisible(true), 60);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [amount]);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        transition: 'opacity 0.22s ease-in-out',
        opacity: visible ? 1 : 0,
        display: 'inline-block',
      }}
    >
      ${amount.toLocaleString()}
    </span>
  );
}
