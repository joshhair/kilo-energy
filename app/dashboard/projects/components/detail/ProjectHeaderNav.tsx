'use client';

/**
 * ProjectHeaderNav — breadcrumb trail + prev/next project buttons.
 * Extracted verbatim from projects/[id]/page.tsx (T4.1 split, 2026-06-11).
 * Display-only: the ←/→ keyboard shortcuts referenced in the titles are
 * handled by the page's arrow-key effect, which stays with the page.
 */

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function ProjectHeaderNav({ customerName, prevProjectId, nextProjectId }: {
  customerName: string;
  prevProjectId: string | null;
  nextProjectId: string | null;
}) {
  return (
      <div className="flex items-center justify-between mb-6">
        <nav className="animate-breadcrumb-enter inline-flex items-center gap-0.5 text-xs text-[var(--text-secondary)] bg-[var(--surface)]/60 backdrop-blur-md border border-[var(--border-subtle)]/60 rounded-xl px-4 py-2.5">
          <Link href="/dashboard" className="hover:bg-[var(--surface-card)]/50 hover:text-[var(--text-secondary)] transition-colors px-2 py-1 rounded-lg">Dashboard</Link>
          <span className="text-[var(--text-dim)] mx-1">/</span>
          <Link href="/dashboard/projects" className="hover:bg-[var(--surface-card)]/50 hover:text-[var(--text-secondary)] transition-colors px-2 py-1 rounded-lg">Projects</Link>
          <span className="text-[var(--text-dim)] mx-1">/</span>
          <span className="text-[var(--text-primary)] font-medium bg-[var(--accent-emerald-solid)]/10 px-2.5 py-1 rounded-lg">{customerName}</span>
        </nav>

        {/* Prev / Next project buttons */}
        {(prevProjectId || nextProjectId) && (
          <div className="flex items-center gap-1.5">
            {prevProjectId ? (
              <Link
                href={`/dashboard/projects/${prevProjectId}`}
                title="Previous project (←)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/60 border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/30 border border-[var(--border-subtle)]/40 text-[var(--text-dim)] cursor-default">
                <ChevronLeft className="w-4 h-4" />
              </span>
            )}
            {nextProjectId ? (
              <Link
                href={`/dashboard/projects/${nextProjectId}`}
                title="Next project (→)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/60 border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/30 border border-[var(--border-subtle)]/40 text-[var(--text-dim)] cursor-default">
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </div>
        )}
      </div>
  );
}
