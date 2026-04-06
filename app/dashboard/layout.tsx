'use client';

import { useEffect, useRef, useState, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '../../lib/context';
import {
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  HelpCircle,
  PlusCircle,
  Tent,
  Eye,
  XCircle,
} from 'lucide-react';
import { useClerk } from '@clerk/nextjs';
import { CommandPalette, ShortcutsOverlay } from '../../lib/command-palette';
import InstallPrompt from './components/InstallPrompt';
import BottomNav from './components/BottomNav';

// ─── Nav definitions (shared with CommandPalette) ──────────────────────────
// Types and arrays live in lib/nav-items to avoid a circular dependency.
// They are re-exported from here for any consumers that import from layout.

// Re-export nav definitions so external modules can import them from layout.
export { REP_NAV, ADMIN_NAV, SUB_DEALER_NAV } from '../../lib/nav-items';
export type { NavItem, NavGroupDef, AnyNavItem } from '../../lib/nav-items';

// Local imports — only what is directly referenced in this file.
import { REP_NAV, ADMIN_NAV, SUB_DEALER_NAV, PM_NAV } from '../../lib/nav-items';
import type { NavItem } from '../../lib/nav-items';

// ─── NavGroup component ────────────────────────────────────────────────────

function NavGroup({
  label,
  icon: Icon,
  items,
  pathname,
  sidebarCollapsed,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  pathname: string;
  sidebarCollapsed: boolean;
}) {
  const isAnyChildActive = items.some((child) =>
    pathname.startsWith(child.href)
  );
  const [open, setOpen] = useState(isAnyChildActive);

  // Auto-expand when navigating to a child route (during-render derived state —
  // avoids calling setState inside an effect).
  const [prevIsAnyChildActive, setPrevIsAnyChildActive] = useState(isAnyChildActive);
  if (isAnyChildActive !== prevIsAnyChildActive) {
    setPrevIsAnyChildActive(isAnyChildActive);
    if (isAnyChildActive) setOpen(true);
  }

  // ── Micro-animation state ────────────────────────────────────────────────

  // (2) Icon pop — fires on every open/close toggle but NOT on initial mount.
  const mountedRef = useRef(false);
  const [iconPop, setIconPop] = useState(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const tStart = setTimeout(() => setIconPop(true), 0);
    const tEnd = setTimeout(() => setIconPop(false), 200);
    return () => {
      clearTimeout(tStart);
      clearTimeout(tEnd);
    };
  }, [open]);

  // (4) Staggered child entrance — active while the group is opening so each
  //     <li> gets its animate-slide-in-scale + stagger-N classes briefly.
  const [staggerOpen, setStaggerOpen] = useState(false);
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setStaggerOpen(false), 0);
      return () => clearTimeout(t);
    }
    const tStart = setTimeout(() => setStaggerOpen(true), 0);
    // Keep classes long enough for the last stagger delay + animation duration
    // (stagger-6 = 450 ms delay + ~350 ms animation = ~800 ms total).
    const tEnd = setTimeout(() => setStaggerOpen(false), 850);
    return () => {
      clearTimeout(tStart);
      clearTimeout(tEnd);
    };
  }, [open]);

  return (
    <li>
      {/* Group header button */}
      <button
        onClick={() => !sidebarCollapsed && setOpen((v) => !v)}
        title={sidebarCollapsed ? label : undefined}
        className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-[background] w-full ${sidebarCollapsed ? 'justify-center' : ''}`}
        style={isAnyChildActive
          ? { background: 'rgba(0,224,122,0.1)', border: '1px solid rgba(0,224,122,0.25)', color: '#00e07a', fontWeight: 700 }
          : { color: 'var(--d-sub, #c2c8d8)', fontWeight: 500, ...(open && !sidebarCollapsed ? { background: 'rgba(0,224,122,0.05)' } : {}) }
        }
      >
        <span style={{ opacity: isAnyChildActive ? 1 : 0.5, color: isAnyChildActive ? '#00e07a' : 'inherit', display: 'flex' }}><Icon className={`w-4 h-4 flex-shrink-0 transition-all duration-200${iconPop ? ' nav-group-icon-pop' : ''}`} /></span>
        {!sidebarCollapsed && (
          <>
            <span className="truncate flex-1 text-left">{label}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-300 nav-chevron-spring ${
                open ? 'rotate-180 group-hover:rotate-180' : ''
              }`}
            />
          </>
        )}
      </button>

      {/* Collapsible sub-items — hidden when sidebar is collapsed */}
      {!sidebarCollapsed && (
        <div
          className="grid transition-[grid-template-rows] duration-300"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <ul className="ml-5 mt-0.5 space-y-0.5 border-l nav-sublist-border" style={{ borderColor: isAnyChildActive ? 'rgba(0,224,122,0.4)' : 'var(--d-border, #272b35)' }}>
              {items.map(({ href, label: childLabel, icon: ChildIcon }, idx) => {
                const isActive = pathname.startsWith(href);
                // Clamp stagger index to the 6 utility classes we have defined.
                const staggerClass = staggerOpen ? ` animate-slide-in-scale stagger-${Math.min(idx + 1, 6)}` : '';
                return (
                  <li key={href} className={staggerClass}>
                    <Link
                      href={href}
                      className="group flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm"
                      style={isActive
                        ? { background: 'rgba(0,224,122,0.1)', border: '1px solid rgba(0,224,122,0.25)', color: '#00e07a', fontWeight: 700 }
                        : { color: 'var(--d-sub, #c2c8d8)', fontWeight: 500 }
                      }
                    >
                      <span style={{ opacity: isActive ? 1 : 0.5, color: isActive ? '#00e07a' : 'inherit', display: 'flex' }}><ChildIcon className={`w-4 h-4 flex-shrink-0 transition-all duration-200${isActive ? ' nav-icon-active' : ''}`} /></span>
                      <span className="truncate">{childLabel}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

// ─── View As Selector (admin only) ──────────────────────────────────────────

function ViewAsSelector({ reps, subDealers, onSelect }: {
  reps: Array<{ id: string; name: string }>;
  subDealers: Array<{ id: string; name: string }>;
  onSelect: (user: { id: string; name: string; role: 'rep' | 'sub-dealer' }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allUsers = [
    ...reps.map((r) => ({ ...r, role: 'rep' as const })),
    ...subDealers.map((sd) => ({ ...sd, role: 'sub-dealer' as const })),
  ];

  const filtered = search.trim()
    ? allUsers.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()))
    : allUsers;

  return (
    <div className="px-3 pb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-xs transition-colors p-1.5 rounded-lg hover:bg-[#1d2028]"
        style={{ color: 'var(--d-muted, #8891a8)' }}
      >
        <Eye className="w-3.5 h-3.5 flex-shrink-0" />
        <span>View As...</span>
      </button>
      {open && (
        <div className="mt-1 bg-[#161920] border border-[#272b35] rounded-lg overflow-hidden shadow-xl">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reps..."
            className="w-full bg-transparent border-b border-[#333849] px-3 py-2 text-xs text-white outline-none placeholder:text-[#525c72]"
          />
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-[#525c72] p-3 text-center">No matches</p>
            ) : filtered.map((u) => (
              <button
                key={u.id}
                onClick={() => { onSelect(u); setOpen(false); setSearch(''); }}
                className="w-full text-left px-3 py-2 text-xs text-[#c2c8d8] hover:bg-[#1d2028] hover:text-white transition-colors flex items-center justify-between"
              >
                <span>{u.name}</span>
                <span className="text-[10px] text-[#525c72] capitalize">{u.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Layout ────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { currentRole, currentRepName, currentRepId, trainerAssignments, logout, projects, payrollEntries, dataError, effectiveRole, effectiveRepId, effectiveRepName, isViewingAs, viewAsUser, setViewAsUser, clearViewAs, pmPermissions, reps, subDealers } = useApp();
  const { signOut } = useClerk();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadMentionCount, setUnreadMentionCount] = useState(0);

  // Fetch unread mention count periodically
  useEffect(() => {
    if (!currentRepId) return;
    const fetchCount = () => {
      fetch(`/api/mentions?userId=${currentRepId}`)
        .then((res) => { if (!res.ok) throw new Error('fail'); return res.json(); })
        .then((data) => {
          const items = Array.isArray(data) ? data : data.mentions ?? [];
          // Count mentions that are either unread OR have uncompleted check items
          const actionable = items.filter((m: any) => {
            const isUnread = !m.readAt;
            const hasOpenTasks = (m.message?.checkItems ?? []).some((ci: any) => !ci.completed);
            return isUnread || hasOpenTasks;
          }).length;
          setUnreadMentionCount(actionable);
        })
        .catch(() => setUnreadMentionCount(0));
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [currentRepId]);

  // Persist sidebar collapse state in localStorage (#8)
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Reset scroll position when route changes
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Close mobile sidebar whenever the route changes (link tap auto-dismisses).
  // Uses during-render derived state to avoid calling setState inside an effect.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!currentRole) router.push('/');
  }, [currentRole, router]);

  // Show / hide scroll-to-top button based on main scroll position
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handleScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // ── Global navigation hotkeys (N / P / E / D) ──────────────────────────
  // Only fires when no modal is open and focus is not inside an input element.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Stand down when any modal is open.
      if (paletteOpen || shortcutsOpen) return;
      // Stand down when an interactive element is focused.
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;
      // Ignore modifier combos (⌘N, Ctrl+N, etc.) — those belong to the OS/browser.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          router.push('/dashboard/new-deal');
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          router.push('/dashboard/projects');
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          router.push('/dashboard/earnings');
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          router.push('/dashboard');
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paletteOpen, shortcutsOpen, router]);

  // ── Notification badge counts ──────────────────────────────────────────────
  const navBadges = useMemo(() => {
    const badges: Record<string, number> = {};
    if (!projects || !payrollEntries) return badges;

    if (currentRole === 'admin') {
      // Admin: Projects badge shows flagged + stale counts (admin's responsibility)
      const STALE_PHASES = new Set(['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed']);
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const flaggedCount = projects.filter((p) => p.flagged).length;
      const staleCount = projects.filter((p) => {
        if (!STALE_PHASES.has(p.phase)) return false;
        const soldMs = new Date(p.soldDate).getTime();
        return (now - soldMs) > thirtyDaysMs;
      }).length;
      const projectsBadge = flaggedCount + staleCount;
      if (projectsBadge > 0) badges['Projects'] = projectsBadge;

      // Payroll badge: count of Draft entries
      const draftCount = payrollEntries.filter((e) => e.status === 'Draft').length;
      if (draftCount > 0) badges['Payroll'] = draftCount;
    }

    // Rep/sub-dealer: no project or payroll badges — their action items come from chatter (unreadMentionCount handled separately)

    return badges;
  }, [projects, payrollEntries, currentRole]);

  if (!currentRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6"
           style={{ background: 'linear-gradient(135deg, #0b0d11 0%, #0f1117 60%, #0f1117 100%)' }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
             style={{ background: 'linear-gradient(135deg, #00e07a, #00e07a)' }}>
          <span className="text-white font-black text-3xl" style={{ letterSpacing: '-2px' }}>K</span>
        </div>
        <div className="w-6 h-6 relative">
          <div className="absolute inset-0 rounded-full border-2 border-[#272b35]/40" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
        </div>
      </div>
    );
  }

  const isTrainer = trainerAssignments.some((a) => a.trainerId === currentRepId);
  const repNav = isTrainer ? REP_NAV : REP_NAV.filter((item) => !('href' in item && item.href === '/dashboard/training'));

  // Build PM nav with conditional items
  const buildPmNav = () => {
    const items = [...PM_NAV];
    if (pmPermissions?.canCreateDeals) items.splice(1, 0, { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle });
    if (pmPermissions?.canAccessBlitz) items.push({ href: '/dashboard/blitz', label: 'Blitz', icon: Tent });
    return items;
  };

  // Use effectiveRole for View As, currentRole for actual role
  const roleForNav = isViewingAs ? effectiveRole : currentRole;
  const navItems = roleForNav === 'admin' ? ADMIN_NAV
    : roleForNav === 'project_manager' ? buildPmNav()
    : roleForNav === 'sub-dealer' ? SUB_DEALER_NAV
    : repNav;

  const handleLogout = () => {
    logout();
    signOut({ redirectUrl: '/sign-in' });
  };

  const initials = currentRepName
    ? currentRepName.split(' ').map((n) => n[0]).join('').toUpperCase()
    : 'A';

  // On mobile the overlay always shows full labels; on desktop respect collapsed.
  const showCollapsed = collapsed && !mobileOpen;

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--navy-base)' }}>

      {/* ── Mobile top bar (hidden on md+) — minimal: logo only ────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-20 flex items-center justify-center px-4 h-[48px]"
        style={{
          background: 'rgba(6,11,19,0.9)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div className="flex items-baseline gap-0.5">
          <span className="text-white font-black tracking-tighter text-xl leading-none" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>kilo</span>
          <span style={{ color: 'var(--m-accent, #00e5a0)', fontSize: '6px', lineHeight: 1, alignSelf: 'flex-end', marginBottom: '3px', marginLeft: '1px', marginRight: '1px' }}>&bull;</span>
          <span className="tracking-[0.2em] uppercase" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '10px', fontWeight: 400 }}>energy</span>
        </div>
      </div>

      {/* ── Backdrop (mobile only, shown when sidebar is open) ──────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          role="dialog"
          aria-modal="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      {/*
       * Mobile (<md):  position fixed, off-screen by default, slides in as
       *                an overlay when mobileOpen is true. Always 220px wide.
       * Desktop (md+): position relative (in flex flow), always translate-x-0,
       *                width follows the collapsed toggle as before.
       */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r',
          'transition-all duration-300 ease-in-out',
          // Reset to in-flow on desktop
          'md:relative md:inset-auto md:z-auto md:translate-x-0',
          // Force full width on mobile regardless of collapsed state
          'max-md:!w-[220px] max-md:border-[#333849]/60',
          // Slide in / out on mobile
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{
          width: collapsed ? '64px' : '220px',
          backgroundColor: 'var(--navy-card)',
          borderColor: 'var(--d-border, #272b35)',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {/* Logo + collapse/close toggle */}
        <div className="flex items-center justify-between px-4 py-4 h-[60px]" style={{ borderBottom: '1px solid var(--d-border, #272b35)' }}>
          {!showCollapsed && (
            <div className="flex items-center gap-2 overflow-hidden min-w-0">
              <div className="flex items-baseline gap-0.5 overflow-hidden min-w-0">
                <span className="text-white font-bold tracking-tighter text-xl leading-none" style={{ fontFamily: "'DM Sans', sans-serif" }}>kilo</span>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#00e07a', boxShadow: '0 0 10px #00e07a', marginLeft: 2, marginRight: 2, alignSelf: 'center', flexShrink: 0 }} />
                <span className="tracking-[0.14em] uppercase" style={{ color: 'var(--d-muted, #8891a8)', fontFamily: "'DM Sans', sans-serif", fontSize: '10px', fontWeight: 400 }}>energy</span>
              </div>
              {/* ⌘K hint badge — opens command palette on click */}
              <button
                onClick={() => setPaletteOpen(true)}
                title="Open command palette (⌘K)"
                className="flex-shrink-0 hover:text-[#c2c8d8] transition-colors"
                style={{ color: 'var(--d-muted, #8891a8)' }}
                aria-label="Open command palette"
              >
                <kbd className="font-mono text-[9px] rounded px-1.5 py-0.5 leading-none" style={{ background: 'var(--d-card, #1d2028)', border: '1px solid var(--d-border2, #333849)' }}>
                  ⌘K
                </kbd>
              </button>
              {/* ? hint badge — opens keyboard shortcuts overlay on click */}
              <button
                onClick={() => setShortcutsOpen(true)}
                title="Keyboard shortcuts (?)"
                className="flex-shrink-0 hover:text-[#c2c8d8] transition-colors"
                style={{ color: 'var(--d-muted, #8891a8)' }}
                aria-label="Open keyboard shortcuts"
              >
                <kbd className="font-mono text-[9px] rounded px-1.5 py-0.5 leading-none" style={{ background: 'var(--d-card, #1d2028)', border: '1px solid var(--d-border2, #333849)' }}>
                  ?
                </kbd>
              </button>
            </div>
          )}
          {/* Desktop: collapse chevron */}
          <button
            onClick={() => { setCollapsed((v) => { const next = !v; localStorage.setItem('sidebar-collapsed', String(next)); return next; }); }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex hover:text-white transition-colors p-1 rounded-lg hover:bg-[#1d2028] flex-shrink-0"
            style={{ color: 'var(--d-muted, #8891a8)' }}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          {/* Mobile: close (X) button */}
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="md:hidden text-[#8891a8] hover:text-white transition-colors p-1 rounded-lg hover:bg-[#1d2028] flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden relative">
          {/* Depth gradient — fades content as it scrolls under this edge */}
          <div className="pointer-events-none sticky top-0 left-0 right-0 h-6 z-10 -mb-6" style={{ background: 'linear-gradient(to bottom, var(--navy-card), transparent)' }} />
          <ul className="space-y-0.5 px-2">
            {navItems.map((item, index) => {
              // ── NavGroup (collapsible section) ───────────────────────────
              if ('type' in item && item.type === 'group') {
                const isFirstGroup =
                  navItems.findIndex((i) => 'type' in i && i.type === 'group') === index;
                return (
                  <Fragment key={item.label}>
                    {/* 'TOOLS' section divider — only in expanded sidebar */}
                    {!showCollapsed && isFirstGroup && (
                      <li className="text-[10px] uppercase px-3 pt-4 pb-1" style={{ color: 'var(--d-dim, #525c72)', letterSpacing: '0.14em' }}>
                        TOOLS
                      </li>
                    )}
                    <NavGroup
                      label={item.label}
                      icon={item.icon}
                      items={item.children}
                      pathname={pathname}
                      sidebarCollapsed={showCollapsed}
                    />
                  </Fragment>
                );
              }

              // ── Flat nav link ────────────────────────────────────────────
              const { href, label, icon: Icon } = item as NavItem;
              const isActive =
                href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(href);

              return (
                <Fragment key={href}>
                  {/* 'MAIN' section divider before the very first item — expanded only */}
                  {!showCollapsed && index === 0 && (
                    <li className="text-[10px] uppercase px-3 pt-4 pb-1" style={{ color: 'var(--d-dim, #525c72)', letterSpacing: '0.14em' }}>
                      MAIN
                    </li>
                  )}
                  <li className={showCollapsed ? 'relative group/tip' : ''}>
                    <Link
                      href={href}
                      title={showCollapsed ? label : undefined}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${showCollapsed ? 'justify-center' : ''}`}
                      style={isActive
                        ? { background: 'rgba(0,224,122,0.1)', border: '1px solid rgba(0,224,122,0.25)', color: '#00e07a', fontWeight: 700 }
                        : { color: 'var(--d-sub, #c2c8d8)', fontWeight: 500, border: '1px solid transparent' }
                      }
                    >
                      {/* Icon bounces once whenever this route becomes active */}
                      <span className="relative flex-shrink-0">
                        <span style={{ opacity: isActive ? 1 : 0.5, color: isActive ? '#00e07a' : 'inherit', display: 'inline-flex' }}><Icon className={`w-4 h-4 transition-all duration-200${isActive ? ' nav-icon-active' : ''}`} /></span>
                        {(() => {
                          const badgeCount = (navBadges[label] ?? 0) + (label === 'Projects' ? unreadMentionCount : 0);
                          if (badgeCount <= 0) return null;
                          return (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full text-[9px] font-bold leading-none text-white bg-red-500 shadow-sm shadow-red-500/30">
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                          );
                        })()}
                      </span>
                      {!showCollapsed && <span className="truncate">{label}</span>}
                    </Link>
                    {/* Tooltip popover — only shown when sidebar is collapsed */}
                    {showCollapsed && (
                      <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 nav-tooltip-popover">
                        <span className="nav-tooltip-bubble whitespace-nowrap rounded-md backdrop-blur-md bg-[#1d2028]/90 border border-[#272b35]/40 px-2.5 py-1.5 text-xs font-medium text-white shadow-xl">
                          {label}
                        </span>
                      </div>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </nav>

        {/* View As selector (admin only) */}
        {currentRole === 'admin' && !isViewingAs && !showCollapsed && (
          <ViewAsSelector reps={reps} subDealers={subDealers} onSelect={setViewAsUser} />
        )}

        {/* Keyboard shortcuts help */}
        <div className={`px-3 pb-1 ${showCollapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts"
            className="flex items-center gap-2 text-xs transition-colors p-1.5 rounded-lg hover:bg-[#1d2028]"
            style={{ color: 'var(--d-muted, #8891a8)' }}
            aria-label="Keyboard shortcuts"
          >
            <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {!showCollapsed && <span>Shortcuts</span>}
          </button>
        </div>

        {/* User + Logout */}
        <div>
          <div className="h-px" style={{ background: 'linear-gradient(to right, transparent, var(--d-border, #272b35), transparent)' }} />
        <div className="px-3 py-4">
          {!showCollapsed ? (
            <div className="flex items-center gap-3 mb-3 p-2 rounded-lg" style={{ background: 'var(--d-card, #1d2028)', border: '1px solid var(--d-border2, #333849)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #4d9fff, #b47dff)' }}>
                {initials}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold truncate leading-tight" style={{ color: 'var(--d-text)', fontFamily: "'DM Sans', sans-serif", fontSize: 12 }}>
                  {currentRepName}
                </p>
                <p className="text-xs capitalize" style={{ color: 'var(--d-muted)', fontSize: 11 }}>{currentRole}</p>
              </div>
            </div>
          ) : (
            <div className="flex justify-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: 'linear-gradient(135deg, #4d9fff, #b47dff)' }} title={currentRepName ?? ''}>
                {initials}
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={showCollapsed ? 'Logout' : undefined}
            className={`flex items-center gap-2 text-xs transition-colors w-full ${
              showCollapsed ? 'justify-center' : ''
            }`}
            style={{ color: 'var(--d-red, #ff5252)' }}
          >
            <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
            {!showCollapsed && 'Logout'}
          </button>
        </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      {/* pt-[48px] reserves space for the fixed mobile top bar; reset on md+ */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto pt-[48px] md:pt-0 pb-20 md:pb-0 relative"
        style={{ backgroundColor: 'var(--navy-base)' }}
      >
        {dataError && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
            Failed to load data. Please check your connection and refresh.
          </div>
        )}
        {/* View As banner */}
        {isViewingAs && viewAsUser && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300 text-sm font-medium">Viewing as <span className="text-white font-semibold">{viewAsUser.name}</span> <span className="text-amber-400/60 capitalize">({viewAsUser.role})</span></span>
            </div>
            <button onClick={clearViewAs} className="flex items-center gap-1 text-xs text-amber-400 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-amber-500/10">
              <XCircle className="w-3.5 h-3.5" /> Exit
            </button>
          </div>
        )}
        <div>
          {children}
        </div>

        {/* Scroll-to-top button */}
        <button
          onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className={`sticky bottom-20 ml-auto mr-4 z-30 flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#1d2028] border border-[#272b35]/60 text-[#c2c8d8] hover:text-white hover:border-[#272b35] shadow-lg shadow-black/30 transition-all duration-300 ${
            showScrollTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <ChevronUp className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">Top</span>
        </button>
      </main>

      {/* ── Command palette (⌘K) ────────────────────────────────────────── */}
      <CommandPalette
        open={paletteOpen}
        onOpen={() => setPaletteOpen(true)}
        onClose={() => setPaletteOpen(false)}
        role={roleForNav}
      />

      {/* ── Keyboard shortcuts overlay (?) ──────────────────────────────── */}
      <ShortcutsOverlay
        open={shortcutsOpen}
        onOpen={() => setShortcutsOpen(true)}
        onClose={() => setShortcutsOpen(false)}
        paletteOpen={paletteOpen}
      />

      {/* ── PWA install prompt (mobile only) ───────────────────────────── */}
      <InstallPrompt />

      {/* ── Bottom navigation bar (mobile only, hidden on md+) ────────── */}
      <BottomNav role={roleForNav ?? 'rep'} isTrainer={isTrainer} onLogout={handleLogout} />
    </div>
  );
}
