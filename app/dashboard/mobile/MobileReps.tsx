'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { Search, Plus, Users, ChevronRight, Mail, Clock, UserCog } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import ConfirmDialog from '../components/ConfirmDialog';
import { TopPerformersPodium } from '../users/components/TopPerformersPodium';

const REP_TYPE_LABELS: Record<string, string> = { closer: 'Closer', setter: 'Setter', both: 'Both' };
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

const ROLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  rep:              { label: 'Rep',      color: 'var(--accent-emerald)', bg: 'rgba(0,229,160,0.12)' },
  'sub-dealer':     { label: 'SD',       color: '#b47dff', bg: 'rgba(180,125,255,0.12)' },
  project_manager:  { label: 'PM',       color: 'var(--accent-cyan)', bg: 'rgba(0,196,240,0.12)' },
  admin:            { label: 'Admin',    color: 'var(--accent-amber)', bg: 'rgba(255,176,32,0.12)' },
};

export default function MobileReps() {
  const router = useRouter();
  const { effectiveRole, projects, payrollEntries, reps, subDealers, addRep, addSubDealer, reactivateRep, reactivateSubDealer, convertUserRole } = useApp();
  const { toast } = useToast();

  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [adminUsers, setAdminUsers] = useState<SimpleUser[]>([]);
  const [pmUsers, setPmUsers] = useState<SimpleUser[]>([]);

  // Fetch admins + PMs for admin viewers so the role filter can show them.
  useEffect(() => {
    if (!isAdmin) return;
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
  }, [isAdmin]);
  const [showAddRep, setShowAddRep] = useState(false);
  const [addForm, setAddForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    repType: 'closer' as 'closer' | 'setter' | 'both',
    userRole: 'rep' as 'rep' | 'admin' | 'sub-dealer' | 'project_manager',
  });
  const [, setIsAddingUser] = useState(false);

  // Inactive section expand/collapse state
  const [showInactiveReps, setShowInactiveReps] = useState(false);
  const [showInactiveSubDealers, setShowInactiveSubDealers] = useState(false);
  const [showInactivePMs, setShowInactivePMs] = useState(false);
  const [showInactiveAdmins, setShowInactiveAdmins] = useState(false);

  // Pending Clerk invitations (admin only)
  type PendingInvitation = { id: string; emailAddress: string; createdAt: number };
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [, setConfirmAction] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void> } | null>(null);

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
      map.set(p.repId, (map.get(p.repId) ?? 0) + kw);
      if (p.setterId && p.setterId !== p.repId) {
        map.set(p.setterId, (map.get(p.setterId) ?? 0) + kw);
      }
    }
    return map;
  }, [projects]);

  // Total paid per rep
  const paidByRep = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
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
      if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase()) && !r.email?.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      return true;
    });
  }, [reps, debouncedSearch]);

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

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader
        title="Users"
        right={
          isAdmin ? (
            <button
              onClick={() => setShowAddRep(true)}
              className="flex items-center justify-center w-10 h-10 rounded-2xl text-black active:opacity-80 transition-colors"
              style={{ background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))', boxShadow: '0 0 20px rgba(0,229,160,0.3)' }}
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
              onClick={() => setRoleFilter(rf.value)}
              className={`shrink-0 min-h-[40px] px-4 rounded-xl text-sm font-semibold transition-colors`}
              style={{
                background: active ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                color: active ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                border: active ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {rf.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
        <input
          type="text"
          placeholder={roleFilter === 'rep' ? 'Search reps...' : 'Search users...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-2xl text-base text-white focus:outline-none focus:ring-1 transition-colors"
          style={{
            background: 'var(--m-card, var(--surface-mobile-card))',
            border: '1px solid var(--m-border, var(--border-mobile))',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        />
      </div>

      {/* Pending invitations panel — admin only */}
      {isAdmin && pendingInvitations.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid rgba(255,176,32,0.25)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-sm font-bold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Pending Invitations</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/10 text-amber-400 border border-amber-400/20">{pendingInvitations.length}</span>
          </div>
          <div className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 px-2 py-2 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                <Clock className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{inv.emailAddress}</p>
                  <p className="text-[11px]" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
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
                  style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
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
              const badge = ROLE_BADGE[u.role] ?? { label: u.role, color: 'var(--text-muted)', bg: 'rgba(136,145,168,0.12)' };
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
                      <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.firstName} {u.lastName}</p>
                      {u.email && (
                        <p className="text-sm truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>
                      )}
                    </div>
                    <MobileBadge value={badge.label} />
                    {isAdmin && u.role === 'sub-dealer' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          convertUserRole(u.id, 'rep')
                            .then(() => toast(`${u.firstName} ${u.lastName} converted to Rep`, 'success'))
                            .catch(() => {});
                        }}
                        title="Convert to Rep"
                        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                        style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
                      >
                        <UserCog className="w-4 h-4" />
                      </button>
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
              <MobileCard key={rep.id} onTap={() => router.push(`/dashboard/users/${rep.id}`)}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-black text-base font-bold shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--accent-cyan2), var(--accent-emerald))' }}
                  >
                    {getInitials(rep.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.name}</p>
                    {rep.email && (
                      <p className="text-base truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
                    )}
                  </div>
                  <MobileBadge value={REP_TYPE_LABELS[rep.repType] ?? rep.repType} />
                </div>

                {isAdmin && (
                  <div className="flex gap-4 mt-3 text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{deals}</span> deals</span>
                    <span>&middot;</span>
                    <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{kw.toFixed(1)}</span> kW</span>
                    <span>&middot;</span>
                    <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${paid.toLocaleString()}</span> paid</span>
                  </div>
                )}
              </MobileCard>
            );
          })}
        </div>
      ))}

      {/* Inactive reps — shown for rep or all filter */}
      {isAdmin && (roleFilter === 'rep' || roleFilter === 'all') && inactiveReps.length > 0 && (
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}>
          <button
            type="button"
            onClick={() => setShowInactiveReps((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactiveReps ? 'rotate-90' : ''}`} style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive reps ({inactiveReps.length})
            </span>
          </button>
          {showInactiveReps && (
            <div className="mt-2 space-y-2">
              {inactiveReps.map((rep) => (
                <div key={rep.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'rgba(136,145,168,0.2)', color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                    {(rep.firstName?.[0] ?? '') + (rep.lastName?.[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${rep.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {rep.name} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {rep.email && <p className="text-xs truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>}
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
                    style={{ background: 'rgba(0,229,160,0.12)', color: 'var(--accent-emerald)', border: '1px solid rgba(0,229,160,0.3)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
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
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}>
          <button
            type="button"
            onClick={() => setShowInactiveSubDealers((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactiveSubDealers ? 'rotate-90' : ''}`} style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive sub-dealers ({inactiveSubDealers.length})
            </span>
          </button>
          {showInactiveSubDealers && (
            <div className="mt-2 space-y-2">
              {inactiveSubDealers.map((sd) => (
                <div key={sd.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'rgba(136,145,168,0.2)', color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                    {(sd.firstName[0] ?? '') + (sd.lastName[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${sd.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {sd.firstName} {sd.lastName} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {sd.email && <p className="text-xs truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{sd.email}</p>}
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
                    style={{ background: 'rgba(180,125,255,0.12)', color: '#b47dff', border: '1px solid rgba(180,125,255,0.3)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
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
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}>
          <button
            type="button"
            onClick={() => setShowInactivePMs((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactivePMs ? 'rotate-90' : ''}`} style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive project managers ({inactivePMs.length})
            </span>
          </button>
          {showInactivePMs && (
            <div className="mt-2 space-y-2">
              {inactivePMs.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'rgba(136,145,168,0.2)', color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                    {(u.firstName[0] ?? '') + (u.lastName[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${u.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {u.firstName} {u.lastName} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {u.email && <p className="text-xs truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>}
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
                    style={{ background: 'rgba(0,196,240,0.12)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,196,240,0.3)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
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
        <div className="mt-2 pt-4 border-t border-dashed" style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}>
          <button
            type="button"
            onClick={() => setShowInactiveAdmins((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-colors"
            style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}
          >
            <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showInactiveAdmins ? 'rotate-90' : ''}`} style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Inactive admins ({inactiveAdmins.length})
            </span>
          </button>
          {showInactiveAdmins && (
            <div className="mt-2 space-y-2">
              {inactiveAdmins.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', opacity: 0.7 }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'rgba(136,145,168,0.2)', color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                    {(u.firstName[0] ?? '') + (u.lastName[0] ?? '')}
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => router.push(`/dashboard/users/${u.id}`)}>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {u.firstName} {u.lastName} <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">(inactive)</span>
                    </p>
                    {u.email && <p className="text-xs truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>}
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
                    style={{ background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber)', border: '1px solid rgba(255,176,32,0.3)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    {reactivatingAdminId === u.id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add User Bottom Sheet */}
      <MobileBottomSheet
        open={showAddRep}
        onClose={() => {
          setShowAddRep(false);
          setAddForm({ firstName: '', lastName: '', email: '', phone: '', repType: 'closer', userRole: 'rep' });
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
            const needsInvite = addForm.userRole === 'admin' || addForm.userRole === 'project_manager';
            if (needsInvite && !addForm.email.trim()) {
              toast('Email is required for this role', 'error');
              return;
            }
            setIsAddingUser(true);
            try {
              const fn = addForm.firstName.trim();
              const ln = addForm.lastName.trim();
              const em = addForm.email.trim();
              const ph = addForm.phone.trim();
              if (needsInvite) {
                const res = await fetch('/api/users/invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ firstName: fn, lastName: ln, email: em, phone: ph, role: addForm.userRole }),
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  throw new Error(body.error ?? `HTTP ${res.status}`);
                }
                const data = await res.json();
                if (addForm.userRole === 'admin') {
                  setAdminUsers((prev) => [...prev, { id: data.user.id, firstName: fn, lastName: ln, email: em, phone: ph, role: 'admin' }]);
                } else {
                  setPmUsers((prev) => [...prev, { id: data.user.id, firstName: fn, lastName: ln, email: em, phone: ph, role: 'project_manager' }]);
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
                addRep(fn, ln, em, ph, addForm.repType, data.id);
                toast(`${fn} ${ln} added`, 'success');
              }
              setShowAddRep(false);
              setAddForm({ firstName: '', lastName: '', email: '', phone: '', repType: 'closer', userRole: 'rep' });
            } catch (err) {
              toast((err as Error).message || 'Failed to add user', 'error');
            } finally {
              setIsAddingUser(false);
            }
          }}
          className="px-5 space-y-4 pb-2"
        >
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Role</label>
            <div className="flex gap-2 flex-wrap">
              {(['rep', 'admin', 'sub-dealer', 'project_manager'] as const).map((role) => {
                const labels: Record<string, string> = { rep: 'Rep', admin: 'Admin', 'sub-dealer': 'Sub-Dealer', project_manager: 'PM' };
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setAddForm((f) => ({ ...f, userRole: role }))}
                    className="flex-1 min-h-[40px] rounded-2xl text-sm font-semibold transition-colors"
                    style={{
                      background: addForm.userRole === role ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                      color: addForm.userRole === role ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                      border: addForm.userRole === role ? '1px solid var(--accent-emerald)' : '1px solid var(--m-border, var(--border-mobile))',
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
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>First Name</label>
            <input
              type="text"
              required
              value={addForm.firstName}
              onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="First name"
              className="w-full min-h-[48px] text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Last Name</label>
            <input
              type="text"
              required
              value={addForm.lastName}
              onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Last name"
              className="w-full min-h-[48px] text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Email</label>
            <input
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="email@example.com"
              className="w-full min-h-[48px] text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep Type</label>
            <div className="flex gap-2">
              {(['closer', 'setter', 'both'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAddForm((f) => ({ ...f, repType: type }))}
                  className="flex-1 min-h-[48px] rounded-2xl text-base font-semibold transition-colors"
                  style={{
                    background: addForm.repType === type ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                    color: addForm.repType === type ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                    border: addForm.repType === type ? '1px solid var(--accent-emerald)' : '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-80 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 0 20px rgba(0,229,160,0.3)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Add Rep
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
