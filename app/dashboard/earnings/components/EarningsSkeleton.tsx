'use client';

/**
 * EarningsSkeleton — loading placeholder that mirrors the earnings
 * page layout so the hydration transition doesn't flash a blank
 * screen.
 *
 * Extracted from app/dashboard/earnings/page.tsx as part of A+
 * Phase 1.1 decomposition. Pure visual component, no props.
 */

export function EarningsSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-[var(--surface-card)] animate-skeleton mb-3" style={{ animationDelay: '0ms' }} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--surface-card)] animate-skeleton flex-shrink-0" style={{ animationDelay: '50ms' }} />
            <div>
              <div className="h-8 w-48 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '100ms' }} />
              <div className="h-4 w-64 bg-[var(--surface-card)]/60 rounded animate-skeleton mt-1.5" style={{ animationDelay: '150ms' }} />
            </div>
          </div>
          {/* Request Reimbursement button placeholder */}
          <div className="h-10 w-48 bg-[var(--surface-card)] rounded-xl animate-skeleton flex-shrink-0" style={{ animationDelay: '200ms' }} />
        </div>
      </div>

      {/* Summary stat cards — 4-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map((cardIdx) => {
          const base = 250 + cardIdx * 50;
          return (
            <div key={cardIdx} className="card-surface rounded-2xl p-5">
              {/* Accent bar */}
              <div
                className="h-[2px] w-12 rounded-full bg-[var(--border)] animate-skeleton mb-3"
                style={{ animationDelay: `${base}ms` }}
              />
              {/* Label row */}
              <div
                className="h-3 w-24 bg-[var(--surface-card)]/80 rounded animate-skeleton mb-3"
                style={{ animationDelay: `${base + 50}ms` }}
              />
              {/* Value bar */}
              <div
                className="h-10 w-32 bg-[var(--surface-card)] rounded animate-skeleton"
                style={{ animationDelay: `${base + 100}ms` }}
              />
              {/* Sparkline bar */}
              <div
                className="h-4 w-full bg-[var(--surface-card)]/50 rounded animate-skeleton mt-2"
                style={{ animationDelay: `${base + 150}ms` }}
              />
            </div>
          );
        })}
      </div>

      {/* Tab bar — 3 pill shapes */}
      <div className="flex gap-1 mb-5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-9 w-36 bg-[var(--surface-card)] rounded-lg animate-skeleton"
            style={{ animationDelay: `${500 + i * 50}ms` }}
          />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="card-surface rounded-2xl overflow-hidden">
        {/* Frosted header row */}
        <div className="table-header-frost border-b border-[var(--border-subtle)] px-5 py-3 flex gap-4">
          {[96, 72, 64, 56, 80, 64].map((w, i) => (
            <div
              key={i}
              className={`h-4 bg-[var(--border)]/70 rounded animate-skeleton`}
              style={{ width: `${w}px`, animationDelay: `${650 + i * 50}ms` }}
            />
          ))}
        </div>

        {/* 8 placeholder rows with alternating opacity and varying column widths */}
        {([
          [148, 68, 60, 76, 84, 64],
          [112, 56, 52, 64, 72, 56],
          [160, 72, 64, 80, 88, 60],
          [128, 60, 56, 68, 76, 52],
          [144, 64, 60, 72, 80, 68],
          [120, 52, 52, 60, 68, 56],
          [136, 68, 64, 76, 84, 60],
          [124, 56, 56, 64, 72, 52],
        ] as number[][]).map((colWidths, rowIdx) => {
          const delay = 700 + rowIdx * 50;
          const isEven = rowIdx % 2 === 0;
          return (
            <div
              key={rowIdx}
              className={`border-b border-[var(--border-subtle)]/50 px-5 py-3.5 flex gap-4 items-center ${isEven ? '' : 'bg-[var(--surface-card)]/20'}`}
            >
              {colWidths.map((w, colIdx) => (
                <div
                  key={colIdx}
                  className={`h-4 bg-[var(--surface-card)] rounded animate-skeleton ${isEven ? 'opacity-100' : 'opacity-70'}`}
                  style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 30}ms` }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
