'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  PlusCircle,
  Wallet,
  CreditCard,
  Users,
} from 'lucide-react';
import { useApp } from '../../../lib/context';
import { usePublishHeightVar } from '../../../lib/hooks';

type BottomNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If true, render as the accent "primary action" button */
  primary?: boolean;
  /** If true, render as the user-avatar tab (initials in a gradient circle) */
  avatar?: boolean;
};

// Tiny placeholder used so the BottomNavItem.icon contract stays satisfied
// for the avatar tab; the actual avatar visuals are rendered in the
// `item.avatar` branch below and this glyph is never shown.
const AvatarIconPlaceholder = () => null;

// ─── Role-specific configurations ─────────────────────────────────────────

const REP_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle, primary: true },
  { href: '/dashboard/my-pay', label: 'My Pay', icon: Wallet },
  { href: '/dashboard/you', label: 'You', icon: AvatarIconPlaceholder, avatar: true },
];

const SUB_DEALER_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle, primary: true },
  { href: '/dashboard/my-pay', label: 'My Pay', icon: Wallet },
  { href: '/dashboard/you', label: 'You', icon: AvatarIconPlaceholder, avatar: true },
];

const ADMIN_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/payroll', label: 'Payroll', icon: CreditCard },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/you', label: 'You', icon: AvatarIconPlaceholder, avatar: true },
];

const PM_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/you', label: 'You', icon: AvatarIconPlaceholder, avatar: true },
];

// ─── BottomNav ────────────────────────────────────────────────────────────

export default function BottomNav({
  role,
}: {
  role: 'admin' | 'rep' | 'sub-dealer' | 'project_manager';
}) {
  const pathname = usePathname();
  const { effectiveRepName, currentRepName } = useApp();

  // Avatar tab uses effective name so admin viewing-as-rep sees the rep's
  // initials in the bottom nav (matches the centered profile header on
  // /dashboard/you which also uses effectiveRepName).
  const avatarSourceName = effectiveRepName || currentRepName || 'U';
  const avatarInitials = avatarSourceName
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);

  let navItems: BottomNavItem[];
  if (role === 'admin') navItems = ADMIN_BOTTOM_NAV;
  else if (role === 'project_manager') navItems = PM_BOTTOM_NAV;
  else if (role === 'sub-dealer') navItems = SUB_DEALER_BOTTOM_NAV;
  else navItems = REP_BOTTOM_NAV;

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  // Publish the nav's real height (incl. safe-area) so sticky CTA bars and
  // the floating feedback button can stack above it instead of colliding
  // (T1.3). On desktop the nav is display:none → height 0 → vars collapse.
  const navRef = useRef<HTMLElement>(null);
  usePublishHeightVar(navRef, '--kilo-bottom-nav-h');

  return (
    <nav
      ref={navRef}
      className="fixed left-0 right-0 z-50 md:hidden"
      style={{ bottom: 'var(--install-prompt-offset, 0px)', background: 'linear-gradient(to top, var(--surface-page) 80%, transparent)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="relative">
        {(() => {
          const activeIdx = navItems.findIndex(item => isActive(item.href));
          if (activeIdx < 0) return null;
          return (
            <span
              aria-hidden
              className="nav-pill absolute top-0 h-[2px] pointer-events-none"
              style={{
                // Full tab-slot width, centered hairline (40% × slot)
                // via inline padding-style trick: width = slot, the
                // visible bar inside is a child element. Keeps math
                // simple: translateX(idx * 100%) moves by exactly one
                // slot, which is the indicator's full width. No
                // box-shadow halo (was the bleed cause on the feedback
                // bubble).
                width: `${100 / navItems.length}%`,
                left: 0,
                transform: `translateX(${activeIdx * 100}%)`,
                transition: 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <span
                key={activeIdx}
                className="pill-stretch"
                style={{
                  width: '40%',
                  height: '2px',
                  borderRadius: '999px',
                  background: 'var(--accent-emerald-text)',
                }}
              />
            </span>
          );
        })()}
        <div className="flex items-end justify-around px-2 pt-3 pb-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          // Primary / "New Deal" button — Option A "card-proud":
          // rounded-square card-surface tile with hairline emerald border,
          // a serif-weight plus glyph, and a single tiny spark dot in the
          // upper-right corner. Reads as "compose a premium card" rather
          // than "tap a green disc," matching the My Pay / dashboard
          // visual vocabulary. No halo, no gradient.
          if (item.primary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center -mt-2.5 min-w-[56px] active:scale-95"
                style={{ WebkitTapHighlightColor: 'transparent', transition: 'transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
              >
                <div
                  className="card-surface w-12 h-12 rounded-2xl flex items-center justify-center relative"
                  style={{
                    border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)',
                  }}
                >
                  {/* Inner spark — single dot, upper-right. Premium tell
                      that this is a CTA, not just a frame. */}
                  <span
                    aria-hidden
                    className="absolute"
                    style={{
                      top: 8,
                      right: 8,
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: 'var(--accent-emerald-solid)',
                      boxShadow: '0 0 4px color-mix(in srgb, var(--accent-emerald-solid) 65%, transparent)',
                    }}
                  />
                  {/* Serif plus glyph — DM Serif Display matches the
                      "Taylor Brooks" name + My Pay numerals so the CTA
                      visually belongs in the same family. */}
                  <span
                    className="leading-none"
                    style={{
                      fontFamily: "'DM Serif Display', serif",
                      fontSize: 26,
                      color: 'var(--accent-emerald-text)',
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                      transform: 'translateY(-1px)',
                    }}
                  >
                    +
                  </span>
                </div>
                <span className="text-[10px] font-medium mt-1.5 tracking-wide" style={{ color: active ? 'var(--accent-emerald-text)' : 'var(--text-muted)', transition: 'color 200ms ease', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
              </Link>
            );
          }

          // "You" tab — user-initials avatar circle replaces the icon glyph.
          // The active state swaps the muted outline for an emerald gradient
          // fill so the avatar reads as "this is you, and you're here."
          if (item.avatar) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[48px] transition-all duration-200 active:scale-95"
                style={{ WebkitTapHighlightColor: 'transparent' }}
                aria-label="You"
              >
                <span
                  className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full font-semibold leading-none"
                  style={{
                    fontSize: '9px',
                    background: 'transparent',
                    border: active
                      ? '1.25px solid color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)'
                      : '1.25px solid var(--text-muted)',
                    color: active ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease',
                  }}
                >
                  {avatarInitials}
                </span>
                <span className="text-[10px] tracking-wide" style={{
                  color: active ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
                  fontFamily: "'DM Sans', sans-serif",
                  transform: active ? 'translateY(0px)' : 'translateY(2px)',
                  transition: 'color 200ms ease, transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  willChange: 'transform',
                }}>{item.label}</span>
              </Link>
            );
          }

          // Regular nav item
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[48px] transition-all duration-200 active:scale-95"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span
                key={active ? 'on' : 'off'}
                className="nav-icon-pop inline-block"
                style={{
                  color: active ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
                  animation: active ? 'navIconPop 360ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
                  transform: active ? undefined : 'scale(1)',
                  transition: active ? 'none' : 'color 200ms ease, transform 200ms ease',
                }}
              >
                <Icon className="w-[18px] h-[18px]" />
              </span>
              <span className="text-[10px] tracking-wide" style={{
                color: active ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
                fontFamily: "'DM Sans', sans-serif",
                transform: active ? 'translateY(0px)' : 'translateY(2px)',
                transition: 'color 200ms ease, transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                willChange: 'transform',
              }}>{item.label}</span>
            </Link>
          );
        })}
        </div>
      </div>
    </nav>
  );
}
