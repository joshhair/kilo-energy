'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../../lib/context';
import { useTableKeyNav } from '../../../../lib/hooks';
import { PHASES, Phase, Rep, TrainerAssignment } from '../../../../lib/data';
import { formatDate, downloadCSV } from '../../../../lib/utils';
import { Search, Flag, X, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, UserPlus, ArrowLeftRight, Check, ArrowRight, Download } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import { PaginationBar } from '../../components/PaginationBar';
import ConfirmDialog from '../../components/ConfirmDialog';
import { PhaseBadge, StaleBadge, PIPELINE_PHASES, relativeTime, type ProjectList } from './shared';

// ─── Setter Popover ───────────────────────────────────────────────────────────

function SetterPopover({
  projectId,
  customerName,
  currentSetterId,
  currentSetterName,
  reps,
  trainerAssignments,
  setProjects,
  updateProject,
}: {
  projectId: string;
  customerName: string;
  currentSetterId?: string;
  currentSetterName?: string;
  reps: Rep[];
  trainerAssignments: TrainerAssignment[];
  setProjects: React.Dispatch<React.SetStateAction<ProjectList>>;
  updateProject: ReturnType<typeof useApp>['updateProject'];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchRaw, setSearchRaw] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // 150 ms debounce for the rep search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchRaw), 150);
    return () => clearTimeout(timer);
  }, [searchRaw]);

  // Focus search input whenever the popover opens
  useEffect(() => {
    if (open) {
      // Defer so the element is in the DOM
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  /** Close the popover and reset search state (called from event handlers, not effects). */
  const closePopover = () => {
    setOpen(false);
    setSearchRaw('');
    setSearchQuery('');
  };

  // Compute portal dropdown position aligned to the right edge of the trigger
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
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

  // Dismiss on outside click or Escape
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

  const handleAssign = (rep: Rep) => {
    updateProject(projectId, { setterId: rep.id, setterName: rep.name });
    toast(`Setter assigned: ${rep.name}`, 'success');
    closePopover();
  };

  /** Build 1-2 letter initials from a full name. */
  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  /** True if a rep appears as a trainee in any trainer assignment. */
  const isTrainee = (repId: string): boolean =>
    trainerAssignments.some((a) => a.traineeId === repId);

  // Currently-assigned rep object (may be undefined if rep was removed)
  const currentSetter = currentSetterId ? reps.find((r) => r.id === currentSetterId) ?? null : null;

  // Apply search filter; exclude closers and the current setter (shown pinned at top)
  const otherReps = reps
    .filter((r) => r.active)
    .filter((r) => r.id !== currentSetterId)
    .filter((r) => r.repType !== 'closer')
    .filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* ── Trigger button ── */}
      <button
        onClick={(e) => { e.stopPropagation(); if (open) { closePopover(); } else { setOpen(true); } }}
        title={currentSetterId ? `Reassign setter for ${customerName}` : `Assign a setter to ${customerName}`}
        className="relative inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--border)] hover:bg-indigo-600 text-[var(--text-secondary)] hover:text-white text-xs font-medium transition-all active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap"
        aria-label={currentSetterId ? 'Reassign setter' : 'Assign setter'}
        aria-expanded={open}
      >
        {/* Pulsing indigo attention dot — only when no setter is assigned */}
        {!currentSetterId && (
          <span
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse"
            aria-hidden="true"
          />
        )}
        {currentSetterId ? (
          <>
            <ArrowLeftRight className="w-3 h-3 flex-shrink-0" />
            <span className="max-w-[96px] truncate">{currentSetterName ?? 'Setter'}</span>
          </>
        ) : (
          <>
            <UserPlus className="w-3 h-3 flex-shrink-0" />
            Assign Setter
          </>
        )}
      </button>

      {/* ── Dropdown popover (portaled to escape overflow-auto table container) ── */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-64 bg-[var(--surface-card)] border border-[var(--border)] rounded-xl shadow-xl shadow-black/40 overflow-hidden animate-modal-panel"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-[var(--border)]/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search reps..."
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-[var(--surface)] border border-[var(--border)] text-white rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* ── Currently-assigned setter pinned at top ── */}
            {currentSetter && (
              <>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Currently assigned
                </p>
                <button
                  disabled
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors min-h-[44px] cursor-default"
                >
                  {/* Initials avatar */}
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                    {getInitials(currentSetter.name)}
                  </span>
                  <span className="flex-1 text-sm text-white font-medium truncate">{currentSetter.name}</span>
                  {/* Role badge */}
                  {isTrainee(currentSetter.id)
                    ? <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★ Trainee</span>
                    : <span className="text-[var(--accent-green)] text-[10px] font-medium flex-shrink-0">Setter</span>
                  }
                  {/* Green checkmark */}
                  <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                </button>
                {/* Divider + "Reassign" label */}
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
            {otherReps.length === 0 ? (
              <div className="px-3 py-4 text-center text-[var(--text-muted)] text-xs">
                No reps found
              </div>
            ) : (
              otherReps.map((rep) => (
                <button
                  key={rep.id}
                  onClick={(e) => { e.stopPropagation(); handleAssign(rep); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-indigo-600/20 transition-colors min-h-[44px]"
                >
                  {/* Initials avatar */}
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                    {getInitials(rep.name)}
                  </span>
                  <span className="flex-1 text-sm text-[var(--text-secondary)] hover:text-white truncate">{rep.name}</span>
                  {/* Role badge */}
                  {isTrainee(rep.id)
                    ? <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★ Trainee</span>
                    : <span className="text-[var(--accent-green)] text-[10px] font-medium flex-shrink-0">Setter</span>
                  }
                </button>
              ))
            )}

            {/* Spacer at bottom for breathing room */}
            <div className="h-1" />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Sort helpers ────────────────────────────────────────────────────────────

type SortKey = 'customerName' | 'repName' | 'phase' | 'installer' | 'financer' | 'kWSize' | 'netPPW' | 'soldDate';
type SortDirection = 'asc' | 'desc';

function SortIcon({ colKey, sortKey, sortDirection }: { colKey: SortKey; sortKey: SortKey; sortDirection: SortDirection }) {
  if (sortKey !== colKey) return <ChevronsUpDown className="w-3.5 h-3.5 ml-1 inline-block text-[var(--text-dim)]" />;
  if (sortDirection === 'asc') return <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" />;
  return <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />;
}

// ─── TableView ───────────────────────────────────────────────────────────────

export default function TableView({
  projects,
  searchInput,
  setSearchInput,
  isAdmin,
  currentRepId,
  dealScope,
  onPhaseChange,
  setProjects,
  hasActiveFilters,
  clearAllFilters,
  readOnly = false,
  hideFinancials = false,
}: {
  projects: ProjectList;
  searchInput: string;
  setSearchInput: (s: string) => void;
  isAdmin: boolean;
  currentRepId: string | null;
  dealScope: 'mine' | 'all';
  onPhaseChange: (id: string, phase: Phase, silent?: boolean) => void;
  setProjects: React.Dispatch<React.SetStateAction<ProjectList>>;
  hasActiveFilters: boolean;
  clearAllFilters: () => void;
  readOnly?: boolean;
  hideFinancials?: boolean;
}) {
  const { reps, trainerAssignments, updateProject } = useApp();
  const { toast } = useToast();
  const tableRouter = useRouter();
  const tableSearchParams = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const VALID_SORT_KEYS: SortKey[] = ['customerName', 'repName', 'phase', 'installer', 'financer', 'kWSize', 'netPPW', 'soldDate'];
    const v = tableSearchParams.get('sort') as SortKey | null;
    return v && VALID_SORT_KEYS.includes(v) ? v : 'soldDate';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const v = tableSearchParams.get('dir');
    return v === 'asc' ? 'asc' : 'desc';
  });

  // Sync sort to URL (read current params to preserve other filters)
  useEffect(() => {
    // Skip if the URL already reflects the current sort state — avoids overwriting
    // the parent's concurrent router.replace when both effects fire on initial mount.
    const currentSort = tableSearchParams.get('sort') ?? 'soldDate';
    const currentDir = tableSearchParams.get('dir') ?? 'desc';
    if (currentSort === sortKey && currentDir === sortDirection) return;
    const params = new URLSearchParams(window.location.search);
    if (sortKey !== 'soldDate') params.set('sort', sortKey); else params.delete('sort');
    if (sortDirection !== 'desc') params.set('dir', sortDirection); else params.delete('dir');
    const qs = params.toString();
    tableRouter.replace(qs ? `?${qs}` : '/dashboard/projects', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDirection]);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // ── Table row keyboard navigation ──────────────────────────────────────────
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  useTableKeyNav(tbodyRef);

  // ── Keyboard shortcut: '/' focuses the search input ──────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Keyboard shortcut: ArrowLeft / ArrowRight for pagination ──────────────
  useEffect(() => {
    const handlePageNav = (e: KeyboardEvent) => {
      // Skip when an input, select, or textarea is focused
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;
      // Skip when a dialog/modal is open (e.g. bulk phase confirm)
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) return;
      if (e.key === 'ArrowLeft') {
        setCurrentPage((p) => Math.max(1, p - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentPage((p) => Math.min(Math.max(1, Math.ceil(projects.length / rowsPerPage)), p + 1));
      }
    };
    document.addEventListener('keydown', handlePageNav);
    return () => document.removeEventListener('keydown', handlePageNav);
  }, [projects.length, rowsPerPage]);

  // ── Bulk selection state (admin only) ──────────────────────────────────────
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const showActionBar = isAdmin && !readOnly && selectedProjectIds.size > 0;

  // Escape key → deselect all selected projects
  useEffect(() => {
    if (!isAdmin) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedProjectIds(new Set());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAdmin]);

  // Reset to page 1 when the upstream projects list changes identity (i.e. the
  // parent's search / status / installer filter changed).  Calling setState
  // during render (when a prop changes) is the React-recommended alternative to
  // a useEffect that would trigger a second render anyway.
  const [prevProjects, setPrevProjects] = useState(projects);
  if (projects !== prevProjects) {
    setPrevProjects(projects);
    setCurrentPage(1);
    setSelectedProjectIds(new Set());
  }

  const handleSort = (key: SortKey) => {
    // Reset to page 1 so the user sees results from the top after re-sorting.
    setCurrentPage(1);
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'customerName':
        case 'repName':
        case 'installer':
        case 'financer':
          cmp = (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '');
          break;
        case 'phase':
          cmp = PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase);
          break;
        case 'kWSize':
        case 'netPPW':
          cmp = a[sortKey] - b[sortKey];
          break;
        case 'soldDate':
          cmp = (a.soldDate ?? '').localeCompare(b.soldDate ?? '');
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [projects, sortKey, sortDirection]);

  const totalResults = sortedProjects.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, totalResults);
  const pagedProjects = sortedProjects.slice(startIdx, endIdx);

  // ── Bulk selection helpers (depend on pagedProjects) ─────────────────────
  const allPageSelected = isAdmin && pagedProjects.length > 0 && pagedProjects.every((p) => selectedProjectIds.has(p.id));

  const toggleProject = (id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllProjects = () => {
    const pageIds = pagedProjects.map((p) => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedProjectIds.has(id));
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleBulkAdvance = () => {
    let advanced = 0;
    selectedProjectIds.forEach((id) => {
      const proj = projects.find((p) => p.id === id);
      if (!proj) return;
      const phaseIdx = PIPELINE_PHASES.indexOf(proj.phase);
      const nextPhase = (phaseIdx >= 0 && phaseIdx < PIPELINE_PHASES.length - 1) ? PIPELINE_PHASES[phaseIdx + 1] : undefined;
      if (nextPhase) {
        onPhaseChange(id, nextPhase, true);
        advanced++;
      }
    });
    setSelectedProjectIds(new Set());
    if (advanced > 0) {
      toast(`${advanced} project${advanced > 1 ? 's' : ''} advanced to next phase`, 'success');
    } else {
      toast('No projects advanced — selected projects may be Cancelled, On Hold, or already at the final phase', 'error');
    }
  };

  // Derived selection stats — used by the floating action bar
  const selectedFlaggedCount = [...selectedProjectIds].filter((id) => projects.find((p) => p.id === id)?.flagged).length;
  const bulkFlagLabel = selectedFlaggedCount > selectedProjectIds.size / 2 ? 'Unflag' : 'Flag';
  const selectedTotalKw = [...selectedProjectIds].reduce((sum, id) => {
    const p = projects.find((proj) => proj.id === id);
    return sum + (p?.kWSize ?? 0);
  }, 0);
  const [bulkPhaseTarget, setBulkPhaseTarget] = useState<Phase | ''>('');

  const handleBulkFlag = () => {
    const shouldFlag = bulkFlagLabel === 'Flag';
    selectedProjectIds.forEach((id) => {
      updateProject(id, { flagged: shouldFlag });
    });
    const count = selectedProjectIds.size;
    toast(`${count} project${count > 1 ? 's' : ''} ${shouldFlag ? 'flagged' : 'unflagged'}`, 'success');
    setSelectedProjectIds(new Set());
  };

  // Bulk change phase — with ConfirmDialog for destructive phases
  const [bulkConfirm, setBulkConfirm] = useState<{ phase: Phase; count: number } | null>(null);

  // Bulk cancellation reason modal state (mirrors the single-project cancel reason modal)
  const [bulkCancelReasonModal, setBulkCancelReasonModal] = useState<{ count: number } | null>(null);
  const [bulkCancelReason, setBulkCancelReason] = useState('');
  const [bulkCancelNotes, setBulkCancelNotes] = useState('');

  const handleBulkChangePhase = (targetPhase: Phase) => {
    if (targetPhase === 'Cancelled') {
      setBulkCancelReason('');
      setBulkCancelNotes('');
      setBulkCancelReasonModal({ count: selectedProjectIds.size });
      setBulkPhaseTarget('');
      return;
    }
    if (targetPhase === 'On Hold') {
      setBulkConfirm({ phase: targetPhase, count: selectedProjectIds.size });
      setBulkPhaseTarget('');
      return;
    }
    executeBulkPhaseChange(targetPhase);
  };

  const confirmBulkCancelWithReason = () => {
    if (!bulkCancelReasonModal) return;
    if (!bulkCancelReason) {
      toast('Please select a cancellation reason.', 'error');
      return;
    }
    const count = selectedProjectIds.size;
    selectedProjectIds.forEach((id) => {
      updateProject(id, {
        phase: 'Cancelled',
        cancellationReason: bulkCancelReason || undefined,
        cancellationNotes: bulkCancelNotes || undefined,
      } as Partial<typeof projects[0]>);
    });
    toast(`${count} project${count > 1 ? 's' : ''} moved to Cancelled`, 'info');
    setSelectedProjectIds(new Set());
    setBulkPhaseTarget('');
    setBulkCancelReasonModal(null);
  };

  const executeBulkPhaseChange = (targetPhase: Phase) => {
    const count = selectedProjectIds.size;
    if (targetPhase === 'On Hold') {
      // onPhaseChange opens a per-project setPhaseConfirm modal and returns early,
      // so bulk 'On Hold' must call updateProject directly (bulkConfirm already confirmed).
      selectedProjectIds.forEach((id) => {
        updateProject(id, { phase: 'On Hold' });
      });
    } else {
      selectedProjectIds.forEach((id) => {
        onPhaseChange(id, targetPhase, true);
      });
    }
    setSelectedProjectIds(new Set());
    setBulkPhaseTarget('');
    setBulkConfirm(null);
    toast(`${count} project${count > 1 ? 's' : ''} moved to ${targetPhase}`, 'success');
  };

  function thClass(colKey: SortKey) {
    const active = sortKey === colKey;
    return `text-left px-5 py-3 font-medium cursor-pointer select-none transition-colors hover:text-white ${
      active ? 'text-white' : 'text-[var(--text-secondary)]'
    }`;
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 md:gap-3 mb-4">
        <div className="relative flex-1 max-w-full md:max-w-xs min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search customers, reps, phases..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full rounded-xl pl-9 pr-8 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-slate-500"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          {/* Clear button — shown when there is a search query */}
          {searchInput ? (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-white transition-colors"
              aria-label="Clear search input"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            /* '/' shortcut hint — shown when input is empty and not focused */
            !searchFocused && (
              <kbd
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 px-1.5 rounded border border-[var(--border)] bg-[var(--border)]/60 text-[var(--text-secondary)] font-mono text-[11px] leading-none select-none"
                aria-hidden="true"
              >
                /
              </kbd>
            )
          )}
        </div>
        {/* Inline row-count summary — gives instant feedback on the current page slice */}
        {searchInput.trim() && (
          <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full">{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
        )}
        <span className="text-[var(--text-muted)] text-sm">
          {totalResults === 0
            ? 'No results'
            : `Showing ${startIdx + 1}–${endIdx} of ${totalResults}`}
        </span>
        {isAdmin && !hideFinancials && sortedProjects.length > 0 && (
          <button
            onClick={() => {
              const headers = ['Customer', 'Rep', 'Phase', 'Installer', 'Financer', 'kW', 'Net PPW', 'Sold Date', 'Flagged'];
              const rows = sortedProjects.map((p) => [
                p.customerName,
                p.repName,
                p.phase,
                p.installer,
                p.financer,
                p.kWSize.toString(),
                `$${p.netPPW.toFixed(2)}`,
                formatDate(p.soldDate),
                p.flagged ? 'Yes' : 'No',
              ]);
              downloadCSV(`projects-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] px-3 py-1.5 rounded-lg transition-colors"
            title="Download filtered projects as CSV"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        )}
      </div>

      {/* ── Mobile card view (below md) ──────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {pagedProjects.length === 0 && (
          <div className="card-surface rounded-2xl px-5 py-12 text-center">
            <p className="text-[var(--text-secondary)] text-sm">
              {hasActiveFilters ? 'No projects match your filters.' : 'No projects yet.'}
            </p>
          </div>
        )}
        {pagedProjects.map((proj) => (
          <Link key={proj.id} href={`/dashboard/projects/${proj.id}`}>
            <div className={`card-surface rounded-xl p-3 md:p-4 active:scale-[0.98] transition-transform min-h-[44px] ${proj.flagged ? 'border-l-2 border-l-red-500' : ''}`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-white font-medium text-sm flex items-center gap-1.5">
                  {proj.customerName}
                  {proj.flagged && <Flag className="w-3 h-3 text-red-400" />}
                </span>
                <PhaseBadge phase={proj.phase} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                <span>{proj.kWSize} kW</span>
                <span>{proj.installer}</span>
                <span>{relativeTime(proj.soldDate)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Mobile pagination */}
      <div className="md:hidden">
        <PaginationBar
          totalResults={totalResults} startIdx={startIdx} endIdx={endIdx}
          currentPage={safeCurrentPage} totalPages={totalPages} rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage} onRowsPerPageChange={(n) => { setRowsPerPage(n); setCurrentPage(1); }}
        />
      </div>

      {/* ── Desktop table view (md+) ─────────────────────────────────── */}
      <div className="hidden md:block card-surface rounded-2xl overflow-x-auto scroll-smooth">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-card)' }}>
              <tr>
                {isAdmin && !readOnly && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleAllProjects}
                      className="accent-[var(--accent-green)] w-4 h-4 rounded cursor-pointer"
                      aria-label="Select all projects on this page"
                    />
                  </th>
                )}
                <th className={thClass('customerName')} onClick={() => handleSort('customerName')}>
                  Customer<SortIcon colKey="customerName" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                {(isAdmin || (!isAdmin && dealScope === 'all')) && (
                  <th className={thClass('repName')} onClick={() => handleSort('repName')}>
                    Rep<SortIcon colKey="repName" sortKey={sortKey} sortDirection={sortDirection} />
                  </th>
                )}
                <th className={thClass('phase')} onClick={() => handleSort('phase')}>
                  Phase<SortIcon colKey="phase" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                <th className={thClass('installer')} onClick={() => handleSort('installer')}>
                  Installer<SortIcon colKey="installer" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                <th className={thClass('financer')} onClick={() => handleSort('financer')}>
                  Financer<SortIcon colKey="financer" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                <th className={thClass('kWSize')} onClick={() => handleSort('kWSize')}>
                  kW<SortIcon colKey="kWSize" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                {!hideFinancials && (
                  <th className={thClass('netPPW')} onClick={() => handleSort('netPPW')}>
                    Net PPW<SortIcon colKey="netPPW" sortKey={sortKey} sortDirection={sortDirection} />
                  </th>
                )}
                <th className={thClass('soldDate')} onClick={() => handleSort('soldDate')}>
                  Sold Date<SortIcon colKey="soldDate" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                {isAdmin && !readOnly && (
                  <th className="text-left px-5 py-3 font-medium text-[var(--text-secondary)] select-none whitespace-nowrap">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {pagedProjects.map((proj, i) => {
                const myRole = !isAdmin
                  ? (proj.repId === currentRepId ? 'Closer' : proj.setterId === currentRepId ? 'Setter' : null)
                  : null;
                const isMyRow = myRole !== null && dealScope === 'all';
                return (
                  <tr
                    key={proj.id}
                    tabIndex={0}
                    role="row"
                    onClick={() => { try { sessionStorage.setItem('kilo-project-nav', JSON.stringify(sortedProjects.map((p) => p.id))); } catch {} tableRouter.push(`/dashboard/projects/${proj.id}`); }}
                  className={`group table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/60 focus-visible:ring-inset`}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: selectedProjectIds.has(proj.id)
                      ? 'rgba(77,159,255,0.08)'
                      : i % 2 === 0 ? 'var(--surface)' : '#191c24',
                    borderLeft: proj.flagged
                      ? '3px solid var(--accent-red)'
                      : isMyRow
                        ? '3px solid var(--accent-blue)'
                        : undefined,
                  }}
                >
                  {isAdmin && !readOnly && (
                    <td className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.has(proj.id)}
                        onChange={() => toggleProject(proj.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-[var(--accent-green)] w-4 h-4 rounded cursor-pointer"
                        aria-label={`Select ${proj.customerName}`}
                      />
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/projects/${proj.id}`}
                      className="text-white hover:text-[var(--accent-green)] transition-colors flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {proj.customerName}
                      {proj.flagged && <Flag className="w-3 h-3 text-red-400" />}
                      <StaleBadge soldDate={proj.soldDate} phase={proj.phase} />
                    </Link>
                  </td>
                  {isAdmin && <td className="px-5 py-3 text-[var(--text-secondary)]">{proj.repName}</td>}
                  {/* Rep name cell for reps in All Deals mode — shows "You" pill + bold name on own rows */}
                  {!isAdmin && dealScope === 'all' && (
                    <td className="px-5 py-3">
                      <span className={`flex items-center gap-1.5 ${isMyRow ? 'text-[var(--text-secondary)] font-semibold' : 'text-[var(--text-secondary)]'}`}>
                        {proj.repName}
                        {isMyRow && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none ${
                            myRole === 'Closer'
                              ? 'bg-blue-900/60 text-[var(--accent-cyan)] border border-[var(--accent-green)]/40'
                              : 'bg-emerald-900/60 text-emerald-300 border border-[var(--accent-green)]/40'
                          }`}>
                            You · {myRole}
                          </span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className="px-5 py-3">
                    {isAdmin && !readOnly ? (
                      <select
                        value={proj.phase}
                        onChange={(e) => onPhaseChange(proj.id, e.target.value as Phase)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                      >
                        {PHASES.map((ph) => (
                          <option key={ph} value={ph}>{ph}</option>
                        ))}
                      </select>
                    ) : (
                      <PhaseBadge phase={proj.phase} />
                    )}
                  </td>
                  <td className="px-5 py-3 text-[var(--text-secondary)]">{proj.installer}</td>
                  <td className="px-5 py-3 text-[var(--text-secondary)]">{proj.financer}</td>
                  <td className="px-5 py-3 text-[var(--text-secondary)]">{proj.kWSize}</td>
                  {!hideFinancials && <td className="px-5 py-3" style={{ color: 'var(--accent-green)', fontFamily: "'DM Serif Display', serif" }}>${proj.netPPW.toFixed(2)}</td>}
                  <td className="px-5 py-3 text-[var(--text-muted)]">
                    <div>{formatDate(proj.soldDate)}</div>
                    <div className="text-[10px] text-[var(--text-dim)]">{relativeTime(proj.soldDate)}</div>
                  </td>
                  {isAdmin && !readOnly && (() => {
                    const phaseIdx = PIPELINE_PHASES.indexOf(proj.phase);
                    const nextPhase = (phaseIdx >= 0 && phaseIdx < PIPELINE_PHASES.length - 1) ? PIPELINE_PHASES[phaseIdx + 1] : undefined;
                    return (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Phase-advance quick-action — fades in on row hover (identical to Kanban card behaviour) */}
                          {nextPhase && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onPhaseChange(proj.id, nextPhase); }}
                              title={`Advance to ${nextPhase}`}
                              className="opacity-40 group-hover:opacity-100 transition-opacity duration-150 inline-flex items-center justify-center w-6 h-6 rounded-md bg-[var(--border)] hover:bg-[var(--accent-green)] text-[var(--text-secondary)] hover:text-white active:scale-[0.97] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                              aria-label={`Advance ${proj.customerName} to ${nextPhase}`}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {/* Assign / Reassign Setter */}
                          <SetterPopover
                            projectId={proj.id}
                            customerName={proj.customerName}
                            currentSetterId={proj.setterId}
                            currentSetterName={proj.setterName}
                            reps={reps}
                            trainerAssignments={trainerAssignments}
                            setProjects={setProjects}
                            updateProject={updateProject}
                          />
                        </div>
                      </td>
                    );
                  })()}
                </tr>
                );
              })}
              {pagedProjects.length === 0 && (
                <tr>
                  <td colSpan={(isAdmin ? 10 : dealScope === 'all' ? 8 : 7) - (hideFinancials ? 1 : 0)} className="px-5 py-12 text-center">
                    <div className="flex justify-center">
                      {hasActiveFilters ? (
                        /* ── Filtered: no results ─────────────────────────────────── */
                        <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — magnifying glass over empty grid */}
                          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                            <rect x="8" y="18" width="46" height="44" rx="5" stroke="#475569" strokeWidth="2" fill="none"/>
                            <rect x="14" y="26" width="12" height="8" rx="2" fill="#334155"/>
                            <rect x="32" y="26" width="16" height="3" rx="1.5" fill="#334155"/>
                            <rect x="32" y="32" width="10" height="3" rx="1.5" fill="#1e293b"/>
                            <rect x="14" y="40" width="34" height="3" rx="1.5" fill="#1e293b"/>
                            <rect x="14" y="47" width="22" height="3" rx="1.5" fill="#1e293b"/>
                            {/* Magnifying glass */}
                            <circle cx="56" cy="52" r="12" stroke="var(--accent-cyan)" strokeWidth="2.5" fill="none" strokeOpacity="0.6"/>
                            <circle cx="56" cy="52" r="7" stroke="var(--accent-cyan)" strokeWidth="1.5" fill="none" strokeOpacity="0.3"/>
                            <line x1="64.5" y1="61" x2="72" y2="69" stroke="var(--accent-cyan)" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"/>
                            {/* X inside lens */}
                            <line x1="53" y1="49" x2="59" y2="55" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
                            <line x1="59" y1="49" x2="53" y2="55" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
                          </svg>
                          <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">No projects match your filters</p>
                          <p className="text-[var(--text-muted)] text-xs leading-relaxed">Try adjusting your search query or active filters to find what you&apos;re looking for.</p>
                          <button
                            onClick={clearAllFilters}
                            className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Clear Filters
                          </button>
                        </div>
                      ) : (
                        /* ── No deals at all ──────────────────────────────────────── */
                        <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — folder with solar panel motif */}
                          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                            {/* Folder body */}
                            <path d="M10 28 C10 24.7 12.7 22 16 22 L30 22 L34 27 L64 27 C67.3 27 70 29.7 70 33 L70 58 C70 61.3 67.3 64 64 64 L16 64 C12.7 64 10 61.3 10 58 Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            {/* Folder tab */}
                            <path d="M10 22 L30 22 L34 27 L10 27 Z" fill="#334155"/>
                            {/* Solar panel grid inside folder */}
                            <rect x="22" y="36" width="8" height="6" rx="1" fill="var(--accent-green)" fillOpacity="0.5" stroke="var(--accent-cyan)" strokeWidth="0.75" strokeOpacity="0.6"/>
                            <rect x="32" y="36" width="8" height="6" rx="1" fill="var(--accent-green)" fillOpacity="0.5" stroke="var(--accent-cyan)" strokeWidth="0.75" strokeOpacity="0.6"/>
                            <rect x="42" y="36" width="8" height="6" rx="1" fill="var(--accent-green)" fillOpacity="0.5" stroke="var(--accent-cyan)" strokeWidth="0.75" strokeOpacity="0.6"/>
                            <rect x="22" y="44" width="8" height="6" rx="1" fill="#1d4ed8" fillOpacity="0.4" stroke="var(--accent-cyan)" strokeWidth="0.75" strokeOpacity="0.4"/>
                            <rect x="32" y="44" width="8" height="6" rx="1" fill="#1d4ed8" fillOpacity="0.4" stroke="var(--accent-cyan)" strokeWidth="0.75" strokeOpacity="0.4"/>
                            <rect x="42" y="44" width="8" height="6" rx="1" fill="#1d4ed8" fillOpacity="0.4" stroke="var(--accent-cyan)" strokeWidth="0.75" strokeOpacity="0.4"/>
                            {/* Sparkle / plus icon */}
                            <circle cx="58" cy="22" r="8" fill="var(--surface-card)"/>
                            <line x1="58" y1="17" x2="58" y2="27" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
                            <line x1="53" y1="22" x2="63" y2="22" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                          <p className="text-[var(--text-secondary)] text-sm font-semibold leading-snug">Submit your first deal</p>
                          <p className="text-[var(--text-muted)] text-xs leading-relaxed">Your pipeline is empty. Create a new deal to start tracking projects and commissions.</p>
                          <a
                            href="/dashboard/new-deal"
                            className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            + Submit Deal
                          </a>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        {/* ── Pagination bar ─────────────────────────────────────────── */}
        <PaginationBar
          totalResults={totalResults} startIdx={startIdx} endIdx={endIdx}
          currentPage={safeCurrentPage} totalPages={totalPages} rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage} onRowsPerPageChange={(n) => { setRowsPerPage(n); setCurrentPage(1); }}
        />
      </div>

      {/* Spacer so content is never hidden behind the fixed action bar */}
      {showActionBar && <div className="h-20" />}

      {/* ── Floating bulk-action toolbar ──────────────────────────────────
           Glass-morphism pill centred at the viewport bottom. Mounts with a
           spring-eased slide-up entrance whenever one or more projects are
           selected (admin only). Escape key and the x button both clear the
           selection.                                                          */}
      {showActionBar && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 backdrop-blur-xl bg-[var(--surface)]/80 border border-[var(--border)]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40 animate-float-toolbar-in"
          role="toolbar"
          aria-label="Batch actions for selected projects"
        >
          <div className="flex items-center gap-3">

            {/* Selection count badge — blue accent pill with total kW */}
            <span className="flex items-center gap-1.5 bg-[var(--accent-green)]/15 border border-[var(--accent-green)]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
              <span className="text-white font-bold tabular-nums">{selectedProjectIds.size}</span>
              <span className="text-[var(--accent-green)] font-medium">selected</span>
              {selectedTotalKw > 0 && (
                <>
                  <span className="text-[var(--text-dim)] mx-0.5">&middot;</span>
                  <span className="text-[var(--accent-green)] font-semibold tabular-nums">{selectedTotalKw.toFixed(1)} kW</span>
                </>
              )}
            </span>

            {/* Visual divider */}
            <div className="h-5 w-px bg-[var(--border)]/80 flex-shrink-0" />

            {/* Advance Phase — primary action */}
            <button
              onClick={handleBulkAdvance}
              className="btn-primary text-black font-semibold px-4 py-1.5 rounded-xl text-sm shadow-lg shadow-blue-500/20 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Advance Phase
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {/* Change Phase — dropdown to pick any target phase */}
            <select
              value={bulkPhaseTarget}
              onChange={(e) => { if (e.target.value) handleBulkChangePhase(e.target.value as Phase); }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--border)]/60 border border-[var(--border)]/40 text-[var(--text-secondary)] rounded-xl px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] cursor-pointer hover:bg-[var(--text-dim)]/80 transition-colors"
            >
              <option value="">Change Phase...</option>
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>{ph}</option>
              ))}
            </select>

            {/* Flag / Unflag toggle */}
            <button
              onClick={handleBulkFlag}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap bg-[var(--border)]/60 hover:bg-red-600/80 border border-[var(--border)]/40 text-[var(--text-secondary)] hover:text-white transition-colors active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <Flag className="w-3.5 h-3.5" />
              {bulkFlagLabel}
            </button>

            {/* Dismiss / deselect-all x button */}
            <button
              onClick={() => setSelectedProjectIds(new Set())}
              aria-label="Deselect all and dismiss toolbar"
              className="btn-secondary p-1.5 rounded-lg bg-[var(--border)]/60 hover:bg-[var(--text-dim)]/80 border border-[var(--border)]/40 text-[var(--text-secondary)] hover:text-white transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>

          </div>
        </div>
      )}

      {/* Bulk phase change confirmation (On Hold only) */}
      <ConfirmDialog
        open={!!bulkConfirm}
        onClose={() => { setBulkConfirm(null); setBulkPhaseTarget(''); }}
        onConfirm={() => { if (bulkConfirm) executeBulkPhaseChange(bulkConfirm.phase); }}
        title={`Move ${bulkConfirm?.count ?? 0} project${(bulkConfirm?.count ?? 0) > 1 ? 's' : ''} to ${bulkConfirm?.phase ?? ''}?`}
        message={`This will move ${bulkConfirm?.count ?? 0} selected project${(bulkConfirm?.count ?? 0) > 1 ? 's' : ''} to ${bulkConfirm?.phase ?? ''}. On-hold projects are paused.`}
        confirmLabel="Put On Hold"
        danger={false}
      />

      {/* Bulk Cancellation Reason Modal */}
      {bulkCancelReasonModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setBulkCancelReasonModal(null); }}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <h2 className="text-white font-bold text-base">Cancel {bulkCancelReasonModal.count} Project{bulkCancelReasonModal.count > 1 ? 's' : ''}</h2>
              <button onClick={() => setBulkCancelReasonModal(null)} className="text-[var(--text-secondary)] hover:text-white transition-colors rounded-lg p-1 hover:bg-[var(--surface-card)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[var(--text-secondary)] text-sm">Why are <span className="text-white font-medium">{bulkCancelReasonModal.count} project{bulkCancelReasonModal.count > 1 ? 's' : ''}</span> being cancelled?</p>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select value={bulkCancelReason} onChange={(e) => setBulkCancelReason(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]">
                  <option value="">Select a reason...</option>
                  <option value="Customer changed mind">Customer changed mind</option>
                  <option value="Credit denied">Credit denied</option>
                  <option value="Roof not suitable">Roof not suitable</option>
                  <option value="Competitor won">Competitor won</option>
                  <option value="Pricing issue">Pricing issue</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Notes <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span></label>
                <textarea rows={2} value={bulkCancelNotes} onChange={(e) => setBulkCancelNotes(e.target.value)} placeholder="Additional details..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] resize-none placeholder-slate-500" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setBulkCancelReasonModal(null)}
                  className="flex-1 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors">Go Back</button>
                <button onClick={confirmBulkCancelWithReason}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors active:scale-[0.97]">Cancel Projects</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
