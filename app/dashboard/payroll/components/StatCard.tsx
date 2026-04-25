'use client';

const STAT_CARD_STYLES: Record<string, { bg: string; border: string; accent: string; textColor: string }> = {
  'from-blue-500 to-blue-400':       { bg: 'linear-gradient(135deg, #040c1c, #060e22)', border: 'var(--accent-blue-solid)30', accent: 'var(--accent-blue-solid)', textColor: 'var(--accent-blue-solid)' },
  'from-yellow-500 to-yellow-400':   { bg: 'linear-gradient(135deg, #120b00, #180e00)', border: 'var(--accent-amber-solid)30', accent: 'var(--accent-amber-solid)', textColor: 'var(--accent-amber-solid)' },
  'from-emerald-500 to-emerald-400': { bg: 'linear-gradient(135deg, #00160d, #001c10)', border: '#00e07a30', accent: 'var(--accent-emerald-solid)', textColor: 'var(--accent-emerald-solid)' },
};

export function StatCard({ label, value, color: _color, accentGradient, className, entryCount }: { label: string; value: number; color: string; border?: string; accentGradient?: string; className?: string; entryCount?: number }) {
  const accent = accentGradient ?? 'from-blue-500 to-blue-400';
  const s = STAT_CARD_STYLES[accent] ?? { bg: 'var(--surface-card)', border: 'var(--border)', accent: 'var(--accent-blue-solid)', textColor: 'var(--accent-blue-solid)' };
  return (
    <div
      className={`rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] ${className ?? ''}`}
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <div className="h-[2px] w-12 rounded-full mb-3" style={{ background: s.accent }} />
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
        {entryCount !== undefined && (
          <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-dim)' }}>{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
        )}
      </div>
      <p className="stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up" style={{ color: s.textColor, fontFamily: "'DM Serif Display', serif", textShadow: `0 0 20px ${s.accent}40` }}>${value.toLocaleString()}</p>
    </div>
  );
}

export function ReimBadge({ status }: { status: string }) {
  const st =
    status === 'Approved' ? { background: 'rgba(0,224,122,0.12)', color: 'var(--accent-emerald-solid)' }
    : status === 'Pending'  ? { background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber-solid)' }
    : { background: 'rgba(255,82,82,0.12)', color: 'var(--accent-red-solid)' };
  return <span className="px-2 py-0.5 rounded text-xs font-medium" style={st}>{status}</span>;
}
