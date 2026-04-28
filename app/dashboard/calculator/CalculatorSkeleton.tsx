'use client';
export function CalculatorSkeleton() {
  return (
    <div className="p-4 md:p-8" style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-[var(--border)] animate-skeleton mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div className="h-9 w-9 bg-[var(--surface-card)] rounded-lg animate-skeleton" style={{ animationDelay: '50ms' }} />
          <div className="h-8 w-64 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '100ms' }} />
        </div>
        <div className="h-3 w-80 bg-[var(--surface-card)]/70 rounded animate-skeleton ml-12 mt-1" style={{ animationDelay: '150ms' }} />
      </div>
      {/* 2-col body matching actual layout */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left: 420px form column */}
        <div style={{ flex: '0 0 420px' }}>
          {/* Quick Fill card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div className="h-3 w-20 bg-[var(--border)]/70 rounded animate-skeleton mb-2.5" />
            <div className="h-10 w-full bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: '30ms' }} />
          </div>
          {/* Main form card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }} className="space-y-5">
            {[{ w: 'w-16', d: 0 }, { w: 'w-24', d: 60 }, { w: 'w-20', d: 120 }, { w: 'w-28', d: 180 }].map(({ w, d }, i) => (
              <div key={i}>
                <div className={`h-3 ${w} bg-[var(--border)]/70 rounded animate-skeleton mb-2`} style={{ animationDelay: `${d}ms` }} />
                <div className="h-10 w-full bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: `${d + 30}ms` }} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-4">
              {[240, 300].map((d) => (
                <div key={d}>
                  <div className="h-3 w-16 bg-[var(--border)]/70 rounded animate-skeleton mb-2" style={{ animationDelay: `${d}ms` }} />
                  <div className="h-10 w-full bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: `${d + 30}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Right: results panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
            <div className="h-3 w-28 bg-[var(--border)]/70 rounded animate-skeleton mb-5" style={{ animationDelay: '100ms' }} />
            <div className="h-4 w-24 bg-[var(--border)]/70 rounded animate-skeleton mb-2" style={{ animationDelay: '130ms' }} />
            <div className="h-12 w-40 bg-[var(--surface-card)] rounded animate-skeleton mb-1" style={{ animationDelay: '160ms' }} />
            <div className="h-3 w-48 bg-[var(--border)]/50 rounded animate-skeleton mb-5" style={{ animationDelay: '190ms' }} />
            <div className="h-2 w-full bg-[var(--surface-card)] rounded-full animate-skeleton mb-5" style={{ animationDelay: '220ms' }} />
            <div className="flex gap-6 mb-5 pb-5" style={{ borderBottom: '1px solid var(--border)' }}>
              {[250, 310, 370].map((d) => (
                <div key={d}>
                  <div className="h-5 w-12 bg-[var(--surface-card)] rounded animate-skeleton mb-1.5" style={{ animationDelay: `${d}ms` }} />
                  <div className="h-3 w-20 bg-[var(--border)]/50 rounded animate-skeleton" style={{ animationDelay: `${d + 30}ms` }} />
                </div>
              ))}
            </div>
            {[400, 460, 520].map((d) => (
              <div key={d} className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--border)] animate-skeleton" style={{ animationDelay: `${d}ms` }} />
                  <div className="h-3 w-20 bg-[var(--border)]/70 rounded animate-skeleton" style={{ animationDelay: `${d + 20}ms` }} />
                </div>
                <div className="h-5 w-16 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${d + 40}ms` }} />
              </div>
            ))}
            <div style={{ background: 'var(--surface-card)', borderRadius: 14, padding: '18px 20px', marginTop: 20 }}>
              <div className="h-3 w-28 bg-[var(--border)]/70 rounded animate-skeleton mb-3" style={{ animationDelay: '580ms' }} />
              <div className="h-12 w-32 bg-[var(--border)] rounded animate-skeleton" style={{ animationDelay: '620ms' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
