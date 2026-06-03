'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

type InactiveExpanderProps = {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function InactiveExpander({ label, count, isOpen, onToggle, children }: InactiveExpanderProps) {
  return (
    <div className="mt-6 pt-6 border-t border-dashed border-[var(--border)]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[var(--surface-card)]/60"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <ChevronRight
            className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
            style={{ color: 'var(--text-dim)' }}
          />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {label} ({count})
          </span>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
          Deactivated — click to {isOpen ? 'hide' : 'view'}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-0 ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="mt-3 space-y-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
