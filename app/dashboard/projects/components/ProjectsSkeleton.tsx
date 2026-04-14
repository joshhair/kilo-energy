'use client';

export default function ProjectsSkeleton() {
  return (
    <div className="px-3 pt-2 pb-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <div className="h-8 w-32 bg-[var(--surface-card)] rounded animate-skeleton" />
          <div className="h-3 w-28 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-9 w-24 bg-[var(--surface-card)] rounded-xl animate-skeleton" />
      </div>

      {/* Tab + filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-4 md:flex-wrap">
        <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1">
          <div className="h-8 w-20 bg-[var(--surface-card)] rounded-lg animate-skeleton" />
          <div className="h-8 w-24 bg-[var(--border)]/50 rounded-lg animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="flex gap-1 bg-[var(--surface-card)] rounded-xl p-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-7 w-16 bg-[var(--border)]/60 rounded-lg animate-skeleton" style={{ animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
        <div className="h-8 w-32 bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: '150ms' }} />
      </div>

      {/* Kanban skeleton — 9 columns x 3 placeholder cards */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[...Array(9)].map((_, colIdx) => (
          <div key={colIdx} className="flex-shrink-0 w-52 space-y-2">
            {/* Column header */}
            <div className="flex items-center justify-between pb-2 mb-1">
              <div
                className="h-3 w-20 bg-[var(--surface-card)] rounded animate-skeleton"
                style={{ animationDelay: `${colIdx * 60}ms` }}
              />
              <div
                className="h-5 w-6 bg-[var(--surface-card)] rounded-full animate-skeleton"
                style={{ animationDelay: `${colIdx * 60}ms` }}
              />
            </div>
            {/* 3 placeholder cards per column */}
            {[...Array(3)].map((_, cardIdx) => {
              const delay = colIdx * 60 + cardIdx * 75;
              return (
                <div key={cardIdx} className="card-surface rounded-xl p-3 space-y-2">
                  <div
                    className="h-4 bg-[var(--surface-card)] rounded animate-skeleton"
                    style={{ width: cardIdx === 0 ? '80%' : cardIdx === 1 ? '65%' : '75%', animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-12 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-20 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-16 bg-[var(--surface-card)]/50 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
