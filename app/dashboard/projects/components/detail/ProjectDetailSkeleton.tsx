'use client';

/**
 * Skeleton loader for the project detail page.
 *
 * Mirrors the project detail page layout with animated placeholder blocks.
 * Shown during the server→client hydration window to eliminate the
 * blank→content flash when navigating to a project from the Kanban board or
 * dashboard attention items.
 *
 * Extracted from projects/[id]/page.tsx as part of A+ Phase 1.1.
 * Pure visual component, no props.
 */

export function ProjectDetailSkeleton() {
  return (
    <div className="px-3 pt-2 pb-4 md:p-8 max-w-3xl">

      {/* Breadcrumb placeholder */}
      <div
        className="h-9 w-56 bg-[var(--surface-card)] rounded-xl animate-skeleton mb-6"
        style={{ animationDelay: '0ms' }}
      />

      {/* ── Pipeline stepper placeholder ── */}
      <div className="bg-[var(--surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6">

        {/* 9 circles connected by connector lines */}
        <div className="flex items-start w-full overflow-x-auto pb-0.5 gap-0">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="flex items-start">

              {/* Step node */}
              <div className="flex flex-col items-center shrink-0 w-14">
                {/* Circle */}
                <div
                  className="w-7 h-7 rounded-full bg-[var(--surface-card)] animate-skeleton"
                  style={{ animationDelay: `${i * 75}ms` }}
                />
                {/* Label text */}
                <div
                  className="mt-1.5 h-2 w-10 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                  style={{ animationDelay: `${i * 75}ms` }}
                />
              </div>

              {/* Connector line — not rendered after the last step */}
              {i < 8 && (
                <div className="flex-1 min-w-[6px] h-0.5 mt-4 shrink bg-[var(--border)]/60" />
              )}
            </div>
          ))}
        </div>

        {/* Days badge + next-action hint row */}
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-3">
          <div
            className="h-6 w-32 bg-[var(--surface-card)] rounded-full animate-skeleton"
            style={{ animationDelay: '675ms' }}
          />
          <div
            className="h-4 w-52 bg-[var(--surface-card)]/60 rounded animate-skeleton"
            style={{ animationDelay: '750ms' }}
          />
        </div>
      </div>

      {/* ── Header placeholder ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-3">
          {/* Blue accent bar */}
          <div
            className="h-[3px] w-12 bg-[var(--surface-card)] rounded-full animate-skeleton"
            style={{ animationDelay: '75ms' }}
          />
          {/* Customer name */}
          <div
            className="h-9 w-56 bg-[var(--surface-card)] rounded animate-skeleton"
            style={{ animationDelay: '150ms' }}
          />
          {/* Phase badge + sold date */}
          <div className="flex items-center gap-3">
            <div
              className="h-6 w-20 bg-[var(--surface-card)] rounded-md animate-skeleton"
              style={{ animationDelay: '225ms' }}
            />
            <div
              className="h-4 w-28 bg-[var(--surface-card)]/60 rounded animate-skeleton"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        </div>

        {/* Action button area */}
        <div
          className="h-8 w-20 bg-[var(--surface-card)] rounded-xl animate-skeleton"
          style={{ animationDelay: '375ms' }}
        />
      </div>

      {/* ── Details grid placeholder (two-column, 6 label+value rows) ── */}
      <div className="card-surface rounded-2xl p-6 mb-5">
        {/* Section heading */}
        <div
          className="h-5 w-32 bg-[var(--surface-card)] rounded animate-skeleton mb-4"
          style={{ animationDelay: '75ms' }}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              {/* Label */}
              <div
                className="h-2.5 w-14 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                style={{ animationDelay: `${(i + 2) * 75}ms` }}
              />
              {/* Value */}
              <div
                className="h-4 bg-[var(--surface-card)] rounded animate-skeleton"
                style={{
                  width: i % 3 === 0 ? '72%' : i % 3 === 1 ? '58%' : '65%',
                  animationDelay: `${(i + 2) * 75}ms`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Notes section placeholder ── */}
      <div className="card-surface rounded-2xl p-6">
        {/* Section heading */}
        <div
          className="h-5 w-16 bg-[var(--surface-card)] rounded animate-skeleton mb-3"
          style={{ animationDelay: '600ms' }}
        />

        {/* Three lines of faux note text */}
        <div className="space-y-2">
          <div
            className="h-4 w-full bg-[var(--surface-card)]/80 rounded animate-skeleton"
            style={{ animationDelay: '675ms' }}
          />
          <div
            className="h-4 w-4/5 bg-[var(--surface-card)]/70 rounded animate-skeleton"
            style={{ animationDelay: '750ms' }}
          />
          <div
            className="h-4 w-3/5 bg-[var(--surface-card)]/60 rounded animate-skeleton"
            style={{ animationDelay: '825ms' }}
          />
        </div>
      </div>
    </div>
  );
}
