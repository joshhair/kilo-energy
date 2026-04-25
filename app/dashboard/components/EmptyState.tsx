'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'card' | 'inline';
};

/**
 * Canonical empty-state presentation. Matches the dashed-border card
 * pattern already used across blitz, training, payroll. Use `inline`
 * for table rows / small slots where a full card is too heavy.
 */
export function EmptyState({ icon: Icon, title, description, action, variant = 'card' }: EmptyStateProps) {
  if (variant === 'inline') {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
        {Icon && <Icon className="w-10 h-10" style={{ color: 'var(--text-dim)' }} />}
        <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{title}</p>
        {description && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>}
        {action && (
          <button
            onClick={action.onClick}
            className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors"
            style={{ background: 'rgba(0,224,122,0.12)', color: 'var(--accent-emerald-text)', border: '1px solid rgba(0,224,122,0.3)' }}
          >
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center py-24 gap-3 rounded-xl"
      style={{ background: 'rgba(22,25,32,0.5)', border: '1px dashed var(--border)' }}
    >
      {Icon && <Icon className="w-16 h-16" style={{ color: 'var(--text-dim)' }} />}
      <div className="text-center">
        <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
        {description && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{description}</p>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
          style={{ background: 'rgba(0,224,122,0.12)', color: 'var(--accent-emerald-text)', border: '1px solid rgba(0,224,122,0.3)' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
