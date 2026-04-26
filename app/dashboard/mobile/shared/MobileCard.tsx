'use client';

export default function MobileCard({
  children,
  onTap,
  className = '',
  hero,
  style,
}: {
  children: React.ReactNode;
  onTap?: () => void;
  className?: string;
  hero?: boolean;
  style?: React.CSSProperties;
}) {
  // Hero gradient was surface-page → surface-pressed, which in light mode
  // is #eaeef4 → #dde2ec — DARKER than a regular card, killing the punch
  // of accent-display hero numbers. Switching to surface-card →
  // surface-elevated gives a subtle navy variation in dark mode (#161920
  // → #1d2028) and pure white in light mode, so emerald display stats
  // sit on the contrasty white surface they need. Hero identity now comes
  // from the emerald-soft border + glow orb + box shadow, not the bg.
  const heroStyle: React.CSSProperties = hero
    ? {
        background: 'linear-gradient(135deg, var(--surface-card) 0%, var(--surface-elevated) 100%)',
        border: '1px solid var(--accent-emerald-soft)',
        boxShadow: '0 0 40px var(--accent-emerald-soft)',
        animationName: 'heroCardEnter',
        animationDuration: '420ms',
        animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        animationFillMode: 'both',
        animationDelay: '60ms',
      }
    : {
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
      };

  const base = `rounded-2xl p-5 relative overflow-hidden ${className}`;

  if (onTap) {
    return (
      <button onClick={onTap} className={`${base} w-full text-left transition-[transform,opacity] duration-150 active:scale-[0.97] active:opacity-90`} style={{ ...heroStyle, ...style, transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }} {...(hero ? { 'data-hero-card': '' } : {})}>
        {hero && <div className="hero-glow-orb absolute -top-8 -right-8 h-32 w-32 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, var(--accent-emerald-solid) 0%, transparent 70%)' }} />}
        {children}
      </button>
    );
  }

  return (
    <div className={base} style={{ ...heroStyle, ...style }} {...(hero ? { 'data-hero-card': '' } : {})}>
      {hero && <div className="hero-glow-orb absolute -top-8 -right-8 h-32 w-32 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, var(--accent-emerald-solid) 0%, transparent 70%)' }} />}
      {children}
    </div>
  );
}
