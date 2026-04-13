'use client';

/** Column placeholder widths for the Rep "Recent Projects" table (7 cols). */
const DASH_TABLE_WIDTHS = ['w-36', 'w-14', 'w-20', 'w-10', 'w-16', 'w-14', 'w-14'] as const;

export function SkeletonCell({ width, delay }: { width: string; delay: number }) {
  return (
    <td className="px-6 py-3">
      <div
        className={`h-4 ${width} bg-[#1d2028] rounded animate-skeleton`}
        style={{ animationDelay: `${delay}ms` }}
      />
    </td>
  );
}

export function SkeletonRow({ index, cols }: { index: number; cols: readonly string[] }) {
  const delay = index * 75;
  return (
    <tr className="border-b border-[#333849]/50">
      {cols.map((w, ci) => (
        <SkeletonCell key={ci} width={w} delay={delay} />
      ))}
    </tr>
  );
}

export function SkeletonCard({ index }: { index: number }) {
  const delay = index * 75;
  return (
    <div className="card-surface rounded-2xl p-5 h-full space-y-3">
      <div className="h-[2px] w-12 bg-[#272b35] rounded-full animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
        <div className="h-4 w-4 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      </div>
      <div className="h-8 w-24 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="h-3 w-20 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-[#1d2028] rounded animate-skeleton" />
          <div className="h-3 w-64 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-8 w-20 bg-[#1d2028] rounded-lg animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
          ))}
        </div>
      </div>

      {/* MTD mini-card */}
      <div className="card-surface rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-4 w-4 bg-[#1d2028] rounded animate-skeleton" />
          <div className="h-4 w-40 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-8 w-12 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
              <div className="h-3 w-20 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid — 5 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        {[...Array(5)].map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>

      {/* Recent Projects table */}
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 border-b border-[#333849]">
          <div className="h-5 w-36 bg-[#1d2028] rounded animate-skeleton" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header-frost">
              <tr className="border-b border-[#333849]">
                {DASH_TABLE_WIDTHS.map((_, i) => (
                  <th key={i} className="text-left px-6 py-3">
                    <div className="h-3 w-10 bg-[#1d2028]/60 rounded animate-skeleton" style={{ animationDelay: `${i * 40}ms` }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(3)].map((_, i) => (
                <SkeletonRow key={i} index={i} cols={DASH_TABLE_WIDTHS} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
