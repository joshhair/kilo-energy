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
      {Icon && <Icon className="w-12 h-12 text-slate-600" />}
      <p className="text-base font-medium text-slate-400">{title}</p>
      {subtitle && <p className="text-sm text-slate-500 text-center max-w-[240px]">{subtitle}</p>}
    </div>
  );
}
