'use client';

interface StatItem {
  label: string;
  value: number;
  color: string;
  bg: string;
}

interface Props { items: StatItem[] }

export function SettingsStatGrid({ items }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {items.map(({ label, value, color, bg }) => (
        <div
          key={label}
          className={`${bg} border rounded-2xl p-4 flex flex-col gap-1`}
        >
          <span className={`text-2xl font-black tabular-nums leading-none ${color}`}>{value}</span>
          <span className="text-xs text-[var(--text-muted)] leading-tight">{label}</span>
        </div>
      ))}
    </div>
  );
}
