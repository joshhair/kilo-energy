'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useIsHydrated, useFocusTrap, useMediaQuery } from '../../../lib/hooks';
import MobileReps from '../mobile/MobileReps';
import { useApp } from '../../../lib/context';
import { formatCompactKW } from '../../../lib/utils';
import { Search, ChevronRight, ChevronDown, Users, Plus, Trash2, X, Mail, Clock, UserCog } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { RepSelector } from '../components/RepSelector';
import { useToast } from '../../../lib/toast';
import { GradCard } from './components/GradCard';
import { RepsSkeleton } from './components/RepsSkeleton';
import { TopPerformersPodium } from './components/TopPerformersPodium';

const FILTER_TABS = [
  { value: 'all',    label: 'All' },
  { value: 'closer', label: 'Closers' },
  { value: 'setter', label: 'Setters' },
  { value: 'both',   label: 'Both' },
] as const;
type FilterTab = typeof FILTER_TABS[number]['value'];

// Top-level role filter for the unified Users directory.
// Distinct from FILTER_TABS (which is a rep-type sub-filter that only
// applies when viewing reps).
const ROLE_FILTERS = [
  { value: 'all',              label: 'All' },
  { value: 'rep',              label: 'Reps' },
  { value: 'sub-dealer',       label: 'Sub-Dealers' },
  { value: 'project_manager',  label: 'Project Managers' },
  { value: 'admin',            label: 'Admins' },
] as const;
type RoleFilter = typeof ROLE_FILTERS[number]['value'];

type SimpleUser = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  repType?: string;
  active?: boolean;
};

const PIPELINE_EXCLUDED: ReadonlySet<string> = new Set(['Cancelled', 'On Hold', 'Completed']);

const ROLE_LABELS = { closer: 'Closer', setter: 'Setter', both: 'Both' } as const;

// User account role labels (for the Add User modal role picker).
const ROLE_LABELS_BY_ROLE: Record<'rep' | 'admin' | 'sub-dealer' | 'project_manager', string> = {
  rep: 'Rep',
  admin: 'Admin',
  'sub-dealer': 'Sub-Dealer',
  project_manager: 'Project Manager',
};
const ROLE_BADGE_CLS = {
  closer: 'border',
  setter: 'border',
  both:   'border',
} as const;
const ROLE_BADGE_STYLES = {
  closer: { background: 'rgba(77,159,255,0.1)', color: 'var(--accent-blue)', borderColor: 'rgba(77,159,255,0.25)' },
  setter: { background: 'rgba(180,125,255,0.1)', color: '#b47dff', borderColor: 'rgba(180,125,255,0.25)' },
  both:   { background: 'rgba(0,196,240,0.1)', color: 'var(--accent-cyan)', borderColor: 'rgba(0,196,240,0.25)' },
} as const;
const ROLE_BADGE_HOVER = {
  closer: 'hover:brightness-125',
  setter: 'hover:brightness-125',
  both:   'hover:brightness-125',
} as const;
const ROLE_NEXT = { closer: 'setter', setter: 'both', both: 'closer' } as const;

// r=22 inside a 48×48 viewBox  →  circumference ≈ 138.23
const REP_RING_CIRCUMFERENCE = 2 * Math.PI * 22;

const RANK_GRADIENTS = [
  'from-yellow-400 to-amber-600', // gold  – #1
  'from-slate-300 to-slate-500',  // silver – #2
  'from-amber-600 to-amber-800',  // bronze – #3
];

export default function UsersPage() {
  return (
    <Suspense>
      <UsersPageInner />
    </Suspense>
  );
}

function UsersPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentRole, effectiveRole, projects, payrollEntries, reps, subDealers, addRep, addSubDealer, deactivateRep, reactivateRep, deactivateSubDealer, reactivateSubDealer, updateRepType, convertUserRole, trainerAssignments, setTrainerAssignments, dbReady } = useApp();
  const { toast } = useToast();
  useEffect(() => { document.title = 'Users | Kilo Energy'; }, []);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Top-level role filter (URL-backed via ?role= query param)
  const initialRoleFilter = (searchParams.get('role') ?? 'all') as RoleFilter;
  const [roleFilter, setRoleFilterState] = useState<RoleFilter>(
    ROLE_FILTERS.some(r => r.value === initialRoleFilter) ? initialRoleFilter : 'all',
  );
  const setRoleFilter = (v: RoleFilter) => {
    setRoleFilterState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v !== 'all') params.set('role', v); else params.delete('role');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Fetched lists of admin + PM users. These aren't in the app context
  // (which only includes reps + subDealers), so we pull them lazily from
  // the /api/reps?role=X endpoint on mount for admin viewers.
  const [adminUsers, setAdminUsers] = useState<SimpleUser[]>([]);
  const [pmUsers, setPmUsers] = useState<SimpleUser[]>([]);
  // One combined state flag for both fetches — flipped true only after
  // BOTH responses have landed. The All tab gates its entrance animation
  // on this so the stagger plays once with all cards present, instead of
  // playing twice as each fetch lands independently and replays the
  // cascade for the newly-added cards (the "glitching in" bug).
  // For non-admin viewers we skip the fetches entirely, so the flag
  // defaults to true to avoid gating the animation on data that never
  // arrives.
  const [extraUsersReady, setExtraUsersReady] = useState(false);
  useEffect(() => {
    if (effectiveRole === null) return;
    if (effectiveRole !== 'admin' && effectiveRole !== 'project_manager') { setExtraUsersReady(true); return; }
    // Promise.all collapses both responses into a single state update, so
    // the grid renders once with everyone present instead of twice.
    Promise.all([
      fetch('/api/reps?role=admin').then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/reps?role=project_manager').then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([adminsData, pmsData]: [
      Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string; active?: boolean }>,
      Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string; active?: boolean }>,
    ]) => {
      setAdminUsers(adminsData.map((u) => ({ ...u, role: 'admin' })));
      setPmUsers(pmsData.map((u) => ({ ...u, role: 'project_manager' })));
      setExtraUsersReady(true);
    });
  }, [effectiveRole]);

  const initialFilter = (searchParams.get('filter') ?? 'all') as FilterTab;
  const [filterTab, setFilterTabState] = useState<FilterTab>(FILTER_TABS.some(t => t.value === initialFilter) ? initialFilter : 'all');

  // Sync both filter states when the URL changes (e.g. browser back/forward)
  useEffect(() => {
    const urlRole = (searchParams.get('role') ?? 'all') as RoleFilter;
    setRoleFilterState(ROLE_FILTERS.some(r => r.value === urlRole) ? urlRole : 'all');
    const urlFilter = (searchParams.get('filter') ?? 'all') as FilterTab;
    setFilterTabState(FILTER_TABS.some(t => t.value === urlFilter) ? urlFilter : 'all');
  }, [searchParams]);

  const setFilterTab = (v: FilterTab) => {
    setFilterTabState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v !== 'all') params.set('filter', v); else params.delete('filter');
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const isHydrated = useIsHydrated();
  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';
  const canManageReps = isAdmin; // PM cannot manage, only view
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  // ── Add Rep modal state ────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const addRepPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(addRepPanelRef, showAddModal);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRepType, setNewRepType] = useState<'closer' | 'setter' | 'both'>('both');
  const [newTrainerId, setNewTrainerId] = useState('');
  const [isAddingRep, setIsAddingRep] = useState(false);
  // The user account role — rep, admin, sub-dealer, or project_manager.
  // Only reps use newRepType + trainer assignment; for other roles those
  // UI fields are hidden.
  const [newUserRole, setNewUserRole] = useState<'rep' | 'admin' | 'sub-dealer' | 'project_manager'>('rep');
  // When true, creating the rep also sends a Clerk invitation email.
  // Defaults to off so existing workflows (data import, pre-populating
  // reps without giving them app access) still work.
  const [sendInvite, setSendInvite] = useState(false);

  // Inactive (deactivated) reps live in a collapsible expander below the
  // main list. Default collapsed so the active roster stays clean.
  const [showInactive, setShowInactive] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Inactive sub-dealers — same pattern as inactive reps.
  const [showInactiveSubDealers, setShowInactiveSubDealers] = useState(false);
  const [reactivatingSubDealerId, setReactivatingSubDealerId] = useState<string | null>(null);

  // Inactive admins/PMs — same pattern.
  const [showInactivePMs, setShowInactivePMs] = useState(false);
  const [showInactiveAdmins, setShowInactiveAdmins] = useState(false);
  const [reactivatingPmId, setReactivatingPmId] = useState<string | null>(null);
  const [reactivatingAdminId, setReactivatingAdminId] = useState<string | null>(null);

  // ── Pending Clerk invitations (admin view) ────────────────────────────
  type PendingInvitation = {
    id: string;
    emailAddress: string;
    status: string;
    createdAt: number;
  };
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);

  const fetchPendingInvitations = useCallback(async () => {
    if (effectiveRole !== 'admin') return;
    try {
      const res = await fetch('/api/users/invitations');
      if (!res.ok) return;
      const data = await res.json();
      setPendingInvitations(data.invitations ?? []);
    } catch {
      // Silent fail — pending invites is a nice-to-have, not critical
    }
  }, [effectiveRole]);

  useEffect(() => { fetchPendingInvitations(); }, [fetchPendingInvitations]);

  const handleRevokeInvitation = (invitationId: string, email: string) => {
    if (revokingInvitationId) return;
    setConfirmAction({
      title: 'Revoke Invitation',
      message: `Revoke invitation for ${email}?`,
      confirmLabel: 'Revoke',
      onConfirm: async () => {
        setConfirmAction(null);
        setRevokingInvitationId(invitationId);
        try {
          const res = await fetch(`/api/users/invitations/${invitationId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Revoke failed');
          toast(`Invitation for ${email} revoked`, 'success');
          setPendingInvitations((prev) => prev.filter((i) => i.id !== invitationId));
        } catch {
          toast('Failed to revoke invitation', 'error');
        } finally {
          setRevokingInvitationId(null);
        }
      },
    });
  };

  const resetAddModal = () => {
    setNewFirstName(''); setNewLastName(''); setNewEmail(''); setNewPhone('');
    setNewRepType('both'); setNewTrainerId(''); setSendInvite(false);
    setNewUserRole('rep');
    setShowAddModal(false); setIsAddingRep(false);
  };

  // Escape key closes add-rep modal
  useEffect(() => {
    if (!showAddModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') resetAddModal(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
   
  }, [showAddModal]);

  const handleAddRep = () => {
    if (!newFirstName.trim() || !newLastName.trim() || isAddingRep) return;
    if (sendInvite && !newEmail.trim()) {
      toast('Email is required when sending an invitation', 'error');
      return;
    }
    // Admin + project_manager accounts only make sense with an invite —
    // they need to log in to do anything useful. Force the invite path
    // for those roles so we don't silently create dormant accounts.
    const effectiveSendInvite = sendInvite || newUserRole === 'admin' || newUserRole === 'project_manager';
    if (effectiveSendInvite && !newEmail.trim()) {
      toast('Email is required for this role', 'error');
      return;
    }

    setIsAddingRep(true);
    // Trainer assignment only applies to rep-role accounts.
    const trainerIdSnapshot = newUserRole === 'rep' ? newTrainerId : '';
    const isRepRole = newUserRole === 'rep';

    // Branch: inviting via Clerk goes through /api/users/invite, which
    // creates the internal user AND sends the sign-up email atomically.
    // Non-invite flow uses the existing addRep helper (rep-only, no email).
    const repPromise: Promise<{ id: string } | null> = effectiveSendInvite
      ? fetch('/api/users/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: newFirstName,
            lastName: newLastName,
            email: newEmail,
            phone: newPhone,
            role: newUserRole,
            // repType is only meaningful for rep accounts
            repType: isRepRole ? newRepType : undefined,
          }),
        })
          .then(async (r) => {
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              throw new Error(body.error ?? 'Failed to send invitation');
            }
            const json = await r.json();
            // Sync the new rep into local state so pickers reflect them
            // immediately without a hard refresh. addRep with a pre-supplied
            // id skips the POST and only updates the reps array.
            if (json.user.role === 'rep') {
              addRep(json.user.firstName, json.user.lastName, json.user.email, json.user.phone, json.user.repType, json.user.id);
            } else if (json.user.role === 'admin') {
              setAdminUsers((prev) => [...prev, { id: json.user.id, firstName: json.user.firstName, lastName: json.user.lastName, email: json.user.email, phone: json.user.phone, role: 'admin' }]);
            } else if (json.user.role === 'project_manager') {
              setPmUsers((prev) => [...prev, { id: json.user.id, firstName: json.user.firstName, lastName: json.user.lastName, email: json.user.email, phone: json.user.phone, role: 'project_manager' }]);
            } else if (json.user.role === 'sub-dealer') {
              addSubDealer(json.user.firstName, json.user.lastName, json.user.email, json.user.phone, json.user.id);
            }
            return { id: json.user.id as string };
          })
      : newUserRole === 'sub-dealer'
        ? (addSubDealer(newFirstName, newLastName, newEmail, newPhone) as Promise<{ id: string } | null>)
        : (addRep(newFirstName, newLastName, newEmail, newPhone, newRepType) as Promise<{ id: string } | null>);

    const roleLabel = ROLE_LABELS_BY_ROLE[newUserRole];
    repPromise
      ?.then((rep) => {
        if (rep) {
          toast(
            effectiveSendInvite
              ? `Invitation sent to ${newEmail} (${roleLabel})`
              : `${roleLabel} added`,
            'success',
          );
        }
        if (effectiveSendInvite) fetchPendingInvitations();
        resetAddModal();
      })
      .catch((err) => {
        toast(err?.message ?? 'Failed to add user', 'error');
        setIsAddingRep(false);
      });
    // If a trainer was selected (rep role only), persist assignment
    // after real rep ID is known.
    if (trainerIdSnapshot) {
      repPromise?.then((rep) => {
        if (!rep?.id) return;
        fetch('/api/trainer-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainerId: trainerIdSnapshot,
            traineeId: rep.id,
            tiers: [{ upToDeal: null, ratePerW: 0.05 }],
          }),
        })
          .then((r) => { if (!r.ok) throw new Error('Failed to assign trainer'); return r.json(); })
          .then((assignment) => {
            setTrainerAssignments((prev) => [
              ...prev,
              {
                id: assignment.id,
                trainerId: assignment.trainerId,
                traineeId: assignment.traineeId,
                tiers: (assignment.tiers ?? []).map((t: { upToDeal: number | null; ratePerW: number }) => ({
                  upToDeal: t.upToDeal,
                  ratePerW: t.ratePerW,
                })),
              },
            ]);
            toast('Trainer assigned', 'success');
          })
          .catch(() => toast('Failed to assign trainer', 'error'));
      }).catch(() => {});
    }
  };

  // ── Filter tab indicator ─────────────────────────────────────────────────
  const filterTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [filterIndicator, setFilterIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = FILTER_TABS.findIndex((t) => t.value === filterTab);
    const el = filterTabRefs.current[idx];
    if (el) setFilterIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [filterTab, roleFilter, isHydrated]);

  // ── Active deals count per rep (pipeline = not Cancelled/On Hold/Completed) ──
  const activeDealsByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      if (PIPELINE_EXCLUDED.has(p.phase)) continue;
      // Count for closer (repId)
      map.set(p.repId, (map.get(p.repId) ?? 0) + 1);
      // Count for setter if present and different from closer
      if (p.setterId && p.setterId !== p.repId) {
        map.set(p.setterId, (map.get(p.setterId) ?? 0) + 1);
      }
    }
    return map;
  }, [projects]);

  // ── Keyboard shortcut: '/' focuses the search input ──────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Debounce search → debouncedSearch (200ms; 0ms when cleared) ──────────
  useEffect(() => {
    const delay = search === '' ? 0 : 200;
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, delay);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Compare mode ───────────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  // Clear compare state when navigating away from the rep tab, or when
  // filterTab changes within the rep view (reps no longer visible can't be deselected)
  useEffect(() => {
    if (roleFilter !== 'rep') {
      setCompareMode(false);
      setCompareIds(new Set());
    }
    // When staying in the rep view, filterTab switches do not reset compare mode.
    // IDs for reps outside the current sub-filter are harmlessly ignored until
    // the user returns to a tab where those reps are visible.
  }, [roleFilter, filterTab]);

  // ── Sort ────────────────────────────────────────────────────────────────
  type SortBy = 'paid' | 'active' | 'deals' | 'name' | 'kw';
  const [sortBy, setSortBy] = useState<SortBy>('paid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  type ComparePeriod = 'this-week' | 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'custom';
  const PERIOD_OPTIONS: { value: ComparePeriod; label: string }[] = [
    { value: 'this-week', label: 'This Week' },
    { value: 'this-month', label: 'This Month' },
    { value: 'last-month', label: 'Last Month' },
    { value: 'this-quarter', label: 'This Quarter' },
    { value: 'last-quarter', label: 'Last Quarter' },
    { value: 'this-year', label: 'This Year' },
    { value: 'custom', label: 'Custom' },
  ];
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>('this-month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  /** Compute date ranges for current period and its "previous" comparison period */
  const getCompareDateRanges = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDay(); // 0=Sun

    const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const startOfWeek = new Date(y, m, now.getDate() - (d === 0 ? 6 : d - 1)); // Monday
    const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
    const q = Math.floor(m / 3);

    switch (comparePeriod) {
      case 'this-week': {
        const prevStart = new Date(startOfWeek); prevStart.setDate(prevStart.getDate() - 7);
        const prevEnd = new Date(prevStart); prevEnd.setDate(prevStart.getDate() + 6);
        return { current: { from: fmt(startOfWeek), to: fmt(endOfWeek), label: 'This Week' }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: 'Last Week' } };
      }
      case 'this-month': {
        const curStart = new Date(y, m, 1);
        const curEnd = new Date(y, m + 1, 0);
        const prevStart = new Date(y, m - 1, 1);
        const prevEnd = new Date(y, m, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: 'This Month' }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: 'Last Month' } };
      }
      case 'last-month': {
        const curStart = new Date(y, m - 1, 1);
        const curEnd = new Date(y, m, 0);
        const prevStart = new Date(y, m - 2, 1);
        const prevEnd = new Date(y, m - 1, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: 'Last Month' }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: 'Month Before' } };
      }
      case 'this-quarter': {
        const curStart = new Date(y, q * 3, 1);
        const curEnd = new Date(y, q * 3 + 3, 0);
        const prevStart = new Date(y, (q - 1) * 3, 1);
        const prevEnd = new Date(y, q * 3, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: `Q${q + 1} ${y}` }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: `Q${q === 0 ? 4 : q} ${q === 0 ? y - 1 : y}` } };
      }
      case 'last-quarter': {
        const pq = q === 0 ? 3 : q - 1;
        const py = q === 0 ? y - 1 : y;
        const curStart = new Date(py, pq * 3, 1);
        const curEnd = new Date(py, pq * 3 + 3, 0);
        const ppq = pq === 0 ? 3 : pq - 1;
        const ppy = pq === 0 ? py - 1 : py;
        const prevStart = new Date(ppy, ppq * 3, 1);
        const prevEnd = new Date(ppy, ppq * 3 + 3, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: `Q${pq + 1} ${py}` }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: `Q${ppq + 1} ${ppy}` } };
      }
      case 'this-year': {
        const curStart = new Date(y, 0, 1);
        const curEnd = new Date(y, 11, 31);
        const prevStart = new Date(y - 1, 0, 1);
        const prevEnd = new Date(y - 1, 11, 31);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: `${y}` }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: `${y - 1}` } };
      }
      case 'custom': {
        return { current: { from: customFrom, to: customTo, label: 'Custom' }, prev: null };
      }
    }
  };

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => reps.filter((r) => {
    // Hide deactivated reps from the main list — they live in the "Show
    // inactive" expander below so admins can find and reactivate them
    // without polluting the active roster.
    if (r.active === false) return false;
    // Selling admins (role='admin' + repType) are in the `reps` array so
    // dropdown pickers can reach them, but the Users > Reps bucket is for
    // actual role='rep' users — admins render under the Admins tab. Skip
    // them here so they don't duplicate.
    if (r.role !== 'rep') return false;
    // Search filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.email?.toLowerCase().includes(q)) return false;
    }
    // Role filter
    if (filterTab === 'all') return true;
    if (filterTab === 'both') return r.repType === 'both';
    // 'closer' tab shows closer + both; 'setter' tab shows setter + both
    return r.repType === filterTab || r.repType === 'both';
  }), [reps, debouncedSearch, filterTab]);

  // Inactive reps live below the main list in a collapsible expander.
  // Same search filter applies, but the role filter does NOT — admins
  // searching for a fired employee shouldn't have to remember which type
  // they were.
  const inactiveReps = reps.filter((r) => {
    if (r.active !== false) return false;
    if (r.role !== 'rep') return false;  // selling admins stay under the Admins tab
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.email?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Inactive sub-dealers — same pattern.
  const inactiveSubDealers = subDealers.filter((s) => {
    if (s.active !== false) return false;
    const name = `${s.firstName} ${s.lastName}`;
    if (debouncedSearch && !name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });

  // Inactive PMs — same pattern.
  const inactivePMs = pmUsers.filter((u) => {
    if (u.active !== false) return false;
    const name = `${u.firstName} ${u.lastName}`;
    if (debouncedSearch && !name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });

  // Inactive admins — same pattern.
  const inactiveAdmins = adminUsers.filter((u) => {
    if (u.active !== false) return false;
    const name = `${u.firstName} ${u.lastName}`;
    if (debouncedSearch && !name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });

  // ── Pre-compute paid totals & rank order across ALL reps ──────────────────
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const repPaidAmounts = useMemo(() => {
    return new Map(
      reps.map((rep) => [
        rep.id,
        payrollEntries
          .filter((p) => p.repId === rep.id && p.status === 'Paid' && p.date <= today)
          .reduce((s, p) => s + p.amount, 0),
      ])
    );
  }, [reps, payrollEntries, today]);

  const rankMap = useMemo(
    () =>
      new Map(
        [...reps]
          .filter((r) => r.role === 'rep' && r.active !== false && (repPaidAmounts.get(r.id) ?? 0) > 0)
          .sort((a, b) => (repPaidAmounts.get(b.id) ?? 0) - (repPaidAmounts.get(a.id) ?? 0))
          .map((rep, idx) => [rep.id, idx + 1])
      ),
    [reps, repPaidAmounts]
  );

  // ── Top 3 performers for podium section ─────────────────────────────────
  const topPerformers = useMemo(
    () =>
      [...reps]
        .filter((r) => r.role === 'rep' && r.active !== false)
        .map((rep) => ({ rep, paid: repPaidAmounts.get(rep.id) ?? 0 }))
        .filter(({ paid }) => paid > 0)
        .sort((a, b) => b.paid - a.paid)
        .slice(0, 3),
    [reps, repPaidAmounts]
  );

  // Visual layout: 2nd left (order-1), 1st centre (order-2), 3rd right (order-3)
  const podiumDisplay =
    topPerformers.length >= 3
      ? [
          { ...topPerformers[1], rank: 2, order: 1 },
          { ...topPerformers[0], rank: 1, order: 2 },
          { ...topPerformers[2], rank: 3, order: 3 },
        ]
      : [];

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'paid':   arr.sort((a, b) => (repPaidAmounts.get(b.id) ?? 0) - (repPaidAmounts.get(a.id) ?? 0)); break;
      case 'active': arr.sort((a, b) => (activeDealsByRep.get(b.id) ?? 0) - (activeDealsByRep.get(a.id) ?? 0)); break;
      case 'deals': {
        const dealsByRep = new Map<string, number>();
        for (const p of projects.filter(p => !PIPELINE_EXCLUDED.has(p.phase))) {
          if (p.repId)                       dealsByRep.set(p.repId,    (dealsByRep.get(p.repId)    ?? 0) + 1);
          if (p.setterId && p.setterId !== p.repId) dealsByRep.set(p.setterId, (dealsByRep.get(p.setterId) ?? 0) + 1);
        }
        arr.sort((a, b) => (dealsByRep.get(b.id) ?? 0) - (dealsByRep.get(a.id) ?? 0));
        break;
      }
      case 'kw': {
        const kwByRep = new Map<string, number>();
        for (const p of projects.filter(p => !PIPELINE_EXCLUDED.has(p.phase))) {
          if (p.repId)                       kwByRep.set(p.repId,    (kwByRep.get(p.repId)    ?? 0) + p.kWSize);
          if (p.setterId && p.setterId !== p.repId) kwByRep.set(p.setterId, (kwByRep.get(p.setterId) ?? 0) + p.kWSize);
        }
        arr.sort((a, b) => (kwByRep.get(b.id) ?? 0) - (kwByRep.get(a.id) ?? 0));
        break;
      }
      case 'name':   arr.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    if (sortDir === 'asc') arr.reverse();
    return arr;
  }, [filtered, sortBy, sortDir, repPaidAmounts, activeDealsByRep, projects]);

  const isMobile = useMediaQuery('(max-width: 767px)');

  // Gate on both client-hydrate AND /api/data so the fade-in runs on
  // real data (matches Dashboard + Projects).
  if (!isHydrated || !dbReady) {
    return <RepsSkeleton />;
  }

  if (isMobile) return <MobileReps />;

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
              <Users className="w-5 h-5 text-[var(--accent-green)]" />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Users</h1>
          </div>
        </div>
        <p className="text-[var(--text-secondary)] text-sm font-medium ml-12 tracking-wide">Reps, sub-dealers, project managers, and admins</p>
      </div>

      {/* Admin: add rep button */}
      {canManageReps && (
        <div className="mb-6">
          <button
            onClick={() => {
              // Pre-select the role that matches the currently active tab so
              // clicking "Add User" from the Admins tab defaults to Admin
              // (not Rep), which otherwise showed rep-specific fields like
              // Rep type / Trainer and felt broken.
              if (roleFilter === 'admin' || roleFilter === 'project_manager' || roleFilter === 'sub-dealer') {
                setNewUserRole(roleFilter);
              } else if (roleFilter === 'rep') {
                setNewUserRole('rep');
              }
              // 'all' tab keeps whatever was last picked.
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition-all hover:brightness-110 active:scale-[0.97]"
            style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#050d18' }}
          >
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>
      )}

      {/* Admin: pending invitations panel (only shown when there are any) */}
      {canManageReps && effectiveRole === 'admin' && pendingInvitations.length > 0 && (
        <div className="card-surface rounded-2xl p-5 mb-6" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(255,176,32,0.15)' }}>
              <Mail className="w-4 h-4 text-amber-400" />
            </div>
            <h2 className="text-white font-bold text-base tracking-tight">Pending Invitations</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/10 text-amber-400 border border-amber-400/20">
              {pendingInvitations.length}
            </span>
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            These users have been invited but haven&apos;t completed sign-up yet.
          </p>
          <div className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
                style={{ background: '#0f1117', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Clock className="w-4 h-4 text-amber-400/60 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-medium truncate">{inv.emailAddress}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                      Invited {new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeInvitation(inv.id, inv.emailAddress)}
                  disabled={revokingInvitationId === inv.id}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                >
                  {revokingInvitationId === inv.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Role filter bar — top-level filter across the unified directory ─ */}
      <div className="mb-6 flex overflow-x-auto whitespace-nowrap gap-2">
        {ROLE_FILTERS.filter((rf) =>
          effectiveRole === 'admin' || effectiveRole === 'project_manager'
            ? true
            : rf.value !== 'admin' && rf.value !== 'project_manager'
        ).map((rf) => {
          const active = roleFilter === rf.value;
          return (
            <button
              key={rf.value}
              onClick={() => setRoleFilter(rf.value)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
                active
                  ? 'border-[var(--accent-green)] text-[var(--accent-green)] bg-[var(--accent-green)]/10'
                  : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-card)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {rf.label}
            </button>
          );
        })}
      </div>

      {/* ── Non-rep view: simple user list ─────────────────────────────────── */}
      {roleFilter !== 'rep' && (() => {
        // Build the unified user pool based on the current role filter.
        const pool: SimpleUser[] =
          roleFilter === 'all'
            ? [
                // Filter to actual reps only — selling admins live in adminUsers below, not here.
                ...reps.filter((r) => r.active !== false && r.role === 'rep').map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, role: 'rep', repType: r.repType })),
                ...subDealers.filter((s) => s.active !== false).map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, role: 'sub-dealer' })),
                ...pmUsers.filter((u) => u.active !== false),
                ...adminUsers.filter((u) => u.active !== false),
              ]
            : roleFilter === 'sub-dealer'
            ? subDealers.filter((s) => s.active !== false).map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, role: 'sub-dealer' }))
            : roleFilter === 'project_manager'
            ? pmUsers.filter((u) => u.active !== false)
            : adminUsers.filter((u) => u.active !== false);

        const q = debouncedSearch.trim().toLowerCase();
        const filtered = q
          ? pool.filter((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
          : pool;

        const roleBadge: Record<string, { label: string; color: string; bg: string }> = {
          rep:              { label: 'Rep',              color: 'var(--accent-green)', bg: 'rgba(0,224,122,0.12)' },
          'sub-dealer':     { label: 'Sub-Dealer',       color: '#b47dff', bg: 'rgba(180,125,255,0.12)' },
          project_manager:  { label: 'Project Manager',  color: 'var(--accent-cyan)', bg: 'rgba(0,196,240,0.12)' },
          admin:            { label: 'Admin',            color: 'var(--accent-amber)', bg: 'rgba(255,176,32,0.12)' },
        };

        return (
          <div>
            {/* Search bar */}
            <div className="relative mb-4 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${roleFilter === 'all' ? 'all users' : roleBadge[roleFilter]?.label.toLowerCase() + 's'}…`}
                className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50 placeholder-[var(--text-dim)]"
              />
            </div>

            <div className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
            </div>

            {filtered.length === 0 ? (
              <div className="card-surface rounded-2xl p-8 text-center" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {q ? 'No users match your search.' : 'No users in this category yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filtered.map((u, i) => {
                  const badge = roleBadge[u.role] ?? { label: u.role, color: 'var(--text-muted)', bg: 'rgba(136,145,168,0.12)' };
                  const initials = `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
                  // Cascade entrance animation.
                  //
                  // Gated on extraUsersReady for the "all" filter (not
                  // needed for single-role filters): the non-rep fetches
                  // land after the initial render, and we want the cascade
                  // to play ONCE with all users present, not twice as each
                  // population arrives.
                  //
                  // We use inline animationDelay instead of the stagger-N
                  // CSS classes because those cap at stagger-6 (450ms),
                  // which causes cards 6+ to all pop in simultaneously at
                  // the end of the cascade. An inline per-card delay of
                  // 40ms gives a continuous cascade up to a soft cap of
                  // 600ms — smooth all the way through even with 30+ cards.
                  const shouldAnimate = roleFilter !== 'all' || extraUsersReady;
                  const delayMs = Math.min(i * 40, 600);
                  return (
                    <Link
                      key={u.id}
                      href={`/dashboard/users/${u.id}`}
                      className={`card-surface rounded-2xl p-4 flex items-center gap-3 transition-all hover:translate-y-[-2px] hover:shadow-lg active:scale-[0.98] ${shouldAnimate ? 'animate-slide-in-scale' : ''}`}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderLeft: `3px solid ${badge.color}`,
                        ...(shouldAnimate ? { animationDelay: `${delayMs}ms` } : {}),
                      }}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: badge.bg, color: badge.color }}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{u.firstName} {u.lastName}</p>
                        {u.email && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{u.email}</p>}
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                      {canManageReps && u.role === 'sub-dealer' && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction({ title: `Convert ${u.firstName} ${u.lastName} to Rep?`, message: `${u.firstName} ${u.lastName} will move to the Reps list with rep login and permission defaults. Deals, payroll history, commission records, and their Clerk login remain unchanged.`, confirmLabel: 'Convert', onConfirm: async () => { setConfirmAction(null); try { await convertUserRole(u.id, 'rep'); toast(`${u.firstName} ${u.lastName} converted to Rep`, 'success'); } catch { /* error toast shown by persistFetch */ } } }); }}
                          title="Convert to Rep"
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-dim)] hover:text-[var(--accent-green)] hover:bg-[rgba(0,224,122,0.12)] transition-colors"
                        >
                          <UserCog className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canManageReps && u.role === 'sub-dealer' && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction({ title: `Deactivate ${u.firstName} ${u.lastName}?`, message: 'They will lose app access immediately. You can reactivate them later.', onConfirm: async () => { setConfirmAction(null); try { await deactivateSubDealer(u.id); toast(`${u.firstName} ${u.lastName} deactivated`, 'success'); } catch { /* error toast shown by persistFetch */ } } }); }}
                          title="Deactivate sub-dealer"
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}

            {/* ── Inactive reps expander ──────────────────────────────── */}
            {canManageReps && roleFilter === 'all' && inactiveReps.length > 0 && (
              <div className="mt-6 pt-6 border-t border-dashed border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowInactive((v) => !v)}
                  className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[var(--surface-card)]/60"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${showInactive ? 'rotate-90' : ''}`}
                      style={{ color: 'var(--text-dim)' }}
                    />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Show inactive reps ({inactiveReps.length})
                    </span>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    Deactivated reps — click to {showInactive ? 'hide' : 'view'}
                  </span>
                </button>
                {showInactive && (
                  <div className="mt-3 space-y-2">
                    {inactiveReps.map((rep) => (
                      <div
                        key={rep.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.7 }}
                      >
                        <Link
                          href={`/dashboard/users/${rep.id}`}
                          className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-100"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            {rep.firstName[0] ?? ''}{rep.lastName[0] ?? ''}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                              {rep.name}
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                                (inactive)
                              </span>
                            </div>
                            <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                              {ROLE_LABELS[rep.repType]}
                            </div>
                          </div>
                        </Link>
                        <button
                          disabled={reactivatingId === rep.id}
                          onClick={async () => {
                            setReactivatingId(rep.id);
                            try {
                              await reactivateRep(rep.id);
                              toast(`${rep.name} reactivated`, 'success');
                            } catch {
                              toast('Failed to reactivate rep', 'error');
                            } finally {
                              setReactivatingId(null);
                            }
                          }}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: 'rgba(0,224,122,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,224,122,0.3)' }}
                        >
                          {reactivatingId === rep.id ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Inactive sub-dealers expander ───────────────────────── */}
            {canManageReps && (roleFilter === 'sub-dealer' || roleFilter === 'all') && inactiveSubDealers.length > 0 && (
              <div className="mt-6 pt-6 border-t border-dashed border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowInactiveSubDealers((v) => !v)}
                  className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[var(--surface-card)]/60"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${showInactiveSubDealers ? 'rotate-90' : ''}`}
                      style={{ color: 'var(--text-dim)' }}
                    />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Show inactive sub-dealers ({inactiveSubDealers.length})
                    </span>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    Deactivated sub-dealers — click to {showInactiveSubDealers ? 'hide' : 'view'}
                  </span>
                </button>
                {showInactiveSubDealers && (
                  <div className="mt-3 space-y-2">
                    {inactiveSubDealers.map((sd) => (
                      <div
                        key={sd.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.7 }}
                      >
                        <Link
                          href={`/dashboard/users/${sd.id}`}
                          className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-100"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            {sd.firstName[0] ?? ''}{sd.lastName[0] ?? ''}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                              {sd.firstName} {sd.lastName}
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                                (inactive)
                              </span>
                            </div>
                            {sd.email && <div className="text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{sd.email}</div>}
                          </div>
                        </Link>
                        <button
                          disabled={reactivatingSubDealerId === sd.id}
                          onClick={async () => {
                            setReactivatingSubDealerId(sd.id);
                            try {
                              await reactivateSubDealer(sd.id);
                              toast(`${sd.firstName} ${sd.lastName} reactivated`, 'success');
                            } catch {
                              toast('Failed to reactivate sub-dealer', 'error');
                            } finally {
                              setReactivatingSubDealerId(null);
                            }
                          }}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: 'rgba(180,125,255,0.12)', color: '#b47dff', border: '1px solid rgba(180,125,255,0.3)' }}
                        >
                          {reactivatingSubDealerId === sd.id ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Inactive PMs expander ───────────────────────────────── */}
            {canManageReps && (roleFilter === 'project_manager' || roleFilter === 'all') && inactivePMs.length > 0 && (
              <div className="mt-6 pt-6 border-t border-dashed border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowInactivePMs((v) => !v)}
                  className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[var(--surface-card)]/60"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${showInactivePMs ? 'rotate-90' : ''}`}
                      style={{ color: 'var(--text-dim)' }}
                    />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Show inactive project managers ({inactivePMs.length})
                    </span>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    Deactivated PMs — click to {showInactivePMs ? 'hide' : 'view'}
                  </span>
                </button>
                {showInactivePMs && (
                  <div className="mt-3 space-y-2">
                    {inactivePMs.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.7 }}
                      >
                        <Link
                          href={`/dashboard/users/${u.id}`}
                          className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-100"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            {u.firstName[0] ?? ''}{u.lastName[0] ?? ''}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                              {u.firstName} {u.lastName}
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                                (inactive)
                              </span>
                            </div>
                            {u.email && <div className="text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{u.email}</div>}
                          </div>
                        </Link>
                        <button
                          disabled={reactivatingPmId === u.id}
                          onClick={async () => {
                            setReactivatingPmId(u.id);
                            try {
                              const res = await fetch(`/api/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) });
                              if (!res.ok) throw new Error();
                              setPmUsers((prev) => prev.map((p) => p.id === u.id ? { ...p, active: true } : p));
                              toast(`${u.firstName} ${u.lastName} reactivated`, 'success');
                            } catch {
                              toast('Failed to reactivate project manager', 'error');
                            } finally {
                              setReactivatingPmId(null);
                            }
                          }}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: 'rgba(0,196,240,0.12)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,196,240,0.3)' }}
                        >
                          {reactivatingPmId === u.id ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Inactive admins expander ─────────────────────────────── */}
            {canManageReps && (roleFilter === 'admin' || roleFilter === 'all') && inactiveAdmins.length > 0 && (
              <div className="mt-6 pt-6 border-t border-dashed border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowInactiveAdmins((v) => !v)}
                  className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[var(--surface-card)]/60"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${showInactiveAdmins ? 'rotate-90' : ''}`}
                      style={{ color: 'var(--text-dim)' }}
                    />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Show inactive admins ({inactiveAdmins.length})
                    </span>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    Deactivated admins — click to {showInactiveAdmins ? 'hide' : 'view'}
                  </span>
                </button>
                {showInactiveAdmins && (
                  <div className="mt-3 space-y-2">
                    {inactiveAdmins.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.7 }}
                      >
                        <Link
                          href={`/dashboard/users/${u.id}`}
                          className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-100"
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            {u.firstName[0] ?? ''}{u.lastName[0] ?? ''}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                              {u.firstName} {u.lastName}
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                                (inactive)
                              </span>
                            </div>
                            {u.email && <div className="text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{u.email}</div>}
                          </div>
                        </Link>
                        <button
                          disabled={reactivatingAdminId === u.id}
                          onClick={async () => {
                            setReactivatingAdminId(u.id);
                            try {
                              const res = await fetch(`/api/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) });
                              if (!res.ok) throw new Error();
                              setAdminUsers((prev) => prev.map((a) => a.id === u.id ? { ...a, active: true } : a));
                              toast(`${u.firstName} ${u.lastName} reactivated`, 'success');
                            } catch {
                              toast('Failed to reactivate admin', 'error');
                            } finally {
                              setReactivatingAdminId(null);
                            }
                          }}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber)', border: '1px solid rgba(255,176,32,0.3)' }}
                        >
                          {reactivatingAdminId === u.id ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Top Performers Podium (reps view only) ─────────────────────────── */}
      {roleFilter === 'rep' && !isPM && <TopPerformersPodium entries={podiumDisplay} />}

      {/* ── REP-ONLY RICH UI — the podium below plus this summary bar, rep-type
           filter tabs, search, and rep card grid only render when the role
           filter is explicitly set to 'rep'. The 'all' view above is a simple
           unified list that covers every role at a glance. ── */}
      {roleFilter === 'rep' && (<>
      {/* ── Summary Bar — GradCards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <GradCard
          label="Total Reps"
          // Selling admins are in the reps array for dropdown-picker purposes;
          // exclude them from the Total Reps count — they're counted under Admins.
          rawValue={reps.filter(r => r.active !== false && r.role === 'rep').length}
          formatter={(v) => String(Math.round(v))}
          gradient="linear-gradient(135deg, rgba(77,159,255,0.18), rgba(77,159,255,0.05))"
          borderColor="rgba(77,159,255,0.3)"
          valueColor="var(--accent-blue)"
          delay={0}
        />
        <GradCard
          label="Active Deals"
          rawValue={(() => { let count = 0; for (const p of projects) { if (!PIPELINE_EXCLUDED.has(p.phase)) count++; } return count; })()}
          formatter={(v) => String(Math.round(v))}
          gradient="linear-gradient(135deg, rgba(0,196,240,0.18), rgba(0,196,240,0.05))"
          borderColor="rgba(0,196,240,0.3)"
          valueColor="var(--accent-cyan)"
          delay={80}
        />
        <GradCard
          label="kW Sold"
          rawValue={projects.filter((p) => !PIPELINE_EXCLUDED.has(p.phase)).reduce((s, p) => s + p.kWSize, 0)}
          formatter={formatCompactKW}
          gradient="linear-gradient(135deg, rgba(255,176,32,0.18), rgba(255,176,32,0.05))"
          borderColor="rgba(255,176,32,0.3)"
          valueColor="var(--accent-amber)"
          delay={160}
        />
        {!isPM && (
          <GradCard
            label="Total Paid"
            rawValue={payrollEntries.filter((p) => p.status === 'Paid' && p.date <= today).reduce((s, p) => s + p.amount, 0)}
            formatter={(v) => '$' + Math.round(v).toLocaleString()}
            gradient="linear-gradient(135deg, rgba(0,224,122,0.18), rgba(0,224,122,0.05))"
            borderColor="rgba(0,224,122,0.3)"
            valueColor="var(--accent-green)"
            delay={240}
          />
        )}
      </div>

      {/* ── Role filter tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 rounded-xl p-1 w-fit tab-bar-container" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {filterIndicator && <div className="tab-indicator" style={{ ...filterIndicator, background: 'var(--accent-green)' }} />}
        {FILTER_TABS.map((t, i) => (
          <button
            key={t.value}
            ref={(el) => { filterTabRefs.current[i] = el; }}
            onClick={() => setFilterTab(t.value)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97]`}
            style={{ color: filterTab === t.value ? '#000' : 'var(--text-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-xs mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-dim)' }} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search reps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="w-full rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none transition-all duration-200 focus:ring-2 focus:ring-[var(--accent-green)]/50 focus:border-[var(--accent-green)] placeholder-slate-500"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
        />
        {/* Clear button — shown when there is a search query */}
        {search ? (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-white transition-colors"
            aria-label="Clear search input"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          /* '/' shortcut hint — shown when input is empty and not focused */
          !searchFocused && (
            <kbd
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 px-1.5 rounded border border-[var(--border)] bg-[var(--border)]/60 text-[var(--text-secondary)] font-mono text-[11px] leading-none select-none"
              aria-hidden="true"
            >
              /
            </kbd>
          )
        )}
      </div>
      {debouncedSearch && (
        <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full mb-4 inline-block">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      )}

      {/* ── Compare Reps ──────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="mb-6">
          <button
            onClick={() => { setCompareMode((v) => !v); if (compareMode) setCompareIds(new Set()); }}
            className={`text-sm font-medium px-4 py-2 rounded-xl transition-colors ${compareMode ? 'filter-tab-active' : 'bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-white border border-[var(--border)]'}`}
          >
            {compareMode ? `Comparing (${compareIds.size}/3) — Click to exit` : 'Compare Reps'}
          </button>
          {compareMode && compareIds.size === 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-2">Select 2-3 reps below to compare side by side.</p>
          )}
        </div>
      )}

      {/* ── Sort Controls ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-[var(--text-dim)] font-medium">Sort:</span>
        {([['paid','Top Paid'],['active','Most Active'],['deals','Most Deals'],['kw','Most kW'],['name','Name']] as [SortBy, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => {
              if (sortBy === val) {
                setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
              } else {
                setSortBy(val);
                setSortDir('desc');
              }
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              sortBy === val ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30' : 'bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)] hover:text-white'
            }`}
          >
            {label}
            {sortBy === val && (
              <ChevronDown className={"w-3 h-3 ml-1 inline transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] " + (sortDir === 'asc' ? 'rotate-180' : 'rotate-0')} />
            )}
          </button>
        ))}
      </div>

      {/* ── Comparison Cards ─────────────────────────────────────────────── */}
      {compareMode && compareIds.size >= 2 && (() => {
        const ranges = getCompareDateRanges();
        const isInRange = (dateStr: string | null, from: string, to: string) => {
          if (!from || !to || !dateStr) return false;
          return dateStr >= from && dateStr <= to;
        };
        const compareReps = filtered.filter((r) => compareIds.has(r.id));
        if (compareReps.length < 2) return (
          <div className="card-surface rounded-2xl p-5 mb-6 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <span>Some selected reps are hidden by the current filter. Change the filter or re-select reps to compare.</span>
          </div>
        );
        return (
          <div className="card-surface rounded-2xl p-5 mb-6 animate-slide-in-scale">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-bold text-base">Rep Comparison</h3>
                {ranges.prev && <span className="text-xs text-[var(--text-muted)]">vs {ranges.prev.label}</span>}
              </div>
              <div className="flex flex-wrap gap-1">
                {PERIOD_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setComparePeriod(opt.value)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${comparePeriod === opt.value ? 'filter-tab-active' : 'bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {comparePeriod === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]" />
                  <span className="text-[var(--text-muted)] text-xs">to</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]" />
                </div>
              )}
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${compareReps.length}, 1fr)` }}>
              {compareReps.map((rep) => {
                const rp = ranges.current.from && ranges.current.to
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.current.from, ranges.current.to))
                  : [];
                const dealsClosed = rp.length;
                const kwSold = rp.reduce((s, p) => s + p.kWSize, 0);
                const avgDealSize = dealsClosed > 0 ? kwSold / dealsClosed : 0;
                const commissionEarned = ranges.current.from && ranges.current.to
                  ? payrollEntries.filter((e) => e.repId === rep.id && e.status === 'Paid' && isInRange(e.date, ranges.current.from, ranges.current.to) && e.date <= today).reduce((s, e) => s + e.amount, 0)
                  : 0;
                const rpCancelled = ranges.current.from && ranges.current.to
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase === 'Cancelled' && isInRange(p.soldDate, ranges.current.from, ranges.current.to))
                  : [];
                const cancelRate = (rp.length + rpCancelled.length) > 0 ? (rpCancelled.length / (rp.length + rpCancelled.length) * 100) : 0;

                // Previous period stats
                const prevDeals = ranges.prev
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.prev!.from, ranges.prev!.to)).length
                  : null;
                const deltaDeals = prevDeals !== null ? dealsClosed - prevDeals : null;

                return (
                  <div key={rep.id} className="bg-[var(--surface-card)]/40 rounded-xl p-4 text-center">
                    <div className="flex justify-center mb-2">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 p-[2px]">
                        <div className="w-full h-full rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: 'var(--brand-dark)' }}>
                          {rep.name.split(' ').map((n) => n[0]).join('')}
                        </div>
                      </div>
                    </div>
                    <p className="text-white font-semibold text-sm mb-1">{rep.name}</p>
                    <p className="text-[var(--text-muted)] text-[10px] mb-3">{ranges.current.label}</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[var(--text-secondary)]">Deals Closed</span>
                        <span className="text-white font-semibold flex items-center gap-1">
                          {dealsClosed}
                          {deltaDeals !== null && deltaDeals !== 0 && (
                            <span className={`text-[10px] ${deltaDeals > 0 ? 'text-[var(--accent-green)]' : 'text-red-400'}`}>
                              {deltaDeals > 0 ? '+' : ''}{deltaDeals}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between"><span className="text-[var(--text-secondary)]">kW Sold</span><span className="text-white font-semibold">{formatCompactKW(kwSold)}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Avg Deal Size</span><span className="text-white font-semibold">{avgDealSize.toFixed(1)} kW</span></div>
                      <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Paid Out</span><span className="text-[var(--accent-green)] font-semibold">${commissionEarned.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Cancel Rate</span><span className={`font-semibold ${cancelRate > 20 ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>{cancelRate.toFixed(0)}%</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="space-y-3">
        {sorted.map((rep, i) => {
          const repProjects = projects.filter((p) => p.repId === rep.id || p.setterId === rep.id);
          const repPaid = repPaidAmounts.get(rep.id) ?? 0;
          const activeCount = repProjects.filter(
            (p) => !PIPELINE_EXCLUDED.has(p.phase)
          ).length;
          const totalKW = repProjects.filter((p) => !PIPELINE_EXCLUDED.has(p.phase)).reduce((s, p) => s + p.kWSize, 0);
          const initials = rep.name.split(' ').map((n) => n[0]).join('');
          const rank = rankMap.get(rep.id) ?? 999;

          // ── Progress ring ─────────────────────────────────────────────────
          const completedCount = repProjects.filter((p) => p.phase === 'Completed').length;
          const activeProjectCount = repProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length;
          const completionRate =
            activeProjectCount > 0 ? completedCount / activeProjectCount : 0;
          const dashOffset = REP_RING_CIRCUMFERENCE * (1 - completionRate);

          return (
            <div key={rep.id} className="relative">
              {compareMode && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={compareIds.has(rep.id)}
                    onChange={() => toggleCompareId(rep.id)}
                    disabled={!compareIds.has(rep.id) && compareIds.size >= 3}
                    className="w-4 h-4 accent-[var(--accent-green)] rounded cursor-pointer"
                  />
                </div>
              )}
            <Link href={`/dashboard/users/${rep.id}`}>
              <div
                className={`rep-card relative rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 transition-shadow duration-300 group cursor-pointer md:flex-row md:items-center md:justify-between hover:translate-y-[-2px] hover:shadow-xl active:scale-[0.98] active:shadow-none backdrop-blur-sm animate-slide-in-scale ${compareMode ? 'ml-8' : ''} ${compareIds.has(rep.id) ? 'ring-2 ring-[var(--accent-green)]/40' : ''}`}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${ROLE_BADGE_STYLES[rep.repType]?.color ?? 'var(--border)'}`,
                  // Inline continuous stagger — same pattern as the non-rep
                  // cards grid (40ms per card, soft cap at 600ms). Fixes the
                  // "cards 5+ all pop at once" tail issue the old stagger-N
                  // classes produced with 150 reps in the list.
                  animationDelay: `${Math.min(i * 40, 600)}ms`,
                }}
              >
                <div className="flex items-center gap-4">

                  {/* ── Avatar with conic progress ring ───────────────────── */}
                  <div className="relative flex-shrink-0 w-12 h-12">

                    {/* SVG progress ring — rotated so 0 % starts at the top */}
                    <svg
                      className="absolute inset-0 w-full h-full -rotate-90 rep-ring-glow"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient
                          id={`repRingGrad-${rep.id}`}
                          x1="0%" y1="0%" x2="100%" y2="0%"
                        >
                          <stop offset="0%"   stopColor="var(--accent-cyan)" />
                          <stop offset="100%" stopColor="#60a5fa" />
                        </linearGradient>
                      </defs>

                      {/* Background track */}
                      <circle
                        cx="24" cy="24" r="22"
                        fill="none"
                        stroke="rgba(30,58,95,0.6)"
                        strokeWidth="2.5"
                      />

                      {/* Animated progress arc */}
                      <circle
                        cx="24" cy="24" r="22"
                        fill="none"
                        stroke={`url(#repRingGrad-${rep.id})`}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={REP_RING_CIRCUMFERENCE}
                        style={{ strokeDashoffset: dashOffset }}
                        className="animate-rep-ring-fill"
                      />
                    </svg>

                    {/* Avatar circle — inset so it sits inside the ring */}
                    <div className="absolute inset-[3px] rounded-full p-[2px]" style={{ background: 'linear-gradient(135deg, var(--accent-blue), #b47dff)' }}>
                      <div
                        className="w-full h-full rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: 'var(--surface)' }}
                      >
                        {initials}
                      </div>
                    </div>

                    {/* Rank badge — top-3 only */}
                    {rank <= 3 && (
                      <div
                        className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white z-10 shadow-md bg-gradient-to-br overflow-hidden animate-rank-shimmer ${RANK_GRADIENTS[rank - 1]}`}
                      >
                        #{rank}
                      </div>
                    )}
                  </div>
                  {/* ── /Avatar ───────────────────────────────────────────── */}

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold group-hover:text-[var(--accent-green)] transition-colors">
                        {rep.name}
                      </p>
                      {canManageReps ? (
                        <select
                          value={rep.repType}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onChange={(e) => { e.stopPropagation(); const next = e.target.value as 'closer' | 'setter' | 'both'; if (next !== rep.repType) updateRepType(rep.id, next); }}
                          aria-label={`${rep.name} rep type`}
                          title="Change rep type"
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors cursor-pointer appearance-none ${ROLE_BADGE_CLS[rep.repType]} ${ROLE_BADGE_HOVER[rep.repType]}`}
                          style={ROLE_BADGE_STYLES[rep.repType]}
                        >
                          <option value="closer">{ROLE_LABELS.closer}</option>
                          <option value="setter">{ROLE_LABELS.setter}</option>
                          <option value="both">{ROLE_LABELS.both}</option>
                        </select>
                      ) : (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${ROLE_BADGE_CLS[rep.repType]}`} style={ROLE_BADGE_STYLES[rep.repType]}>
                          {ROLE_LABELS[rep.repType]}
                        </span>
                      )}
                      {/* Active deals badge */}
                      {(activeDealsByRep.get(rep.id) ?? 0) > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20">
                          {activeDealsByRep.get(rep.id)} active
                        </span>
                      )}
                    </div>
                    <p className="text-[var(--text-muted)] text-xs">{rep.email}</p>
                  </div>
                </div>

                {/* ── Stats — hover-reveal with staggered blur-lift ─────────── */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:items-center md:gap-6 xl:gap-10">

                  {/* Deals */}
                  <div
                    className="text-center xl:opacity-100 xl:translate-y-0 md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ transitionDelay: '0ms' }}
                  >
                    <p className="font-semibold">
                      <span className="rounded-lg px-2 py-0.5" style={{ color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif", background: 'rgba(240,242,247,0.05)' }}>{repProjects.length}</span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Total Deals</p>
                  </div>

                  {/* Active */}
                  <div
                    className="text-center xl:opacity-100 xl:translate-y-0 md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ transitionDelay: '75ms' }}
                  >
                    <p className="font-semibold">
                      <span className="rounded-lg px-2 py-0.5" style={{ color: 'var(--accent-cyan)', fontFamily: "'DM Serif Display', serif", background: 'rgba(0,196,240,0.08)' }}>{activeCount}</span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Active</p>
                  </div>

                  {/* kW */}
                  <div
                    className="text-center xl:opacity-100 xl:translate-y-0 md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ transitionDelay: '150ms' }}
                  >
                    <p className="font-semibold">
                      <span className="rounded-lg px-2 py-0.5" style={{ color: 'var(--accent-amber)', fontFamily: "'DM Serif Display', serif", background: 'rgba(255,176,32,0.08)' }}>{formatCompactKW(totalKW)}</span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Total kW</p>
                  </div>

                  {/* Last Deal */}
                  <div
                    className="text-center xl:opacity-100 xl:translate-y-0 md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ transitionDelay: '190ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-[var(--text-secondary)] bg-[var(--text-muted)]/10 rounded-lg px-2 py-0.5 text-xs">
                        {(() => {
                          if (repProjects.length === 0) return 'No deals yet';
                          const withDate = repProjects.filter(p => p.soldDate);
                          if (withDate.length === 0) return 'No deals yet';
                          const latest = withDate.reduce((a, b) => a.soldDate! > b.soldDate! ? a : b);
                          const [y, m, d] = latest.soldDate!.split('-').map(Number);
                          const dt = new Date(y, m - 1, d);
                          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        })()}
                      </span>
                    </p>
                    <p className="text-[var(--text-muted)] text-xs mt-1">Last Deal</p>
                  </div>

                  {/* Paid */}
                  {!isPM && (
                    <div
                      className="text-center xl:opacity-100 xl:translate-y-0 md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ transitionDelay: '225ms' }}
                    >
                      <p className="font-semibold">
                        <span className="rounded-lg px-2 py-0.5" style={{ color: 'var(--accent-green)', fontFamily: "'DM Serif Display', serif", background: 'rgba(0,224,122,0.08)' }}>${repPaid.toLocaleString()}</span>
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Paid Out</p>
                    </div>
                  )}

                  <ChevronRight className="hidden md:block w-4 h-4 text-[var(--text-dim)] group-hover:text-[var(--text-secondary)] transition-colors" />
                  {canManageReps && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction({ title: `Convert ${rep.name} to Sub-Dealer?`, message: `${rep.name} will move to the Sub-Dealers list with sub-dealer login and permission defaults. Deals, payroll history, commission records, and their Clerk login remain unchanged.`, confirmLabel: 'Convert', onConfirm: async () => { setConfirmAction(null); try { await convertUserRole(rep.id, 'sub-dealer'); toast(`${rep.name} converted to Sub-Dealer`, 'success'); } catch { /* error toast shown by persistFetch */ } } }); }}
                      title="Convert to Sub-Dealer"
                      className="hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-dim)] hover:text-[var(--accent-purple)] hover:bg-[rgba(180,125,255,0.12)] transition-colors"
                    >
                      <UserCog className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canManageReps && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction({ title: `Deactivate ${rep.name}?`, message: 'They will lose app access immediately. Their existing deals and commission history are preserved. You can reactivate them later.', onConfirm: async () => { setConfirmAction(null); try { await deactivateRep(rep.id); toast(`${rep.name} deactivated`, 'success'); } catch { /* error toast shown by persistFetch */ } } }); }}
                      title="Deactivate rep"
                      className="hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </Link>
            </div>
          );
        })}

        {filtered.length === 0 && (debouncedSearch || filterTab !== 'all') && (
          <div className="flex justify-center py-4">
            <div className="animate-fade-in w-60 border border-dashed border-[var(--border-subtle)] rounded-2xl px-6 py-8 flex flex-col items-center gap-3 text-center">
              {/* Illustration — magnifying glass with question mark */}
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                {/* Outer lens ring */}
                <circle cx="34" cy="34" r="20" stroke="var(--accent-cyan)" strokeWidth="2.5" fill="none" strokeOpacity="0.6"/>
                {/* Inner lens ring */}
                <circle cx="34" cy="34" r="13" stroke="var(--accent-cyan)" strokeWidth="1.5" fill="none" strokeOpacity="0.3"/>
                {/* Handle */}
                <line x1="49" y1="49" x2="70" y2="70" stroke="var(--accent-cyan)" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"/>
                {/* Question mark stem */}
                <path d="M31 38 Q31 35 34 35 Q37 35 37 32 Q37 29 34 29 Q31 29 31 32" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity="0.7"/>
                {/* Question mark dot */}
                <circle cx="34" cy="40" r="1.2" fill="#94a3b8" fillOpacity="0.7"/>
              </svg>
              <p className="text-[var(--text-secondary)] text-sm font-bold leading-snug">No reps match</p>
              <p className="text-[var(--text-muted)] text-xs leading-relaxed">
                {debouncedSearch
                  ? <>No results for &ldquo;<span className="text-[var(--text-secondary)]">{debouncedSearch}</span>&rdquo;. Try adjusting your query.</>
                  : <>No reps match the selected filter. Try a different role.</>}
              </p>
              <button
                onClick={() => { setSearch(''); setFilterTab('all'); }}
                className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Clear filters
              </button>
            </div>
          </div>
        )}

        {/* ── Inactive reps expander ──────────────────────────────────── */}
        {/* Admins only — non-admins never see deactivated users at all.  */}
        {canManageReps && inactiveReps.length > 0 && (
          <div className="mt-6 pt-6 border-t border-dashed border-[var(--border)]">
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[var(--surface-card)]/60"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-3">
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${showInactive ? 'rotate-90' : ''}`}
                  style={{ color: 'var(--text-dim)' }}
                />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Show inactive ({inactiveReps.length})
                </span>
              </div>
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                Deactivated reps — click to {showInactive ? 'hide' : 'view'}
              </span>
            </button>
            {showInactive && (
              <div className="mt-3 space-y-2">
                {inactiveReps.map((rep) => (
                  <div
                    key={rep.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.7 }}
                  >
                    <Link
                      href={`/dashboard/users/${rep.id}`}
                      className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-100"
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                      >
                        {rep.firstName[0] ?? ''}{rep.lastName[0] ?? ''}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                          {rep.name}
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                            (inactive)
                          </span>
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                          {ROLE_LABELS[rep.repType]}
                        </div>
                      </div>
                    </Link>
                    <button
                      disabled={reactivatingId === rep.id}
                      onClick={async () => {
                        setReactivatingId(rep.id);
                        try {
                          await reactivateRep(rep.id);
                          toast(`${rep.name} reactivated`, 'success');
                        } catch {
                          toast('Failed to reactivate rep', 'error');
                        } finally {
                          setReactivatingId(null);
                        }
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'rgba(0,224,122,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,224,122,0.3)' }}
                    >
                      {reactivatingId === rep.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </>)}
      {/* ── Add Rep Modal ────────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) resetAddModal(); }}
          role="dialog"
          aria-modal="true"
        >
          <div ref={addRepPanelRef} className="card-surface shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-lg">Add New User</h3>
              <button onClick={resetAddModal} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Account role selector */}
            <div className="mb-4">
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Account type</label>
              <div className="grid grid-cols-2 gap-2">
                {(['rep', 'sub-dealer', 'project_manager', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setNewUserRole(r)}
                    className={`py-2 rounded-xl text-xs font-semibold transition-all border ${
                      newUserRole === r
                        ? 'border-[var(--accent-green)] text-[var(--accent-green)] bg-[var(--accent-green)]/10'
                        : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-card)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {ROLE_LABELS_BY_ROLE[r]}
                  </button>
                ))}
              </div>
              {(newUserRole === 'admin' || newUserRole === 'project_manager') && (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  {ROLE_LABELS_BY_ROLE[newUserRole]} accounts are always invited by email — no dormant creation.
                </p>
              )}
            </div>

            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>First Name</label>
                <input
                  type="text"
                  placeholder="First name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50 focus:border-[var(--accent-green)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Last Name</label>
                <input
                  type="text"
                  placeholder="Last name"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50 focus:border-[var(--accent-green)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* Email */}
            <div className="mb-3">
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Email</label>
              <input
                type="email"
                placeholder="rep@kiloenergy.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50 focus:border-[var(--accent-green)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>

            {/* Phone */}
            <div className="mb-4">
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Phone</label>
              <input
                type="tel"
                placeholder="(555) 000-0000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50 focus:border-[var(--accent-green)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>

            {/* Rep-specific fields — only shown when role === 'rep' */}
            {newUserRole === 'rep' && (
              <>
                {/* Closer/Setter/Both selector */}
                <div className="mb-4">
                  <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Rep type</label>
                  <div className="flex gap-2">
                    {(['closer', 'setter', 'both'] as const).map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setNewRepType(rt)}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                          newRepType === rt
                            ? `${ROLE_BADGE_CLS[rt]} bg-opacity-100`
                            : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-card)] hover:border-[var(--border)] hover:text-[var(--text-secondary)]'
                        }`}
                        style={newRepType === rt ? ROLE_BADGE_STYLES[rt] : undefined}
                      >
                        {ROLE_LABELS[rt]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Trainer Assignment */}
                <div className="mb-4">
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Trainer (optional)</label>
                  <RepSelector
                    value={newTrainerId}
                    onChange={setNewTrainerId}
                    // Trainer rule: keep historical, block new. Deactivated
                    // trainers cannot be assigned to new trainees, so they
                    // are filtered out of this picker.
                    reps={reps.filter((r) => r.active !== false)}
                    placeholder="-- Select trainer --"
                    clearLabel="None"
                  />
                </div>
              </>
            )}

            {/* Send Clerk invitation toggle */}
            <div className="mb-5">
              <label className={`flex items-center gap-3 select-none ${(newUserRole === 'admin' || newUserRole === 'project_manager') ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={sendInvite || newUserRole === 'admin' || newUserRole === 'project_manager'}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  disabled={newUserRole === 'admin' || newUserRole === 'project_manager'}
                  className="w-4 h-4 rounded border-[var(--border-subtle)] accent-[var(--accent-green)] cursor-pointer disabled:cursor-not-allowed"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Send invitation email</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {(newUserRole === 'admin' || newUserRole === 'project_manager')
                      ? 'Required for this role — admin and project manager accounts must receive an invite to access the app.'
                      : 'Emails the rep a sign-up link. Leave off to add them without giving app access yet.'}
                  </div>
                </div>
              </label>
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <button
                onClick={resetAddModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors hover:brightness-125"
                style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRep}
                disabled={!newFirstName.trim() || !newLastName.trim() || isAddingRep}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#050d18' }}
              >
                {isAddingRep ? 'Adding…' : (sendInvite || newUserRole === 'admin' || newUserRole === 'project_manager') ? `Send ${ROLE_LABELS_BY_ROLE[newUserRole]} Invite` : `Add ${ROLE_LABELS_BY_ROLE[newUserRole]}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel={confirmAction?.confirmLabel ?? 'Remove'}
        danger
      />
    </div>
  );
}

