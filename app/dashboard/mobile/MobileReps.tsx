'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { Search, Plus, Users, ChevronRight, Mail, Clock, UserCog, Trash2, Check } from 'lucide-react';
import { formatCompactKW } from '../../../lib/utils';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';
import { TopPerformersPodium } from '../users/components/TopPerformersPodium';

const REP_TYPE_LABELS: Record<string, string> = { closer: 'Closer', setter: 'Setter', both: 'Both' };
const REP_TYPE_FILTERS = [
  { value: 'all',    label: 'All' },
  { value: 'closer', label: 'Closers' },
  { value: 'setter', label: 'Setters' },
  { value: 'both',   label: 'Both' },
] as const;
type RepTypeFilter = typeof REP_TYPE_FILTERS[number]['value'];
const PIPELINE_EXCLUDED: ReadonlySet<string> = new Set(['Cancelled', 'On Hold', 'Completed']);

// Top-level role filter — matches the desktop Users page.
const ROLE_FILTERS = [
  { value: 'all',              label: 'All' },
  { value: 'rep',              label: 'Reps' },
  { value: 'sub-dealer',       label: 'SDs' },
  { value: 'project_manager',  label: 'PMs' },
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

const ROLE_LABELS_BY_ROLE: Record<'rep' | 'admin' | 'sub-dealer' | 'project_manager', string> = {
  rep: 'Rep',
  admin: 'Admin',
  'sub-dealer': 'Sub-Dealer',
  project_manager: 'Project Manager',
};

const ROLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  rep:              { label: 'Rep',      color: 'var(--accent-emerald-text)', bg: 'var(--accent-emerald-soft)' },
  'sub-dealer':     { label: 'SD',       color: 'var(--accent-purple-text)', bg: 'var(--accent-purple-soft)' },
  project_manager:  { label: 'PM',       color: 'var(--accent-cyan-text)', bg: 'color-mix(in srgb, var(--accent-cyan-solid) 12%, transparent)' },
  admin:            { label: 'Admin',    color: 'var(--accent-amber-text)', bg: 'var(--accent-amber-soft)' },
};

export default function MobileReps() {
  const router = useRouter();
  const { effectiveRole, projects, payrollEntries, reps, subDealers, addRep, addSubDealer, deactivateRep, reactivateRep, deactivateSubDealer, reactivateSubDealer, convertUserRole } = useApp();
  const { toast } = useToast();

  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [repTypeFilter, setRepTypeFilter] = useState<RepTypeFilter>('all');
  const [adminUsers, setAdminUsers] = useState<SimpleUser[]>([]);
  const [pmUsers, setPmUsers] = useState<SimpleUser[]>([]);

  // Fetch admins + PMs for admin/PM viewers so the role filter can show them.
  useEffect(() => {
    if (!isAdmin && !isPM) return;
    fetch('/api/reps?role=admin')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string }>) => {
        setAdminUsers(data.map((u) => ({ ...u, role: 'admin' })));
      })
      .catch(() => {});
    fetch('/api/reps?role=project_manager')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string }>) => {
        setPmUsers(data.map((u) => ({ ...u, role: 'project_manager' })));
      })
      .catch(() => {});
  }, [isAdmin, isPM]);
  const [showAddRep, setShowAddRep] = useState(false);
  const [addForm, setAddForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    repType: 'both' as 'closer' | 'setter' | 'both',
    userRole: 'rep' as 'rep' | 'admin' | 'sub-dealer' | 'project_manager',
    trainerId: '',
    sendInvite: false,
  });
  const [isAddingUser, setIsAddingUser] = useState(false);

  // Inactive section expand/collapse state
  const [showInactiveReps, setShowInactiveReps] = useState(false);
  const [showInactiveSubDealers, setShowInactiveSubDealers] = useState(false);
  const [showInactivePMs, setShowInactivePMs] = useState(false);
  const [showInactiveAdmins, setShowInactiveAdmins] = useState(false);

  // Pending Clerk invitations (admin only)
  type PendingInvitation = { id: string; emailAddress: string; createdAt: number };
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/users/invitations')
      .then((r) => r.ok ? r.json() : { invitations: [] })
      .then((data) => setPendingInvitations(data.invitations ?? []))
      .catch(() => {});
  }, [isAdmin]);

  // Reactivating state per user
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reactivatingSubDealerId, setReactivatingSubDealerId] = useState<string | null>(null);
  const [reactivatingPmId, setReactivatingPmId] = useState<string | null>(null);
  const [reactivatingAdminId, setReactivatingAdminId] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const delay = search === '' ? 0 : 200;
    const timer = setTimeout(() => setDebouncedSearch(search), delay);
    return () => clearTimeout(timer);
  }, [search]);

  // Active deals count per rep
  const activeDealsByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      if (PIPELINE_EXCLUDED.has(p.phase)) continue;
      const ids = new Set<string>([p.repId]);
      if (p.setterId) ids.add(p.setterId);
      p.additionalClosers?.forEach((c) => ids.add(c.userId));
      p.additionalSetters?.forEach((c) => ids.add(c.userId));
      for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [projects]);

  // kW sold per rep
  const kwByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      if (PIPELINE_EXCLUDED.has(p.phase)) continue;
      const kw = p.kWSize ?? 0;
      const ids = new Set<string>([p.repId]);
      if (p.setterId) ids.add(p.setterId);
      p.additionalClosers?.forEach((c) => ids.add(c.userId));
      p.additionalSetters?.forEach((c) => ids.add(c.userId));
      for (const id of ids) map.set(id, (map.get(id) ?? 0) + kw);
    }
    return map;
  }, [projects]);

  // Total paid per rep
  const paidByRep = useMemo(() => {
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const map = new Map<string, number>();
    for (const pe of payrollEntries) {
      if (pe.status === 'Paid' && pe.date <= today) {
        map.set(pe.repId, (map.get(pe.repId) ?? 0) + pe.amount);
      }
    }
    return map;
  }, [payrollEntries]);

  const podiumDisplay = useMemo(() => {
    const top3 = [...reps]
      .filter((r) => r.role === 'rep' && r.active !== false)
      .map((r) => ({ rep: { id: r.id, name: r.name }, paid: paidByRep.get(r.id) ?? 0 }))
      .filter(({ paid }) => paid > 0)
      .sort((a, b) => b.paid - a.paid)
      .slice(0, 3);
    if (top3.length < 3) return [];
    return [
      { ...top3[1], rank: 2, order: 1 },
      { ...top3[0], rank: 1, order: 2 },
      { ...top3[2], rank: 3, order: 3 },
    ];
  }, [reps, paidByRep]);

  const filtered = useMemo(() => {
    return reps.filter((r) => {
      if (r.active === false) return false;
      if (r.role !== 'rep') return false;
      if (repTypeFilter !== 'all' && r.repType !== repTypeFilter && r.repType !== 'both') return false;
      if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase()) && !r.email?.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      return true;
    });
  }, [reps, debouncedSearch, repTypeFilter]);

  // Inactive lists — filtered by search, not by role pill
  const inactiveReps = reps.filter((r) => {
    if (r.active !== false) return false;
    if (r.role !== 'rep') return false;
    if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase()) && !r.email?.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });
  const inactiveSubDealers = subDealers.filter((s) => {
    if (s.active !== false) return false;
    const name = `${s.firstName} ${s.lastName}`;
    if (debouncedSearch && !name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });
  const inactivePMs = pmUsers.filter((u) => {
    if (u.active !== false) return false;
    const name = `${u.firstName} ${u.lastName}`;
    if (debouncedSearch && !name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });
  const inactiveAdmins = adminUsers.filter((u) => {
    if (u.active !== false) return false;
    const name = `${u.firstName} ${u.lastName}`;
    if (debouncedSearch && !name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    return true;
  });

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  };

  // ── Compare mode ──────────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    if (roleFilter !== 'rep') {
      setCompareMode(false);
      setCompareIds(new Set());
    }
  }, [roleFilter]);

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  };

  const getCompareDateRanges = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDay();
    const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const startOfWeek = new Date(y, m, now.getDate() - (d === 0 ? 6 : d - 1));
    const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
    const q = Math.floor(m / 3);
    switch (comparePeriod) {
      case 'this-week': {
        const prevStart = new Date(startOfWeek); prevStart.setDate(prevStart.getDate() - 7);
        const prevEnd = new Date(prevStart); prevEnd.setDate(prevStart.getDate() + 6);
        return { current: { from: fmt(startOfWeek), to: fmt(endOfWeek), label: 'This Week' }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: 'Last Week' } };
      }
      case 'this-month': {
        const curStart = new Date(y, m, 1); const curEnd = new Date(y, m + 1, 0);
        const prevStart = new Date(y, m - 1, 1); const prevEnd = new Date(y, m, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: 'This Month' }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: 'Last Month' } };
      }
      case 'last-month': {
        const curStart = new Date(y, m - 1, 1); const curEnd = new Date(y, m, 0);
        const prevStart = new Date(y, m - 2, 1); const prevEnd = new Date(y, m - 1, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: 'Last Month' }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: 'Month Before' } };
      }
      case 'this-quarter': {
        const curStart = new Date(y, q * 3, 1); const curEnd = new Date(y, q * 3 + 3, 0);
        const prevStart = new Date(y, (q - 1) * 3, 1); const prevEnd = new Date(y, q * 3, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: `Q${q + 1} ${y}` }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: `Q${q === 0 ? 4 : q} ${q === 0 ? y - 1 : y}` } };
      }
      case 'last-quarter': {
        const pq = q === 0 ? 3 : q - 1; const py = q === 0 ? y - 1 : y;
        const curStart = new Date(py, pq * 3, 1); const curEnd = new Date(py, pq * 3 + 3, 0);
        const ppq = pq === 0 ? 3 : pq - 1; const ppy = pq === 0 ? py - 1 : py;
        const prevStart = new Date(ppy, ppq * 3, 1); const prevEnd = new Date(ppy, ppq * 3 + 3, 0);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: `Q${pq + 1} ${py}` }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: `Q${ppq + 1} ${ppy}` } };
      }
      case 'this-year': {
        const curStart = new Date(y, 0, 1); const curEnd = new Date(y, 11, 31);
        const prevStart = new Date(y - 1, 0, 1); const prevEnd = new Date(y - 1, 11, 31);
        return { current: { from: fmt(curStart), to: fmt(curEnd), label: `${y}` }, prev: { from: fmt(prevStart), to: fmt(prevEnd), label: `${y - 1}` } };
      }
      case 'custom':
        return { current: { from: customFrom, to: customTo, label: 'Custom' }, prev: null };
    }
  };

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader
        title="Users"
        right={
          isAdmin ? (
            <button
              onClick={() => setShowAddRep(true)}
              className="flex items-center justify-center w-10 h-10 rounded-2xl text-black active:opacity-80 transition-colors"
              style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', boxShadow: '0 0 20px var(--accent-emerald-glow)' }}
              aria-label="Add rep"
            >
              <Plus className="w-5 h-5" />
            </button>
          ) : null
        }
      />

      {/* Role filter pills — horizontal scroll for small screens */}
      <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: 'none' }}>
        {ROLE_FILTERS.map((rf) => {
          const active = roleFilter === rf.value;
          return (
            <button
              key={rf.value}
              onClick={() => { setRoleFilter(rf.value); setRepTypeFilter('all'); }}
              className="shrink-0 min-h-[40px] px-4 rounded-xl text-sm font-semibold active:scale-[0.94]"
              style={{
                background: active ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
                color: active ? '#000' : 'var(--text-muted)',
                border: active ? 'none' : '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                boxShadow: active ? '0 0 14px color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' : 'none',
                transition: 'background-color 200ms cubic-bezier(0.16, 1, 0.3, 1), color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 250ms ease, transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {rf.label}
            </button>
          );
        })}
      </div>

      {/* Rep-type sub-filter — only shown when viewing reps */}
      {roleFilter === 'rep' && (
        <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: 'none' }}>
          {REP_TYPE_FILTERS.map((rt) => {
            const active = repTypeFilter === rt.value;
            return (
              <button
                key={rt.value}
                onClick={() => setRepTypeFilter(rt.value)}
                className="shrink-0 min-h-[36px] px-3 rounded-xl text-xs font-semibold active:scale-[0.94]"
                style={{
                  background: active ? 'color-mix(in srgb, var(--accent-cyan-solid) 20%, transparent)' : 'var(--surface-card)',
                  color: active ? 'var(--accent-cyan-solid)' : 'var(--text-muted)',
                  border: active ? '1px solid color-mix(in srgb, var(--accent-cyan-solid) 40%, transparent)' : '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  boxShadow: active ? '0 0 14px color-mix(in srgb, var(--accent-cyan-solid) 25%, transparent)' : 'none',
                  transition: 'background-color 200ms cubic-bezier(0.16, 1, 0.3, 1), color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 250ms ease, transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              >
                {rt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder={roleFilter === 'rep' ? 'Search reps...' : 'Search users...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-2xl text-base text-[var(--text-primary)] focus:outline-none focus:ring-1 transition-colors"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        />
      </div>

      {/* Compare Reps button — admin only, rep filter only */}
      {isAdmin && roleFilter === 'rep' && (
        <div>
          <button
            onClick={() => { setCompareMode((v) => !v); if (compareMode) setCompareIds(new Set()); }}
            className="min-h-[40px] px-4 rounded-xl text-sm font-semibold active:scale-[0.95]"
            style={{
              background: compareMode ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
              color: compareMode ? '#000' : 'var(--text-muted)',
              border: compareMode ? 'none' : '1px solid var(--border-subtle)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              boxShadow: compareMode ? '0 0 14px color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' : 'none',
              transition: 'background-color 200ms cubic-bezier(0.16, 1, 0.3, 1), color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 250ms ease, transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {compareMode ? `Comparing (${compareIds.size}/3) — Tap to exit` : 'Compare Reps'}
          </button>
          {compareMode && compareIds.size === 0 && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Select 2–3 reps below to compare.
            </p>
          )}
        </div>
      )}

      {/* Pending invitations panel — admin only */}
      {isAdmin && pendingInvitations.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-4 h-4 text-[var(--accent-amber-text)] shrink-0" />
            <span className="text-sm font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Pending Invitations</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/10 text-[var(--accent-amber-text)] border border-amber-400/20">{pendingInvitations.length}</span>
          </div>
          <div className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 px-2 py-2 rounded-xl" style={{ background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }}>
                <Clock className="w-3.5 h-3.5 text-[var(--accent-amber-text)]/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)] font-medium truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{inv.emailAddress}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    Invited {new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <button
                  disabled={revokingInvitationId === inv.id}
                  onClick={() => {
                    if (revokingInvitationId) return;
                    setConfirmAction({
                      title: 'Revoke Invitation',
                      message: `Revoke invitation for ${inv.emailAddress}?`,
                      confirmLabel: 'Revoke',
                      onConfirm: async () => {
                        setConfirmAction(null);
                        setRevokingInvitationId(inv.id);
                        try {
                          const res = await fetch(`/api/users/invitations/${inv.id}`, { method: 'DELETE' });
                          if (!res.ok) throw new Error('Revoke failed');
                          setPendingInvitations((prev) => prev.filter((i) => i.id !== inv.id));
                          toast(`Invitation for ${inv.emailAddress} revoked`, 'success');
                        } catch {
                          toast('Failed to revoke invitation', 'error');
                        } finally {
                          setRevokingInvitationId(null);
                        }
                      },
                    });
                  }}
                  className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                  style={{ color: 'var(--accent-red-text)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 30%, transparent)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                >
                  {revokingInvitationId === inv.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-rep simple user list — shown for all filters except 'rep' */}
      {roleFilter !== 'rep' && (() => {
        const pool: SimpleUser[] =
          roleFilter === 'all'
            ? [
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
        const filteredPool = q
          ? pool.filter((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
          : pool;

        if (filteredPool.length === 0) {
          return <MobileEmptyState icon={Users} title="No users found" subtitle={q ? 'Try adjusting your search' : 'No users in this category yet'} />;
        }
        return (
          <div className="space-y-3">
            {filteredPool.map((u) => {
              const badge = ROLE_BADGE[u.role] ?? { label: u.role, color: 'var(--text-muted)', bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)' };
              const initials = `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
              return (
                <MobileCard key={u.id} onTap={() => router.push(`/dashboard/users/${u.id}`)}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.firstName} {u.lastName}</p>
                      {u.email && (
                        <p className="text-sm truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>
                      )}
                    </div>
                    <MobileBadge value={badge.label} />
                    {isAdmin && u.role === 'sub-dealer' && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmAction({
                              title: `Deactivate ${u.firstName} ${u.lastName}?`,
                              message: 'They will lose app access immediately. You can reactivate them later.',
                              confirmLabel: 'Deactivate',
                              onConfirm: async () => {
                                setConfirmAction(null);
                                try {
                                  await deactivateSubDealer(u.id);
                                  toast(`${u.firstName} ${u.lastName} deactivated`, 'success');
                                } catch { /* error toast shown by persistFetch */ }
                              },
                            });
                          }}
                          title="Deactivate sub-dealer"
                          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmAction({
                              title: 'Convert to Rep',
                              message: `Convert ${u.firstName} ${u.lastName} from Sub-Dealer to Rep? This will change their role and cannot be undone easily.`,
                              confirmLabel: 'Convert',
                              onConfirm: () => convertUserRole(u.id, 'rep')
                                .then(() => toast(`${u.firstName} ${u.lastName} converted to Rep`, 'success'))
                                .catch(() => {}),
                            });
                          }}
                          title="Convert to Rep"
                          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <UserCog className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </MobileCard>
              );
            })}
          </div>
        );
      })()}

      {/* Top Performers Podium — reps view, non-PM only */}
      {roleFilter === 'rep' && !isPM && <TopPerformersPodium entries={podiumDisplay} />}

      {/* Comparison Cards — shown when compare mode is active with 2+ reps selected */}
      {roleFilter === 'rep' && compareMode && compareIds.size >= 2 && (() => {
        const ranges = getCompareDateRanges();
        const isInRange = (dateStr: string | null, from: string, to: string) => {
          if (!from || !to || !dateStr) return false;
          return dateStr >= from && dateStr <= to;
        };
        const compareReps = filtered.filter((r) => compareIds.has(r.id));
        const todayStr = new Date().toISOString().slice(0, 10);
        if (compareReps.length < 2) return (
          <div className="rounded-2xl p-4 text-sm" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            Some selected reps are hidden by the current filter. Change the filter or re-select reps to compare.
          </div>
        );
        return (
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>Rep Comparison</span>
              {ranges.prev && <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>vs {ranges.prev.label}</span>}
            </div>
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-2 mb-3" style={{ scrollbarWidth: 'none' }}>
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setComparePeriod(opt.value)}
                  className="shrink-0 min-h-[32px] px-3 rounded-xl text-xs font-semibold transition-colors"
                  style={{
                    background: comparePeriod === opt.value ? 'color-mix(in srgb, var(--accent-cyan-solid) 20%, transparent)' : 'var(--surface-pressed)',
                    color: comparePeriod === opt.value ? 'var(--accent-cyan-solid)' : 'var(--text-muted)',
                    border: comparePeriod === opt.value ? '1px solid color-mix(in srgb, var(--accent-cyan-solid) 40%, transparent)' : '1px solid var(--border-subtle)',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {comparePeriod === 'custom' && (
              <div className="flex items-center gap-2 mb-3">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="flex-1 min-h-[36px] rounded-xl px-2 text-[var(--text-primary)] text-xs focus:outline-none"
                  style={{ background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="flex-1 min-h-[36px] rounded-xl px-2 text-[var(--text-primary)] text-xs focus:outline-none"
                  style={{ background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }} />
              </div>
            )}
            <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
              {compareReps.map((rep) => {
                const rp = ranges.current.from && ranges.current.to
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.current.from, ranges.current.to))
                  : [];
                const dealsClosed = rp.length;
                const kwSold = rp.reduce((s, p) => s + p.kWSize, 0);
                const avgDealSize = dealsClosed > 0 ? kwSold / dealsClosed : 0;
                const commissionEarned = ranges.current.from && ranges.current.to
                  ? payrollEntries.filter((e) => e.repId === rep.id && e.status === 'Paid' && isInRange(e.date, ranges.current.from, ranges.current.to) && e.date <= todayStr).reduce((s, e) => s + e.amount, 0)
                  : 0;
                const rpCancelled = ranges.current.from && ranges.current.to
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase === 'Cancelled' && isInRange(p.soldDate, ranges.current.from, ranges.current.to))
                  : [];
                const cancelRate = (rp.length + rpCancelled.length) > 0 ? (rpCancelled.length / (rp.length + rpCancelled.length) * 100) : 0;
                const prevDeals = ranges.prev
                  ? projects.filter((p) => (p.repId === rep.id || p.setterId === rep.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && isInRange(p.soldDate, ranges.prev!.from, ranges.prev!.to)).length
                  : null;
                const deltaDeals = prevDeals !== null ? dealsClosed - prevDeals : null;
                return (
                  <div key={rep.id} className="shrink-0 rounded-2xl p-3 text-center" style={{ minWidth: 140, background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-black text-xs font-bold mx-auto mb-1.5"
                      style={{ background: 'linear-gradient(135deg, var(--accent-cyan-solid), var(--accent-emerald-solid))' }}>
                      {getInitials(rep.name)}
                    </div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate mb-0.5" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.name}</p>
                    <p className="text-[10px] mb-2" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{ranges.current.label}</p>
                    <div className="space-y-1.5 text-xs text-left">
                      <div className="flex justify-between gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>Deals</span>
                        <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1">
                          {dealsClosed}
                          {deltaDeals !== null && deltaDeals !== 0 && (
                            <span style={{ color: deltaDeals > 0 ? 'var(--accent-emerald-solid)' : '#f87171', fontSize: 9 }}>{deltaDeals > 0 ? '+' : ''}{deltaDeals}</span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>kW</span>
                        <span className="font-semibold text-[var(--text-primary)]">{formatCompactKW(kwSold)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>Avg</span>
                        <span className="font-semibold text-[var(--text-primary)]">{avgDealSize.toFixed(1)} kW</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>Paid</span>
                        <span className="font-semibold" style={{ color: 'var(--accent-emerald-text)' }}>${commissionEarned.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>Cancel</span>
                        <span className="font-semibold" style={{ color: cancelRate > 20 ? '#f87171' : 'var(--text-muted)' }}>{cancelRate.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Rep list — shown only when the role filter is 'rep' */}
      {roleFilter === 'rep' && (filtered.length === 0 ? (
        <MobileEmptyState icon={Users} title="No reps found" subtitle="Try adjusting your search" />
      ) : (
        <div className="space-y-3">
          {filtered.map((rep) => {
            const deals = activeDealsByRep.get(rep.id) ?? 0;
            const kw = kwByRep.get(rep.id) ?? 0;
            const paid = paidByRep.get(rep.id) ?? 0;

            return (
              <MobileCard key={rep.id} onTap={() => compareMode ? toggleCompareId(rep.id) : router.push(`/dashboard/users/${rep.id}`)}>
                <div className="flex items-center gap-3">
                  {compareMode && (
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                      style={{
                        background: compareIds.has(rep.id) ? 'var(--accent-emerald-solid)' : 'transparent',
                        border: compareIds.has(rep.id) ? 'none' : '1.5px solid var(--border-subtle)',
                      }}
                    >
                      {compareIds.has(rep.id) && <Check className="w-3 h-3 text-black" />}
                    </div>
                  )}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-black text-base font-bold shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--accent-cyan-solid), var(--accent-emerald-solid))' }}
                  >
                    {getInitials(rep.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.name}</p>
                    {rep.email && (
                      <p className="text-base truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
                    )}
                  </div>
                  <MobileBadge value={REP_TYPE_LABELS[rep.repType] ?? rep.repType} />
                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmAction({
                          title: `Deactivate ${rep.name}?`,
                          message: 'They will lose app access immediately. Their existing deals and commission history are preserved. You can reactivate them later.',
                          confirmLabel: 'Deactivate',
                          onConfirm: async () => {
                            setConfirmAction(null);
                            try {
                              await deactivateRep(rep.id);
                              toast(`${rep.name} deactivated`, 'success');
                            } catch { /* error toast shown by persistFetch */ }
                          },
                        });
                      }}
                      title="Deactivate rep"
                      className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex gap-4 mt-3 text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{deals}</span> deals</span>
                  <span>&middot;</span>
                  <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{kw.toFixed(1)}</span> kW</span>
                  <span>&middot;</span>
                  <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${paid.toLocaleString()}</span> paid</span>
                </div>
              </MobileCard>
            );
          })}
        </div>
      ))}

      {/* Inactive reps — shown for rep or all filter */}
      {isAdmin && (roleFilter === 'rep' || roleFilter === 'all') && inactiveReps.length > 0 && (
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setShowInactiveReps((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactiveReps ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive reps ({inactiveReps.length})
            </span>
          </button>
          {showInactiveReps && (
            <div className="mt-2 space-y-2">
              {inactiveReps.map((rep) => (
                <div key={rep.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)', color: 'var(--text-muted)' }}>
                    {(rep.firstName?.[0] ?? '') + (rep.lastName?.[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${rep.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {rep.name} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {rep.email && <p className="text-xs truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>}
                  </div>
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
                    className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-50"
                    style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)', border: '1px solid var(--accent-emerald-glow)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    {reactivatingId === rep.id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inactive sub-dealers — shown for sub-dealer or all filter */}
      {isAdmin && (roleFilter === 'sub-dealer' || roleFilter === 'all') && inactiveSubDealers.length > 0 && (
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setShowInactiveSubDealers((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactiveSubDealers ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive sub-dealers ({inactiveSubDealers.length})
            </span>
          </button>
          {showInactiveSubDealers && (
            <div className="mt-2 space-y-2">
              {inactiveSubDealers.map((sd) => (
                <div key={sd.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)', color: 'var(--text-muted)' }}>
                    {(sd.firstName[0] ?? '') + (sd.lastName[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${sd.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {sd.firstName} {sd.lastName} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {sd.email && <p className="text-xs truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{sd.email}</p>}
                  </div>
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
                    className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-50"
                    style={{ background: 'var(--accent-purple-soft)', color: 'var(--accent-purple-text)', border: '1px solid color-mix(in srgb, var(--accent-purple-solid) 30%, transparent)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    {reactivatingSubDealerId === sd.id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inactive PMs — shown for project_manager or all filter */}
      {isAdmin && (roleFilter === 'project_manager' || roleFilter === 'all') && inactivePMs.length > 0 && (
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setShowInactivePMs((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactivePMs ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive project managers ({inactivePMs.length})
            </span>
          </button>
          {showInactivePMs && (
            <div className="mt-2 space-y-2">
              {inactivePMs.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)', color: 'var(--text-muted)' }}>
                    {(u.firstName[0] ?? '') + (u.lastName[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${u.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {u.firstName} {u.lastName} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {u.email && <p className="text-xs truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>}
                  </div>
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
                    className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-50"
                    style={{ background: 'color-mix(in srgb, var(--accent-cyan-solid) 12%, transparent)', color: 'var(--accent-cyan-text)', border: '1px solid color-mix(in srgb, var(--accent-cyan-solid) 30%, transparent)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    {reactivatingPmId === u.id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inactive admins — shown for admin or all filter */}
      {isAdmin && (roleFilter === 'admin' || roleFilter === 'all') && inactiveAdmins.length > 0 && (
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setShowInactiveAdmins((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactiveAdmins ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive admins ({inactiveAdmins.length})
            </span>
          </button>
          {showInactiveAdmins && (
            <div className="mt-2 space-y-2">
              {inactiveAdmins.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)', color: 'var(--text-muted)' }}>
                    {(u.firstName[0] ?? '') + (u.lastName[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${u.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {u.firstName} {u.lastName} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {u.email && <p className="text-xs truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>}
                  </div>
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
                    className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-50"
                    style={{ background: 'var(--accent-amber-soft)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    {reactivatingAdminId === u.id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => confirmAction.onConfirm()}
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger
        />
      )}

      {/* Add User Bottom Sheet */}
      <MobileBottomSheet
        open={showAddRep}
        onClose={() => {
          setShowAddRep(false);
          setAddForm({ firstName: '', lastName: '', email: '', phone: '', repType: 'both', userRole: 'rep', trainerId: '', sendInvite: false });
        }}
        title="Add User"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!addForm.firstName.trim() || !addForm.lastName.trim()) {
              toast('First and last name are required', 'error');
              return;
            }
            const needsInvite = addForm.userRole === 'admin' || addForm.userRole === 'project_manager' || addForm.sendInvite;
            if (needsInvite && !addForm.email.trim()) {
              toast('Email is required to send an invitation', 'error');
              return;
            }
            setIsAddingUser(true);
            try {
              const fn = addForm.firstName.trim();
              const ln = addForm.lastName.trim();
              const em = addForm.email.trim();
              const ph = addForm.phone.trim();
              const trainerIdSnapshot = addForm.userRole === 'rep' ? addForm.trainerId : '';
              let newRepId: string | null = null;
              if (needsInvite) {
                const res = await fetch('/api/users/invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ firstName: fn, lastName: ln, email: em, phone: ph, role: addForm.userRole, repType: addForm.userRole === 'rep' ? addForm.repType : undefined }),
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  throw new Error(body.error ?? `HTTP ${res.status}`);
                }
                const data = await res.json();
                if (addForm.userRole === 'admin') {
                  setAdminUsers((prev) => [...prev, { id: data.user.id, firstName: fn, lastName: ln, email: em, phone: ph, role: 'admin' }]);
                } else if (addForm.userRole === 'project_manager') {
                  setPmUsers((prev) => [...prev, { id: data.user.id, firstName: fn, lastName: ln, email: em, phone: ph, role: 'project_manager' }]);
                } else if (addForm.userRole === 'sub-dealer') {
                  addSubDealer(fn, ln, em, ph, data.user.id);
                } else {
                  newRepId = data.user.id;
                  addRep(fn, ln, em, ph, addForm.repType, data.user.id);
                }
                toast(`Invitation sent to ${em}`, 'success');
              } else if (addForm.userRole === 'sub-dealer') {
                await addSubDealer(fn, ln, em, ph);
                toast(`${fn} ${ln} added`, 'success');
              } else {
                const res = await fetch('/api/reps', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ firstName: fn, lastName: ln, email: em, phone: ph, repType: addForm.repType }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                newRepId = data.id;
                addRep(fn, ln, em, ph, addForm.repType, data.id);
                toast(`${fn} ${ln} added`, 'success');
              }
              if (trainerIdSnapshot && newRepId) {
                fetch('/api/trainer-assignments', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ trainerId: trainerIdSnapshot, traineeId: newRepId, tiers: [{ upToDeal: null, ratePerW: 0.05 }] }),
                })
                  .then((r) => { if (!r.ok) throw new Error(); })
                  .then(() => toast('Trainer assigned', 'success'))
                  .catch(() => toast('Failed to assign trainer', 'error'));
              }
              setShowAddRep(false);
              setAddForm({ firstName: '', lastName: '', email: '', phone: '', repType: 'both', userRole: 'rep', trainerId: '', sendInvite: false });
            } catch (err) {
              toast((err as Error).message || 'Failed to add user', 'error');
            } finally {
              setIsAddingUser(false);
            }
          }}
          className="px-5 space-y-4 pb-2"
        >
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Role</label>
            <div className="flex gap-2 flex-wrap">
              {(['rep', 'admin', 'sub-dealer', 'project_manager'] as const).map((role) => {
                const labels: Record<string, string> = { rep: 'Rep', admin: 'Admin', 'sub-dealer': 'Sub-Dealer', project_manager: 'PM' };
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setAddForm((f) => ({ ...f, userRole: role, sendInvite: false }))}
                    className="flex-1 min-h-[40px] rounded-2xl text-sm font-semibold transition-colors"
                    style={{
                      background: addForm.userRole === role ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
                      color: addForm.userRole === role ? '#000' : 'var(--text-muted)',
                      border: addForm.userRole === role ? '1px solid var(--accent-emerald-solid)' : '1px solid var(--border-subtle)',
                      fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    }}
                  >
                    {labels[role]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>First Name</label>
            <input
              type="text"
              required
              value={addForm.firstName}
              onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="First name"
              className="w-full min-h-[48px] text-[var(--text-primary)] text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Last Name</label>
            <input
              type="text"
              required
              value={addForm.lastName}
              onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Last name"
              className="w-full min-h-[48px] text-[var(--text-primary)] text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Email</label>
            <input
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="email@example.com"
              className="w-full min-h-[48px] text-[var(--text-primary)] text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          {addForm.userRole === 'rep' && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep Type</label>
              <div className="flex gap-2">
                {(['closer', 'setter', 'both'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAddForm((f) => ({ ...f, repType: type }))}
                    className="flex-1 min-h-[48px] rounded-2xl text-base font-semibold transition-colors"
                    style={{
                      background: addForm.repType === type ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
                      color: addForm.repType === type ? '#000' : 'var(--text-muted)',
                      border: addForm.repType === type ? '1px solid var(--accent-emerald-solid)' : '1px solid var(--border-subtle)',
                      fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    }}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {addForm.userRole === 'rep' && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Trainer (optional)</label>
              <select
                value={addForm.trainerId}
                onChange={(e) => setAddForm((f) => ({ ...f, trainerId: e.target.value }))}
                className="w-full min-h-[48px] text-[var(--text-primary)] text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                <option value="">-- No trainer --</option>
                {reps.filter((r) => r.active !== false && r.role === 'rep').map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}
          {(addForm.userRole === 'rep' || addForm.userRole === 'sub-dealer') && (
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addForm.sendInvite}
                onChange={(e) => setAddForm((f) => ({ ...f, sendInvite: e.target.checked }))}
                className="w-5 h-5 rounded accent-emerald-400"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                Send invite email
              </span>
            </label>
          )}
          <button
            type="submit"
            disabled={isAddingUser}
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-80 transition-colors disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
              boxShadow: '0 0 20px var(--accent-emerald-glow)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {isAddingUser ? 'Adding…' : (addForm.sendInvite || addForm.userRole === 'admin' || addForm.userRole === 'project_manager') ? `Send ${ROLE_LABELS_BY_ROLE[addForm.userRole as 'rep' | 'admin' | 'sub-dealer' | 'project_manager']} Invite` : `Add ${ROLE_LABELS_BY_ROLE[addForm.userRole as 'rep' | 'admin' | 'sub-dealer' | 'project_manager']}`}
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
