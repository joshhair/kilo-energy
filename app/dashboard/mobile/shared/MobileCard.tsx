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
        background: 'linear-gradient(135deg, #0a1628 0%, #0d2040 100%)',
        border: '1px solid rgba(0,229,160,0.12)',
        boxShadow: '0 0 40px rgba(0,229,160,0.06)',
      }
    : {
        background: 'var(--m-card, #0d1525)',
        border: '1px solid var(--m-border, #1a2840)',
      };

  const base = `rounded-2xl p-5 relative overflow-hidden ${className}`;

  if (onTap) {
    return (
      <button onClick={onTap} className={`${base} w-full text-left transition-[transform,opacity] duration-150 active:scale-[0.97] active:opacity-90`} style={{ ...heroStyle, ...style, transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        {hero && <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #00e5a0 0%, transparent 70%)' }} />}
        {children}
      </button>
    );
  }

  return (
    <div className={base} style={{ ...heroStyle, ...style }}>
      {hero && <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #00e5a0 0%, transparent 70%)' }} />}
      {children}
    </div>
  );
}
