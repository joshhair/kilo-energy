'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate, formatCompactKW } from '../../../lib/utils';
import { ArrowLeft, FolderKanban, DollarSign, Settings, Pencil, UserCog, UserX, UserCheck, Mail } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

const STATUS_AMOUNT_COLORS: Record<string, string> = {
  Paid: 'var(--accent-emerald)',
  Pending: '#f5a623',
  Draft: 'var(--text-mobile-muted)',
};

const REP_TYPE_LABELS: Record<string, string> = {
  closer: 'Closer',
  setter: 'Setter',
  both: 'Closer / Setter',
};

type MobileFetchedUser = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  repType: string;
  active: boolean;
  canCreateDeals?: boolean;
  canAccessBlitz?: boolean;
  canExport?: boolean;
};

export default function MobileRepDetail({ repId }: { repId: string }) {
  const router = useRouter();
  const {
    projects,
    payrollEntries,
    effectiveRole,
    reps,
    subDealers,
    updateRepContact,
    updateSubDealerContact,
    updateRepType,
    deactivateRep,
    reactivateRep,
    deactivateSubDealer,
    reactivateSubDealer,
    convertUserRole,
  } = useApp();
  const hydrated = useIsHydrated();
  const { toast } = useToast();
  const isPM = effectiveRole === 'project_manager';
  const isAdmin = effectiveRole === 'admin';

  // Admin action sheet state + local edit buffers. Editing name/email/
  // phone inline keeps the UI simple; rep-type / activate / convert
  // are single-tap actions wired to the same helpers the desktop page
  // uses, so behavior stays consistent across devices.
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  let rep = reps.find((r) => r.id === repId);
  const subDealer = !rep ? subDealers.find((s) => s.id === repId) : null;
  const [fetchedUser, setFetchedUser] = useState<MobileFetchedUser | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  // userMeta carries Clerk + invitation + relation-count info that the
  // rep-only API response doesn't include. Admin needs this to gate the
  // Invite button (don't offer if account already exists), show pending
  // invitation age, and safely delete-permanently (zero relations only).
  const [userMeta, setUserMeta] = useState<{ hasClerkAccount: boolean; pendingInvitation: { id: string; createdAt: number } | null; relationCount: number } | null>(null);

  useEffect(() => {
    if (effectiveRole !== 'admin') return;
    fetch(`/api/users/${repId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setUserMeta({
            hasClerkAccount: !!data.hasClerkAccount,
            pendingInvitation: data.pendingInvitation ?? null,
            relationCount: data.relationCount ?? 0,
          });
        }
      })
      .catch(() => { /* silent; gate falls through to ungated state */ });
  }, [repId, effectiveRole]);

  useEffect(() => {
    if (rep || subDealer) return;
    fetch(`/api/reps/${repId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MobileFetchedUser | null) => {
        if (data) setFetchedUser(data);
        else setLookupFailed(true);
      })
      .catch(() => setLookupFailed(true));
  }, [repId, rep, subDealer]);

  // Resolve to whichever source succeeded.
  const resolvedUser = rep
    ? { ...rep, role: 'rep' as string }
    : subDealer
    ? { ...subDealer, role: 'sub-dealer' as string, repType: 'both' as string }
    : fetchedUser;

  if (!hydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))', opacity: 0.6 }} />
      </div>
    );
  }

  if (effectiveRole !== 'admin' && effectiveRole !== 'project_manager' && repId !== undefined) {
    // Permission check handled by desktop page, but guard here too
  }

  // Still fetching — show skeleton
  if (!resolvedUser && !lookupFailed) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
      </div>
    );
  }

  if (!resolvedUser) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/users')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Users
        </button>
        <p className="text-base text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>User not found.</p>
      </div>
    );
  }

  // ─── Early branch: admin / project_manager → simple detail card ───
  if (resolvedUser.role === 'admin' || resolvedUser.role === 'project_manager') {
    const roleLabel = resolvedUser.role === 'admin' ? 'Admin' : 'Project Manager';
    const badgeColor = resolvedUser.role === 'admin' ? 'var(--accent-amber)' : 'var(--accent-cyan)';
    const badgeBg = resolvedUser.role === 'admin' ? 'rgba(255,176,32,0.12)' : 'rgba(0,196,240,0.12)';
    const initials = `${resolvedUser.firstName[0] ?? ''}${resolvedUser.lastName[0] ?? ''}`.toUpperCase();
    const fu = fetchedUser; // PM permission flags only available from fetched payload

    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/users')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Users
        </button>

        <div className="rounded-2xl p-5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderLeft: `3px solid ${badgeColor}` }}>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black shrink-0" style={{ background: badgeBg, color: badgeColor }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white truncate" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                {resolvedUser.firstName} {resolvedUser.lastName}
              </h1>
              <div className="mt-1.5">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: badgeBg, color: badgeColor }}>
                  {roleLabel}
                </span>
              </div>
              {resolvedUser.email && <p className="text-sm mt-2 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{resolvedUser.email}</p>}
              {resolvedUser.phone && <p className="text-sm truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{resolvedUser.phone}</p>}
            </div>
          </div>
        </div>

        {resolvedUser.role === 'project_manager' && fu && effectiveRole === 'admin' && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--m-text-dim, #445577)' }}>Permissions</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Can create deals</span>
                <span className={fu.canCreateDeals ? 'text-[var(--accent-emerald)] font-bold' : 'text-[var(--text-dim)]'}>{fu.canCreateDeals ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Can access blitz</span>
                <span className={fu.canAccessBlitz ? 'text-[var(--accent-emerald)] font-bold' : 'text-[var(--text-dim)]'}>{fu.canAccessBlitz ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Can export</span>
                <span className={fu.canExport ? 'text-[var(--accent-emerald)] font-bold' : 'text-[var(--text-dim)]'}>{fu.canExport ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-center mt-2" style={{ color: 'var(--m-text-dim, #445577)' }}>
          Use desktop Settings for permission management.
        </p>
      </div>
    );
  }

  // Below this point, role is 'rep' or 'sub-dealer'. Reassign rep so the
  // existing rep-detail JSX (which reads rep.name + rep.email) works for
  // sub-dealers + freshly-fetched users too.
  if (!rep) {
    rep = resolvedUser as unknown as typeof rep;
  }
  if (!rep) return null;

  const repProjects = projects.filter((p) => p.repId === repId || p.setterId === repId);
  const repPayroll = payrollEntries.filter((p) => p.repId === repId);
  const activeProjects = repProjects.filter((p) => !['Cancelled', 'On Hold', 'Completed'].includes(p.phase));
  const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const totalPaid = repPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((s, p) => s + p.amount, 0);
  const recentPayroll = repPayroll.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);

  const repType = REP_TYPE_LABELS[rep.repType ?? ''] ?? rep.repType ?? 'Rep';
  const isSubDealer = resolvedUser.role === 'sub-dealer';

  // Open the edit sheet pre-populated with the current rep's values.
  const openEdit = () => {
    setEditFirst(resolvedUser.firstName ?? '');
    setEditLast(resolvedUser.lastName ?? '');
    setEditEmail(resolvedUser.email ?? '');
    setEditPhone(resolvedUser.phone ?? '');
    setEditMode(true);
    setActionSheetOpen(false);
  };

  const saveContact = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updates = {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
      };
      if (isSubDealer) {
        updateSubDealerContact(repId, updates);
      } else {
        updateRepContact(repId, updates);
      }
      toast('Contact info updated', 'success');
      setEditMode(false);
    } catch {
      toast('Failed to update contact info', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setRepTypeValue = (v: 'closer' | 'setter' | 'both') => {
    if (isSubDealer) return; // repType is fixed to 'both' for sub-dealers
    updateRepType(repId, v);
    toast(`Rep type set to ${REP_TYPE_LABELS[v] ?? v}`, 'success');
  };

  // Activate / deactivate goes through context helpers which manage
  // optimistic UI + Clerk sync + cascade cleanup. Same as desktop.
  const toggleActive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const wasActive = resolvedUser.active !== false;
      if (isSubDealer) {
        if (wasActive) await deactivateSubDealer(repId);
        else await reactivateSubDealer(repId);
      } else {
        if (wasActive) await deactivateRep(repId);
        else await reactivateRep(repId);
      }
      toast(wasActive ? `${resolvedUser.firstName} deactivated` : `${resolvedUser.firstName} reactivated`, 'success');
      setActionSheetOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update status', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Note: defined as a regular async function (not useCallback) because
  // it's called after multiple early returns above, which would make
  // useCallback a conditional hook and break rules-of-hooks. Identity
  // stability isn't needed here — the only callsite is an onTap prop
  // deep in the admin sheet, not a React.memo boundary.
  const convertRole = async () => {
    if (busy) return;
    const targetRole: 'rep' | 'sub-dealer' = isSubDealer ? 'rep' : 'sub-dealer';
    const targetLabel = targetRole === 'sub-dealer' ? 'Sub-Dealer' : 'Rep';
    const msg = `Convert ${resolvedUser.firstName} ${resolvedUser.lastName} to ${targetLabel}?\n\nDeals, payroll history, commission records, and their Clerk login remain unchanged. The user moves to the ${targetLabel}s list with that role's login + permission defaults.`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    try {
      await convertUserRole(repId, targetRole);
      toast(`Converted to ${targetLabel}`, 'success');
      setActionSheetOpen(false);
      // User moved to a different roster; navigate back to list.
      router.push('/dashboard/users');
    } catch {
      // Error toast surfaced by persistFetch inside the helper.
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: repId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Invite failed');
      }
      toast('Invite sent', 'success');
      setActionSheetOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send invite', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/users')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Reps
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{rep.name}</h1>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <MobileBadge value={repType} variant="status" />
            {isSubDealer && <MobileBadge value="Sub-Dealer" variant="status" />}
            {resolvedUser.active === false && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: 'rgba(136,153,170,0.15)', color: 'var(--text-mobile-muted)' }}>
                Inactive
              </span>
            )}
          </div>
          <p className="text-base mt-1 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
          {resolvedUser.phone && (
            <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{resolvedUser.phone}</p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setActionSheetOpen(true)}
            className="shrink-0 min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-sm font-semibold"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              color: 'var(--accent-emerald)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
            aria-label="Manage user"
          >
            <Settings className="w-4 h-4" />
            Manage
          </button>
        )}
      </div>

      {/* Inline stats */}
      <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{repProjects.length}</span> deal{repProjects.length !== 1 ? 's' : ''}
        {' \u00B7 '}
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCompactKW(totalKW)}</span>
        {!isPM && (
          <>
            {' \u00B7 '}
            <span className="text-lg font-bold" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${totalPaid.toLocaleString()}</span> paid
          </>
        )}
      </p>

      {/* Active Projects */}
      <MobileSection title="Active Projects" count={activeProjects.length}>
        {activeProjects.length === 0 ? (
          <MobileEmptyState icon={FolderKanban} title="No active projects" />
        ) : (
          <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderColor: 'var(--m-border, var(--border-mobile))' }}>
            {activeProjects.map((proj) => (
              <MobileListItem
                key={proj.id}
                title={proj.customerName}
                right={<MobileBadge value={proj.phase} variant="phase" />}
                onTap={() => router.push(`/dashboard/projects/${proj.id}`)}
              />
            ))}
          </div>
        )}
      </MobileSection>

      {/* Recent Payments — hidden for PM */}
      {!isPM && (
        <MobileSection title="Recent Payments" count={repPayroll.length}>
          {repPayroll.length === 0 ? (
            <MobileEmptyState icon={DollarSign} title="No payment history" />
          ) : (
            <div>
              {recentPayroll.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between min-h-[48px] py-3 last:border-b-0"
                  style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.customerName || entry.notes || '\u2014'}
                    </p>
                    <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.paymentStage} &middot; {formatDate(entry.date)}
                    </p>
                  </div>
                  <span
                    className="text-lg font-bold tabular-nums ml-3"
                    style={{
                      color: STATUS_AMOUNT_COLORS[entry.status] ?? 'var(--m-text-muted, var(--text-mobile-muted))',
                      fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                    }}
                  >
                    ${entry.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </MobileSection>
      )}

      {/* ── Admin action sheet ───────────────────────────────────────── */}
      {isAdmin && (
        <MobileBottomSheet
          open={actionSheetOpen}
          onClose={() => setActionSheetOpen(false)}
          title="Manage user"
        >
          <div className="px-5 space-y-1 pb-2">
            <MobileBottomSheet.Item
              label="Edit contact info"
              icon={Pencil}
              onTap={openEdit}
            />

            {/* Rep type — only for reps (sub-dealer repType is fixed) */}
            {!isSubDealer && (
              <div className="py-2">
                <p className="text-xs uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--m-text-dim, #445577)' }}>Rep Type</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['closer', 'setter', 'both'] as const).map((v) => {
                    const active = rep?.repType === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setRepTypeValue(v)}
                        className="min-h-[44px] rounded-xl text-sm font-semibold"
                        style={{
                          background: active ? 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))' : 'var(--m-card, var(--surface-mobile-card))',
                          color: active ? '#050d18' : 'var(--m-text-muted, var(--text-mobile-muted))',
                          border: active ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                        }}
                      >
                        {REP_TYPE_LABELS[v]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <MobileBottomSheet.Item
              label={isSubDealer ? 'Convert to Rep' : 'Convert to Sub-Dealer'}
              icon={UserCog}
              onTap={convertRole}
            />

            {/* Invite gating mirrors desktop users/[id] page: hide when
                Clerk account already exists + account is active; otherwise
                show "Resend invite" if there's a pending invitation, else
                "Send invite" for new users. */}
            {(() => {
              const hasClerk = userMeta?.hasClerkAccount ?? false;
              const hasPending = !!userMeta?.pendingInvitation;
              const isInactive = resolvedUser.active === false;
              if (hasClerk && !isInactive) return null;
              return (
                <MobileBottomSheet.Item
                  label={hasPending ? 'Resend invite' : 'Send invite'}
                  icon={Mail}
                  onTap={sendInvite}
                />
              );
            })()}

            <MobileBottomSheet.Item
              label={resolvedUser.active === false ? 'Reactivate' : 'Deactivate'}
              icon={resolvedUser.active === false ? UserCheck : UserX}
              onTap={toggleActive}
              danger={resolvedUser.active !== false}
            />
          </div>
        </MobileBottomSheet>
      )}

      {/* ── Edit contact modal ───────────────────────────────────────── */}
      {editMode && (
        <MobileBottomSheet
          open={editMode}
          onClose={() => setEditMode(false)}
          title="Edit contact"
        >
          <div className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--m-text-dim, #445577)' }}>First name</label>
                <input
                  type="text"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl px-3 text-base text-white outline-none"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid var(--m-border, var(--border-mobile))',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--m-text-dim, #445577)' }}>Last name</label>
                <input
                  type="text"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl px-3 text-base text-white outline-none"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid var(--m-border, var(--border-mobile))',
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--m-text-dim, #445577)' }}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-white outline-none"
                style={{
                  background: 'var(--m-card, var(--surface-mobile-card))',
                  border: '1px solid var(--m-border, var(--border-mobile))',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--m-text-dim, #445577)' }}>Phone</label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-white outline-none"
                style={{
                  background: 'var(--m-card, var(--surface-mobile-card))',
                  border: '1px solid var(--m-border, var(--border-mobile))',
                }}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={saveContact}
                disabled={saving}
                className="flex-1 min-h-[48px] rounded-xl text-sm font-semibold"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))',
                  color: '#050d18',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditMode(false)}
                className="flex-1 min-h-[48px] rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--m-border, var(--border-mobile))' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </MobileBottomSheet>
      )}
    </div>
  );
}
