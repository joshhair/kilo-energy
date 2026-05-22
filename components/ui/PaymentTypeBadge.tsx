'use client';

/**
 * <PaymentTypeBadge> — small inline pill that classifies a PayrollEntry
 * row at a glance once the desktop + mobile payroll lists are merged into
 * a single unified rep view. Mirrors the chip styling pattern from
 * `RepCommissionCard.tsx:69-73` (px-2 py-0.5 rounded text-xs font-medium)
 * so the new badges feel like a native extension of the existing visual
 * language, not a fresh design.
 *
 * Color mapping uses CSS variables only — no raw hex literals — so the
 * tokens audit gate (`check:tokens`) stays at baseline.
 *
 *   Deal     → emerald (the "normal" pay)
 *   Bonus    → amber   (operator-recorded, not formula-driven)
 *   Trainer  → purple  (override income — distinct revenue stream)
 *   Charge   → red     (negative — clawback or one-off deduction)
 *
 * Mobile and desktop use the same component. No size variants today;
 * if a smaller variant is needed later, add a `size: 'sm' | 'md'` prop.
 */

import { GraduationCap, Minus, Gift, Briefcase, type LucideIcon } from 'lucide-react';

export type PaymentTypeKind = 'Deal' | 'Bonus' | 'Trainer' | 'Charge';

interface BadgeStyle {
  background: string;
  color: string;
  Icon?: LucideIcon;
  label: string;
}

const STYLES: Record<PaymentTypeKind, BadgeStyle> = {
  Deal: {
    background: 'var(--accent-emerald-soft)',
    color: 'var(--accent-emerald-text)',
    Icon: Briefcase,
    label: 'Deal',
  },
  Bonus: {
    background: 'var(--accent-amber-soft)',
    color: 'var(--accent-amber-text)',
    Icon: Gift,
    label: 'Bonus',
  },
  Trainer: {
    background: 'var(--accent-purple-soft)',
    color: 'var(--accent-purple-text)',
    Icon: GraduationCap,
    label: 'Trainer',
  },
  Charge: {
    background: 'var(--accent-red-soft)',
    color: 'var(--accent-red-text)',
    Icon: Minus,
    label: 'Charge',
  },
};

export function PaymentTypeBadge({
  kind,
  stage,
  showIcon = true,
  className = '',
}: {
  kind: PaymentTypeKind;
  /** Optional stage suffix rendered after a middot — e.g. 'M1' for Deal
   *  entries. Pass undefined for Trainer/Bonus/Charge rows where the
   *  paymentStage equals the kind and a suffix would just duplicate it. */
  stage?: string | null;
  /** Default true. Set false for dense rows where label alone is enough. */
  showIcon?: boolean;
  /** Optional extra classes (caller-side spacing). */
  className?: string;
}) {
  const s = STYLES[kind];
  const Icon = s.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${className}`}
      style={{ background: s.background, color: s.color }}
    >
      {showIcon && Icon ? <Icon className="w-3 h-3" aria-hidden /> : null}
      {s.label}
      {stage ? <span aria-hidden>·</span> : null}
      {stage ? <span>{stage}</span> : null}
    </span>
  );
}
