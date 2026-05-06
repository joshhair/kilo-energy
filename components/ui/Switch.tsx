'use client';

/**
 * Switch — accessible binary toggle.
 *
 * Always clickable; the *server* is the source of truth on whether the
 * value can actually flip (e.g. enabling handoff requires a primary email
 * — server rejects with a clear error). We don't gate the click here
 * because the disabled-with-low-opacity pattern is too subtle and silently
 * swallows clicks, leading users to believe they toggled when they didn't.
 *
 * Visual: inline-style transform (not Tailwind translate-x-* classes) so
 * the animation is guaranteed to render — no JIT/purge surprises.
 */

import React from 'react';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** aria-label for screen readers — required since there's no visible label inside the switch. */
  ariaLabel: string;
  /** Visual size; `sm` is 36×20, default is 40×22. */
  size?: 'sm' | 'md';
  /** Optional id for label association. */
  id?: string;
}

export function Switch({ checked, onChange, ariaLabel, size = 'md', id }: Props) {
  const dims = size === 'sm'
    ? { track: { width: 36, height: 20 }, knob: 16, travel: 16 }
    : { track: { width: 40, height: 22 }, knob: 18, travel: 18 };
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative rounded-full cursor-pointer flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald-solid)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
      style={{
        width: dims.track.width,
        height: dims.track.height,
        backgroundColor: checked ? 'var(--accent-emerald-solid)' : 'var(--border)',
        transition: 'background-color 180ms ease',
      }}
    >
      <span
        aria-hidden="true"
        className="absolute rounded-full bg-white shadow-sm"
        style={{
          width: dims.knob,
          height: dims.knob,
          top: (dims.track.height - dims.knob) / 2,
          left: (dims.track.height - dims.knob) / 2,
          transform: `translateX(${checked ? dims.travel : 0}px)`,
          transition: 'transform 180ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </button>
  );
}
