'use client';

const PHASE_COLORS: Record<string, string> = {
  'New': 'bg-sky-900/30 text-sky-300',
  'Acceptance': 'bg-indigo-900/30 text-indigo-300',
  'Site Survey': 'bg-violet-900/30 text-violet-300',
  'Design': 'bg-fuchsia-900/30 text-fuchsia-300',
  'Permitting': 'bg-amber-900/30 text-amber-300',
  'Pending Install': 'bg-orange-900/30 text-orange-300',
  'Installed': 'bg-teal-900/30 text-teal-300',
  'PTO': 'bg-emerald-900/30 text-emerald-300',
  'Completed': 'bg-green-900/30 text-green-300',
  'Cancelled': 'bg-red-900/30 text-red-300',
  'On Hold': 'bg-slate-800/40 text-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  'Draft': 'bg-slate-800/40 text-slate-400',
  'Pending': 'bg-amber-900/30 text-amber-300',
  'Paid': 'bg-emerald-900/30 text-emerald-300',
  'Approved': 'bg-emerald-900/30 text-emerald-300',
  'Denied': 'bg-red-900/30 text-red-300',
  'Rejected': 'bg-red-900/30 text-red-300',
};

export default function MobileBadge({ value, variant = 'phase' }: { value: string; variant?: 'phase' | 'status' }) {
  const colors = variant === 'phase' ? PHASE_COLORS : STATUS_COLORS;
  const cls = colors[value] ?? 'bg-slate-800/40 text-slate-400';
  return (
    <span className={`inline-flex items-center min-h-[26px] px-2.5 py-0.5 text-xs font-semibold rounded-lg ${cls}`}>
      {value}
    </span>
  );
}
