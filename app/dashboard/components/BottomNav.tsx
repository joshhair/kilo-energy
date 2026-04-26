'use client';

import Link from 'next/link';
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

  return (
    <nav
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
              className="nav-pill absolute top-0 h-[2px] rounded-full pointer-events-none"
              style={{
                width: `${100 / navItems.length}%`,
                left: 0,
                background: 'linear-gradient(90deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
                transform: `translateX(${activeIdx * 100}%)`,
                transition: 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                boxShadow: '0 0 8px color-mix(in srgb, var(--accent-emerald-solid) 60%, transparent)',
              }}
            />
          );
        })()}
        <div className="flex items-end justify-around px-2 pt-3 pb-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          // Primary / "New Deal" button — gradient FAB
          if (item.primary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center -mt-4 min-w-[56px]"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <div className="w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                  style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid) 0%, var(--accent-cyan-solid) 100%)', boxShadow: '0 0 24px color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)' }}>
                  <span className="text-2xl font-light text-black leading-none">+</span>
                </div>
                <span className="text-[10px] font-medium mt-1" style={{ color: 'var(--accent-emerald-text)', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
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
                  className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full font-bold leading-none"
                  style={{
                    fontSize: '9px',
                    background: active
                      ? 'linear-gradient(135deg, var(--accent-emerald-solid) 0%, var(--accent-cyan-solid) 100%)'
                      : 'transparent',
                    border: active ? 'none' : '1.25px solid var(--text-muted)',
                    color: active ? '#000' : 'var(--text-muted)',
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease',
                  }}
                >
                  {avatarInitials}
                </span>
                <span className="text-[10px] tracking-wide" style={{
                  color: active ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
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
                  color: active ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                  animation: active ? 'navIconPop 360ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
                  transform: active ? undefined : 'scale(1)',
                  transition: active ? 'none' : 'color 200ms ease, transform 200ms ease',
                }}
              >
                <Icon className="w-[18px] h-[18px]" />
              </span>
              <span className="text-[10px] tracking-wide" style={{
                color: active ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
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
