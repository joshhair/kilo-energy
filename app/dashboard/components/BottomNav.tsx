'use client';

import { useState, useEffect, useRef } from 'react';
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
  LogOut,
  Mail,
  Phone,
  Eye,
  XCircle,
  Search,
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

// ─── Profile Drawer (slide-up bottom sheet) ─────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  rep: 'Sales Rep',
  'sub-dealer': 'Sub-Dealer',
  project_manager: 'Project Manager',
};

function ProfileDrawer({
  open,
  onClose,
  items,
  onLogout,
  userName,
  userRole,
  userEmail,
  userPhone,
  isAdmin,
  allReps,
  allSubDealers,
  onViewAs,
  isViewingAs,
  viewAsName,
  onClearViewAs,
}: {
  open: boolean;
  onClose: () => void;
  items: MoreSheetItem[];
  onLogout?: () => void;
  userName: string;
  userRole: string;
  userEmail: string;
  userPhone: string;
  isAdmin?: boolean;
  allReps?: Array<{ id: string; name: string }>;
  allSubDealers?: Array<{ id: string; name: string }>;
  onViewAs?: (user: { id: string; name: string; role: 'rep' | 'sub-dealer' }) => void;
  isViewingAs?: boolean;
  viewAsName?: string;
  onClearViewAs?: () => void;
}) {
  const [viewAsSearch, setViewAsSearch] = useState('');
  const [viewAsOpen, setViewAsOpen] = useState(false);

  const [shouldRender, setShouldRender] = useState(open);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsExiting(false);
    } else {
      setIsExiting(true);
      const t = setTimeout(() => { setShouldRender(false); setIsExiting(false); }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!shouldRender) return null;

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] md:hidden"
        style={{ background: 'rgba(0,0,0,0.6)', animation: isExiting ? 'fadeOut 0.22s ease forwards' : 'fadeIn 0.2s ease' }}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className="fixed left-0 right-0 bottom-0 z-[70] md:hidden"
        style={{
          background: '#0d1525',
          borderTop: '1px solid #1a2840',
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          animation: isExiting ? 'slideDown 0.28s cubic-bezier(0.4, 0, 1, 1) forwards' : 'slideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1) both',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        {/* Handle bar */}
        <div className="flex justify-center py-3">
          <div className="w-10 h-1 rounded-full" style={{ background: '#1a2840' }} />
        </div>

        {/* Profile header */}
        <div className="px-6 pb-4" style={{ borderBottom: '1px solid #1a2840' }}>
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #00e5a0 0%, #00b4d8 100%)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '1.2rem',
                fontWeight: 700,
                color: '#000',
              }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-white truncate" style={{ fontFamily: "'DM Sans', sans-serif" }}>{userName}</p>
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1"
                style={{
                  background: 'rgba(0,229,160,0.15)',
                  color: '#00e5a0',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {ROLE_LABELS[userRole] || userRole}
              </span>
            </div>
          </div>
          {/* Contact info */}
          {(userEmail || userPhone) && (
            <div className="mt-3 space-y-1.5">
              {userEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" style={{ color: '#8899aa' }} />
                  <span className="text-sm truncate" style={{ color: '#8899aa', fontFamily: "'DM Sans', sans-serif" }}>{userEmail}</span>
                </div>
              )}
              {userPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5" style={{ color: '#8899aa' }} />
                  <span className="text-sm" style={{ color: '#8899aa', fontFamily: "'DM Sans', sans-serif" }}>{userPhone}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav items */}
        {items.length > 0 && (
          <div className="px-2 py-2">
            {items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className="flex items-center gap-3 min-h-[48px] px-4 py-3 rounded-xl active:opacity-70 transition-opacity"
                style={{
                  color: '#fff',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '1rem',
                }}
              >
                <span style={{ color: '#8899aa' }}><Icon className="w-5 h-5" /></span>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        )}

        {/* View As (admin only) */}
        {isAdmin && onViewAs && (
          <div className="px-2 py-2" style={{ borderTop: '1px solid #1a2840' }}>
            {isViewingAs && viewAsName && onClearViewAs ? (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4" style={{ color: '#f5a623' }} />
                  <span className="text-sm" style={{ color: '#f5a623', fontFamily: "'DM Sans', sans-serif" }}>
                    Viewing as <span className="text-white font-semibold">{viewAsName}</span>
                  </span>
                </div>
                <button
                  onClick={() => { onClearViewAs(); onClose(); }}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg active:opacity-70"
                  style={{ color: '#f5a623' }}
                >
                  <XCircle className="w-3.5 h-3.5" /> Exit
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setViewAsOpen(!viewAsOpen)}
                  className="flex items-center gap-3 w-full min-h-[48px] px-4 py-3 rounded-xl active:opacity-70 transition-opacity"
                  style={{ color: '#8899aa', fontFamily: "'DM Sans', sans-serif", fontSize: '1rem' }}
                >
                  <Eye className="w-5 h-5" />
                  <span>View As Rep...</span>
                </button>
                {viewAsOpen && (
                  <div className="mx-2 mb-2 rounded-xl overflow-hidden" style={{ background: '#161920', border: '1px solid #1a2840' }}>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#8899aa' }} />
                      <input
                        autoFocus
                        value={viewAsSearch}
                        onChange={(e) => setViewAsSearch(e.target.value)}
                        placeholder="Search reps..."
                        className="w-full bg-transparent pl-9 pr-3 py-2.5 text-sm text-white outline-none"
                        style={{ borderBottom: '1px solid #1a2840', fontFamily: "'DM Sans', sans-serif" }}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {[...(allReps || []).map(r => ({ ...r, role: 'rep' as const })), ...(allSubDealers || []).map(sd => ({ ...sd, role: 'sub-dealer' as const }))]
                        .filter(u => !viewAsSearch.trim() || u.name.toLowerCase().includes(viewAsSearch.toLowerCase()))
                        .map(u => (
                          <button
                            key={u.id}
                            onClick={() => { onViewAs(u); setViewAsOpen(false); setViewAsSearch(''); onClose(); }}
                            className="w-full text-left px-4 py-3 text-sm text-white active:opacity-70 flex items-center justify-between"
                            style={{ borderBottom: '1px solid #1a2840', fontFamily: "'DM Sans', sans-serif" }}
                          >
                            <span>{u.name}</span>
                            <span className="text-xs capitalize" style={{ color: '#8899aa' }}>{u.role}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Sign Out */}
        {onLogout && (
          <div className="px-2 pt-1" style={{ borderTop: '1px solid #1a2840' }}>
            <button
              onClick={() => { onClose(); onLogout(); }}
              className="flex items-center gap-3 w-full min-h-[48px] px-4 py-3 rounded-xl active:opacity-70 transition-opacity"
              style={{
                color: '#ff6b6b',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '1rem',
              }}
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </div>
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
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
        style={{ background: 'linear-gradient(to top, #080c14 80%, transparent)', paddingBottom: 'env(safe-area-inset-bottom)' }}
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
                  background: 'linear-gradient(90deg, #00e5a0, #00b4d8)',
                  transform: `translateX(${activeIdx * 100}%)`,
                  transition: 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  boxShadow: '0 0 8px rgba(0,229,160,0.6)',
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
                  className="relative flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[48px] transition-all duration-200 active:scale-95"
                  style={{ opacity: active ? 1 : 0.55 }}
                >
                  <span
                    className="transition-transform duration-200"
                    style={{ color: active ? '#00e5a0' : '#fff', transform: active ? 'scale(1.08)' : 'scale(1)' }}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="text-[10px] tracking-wide transition-colors duration-200" style={{ color: active ? '#00e5a0' : '#8899aa', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
                </button>
              );
            }

            // Regular nav item
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex flex-col items-center justify-center gap-1 py-1 min-w-[56px] min-h-[48px] transition-all duration-200 active:scale-95"
                style={{ opacity: active ? 1 : 0.55 }}
              >
                <span
                  className="transition-transform duration-200"
                  style={{ color: active ? '#00e5a0' : '#fff', transform: active ? 'scale(1.08)' : 'scale(1)' }}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className="text-[10px] tracking-wide transition-colors duration-200" style={{ color: active ? '#00e5a0' : '#8899aa', fontFamily: "'DM Sans', sans-serif" }}>{item.label}</span>
              </Link>
            );
          })}
          </div>
        </div>
      </nav>
    </>
  );
}
