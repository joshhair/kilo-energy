'use client';

const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  'New':             { bg: 'rgba(0,229,160,0.12)', text: '#00e5a0' },
  'Acceptance':      { bg: 'rgba(0,180,216,0.12)', text: '#00b4d8' },
  'Site Survey':     { bg: 'rgba(245,166,35,0.12)', text: '#f5a623' },
  'Design':          { bg: 'rgba(168,85,247,0.12)', text: '#a855f7' },
  'Permitting':      { bg: 'rgba(245,166,35,0.12)', text: '#f5a623' },
  'Pending Install': { bg: 'rgba(251,146,60,0.12)', text: '#fb923c' },
  'Installed':       { bg: 'rgba(0,180,216,0.12)', text: '#00b4d8' },
  'PTO':             { bg: 'rgba(0,229,160,0.12)', text: '#00e5a0' },
  'Completed':       { bg: 'rgba(0,229,160,0.12)', text: '#00e5a0' },
  'Cancelled':       { bg: 'rgba(255,107,107,0.12)', text: '#ff6b6b' },
  'On Hold':         { bg: 'rgba(136,153,170,0.12)', text: '#8899aa' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Draft':    { bg: 'rgba(136,153,170,0.12)', text: '#8899aa' },
  'Pending':  { bg: 'rgba(245,166,35,0.12)',  text: '#f5a623' },
  'Paid':     { bg: 'rgba(0,229,160,0.12)',   text: '#00e5a0' },
  'Approved': { bg: 'rgba(0,229,160,0.12)',   text: '#00e5a0' },
  'Denied':   { bg: 'rgba(255,107,107,0.12)', text: '#ff6b6b' },
  'Rejected': { bg: 'rgba(255,107,107,0.12)', text: '#ff6b6b' },
};

export default function MobileBadge({ value, variant = 'phase' }: { value: string; variant?: 'phase' | 'status' }) {
  const colors = variant === 'phase' ? PHASE_COLORS : STATUS_COLORS;
  const c = colors[value] ?? { bg: 'rgba(136,153,170,0.12)', text: '#8899aa' };
  return (
    <span
      className="inline-flex items-center px-3 py-1 text-sm font-semibold rounded-full"
      style={{ background: c.bg, color: c.text, fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
    >
      {value}
    </span>
  );
}
