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
  // Hero identity comes from the subtle surface gradient + hairline
  // emerald-tinted border. No halo glow, no radial orb — premium spec
  // calls for card-surface vocabulary, and the orb fights the My Pay
  // numerals that the hero variant is meant to showcase.
  const heroStyle: React.CSSProperties = hero
    ? {
        background: 'linear-gradient(135deg, var(--surface-card) 0%, var(--surface-elevated) 100%)',
        border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 28%, transparent)',
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
        {children}
      </button>
    );
  }

  return (
    <div className={base} style={{ ...heroStyle, ...style }} {...(hero ? { 'data-hero-card': '' } : {})}>
      {children}
    </div>
  );
}
