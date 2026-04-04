'use client';

export default function MobileStatCard({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-xl p-4 border border-slate-800/40" style={{ background: 'rgba(15, 25, 45, 0.6)' }}>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}
