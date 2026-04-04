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
    <div className="rounded-2xl p-4 bg-slate-900/60 border border-slate-800/20">
      <p className={`text-3xl font-black tabular-nums ${color}`}>{value}</p>
      <p className="text-base text-slate-400 mt-1">{label}</p>
    </div>
  );
}
