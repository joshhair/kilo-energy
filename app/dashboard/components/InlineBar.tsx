interface InlineBarProps {
  value: number;
  max: number;
  fillClass?: string;
}

export function InlineBar({ value, max, fillClass = 'bg-[var(--accent-emerald-solid)]/70' }: InlineBarProps) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full h-3 rounded-full bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${fillClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
