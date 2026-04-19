'use client';

export function PayrollSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header block — mirrors the icon + title/subtitle + action-button layout */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-[var(--surface-card)] rounded-lg animate-skeleton" />
          <div className="space-y-2">
            <div className="h-[3px] w-12 bg-[var(--border)] rounded-full animate-skeleton" />
            <div
              className="h-8 w-36 bg-[var(--surface-card)] rounded animate-skeleton"
              style={{ animationDelay: '75ms' }}
            />
            <div
              className="h-3 w-56 bg-[var(--surface-card)]/70 rounded animate-skeleton"
              style={{ animationDelay: '100ms' }}
            />
          </div>
        </div>
        <div className="flex gap-3">
          <div
            className="h-9 w-24 bg-[var(--surface-card)] rounded-xl animate-skeleton"
            style={{ animationDelay: '50ms' }}
          />
          <div
            className="h-9 w-32 bg-[var(--surface-card)] rounded-xl animate-skeleton"
            style={{ animationDelay: '100ms' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card-surface rounded-2xl p-5 space-y-3">
            <div
              className="h-[2px] w-12 bg-[var(--border)] rounded-full animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
            <div
              className="h-3 w-16 bg-[var(--surface-card)] rounded animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
            <div
              className="h-8 w-28 bg-[var(--surface-card)] rounded animate-skeleton"
              style={{ animationDelay: `${i * 75 + 40}ms` }}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-8 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-9 w-32 bg-[var(--surface-card)] rounded-lg animate-skeleton"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      <div className="card-surface rounded-2xl overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-4 px-5 py-4 border-b border-[var(--border-subtle)]/50 ${i % 2 === 1 ? 'opacity-60' : ''}`}
          >
            <div
              className="h-4 w-40 bg-[var(--surface-card)] rounded animate-skeleton"
              style={{ animationDelay: `${i * 60}ms` }}
            />
            <div
              className="h-5 w-20 bg-[var(--surface-card)]/80 rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 30}ms` }}
            />
            <div
              className="ml-auto h-4 w-16 bg-[var(--surface-card)] rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 50}ms` }}
            />
            <div
              className="h-5 w-14 bg-[var(--surface-card)]/70 rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 70}ms` }}
            />
            <div
              className="h-3 w-20 bg-[var(--surface-card)]/50 rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 90}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
