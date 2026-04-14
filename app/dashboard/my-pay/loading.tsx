export default function MyPayLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="h-8 w-44 rounded-lg bg-[var(--surface-card)] animate-skeleton" />

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--border)]/40 bg-[var(--surface-card)]/30 p-5 space-y-3"
          >
            <div className="h-10 w-10 rounded-xl bg-[var(--border)]/60 animate-skeleton" style={{ animationDelay: `${i * 100}ms` }} />
            <div className="h-4 w-28 rounded bg-[var(--border)]/60 animate-skeleton" style={{ animationDelay: `${i * 100 + 50}ms` }} />
            <div className="h-3 w-full rounded bg-[var(--surface-card)]/50 animate-skeleton" style={{ animationDelay: `${i * 100 + 100}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
