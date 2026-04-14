'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="card-surface rounded-2xl p-8 max-w-md w-full text-center space-y-5">
        <div className="mx-auto w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>

        <div className="space-y-2">
          <h2 className="text-white text-lg font-bold">Something went wrong</h2>
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
            {error.message || 'An unexpected error occurred.'}
          </p>
          {error.digest && (
            <p className="text-[var(--text-dim)] text-xs font-mono">ID: {error.digest}</p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="btn-primary text-black font-semibold py-2.5 px-6 rounded-xl text-sm transition-all active:scale-[0.98]"
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="py-2.5 px-6 rounded-xl text-sm font-semibold text-[var(--text-secondary)] hover:text-white border border-[var(--border)]/40 hover:border-[var(--border)] transition-all"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
