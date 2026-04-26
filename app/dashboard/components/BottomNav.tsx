'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '../../../lib/context';
import {
  LayoutDashboard,
  FolderKanban,
  PlusCircle,
  Wallet,
  MoreHorizontal,
  CreditCard,
  Users,
  Tent,
  GraduationCap,
  Calculator,
  Trophy,
  Settings,
  X,
} from 'lucide-react';
import ProfileDrawer, { type MoreSheetItem } from './ProfileDrawer';

type BottomNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If true, render as the accent "primary action" button */
  primary?: boolean;
};

// ─── Role-specific configurations ─────────────────────────────────────────

const REP_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle, primary: true },
  { href: '/dashboard/my-pay', label: 'My Pay', icon: Wallet },
  { href: '___more___', label: 'More', icon: MoreHorizontal },
];

const REP_MORE_ITEMS: MoreSheetItem[] = [
  { href: '/dashboard/blitz', label: 'Blitz', icon: Tent },
  { href: '/dashboard/calculator', label: 'Calculator', icon: Calculator },
];

const REP_MORE_ITEMS_TRAINER: MoreSheetItem[] = [
  { href: '/dashboard/blitz', label: 'Blitz', icon: Tent },
  { href: '/dashboard/training', label: 'Training', icon: GraduationCap },
  { href: '/dashboard/calculator', label: 'Calculator', icon: Calculator },
];

const SUB_DEALER_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle, primary: true },
  { href: '/dashboard/my-pay', label: 'My Pay', icon: Wallet },
  { href: '___more___', label: 'More', icon: MoreHorizontal },
];

const ADMIN_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/payroll', label: 'Payroll', icon: CreditCard },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '___more___', label: 'More', icon: MoreHorizontal },
];

const ADMIN_MORE_ITEMS: MoreSheetItem[] = [
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle },
  { href: '/dashboard/blitz', label: 'Blitz', icon: Tent },
  { href: '/dashboard/incentives', label: 'Incentives', icon: Trophy },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/calculator', label: 'Calculator', icon: Calculator },
];

const PM_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '___more___', label: 'More', icon: MoreHorizontal },
];

// ─── BottomNav ────────────────────────────────────────────────────────────

export default function BottomNav({
  role,
  isTrainer = false,
  onLogout,
}: {
  role: 'admin' | 'rep' | 'sub-dealer' | 'project_manager';
  isTrainer?: boolean;
  onLogout?: () => void;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { currentRepName, currentRepId, currentRole, reps, subDealers, isViewingAs, viewAsUser, setViewAsUser, clearViewAs } = useApp();

  // Close more sheet on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMoreOpen(false);
  }

  // Pick items based on role
  let navItems: BottomNavItem[];
  let moreItems: MoreSheetItem[];

  if (role === 'admin') {
    navItems = ADMIN_BOTTOM_NAV;
    moreItems = ADMIN_MORE_ITEMS;
  } else if (role === 'project_manager') {
    navItems = PM_BOTTOM_NAV;
    moreItems = [];
  } else if (role === 'sub-dealer') {
    navItems = SUB_DEALER_BOTTOM_NAV;
    moreItems = [];
  } else {
    navItems = REP_BOTTOM_NAV;
    moreItems = isTrainer ? REP_MORE_ITEMS_TRAINER : REP_MORE_ITEMS;
  }

  // Resolve user profile info
  const matchedRep = reps.find((r) => r.id === currentRepId);
  const matchedSD = !matchedRep ? subDealers.find((sd) => sd.id === currentRepId) : null;
  const userName = currentRepName || 'User';
  const userEmail = matchedRep?.email || matchedSD?.email || '';
  const userPhone = matchedRep?.phone || matchedSD?.phone || '';

  const isActive = (href: string) => {
    if (href === '___more___') return moreOpen;
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <>
      <ProfileDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={moreItems}
        onLogout={onLogout}
        userName={userName}
        userRole={role}
        userEmail={userEmail}
        userPhone={userPhone}
        isAdmin={currentRole === 'admin'}
        allReps={reps}
        allSubDealers={subDealers}
        onViewAs={setViewAsUser}
        isViewingAs={isViewingAs}
        viewAsName={viewAsUser?.name}
        onClearViewAs={clearViewAs}
      />
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
            const isMore = item.href === '___more___';

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

            // "More" button — opens sheet
            if (isMore) {
              return (
                <button
                  key="more"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="relative flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[48px] transition-all duration-200 active:scale-95"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <span className="relative w-[18px] h-[18px] block">
                    <MoreHorizontal
                      className="w-[18px] h-[18px] absolute inset-0"
                      style={{
                        color: active ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                        opacity: active ? 0 : 1,
                        transform: active ? 'scale(0.5) rotate(-30deg)' : 'scale(1) rotate(0deg)',
                        transition: 'opacity 200ms ease, transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    />
                    <X
                      className="w-[18px] h-[18px] absolute inset-0"
                      style={{
                        color: 'var(--accent-emerald-text)',
                        opacity: active ? 1 : 0,
                        transform: active ? 'scale(1) rotate(0deg)' : 'scale(0.5) rotate(30deg)',
                        transition: 'opacity 200ms ease, transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    />
                  </span>
                  <span className="text-[10px] tracking-wide" style={{
                    color: active ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                    fontFamily: "'DM Sans', sans-serif",
                    transform: active ? 'translateY(0px)' : 'translateY(2px)',
                    transition: 'color 200ms ease, transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                    willChange: 'transform',
                  }}>{item.label}</span>
                </button>
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
    </>
  );
}
