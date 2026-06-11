'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRoleBootstrap, BootErrorCard } from '../lib/role-bootstrap';

/** Pop the deep-link path stashed by older sessions, falling back to
 *  /dashboard. Only honors paths under /dashboard so we never trust
 *  arbitrary input. (The dashboard layout no longer bounces here while the
 *  role resolves — F7 made it bootstrap in place — so the stash writer is
 *  gone; consumption stays for any stale stashes and degrades to the
 *  default harmlessly.) */
function consumePostAuthRedirect(): string {
  if (typeof window === 'undefined') return '/dashboard';
  try {
    const stash = sessionStorage.getItem('postAuthRedirect');
    sessionStorage.removeItem('postAuthRedirect');
    if (stash && stash.startsWith('/dashboard')) return stash;
  } catch {
    // sessionStorage disabled — fall through.
  }
  return '/dashboard';
}

export default function LoginPage() {
  const router = useRouter();
  // Shared bootstrap (F7): resolves /api/auth/me → setRole. This page is now
  // only the landing surface for direct "/" visits and post-sign-in.
  const { status, error } = useRoleBootstrap();

  // destRef captures the stash exactly ONCE; navigatedRef guarantees a single
  // push so a late in-flight resolution can't override an earlier redirect
  // (the T1.2 deep-link race fix).
  const destRef = useRef<string | null>(null);
  const navigatedRef = useRef(false);
  const goToPostAuthDest = useCallback(() => {
    if (destRef.current === null) destRef.current = consumePostAuthRedirect();
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.push(destRef.current);
  }, [router]);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/sign-in');
    if (status === 'ready') goToPostAuthDest();
  }, [status, router, goToPostAuthDest]);

  if (status === 'error' && error) return <BootErrorCard error={error} />;

  // Branded splash while Clerk loads / the role resolves / the redirect runs.
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8"
         style={{ background: 'linear-gradient(135deg, #03060c 0%, #060a14 60%, #060a14 100%)' }}>
      {/* Logo icon — uses the designed PWA icon so splash matches the
          app icon on the home screen and the dashboard loading variant */}
      <div className="animate-splash flex flex-col items-center gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG icon, next/image loader overhead isn't worth it */}
        <img
          src="/icons/icon-192.svg"
          alt="Kilo Energy"
          width={80}
          height={80}
          style={{ borderRadius: '18px', boxShadow: '0 10px 30px -10px color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)' }}
        />
        <div className="flex items-baseline gap-1">
          <span className="text-[var(--text-primary)] font-black tracking-tight leading-none"
                style={{ fontSize: '2.25rem', letterSpacing: '-0.04em' }}>
            kilo
          </span>
          <span className="text-[var(--text-primary)] font-light tracking-[0.25em] uppercase"
                style={{ fontSize: '0.85rem' }}>
            ENERGY
          </span>
        </div>
      </div>
      {/* Loading indicator */}
      <div className="flex flex-col items-center gap-3" style={{ animation: 'splashIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both' }}>
        <div className="w-8 h-8 relative">
          <div className="absolute inset-0 rounded-full border-2 border-[var(--border-default)]/40" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/60 animate-spin" />
        </div>
        <p className="text-[var(--text-muted)] text-sm">Loading...</p>
      </div>
    </div>
  );
}
