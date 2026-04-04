'use client';

import { ChevronRight } from 'lucide-react';

export default function MobileListItem({
  title,
  subtitle,
  right,
  onTap,
  accent,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onTap?: () => void;
  accent?: 'red';
}) {
  const content = (
    <>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {right}
        {onTap && <ChevronRight className="w-4 h-4 text-slate-600" />}
      </div>
    </>
  );

  if (onTap) {
    return (
      <button
        onClick={onTap}
        className={`w-full flex items-center gap-3 min-h-[52px] py-3 px-4 text-left active:bg-slate-800/50 transition-colors ${accent === 'red' ? 'border-l-2 border-l-red-500' : ''}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-3 min-h-[52px] py-3 px-4 ${accent === 'red' ? 'border-l-2 border-l-red-500' : ''}`}>
      {content}
    </div>
  );
}
