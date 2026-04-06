export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header placeholder */}
      <div className="h-8 w-48 rounded-lg bg-[#1d2028] animate-skeleton" />

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#272b35]/40 bg-[#1d2028]/30 p-5 space-y-3"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <div className="h-4 w-24 rounded bg-[#272b35]/60 animate-skeleton" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="h-8 w-32 rounded bg-[#1d2028] animate-skeleton" style={{ animationDelay: `${i * 120 + 60}ms` }} />
            <div className="h-3 w-full rounded bg-[#1d2028]/50 animate-skeleton" style={{ animationDelay: `${i * 120 + 120}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
