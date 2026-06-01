'use client';
export default function BlitzDetailSkeleton() {
  const p = { background: 'var(--surface-card)' } as React.CSSProperties;
  const pd = { ...p, opacity: 0.6 } as React.CSSProperties;
  return (
    <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
      {/* Back button */}
      <div className="h-6 w-14 rounded animate-pulse" style={pd} />
      {/* Title block */}
      <div className="space-y-2">
        <div className="h-7 w-52 rounded animate-pulse" style={p} />
        <div className="h-5 w-16 rounded-full animate-pulse" style={{ ...p, animationDelay: '40ms' }} />
        <div className="h-4 w-40 rounded animate-pulse" style={{ ...pd, animationDelay: '80ms' }} />
      </div>
      {/* Tab strip — 5 pill rects matching real tab widths */}
      <div className="flex gap-2 pt-2">
        {([80, 48, 52, 54, 54] as number[]).map((w, i) => (
          <div key={i} className="h-8 rounded-full flex-shrink-0 animate-pulse" style={{ width: w, background: 'var(--surface-card)', animationDelay: `${i * 40}ms` }} />
        ))}
      </div>
      {/* 3-col stat grid (matches BlitzOverview) */}
      <div className="grid grid-cols-3 gap-2">
        {[0, 70, 140].map((delay) => (
          <div key={delay} className="rounded-xl h-[62px] animate-pulse" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', animationDelay: `${delay}ms` }} />
        ))}
      </div>
      {/* Leaderboard card skeleton */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="h-3.5 w-28 rounded animate-pulse" style={pd} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full animate-pulse flex-shrink-0" style={{ background: 'var(--surface-pressed)', animationDelay: `${i * 60}ms` }} />
            <div className="h-4 rounded animate-pulse flex-1" style={{ background: 'var(--surface-pressed)', animationDelay: `${i * 60 + 20}ms` }} />
            <div className="h-3.5 w-16 rounded animate-pulse flex-shrink-0" style={{ ...pd, animationDelay: `${i * 60 + 40}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
