'use client';

// Outlined ghost treatment: transparent bg + accent-display border (punchy,
// saturated) + accent-text text (4.5:1 readable). Breaks the green-on-green
// (or amber-on-amber, etc.) collapse the old soft-tinted bg pattern caused
// in light mode. PHASE_COLORS still exports the same shape (bg/text) so
// existing consumers like the Recent Projects accent-strip in
// MobileDashboard keep working — bg here is now the border color, used
// as a side-strip accent.
export const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  'New':             { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Acceptance':      { bg: 'var(--accent-cyan-display)',    text: 'var(--accent-cyan-text)' },
  'Site Survey':     { bg: 'var(--accent-amber-display)',   text: 'var(--accent-amber-text)' },
  'Design':          { bg: 'var(--accent-purple-display)',  text: 'var(--accent-purple-text)' },
  'Permitting':      { bg: 'var(--accent-amber-display)',   text: 'var(--accent-amber-text)' },
  'Pending Install': { bg: 'var(--accent-amber-display)',   text: 'var(--accent-amber-text)' },
  'Installed':       { bg: 'var(--accent-cyan-display)',    text: 'var(--accent-cyan-text)' },
  'PTO':             { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Completed':       { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Cancelled':       { bg: 'var(--accent-red-display)',     text: 'var(--accent-red-text)' },
  'On Hold':         { bg: 'var(--text-muted)',             text: 'var(--text-muted)' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Draft':     { bg: 'var(--text-muted)',             text: 'var(--text-muted)' },
  'Pending':   { bg: 'var(--accent-amber-display)',   text: 'var(--accent-amber-text)' },
  'Paid':      { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Approved':  { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Denied':    { bg: 'var(--accent-red-display)',     text: 'var(--accent-red-text)' },
  'Rejected':  { bg: 'var(--accent-red-display)',     text: 'var(--accent-red-text)' },
  'Upcoming':  { bg: 'var(--accent-cyan-display)',    text: 'var(--accent-cyan-text)' },
  'Active':    { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Completed': { bg: 'var(--accent-emerald-display)', text: 'var(--accent-emerald-text)' },
  'Cancelled': { bg: 'var(--accent-red-display)',     text: 'var(--accent-red-text)' },
};

export default function MobileBadge({
  value,
  variant = 'phase',
  size = 'md',
}: {
  value: string;
  variant?: 'phase' | 'status';
  /** `md` is the default (project detail header, etc.). `sm` is for
   *  list rows where long phase labels like "Pending Install" otherwise
   *  crowd out the customer name. */
  size?: 'md' | 'sm';
}) {
  const colors = variant === 'phase' ? PHASE_COLORS : STATUS_COLORS;
  // `bg` field is reused as the border color in the new outlined treatment.
  const c = colors[value] ?? { bg: 'var(--text-muted)', text: 'var(--text-muted)' };
  const sizing = size === 'sm'
    ? 'px-2 py-0.5 text-xs font-semibold'
    : 'px-3 py-1 text-sm font-semibold';
  return (
    <span
      className={`inline-flex items-center ${sizing} rounded-full whitespace-nowrap${value === 'Active' ? ' badge-active-pulse' : ''}`}
      style={{
        background: 'transparent',
        border: '1.5px solid ' + c.bg,
        color: c.text,
        fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
      }}
    >
      {value}
    </span>
  );
}
