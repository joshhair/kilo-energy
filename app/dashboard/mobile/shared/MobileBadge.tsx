'use client';

// Exported so other mobile components (e.g. the Recent Projects list
// in MobileDashboard) can reuse the same palette for left-edge accent
// strips, without duplicating the map.
export const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  'New':             { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Acceptance':      { bg: 'var(--accent-cyan-soft)',    text: 'var(--accent-cyan-solid)' },
  'Site Survey':     { bg: 'var(--accent-amber-soft)',   text: 'var(--accent-amber-solid)' },
  'Design':          { bg: 'var(--accent-purple-soft)',  text: 'var(--accent-purple-solid)' },
  'Permitting':      { bg: 'var(--accent-amber-soft)',   text: 'var(--accent-amber-solid)' },
  'Pending Install': { bg: 'var(--accent-amber-soft)',   text: 'var(--accent-amber-solid)' },
  'Installed':       { bg: 'var(--accent-cyan-soft)',    text: 'var(--accent-cyan-solid)' },
  'PTO':             { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Completed':       { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Cancelled':       { bg: 'var(--accent-red-soft)',     text: 'var(--accent-red-solid)' },
  'On Hold':         { bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',     text: 'var(--text-muted)' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Draft':     { bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',  text: 'var(--text-muted)' },
  'Pending':   { bg: 'var(--accent-amber-soft)', text: 'var(--accent-amber-solid)' },
  'Paid':      { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Approved':  { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Denied':    { bg: 'var(--accent-red-soft)',   text: 'var(--accent-red-solid)' },
  'Rejected':  { bg: 'var(--accent-red-soft)',   text: 'var(--accent-red-solid)' },
  'Upcoming':  { bg: 'var(--accent-cyan-soft)',  text: 'var(--accent-cyan-solid)' },
  'Active':    { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Completed': { bg: 'var(--accent-emerald-soft)', text: 'var(--accent-emerald-solid)' },
  'Cancelled': { bg: 'var(--accent-red-soft)',   text: 'var(--accent-red-solid)' },
};

export default function MobileBadge({ value, variant = 'phase' }: { value: string; variant?: 'phase' | 'status' }) {
  const colors = variant === 'phase' ? PHASE_COLORS : STATUS_COLORS;
  const c = colors[value] ?? { bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)', text: 'var(--text-muted)' };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-sm font-semibold rounded-full whitespace-nowrap${value === 'Active' ? ' badge-active-pulse' : ''}`}
      style={{ background: c.bg, color: c.text, fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
    >
      {value}
    </span>
  );
}
