'use client';

export default function MobileCard({
  children,
  onTap,
  className = '',
  accent,
  style: extraStyle,
}: {
  children: React.ReactNode;
  onTap?: () => void;
  className?: string;
  accent?: 'red' | 'blue' | 'emerald' | 'amber';
  style?: React.CSSProperties;
}) {
  const accentBorder = accent
    ? { red: 'border-l-2 border-l-red-500', blue: 'border-l-2 border-l-blue-500', emerald: 'border-l-2 border-l-emerald-500', amber: 'border-l-2 border-l-amber-500' }[accent]
    : '';
  const base = `rounded-xl p-5 border border-slate-800/30 shadow-sm shadow-black/20 ${accentBorder} ${className}`;

  if (onTap) {
    return (
      <button onClick={onTap} className={`${base} w-full text-left active:bg-slate-800/50 active:scale-[0.98] transition-all`} style={{ background: 'rgba(15, 25, 45, 0.6)', ...extraStyle }}>
        {children}
      </button>
    );
  }

  return (
    <div className={base} style={{ background: 'rgba(15, 25, 45, 0.6)', ...extraStyle }}>
      {children}
    </div>
  );
}
