'use client';

export default function MobileStatCard({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-xl p-5 border border-slate-800/40" style={{ background: 'rgba(15, 25, 45, 0.6)' }}>
      <p className={`text-3xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-sm text-slate-500 mt-1.5">{label}</p>
    </div>
  );
}
