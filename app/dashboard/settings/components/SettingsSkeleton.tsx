'use client';

import React from 'react';

export function SettingsSkeleton() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar — 5 nav item lines matching real NAV groups */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--border-subtle)] p-4 pt-8 hidden md:block">
        <div className="mb-6">
          <div className="h-[3px] w-8 rounded-full bg-[var(--border)] animate-skeleton mb-3" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 bg-[var(--surface-card)] rounded-lg animate-skeleton" />
            <div className="h-6 w-20 bg-[var(--surface-card)] rounded animate-skeleton" />
          </div>
        </div>
        {/* Group label + 1 item, group label + 3 items, group label + 1 item = 5 items */}
        <div className="space-y-4">
          {/* Team group */}
          <div>
            <div className="h-2 w-10 bg-[var(--border)]/50 rounded animate-skeleton mb-1.5 ml-2" />
            <div className="h-9 bg-[var(--surface-card)]/60 rounded-xl animate-skeleton" style={{ animationDelay: '0ms' }} />
          </div>
          {/* Business group */}
          <div>
            <div className="h-2 w-14 bg-[var(--border)]/50 rounded animate-skeleton mb-1.5 ml-2" style={{ animationDelay: '50ms' }} />
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 bg-[var(--surface-card)]/60 rounded-xl animate-skeleton" style={{ animationDelay: `${i * 50}ms` }} />
              ))}
            </div>
          </div>
          {/* System group */}
          <div>
            <div className="h-2 w-12 bg-[var(--border)]/50 rounded animate-skeleton mb-1.5 ml-2" style={{ animationDelay: '200ms' }} />
            <div className="h-9 bg-[var(--surface-card)]/60 rounded-xl animate-skeleton" style={{ animationDelay: '250ms' }} />
          </div>
        </div>
      </aside>

      {/* Content area — 3 card placeholders */}
      <main className="flex-1 p-8">
        <div className="max-w-xl">
          {/* Page heading */}
          <div className="h-7 w-40 bg-[var(--surface-card)] rounded animate-skeleton mb-1" />
          <div className="h-4 w-64 bg-[var(--surface-card)]/70 rounded animate-skeleton mb-6" />

          {/* Card 1 */}
          <div className="card-surface rounded-2xl p-5 mb-4">
            <div className="h-5 w-32 bg-[var(--surface-card)] rounded animate-skeleton mb-4" style={{ animationDelay: '50ms' }} />
            <div className="flex gap-3 mb-3">
              <div className="flex-1 h-9 bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: '100ms' }} />
              <div className="w-10 h-9 bg-[var(--surface-card)] rounded-xl animate-skeleton" style={{ animationDelay: '100ms' }} />
            </div>
            <div className="h-9 w-full bg-[var(--surface-card)]/60 rounded-xl animate-skeleton" style={{ animationDelay: '150ms' }} />
          </div>

          {/* Card 2 */}
          <div className="card-surface rounded-2xl p-5 mb-4" style={{ animationDelay: '80ms' }}>
            <div className="h-5 w-24 bg-[var(--surface-card)] rounded animate-skeleton mb-4" style={{ animationDelay: '130ms' }} />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-11 bg-[var(--surface-card)]/60 rounded-xl animate-skeleton" style={{ animationDelay: `${180 + i * 55}ms` }} />
              ))}
            </div>
          </div>

          {/* Card 3 */}
          <div className="card-surface rounded-2xl p-5" style={{ animationDelay: '160ms' }}>
            <div className="h-5 w-28 bg-[var(--surface-card)] rounded animate-skeleton mb-4" style={{ animationDelay: '210ms' }} />
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-11 bg-[var(--surface-card)]/60 rounded-xl animate-skeleton" style={{ animationDelay: `${260 + i * 55}ms` }} />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
