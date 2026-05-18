'use client';

/**
 * SegmentedPills — single source of truth for segmented-row filters and
 * tab strips across the app. Replaces 13+ ad-hoc reimplementations that
 * had drifted into 4 different visual treatments (saturated emerald
 * fill, gradient-with-glow, light tint, underline-only).
 *
 * One look, two variants:
 *  - variant="pill"      (default) — slim rounded-full pill, soft
 *                                    accent tint + accent text on
 *                                    active, hairline border inactive.
 *                                    Matches My Pay / dashboard premium
 *                                    feel. Optional sliding indicator.
 *  - variant="underline"           — flat row, active item gets a
 *                                    bottom accent bar. Used for tab
 *                                    navigation (blitz detail, payroll
 *                                    status). No background fill.
 *
 * Feature flags:
 *  - scrollable: horizontal overflow + edge-mask + scroll-into-view-on-
 *                tap. Use for mobile rows with 5+ options.
 *  - showSlidingIndicator: animated background pill that interpolates
 *                between options. Default true for pill variant.
 *  - accent: 'emerald' | 'amber' — swaps the active color (training's
 *                amber filters need this).
 *  - size: 'sm' | 'md' (md = 40px tap target, sm = 32px for desktop).
 *  - options[].badge: number or short string shown as a chip next to
 *                the label (BlitzTabs pending count).
 *  - options[].disabled: greys out individual options.
 *
 * Centralizing here means the check:primitives gate can enforce zero
 * ad-hoc reimplementations going forward.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  badge?: number | string | null;
  disabled?: boolean;
}

export interface SegmentedPillsProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  variant?: 'pill' | 'underline';
  accent?: 'emerald' | 'amber';
  size?: 'sm' | 'md';
  scrollable?: boolean;
  showSlidingIndicator?: boolean;
  ariaLabel: string;
  className?: string;
}

interface AccentTokens {
  text: string;
  solid: string;
  // soft fill (background) and border (outline) for the active state
  softFill: string;
  border: string;
}

function getAccentTokens(accent: 'emerald' | 'amber'): AccentTokens {
  // Soft-fill % and border-mix % are tuned for legibility on BOTH
  // dark and light backgrounds. 14% emerald looked great in dark mode
  // but disappeared on white in light mode; 22% reads as a clear tint
  // in light mode without becoming saturated in dark.
  if (accent === 'amber') {
    return {
      text: 'var(--accent-amber-text)',
      solid: 'var(--accent-amber-solid)',
      softFill: 'color-mix(in srgb, var(--accent-amber-solid) 22%, transparent)',
      border: 'color-mix(in srgb, var(--accent-amber-solid) 55%, transparent)',
    };
  }
  return {
    text: 'var(--accent-emerald-text)',
    solid: 'var(--accent-emerald-solid)',
    softFill: 'color-mix(in srgb, var(--accent-emerald-solid) 22%, transparent)',
    border: 'color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)',
  };
}

export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  variant = 'pill',
  accent = 'emerald',
  size = 'md',
  scrollable = false,
  showSlidingIndicator,
  ariaLabel,
  className,
}: SegmentedPillsProps<T>) {
  const tokens = getAccentTokens(accent);
  const isPill = variant === 'pill';
  const slidingDefault = isPill;
  const useIndicator = showSlidingIndicator ?? slidingDefault;

  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Measure the active pill so the sliding background snaps to it.
  useLayoutEffect(() => {
    if (!useIndicator) return;
    const idx = options.findIndex((o) => o.value === value);
    const el = btnRefs.current[idx];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options, useIndicator]);

  // Scroll the active option into view on change. Quietly opted out
  // when the user prefers reduced motion.
  useEffect(() => {
    if (!scrollable) return;
    const idx = options.findIndex((o) => o.value === value);
    const el = btnRefs.current[idx];
    if (!el) return;
    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({
      behavior: prefersReduced ? 'instant' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [value, options, scrollable]);

  const minH = size === 'sm' ? 32 : 40;
  const paddingX = size === 'sm' ? 12 : 14;
  const fontSize = size === 'sm' ? 12 : 13;

  // Pill variant — rounded-full, optional sliding indicator behind the
  // active item, soft tint + accent text on the active option.
  if (isPill) {
    const row = (
      <div
        ref={containerRef}
        role="tablist"
        aria-label={ariaLabel}
        className={`relative flex gap-1.5 ${scrollable ? 'overflow-x-auto no-scrollbar' : 'flex-wrap'}`}
      >
        {useIndicator && indicator && (
          <span
            aria-hidden
            className="absolute top-0 h-full rounded-full pointer-events-none"
            style={{
              left: indicator.left,
              width: indicator.width,
              background: tokens.softFill,
              border: `1px solid ${tokens.border}`,
              transition: 'left 220ms cubic-bezier(0.34, 1.56, 0.64, 1), width 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        )}
        {options.map((opt, idx) => {
          const isActive = opt.value === value;
          const hasSliding = useIndicator;
          return (
            <button
              key={opt.value}
              ref={(el) => { btnRefs.current[idx] = el; }}
              role="tab"
              type="button"
              aria-selected={isActive}
              disabled={opt.disabled}
              onClick={() => { if (!opt.disabled) onChange(opt.value); }}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full whitespace-nowrap transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                minHeight: minH,
                padding: `0 ${paddingX}px`,
                fontSize,
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                fontWeight: isActive ? 600 : 500,
                letterSpacing: '0.01em',
                color: isActive ? tokens.text : 'var(--text-muted)',
                background: hasSliding ? 'transparent' : (isActive ? tokens.softFill : 'transparent'),
                border: hasSliding
                  ? (isActive ? 'none' : '1px solid var(--border-subtle)')
                  : (isActive ? `1px solid ${tokens.border}` : '1px solid var(--border-subtle)'),
                position: 'relative',
                zIndex: 1,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span>{opt.label}</span>
              {opt.badge != null && opt.badge !== '' && (
                <span
                  className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold leading-none"
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    background: isActive ? tokens.softFill : 'var(--surface-card)',
                    border: `1px solid ${isActive ? tokens.border : 'var(--border-subtle)'}`,
                    color: isActive ? tokens.text : 'var(--text-muted)',
                  }}
                >
                  {opt.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );

    // Scrollable variant: no edge-mask. The mask was fading the
    // leftmost pill when it was the active selection (e.g. "All"
    // sitting flush left). Without the mask the row chops cleanly at
    // the container edge, which reads as a clean affordance.
    return <div className={className}>{row}</div>;
  }

  // Underline variant — flat row, active gets a bottom accent bar.
  // Used for tab navigation surfaces (blitz detail, payroll status).
  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={`relative flex ${scrollable ? 'overflow-x-auto no-scrollbar' : ''}`}
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {options.map((opt, idx) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              ref={(el) => { btnRefs.current[idx] = el; }}
              role="tab"
              type="button"
              aria-selected={isActive}
              disabled={opt.disabled}
              onClick={() => { if (!opt.disabled) onChange(opt.value); }}
              className="relative shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-150 active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                minHeight: minH,
                padding: `0 ${paddingX + 2}px`,
                fontSize,
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? tokens.text : 'var(--text-muted)',
                background: 'transparent',
                border: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span>{opt.label}</span>
              {opt.badge != null && opt.badge !== '' && (
                <span
                  className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold leading-none"
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    background: tokens.softFill,
                    color: tokens.text,
                    border: `1px solid ${tokens.border}`,
                  }}
                >
                  {opt.badge}
                </span>
              )}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full"
                  // zIndex 0 keeps the indicator behind any sibling floating
                  // widgets (feedback bubble, scroll-to-top) that live at
                  // higher z-index but get rendered as DOM siblings on
                  // sticky tab strips.
                  style={{ background: tokens.solid, zIndex: 0 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
