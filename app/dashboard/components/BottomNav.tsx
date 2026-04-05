'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  PlusCircle,
  Vault,
  MoreHorizontal,
  CreditCard,
  Users,
  Tent,
  GraduationCap,
  Calculator,
  Trophy,
  Settings,
  X,
  LogOut,
} from 'lucide-react';

type BottomNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If true, render as the accent "primary action" button */
  primary?: boolean;
};

type MoreSheetItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// ─── Role-specific configurations ─────────────────────────────────────────

const REP_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle, primary: true },
  { href: '/dashboard/vault', label: 'My Pay', icon: Vault },
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
  { href: '/dashboard/vault', label: 'My Pay', icon: Vault },
  { href: '___more___', label: 'More', icon: MoreHorizontal },
];

const ADMIN_BOTTOM_NAV: BottomNavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/payroll', label: 'Payroll', icon: CreditCard },
  { href: '/dashboard/reps', label: 'Reps', icon: Users },
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
  { href: '/dashboard/reps', label: 'Reps', icon: Users },
  { href: '___more___', label: 'More', icon: MoreHorizontal },
];

// ─── More Popover (floating menu above More button) ──────────────────────

function MorePopover({
  open,
  onClose,
  items,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  items: MoreSheetItem[];
  onLogout?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Invisible backdrop to catch taps outside */}
      <div className="fixed inset-0 z-[60] md:hidden" onClick={onClose} />
      {/* Popover card anchored above More button */}
      <div
        className="fixed z-[70] md:hidden"
        style={{
          bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
          right: '12px',
          minWidth: '180px',
          background: '#0d1525',
          border: '1px solid #1a2840',
          borderRadius: '16px',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          animation: 'mobileTabEnter 0.15s ease both',
        }}
      >
        {items.map(({ href, label, icon: Icon }, i) => (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className="flex items-center gap-3 min-h-[48px] px-5 py-3 active:opacity-70 transition-opacity"
            style={{
              color: '#fff',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '1rem',
              borderBottom: i < items.length - 1 ? '1px solid #1a2840' : 'none',
            }}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
        {/* Logout */}
        {onLogout && (
          <button
            onClick={() => { onClose(); onLogout(); }}
            className="flex items-center gap-3 w-full min-h-[48px] px-5 py-3 active:opacity-70 transition-opacity"
            style={{
              color: '#ff6b6b',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '1rem',
              borderTop: items.length > 0 ? '1px solid #1a2840' : 'none',
            }}
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        )}
      </div>
    </>
  );
}

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

  const isActive = (href: string) => {
    if (href === '___more___') return moreOpen;
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <>
      <MorePopover open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} onLogout={onLogout} />
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
        style={{ background: 'linear-gradient(to top, #080c14 80%, transparent)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
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
                >
                  <div className="w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                    style={{ background: 'linear-gradient(135deg, #00e5a0 0%, #00b4d8 100%)', boxShadow: '0 0 24px rgba(0,229,160,0.45)' }}>
                    <span className="text-2xl font-light text-black leading-none">+</span>
                  </div>
                  <span className="text-[10px] font-medium mt-1" style={{ color: '#00e5a0', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
                </Link>
              );
            }

            // "More" button — opens sheet
            if (isMore) {
              return (
                <button
                  key="more"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[44px] transition-opacity"
                  style={{ opacity: active ? 1 : 0.4 }}
                >
                  <span style={{ color: active ? '#00e5a0' : '#fff' }}><Icon className="w-[18px] h-[18px]" /></span>
                  <span className="text-[10px] tracking-wide" style={{ color: active ? '#00e5a0' : '#8899aa', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
                </button>
              );
            }

            // Regular nav item
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[44px] transition-opacity"
                style={{ opacity: active ? 1 : 0.4 }}
              >
                <span style={{ color: active ? '#00e5a0' : '#fff' }}><Icon className="w-[18px] h-[18px]" /></span>
                <span className="text-[10px] tracking-wide" style={{ color: active ? '#00e5a0' : '#8899aa', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
