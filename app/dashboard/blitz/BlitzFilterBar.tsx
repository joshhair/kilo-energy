'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

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

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'deals', label: 'Most Deals' },
  { key: 'kw', label: 'Most kW' },
  { key: 'name', label: 'Name A–Z' },
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
  const statusTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [statusIndicator, setStatusIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = STATUS_FILTER_OPTIONS.indexOf(statusFilter);
    const el = statusTabRefs.current[idx];
    if (el) setStatusIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- STATUS_FILTER_OPTIONS is a module-level const
  }, [statusFilter]);

  const sortTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [sortIndicator, setSortIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = SORT_OPTIONS.findIndex((o) => o.key === sortBy);
    const el = sortTabRefs.current[idx];
    if (el) setSortIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [sortBy]);

  const filteredCount =
    statusFilter === 'all'
      ? searchOnlyBlitzes.length
      : searchOnlyBlitzes.filter((b) => b.status === statusFilter).length;

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
      <div
        className="relative gap-1 rounded-xl p-1 hidden md:flex"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {sortIndicator && (
          <div
            className="absolute inset-y-1 rounded-lg z-0 pointer-events-none"
            style={{
              left: sortIndicator.left,
              width: sortIndicator.width,
              transition: 'left 220ms cubic-bezier(0.16, 1, 0.3, 1), width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-emerald-solid) 18%, transparent), color-mix(in srgb, var(--accent-cyan-solid) 18%, transparent))',
              border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)',
            }}
          />
        )}
        {SORT_OPTIONS.map((opt, i) => (
          <button
            key={opt.key}
            ref={(el) => { sortTabRefs.current[i] = el; }}
            onClick={() => onSort(opt.key)}
            className="relative z-10 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            style={sortBy === opt.key ? { color: 'var(--text-primary)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Status filter tabs with sliding pill */}
      <div
        className="relative flex gap-1 rounded-xl p-1 w-fit"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {statusIndicator && (
          <div
            className="absolute inset-y-1 rounded-lg z-0 pointer-events-none"
            style={{
              left: statusIndicator.left,
              width: statusIndicator.width,
              transition: 'left 220ms cubic-bezier(0.16, 1, 0.3, 1), width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-emerald-solid) 18%, transparent), color-mix(in srgb, var(--accent-cyan-solid) 18%, transparent))',
              border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)',
            }}
          />
        )}
        {STATUS_FILTER_OPTIONS.map((s, i) => {
          const count = s === 'all' ? searchOnlyBlitzes.length : searchOnlyBlitzes.filter((b) => b.status === s).length;
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              ref={(el) => { statusTabRefs.current[i] = el; }}
              onClick={() => onStatusFilter(s)}
              className="relative z-10 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              style={isActive ? { color: 'var(--text-primary)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              {count > 0 && (
                <span className="ml-1" style={{ color: isActive ? 'color-mix(in srgb, var(--text-primary) 60%, transparent)' : 'var(--text-dim)' }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
