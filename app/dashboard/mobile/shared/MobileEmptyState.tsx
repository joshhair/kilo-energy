'use client';

import type { ComponentType } from 'react';

/**
 * Empty/no-data state. Premium spec: wrap in a card-surface frame so it
 * reads as "intentional empty," not "the page failed to load." Icon
 * dimmed, headline in muted body text, subtitle smaller below.
 */
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
    <div
      className="card-surface rounded-2xl flex flex-col items-center justify-center py-10 px-6 gap-3"
      style={{ border: '1px dashed var(--border-subtle)' }}
    >
      {Icon && <span style={{ color: 'var(--text-dim)' }}><Icon className="w-10 h-10" /></span>}
      <p
        className="text-base font-medium text-center"
        style={{
          color: 'var(--text-secondary)',
          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
        }}
      >{title}</p>
      {subtitle && (
        <p
          className="text-sm text-center max-w-[260px] leading-relaxed"
          style={{
            color: 'var(--text-dim)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >{subtitle}</p>
      )}
    </div>
  );
}
