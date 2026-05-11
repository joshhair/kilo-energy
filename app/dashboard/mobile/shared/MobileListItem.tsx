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
  // Title wrapping behavior (changed 2026-05-10): previously `truncate`
  // (single line + ellipsis). Replaced with `line-clamp-2 break-words` so
  // long titles — especially customer names in project lists — can wrap
  // to 2 lines instead of getting clipped at 6-8 characters by the right-
  // slot pill. Two-line cap keeps card heights bounded for the silly-long
  // edge case. break-words handles the rare unbroken super-long string.
  //
  // Subtitle keeps single-line truncate — it's metadata (date, count,
  // status text), not load-bearing identity. Wrapping subtitle would
  // make rows visually inconsistent without a real readability win.
  //
  // items-start (was items-center): when title wraps to 2 lines, the
  // right slot (badge / chevron) should anchor to the first line of the
  // title rather than the vertical center of the wrapped block — keeps
  // alignment predictable across short + long titles in the same list.
  const content = (
    <>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-base font-medium line-clamp-2 break-words" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{title}</p>
        {subtitle && <p className="text-base mt-0.5 truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{subtitle}</p>}
      </div>
      <div className="flex items-start gap-2 shrink-0 pt-0.5">
        {right}
        {onTap && <ChevronRight className="w-4 h-4 mt-1" style={{ color: 'var(--text-dim)' }} />}
      </div>
    </>
  );

  if (onTap) {
    return (
      <button onClick={onTap} className="w-full flex items-start gap-3 min-h-[48px] py-3 px-1 text-left active:opacity-80 transition-opacity">
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-start gap-3 min-h-[48px] py-3 px-1">
      {content}
    </div>
  );
}
