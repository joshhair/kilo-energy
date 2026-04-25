'use client';

// Theme-aware accent-tinted card surface. Uses color-mix to tint
// var(--surface-card) with the accent token at 10% — works in both
// dark (subtle accent on dark) and light (subtle accent on white).
const tinted = (accent: string) =>
  `linear-gradient(135deg, color-mix(in srgb, ${accent} 10%, var(--surface-card)) 0%, var(--surface-card) 100%)`;

const STAT_CARD_STYLES: Record<string, { bg: string; border: string; accent: string; textColor: string }> = {
  'from-blue-500 to-blue-400':       { bg: tinted('var(--accent-blue-solid)'),    border: 'var(--accent-blue-solid)',    accent: 'var(--accent-blue-solid)',    textColor: 'var(--accent-blue-solid)' },
  'from-yellow-500 to-yellow-400':   { bg: tinted('var(--accent-amber-solid)'),   border: 'var(--accent-amber-solid)',   accent: 'var(--accent-amber-solid)',   textColor: 'var(--accent-amber-solid)' },
  'from-emerald-500 to-emerald-400': { bg: tinted('var(--accent-emerald-solid)'), border: 'var(--accent-emerald-solid)', accent: 'var(--accent-emerald-solid)', textColor: 'var(--accent-emerald-solid)' },
};

export function StatCard({ label, value, color: _color, accentGradient, className, entryCount }: { label: string; value: number; color: string; border?: string; accentGradient?: string; className?: string; entryCount?: number }) {
  const accent = accentGradient ?? 'from-blue-500 to-blue-400';
  const s = STAT_CARD_STYLES[accent] ?? { bg: 'var(--surface-card)', border: 'var(--border-default)', accent: 'var(--accent-blue-solid)', textColor: 'var(--accent-blue-solid)' };
  return (
    <div
      className={`rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] ${className ?? ''}`}
      style={{ background: s.bg, border: `1px solid color-mix(in srgb, ${s.border} 25%, transparent)` }}
    >
      <div className="h-[2px] w-12 rounded-full mb-3" style={{ background: s.accent }} />
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
        {entryCount !== undefined && (
          <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-dim)' }}>{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
        )}
      </div>
      <p className="stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up" style={{ color: s.textColor, fontFamily: "'DM Serif Display', serif", textShadow: `0 0 20px color-mix(in srgb, ${s.accent} 25%, transparent)` }}>${value.toLocaleString()}</p>
    </div>
  );
}

export function ReimBadge({ status }: { status: string }) {
  const st =
    status === 'Approved' ? { background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-solid)' }
    : status === 'Pending'  ? { background: 'var(--accent-amber-soft)', color: 'var(--accent-amber-solid)' }
    : { background: 'var(--accent-red-soft)', color: 'var(--accent-red-solid)' };
  return <span className="px-2 py-0.5 rounded text-xs font-medium" style={st}>{status}</span>;
}
