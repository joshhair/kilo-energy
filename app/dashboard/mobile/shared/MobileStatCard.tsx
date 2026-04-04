'use client';

export default function MobileStatCard({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="rounded-2xl p-5 bg-slate-900/60 border border-slate-800/20">
      <p className={`text-3xl font-black tabular-nums ${color}`}>{value}</p>
      <p className="text-sm text-slate-500 mt-1.5">{label}</p>
    </div>
  );
}
