export default function ProjectsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 rounded-lg bg-[#1d2028] animate-skeleton" />
        <div className="h-9 w-28 rounded-xl bg-[#1d2028] animate-skeleton" style={{ animationDelay: '60ms' }} />
      </div>

      {/* Filter bar placeholder */}
      <div className="h-10 w-full rounded-xl bg-[#1d2028]/40 animate-skeleton" style={{ animationDelay: '120ms' }} />

      {/* Table rows */}
      <div className="rounded-2xl border border-[#272b35]/40 bg-[#1d2028]/30 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-5 py-4 border-b border-[#272b35]/20 last:border-b-0"
          >
            <div className="h-4 w-32 rounded bg-[#272b35]/60 animate-skeleton" style={{ animationDelay: `${i * 80}ms` }} />
            <div className="h-4 w-24 rounded bg-[#1d2028] animate-skeleton" style={{ animationDelay: `${i * 80 + 40}ms` }} />
            <div className="h-4 w-20 rounded bg-[#1d2028]/50 animate-skeleton ml-auto" style={{ animationDelay: `${i * 80 + 80}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
