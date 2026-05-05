'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate, formatCompactKW, todayLocalDateStr } from '../../../lib/utils';
import { ArrowLeft, FolderKanban, DollarSign, Settings, Pencil, UserCog, UserX, UserCheck, Mail, UserPlus, Trash2, CheckSquare, Square, Check, X, Plus } from 'lucide-react';
import { getTrainerOverrideRate, TrainerOverrideTier } from '../../../lib/data';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_AMOUNT_COLORS: Record<string, string> = {
  Paid: 'var(--accent-emerald-solid)',
  Pending: 'var(--accent-amber-solid)',
  Draft: 'var(--text-muted)',
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
  scopedInstallerId?: string | null;
};

export default function MobileRepDetail({ repId }: { repId: string }) {
  const router = useRouter();
  const {
    projects,
    payrollEntries,
    effectiveRole,
    reps,
    subDealers,
    trainerAssignments,
    setTrainerAssignments,
    updateRepContact,
    updateSubDealerContact,
    updateRepType,
    deactivateRep,
    reactivateRep,
    deactivateSubDealer,
    reactivateSubDealer,
    convertUserRole,
    deleteRepPermanently,
    deleteSubDealerPermanently,
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
  const [confirmConvert, setConfirmConvert] = useState<{ targetRole: 'rep' | 'sub-dealer'; targetLabel: string; msg: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTrainerPicker, setShowTrainerPicker] = useState(false);
  const [editingTiers, setEditingTiers] = useState(false);
  const [draftTiers, setDraftTiers] = useState<TrainerOverrideTier[]>([]);
  const [tierSaving, setTierSaving] = useState(false);

  let rep = reps.find((r) => r.id === repId);
  const subDealer = !rep ? subDealers.find((s) => s.id === repId) : null;
  const [fetchedUser, setFetchedUser] = useState<MobileFetchedUser | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  // userMeta carries Clerk + invitation + relation-count info that the
  // rep-only API response doesn't include. Admin needs this to gate the
  // Invite button (don't offer if account already exists), show pending
  // invitation age, and safely delete-permanently (zero relations only).
  const [userMeta, setUserMeta] = useState<{ hasClerkAccount: boolean; pendingInvitation: { id: string; createdAt: number } | null; relationCount: number } | null>(null);
  // Vendor-PM installer scope (admin viewing a PM).
  const [installerList, setInstallerList] = useState<Array<{ id: string; name: string; active: boolean }>>([]);
  const [scopedInstallerId, setScopedInstallerIdState] = useState<string | null>(null);
  const [scopeSaving, setScopeSaving] = useState(false);

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
        if (data) {
          setFetchedUser(data);
          if (data.role === 'project_manager') {
            setScopedInstallerIdState(data.scopedInstallerId ?? null);
          }
        } else setLookupFailed(true);
      })
      .catch(() => setLookupFailed(true));
  }, [repId, rep, subDealer]);

  // Admin viewing a PM: load installer list for the scope dropdown.
  useEffect(() => {
    if (effectiveRole !== 'admin') return;
    const role = fetchedUser?.role ?? rep?.role ?? subDealer?.role ?? '';
    if (role !== 'project_manager') return;
    if (installerList.length > 0) return;
    fetch('/api/installers')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) setInstallerList(data.filter((i) => i.active));
      })
      .catch(() => { /* non-fatal */ });
  }, [effectiveRole, fetchedUser, rep, subDealer, installerList.length]);

  const saveScope = async (next: string) => {
    if (scopeSaving) return;
    setScopeSaving(true);
    const prev = scopedInstallerId;
    const nextValue = next || null;
    setScopedInstallerIdState(nextValue);
    try {
      const res = await fetch(`/api/users/${repId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopedInstallerId: next || '' }),
      });
      if (!res.ok) {
        setScopedInstallerIdState(prev);
        toast('Failed to update scope', 'error');
      } else {
        setFetchedUser((p) => p ? { ...p, scopedInstallerId: nextValue } : p);
        toast(nextValue ? 'Scoped to installer' : 'Full access', 'success');
      }
    } finally {
      setScopeSaving(false);
    }
  };

  // Resolve to whichever source succeeded.
  const resolvedUser = rep
    ? { ...rep, role: rep.role as string }
    : subDealer
    ? { ...subDealer, role: 'sub-dealer' as string, repType: 'both' as string }
    : fetchedUser;

  if (!hydrated) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--surface-card)' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-card)' }} />
        <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--surface-card)', opacity: 0.6 }} />
      </div>
    );
  }

  if (effectiveRole !== 'admin' && effectiveRole !== 'project_manager' && repId !== undefined) {
    // Permission check handled by desktop page, but guard here too
  }

  // Still fetching — show skeleton
  if (!resolvedUser && !lookupFailed) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--surface-card)' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-card)' }} />
      </div>
    );
  }

  if (!resolvedUser) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/users')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Users
        </button>
        <p className="text-base text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>User not found.</p>
      </div>
    );
  }

  // ─── Early branch: admin / project_manager / sub-dealer → simple detail card ───
  if (resolvedUser.role === 'admin' || resolvedUser.role === 'project_manager' || resolvedUser.role === 'sub-dealer') {
    const roleLabel =
      resolvedUser.role === 'admin' ? 'Admin'
      : resolvedUser.role === 'project_manager' ? 'Project Manager'
      : 'Sub-Dealer';
    const badgeColor =
      resolvedUser.role === 'admin' ? 'var(--accent-amber-solid)'
      : resolvedUser.role === 'project_manager' ? 'var(--accent-cyan-solid)'
      : 'var(--accent-purple-solid)';
    const badgeBg =
      resolvedUser.role === 'admin' ? 'var(--accent-amber-soft)'
      : resolvedUser.role === 'project_manager' ? 'color-mix(in srgb, var(--accent-cyan-solid) 12%, transparent)'
      : 'var(--accent-purple-soft)';
    const initials = `${resolvedUser.firstName[0] ?? ''}${resolvedUser.lastName[0] ?? ''}`.toUpperCase();
    const fu = fetchedUser; // PM permission flags only available from fetched payload

    return (
      <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/users')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Users
        </button>

        <div className="rounded-2xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${badgeColor}` }}>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black shrink-0" style={{ background: badgeBg, color: badgeColor }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                {resolvedUser.firstName} {resolvedUser.lastName}
              </h1>
              <div className="mt-1.5">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: badgeBg, color: badgeColor }}>
                  {roleLabel}
                </span>
              </div>
              {resolvedUser.email && <p className="text-sm mt-2 truncate" style={{ color: 'var(--text-muted)' }}>{resolvedUser.email}</p>}
              {resolvedUser.phone && <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{resolvedUser.phone}</p>}
            </div>
          </div>
        </div>

        {resolvedUser.role === 'admin' && effectiveRole === 'admin' && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>Sales</p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Set if this admin also sells deals — they&apos;ll appear in closer/setter pickers and get a My Pay tab.
            </p>
            <select
              value={resolvedUser.repType ?? ''}
              onChange={async (e) => {
                const newRepType = e.target.value === '' ? null : e.target.value;
                try {
                  const res = await fetch(`/api/users/${repId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repType: newRepType }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error ?? 'Failed to save');
                  }
                  setFetchedUser((prev) => prev ? { ...prev, repType: newRepType ?? '' } : prev);
                  if (rep && newRepType) updateRepType(repId, newRepType as 'closer' | 'setter' | 'both');
                  toast(newRepType ? `Saved — now appears as a ${newRepType}` : 'Saved — pure-admin mode', 'success');
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Failed to save', 'error');
                }
              }}
              className="w-full rounded-xl px-3 py-3 text-base focus:outline-none"
              style={{
                background: 'var(--navy-base, #0a1628)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              <option value="">Not a seller (admin-only)</option>
              <option value="closer">Closer</option>
              <option value="setter">Setter</option>
              <option value="both">Both</option>
            </select>
          </div>
        )}

        {resolvedUser.role === 'project_manager' && fu && effectiveRole === 'admin' && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>Permissions</p>
            <div className="flex flex-wrap gap-2">
              {([
                { field: 'canCreateDeals' as const, label: 'Create Deals' },
                { field: 'canAccessBlitz' as const, label: 'Blitz Access' },
                { field: 'canExport' as const, label: 'Export Data' },
              ]).map(({ field, label }) => (
                <button
                  key={field}
                  onClick={async () => {
                    const current = !!fu[field];
                    const res = await fetch(`/api/users/${repId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ [field]: !current }),
                    });
                    if (res.ok) {
                      setFetchedUser((prev) => prev ? { ...prev, [field]: !current } : prev);
                      toast('Permission updated');
                    } else {
                      toast('Failed to update permission', 'error');
                    }
                  }}
                  className="flex items-center gap-1.5 text-base px-3 py-2.5 rounded-xl border transition-colors min-h-[44px] active:scale-[0.95] transition-transform duration-100"
                  style={{
                    background: fu[field] ? 'var(--accent-emerald-soft)' : 'var(--surface-card)',
                    color: fu[field] ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                    borderColor: fu[field] ? 'var(--accent-emerald-glow)' : 'var(--border-subtle)',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {fu[field] ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {label}
                </button>
              ))}
            </div>

            {/* Installer scope — mirrors desktop user detail page */}
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>
                Installer scope
              </p>
              <select
                value={scopedInstallerId ?? ''}
                onChange={(e) => saveScope(e.target.value)}
                disabled={scopeSaving}
                className="w-full rounded-xl px-3 py-3 text-base focus:outline-none disabled:opacity-50"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--m-text, var(--text-mobile))',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                <option value="">— Full access (internal PM) —</option>
                {installerList.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              {scopedInstallerId && (
                <p className="text-[11px] mt-2 text-[var(--accent-amber-text)]">
                  Vendor PM — installer-scoped, ops-only.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Below this point, role is 'rep'. Reassign rep so the
  // existing rep-detail JSX (which reads rep.name + rep.email) works for
  // freshly-fetched users too.
  if (!rep) {
    rep = resolvedUser as unknown as typeof rep;
  }
  if (!rep) return null;

  const repProjects = projects.filter((p) => p.repId === repId || p.setterId === repId || p.additionalClosers?.some((c) => c.userId === repId) || p.additionalSetters?.some((c) => c.userId === repId));
  const repPayroll = payrollEntries.filter((p) => p.repId === repId);
  const trainerAssignment = trainerAssignments.find((a) => a.traineeId === repId);
  const trainerRep = trainerAssignment ? reps.find((r) => r.id === trainerAssignment.trainerId) : null;
  const completedDeals = repProjects.filter((p) => p.phase === 'Installed' || p.phase === 'PTO' || p.phase === 'Completed').length;
  const currentOverrideRate = trainerAssignment ? getTrainerOverrideRate(trainerAssignment, completedDeals) : 0;
  const activeProjects = repProjects.filter((p) => !['Cancelled', 'On Hold', 'Completed'].includes(p.phase));
  const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);
  const todayStr = todayLocalDateStr();
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
    const updates = {
      firstName: editFirst.trim(),
      lastName: editLast.trim(),
      email: editEmail.trim(),
      phone: editPhone.trim(),
    };
    if (!updates.firstName || !updates.lastName) {
      toast('First and last name are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const endpoint = isSubDealer ? `/api/users/${repId}` : `/api/reps/${repId}`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to update contact info');
      }
      if (isSubDealer) {
        updateSubDealerContact(repId, updates, true);
      } else {
        updateRepContact(repId, updates, true);
      }
      toast('Contact info updated', 'success');
      setEditMode(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update contact info', 'error');
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
  const convertRole = () => {
    if (busy) return;
    const targetRole: 'rep' | 'sub-dealer' = isSubDealer ? 'rep' : 'sub-dealer';
    const targetLabel = targetRole === 'sub-dealer' ? 'Sub-Dealer' : 'Rep';
    const msg = `Convert ${resolvedUser.firstName} ${resolvedUser.lastName} to ${targetLabel}?\n\nDeals, payroll history, commission records, and their Clerk login remain unchanged. The user moves to the ${targetLabel}s list with that role's login + permission defaults.`;
    setConfirmConvert({ targetRole, targetLabel, msg });
  };

  const doConvert = async () => {
    if (!confirmConvert) return;
    const { targetRole, targetLabel } = confirmConvert;
    setConfirmConvert(null);
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
      const res = await fetch(`/api/users/${repId}/invite`, {
        method: 'POST',
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

  const handleDeletePermanently = async () => {
    let result: { success: boolean; error?: string };
    if (isSubDealer) {
      result = await deleteSubDealerPermanently(repId);
    } else {
      result = await deleteRepPermanently(repId);
    }
    if (result.success) {
      toast(`${resolvedUser.firstName} ${resolvedUser.lastName} permanently deleted`, 'success');
      router.push('/dashboard/users');
    } else {
      toast(result.error ?? 'Failed to delete', 'error');
    }
  };

  return (
    <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/users')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Reps
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{rep.name}</h1>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <MobileBadge value={repType} variant="status" />
            {isSubDealer && <MobileBadge value="Sub-Dealer" variant="status" />}
            {resolvedUser.active === false && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', color: 'var(--text-muted)' }}>
                Inactive
              </span>
            )}
          </div>
          <p className="text-base mt-1 truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
          {resolvedUser.phone && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{resolvedUser.phone}</p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setActionSheetOpen(true)}
            className="shrink-0 min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-sm font-semibold"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--accent-emerald-text)',
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
      <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{repProjects.filter(p => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length}</span> deal{repProjects.filter(p => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length !== 1 ? 's' : ''}
        {' \u00B7 '}
        <span className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCompactKW(totalKW)}</span>
        {!isPM && (
          <>
            {' \u00B7 '}
            <span className="text-lg font-bold" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${totalPaid.toLocaleString()}</span> paid
          </>
        )}
      </p>

      {/* Trainer Assignment — admin only */}
      {isAdmin && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" style={{ color: 'var(--accent-amber, #f5a623)' }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Trainer Assignment</span>
            </div>
            {!trainerAssignment && !showTrainerPicker && (
              <button
                onClick={() => setShowTrainerPicker(true)}
                className="text-sm font-medium min-h-[36px] px-2"
                style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                + Assign
              </button>
            )}
          </div>

          {trainerAssignment && (
            <div className="py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)', color: 'var(--accent-amber, #f5a623)' }}>
                    {trainerRep ? trainerRep.name.split(' ').map((n: string) => n[0]).join('') : '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {trainerRep ? trainerRep.name : 'Unknown trainer'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      ${currentOverrideRate.toFixed(2)}/W override rate
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!editingTiers && (
                    <button
                      onClick={() => { setDraftTiers([...trainerAssignment.tiers]); setEditingTiers(true); }}
                      className="flex items-center gap-1 text-xs min-h-[36px] px-2"
                      style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  {!editingTiers && (
                    <button
                      onClick={() => {
                        const snapshot = trainerAssignment;
                        const snapshotIndex = trainerAssignments.findIndex((a) => a.id === snapshot.id);
                        setTrainerAssignments((prev) => prev.filter((a) => a.id !== snapshot.id));
                        fetch('/api/trainer-assignments', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: snapshot.id }),
                        }).then((res) => {
                          if (!res.ok) throw new Error();
                        }).catch(() => {
                          setTrainerAssignments((prev) => {
                            const next = [...prev];
                            const idx = snapshotIndex >= 0 ? snapshotIndex : next.length;
                            next.splice(idx, 0, snapshot);
                            return next;
                          });
                          toast('Failed to remove trainer assignment', 'error');
                        });
                      }}
                      className="flex items-center gap-1 text-xs min-h-[36px] px-2"
                      style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </div>
              </div>

              {editingTiers && (
                <div className="mt-3 space-y-2">
                  {draftTiers.map((tier, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--surface-page)', border: '1px solid var(--border-subtle)' }}>
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>T{i + 1}</span>
                      <div className="flex items-center gap-1 flex-1">
                        <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Up to</span>
                        <input
                          type="number"
                          min="1"
                          placeholder="∞"
                          value={tier.upToDeal ?? ''}
                          disabled={i === draftTiers.length - 1}
                          onChange={(e) => setDraftTiers((prev) => prev.map((t, j) => j !== i ? t : { ...t, upToDeal: e.target.value === '' ? null : parseInt(e.target.value) || null }))}
                          className="w-14 rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none disabled:opacity-40"
                          style={{ background: 'var(--border-default)', border: '1px solid var(--border-subtle)' }}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={tier.ratePerW}
                          onChange={(e) => setDraftTiers((prev) => prev.map((t, j) => j !== i ? t : { ...t, ratePerW: parseFloat(e.target.value) || 0 }))}
                          className="w-16 rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
                          style={{ background: 'var(--border-default)', border: '1px solid var(--border-subtle)' }}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>/W</span>
                      </div>
                      <button
                        disabled={draftTiers.length <= 1}
                        onClick={() => setDraftTiers((prev) => {
                          const next = prev.filter((_, j) => j !== i);
                          if (next[next.length - 1].upToDeal !== null) {
                            next[next.length - 1] = { ...next[next.length - 1], upToDeal: null };
                          }
                          return next;
                        })}
                        className="disabled:opacity-30"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setDraftTiers((prev) => {
                      const updated = prev.map((t, i) => i === prev.length - 1 && t.upToDeal === null ? { ...t, upToDeal: completedDeals + 10 } : t);
                      return [...updated, { upToDeal: null, ratePerW: 0.05 }];
                    })}
                    className="flex items-center gap-1 text-xs min-h-[36px]"
                    style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add tier
                  </button>
                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={tierSaving}
                      onClick={async () => {
                        if (tierSaving) return;
                        setTierSaving(true);
                        try {
                          const res = await fetch('/api/trainer-assignments', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: trainerAssignment.id, tiers: draftTiers }),
                          });
                          if (!res.ok) { toast('Failed to save tiers', 'error'); return; }
                          setTrainerAssignments((prev) => prev.map((a) => a.id === trainerAssignment.id ? { ...a, tiers: draftTiers } : a));
                          setEditingTiers(false);
                          toast('Trainer tiers updated');
                        } finally {
                          setTierSaving(false);
                        }
                      }}
                      className="flex items-center gap-1 text-xs min-h-[36px] px-3 rounded-xl font-semibold disabled:opacity-50"
                      style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)', color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Check className="w-3.5 h-3.5" /> {tierSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditingTiers(false); setDraftTiers([]); }}
                      className="flex items-center gap-1 text-xs min-h-[36px] px-3 rounded-xl"
                      style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!trainerAssignment && showTrainerPicker && (
            <div className="mt-1 space-y-2">
              <select
                className="w-full min-h-[44px] rounded-xl px-3 text-base text-[var(--text-primary)] outline-none"
                style={{
                  background: 'var(--navy-base, #0a1628)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
                defaultValue=""
                onChange={(e) => {
                  const trainerId = e.target.value;
                  if (!trainerId) return;
                  const tempId = `ta_${Date.now()}`;
                  setTrainerAssignments((prev) => [
                    ...prev,
                    { id: tempId, trainerId, traineeId: repId, tiers: [{ upToDeal: null, ratePerW: 0.05 }] },
                  ]);
                  setShowTrainerPicker(false);
                  fetch('/api/trainer-assignments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trainerId, traineeId: repId, tiers: [{ upToDeal: null, ratePerW: 0.05 }] }),
                  })
                    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
                    .then((saved) => {
                      setTrainerAssignments((prev) =>
                        prev.map((a) =>
                          a.id === tempId
                            ? { id: saved.id, trainerId: saved.trainerId, traineeId: saved.traineeId, tiers: (saved.tiers ?? []).map((t: { upToDeal: number | null; ratePerW: number }) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })) }
                            : a
                        )
                      );
                    })
                    .catch(() => {
                      setTrainerAssignments((prev) => prev.filter((a) => a.id !== tempId));
                      toast('Failed to assign trainer', 'error');
                    });
                }}
              >
                <option value="">— Select trainer —</option>
                {reps.filter((r) => r.active !== false && r.id !== repId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowTrainerPicker(false)}
                className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-[var(--text-primary)]"
                style={{ background: 'var(--border-subtle)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                Cancel
              </button>
            </div>
          )}

          {!trainerAssignment && !showTrainerPicker && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>No trainer assigned.</p>
          )}
        </div>
      )}

      {/* Active Projects */}
      <MobileSection title="Active Projects" count={activeProjects.length}>
        {activeProjects.length === 0 ? (
          <MobileEmptyState icon={FolderKanban} title="No active projects" />
        ) : (
          <div className="rounded-2xl divide-y" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderColor: 'var(--border-subtle)' }}>
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
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.customerName || entry.notes || '\u2014'}
                    </p>
                    <p className="text-base mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.paymentStage} &middot; {formatDate(entry.date)}
                    </p>
                  </div>
                  <span
                    className="text-lg font-bold tabular-nums ml-3"
                    style={{
                      color: STATUS_AMOUNT_COLORS[entry.status] ?? 'var(--text-muted)',
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
                <p className="text-xs uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--text-dim)' }}>Rep Type</p>
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
                          background: active ? 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))' : 'var(--surface-card)',
                          color: active ? 'var(--surface-page)' : 'var(--text-muted)',
                          border: active ? 'none' : '1px solid var(--border-subtle)',
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

            {/* Hard delete — only shown when user has zero related records */}
            {userMeta && userMeta.relationCount === 0 && (
              <MobileBottomSheet.Item
                label="Permanently delete"
                icon={Trash2}
                onTap={() => { setActionSheetOpen(false); setConfirmDelete(true); }}
                danger
              />
            )}
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
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>First name</label>
                <input
                  type="text"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] outline-none"
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>Last name</label>
                <input
                  type="text"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] outline-none"
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] outline-none"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>Phone</label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] outline-none"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={saveContact}
                disabled={saving}
                className="flex-1 min-h-[48px] rounded-xl text-sm font-semibold"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
                  color: 'var(--text-on-accent)',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditMode(false)}
                className="flex-1 min-h-[48px] rounded-xl text-sm font-semibold text-[var(--text-primary)]"
                style={{ background: 'var(--border-subtle)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </MobileBottomSheet>
      )}

      <ConfirmDialog
        open={!!confirmConvert}
        title="Convert Role"
        message={confirmConvert?.msg ?? ''}
        confirmLabel="Convert"
        onConfirm={doConvert}
        onClose={() => setConfirmConvert(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Permanently delete user"
        message={`PERMANENTLY delete ${resolvedUser.firstName} ${resolvedUser.lastName}? This cannot be undone. Their Clerk account will also be removed.`}
        confirmLabel="Delete permanently"
        danger
        onConfirm={() => { setConfirmDelete(false); handleDeletePermanently(); }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
