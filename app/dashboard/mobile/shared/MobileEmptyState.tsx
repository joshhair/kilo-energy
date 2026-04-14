'use client';

import type { ComponentType } from 'react';

export default function MobileEmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      {Icon && <span style={{ color: 'var(--m-text-dim, #445577)' }}><Icon className="w-12 h-12" /></span>}
      <p className="text-base font-medium" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{title}</p>
      {subtitle && <p className="text-base text-center max-w-[260px]" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{subtitle}</p>}
    </div>
  );
}
