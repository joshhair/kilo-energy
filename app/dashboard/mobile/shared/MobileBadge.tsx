'use client';

const PHASE_COLORS: Record<string, string> = {
  'New': 'bg-sky-900/40 text-sky-300 border-sky-700/30',
  'Acceptance': 'bg-indigo-900/40 text-indigo-300 border-indigo-700/30',
  'Site Survey': 'bg-violet-900/40 text-violet-300 border-violet-700/30',
  'Design': 'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-700/30',
  'Permitting': 'bg-amber-900/40 text-amber-300 border-amber-700/30',
  'Pending Install': 'bg-orange-900/40 text-orange-300 border-orange-700/30',
  'Installed': 'bg-teal-900/40 text-teal-300 border-teal-700/30',
  'PTO': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30',
  'Completed': 'bg-green-900/40 text-green-300 border-green-600/30',
  'Cancelled': 'bg-red-900/40 text-red-300 border-red-700/30',
  'On Hold': 'bg-slate-800/40 text-slate-400 border-slate-600/30',
};

const STATUS_COLORS: Record<string, string> = {
  'Draft': 'bg-slate-800/60 text-slate-400 border-slate-600/30',
  'Pending': 'bg-amber-900/40 text-amber-300 border-amber-700/30',
  'Paid': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30',
  'Approved': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30',
  'Denied': 'bg-red-900/40 text-red-300 border-red-700/30',
  'Rejected': 'bg-red-900/40 text-red-300 border-red-700/30',
};

export default function MobileBadge({ value, variant = 'phase' }: { value: string; variant?: 'phase' | 'status' }) {
  const colors = variant === 'phase' ? PHASE_COLORS : STATUS_COLORS;
  const cls = colors[value] ?? 'bg-slate-800/60 text-slate-400 border-slate-600/30';
  return (
    <span className={`inline-flex items-center min-h-[30px] px-3.5 py-1.5 text-xs font-semibold rounded-full border ${cls}`}>
      {value}
    </span>
  );
}
