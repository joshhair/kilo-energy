'use client';

/**
 * SelectMenu — small animated dropdown for short option lists (≤8 items).
 *
 * Visual + animation parity with SearchableSelect (the universal picker
 * used across the app): chevron rotation on open, modal-panel enter
 * animation (8px lift + scale 0.97→1 + opacity 0→1, 180ms ease), brand
 * glass-frame trigger, hover-tinted rows, emerald check on the selected
 * option. Stripped of the heavier features (search, portal, keyboard
 * paging) since this fits short lists like cadence (4 options) inline
 * inside a row.
 *
 * Click-outside dismisses. ArrowUp/Down navigates highlighted item;
 * Enter/Space selects; Esc closes. Tab leaves the trigger and closes
 * the menu (matches native <select> behavior).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
}

interface SelectMenuProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  options: SelectMenuOption<T>[];
  /** Aria label for the trigger when no visible label is adjacent. */
  ariaLabel: string;
  disabled?: boolean;
  /** Trigger container width — defaults to fit-content. */
  className?: string;
  /** When true, anchor the panel to the right edge of the trigger. */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setHighlightIdx(-1);
  }, []);

  // Click outside dismiss.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, close]);

  // When opening, highlight the currently selected option.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlightIdx(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  const handleSelect = (next: T) => {
    onChange(next);
    close();
    // Return focus to trigger so keyboard flow continues.
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
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
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
    <div
      ref={containerRef}
      className={`relative ${open ? 'z-30' : ''} ${className ?? ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className={`w-full inline-flex items-center justify-between gap-2 rounded-md text-sm transition-all px-3 py-1.5
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald-solid)]/60
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-[var(--accent-emerald-solid)]/40'}`}
        style={{
          background: 'var(--surface-pressed)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          minWidth: 132,
        }}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-150"
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute mt-1.5 rounded-lg overflow-hidden animate-modal-panel"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            boxShadow: '0 12px 32px -8px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.02)',
            minWidth: '100%',
            top: '100%',
            left: alignRight ? 'auto' : 0,
            right: alignRight ? 0 : 'auto',
            zIndex: 30,
          }}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === highlightIdx;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-sm"
                style={{
                  background: isHighlighted
                    ? 'color-mix(in srgb, var(--accent-emerald-solid) 10%, transparent)'
                    : 'transparent',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <span className="flex-1 truncate">{opt.label}</span>
                {isSelected && (
                  <Check
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: 'var(--accent-emerald-text)' }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
