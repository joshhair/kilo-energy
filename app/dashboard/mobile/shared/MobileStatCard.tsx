'use client';

const ACCENT_BORDERS: Record<string, string> = {
  emerald: 'border-t-2 border-t-emerald-500',
  blue: 'border-t-2 border-t-blue-500',
  amber: 'border-t-2 border-t-amber-500',
  red: 'border-t-2 border-t-red-500',
};

export default function MobileStatCard({
  label,
  value,
  color = 'text-white',
  accent,
}: {
  label: string;
  value: string | number;
  color?: string;
  accent?: 'emerald' | 'blue' | 'amber' | 'red';
}) {
  const accentBorder = accent ? ACCENT_BORDERS[accent] : '';
  return (
    <div className={`rounded-xl p-5 border border-slate-800/40 shadow-sm shadow-black/20 ${accentBorder}`} style={{ background: 'rgba(15, 25, 45, 0.6)' }}>
      <p className={`text-3xl font-black tabular-nums ${color}`}>{value}</p>
      <p className="text-sm text-slate-500 mt-1.5 tracking-wide">{label}</p>
    </div>
  );
}
