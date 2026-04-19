'use client';

export function RepsSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-9 w-9 bg-[var(--surface-card)] rounded-lg animate-skeleton" />
          <div className="h-8 w-20 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-3 w-44 bg-[var(--surface-card)]/70 rounded animate-skeleton ml-12 mt-1" style={{ animationDelay: '150ms' }} />
      </div>

      {/* Search bar placeholder */}
      <div className="relative max-w-xs mb-6">
        <div className="h-9 w-full bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: '75ms' }} />
      </div>

      {/* 6 rep card skeletons */}
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => {
          const delay = i * 75;
          return (
            <div
              key={i}
              className="card-surface rounded-2xl p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
            >
              {/* Avatar + name/email */}
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-full bg-[var(--surface-card)] flex-shrink-0 animate-skeleton"
                  style={{ animationDelay: `${delay}ms` }}
                />
                <div className="space-y-2">
                  <div
                    className="h-4 w-32 bg-[var(--surface-card)] rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-44 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                </div>
              </div>

              {/* 4 stat number placeholders */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:items-center md:gap-8">
                {[...Array(4)].map((_, si) => (
                  <div key={si} className="text-center space-y-1.5">
                    <div
                      className="h-4 w-10 bg-[var(--surface-card)] rounded animate-skeleton mx-auto"
                      style={{ animationDelay: `${delay + si * 30}ms` }}
                    />
                    <div
                      className="h-3 w-14 bg-[var(--surface-card)]/70 rounded animate-skeleton mx-auto"
                      style={{ animationDelay: `${delay + si * 30}ms` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
