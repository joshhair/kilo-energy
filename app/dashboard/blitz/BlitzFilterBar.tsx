'use client';

import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { SegmentedPills } from '../../../components/ui';

type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';
type SortKey = 'newest' | 'oldest' | 'deals' | 'kw' | 'name';

interface BlitzData {
  id: string;
  name: string;
  location: string;
  status: BlitzStatus;
  housing: string;
  startDate: string;
  endDate: string;
  notes: string;
  createdBy: { id: string; firstName: string; lastName: string };
  owner: { id: string; firstName: string; lastName: string };
  participants: Array<{
    id: string;
    joinStatus: string;
    attendanceStatus: string | null;
    user: { id: string; firstName: string; lastName: string };
  }>;
  costs: Array<{ id: string; category: string; amount: number; description: string; date: string }>;
  projects: Array<{ id: string; customerName: string; kWSize: number; netPPW: number; m1Amount: number; m2Amount: number; phase: string; closer: { id: string } | null; setter: { id: string } | null; additionalClosers: Array<{ userId: string }>; additionalSetters: Array<{ userId: string }> }>;
}

const STATUS_FILTER_OPTIONS = ['all', 'active', 'upcoming', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'deals', label: 'Most Deals' },
  { value: 'kw', label: 'Most kW' },
  { value: 'name', label: 'Name A–Z' },
];

interface BlitzFilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  sortBy: SortKey;
  onSort: (v: SortKey) => void;
  statusFilter: BlitzStatus | 'all';
  onStatusFilter: (v: BlitzStatus | 'all') => void;
  searchOnlyBlitzes: BlitzData[];
}

export function BlitzFilterBar({
  search,
  onSearch,
  searchRef,
  sortBy,
  onSort,
  statusFilter,
  onStatusFilter,
  searchOnlyBlitzes,
}: BlitzFilterBarProps) {
  // Note: refs preserved for any future custom hover/focus management
  // a parent might attach; the sliding pill itself is handled inside
  // SegmentedPills.
  const _statusTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filteredCount =
    statusFilter === 'all'
      ? searchOnlyBlitzes.length
      : searchOnlyBlitzes.filter((b) => b.status === statusFilter).length;

  // Build status options with per-item counts as badges.
  const statusOptions = STATUS_FILTER_OPTIONS.map((s) => {
    const count = s === 'all' ? searchOnlyBlitzes.length : searchOnlyBlitzes.filter((b) => b.status === s).length;
    return {
      value: s,
      label: s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1),
      badge: count > 0 ? count : undefined,
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search with keyboard shortcut */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onSearch('');
              searchRef.current?.blur();
            }
          }}
          placeholder="Search blitzes...  /"
          className="w-full rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none input-focus-glow"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
        />
        {search && (
          <button
            onClick={() => { onSearch(''); searchRef.current?.focus(); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {search && (
        <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full">
          {filteredCount} result{filteredCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* Sort pills — desktop only */}
      <div className="hidden md:block">
        <SegmentedPills<SortKey>
          options={SORT_OPTIONS}
          value={sortBy}
          onChange={onSort}
          size="sm"
          ariaLabel="Sort blitzes"
        />
      </div>

      {/* Status filter — shared SegmentedPills with per-item count badges */}
      <SegmentedPills<StatusFilter>
        options={statusOptions}
        value={statusFilter}
        onChange={onStatusFilter}
        size="sm"
        ariaLabel="Filter blitzes by status"
      />
    </div>
  );
}
