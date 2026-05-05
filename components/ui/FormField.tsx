'use client';

/**
 * <FormField> — the label + input + error stack that wraps every form
 * input across the admin Settings panels.
 *
 * Replaces the `<div><label>…</label><input/></div>` boilerplate that
 * was reimplemented per-section with subtly different label sizes
 * (text-[10px] vs text-xs vs text-sm) and error rendering.
 *
 * Usage:
 *
 *   <FormField label="Email" error={validation.ok ? undefined : validation.reason}>
 *     <TextInput type="email" value={…} onChange={…} invalid={!validation.ok} />
 *   </FormField>
 *
 * Pass `hint` for non-error helper text shown below the input. Pass
 * `required` to render a small dot indicator next to the label — does
 * NOT add a `required` attribute to the underlying input; that's the
 * caller's job.
 */

import React from 'react';

type FormFieldProps = {
  label?: React.ReactNode;
  /** When set, renders below the input in red and supersedes `hint`. */
  error?: string;
  /** Helper text below the input (gray). Hidden when `error` is set. */
  hint?: React.ReactNode;
  /** Renders a small red dot next to the label. Visual only. */
  required?: boolean;
  /** Extra classes on the outer wrapper — for layout/flex sizing. */
  className?: string;
  children: React.ReactNode;
};

export function FormField({
  label,
  error,
  hint,
  required,
  className = '',
  children,
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-[10px] uppercase tracking-wide font-semibold text-[var(--text-muted)] flex items-center gap-1">
          <span>{label}</span>
          {required && <span aria-hidden className="text-[var(--accent-red-text)]">•</span>}
        </label>
      )}
      {children}
      {error
        ? <p className="text-[10px] text-[var(--accent-red-text)] mt-0.5" role="alert">{error}</p>
        : hint
          ? <p className="text-[10px] text-[var(--text-dim)] mt-0.5">{hint}</p>
          : null}
    </div>
  );
}
