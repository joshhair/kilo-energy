'use client';

// Exported so other mobile components (e.g. the Recent Projects list
// in MobileDashboard) can reuse the same palette for left-edge accent
// strips, without duplicating the map.
export const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  'New':             { bg: 'rgba(0,229,160,0.12)', text: 'var(--accent-emerald)' },
  'Acceptance':      { bg: 'rgba(0,180,216,0.12)', text: 'var(--accent-cyan2)' },
  'Site Survey':     { bg: 'rgba(245,166,35,0.12)', text: '#f5a623' },
  'Design':          { bg: 'rgba(168,85,247,0.12)', text: '#a855f7' },
  'Permitting':      { bg: 'rgba(245,166,35,0.12)', text: '#f5a623' },
  'Pending Install': { bg: 'rgba(251,146,60,0.12)', text: '#fb923c' },
  'Installed':       { bg: 'rgba(0,180,216,0.12)', text: 'var(--accent-cyan2)' },
  'PTO':             { bg: 'rgba(0,229,160,0.12)', text: 'var(--accent-emerald)' },
  'Completed':       { bg: 'rgba(0,229,160,0.12)', text: 'var(--accent-emerald)' },
  'Cancelled':       { bg: 'rgba(255,107,107,0.12)', text: 'var(--accent-danger)' },
  'On Hold':         { bg: 'rgba(136,153,170,0.12)', text: 'var(--text-mobile-muted)' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Draft':     { bg: 'rgba(136,153,170,0.12)', text: 'var(--text-mobile-muted)' },
  'Pending':   { bg: 'rgba(245,166,35,0.12)',  text: '#f5a623' },
  'Paid':      { bg: 'rgba(0,229,160,0.12)',   text: 'var(--accent-emerald)' },
  'Approved':  { bg: 'rgba(0,229,160,0.12)',   text: 'var(--accent-emerald)' },
  'Denied':    { bg: 'rgba(255,107,107,0.12)', text: 'var(--accent-danger)' },
  'Rejected':  { bg: 'rgba(255,107,107,0.12)', text: 'var(--accent-danger)' },
  'Upcoming':  { bg: 'rgba(0,180,216,0.13)',   text: 'var(--accent-cyan2)' },
  'Active':    { bg: 'rgba(0,229,160,0.14)',   text: 'var(--accent-emerald)' },
  'Completed': { bg: 'rgba(0,229,160,0.08)',   text: 'var(--accent-emerald)' },
  'Cancelled': { bg: 'rgba(255,107,107,0.12)', text: 'var(--accent-danger)' },
};

export default function MobileBadge({ value, variant = 'phase' }: { value: string; variant?: 'phase' | 'status' }) {
  const colors = variant === 'phase' ? PHASE_COLORS : STATUS_COLORS;
  const c = colors[value] ?? { bg: 'rgba(136,153,170,0.12)', text: 'var(--text-mobile-muted)' };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-sm font-semibold rounded-full whitespace-nowrap${value === 'Active' ? ' badge-active-pulse' : ''}`}
      style={{ background: c.bg, color: c.text, fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
    >
      {value}
    </span>
  );
}
