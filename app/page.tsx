'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import { useApp } from '../lib/context';

export default function LoginPage() {
  const { isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { signOut } = useClerk();
  const { setRole, currentRole } = useApp();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // If not signed in via Clerk, redirect to /sign-in
  useEffect(() => {
    if (clerkLoaded && !isSignedIn) {
      router.push('/sign-in');
    }
  }, [clerkLoaded, isSignedIn, router]);

  // If already has a role (from localStorage restore), go straight to dashboard
  useEffect(() => {
    if (clerkLoaded && isSignedIn && currentRole) {
      router.push('/dashboard');
    }
  }, [clerkLoaded, isSignedIn, currentRole, router]);

  // Auto-resolve role from internal User table via /api/auth/me
  useEffect(() => {
    if (!clerkLoaded || !isSignedIn || currentRole) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/auth/me')
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const user = await res.json();
          // user.role is 'admin' | 'rep' | 'sub-dealer' | 'project_manager'
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
            // Pass repType so the context can enable "admin who sells" surfaces
            // (My Pay tab, rep-dropdown visibility) on the signed-in session.
            user.repType ?? null,
          );
          router.push('/dashboard');
        } else if (res.status === 404) {
          setError('Access denied — your account is not registered. Contact your administrator.');
          setLoading(false);
        } else {
          setError('Failed to verify your account. Please try again.');
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Network error — could not verify your account.');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [clerkLoaded, isSignedIn, currentRole, setRole, router]);

  // Show branded splash screen while Clerk loads or while we resolve the role
  if (!clerkLoaded || !isSignedIn || (loading && !error)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8"
           style={{ background: 'linear-gradient(135deg, #0b0d11 0%, #0f1117 60%, #0f1117 100%)' }}>
        {/* Logo icon — uses the designed PWA icon so splash matches the
            app icon on the home screen and the dashboard loading variant */}
        <div className="animate-splash flex flex-col items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG icon, next/image loader overhead isn't worth it */}
          <img
            src="/icons/icon-192.svg"
            alt="Kilo Energy"
            width={80}
            height={80}
            style={{ borderRadius: '18px', boxShadow: '0 10px 30px -10px rgba(0,229,160,0.35)' }}
          />
          <div className="flex items-baseline gap-1">
            <span className="text-white font-black tracking-tight leading-none"
                  style={{ fontSize: '2.25rem', letterSpacing: '-0.04em' }}>
              kilo
            </span>
            <span className="text-white font-light tracking-[0.25em] uppercase"
                  style={{ fontSize: '0.85rem' }}>
              ENERGY
            </span>
          </div>
        </div>
        {/* Loading indicator */}
        <div className="flex flex-col items-center gap-3" style={{ animation: 'splashIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both' }}>
          <div className="w-8 h-8 relative">
            <div className="absolute inset-0 rounded-full border-2 border-[#272b35]/40" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/60 animate-spin" />
          </div>
          <p className="text-[#8891a8] text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Access denied or error state
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
         style={{ background: 'linear-gradient(135deg, #0b0d11 0%, #0f1117 60%, #0f1117 100%)' }}>

      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
           style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      <div className="relative w-full max-w-sm animate-slide-in-scale">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-baseline gap-1 mb-3">
            <span className="text-white font-black tracking-tight leading-none"
                  style={{ fontSize: '3rem', letterSpacing: '-0.04em' }}>
              kilo
            </span>
            <span className="text-white font-light tracking-[0.25em] uppercase"
                  style={{ fontSize: '1.1rem' }}>
              ENERGY
            </span>
          </div>
          <p className="text-[#8891a8] text-sm tracking-widest uppercase">Internal Portal</p>
        </div>

        {/* Card */}
        <div className="card-surface relative rounded-2xl overflow-hidden">
          <div className="p-8">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-white text-sm font-medium">{error}</p>
              <button
                onClick={() => signOut({ redirectUrl: '/sign-in' })}
                className="text-[#c2c8d8] hover:text-white text-xs transition-colors underline underline-offset-2"
              >
                Sign out and try a different account
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-[#525c72] text-xs mt-6 tracking-wide">
          &copy; {new Date().getFullYear()} Kilo Energy &middot; Internal Use Only
        </p>
      </div>
    </div>
  );
}
