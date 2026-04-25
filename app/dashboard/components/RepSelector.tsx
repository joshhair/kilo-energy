'use client';

/**
 * RepSelector
 *
 * A compact, searchable drop-in replacement for native <select> elements that
 * display a list of reps. Follows the same pattern as SetterPickerPopover but
 * is shorter (standard dropdown height) and works for any rep selection need.
 *
 * Props:
 *  - value          currently selected rep id ('' = none)
 *  - onChange        called with rep id when selected, or '' when cleared
 *  - reps           full list of Rep objects
 *  - placeholder     placeholder text when no rep selected (default: "— Select rep —")
 *  - clearLabel      label for the clear/none option (default: "None")
 *  - filterFn        optional predicate to pre-filter the rep list
 *  - renderExtra     optional fn to render extra info after rep name in each row
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, UserCircle2, X } from 'lucide-react';
import { Rep } from '../../../lib/data';
import { sortForSelection } from '../../../lib/sorting';

interface RepSelectorProps {
  value: string;
  onChange: (repId: string) => void;
  reps: Rep[];
  placeholder?: string;
  clearLabel?: string;
  filterFn?: (rep: Rep) => boolean;
  renderExtra?: (rep: Rep) => React.ReactNode;
}

/** Build 1-2 letter initials from a full name. */
function getInitials(name: string): string {
  if (!name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Maps a repType to a human-readable role label. */
function roleLabel(repType: Rep['repType']): string {
  if (repType === 'closer') return 'Closer';
  if (repType === 'setter') return 'Setter';
  return 'Both';
}

/** Tailwind colour class for the role badge. */
function roleBadgeClass(repType: Rep['repType']): string {
  if (repType === 'closer') return 'text-purple-400';
  if (repType === 'setter') return 'text-[var(--accent-emerald-solid)]';
  return 'text-teal-400';
}

export function RepSelector({
  value,
  onChange,
  reps,
  placeholder = '— Select rep —',
  clearLabel = 'None',
  filterFn,
  renderExtra,
}: RepSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchRaw, setSearchRaw] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // 150 ms debounce for the search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchRaw), 150);
    return () => clearTimeout(timer);
  }, [searchRaw]);

  // Auto-focus search input when popover opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  /** Close the popover and reset search state. */
  const closePopover = () => {
    setOpen(false);
    setSearchRaw('');
    setSearchQuery('');
  };

  // Portal dropdown position
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
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

  // Dismiss on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      closePopover();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
   
  }, [open]);

  // Apply optional filter, then search filter. Ordering: active-only
  // alphabetical by first name via the canonical sortForSelection helper
  // (see lib/sorting.ts). The filterFn runs first since callers sometimes
  // use it to gate by role; the helper's active-check is redundant for
  // already-filtered lists but cheap and defensive.
  const baseReps = sortForSelection(filterFn ? reps.filter(filterFn) : reps);
  const filteredReps = baseReps.filter(
    (r) => searchQuery === '' || r.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Currently-selected rep object
  const currentRep = value ? reps.find((r) => r.id === value) ?? null : null;

  const handleSelect = (repId: string) => {
    onChange(repId);
    closePopover();
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* ── Trigger button ── */}
      <button
        type="button"
        onClick={() => (open ? closePopover() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] hover:border-indigo-500/60 hover:bg-[var(--border)]/80 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 active:scale-[0.99]"
      >
        {currentRep ? (
          <>
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 select-none">
              {getInitials(currentRep.name)}
            </span>
            <span className="flex-1 text-sm text-white font-medium truncate">
              {currentRep.name}
            </span>
            <span className={`${roleBadgeClass(currentRep.repType)} text-[10px] font-medium flex-shrink-0`}>
              {roleLabel(currentRep.repType)}
            </span>
          </>
        ) : (
          <>
            <UserCircle2 className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <span className="flex-1 text-sm text-[var(--text-secondary)]">{placeholder}</span>
          </>
        )}
        {/* Chevron indicator */}
        <svg
          className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Dropdown panel (portaled) ── */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] min-w-[220px] bg-[var(--surface-card)] border border-[var(--border)] rounded-xl shadow-xl shadow-black/40 overflow-hidden animate-modal-panel"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: Math.max(dropdownPos.width, 220) }}
          role="listbox"
          aria-label="Select rep"
        >
          {/* Search input */}
          <div className="p-1.5 border-b border-[var(--border)]/60">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search reps…"
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-[var(--surface)] border border-[var(--border)] text-white rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
              />
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto">
            {/* ── Clear / none option ── */}
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => handleSelect('')}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                !value
                  ? 'bg-indigo-600/10 hover:bg-indigo-600/20'
                  : 'hover:bg-[var(--border)]/50'
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-[var(--border)] border border-[var(--border)] flex items-center justify-center flex-shrink-0">
                <X className="w-3 h-3 text-[var(--text-secondary)]" />
              </span>
              <span className="flex-1 text-sm text-[var(--text-secondary)] truncate">{clearLabel}</span>
              {!value && <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
            </button>

            {/* Divider */}
            <div className="mx-3 border-t border-[var(--border)]/60" />

            {/* ── Rep list ── */}
            {filteredReps.length === 0 ? (
              <div className="px-3 py-3 text-center text-[var(--text-muted)] text-xs">
                No reps found
              </div>
            ) : (
              filteredReps.map((rep) => (
                <button
                  key={rep.id}
                  type="button"
                  role="option"
                  aria-selected={rep.id === value}
                  onClick={() => handleSelect(rep.id)}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                    rep.id === value
                      ? 'bg-indigo-600/10 hover:bg-indigo-600/20'
                      : 'hover:bg-[var(--border)]/50'
                  }`}
                >
                  {/* Initials avatar */}
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 select-none">
                    {getInitials(rep.name)}
                  </span>
                  <span className="flex-1 text-sm text-[var(--text-secondary)] truncate">{rep.name}</span>
                  {/* Extra content from caller */}
                  {renderExtra && renderExtra(rep)}
                  {/* Role badge */}
                  <span className={`${roleBadgeClass(rep.repType)} text-[10px] font-medium flex-shrink-0`}>
                    {roleLabel(rep.repType)}
                  </span>
                  {rep.id === value && <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                </button>
              ))
            )}

            {/* Bottom breathing room */}
            <div className="h-0.5" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
