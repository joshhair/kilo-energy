'use client';

export default function MobileCard({
  children,
  onTap,
  className = '',
  accent,
}: {
  children: React.ReactNode;
  onTap?: () => void;
  className?: string;
  accent?: 'red' | 'blue' | 'emerald' | 'amber';
}) {
  const accentBorder = accent
    ? { red: 'border-l-2 border-l-red-500', blue: 'border-l-2 border-l-blue-500', emerald: 'border-l-2 border-l-emerald-500', amber: 'border-l-2 border-l-amber-500' }[accent]
    : '';
  const base = `rounded-xl p-5 border border-slate-800/30 ${accentBorder} ${className}`;
  const bg = 'background: rgba(15, 25, 45, 0.6)';

  if (onTap) {
    return (
      <button onClick={onTap} className={`${base} w-full text-left active:bg-slate-800/50 transition-colors`} style={{ [bg.split(':')[0]]: bg.split(':')[1] }}>
        {children}
      </button>
    );
  }

  return (
    <div className={base} style={{ background: 'rgba(15, 25, 45, 0.6)' }}>
      {children}
    </div>
  );
}
