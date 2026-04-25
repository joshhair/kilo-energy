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
  const heroStyle: React.CSSProperties = hero
    ? {
        background: 'linear-gradient(135deg, var(--surface-page) 0%, var(--surface-pressed) 100%)',
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
