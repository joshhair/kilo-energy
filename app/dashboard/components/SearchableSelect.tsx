'use client';

/**
 * SearchableSelect
 *
 * A universal searchable dropdown component for the Kilo Energy app.
 * Matches the dark-theme styling used by SetterPickerPopover — bg-[#1d2028],
 * border-[#272b35], rounded-xl — and supports search filtering, keyboard nav,
 * click-outside dismiss, and auto-scroll-to-selected.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional secondary line shown below the label in smaller text. */
  sub?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  error?: boolean;
  disabled?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable = true,
  className,
  error,
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [searchRaw, setSearchRaw] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);

  // 150 ms debounce for search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchRaw), 150);
    return () => clearTimeout(timer);
  }, [searchRaw]);

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  // Auto-scroll selected option into view when dropdown opens
  useEffect(() => {
    if (!open || !listRef.current || !value) return;
    requestAnimationFrame(() => {
      const selectedEl = listRef.current?.querySelector('[data-selected="true"]');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    });
  }, [open, value]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(-1);
  }, [searchQuery]);

  const closeDropdown = () => {
    setOpen(false);
    setSearchRaw('');
    setSearchQuery('');
    setHighlightIdx(-1);
  };

  // Portal dropdown position
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, { capture: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  // Click-outside and Escape dismiss
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      closeDropdown();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Filtered options
  const filtered = useMemo(() => {
    if (!searchQuery) return options;
    const q = searchQuery.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sub && o.sub.toLowerCase().includes(q)),
    );
  }, [options, searchQuery]);

  // Keyboard navigation inside the dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && highlightIdx < filtered.length) {
      e.preventDefault();
      handleSelect(filtered[highlightIdx].value);
    }
  };

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const handleSelect = (val: string) => {
    onChange(val);
    closeDropdown();
  };

  // Resolve selected label for the trigger
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div className={`relative ${open ? 'z-50' : ''} ${className ?? ''}`} ref={containerRef} onKeyDown={handleKeyDown}>
      {/* ── Trigger button ── */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? closeDropdown() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1d2028] border text-left transition-all text-sm
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e07a]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900
          input-focus-glow active:scale-[0.99]
          ${error ? 'border-red-500' : 'border-[#272b35]'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-indigo-500/60 hover:bg-[#272b35]/80 cursor-pointer'}`}
      >
        <span className={`flex-1 truncate ${selectedLabel ? 'text-white' : 'text-[#c2c8d8]'}`}>
          {selectedLabel ?? placeholder}
        </span>
        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-[#8891a8] flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Dropdown panel (portaled to body) ── */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] min-w-[200px] bg-[#1d2028] border border-[#272b35] rounded-xl shadow-xl shadow-black/40 overflow-hidden animate-modal-panel"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: Math.max(dropdownPos.width, 200) }}
          role="listbox"
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          {searchable && (
            <div className="p-2 border-b border-[#272b35]/60">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8] pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search…"
                  value={searchRaw}
                  onChange={(e) => setSearchRaw(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-[#161920] border border-[#272b35] text-white rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
                />
              </div>
            </div>
          )}

          <div className="max-h-52 overflow-y-auto" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[#8891a8] text-xs">
                No results found
              </div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected ? 'true' : undefined}
                    data-idx={idx}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors min-h-[40px] ${
                      isSelected
                        ? 'bg-indigo-600/10'
                        : ''
                    } ${isHighlighted ? 'bg-[#272b35]/50' : ''} hover:bg-[#272b35]/50`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm truncate block ${isSelected ? 'text-white font-medium' : 'text-[#c2c8d8]'}`}>
                        {opt.label}
                      </span>
                      {opt.sub && (
                        <span className="text-[10px] text-[#8891a8] truncate block">{opt.sub}</span>
                      )}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                  </button>
                );
              })
            )}
            {/* Bottom breathing room */}
            <div className="h-1" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
