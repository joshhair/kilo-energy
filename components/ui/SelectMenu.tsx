'use client';

/**
 * SelectMenu — small animated dropdown for short option lists (≤8 items).
 *
 * # Why a portal (the actual fix vs the bandaid)
 *
 * The "absolute-positioned popup gets clipped or hidden" pattern bit us
 * twice already. Two root causes, neither solvable by raising z-index:
 *
 * 1. ANY ancestor with `overflow: hidden` clips an absolutely-positioned
 *    child. The notifications page has `rounded-xl overflow-hidden` on
 *    the per-category card (the clip is required for the rounded corner
 *    to apply to the inner list rows). z-index is irrelevant — clipping
 *    is geometric.
 *
 * 2. ANY ancestor with `transform`, `filter`, `backdrop-filter`,
 *    `opacity < 1`, `position: fixed/sticky`, `isolation: isolate`,
 *    `will-change: transform`, or `contain: layout/paint` creates a NEW
 *    stacking context. A descendant's z-index can only stack within its
 *    own context. The animate-fade-in-up class we use everywhere applies
 *    a transform — every page wrapped in it traps z-index inside.
 *
 * The only real fix is to render the panel OUTSIDE the trigger's DOM
 * subtree. createPortal mounts it under document.body, where it escapes
 * every clip and every stacking context. Position is computed from the
 * trigger's getBoundingClientRect and re-computed on scroll + resize.
 *
 * This pattern is the same one SearchableSelect uses (intentionally —
 * the team has converged on portals as the right answer for popups
 * across the app).
 *
 * # Visual
 *
 * Trigger and panel match the brand glass-frame pattern: surface-card
 * background, border-default outline, emerald accent on focus + hover,
 * rotating chevron on open. Panel uses the modal-panel enter animation
 * (8px lift + scale 0.97→1 + opacity fade, 180ms ease) for consistency
 * with SearchableSelect and modals across the app.
 */

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional secondary line shown under the label in smaller text. */
  sub?: string;
}

interface SelectMenuProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  options: SelectMenuOption<T>[];
  /** Aria label for the trigger. */
  ariaLabel: string;
  disabled?: boolean;
  /** Trigger container width passthrough — defaults to fit-content. */
  className?: string;
  /** Anchor the panel's right edge to the trigger's right edge.
   *  Useful when the trigger sits at the right side of a row and the
   *  panel might overflow the viewport on the right otherwise. */
  alignRight?: boolean;
}

export function SelectMenu<T extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  className,
  alignRight,
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Hydration guard — createPortal needs document.body which is undefined
  // during SSR. Render nothing for the panel until mount.
  useEffect(() => { setMounted(true); }, []);

  // ── Position: computed from the trigger's bounding rect, recomputed
  //    on scroll (capture: true catches scrolls inside any ancestor)
  //    and on resize. Using fixed positioning so the panel stays
  //    visually anchored to the trigger as the page scrolls.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const computePos = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Vertical: 6px gap below the trigger.
    const top = r.bottom + 6;
    // Horizontal: align trigger's left edge by default; right-align when
    // requested (panel right edge matches trigger right edge — handles
    // the "Cadence is rightmost cell of a row" case without overflowing
    // the viewport on the right).
    const left = alignRight ? r.right : r.left;
    setPos({ top, left, width: r.width });
  }, [alignRight]);

  useLayoutEffect(() => {
    if (!open) return;
    computePos();
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    const onAny = () => computePos();
    // capture: true so scrolls inside scrollable ancestors (e.g. a
    // scrollable settings card) also reposition the panel.
    window.addEventListener('scroll', onAny, { capture: true });
    window.addEventListener('resize', onAny);
    return () => {
      window.removeEventListener('scroll', onAny, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onAny);
    };
  }, [open, computePos]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlightIdx(-1);
  }, []);

  // Click-outside / Escape dismiss. The panel lives in a portal so we
  // can't rely on a single containerRef.contains check — we test BOTH
  // the trigger and the panel.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // When opening, highlight the currently selected option so keyboard
  // arrow nav has a starting point.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlightIdx(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  const handleSelect = (next: T) => {
    onChange(next);
    close();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[highlightIdx];
      if (opt) handleSelect(opt.value);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  return (
    <div className={`relative inline-block ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center justify-between gap-2 rounded-lg text-sm transition-all px-3 py-2
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald-solid)]/60
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent-emerald-solid)_8%,var(--surface-card))] hover:border-[color-mix(in_srgb,var(--accent-emerald-solid)_50%,var(--border-default))]'
          }`}
        style={{
          background: open
            ? 'color-mix(in srgb, var(--accent-emerald-solid) 8%, var(--surface-card))'
            : 'var(--surface-card)',
          color: 'var(--text-primary)',
          border: open
            ? '1px solid color-mix(in srgb, var(--accent-emerald-solid) 50%, var(--border-default))'
            : '1px solid var(--border-default)',
          minWidth: 148,
          boxShadow: open ? '0 0 0 3px color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)' : undefined,
        }}
      >
        <span className="truncate font-medium" style={{ fontSize: 13 }}>
          {selectedLabel}
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
          style={{
            color: open ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        />
      </button>

      {/* Portal escapes every ancestor's overflow + stacking context. */}
      {mounted && open && pos && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label={ariaLabel}
          className="animate-modal-panel"
          style={{
            position: 'fixed',
            top: pos.top,
            left: alignRight ? 'auto' : pos.left,
            right: alignRight ? `calc(100vw - ${pos.left}px)` : 'auto',
            // Width: at least as wide as the trigger, never narrower than
            // 180px (so labels like "Daily digest" don't squish).
            minWidth: Math.max(pos.width, 180),
            zIndex: 9999,
            background: 'var(--surface-card)',
            // Two-layer border so the emerald edge feels present without
            // a heavy 2px line: solid 1px outer, inset emerald glow.
            border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 22%, var(--border-default))',
            borderRadius: 12,
            // Multi-layer shadow: ambient drop + sharp ring + faint inner
            // highlight at the top (gives the panel a slight 3D lift on
            // dark backgrounds without looking heavy on light ones).
            boxShadow: [
              '0 18px 40px -12px rgba(0,0,0,0.55)',
              '0 4px 12px -4px rgba(0,0,0,0.30)',
              '0 0 0 1px rgba(255,255,255,0.04)',
              'inset 0 1px 0 0 color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)',
            ].join(', '),
            overflow: 'hidden',
            transformOrigin: alignRight ? 'top right' : 'top left',
          }}
        >
          <ul className="py-1">
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightIdx;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors"
                    style={{
                      background: isHighlighted
                        ? 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)'
                        : 'transparent',
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate"
                        style={{
                          fontSize: 13,
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                        {opt.label}
                      </div>
                      {opt.sub && (
                        <div
                          className="truncate"
                          style={{ fontSize: 11, color: 'var(--text-muted)' }}
                        >
                          {opt.sub}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check
                        className="w-3.5 h-3.5 flex-shrink-0"
                        style={{ color: 'var(--accent-emerald-text)' }}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
