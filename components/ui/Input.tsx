'use client';

/**
 * <TextInput> — the single text/number/date/email/tel input primitive
 * used across every Settings form.
 *
 * Why one primitive for all input types: the wrapper, focus ring,
 * border, padding, font size, and disabled handling are identical for
 * every type we use. The only thing that varies is the native `type`
 * attribute. Keeping these as one component prevents the styling drift
 * we saw before — different sections had `border-[var(--border)]` vs
 * `border-[var(--border-subtle)]`, `focus:ring-1` vs `focus:ring-2`,
 * `rounded-lg` vs `rounded-xl`, etc.
 *
 * For number-like inputs (rates, dollar amounts), pass type='number'
 * with `inputMode='decimal'` for mobile-friendly numeric keyboards.
 *
 * Pair with <FormField> when a label / error message is needed.
 */

import React from 'react';

type TextInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Standard HTML input types we actually use. Anything else gets a
   *  type-error to keep the surface area honest. */
  type?: 'text' | 'email' | 'date' | 'number' | 'tel' | 'password';
  /** When set, switches to error-tinted border. Pair with <FormField>'s
   *  `error` prop for the message stack. */
  invalid?: boolean;
};

export function TextInput({
  type = 'text',
  invalid = false,
  className = '',
  ...rest
}: TextInputProps) {
  return (
    <input
      {...rest}
      type={type}
      className={`w-full bg-[var(--surface-card)] border text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 placeholder-[var(--text-dim)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        invalid
          ? 'border-red-500 focus:ring-red-500'
          : 'border-[var(--border)] focus:ring-[var(--accent-emerald-solid)]'
      } ${className}`}
    />
  );
}
