'use client';

import { ChevronRight } from 'lucide-react';

export default function MobileListItem({
  title,
  subtitle,
  right,
  onTap,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onTap?: () => void;
  icon?: React.ReactNode;
}) {
  const content = (
    <>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-base font-medium text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{title}</p>
        {subtitle && <p className="text-base mt-0.5 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {right}
        {onTap && <ChevronRight className="w-4 h-4" style={{ color: 'var(--m-text-dim, #445577)' }} />}
      </div>
    </>
  );

  if (onTap) {
    return (
      <button onClick={onTap} className="w-full flex items-center gap-3 min-h-[48px] py-3 px-1 text-left active:opacity-80 transition-opacity">
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 min-h-[48px] py-3 px-1">
      {content}
    </div>
  );
}
