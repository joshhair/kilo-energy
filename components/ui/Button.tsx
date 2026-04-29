'use client';

/**
 * Shared button primitives — single source of truth for the four button
 * roles used across every admin Settings surface.
 *
 *   <PrimaryButton>   — the "do it" button. Brand gradient (emerald→cyan
 *                       diagonal), used for Save / Add / Apply / Submit.
 *                       Replaces the prior split between
 *                       `linear-gradient(135deg, ...)` and
 *                       `backgroundColor: var(--brand)` styles that had
 *                       drifted across sections.
 *   <SecondaryButton> — the "back out" button. Bordered ghost, used for
 *                       Cancel / inline edit triggers.
 *   <DangerButton>    — destructive confirm. Red-tinted solid; reserved
 *                       for terminal Delete / Remove confirms.
 *   <IconButton>      — square icon-only button (e.g. row-hover Trash2,
 *                       Pencil, Eye/EyeOff). Variant prop picks the
 *                       hover-tint family.
 *
 * All variants share:
 *   - `active:scale-[0.97]` press feedback (matches the rest of the app's
 *     micro-interaction language)
 *   - `disabled:opacity-40 disabled:cursor-not-allowed`
 *   - `transition-colors` for hover state
 *   - rounded-xl on the rectangular variants, rounded-lg on icon-only
 *
 * Adding a new variant:
 *   - Resist. Most "I need a new button color" requests are actually
 *     "I need to use SecondaryButton in this spot" — check first.
 *   - If genuinely new (e.g. a "warning" amber state), match the prop
 *     shape exactly and add to BUTTON_BASE / role list here.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-colors active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed motion-reduce:active:scale-100';

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  /** Default 'button'. Pass 'submit' for form submission triggers. */
  type?: 'button' | 'submit' | 'reset';
  /** When true, render a disabled spinner-locked state. */
  loading?: boolean;
  /** Optional size override. Default 'md'. */
  size?: 'sm' | 'md';
};

function sizeClasses(size: 'sm' | 'md'): string {
  return size === 'sm' ? 'px-2.5 py-1.5 text-xs rounded-lg' : 'px-3 py-2 text-sm rounded-xl';
}

/** Brand-gradient action button. The "primary" affordance on every
 *  Settings panel — Save / Add / Apply / Submit. */
export function PrimaryButton({
  type = 'button',
  loading = false,
  disabled,
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={`${BUTTON_BASE} ${sizeClasses(size)} ${className}`}
      style={{
        background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
        color: 'var(--text-on-accent)',
      }}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Ghost-bordered button. The "back out" affordance — Cancel / inline
 *  edit triggers / read-only secondary actions. */
export function SecondaryButton({
  type = 'button',
  loading = false,
  disabled,
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={`${BUTTON_BASE} ${sizeClasses(size)} bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] ${className}`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Destructive-confirm button. Reserve for the terminal step of a
 *  delete/remove flow (e.g. inside ConfirmDialog), NOT for row-hover
 *  trash icons — use `<IconButton variant="danger">` for those. */
export function DangerButton({
  type = 'button',
  loading = false,
  disabled,
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={`${BUTTON_BASE} ${sizeClasses(size)} ${className}`}
      style={{
        background: 'var(--accent-red-solid, #dc2626)',
        color: 'var(--text-on-accent, #ffffff)',
      }}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

type IconButtonVariant = 'neutral' | 'danger' | 'success' | 'warning';

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Required for screen readers — describes what the action does. */
  'aria-label': string;
  /** Hover tint family. Default 'neutral'. */
  variant?: IconButtonVariant;
  children: React.ReactNode;
};

/** Square icon-only button — row-hover Trash2, Pencil, Eye/EyeOff,
 *  collapse chevron, etc. The dominant pattern across the listing
 *  rows in every Settings section. */
export function IconButton({
  variant = 'neutral',
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  const hover =
    variant === 'danger'
      ? 'hover:bg-red-500/10 hover:text-[var(--accent-red-text)]'
      : variant === 'success'
        ? 'hover:bg-emerald-500/10 hover:text-[var(--accent-emerald-text)]'
        : variant === 'warning'
          ? 'hover:bg-amber-500/10 hover:text-[var(--accent-amber-text)]'
          : 'hover:bg-[var(--surface-inset-subtle)] hover:text-[var(--text-primary)]';
  return (
    <button
      {...rest}
      className={`p-1.5 rounded-lg text-[var(--text-dim)] transition-colors active:scale-[0.96] motion-reduce:active:scale-100 disabled:opacity-40 disabled:cursor-not-allowed ${hover} ${className}`}
    >
      {children}
    </button>
  );
}
