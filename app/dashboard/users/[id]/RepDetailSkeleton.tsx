'use client';

export default function RepDetailSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-6">
        {[16, 3, 10, 3, 24].map((w, i) => (
          <div key={i} className="h-3 bg-[var(--surface-card)] rounded animate-skeleton" style={{ width: `${w * 4}px`, animationDelay: `${i * 25}ms` }} />
        ))}
      </div>

      {/* xl: 2-column grid — mirrors the real content layout exactly */}
      <div className="xl:grid xl:grid-cols-[300px_1fr] xl:gap-8 xl:items-start">

        {/* LEFT sidebar skeleton */}
        <div className="xl:flex xl:flex-col xl:gap-6">
          {/* Avatar + name */}
          <div className="flex items-center gap-4 mb-8 xl:mb-0">
            <div className="w-14 h-14 rounded-full bg-[var(--surface-card)] animate-skeleton flex-shrink-0" style={{ animationDelay: '100ms' }} />
            <div>
              <div className="h-[3px] w-12 rounded-full bg-[var(--border)] animate-skeleton mb-3" style={{ animationDelay: '150ms' }} />
              <div className="h-7 w-40 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '200ms' }} />
              <div className="h-4 w-48 bg-[var(--surface-card)]/60 rounded animate-skeleton mt-1.5" style={{ animationDelay: '250ms' }} />
            </div>
          </div>

          {/* Stat cards — 2-col at xl (sidebar), 4-col at sm */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-4 mb-8 xl:mb-0">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card-surface rounded-2xl p-4">
                <div className="h-[2px] w-8 rounded-full bg-[var(--border)] animate-skeleton mb-2" style={{ animationDelay: `${300 + i * 50}ms` }} />
                <div className="h-3 w-20 bg-[var(--surface-card)]/80 rounded animate-skeleton mb-2" style={{ animationDelay: `${330 + i * 50}ms` }} />
                <div className="h-6 w-16 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${360 + i * 50}ms` }} />
              </div>
            ))}
          </div>

          {/* Commission by Role skeleton */}
          <div className="card-surface rounded-2xl p-5 mb-6 xl:mb-0">
            <div className="h-5 w-40 bg-[var(--surface-card)] rounded animate-skeleton mb-4" style={{ animationDelay: '520ms' }} />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex justify-between py-2.5 border-b border-[var(--border-subtle)]/50">
                <div className="h-4 w-16 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: `${540 + i * 25}ms` }} />
                <div className="h-4 w-8 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ animationDelay: `${550 + i * 25}ms` }} />
                <div className="h-4 w-20 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${560 + i * 25}ms` }} />
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT main content skeleton */}
        <div className="xl:flex xl:flex-col xl:gap-6">
          {/* Payment History table skeleton — 6 columns matching col widths 30/10/10/15/15/20 */}
          <div className="card-surface rounded-2xl overflow-clip mb-6 xl:mb-0">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div className="h-5 w-36 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '620ms' }} />
              <div className="flex gap-4">
                <div className="h-4 w-24 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ animationDelay: '640ms' }} />
                <div className="h-4 w-28 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ animationDelay: '660ms' }} />
              </div>
            </div>
            <div className="border-b border-[var(--border-subtle)] px-5 py-3 flex gap-3">
              {[140, 56, 56, 64, 64, 80].map((w, i) => (
                <div key={i} className="h-4 bg-[var(--border)]/70 rounded animate-skeleton" style={{ width: w, animationDelay: `${680 + i * 25}ms` }} />
              ))}
            </div>
            {[0,1,2,3,4,5].map((row) => (
              <div key={row} className={`border-b border-[var(--border-subtle)]/50 px-5 py-3.5 flex gap-3 items-center ${row % 2 !== 0 ? 'bg-[var(--surface-card)]/20' : ''}`}>
                {[140, 56, 56, 64, 64, 80].map((w, col) => (
                  <div key={col} className="h-4 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ width: w, animationDelay: `${760 + row * 35 + col * 15}ms` }} />
                ))}
              </div>
            ))}
          </div>

          {/* Projects table skeleton — 7 columns */}
          <div className="card-surface rounded-2xl overflow-clip">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
              <div className="h-5 w-28 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '1020ms' }} />
            </div>
            <div className="border-b border-[var(--border-subtle)] px-5 py-3 flex gap-3">
              {[120, 56, 80, 80, 56, 40, 64].map((w, i) => (
                <div key={i} className="h-4 bg-[var(--border)]/70 rounded animate-skeleton" style={{ width: w, animationDelay: `${1040 + i * 25}ms` }} />
              ))}
            </div>
            {[0,1,2,3,4,5].map((row) => (
              <div key={row} className={`border-b border-[var(--border-subtle)]/50 px-5 py-3.5 flex gap-3 items-center ${row % 2 !== 0 ? 'bg-[var(--surface-card)]/20' : ''}`}>
                {[120, 56, 80, 80, 56, 40, 64].map((w, col) => (
                  <div key={col} className="h-4 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ width: w, animationDelay: `${1110 + row * 35 + col * 15}ms` }} />
                ))}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
