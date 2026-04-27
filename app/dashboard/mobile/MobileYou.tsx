'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import {
  LogOut, Mail, Phone, Eye, XCircle, Search, SlidersHorizontal,
  PlusCircle, Tent, GraduationCap, Calculator, Trophy, Settings, ChevronRight,
} from 'lucide-react';
import { useApp } from '../../../lib/context';
import MobileCard from './shared/MobileCard';
import MobileSection from './shared/MobileSection';

const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  rep: 'Sales Rep',
  'sub-dealer': 'Sub-Dealer',
  project_manager: 'Project Manager',
};

type QuickAction = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Preferences is the rep / sub-dealer / PM entry point for theme and other
// per-user settings. Admins manage these under Settings → Appearance, so
// the Preferences shortcut is intentionally absent from ADMIN_ACTIONS.
const PREFERENCES_ACTION: QuickAction = {
  href: '/dashboard/preferences',
  label: 'Preferences',
  icon: SlidersHorizontal,
};

const REP_ACTIONS: QuickAction[] = [
  { href: '/dashboard/blitz', label: 'Blitz', icon: Tent },
  { href: '/dashboard/calculator', label: 'Calculator', icon: Calculator },
  PREFERENCES_ACTION,
];

const REP_TRAINER_ACTIONS: QuickAction[] = [
  { href: '/dashboard/blitz', label: 'Blitz', icon: Tent },
  { href: '/dashboard/training', label: 'Training', icon: GraduationCap },
  { href: '/dashboard/calculator', label: 'Calculator', icon: Calculator },
  PREFERENCES_ACTION,
];

const SUB_DEALER_ACTIONS: QuickAction[] = [PREFERENCES_ACTION];
const PM_ACTIONS: QuickAction[] = [PREFERENCES_ACTION];

const ADMIN_ACTIONS: QuickAction[] = [
  { href: '/dashboard/new-deal', label: 'New Deal', icon: PlusCircle },
  { href: '/dashboard/blitz', label: 'Blitz', icon: Tent },
  { href: '/dashboard/training', label: 'Training', icon: GraduationCap },
  { href: '/dashboard/incentives', label: 'Incentives', icon: Trophy },
  { href: '/dashboard/calculator', label: 'Calculator', icon: Calculator },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

function resolveActions(role: string, isTrainer: boolean): QuickAction[] {
  if (role === 'admin') return ADMIN_ACTIONS;
  if (role === 'sub-dealer') return SUB_DEALER_ACTIONS;
  if (role === 'project_manager') return PM_ACTIONS;
  return isTrainer ? REP_TRAINER_ACTIONS : REP_ACTIONS;
}

export default function MobileYou() {
  const router = useRouter();
  const { signOut } = useClerk();
  const {
    currentRole,
    effectiveRole,
    effectiveRepId,
    effectiveRepName,
    reps,
    subDealers,
    viewAsCandidates,
    trainerAssignments,
    isViewingAs,
    viewAsUser,
    setViewAsUser,
    clearViewAs,
    logout,
  } = useApp();

  const [viewAsSearch, setViewAsSearch] = useState('');
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const viewAsPanelRef = useRef<HTMLDivElement | null>(null);

  // When the dropdown opens, the panel can render below the viewport on
  // taller content. Scroll it into view (centered) so the search field
  // and rep list are visible without an extra scroll.
  useEffect(() => {
    if (viewAsOpen && viewAsPanelRef.current) {
      const node = viewAsPanelRef.current;
      // Defer one frame so the panel has its final height before scrolling.
      requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [viewAsOpen]);

  // Mirror layout.tsx:479 trainer detection so the rep's quick-actions list
  // includes Training only when they actually have trainees assigned.
  const isTrainer = trainerAssignments.some(
    (a) => a.trainerId === effectiveRepId,
  );

  // Use effective role so admin's "View As Rep" actually swaps the page
  // contents to the rep's You layout (rep shortcuts, rep profile, no
  // appearance duplicate). The View As button itself remains gated on
  // currentRole === 'admin' below so the admin can always exit.
  const role = effectiveRole ?? 'rep';
  const actions = resolveActions(role, isTrainer);

  const matchedRep = reps.find((r) => r.id === effectiveRepId);
  const matchedSD = !matchedRep ? subDealers.find((sd) => sd.id === effectiveRepId) : null;
  const userName = effectiveRepName || 'User';
  const userEmail = matchedRep?.email || matchedSD?.email || '';
  const userPhone = matchedRep?.phone || matchedSD?.phone || '';
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const isAdmin = currentRole === 'admin';

  const handleLogout = () => {
    logout();
    signOut({ redirectUrl: '/sign-in' });
  };

  const handleViewAsPick = (user: { id: string; name: string; role: 'rep' | 'sub-dealer' | 'admin' | 'project_manager'; scopedInstallerId?: string | null }) => {
    setViewAsUser(user);
    setViewAsOpen(false);
    setViewAsSearch('');
    router.push('/dashboard');
  };

  return (
    <div className="px-5 pt-6 pb-24 space-y-6" style={{ fontFamily: FONT_BODY }}>
      {/* ─── Centered profile header ───
          Avatar leads, name + role badge stack underneath, contact rows
          render below in a softer color. When admin is impersonating, an
          amber pill appears above the avatar so the impersonation state
          is hard to miss — the View As card lower down is the secondary
          control. */}
      <div className="flex flex-col items-center text-center gap-3">
        {isAdmin && isViewingAs && viewAsUser && (
          <button
            onClick={clearViewAs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors active:scale-[0.97]"
            style={{
              background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)',
              color: 'var(--accent-amber-text)',
              fontFamily: FONT_BODY,
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label="Exit viewing-as mode"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Viewing as {viewAsUser.name}</span>
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}

        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, var(--accent-emerald-solid) 0%, var(--accent-cyan-solid) 100%)',
            boxShadow: '0 0 32px color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)',
            fontFamily: FONT_BODY,
            fontSize: '1.75rem',
            fontWeight: 700,
            color: '#000',
          }}
        >
          {initials}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <p
            className="text-xl font-bold text-[var(--text-primary)]"
            style={{ fontFamily: FONT_BODY }}
          >
            {userName}
          </p>
          <span
            className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)',
              color: 'var(--accent-emerald-text)',
              fontFamily: FONT_BODY,
            }}
          >
            {ROLE_LABELS[role] || role}
          </span>
        </div>

        {(userEmail || userPhone) && (
          <div className="flex flex-col items-center gap-1 mt-1">
            {userEmail && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                <span
                  className="text-sm"
                  style={{ color: 'var(--text-muted)', fontFamily: FONT_BODY }}
                >
                  {userEmail}
                </span>
              </div>
            )}
            {userPhone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                <span
                  className="text-sm"
                  style={{ color: 'var(--text-muted)', fontFamily: FONT_BODY }}
                >
                  {userPhone}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Quick actions ─── */}
      {actions.length > 0 && (
        <MobileSection title="Shortcuts">
          <MobileCard className="!p-2">
            {actions.map(({ href, label, icon: Icon }, index) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 min-h-[52px] px-3 py-3 rounded-xl active:scale-[0.98] active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[transform,background-color] duration-[75ms]"
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: FONT_BODY,
                  fontSize: '1rem',
                  WebkitTapHighlightColor: 'transparent',
                  borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                <span
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-emerald-solid) 10%, transparent)',
                    color: 'var(--accent-emerald-text)',
                  }}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1">{label}</span>
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </Link>
            ))}
          </MobileCard>
        </MobileSection>
      )}

      {/* ─── View As (admin only) ───
          Intentionally muted — admin uses this rarely, and the inline
          impersonation pill above the avatar is the louder feedback. The
          row below sits inline with no boxed icon, no card chrome, and a
          dimmed text color so it almost disappears unless you're looking
          for it. The dropdown panel is ref'd so it can scroll into view
          on open (otherwise it can render below the viewport on taller
          content). */}
      {isAdmin && !isViewingAs && (
        <div className="pt-2">
          <button
            onClick={() => setViewAsOpen((v) => !v)}
            aria-expanded={viewAsOpen}
            className="flex items-center gap-2.5 w-full min-h-[44px] px-2 py-2 rounded-lg active:opacity-60 transition-opacity"
            style={{
              color: 'var(--text-muted)',
              fontFamily: FONT_BODY,
              fontSize: '0.875rem',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Eye className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">View as user&hellip;</span>
            <ChevronRight
              className="w-3.5 h-3.5"
              style={{
                transform: viewAsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </button>
          {viewAsOpen && (
            <div
              ref={viewAsPanelRef}
              className="mt-2 rounded-xl overflow-hidden"
              style={{ background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  autoFocus
                  value={viewAsSearch}
                  onChange={(e) => setViewAsSearch(e.target.value)}
                  placeholder="Search users..."
                  className="w-full bg-transparent pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                  style={{ borderBottom: '1px solid var(--border-subtle)', fontFamily: FONT_BODY }}
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {([
                  ...(reps || [])
                    .filter((r) => r.active !== false)
                    .map((r) => ({ id: r.id, name: r.name, role: 'rep' as const, scopedInstallerId: null as string | null })),
                  ...(subDealers || [])
                    .filter((sd) => sd.active !== false)
                    .map((sd) => ({ id: sd.id, name: sd.name, role: 'sub-dealer' as const, scopedInstallerId: null as string | null })),
                  ...(viewAsCandidates || [])
                    .map((c) => ({ id: c.id, name: c.name, role: c.role, scopedInstallerId: c.scopedInstallerId })),
                ] as Array<{ id: string; name: string; role: 'rep' | 'sub-dealer' | 'admin' | 'project_manager'; scopedInstallerId: string | null }>)
                  .filter(
                    (u) =>
                      !viewAsSearch.trim() ||
                      u.name.toLowerCase().includes(viewAsSearch.toLowerCase()),
                  )
                  .map((u) => {
                    const roleLabel = u.role === 'project_manager'
                      ? (u.scopedInstallerId ? 'vendor PM' : 'PM')
                      : u.role === 'sub-dealer' ? 'sub-dealer'
                      : u.role;
                    return (
                      <button
                        key={`${u.role}-${u.id}`}
                        onClick={() => handleViewAsPick(u)}
                        className="w-full text-left px-4 py-3 text-sm text-[var(--text-primary)] active:scale-[0.98] active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[transform,background-color] duration-[75ms] flex items-center justify-between"
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          fontFamily: FONT_BODY,
                          WebkitTapHighlightColor: 'transparent',
                        }}
                      >
                        <span className="truncate pr-3">{u.name}</span>
                        <span
                          className="text-xs shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {roleLabel}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Sign out ─── */}
      <button
        onClick={handleLogout}
        className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-xl active:scale-[0.98] transition-[transform,background-color] duration-[75ms]"
        style={{
          background: 'color-mix(in srgb, var(--accent-red-solid) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent-red-solid) 25%, transparent)',
          color: 'var(--accent-red-text)',
          fontFamily: FONT_BODY,
          fontSize: '0.95rem',
          fontWeight: 600,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <LogOut className="w-4 h-4" />
        <span>Sign Out</span>
      </button>
    </div>
  );
}
