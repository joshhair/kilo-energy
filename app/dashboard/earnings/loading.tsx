export default function EarningsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="h-8 w-36 rounded-lg bg-slate-800 animate-skeleton" />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 space-y-3"
          >
            <div className="h-4 w-24 rounded bg-slate-700/60 animate-skeleton" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="h-8 w-32 rounded bg-slate-800 animate-skeleton" style={{ animationDelay: `${i * 120 + 60}ms` }} />
          </div>
        ))}
      </div>

      {/* Table rows */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-5 py-4 border-b border-slate-700/20 last:border-b-0"
          >
            <div className="h-4 w-28 rounded bg-slate-700/60 animate-skeleton" style={{ animationDelay: `${i * 80 + 360}ms` }} />
            <div className="h-4 w-20 rounded bg-slate-800 animate-skeleton ml-auto" style={{ animationDelay: `${i * 80 + 400}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
