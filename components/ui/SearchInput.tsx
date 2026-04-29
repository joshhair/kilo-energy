'use client';

/**
 * <SearchInput> — input with a left-aligned magnifying-glass icon.
 * Used everywhere a Settings panel filters a list (Financers,
 * Installers, BlitzPermissions, SubDealers, etc.). Identical pattern
 * across all 7 prior call sites — extracted to one place so a future
 * "add a clear-X button" or "wire up keyboard shortcut" change ships
 * everywhere at once.
 */

import React from 'react';
import { Search } from 'lucide-react';

type SearchInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Default 'Search...' — overridable per-section ("Search financers..."). */
  placeholder?: string;
};

export function SearchInput({
  placeholder = 'Search...',
  className = '',
  ...rest
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
      <input
        {...rest}
        type="text"
        placeholder={placeholder}
        className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)] transition-colors"
      />
    </div>
  );
}
