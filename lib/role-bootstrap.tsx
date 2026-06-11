'use client';

import { useEffect, useState } from 'react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useApp } from './context';

/**
 * Role bootstrap — resolves the signed-in Clerk user to an internal role via
 * /api/auth/me and feeds it into the app context. Extracted from app/page.tsx
 * (F7, 2026-06-11) so the dashboard layout can resolve the role IN PLACE:
 * previously every fresh /dashboard load (PWA home-screen launch, refresh)
 * bounced through "/" purely to reach this logic, flashing TWO different
 * loading screens (the dashboard splash, then the "/" splash, then back).
 *
 * Navigation-free by design — callers decide what to do per status:
 *   - 'resolving'        keep showing a splash
 *   - 'ready'            currentRole is set in context; render the app
 *   - 'unauthenticated'  Clerk session gone; caller redirects to /sign-in
 *   - 'error'            show <BootErrorCard error={...} /> (sign-out escape)
 */
export function useRoleBootstrap(): { status: 'resolving' | 'ready' | 'unauthenticated' | 'error'; error: string | null } {
  const { isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { setRole, currentRole } = useApp();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clerkLoaded || !isSignedIn || currentRole) return;

    let cancelled = false;
    setError(null);

    fetch('/api/auth/me')
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const user = await res.json();
          setRole(
            user.role,
            user.id,
            user.name,
            user.role === 'project_manager'
              ? {
                  canExport: user.canExport ?? false,
                  canCreateDeals: user.canCreateDeals ?? false,
                  canAccessBlitz: user.canAccessBlitz ?? false,
                }
              : undefined,
            user.repType ?? null,
            user.scopedInstallerId ?? null,
          );
        } else if (res.status === 404) {
          setError('Access denied — your account is not registered. Contact your administrator.');
        } else {
          setError('Failed to verify your account. Please try again.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not verify your account.');
      });

    return () => { cancelled = true; };
  }, [clerkLoaded, isSignedIn, currentRole, setRole]);

  // Precedence: a dead Clerk session beats a stale in-memory role — session
  // expiry or sign-out in ANOTHER tab doesn't call this tab's logout(), so
  // currentRole can linger after isSignedIn flips false. Returning 'ready'
  // first would let callers render/push /dashboard with stale cached state
  // (Codex review catch); the old "/" page guarded isSignedIn && currentRole.
  if (clerkLoaded && !isSignedIn) return { status: 'unauthenticated', error: null };
  if (currentRole) return { status: 'ready', error: null };
  if (error) return { status: 'error', error };
  return { status: 'resolving', error: null };
}

/** Access-denied / verification-error card. Shared by app/page.tsx and the
 *  dashboard layout's in-place bootstrap (F7). */
export function BootErrorCard({ error }: { error: string }) {
  const { signOut } = useClerk();
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
         style={{ background: 'linear-gradient(135deg, #03060c 0%, #060a14 60%, #060a14 100%)' }}>
      <div className="absolute inset-0 opacity-[0.03]"
           style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      <div className="relative w-full max-w-sm animate-slide-in-scale">
        <div className="text-center mb-10">
          <div className="inline-flex items-baseline gap-1 mb-3">
            <span className="text-[var(--text-primary)] font-black tracking-tight leading-none"
                  style={{ fontSize: '3rem', letterSpacing: '-0.04em' }}>
              kilo
            </span>
            <span className="text-[var(--text-primary)] font-light tracking-[0.25em] uppercase"
                  style={{ fontSize: '1.1rem' }}>
              ENERGY
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-sm tracking-widest uppercase">Internal Portal</p>
        </div>
        <div className="card-surface relative rounded-2xl overflow-hidden">
          <div className="p-8">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-[var(--text-primary)] text-sm font-medium">{error}</p>
              <button
                onClick={() => signOut({ redirectUrl: '/sign-in' })}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors underline underline-offset-2"
              >
                Sign out and try a different account
              </button>
            </div>
          </div>
        </div>
        <p className="text-center text-[var(--text-dim)] text-xs mt-6 tracking-wide">
          &copy; {new Date().getFullYear()} Kilo Energy &middot; Internal Use Only
        </p>
      </div>
    </div>
  );
}
