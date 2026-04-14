'use client';

/**
 * SetterPickerPopover
 *
 * A reusable setter-selection control used on the New Deal form and, optionally,
 * anywhere else a setter needs to be picked from a list of reps.
 *
 * Props:
 *  - setterId        currently selected setter's id ('' = self-gen)
 *  - onChange        called with a rep id string when a setter is selected,
 *                    or '' when the selection is cleared (self-gen)
 *  - reps            full list of Rep objects from useApp()
 *  - trainerAssignments full list of TrainerAssignment objects from useApp()
 *  - excludeRepId    (optional) rep id to omit from the list (typically the closer)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, UserCircle2, X } from 'lucide-react';
import { Rep, TrainerAssignment } from '../../../lib/data';

interface SetterPickerPopoverProps {
  setterId: string;
  onChange: (repId: string) => void;
  reps: Rep[];
  trainerAssignments: TrainerAssignment[];
  excludeRepId?: string;
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
  if (repType === 'setter') return 'text-[var(--accent-green)]';
  return 'text-teal-400';
}

export function SetterPickerPopover({
  setterId,
  onChange,
  reps,
  trainerAssignments,
  excludeRepId,
}: SetterPickerPopoverProps) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** True if a rep appears as a trainee in any trainer assignment. */
  const isTrainee = (repId: string): boolean =>
    trainerAssignments.some((a) => a.traineeId === repId);

  // Currently-selected setter object (undefined if none selected or rep removed)
  const currentSetter = setterId ? reps.find((r) => r.id === setterId) ?? null : null;

  // Rep list: exclude the closer and the currently-selected setter (pinned separately)
  const filteredReps = reps
    .filter((r) => r.id !== excludeRepId && r.id !== setterId && r.repType !== 'closer' && r.active)
    .filter((r) =>
      searchQuery === '' || r.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

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
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] hover:border-indigo-500/60 hover:bg-[var(--border)]/80 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 active:scale-[0.99]"
      >
        {currentSetter ? (
          <>
            {/* Avatar initials */}
            <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
              {getInitials(currentSetter.name)}
            </span>
            <span className="flex-1 text-sm text-white font-medium truncate">
              {currentSetter.name}
            </span>
            {isTrainee(currentSetter.id) && (
              <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★ Trainee</span>
            )}
          </>
        ) : (
          <>
            <UserCircle2 className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />
            <span className="flex-1 text-sm text-[var(--text-secondary)]">Self gen (no setter)</span>
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
          className="fixed z-[9999] min-w-[240px] bg-[var(--surface-card)] border border-[var(--border)] rounded-xl shadow-xl shadow-black/40 overflow-hidden animate-modal-panel"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: Math.max(dropdownPos.width, 240) }}
          role="listbox"
          aria-label="Select setter"
        >
          {/* Search input */}
          <div className="p-2 border-b border-[var(--border)]/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search reps…"
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-[var(--surface)] border border-[var(--border)] text-white rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* ── Self-gen / clear option ── */}
            <button
              type="button"
              role="option"
              aria-selected={!setterId}
              onClick={() => handleSelect('')}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors min-h-[44px] ${
                !setterId
                  ? 'bg-indigo-600/10 hover:bg-indigo-600/20'
                  : 'hover:bg-[var(--border)]/50'
              }`}
            >
              <span className="w-7 h-7 rounded-full bg-[var(--border)] border border-[var(--border)] flex items-center justify-center flex-shrink-0">
                <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              </span>
              <span className="flex-1 text-sm text-[var(--text-secondary)] truncate">Self gen (no setter)</span>
              {!setterId && <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
            </button>

            {/* Divider */}
            <div className="mx-3 border-t border-[var(--border)]/60" />

            {/* ── Currently-selected setter pinned at top ── */}
            {currentSetter && (
              <>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Currently selected
                </p>
                <button
                  type="button"
                  role="option"
                  aria-selected={true}
                  onClick={() => handleSelect(currentSetter.id)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 bg-indigo-600/10 hover:bg-indigo-600/20 transition-colors min-h-[44px]"
                >
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                    {getInitials(currentSetter.name)}
                  </span>
                  <span className="flex-1 text-sm text-white font-medium truncate">{currentSetter.name}</span>
                  <span className={`${roleBadgeClass(currentSetter.repType)} text-[10px] font-medium flex-shrink-0`}>
                    {roleLabel(currentSetter.repType)}
                  </span>
                  {isTrainee(currentSetter.id) && (
                    <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★</span>
                  )}
                  <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                </button>
                <div className="mx-3 border-t border-[var(--border)]/60" />
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Reassign
                </p>
              </>
            )}

            {/* Section header when no setter yet */}
            {!currentSetter && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Select setter
              </p>
            )}

            {/* ── Rep list ── */}
            {filteredReps.length === 0 ? (
              <div className="px-3 py-4 text-center text-[var(--text-muted)] text-xs">
                No reps found
              </div>
            ) : (
              filteredReps.map((rep) => (
                <button
                  key={rep.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSelect(rep.id)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-indigo-600/20 transition-colors min-h-[44px]"
                >
                  {/* Initials avatar */}
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                    {getInitials(rep.name)}
                  </span>
                  <span className="flex-1 text-sm text-[var(--text-secondary)] hover:text-white truncate">{rep.name}</span>
                  {/* Role badge */}
                  <span className={`${roleBadgeClass(rep.repType)} text-[10px] font-medium flex-shrink-0`}>
                    {roleLabel(rep.repType)}
                  </span>
                  {/* Trainee star */}
                  {isTrainee(rep.id) && (
                    <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★</span>
                  )}
                </button>
              ))
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
