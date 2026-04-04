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
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {Icon && <Icon className="w-10 h-10 text-slate-700" />}
      <p className="text-base font-medium text-slate-400">{title}</p>
      {subtitle && <p className="text-sm text-slate-600 text-center max-w-[200px]">{subtitle}</p>}
    </div>
  );
}
