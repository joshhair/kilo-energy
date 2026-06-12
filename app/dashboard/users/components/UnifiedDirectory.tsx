'use client';

// UnifiedDirectory — the non-rep user list (All/Sub-Dealers/PMs/Admins
// role tabs): unified card grid with the T1.5 sub-dealer kebab + the four
// inactive-reactivation expanders. Moved verbatim from users/page.tsx
// (T4.1, 2026-06-11) — the former IIFE body IS this component's body, so
// the local `filtered` const keeps shadowing nothing here (it is the only
// filtered in scope). All destructive actions still funnel through the
// page-root ConfirmDialog via setConfirmAction; PM/admin reactivation does
// a raw PATCH /api/users/:id with the page-owned setPmUsers/setAdminUsers.
// Render-gating ({roleFilter !== 'rep'}) is the page's.

import Link from 'next/link';
import { Search, UserCog, Trash2 } from 'lucide-react';
import RowActionsMenu from '../../components/RowActionsMenu';
import { InactiveExpander } from './InactiveExpander';
import { ROLE_LABELS, type SimpleUser } from './role-meta';
import type { Dispatch, SetStateAction } from 'react';
import type { Rep, SubDealer } from '../../../../lib/data';

export interface ConfirmActionPayload {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export function UnifiedDirectory({ roleFilter, search, setSearch, debouncedSearch, extraUsersReady, canManageReps, data, inactive, toggles, actions, toast }: {
  roleFilter: string;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  debouncedSearch: string;
  extraUsersReady: boolean;
  canManageReps: boolean;
  data: {
    reps: Rep[];
    subDealers: SubDealer[];
    pmUsers: SimpleUser[];
    adminUsers: SimpleUser[];
    setPmUsers: Dispatch<SetStateAction<SimpleUser[]>>;
    setAdminUsers: Dispatch<SetStateAction<SimpleUser[]>>;
  };
  inactive: {
    inactiveReps: Rep[];
    inactiveSubDealers: SubDealer[];
    inactivePMs: SimpleUser[];
    inactiveAdmins: SimpleUser[];
  };
  toggles: {
    showInactive: boolean;
    setShowInactive: Dispatch<SetStateAction<boolean>>;
    showInactiveSubDealers: boolean;
    setShowInactiveSubDealers: Dispatch<SetStateAction<boolean>>;
    showInactivePMs: boolean;
    setShowInactivePMs: Dispatch<SetStateAction<boolean>>;
    showInactiveAdmins: boolean;
    setShowInactiveAdmins: Dispatch<SetStateAction<boolean>>;
    reactivatingId: string | null;
    setReactivatingId: Dispatch<SetStateAction<string | null>>;
    reactivatingSubDealerId: string | null;
    setReactivatingSubDealerId: Dispatch<SetStateAction<string | null>>;
    reactivatingPmId: string | null;
    setReactivatingPmId: Dispatch<SetStateAction<string | null>>;
    reactivatingAdminId: string | null;
    setReactivatingAdminId: Dispatch<SetStateAction<string | null>>;
  };
  actions: {
    setConfirmAction: (a: ConfirmActionPayload | null) => void;
    convertUserRole: (id: string, targetRole: 'rep' | 'sub-dealer') => Promise<void>;
    deactivateSubDealer: (id: string) => Promise<void>;
    reactivateSubDealer: (id: string) => Promise<void>;
    reactivateRep: (id: string) => Promise<void>;
  };
  toast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const { reps, subDealers, pmUsers, adminUsers, setPmUsers, setAdminUsers } = data;
  const { inactiveReps, inactiveSubDealers, inactivePMs, inactiveAdmins } = inactive;
  const { setConfirmAction, convertUserRole, deactivateSubDealer, reactivateSubDealer, reactivateRep } = actions;
  const {
    showInactive, setShowInactive, showInactiveSubDealers, setShowInactiveSubDealers,
    showInactivePMs, setShowInactivePMs, showInactiveAdmins, setShowInactiveAdmins,
    reactivatingId, setReactivatingId, reactivatingSubDealerId, setReactivatingSubDealerId,
    reactivatingPmId, setReactivatingPmId, reactivatingAdminId, setReactivatingAdminId,
  } = toggles;
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
          rep:              { label: 'Rep',              color: 'var(--accent-emerald-text)', bg: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)' },
          'sub-dealer':     { label: 'Sub-Dealer',       color: 'var(--accent-purple-text)', bg: 'var(--accent-purple-soft)' },
          project_manager:  { label: 'Project Manager',  color: 'var(--accent-cyan-text)', bg: 'color-mix(in srgb, var(--accent-cyan-solid) 12%, transparent)' },
          admin:            { label: 'Admin',            color: 'var(--accent-amber-text)', bg: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)' },
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
                className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]/50 placeholder-[var(--text-dim)]"
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
                  const badge = roleBadge[u.role] ?? { label: u.role, color: 'var(--text-muted)', bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)' };
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
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{u.firstName} {u.lastName}</p>
                        {u.email && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{u.email}</p>}
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                      {canManageReps && u.role === 'sub-dealer' && (
                        <RowActionsMenu
                          ariaLabel={`Actions for ${u.firstName} ${u.lastName}`}
                          actions={[
                            {
                              label: 'Convert to Rep',
                              icon: UserCog,
                              onSelect: () => setConfirmAction({ title: `Convert ${u.firstName} ${u.lastName} to Rep?`, message: `${u.firstName} ${u.lastName} will move to the Reps list with rep login and permission defaults. Deals, payroll history, commission records, and their Clerk login remain unchanged.`, confirmLabel: 'Convert', onConfirm: async () => { setConfirmAction(null); try { await convertUserRole(u.id, 'rep'); toast(`${u.firstName} ${u.lastName} converted to Rep`, 'success'); } catch { /* error toast shown by persistFetch */ } } }),
                            },
                            {
                              label: 'Deactivate sub-dealer',
                              icon: Trash2,
                              danger: true,
                              onSelect: () => setConfirmAction({ title: `Deactivate ${u.firstName} ${u.lastName}?`, message: 'They will lose app access immediately. You can reactivate them later.', onConfirm: async () => { setConfirmAction(null); try { await deactivateSubDealer(u.id); toast(`${u.firstName} ${u.lastName} deactivated`, 'success'); } catch { /* error toast shown by persistFetch */ } } }),
                            },
                          ]}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            )}

            {/* ── Inactive reps expander ──────────────────────────────── */}
            {canManageReps && roleFilter === 'all' && inactiveReps.length > 0 && (
              <InactiveExpander label="Show inactive reps" count={inactiveReps.length} isOpen={showInactive} onToggle={() => setShowInactive((v) => !v)}>
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
                      onClick={() => setConfirmAction({
                        title: `Reactivate ${rep.name}?`,
                        message: 'They will regain app access immediately.',
                        confirmLabel: 'Reactivate',
                        onConfirm: async () => {
                          setConfirmAction(null);
                          setReactivatingId(rep.id);
                          try {
                            await reactivateRep(rep.id);
                            toast(`${rep.name} reactivated`, 'success');
                          } catch {
                            toast('Failed to reactivate rep', 'error');
                          } finally {
                            setReactivatingId(null);
                          }
                        },
                      })}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-text)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)' }}
                    >
                      {reactivatingId === rep.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </InactiveExpander>
            )}

            {/* ── Inactive sub-dealers expander ───────────────────────── */}
            {canManageReps && (roleFilter === 'sub-dealer' || roleFilter === 'all') && inactiveSubDealers.length > 0 && (
              <InactiveExpander label="Show inactive sub-dealers" count={inactiveSubDealers.length} isOpen={showInactiveSubDealers} onToggle={() => setShowInactiveSubDealers((v) => !v)}>
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
                      onClick={() => setConfirmAction({
                        title: `Reactivate ${sd.firstName} ${sd.lastName}?`,
                        message: 'They will regain app access immediately.',
                        confirmLabel: 'Reactivate',
                        onConfirm: async () => {
                          setConfirmAction(null);
                          setReactivatingSubDealerId(sd.id);
                          try {
                            await reactivateSubDealer(sd.id);
                            toast(`${sd.firstName} ${sd.lastName} reactivated`, 'success');
                          } catch {
                            toast('Failed to reactivate sub-dealer', 'error');
                          } finally {
                            setReactivatingSubDealerId(null);
                          }
                        },
                      })}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'var(--accent-purple-soft)', color: 'var(--accent-purple-text)', border: '1px solid color-mix(in srgb, var(--accent-purple-solid) 30%, transparent)' }}
                    >
                      {reactivatingSubDealerId === sd.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </InactiveExpander>
            )}

            {/* ── Inactive PMs expander ───────────────────────────────── */}
            {canManageReps && (roleFilter === 'project_manager' || roleFilter === 'all') && inactivePMs.length > 0 && (
              <InactiveExpander label="Show inactive project managers" count={inactivePMs.length} isOpen={showInactivePMs} onToggle={() => setShowInactivePMs((v) => !v)}>
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
                      onClick={() => setConfirmAction({
                        title: `Reactivate ${u.firstName} ${u.lastName}?`,
                        message: 'They will regain app access immediately.',
                        confirmLabel: 'Reactivate',
                        onConfirm: async () => {
                          setConfirmAction(null);
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
                        },
                      })}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'color-mix(in srgb, var(--accent-cyan-solid) 12%, transparent)', color: 'var(--accent-cyan-text)', border: '1px solid color-mix(in srgb, var(--accent-cyan-solid) 30%, transparent)' }}
                    >
                      {reactivatingPmId === u.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </InactiveExpander>
            )}

            {/* ── Inactive admins expander ─────────────────────────────── */}
            {canManageReps && (roleFilter === 'admin' || roleFilter === 'all') && inactiveAdmins.length > 0 && (
              <InactiveExpander label="Show inactive admins" count={inactiveAdmins.length} isOpen={showInactiveAdmins} onToggle={() => setShowInactiveAdmins((v) => !v)}>
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
                      onClick={() => setConfirmAction({
                        title: `Reactivate ${u.firstName} ${u.lastName}?`,
                        message: 'They will regain app access immediately.',
                        confirmLabel: 'Reactivate',
                        onConfirm: async () => {
                          setConfirmAction(null);
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
                        },
                      })}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)' }}
                    >
                      {reactivatingAdminId === u.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </InactiveExpander>
            )}
          </div>
        );
}
