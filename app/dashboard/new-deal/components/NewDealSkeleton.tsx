'use client';

function SkeletonField({ delay }: { delay: number }) {
  return (
    <div className="space-y-1.5">
      <div className="h-3 w-24 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="h-10 w-full bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
    </div>
  );
}

export function NewDealSkeleton() {
  return (
    <div>
      {/* Stepper bar skeleton — mirrors the sticky FormStepper (3 steps + connecting lines) */}
      <div
        className="sticky top-[60px] md:top-0 z-20 border-b border-[var(--border-subtle)]/60"
        style={{ backgroundColor: 'var(--navy-base)' }}
      >
        {/* Desktop stepper (md+): 3 dots connected by 2 lines */}
        <div className="hidden md:flex items-center px-4 md:px-8 py-3 max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`flex items-center ${i < 2 ? 'flex-1' : ''}`}>
              <div className="flex flex-col items-center shrink-0">
                <div
                  className="w-7 h-7 rounded-full bg-[var(--surface-card)] animate-skeleton"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
                <div
                  className="mt-1 h-2 w-14 bg-[var(--surface-card)]/60 rounded animate-skeleton"
                  style={{ animationDelay: `${i * 60 + 30}ms` }}
                />
              </div>
              {i < 2 && (
                <div
                  className="flex-1 mx-3 h-[2px] bg-[var(--border)]/60 rounded-full mt-[-10px] animate-skeleton"
                  style={{ animationDelay: `${i * 60 + 50}ms` }}
                />
              )}
            </div>
          ))}
        </div>
        {/* Mobile stepper: progress bar + step label */}
        <div className="md:hidden h-12 flex items-center px-4 gap-3">
          <div className="h-1.5 flex-1 bg-[var(--surface-card)] rounded-full animate-skeleton" />
          <div className="h-3 w-20 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ animationDelay: '50ms' }} />
        </div>
      </div>

      {/* Page header + form */}
      <div className="p-4 md:p-8 max-w-2xl">
        <div className="mb-8">
          <div className="h-[3px] w-12 rounded-full bg-[var(--border)] animate-skeleton mb-3" />
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 bg-[var(--surface-card)] rounded-lg animate-skeleton" />
            <div className="h-8 w-32 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
          </div>
          <div className="h-3 w-72 bg-[var(--surface-card)]/70 rounded animate-skeleton ml-12 mt-1" style={{ animationDelay: '150ms' }} />
        </div>

        {/* Form card — 2-column grid with 6 field placeholders */}
        <div className="card-surface rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonField delay={0} />
            <SkeletonField delay={75} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonField delay={150} />
            <SkeletonField delay={225} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonField delay={300} />
            <SkeletonField delay={375} />
          </div>
        </div>
      </div>
    </div>
  );
}
