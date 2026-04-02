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

// ─── More Sheet (slide-up) ────────────────────────────────────────────────

function MoreSheet({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: MoreSheetItem[];
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-[70] md:hidden animate-slide-up-sheet"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="bg-slate-900 border-t border-slate-700/60 rounded-t-2xl shadow-2xl shadow-black/50 px-4 pt-3 pb-4">
          {/* Handle bar */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 rounded-full bg-slate-700" />
          </div>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-4 p-1.5 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
          {/* Items */}
          <nav className="grid grid-cols-3 gap-2">
            {items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors min-h-[44px]"
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

// ─── BottomNav ────────────────────────────────────────────────────────────

export default function BottomNav({
  role,
  isTrainer = false,
}: {
  role: 'admin' | 'rep' | 'sub-dealer';
  isTrainer?: boolean;
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
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-slate-900/95 backdrop-blur-md border-t border-slate-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-end justify-around px-2 h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const isMore = item.href === '___more___';

            // Primary / "New Deal" button — elevated style
            if (item.primary) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-col items-center justify-center -mt-3 min-w-[56px] min-h-[44px]"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30 active:scale-95 transition-transform">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-[10px] font-medium text-blue-400 mt-0.5">{item.label}</span>
                </Link>
              );
            }

            // "More" button — opens sheet
            if (isMore) {
              return (
                <button
                  key="more"
                  onClick={() => setMoreOpen((v) => !v)}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 min-w-[56px] min-h-[44px] transition-colors ${
                    active ? 'text-blue-400' : 'text-slate-500'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            }

            // Regular nav item
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 min-w-[56px] min-h-[44px] transition-colors ${
                  active ? 'text-blue-400' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
