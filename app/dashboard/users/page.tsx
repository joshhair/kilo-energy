'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useIsHydrated, useFocusTrap, useMediaQuery } from '../../../lib/hooks';
import MobileReps from '../mobile/MobileReps';
import { useApp } from '../../../lib/context';
import { Search, ChevronRight, Users, Plus, Trash2, Trophy, Award, X, Mail, Clock } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { RepSelector } from '../components/RepSelector';
import { useToast } from '../../../lib/toast';

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
  closer: { background: 'rgba(77,159,255,0.1)', color: '#4d9fff', borderColor: 'rgba(77,159,255,0.25)' },
  setter: { background: 'rgba(180,125,255,0.1)', color: '#b47dff', borderColor: 'rgba(180,125,255,0.25)' },
  both:   { background: 'rgba(0,196,240,0.1)', color: '#00c4f0', borderColor: 'rgba(0,196,240,0.25)' },
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

// Breathing box-shadow pulse class for each podium rank
const PODIUM_BREATH_CLS: Record<number, string> = {
  1: 'animate-podium-breath-gold',
  2: 'animate-podium-breath-silver',
  3: 'animate-podium-breath-bronze',
};

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
  const { currentRole, effectiveRole, projects, payrollEntries, reps, subDealers, addRep, addSubDealer, deactivateRep, reactivateRep, updateRepType, trainerAssignments, setTrainerAssignments } = useApp();
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
  const [extraUsersReady, setExtraUsersReady] = useState(currentRole !== 'admin');
  useEffect(() => {
    if (currentRole !== 'admin') return;
    // Promise.all collapses both responses into a single state update, so
    // the grid renders once with everyone present instead of twice.
    Promise.all([
      fetch('/api/reps?role=admin').then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/reps?role=project_manager').then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([adminsData, pmsData]: [
      Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string }>,
      Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string }>,
    ]) => {
      setAdminUsers(adminsData.map((u) => ({ ...u, role: 'admin' })));
      setPmUsers(pmsData.map((u) => ({ ...u, role: 'project_manager' })));
      setExtraUsersReady(true);
    });
  }, [currentRole]);

  const initialFilter = (searchParams.get('filter') ?? 'all') as FilterTab;
  const [filterTab, setFilterTabState] = useState<FilterTab>(FILTER_TABS.some(t => t.value === initialFilter) ? initialFilter : 'all');
  const setFilterTab = (v: FilterTab) => {
    setFilterTabState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v !== 'all') params.set('filter', v); else params.delete('filter');
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const isHydrated = useIsHydrated();
  const isAdmin = currentRole === 'admin';
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
    if (currentRole !== 'admin') return;
    try {
      const res = await fetch('/api/users/invitations');
      if (!res.ok) return;
      const data = await res.json();
      setPendingInvitations(data.invitations ?? []);
    } catch {
      // Silent fail — pending invites is a nice-to-have, not critical
    }
  }, [currentRole]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const ts = Date.now();
    const repId = `rep_${ts}`;
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
            repType: isRepRole ? newRepType : 'both',
          }),
        })
          .then(async (r) => {
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              throw new Error(body.error ?? 'Failed to send invitation');
            }
            const json = await r.json();
            return { id: json.user.id as string };
          })
      : newUserRole === 'sub-dealer'
        ? (addSubDealer(newFirstName, newLastName, newEmail, newPhone, repId), Promise.resolve({ id: repId }))
        : (addRep(newFirstName, newLastName, newEmail, newPhone, newRepType, repId) as Promise<{ id: string } | null>);

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
  }, [filterTab]);

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

  // ── Sort ────────────────────────────────────────────────────────────────
  type SortBy = 'paid' | 'active' | 'deals' | 'name' | 'kw';
  const [sortBy, setSortBy] = useState<SortBy>('paid');

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

    const fmt = (dt: Date) => dt.toISOString().split('T')[0];
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

  const filtered = reps.filter((r) => {
    // Hide deactivated reps from the main list — they live in the "Show
    // inactive" expander below so admins can find and reactivate them
    // without polluting the active roster.
    if (r.active === false) return false;
    // Search filter
    if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    // Role filter
    if (filterTab === 'all') return true;
    if (filterTab === 'both') return r.repType === 'both';
    // 'closer' tab shows closer + both; 'setter' tab shows setter + both
    return r.repType === filterTab || r.repType === 'both';
  });

  // Inactive reps live below the main list in a collapsible expander.
  // Same search filter applies, but the role filter does NOT — admins
  // searching for a fired employee shouldn't have to remember which type
  // they were.
  const inactiveReps = reps.filter((r) => {
    if (r.active !== false) return false;
    if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });

  // ── Pre-compute paid totals & rank order across ALL reps ──────────────────
  const repPaidAmounts = new Map(
    reps.map((rep) => [
      rep.id,
      payrollEntries
        .filter((p) => p.repId === rep.id && p.status === 'Paid')
        .reduce((s, p) => s + p.amount, 0),
    ])
  );

  const rankMap = new Map(
    [...reps]
      .sort((a, b) => (repPaidAmounts.get(b.id) ?? 0) - (repPaidAmounts.get(a.id) ?? 0))
      .map((rep, idx) => [rep.id, idx + 1])
  );

  // ── Top 3 performers for podium section ─────────────────────────────────
  const topPerformers = [...reps]
    .filter((r) => r.active !== false)
    .map((rep) => ({ rep, paid: repPaidAmounts.get(rep.id) ?? 0 }))
    .filter(({ paid }) => paid > 0)
    .sort((a, b) => b.paid - a.paid)
    .slice(0, 3);

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
      case 'paid':   return arr.sort((a, b) => (repPaidAmounts.get(b.id) ?? 0) - (repPaidAmounts.get(a.id) ?? 0));
      case 'active': return arr.sort((a, b) => (activeDealsByRep.get(b.id) ?? 0) - (activeDealsByRep.get(a.id) ?? 0));
      case 'deals':  return arr.sort((a, b) => projects.filter(p => p.repId === b.id || p.setterId === b.id).length - projects.filter(p => p.repId === a.id || p.setterId === a.id).length);
      case 'kw':     return arr.sort((a, b) => projects.filter(p => p.repId === b.id || p.setterId === b.id).reduce((s, p) => s + p.kWSize, 0) - projects.filter(p => p.repId === a.id || p.setterId === a.id).reduce((s, p) => s + p.kWSize, 0));
      case 'name':   return arr.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [filtered, sortBy, repPaidAmounts, activeDealsByRep, projects]);

  const isMobile = useMediaQuery('(max-width: 767px)');

  if (!isHydrated) {
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
              <Users className="w-5 h-5 text-[#00e07a]" />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>Users</h1>
          </div>
        </div>
        <p className="text-[#c2c8d8] text-sm font-medium ml-12 tracking-wide">Reps, sub-dealers, project managers, and admins</p>
      </div>

      {/* Admin: add rep button */}
      {canManageReps && (
        <div className="mb-6">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition-all hover:brightness-110 active:scale-[0.97]"
            style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000' }}
          >
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>
      )}

      {/* Admin: pending invitations panel (only shown when there are any) */}
      {canManageReps && currentRole === 'admin' && pendingInvitations.length > 0 && (
        <div className="card-surface rounded-2xl p-5 mb-6" style={{ background: '#1d2028', border: '1px solid #333849' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(255,176,32,0.15)' }}>
              <Mail className="w-4 h-4 text-amber-400" />
            </div>
            <h2 className="text-white font-bold text-base tracking-tight">Pending Invitations</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/10 text-amber-400 border border-amber-400/20">
              {pendingInvitations.length}
            </span>
          </div>
          <p className="text-xs mb-4" style={{ color: '#8891a8' }}>
            These users have been invited but haven&apos;t completed sign-up yet.
          </p>
          <div className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
                style={{ background: '#0f1117', border: '1px solid #272b35' }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Clock className="w-4 h-4 text-amber-400/60 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-medium truncate">{inv.emailAddress}</p>
                    <p className="text-[11px]" style={{ color: '#525c72' }}>
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
      <div className="mb-6 flex flex-wrap gap-2">
        {ROLE_FILTERS.map((rf) => {
          const active = roleFilter === rf.value;
          return (
            <button
              key={rf.value}
              onClick={() => setRoleFilter(rf.value)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
                active
                  ? 'border-[#00e07a] text-[#00e07a] bg-[#00e07a]/10'
                  : 'border-[#272b35] text-[#8891a8] bg-[#1d2028] hover:text-[#c2c8d8]'
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
                ...reps.filter((r) => r.active !== false).map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, role: 'rep', repType: r.repType })),
                ...subDealers.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, role: 'sub-dealer' })),
                ...pmUsers,
                ...adminUsers,
              ]
            : roleFilter === 'sub-dealer'
            ? subDealers.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, role: 'sub-dealer' }))
            : roleFilter === 'project_manager'
            ? pmUsers
            : adminUsers;

        const q = debouncedSearch.trim().toLowerCase();
        const filtered = q
          ? pool.filter((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
          : pool;

        const roleBadge: Record<string, { label: string; color: string; bg: string }> = {
          rep:              { label: 'Rep',              color: '#00e07a', bg: 'rgba(0,224,122,0.12)' },
          'sub-dealer':     { label: 'Sub-Dealer',       color: '#b47dff', bg: 'rgba(180,125,255,0.12)' },
          project_manager:  { label: 'Project Manager',  color: '#00c4f0', bg: 'rgba(0,196,240,0.12)' },
          admin:            { label: 'Admin',            color: '#ffb020', bg: 'rgba(255,176,32,0.12)' },
        };

        return (
          <div>
            {/* Search bar */}
            <div className="relative mb-4 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#525c72] pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${roleFilter === 'all' ? 'all users' : roleBadge[roleFilter]?.label.toLowerCase() + 's'}…`}
                className="w-full bg-[#1d2028] border border-[#272b35] text-white rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50 placeholder-[#525c72]"
              />
            </div>

            <div className="mb-3 text-xs" style={{ color: '#8891a8' }}>
              {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
            </div>

            {filtered.length === 0 ? (
              <div className="card-surface rounded-2xl p-8 text-center" style={{ background: '#1d2028', border: '1px solid #272b35' }}>
                <p className="text-sm" style={{ color: '#8891a8' }}>
                  {q ? 'No users match your search.' : 'No users in this category yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filtered.map((u, i) => {
                  const badge = roleBadge[u.role] ?? { label: u.role, color: '#8891a8', bg: 'rgba(136,145,168,0.12)' };
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
                        background: '#161920',
                        border: '1px solid #272b35',
                        borderLeft: `3px solid ${badge.color}`,
                        ...(shouldAnimate ? { animationDelay: `${delayMs}ms` } : {}),
                      }}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: badge.bg, color: badge.color }}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{u.firstName} {u.lastName}</p>
                        {u.email && <p className="text-xs truncate" style={{ color: '#8891a8' }}>{u.email}</p>}
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Top Performers Podium (reps view only) ─────────────────────────── */}
      {roleFilter === 'rep' && podiumDisplay.length === 3 && !isPM && (
        <div className="card-surface rounded-2xl p-5 mb-8 animate-slide-in-scale" style={{ animationDelay: 'var(--podium-delay, 300ms)' }}>
          {/* Section header */}
          <div className="h-[3px] w-10 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 mb-3" />
          <div className="flex items-center gap-2 mb-5">
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(234,179,8,0.15)' }}>
              <Trophy className="w-4 h-4 text-yellow-400" />
            </div>
            <h2 className="text-white font-bold text-base tracking-tight">Top Performers</h2>
          </div>

          {/* Podium cards */}
          <div className="flex items-end justify-center gap-3">
            {podiumDisplay.map(({ rep, paid, rank, order }) => {
              const isFirst = rank === 1;
              const gradient = RANK_GRADIENTS[rank - 1];
              const initials = rep.name.split(' ').map((n) => n[0]).join('');
              return (
                <div
                  key={rep.id}
                  className={`relative flex flex-col items-center gap-2 card-surface rounded-2xl p-4 flex-1 max-w-[160px] overflow-hidden animate-slide-in-scale stagger-${order} ${PODIUM_BREATH_CLS[rank]}${isFirst ? ' scale-105' : ''}`}
                  style={{ order }}
                >
                  {/* Gradient top border */}
                  <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${gradient}${isFirst ? ' animate-podium-glow' : ''}`} />

                  {/* Award icon for #1 */}
                  {isFirst && <Award className="w-4 h-4 text-yellow-400" />}

                  {/* Initials circle with gradient border */}
                  <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} p-[2px] flex-shrink-0`}>
                    <div
                      className="w-full h-full rounded-full flex items-center justify-center text-white font-bold text-lg"
                      style={{ backgroundColor: 'var(--navy-card)' }}
                    >
                      {initials}
                    </div>
                  </div>

                  {/* Rank badge */}
                  <div className={`text-[10px] font-black text-white px-2 py-0.5 rounded-full bg-gradient-to-br ${gradient}`}>
                    #{rank}
                  </div>

                  {/* Name */}
                  <p className="font-bold text-white text-sm text-center leading-tight">{rep.name}</p>

                  {/* Paid amount */}
                  <p className="text-gradient-brand font-black text-sm">${paid.toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── REP-ONLY RICH UI — the podium below plus this summary bar, rep-type
           filter tabs, search, and rep card grid only render when the role
           filter is explicitly set to 'rep'. The 'all' view above is a simple
           unified list that covers every role at a glance. ── */}
      {roleFilter === 'rep' && (<>
      {/* ── Summary Bar — GradCards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Reps', value: reps.filter(r => r.active !== false).length.toString(), gradient: 'linear-gradient(135deg, rgba(77,159,255,0.18), rgba(77,159,255,0.05))', borderColor: 'rgba(77,159,255,0.3)', valueColor: '#4d9fff' },
          { label: 'Active Deals', value: (() => { let count = 0; for (const p of projects) { if (!PIPELINE_EXCLUDED.has(p.phase)) count++; } return count; })().toString(), gradient: 'linear-gradient(135deg, rgba(0,196,240,0.18), rgba(0,196,240,0.05))', borderColor: 'rgba(0,196,240,0.3)', valueColor: '#00c4f0' },
          { label: 'kW Sold', value: `${projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0).toFixed(1)}`, gradient: 'linear-gradient(135deg, rgba(255,176,32,0.18), rgba(255,176,32,0.05))', borderColor: 'rgba(255,176,32,0.3)', valueColor: '#ffb020' },
          ...(!isPM ? [{ label: 'Total Paid', value: `$${payrollEntries.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0).toLocaleString()}`, gradient: 'linear-gradient(135deg, rgba(0,224,122,0.18), rgba(0,224,122,0.05))', borderColor: 'rgba(0,224,122,0.3)', valueColor: '#00e07a' }] : []),
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: stat.gradient, border: `1px solid ${stat.borderColor}` }}>
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>{stat.label}</span>
            <span className="text-2xl font-bold" style={{ fontFamily: "'DM Serif Display', serif", color: stat.valueColor, textShadow: `0 0 20px ${stat.valueColor}50` }}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Role filter tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 rounded-xl p-1 w-fit tab-bar-container" style={{ background: '#161920', border: '1px solid #272b35' }}>
        {filterIndicator && <div className="tab-indicator" style={{ ...filterIndicator, background: '#00e07a' }} />}
        {FILTER_TABS.map((t, i) => (
          <button
            key={t.value}
            ref={(el) => { filterTabRefs.current[i] = el; }}
            onClick={() => setFilterTab(t.value)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97]`}
            style={{ color: filterTab === t.value ? '#000' : '#8891a8' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-xs mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#525c72' }} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search reps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="w-full rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none transition-all duration-200 focus:ring-2 focus:ring-[#00e07a]/50 focus:border-[#00e07a] placeholder-slate-500"
          style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
        />
        {/* Clear button — shown when there is a search query */}
        {search ? (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#c2c8d8] hover:text-white transition-colors"
            aria-label="Clear search input"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          /* '/' shortcut hint — shown when input is empty and not focused */
          !searchFocused && (
            <kbd
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 px-1.5 rounded border border-[#272b35] bg-[#272b35]/60 text-[#c2c8d8] font-mono text-[11px] leading-none select-none"
              aria-hidden="true"
            >
              /
            </kbd>
          )
        )}
      </div>
      {debouncedSearch && (
        <span className="text-xs text-[#8891a8] bg-[#1d2028] px-2 py-0.5 rounded-full mb-4 inline-block">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      )}

      {/* ── Compare Reps ──────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="mb-6">
          <button
            onClick={() => { setCompareMode((v) => !v); if (compareMode) setCompareIds(new Set()); }}
            className={`text-sm font-medium px-4 py-2 rounded-xl transition-colors ${compareMode ? 'bg-[#00e07a] text-black' : 'bg-[#1d2028] text-[#c2c8d8] hover:text-white border border-[#272b35]'}`}
          >
            {compareMode ? `Comparing (${compareIds.size}/3) — Click to exit` : 'Compare Reps'}
          </button>
          {compareMode && compareIds.size === 0 && (
            <p className="text-xs text-[#8891a8] mt-2">Select 2-3 reps below to compare side by side.</p>
          )}
        </div>
      )}

      {/* ── Sort Controls ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-[#525c72] font-medium">Sort:</span>
        {([['paid','Top Paid'],['active','Most Active'],['deals','Most Deals'],['kw','Most kW'],['name','Name']] as [SortBy, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setSortBy(val)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              sortBy === val ? 'bg-[#00e07a]/15 text-[#00e07a] border border-[#00e07a]/30' : 'bg-[#161920] text-[#8891a8] border border-[#272b35] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Comparison Cards ─────────────────────────────────────────────── */}
      {compareMode && compareIds.size >= 2 && (() => {
        const ranges = getCompareDateRanges();
        const isInRange = (dateStr: string, from: string, to: string) => {
          if (!from || !to) return false;
          return dateStr >= from && dateStr <= to;
        };
        const compareReps = reps.filter((r) => compareIds.has(r.id));
        return (
          <div className="card-surface rounded-2xl p-5 mb-6 animate-slide-in-scale">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-bold text-base">Rep Comparison</h3>
                {ranges.prev && <span className="text-xs text-[#8891a8]">vs {ranges.prev.label}</span>}
              </div>
              <div className="flex flex-wrap gap-1">
                {PERIOD_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => setComparePeriod(opt.value)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${comparePeriod === opt.value ? 'bg-[#00e07a] text-black' : 'bg-[#1d2028] text-[#c2c8d8] hover:text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {comparePeriod === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="bg-[#1d2028] border border-[#272b35] rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]" />
                  <span className="text-[#8891a8] text-xs">to</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="bg-[#1d2028] border border-[#272b35] rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]" />
                </div>
              )}
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${compareReps.length}, 1fr)` }}>
              {compareReps.map((rep) => {
                const rp = ranges.current.from && ranges.current.to
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.current.from, ranges.current.to))
                  : [];
                const rpAll = projects.filter((p) => p.repId === rep.id || p.setterId === rep.id);
                const dealsClosed = rp.length;
                const kwSold = rp.reduce((s, p) => s + p.kWSize, 0);
                const avgDealSize = dealsClosed > 0 ? kwSold / dealsClosed : 0;
                const commissionEarned = ranges.current.from && ranges.current.to
                  ? payrollEntries.filter((e) => e.repId === rep.id && e.status === 'Paid' && isInRange(e.date, ranges.current.from, ranges.current.to)).reduce((s, e) => s + e.amount, 0)
                  : 0;
                const rpForCancel = ranges.current.from && ranges.current.to
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.current.from, ranges.current.to))
                  : [];
                const cancelRate = rpForCancel.length > 0 ? (rpForCancel.filter((p) => p.phase === 'Cancelled').length / rpForCancel.length * 100) : 0;

                // Previous period stats
                const prevDeals = ranges.prev
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.prev!.from, ranges.prev!.to)).length
                  : null;
                const deltaDeals = prevDeals !== null ? dealsClosed - prevDeals : null;

                return (
                  <div key={rep.id} className="bg-[#1d2028]/40 rounded-xl p-4 text-center">
                    <div className="flex justify-center mb-2">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 p-[2px]">
                        <div className="w-full h-full rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: 'var(--brand-dark)' }}>
                          {rep.name.split(' ').map((n) => n[0]).join('')}
                        </div>
                      </div>
                    </div>
                    <p className="text-white font-semibold text-sm mb-1">{rep.name}</p>
                    <p className="text-[#8891a8] text-[10px] mb-3">{ranges.current.label}</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[#c2c8d8]">Deals Closed</span>
                        <span className="text-white font-semibold flex items-center gap-1">
                          {dealsClosed}
                          {deltaDeals !== null && deltaDeals !== 0 && (
                            <span className={`text-[10px] ${deltaDeals > 0 ? 'text-[#00e07a]' : 'text-red-400'}`}>
                              {deltaDeals > 0 ? '+' : ''}{deltaDeals}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between"><span className="text-[#c2c8d8]">kW Sold</span><span className="text-white font-semibold">{kwSold.toFixed(1)}</span></div>
                      <div className="flex justify-between"><span className="text-[#c2c8d8]">Avg Deal Size</span><span className="text-white font-semibold">{avgDealSize.toFixed(1)} kW</span></div>
                      <div className="flex justify-between"><span className="text-[#c2c8d8]">Earned</span><span className="text-[#00e07a] font-semibold">${commissionEarned.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-[#c2c8d8]">Cancel Rate</span><span className={`font-semibold ${cancelRate > 20 ? 'text-red-400' : 'text-[#c2c8d8]'}`}>{cancelRate.toFixed(0)}%</span></div>
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
          const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
          const initials = rep.name.split(' ').map((n) => n[0]).join('');
          const rank = rankMap.get(rep.id) ?? 999;

          // ── Progress ring ─────────────────────────────────────────────────
          const completedCount = repProjects.filter((p) => p.phase === 'Completed').length;
          const completionRate =
            repProjects.length > 0 ? completedCount / repProjects.length : 0;
          const dashOffset = REP_RING_CIRCUMFERENCE * (1 - completionRate);

          return (
            <div key={rep.id} className="relative">
              {compareMode && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
                  <input
                    type="checkbox"
                    checked={compareIds.has(rep.id)}
                    onChange={() => toggleCompareId(rep.id)}
                    disabled={!compareIds.has(rep.id) && compareIds.size >= 3}
                    className="w-4 h-4 accent-[#00e07a] rounded cursor-pointer"
                  />
                </div>
              )}
            <Link href={`/dashboard/users/${rep.id}`}>
              <div className={`rep-card relative rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 transition-shadow duration-300 group cursor-pointer md:flex-row md:items-center md:justify-between hover:translate-y-[-2px] hover:shadow-xl active:scale-[0.98] active:shadow-none backdrop-blur-sm animate-slide-in-scale stagger-${Math.min(i + 1, 6)} ${compareMode ? 'ml-8' : ''} ${compareIds.has(rep.id) ? 'ring-2 ring-[#00e07a]/40' : ''}`} style={{ background: '#161920', border: '1px solid #272b35', borderLeft: `3px solid ${ROLE_BADGE_STYLES[rep.repType]?.color ?? '#272b35'}` }}>
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
                          <stop offset="0%"   stopColor="#00c4f0" />
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
                    <div className="absolute inset-[3px] rounded-full p-[2px]" style={{ background: 'linear-gradient(135deg, #4d9fff, #b47dff)' }}>
                      <div
                        className="w-full h-full rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: '#161920' }}
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
                      <p className="text-white font-semibold group-hover:text-[#00e07a] transition-colors">
                        {rep.name}
                      </p>
                      {canManageReps ? (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); const nextRole = ROLE_NEXT[rep.repType]; updateRepType(rep.id, nextRole); }}
                          title="Click to cycle role"
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors cursor-pointer ${ROLE_BADGE_CLS[rep.repType]} ${ROLE_BADGE_HOVER[rep.repType]}`}
                          style={ROLE_BADGE_STYLES[rep.repType]}
                        >
                          {ROLE_LABELS[rep.repType]}
                        </button>
                      ) : (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${ROLE_BADGE_CLS[rep.repType]}`} style={ROLE_BADGE_STYLES[rep.repType]}>
                          {ROLE_LABELS[rep.repType]}
                        </span>
                      )}
                      {/* Active deals badge */}
                      {(activeDealsByRep.get(rep.id) ?? 0) > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#00e07a]/10 text-[#00e07a] border border-[#00e07a]/20">
                          {activeDealsByRep.get(rep.id)} active
                        </span>
                      )}
                    </div>
                    <p className="text-[#8891a8] text-xs">{rep.email}</p>
                  </div>
                </div>

                {/* ── Stats — hover-reveal with staggered blur-lift ─────────── */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:items-center md:gap-8">

                  {/* Deals */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '0ms' }}
                  >
                    <p className="font-semibold">
                      <span className="rounded-lg px-2 py-0.5" style={{ color: '#f0f2f7', fontFamily: "'DM Serif Display', serif", background: 'rgba(240,242,247,0.05)' }}>{repProjects.length}</span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#525c72' }}>Total Deals</p>
                  </div>

                  {/* Active */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '75ms' }}
                  >
                    <p className="font-semibold">
                      <span className="rounded-lg px-2 py-0.5" style={{ color: '#00c4f0', fontFamily: "'DM Serif Display', serif", background: 'rgba(0,196,240,0.08)' }}>{activeCount}</span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#525c72' }}>Active</p>
                  </div>

                  {/* kW */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '150ms' }}
                  >
                    <p className="font-semibold">
                      <span className="rounded-lg px-2 py-0.5" style={{ color: '#ffb020', fontFamily: "'DM Serif Display', serif", background: 'rgba(255,176,32,0.08)' }}>{totalKW.toFixed(1)}</span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#525c72' }}>Total kW</p>
                  </div>

                  {/* Last Deal */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '190ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-[#c2c8d8] bg-[#8891a8]/10 rounded-lg px-2 py-0.5 text-xs">
                        {(() => {
                          if (repProjects.length === 0) return 'No deals yet';
                          const latest = repProjects.reduce((a, b) => a.soldDate > b.soldDate ? a : b);
                          const [y, m, d] = latest.soldDate.split('-').map(Number);
                          const dt = new Date(y, m - 1, d);
                          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        })()}
                      </span>
                    </p>
                    <p className="text-[#8891a8] text-xs mt-1">Last Deal</p>
                  </div>

                  {/* Paid */}
                  {!isPM && (
                    <div
                      className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                      style={{ transitionDelay: '225ms' }}
                    >
                      <p className="font-semibold">
                        <span className="rounded-lg px-2 py-0.5" style={{ color: '#00e07a', fontFamily: "'DM Serif Display', serif", background: 'rgba(0,224,122,0.08)' }}>${repPaid.toLocaleString()}</span>
                      </p>
                      <p className="text-xs mt-1" style={{ color: '#525c72' }}>Paid Out</p>
                    </div>
                  )}

                  <ChevronRight className="hidden md:block w-4 h-4 text-[#525c72] group-hover:text-[#c2c8d8] transition-colors" />
                  {canManageReps && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction({ title: `Deactivate ${rep.name}?`, message: 'They will lose app access immediately. Their existing deals and commission history are preserved. You can reactivate them later.', onConfirm: async () => { await deactivateRep(rep.id); toast(`${rep.name} deactivated`, 'success'); setConfirmAction(null); } }); }}
                      title="Deactivate rep"
                      className="hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-[#525c72] hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
            <div className="animate-fade-in w-60 border border-dashed border-[#333849] rounded-2xl px-6 py-8 flex flex-col items-center gap-3 text-center">
              {/* Illustration — magnifying glass with question mark */}
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                {/* Outer lens ring */}
                <circle cx="34" cy="34" r="20" stroke="#00c4f0" strokeWidth="2.5" fill="none" strokeOpacity="0.6"/>
                {/* Inner lens ring */}
                <circle cx="34" cy="34" r="13" stroke="#00c4f0" strokeWidth="1.5" fill="none" strokeOpacity="0.3"/>
                {/* Handle */}
                <line x1="49" y1="49" x2="70" y2="70" stroke="#00c4f0" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"/>
                {/* Question mark stem */}
                <path d="M31 38 Q31 35 34 35 Q37 35 37 32 Q37 29 34 29 Q31 29 31 32" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity="0.7"/>
                {/* Question mark dot */}
                <circle cx="34" cy="40" r="1.2" fill="#94a3b8" fillOpacity="0.7"/>
              </svg>
              <p className="text-[#c2c8d8] text-sm font-bold leading-snug">No reps match</p>
              <p className="text-[#8891a8] text-xs leading-relaxed">
                {debouncedSearch
                  ? <>No results for &ldquo;<span className="text-[#c2c8d8]">{debouncedSearch}</span>&rdquo;. Try adjusting your query.</>
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
          <div className="mt-6 pt-6 border-t border-dashed border-[#272b35]">
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className="w-full flex items-center justify-between text-left px-4 py-3 rounded-xl transition-colors hover:bg-[#1d2028]/60"
              style={{ background: '#161920', border: '1px solid #272b35' }}
            >
              <div className="flex items-center gap-3">
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${showInactive ? 'rotate-90' : ''}`}
                  style={{ color: '#525c72' }}
                />
                <span className="text-sm font-semibold" style={{ color: '#c2c8d8' }}>
                  Show inactive ({inactiveReps.length})
                </span>
              </div>
              <span className="text-[11px]" style={{ color: '#525c72' }}>
                Deactivated reps — click to {showInactive ? 'hide' : 'view'}
              </span>
            </button>
            {showInactive && (
              <div className="mt-3 space-y-2">
                {inactiveReps.map((rep) => (
                  <div
                    key={rep.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                    style={{ background: '#161920', border: '1px solid #272b35', opacity: 0.7 }}
                  >
                    <Link
                      href={`/dashboard/users/${rep.id}`}
                      className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-100"
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: '#272b35', color: '#8891a8' }}
                      >
                        {rep.firstName[0]}{rep.lastName[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: '#c2c8d8' }}>
                          {rep.name}
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#525c72' }}>
                            (inactive)
                          </span>
                        </div>
                        <div className="text-[11px]" style={{ color: '#525c72' }}>
                          {ROLE_LABELS[rep.repType]}
                        </div>
                      </div>
                    </Link>
                    <button
                      onClick={async () => {
                        await reactivateRep(rep.id);
                        toast(`${rep.name} reactivated`, 'success');
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
                      style={{ background: 'rgba(0,224,122,0.12)', color: '#00e07a', border: '1px solid rgba(0,224,122,0.3)' }}
                    >
                      Reactivate
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
          <div ref={addRepPanelRef} className="card-surface shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#1d2028', border: '1px solid #333849' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-lg">Add New User</h3>
              <button onClick={resetAddModal} className="text-[#8891a8] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Account role selector */}
            <div className="mb-4">
              <label className="text-xs font-medium mb-2 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>Account type</label>
              <div className="grid grid-cols-2 gap-2">
                {(['rep', 'sub-dealer', 'project_manager', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setNewUserRole(r)}
                    className={`py-2 rounded-xl text-xs font-semibold transition-all border ${
                      newUserRole === r
                        ? 'border-[#00e07a] text-[#00e07a] bg-[#00e07a]/10'
                        : 'border-[#272b35] text-[#8891a8] bg-[#1d2028] hover:text-[#c2c8d8]'
                    }`}
                  >
                    {ROLE_LABELS_BY_ROLE[r]}
                  </button>
                ))}
              </div>
              {(newUserRole === 'admin' || newUserRole === 'project_manager') && (
                <p className="text-[11px] mt-2" style={{ color: '#8891a8' }}>
                  {ROLE_LABELS_BY_ROLE[newUserRole]} accounts are always invited by email — no dormant creation.
                </p>
              )}
            </div>

            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>First Name</label>
                <input
                  type="text"
                  placeholder="First name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50 focus:border-[#00e07a] placeholder-slate-500" style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>Last Name</label>
                <input
                  type="text"
                  placeholder="Last name"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50 focus:border-[#00e07a] placeholder-slate-500" style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
                />
              </div>
            </div>

            {/* Email */}
            <div className="mb-3">
              <label className="text-xs font-medium mb-1 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>Email</label>
              <input
                type="email"
                placeholder="rep@kiloenergy.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50 focus:border-[#00e07a] placeholder-slate-500" style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
              />
            </div>

            {/* Phone */}
            <div className="mb-4">
              <label className="text-xs font-medium mb-1 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>Phone</label>
              <input
                type="tel"
                placeholder="(555) 000-0000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50 focus:border-[#00e07a] placeholder-slate-500" style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
              />
            </div>

            {/* Rep-specific fields — only shown when role === 'rep' */}
            {newUserRole === 'rep' && (
              <>
                {/* Closer/Setter/Both selector */}
                <div className="mb-4">
                  <label className="text-xs font-medium mb-2 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>Rep type</label>
                  <div className="flex gap-2">
                    {(['closer', 'setter', 'both'] as const).map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setNewRepType(rt)}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                          newRepType === rt
                            ? `${ROLE_BADGE_CLS[rt]} bg-opacity-100`
                            : 'border-[#272b35] text-[#8891a8] bg-[#1d2028] hover:border-[#272b35] hover:text-[#c2c8d8]'
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
                  <label className="text-xs font-medium mb-1 block" style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>Trainer (optional)</label>
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
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="w-4 h-4 rounded border-[#333849] accent-[#00e07a] cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Send invitation email</div>
                  <div className="text-[11px]" style={{ color: '#8891a8' }}>
                    Emails the rep a sign-up link. Leave off to add them without giving app access yet.
                  </div>
                </div>
              </label>
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <button
                onClick={resetAddModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors hover:brightness-125"
                style={{ background: 'transparent', border: '1px solid #333849', color: '#c2c8d8' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRep}
                disabled={!newFirstName.trim() || !newLastName.trim() || isAddingRep}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000' }}
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

// ─── Skeleton ────────────────────────────────────────────────────────────────

function RepsSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-9 w-9 bg-[#1d2028] rounded-lg animate-skeleton" />
          <div className="h-8 w-20 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-3 w-44 bg-[#1d2028]/70 rounded animate-skeleton ml-12 mt-1" style={{ animationDelay: '150ms' }} />
      </div>

      {/* Search bar placeholder */}
      <div className="relative max-w-xs mb-6">
        <div className="h-9 w-full bg-[#1d2028] rounded-xl animate-skeleton" style={{ animationDelay: '75ms' }} />
      </div>

      {/* 6 rep card skeletons */}
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => {
          const delay = i * 75;
          return (
            <div
              key={i}
              className="card-surface rounded-2xl p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
            >
              {/* Avatar + name/email */}
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-full bg-[#1d2028] flex-shrink-0 animate-skeleton"
                  style={{ animationDelay: `${delay}ms` }}
                />
                <div className="space-y-2">
                  <div
                    className="h-4 w-32 bg-[#1d2028] rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-44 bg-[#1d2028]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                </div>
              </div>

              {/* 4 stat number placeholders */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:items-center md:gap-8">
                {[...Array(4)].map((_, si) => (
                  <div key={si} className="text-center space-y-1.5">
                    <div
                      className="h-4 w-10 bg-[#1d2028] rounded animate-skeleton mx-auto"
                      style={{ animationDelay: `${delay + si * 30}ms` }}
                    />
                    <div
                      className="h-3 w-14 bg-[#1d2028]/70 rounded animate-skeleton mx-auto"
                      style={{ animationDelay: `${delay + si * 30}ms` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
