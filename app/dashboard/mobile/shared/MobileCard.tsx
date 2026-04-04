'use client';

export default function MobileCard({
  children,
  onTap,
  className = '',
  style,
}: {
  children: React.ReactNode;
  onTap?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const base = `rounded-2xl p-5 bg-slate-900/60 border border-slate-800/20 ${className}`;

  if (onTap) {
    return (
      <button onClick={onTap} className={`${base} w-full text-left active:bg-slate-800/40 transition-colors`} style={style}>
        {children}
      </button>
    );
  }

  return (
    <div className={base} style={style}>
      {children}
    </div>
  );
}
