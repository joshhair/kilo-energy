'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

// ── Shared pagination helpers ─────────────────────────────────────────────────

export function buildPageRange(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

export interface PaginationBarProps {
  totalResults: number; startIdx: number; endIdx: number;
  currentPage: number; totalPages: number; rowsPerPage: number;
  onPageChange: (page: number) => void; onRowsPerPageChange: (rows: number) => void;
}

export function PaginationBar({ totalResults, startIdx, endIdx, currentPage, totalPages, rowsPerPage, onPageChange, onRowsPerPageChange }: PaginationBarProps) {
  return (
    <div className="bg-[var(--surface)] border-t border-[var(--border-subtle)] px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <span>Rows per page:</span>
        <select value={rowsPerPage} onChange={(e) => { onRowsPerPageChange(Number(e.target.value)); onPageChange(1); }}
          className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] rounded-lg px-2 py-1 text-xs focus:outline-none transition-all duration-200 input-focus-glow">
          {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <span className="text-[var(--text-muted)] text-sm">
        {totalResults === 0 ? 'No results' : `Showing ${startIdx + 1}\u2013${endIdx} of ${totalResults}`}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
          className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors" aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {buildPageRange(currentPage, totalPages).map((page, idx) =>
          page === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-1.5 py-1 text-[var(--text-dim)] text-sm select-none">&hellip;</span>
          ) : (
            <button key={page} onClick={() => onPageChange(page)}
              className={`min-w-[2rem] px-2 py-1 rounded-lg text-sm font-medium transition-colors ${page === currentPage ? 'text-white' : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)]'}`}
              style={page === currentPage ? { backgroundColor: 'var(--brand)' } : {}}
              aria-label={`Page ${page}`} aria-current={page === currentPage ? 'page' : undefined}>
              {page}
            </button>
          )
        )}
        <button onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
          className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors" aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
