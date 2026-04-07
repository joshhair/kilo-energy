'use client';

import { use, useState, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileRepDetail from '../../mobile/MobileRepDetail';
import { getTrainerOverrideRate, TrainerOverrideTier } from '../../../../lib/data';
import { formatDate } from '../../../../lib/utils';
import { useToast } from '../../../../lib/toast';
import { PaginationBar } from '../../components/PaginationBar';
import { ChevronRight, ChevronLeft, Pencil, Check, X, Plus, Trash2, FolderKanban, UserCheck, UserPlus, TrendingUp, TrendingDown } from 'lucide-react';
import { RepSelector } from '../../components/RepSelector';
import { Sparkline } from '../../../../lib/sparkline';
import ConfirmDialog from '../../components/ConfirmDialog';

type FetchedUser = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  repType: string;
  active: boolean;
  hasClerkAccount?: boolean;
  canCreateDeals?: boolean;
  canAccessBlitz?: boolean;
  canExport?: boolean;
};

// Admin-only metadata about a user — fetched separately from /api/users/[id]
// to power the action footer (deactivate, send/resend invite, hard delete).
type UserMeta = {
  relationCount: number;
  pendingInvitation: { id: string; createdAt: number } | null;
  hasClerkAccount: boolean;
  active: boolean;
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projects, payrollEntries, trainerAssignments, setTrainerAssignments, currentRole, effectiveRole, currentRepId, reps, subDealers, deactivateRep, reactivateRep, deleteRepPermanently, deactivateSubDealer, reactivateSubDealer, deleteSubDealerPermanently, updateRepContact, updateSubDealerContact } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const hydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { toast } = useToast();
  const router = useRouter();

  // Pagination state — payment history
  const [payPage, setPayPage] = useState(1);
  const [payPageSize, setPayPageSize] = useState(10);
  // Pagination state — projects
  const [projPage, setProjPage] = useState(1);
  const [projPageSize, setProjPageSize] = useState(10);
  // Trainer assignment picker state
  const [showTrainerPicker, setShowTrainerPicker] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Admin-only metadata for the action footer ─────────────────────────
  // The /api/users/[id] route exposes relationCount + pendingInvitation
  // which the deactivate / send-invite / hard-delete buttons need to know
  // about. Only fetched when the viewer is an admin.
  const [userMeta, setUserMeta] = useState<UserMeta | null>(null);
  const [metaRefreshKey, setMetaRefreshKey] = useState(0);
  useEffect(() => {
    if (currentRole !== 'admin') return;
    fetch(`/api/users/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setUserMeta({
            relationCount: data.relationCount ?? 0,
            pendingInvitation: data.pendingInvitation ?? null,
            hasClerkAccount: !!data.hasClerkAccount,
            active: data.active ?? true,
          });
        }
      })
      .catch(() => {});
  }, [id, currentRole, metaRefreshKey]);

  // ── Edit-in-place state for contact info ───────────────────────────────
  // Admins can edit firstName/lastName/email/phone on any user. Editing
  // is gated to one field at a time to keep the UI compact. Saves PATCH
  // /api/users/[id] then refetches meta + shows a toast.
  const [editingField, setEditingField] = useState<'name' | 'email' | 'phone' | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // First try the app context — reps + sub-dealers are already hydrated there.
  // `rep` is `let` so we can reassign to a sub-dealer/fetched user before
  // falling through to the existing rep-detail JSX (which reads .name + .email).
  let rep = reps.find((r) => r.id === id);
  const subDealer = !rep ? subDealers.find((s) => s.id === id) : null;

  // For admin + project_manager users (which aren't in context), fetch by id.
  // Also used as a fallback when the context lookup fails for any reason.
  const [fetchedUser, setFetchedUser] = useState<FetchedUser | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  useEffect(() => {
    if (rep || subDealer) return; // found in context, no fetch needed
    fetch(`/api/reps/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FetchedUser | null) => {
        if (data) setFetchedUser(data);
        else setLookupFailed(true);
      })
      .catch(() => setLookupFailed(true));
  }, [id, rep, subDealer]);

  // Resolve the display user from whichever source succeeded.
  const resolvedUser =
    rep
      ? { ...rep, role: 'rep' as string, canCreateDeals: false, canAccessBlitz: false, canExport: false }
      : subDealer
      ? { ...subDealer, role: 'sub-dealer' as string, repType: 'both' as string, canCreateDeals: false, canAccessBlitz: false, canExport: false }
      : fetchedUser;

  const displayName = resolvedUser ? `${resolvedUser.firstName} ${resolvedUser.lastName}` : '';
  useEffect(() => { document.title = displayName ? `${displayName} | Kilo Energy` : 'User Detail | Kilo Energy'; }, [displayName]);

  if (!hydrated) return <RepDetailSkeleton />;

  if (isMobile) return <MobileRepDetail repId={id} />;

  if (currentRole !== 'admin' && currentRole !== 'project_manager' && id !== currentRepId) {
    return (
      <div className="p-8 text-center text-[#8891a8] text-sm">
        You don&apos;t have permission to view this page.
      </div>
    );
  }

  // Still fetching and nothing found in context yet — show skeleton.
  if (!resolvedUser && !lookupFailed) return <RepDetailSkeleton />;

  if (!resolvedUser) {
    return (
      <div className="p-8 text-[#8891a8] text-center">
        User not found.{' '}
        <Link href="/dashboard/users" className="text-[#00e07a] hover:underline">
          Back to Users
        </Link>
      </div>
    );
  }

  const isAdminViewer = currentRole === 'admin';
  const isInactive = userMeta ? !userMeta.active : (resolvedUser as { active?: boolean }).active === false;

  // ── Save handler for contact edits ────────────────────────────────────
  const startEdit = (field: 'name' | 'email' | 'phone') => {
    setEditFirstName(resolvedUser.firstName);
    setEditLastName(resolvedUser.lastName);
    setEditEmail(resolvedUser.email);
    setEditPhone(resolvedUser.phone);
    setEditingField(field);
  };
  const cancelEdit = () => setEditingField(null);
  const saveEdit = async () => {
    if (savingEdit || !editingField) return;
    setSavingEdit(true);
    const body: Record<string, string> = {};
    if (editingField === 'name') {
      if (!editFirstName.trim() || !editLastName.trim()) {
        toast('First and last name are required', 'error');
        setSavingEdit(false);
        return;
      }
      body.firstName = editFirstName.trim();
      body.lastName = editLastName.trim();
    } else if (editingField === 'email') {
      if (!editEmail.trim()) {
        toast('Email is required', 'error');
        setSavingEdit(false);
        return;
      }
      body.email = editEmail.trim();
    } else if (editingField === 'phone') {
      body.phone = editPhone.trim();
    }
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to save');
      }
      // Reflect the change locally — fetchedUser is the source for non-rep
      // profiles, and we trigger a meta refetch for everyone.
      if (fetchedUser) {
        setFetchedUser({ ...fetchedUser, ...body, name: `${body.firstName ?? fetchedUser.firstName} ${body.lastName ?? fetchedUser.lastName}` });
      }
      // Sync context so rep/sub-dealer profiles update immediately across the app.
      if (rep) updateRepContact(id, body);
      else if (subDealer) updateSubDealerContact(id, body);
      setMetaRefreshKey((k) => k + 1);
      toast('Saved', 'success');
      setEditingField(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Action footer handlers (deactivate / reactivate / invite / delete) ──
  const isRep = resolvedUser.role === 'rep';
  const isSubDealerRole = resolvedUser.role === 'sub-dealer';

  const handleDeactivate = async () => {
    try {
      if (isRep) {
        await deactivateRep(id);
      } else if (isSubDealerRole) {
        await deactivateSubDealer(id);
      } else {
        // Admin / PM — go directly to the API (not in context)
        const res = await fetch(`/api/users/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Failed to deactivate');
        }
      }
      setMetaRefreshKey((k) => k + 1);
      toast(`${resolvedUser.firstName} deactivated`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to deactivate', 'error');
    }
  };
  const handleReactivate = async () => {
    try {
      if (isRep) {
        await reactivateRep(id);
      } else if (isSubDealerRole) {
        await reactivateSubDealer(id);
      } else {
        const res = await fetch(`/api/users/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Failed to reactivate');
        }
      }
      setMetaRefreshKey((k) => k + 1);
      toast(`${resolvedUser.firstName} reactivated`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reactivate', 'error');
    }
  };
  const handleSendInvite = async () => {
    try {
      const res = await fetch(`/api/users/${id}/invite`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to send invite');
      }
      const data = await res.json();
      const wasResend = data.revokedCount > 0;
      toast(wasResend ? `Invitation resent to ${resolvedUser.email}` : `Invitation sent to ${resolvedUser.email}`, 'success');
      setMetaRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send invite', 'error');
    }
  };
  const handleDeletePermanently = async () => {
    if (!confirm(`PERMANENTLY delete ${resolvedUser.firstName} ${resolvedUser.lastName}? This cannot be undone. Their Clerk account will also be removed.`)) return;
    let result: { success: boolean; error?: string };
    if (isRep) {
      result = await deleteRepPermanently(id);
    } else if (isSubDealerRole) {
      result = await deleteSubDealerPermanently(id);
    } else {
      try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          result = { success: false, error: err.error ?? 'Failed to delete' };
        } else {
          result = { success: true };
        }
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : 'Failed to delete' };
      }
    }
    if (result.success) {
      toast(`${resolvedUser.firstName} ${resolvedUser.lastName} permanently deleted`, 'success');
      router.push('/dashboard/users');
    } else {
      toast(result.error ?? 'Failed to delete', 'error');
    }
  };

  // ─── Early branch: admin / project_manager / sub-dealer → simple shell ───
  // These roles don't have commission, projects, payroll, or trainer data,
  // so rendering the rep-specific UI below would show empty sections. The
  // shell here has just the essentials: avatar, contact info, role badge,
  // and (for PMs) the permission flags.
  if (resolvedUser.role === 'admin' || resolvedUser.role === 'project_manager' || resolvedUser.role === 'sub-dealer') {
    const roleLabel =
      resolvedUser.role === 'admin' ? 'Admin'
      : resolvedUser.role === 'project_manager' ? 'Project Manager'
      : 'Sub-Dealer';
    const badgeColor =
      resolvedUser.role === 'admin' ? '#ffb020'
      : resolvedUser.role === 'project_manager' ? '#00c4f0'
      : '#b47dff'; // sub-dealer purple
    const badgeBg =
      resolvedUser.role === 'admin' ? 'rgba(255,176,32,0.12)'
      : resolvedUser.role === 'project_manager' ? 'rgba(0,196,240,0.12)'
      : 'rgba(180,125,255,0.12)';
    const initials = `${resolvedUser.firstName[0] ?? ''}${resolvedUser.lastName[0] ?? ''}`.toUpperCase();

    return (
      <div className="p-4 md:p-8 animate-fade-in-up">
        {/* Breadcrumb */}
        <nav className="animate-breadcrumb-enter flex items-center gap-1.5 text-xs text-[#8891a8] mb-6">
          <Link href="/dashboard" className="hover:text-[#c2c8d8] transition-colors">Dashboard</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/dashboard/users" className="hover:text-[#c2c8d8] transition-colors">Users</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#c2c8d8]">{resolvedUser.firstName} {resolvedUser.lastName}</span>
        </nav>

        {/* Header card */}
        <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: '#161920', border: '1px solid #272b35', borderLeft: `3px solid ${badgeColor}`, opacity: isInactive ? 0.75 : 1 }}>
          <div className="flex items-start gap-5">
            <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black shrink-0" style={{ background: badgeBg, color: badgeColor }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              {/* Name (editable) */}
              {editingField === 'name' ? (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="rounded-xl px-3 py-1.5 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50"
                    style={{ background: '#1d2028', border: '1px solid #333849', color: '#fff', maxWidth: 180 }}
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="rounded-xl px-3 py-1.5 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50"
                    style={{ background: '#1d2028', border: '1px solid #333849', color: '#fff', maxWidth: 180 }}
                  />
                  <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1 text-[#00e07a] hover:text-[#00c4f0] text-sm transition-colors disabled:opacity-50">
                    <Check className="w-4 h-4" /> Save
                  </button>
                  <button onClick={cancelEdit} className="flex items-center gap-1 text-[#8891a8] hover:text-[#c2c8d8] text-sm transition-colors">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <h1 className="text-3xl font-black text-white tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    {resolvedUser.firstName} {resolvedUser.lastName}
                  </h1>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold" style={{ background: badgeBg, color: badgeColor, border: `1px solid ${badgeColor}40` }}>
                    {roleLabel}
                  </span>
                  {isInactive && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: '#272b35', color: '#8891a8', border: '1px solid #525c72' }}>
                      Inactive
                    </span>
                  )}
                  {isAdminViewer && (
                    <button onClick={() => startEdit('name')} className="text-[#525c72] hover:text-[#c2c8d8] transition-colors" title="Edit name">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Email (editable) */}
              <div className="text-sm mb-1" style={{ color: '#c2c8d8' }}>
                {editingField === 'email' ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50"
                      style={{ background: '#1d2028', border: '1px solid #333849', color: '#fff', minWidth: 280 }}
                      autoFocus
                    />
                    <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1 text-[#00e07a] hover:text-[#00c4f0] text-sm transition-colors disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button onClick={cancelEdit} className="flex items-center gap-1 text-[#8891a8] hover:text-[#c2c8d8] text-sm transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{resolvedUser.email || <span style={{ color: '#525c72' }}>No email</span>}</span>
                    {isAdminViewer && (
                      <button onClick={() => startEdit('email')} className="text-[#525c72] hover:text-[#c2c8d8] transition-colors" title="Edit email">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Phone (editable) */}
              <div className="text-sm" style={{ color: '#c2c8d8' }}>
                {editingField === 'phone' ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="(555) 000-0000"
                      className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]/50 placeholder-slate-500"
                      style={{ background: '#1d2028', border: '1px solid #333849', color: '#fff', minWidth: 200 }}
                      autoFocus
                    />
                    <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1 text-[#00e07a] hover:text-[#00c4f0] text-sm transition-colors disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button onClick={cancelEdit} className="flex items-center gap-1 text-[#8891a8] hover:text-[#c2c8d8] text-sm transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{resolvedUser.phone || <span style={{ color: '#525c72' }}>No phone</span>}</span>
                    {isAdminViewer && (
                      <button onClick={() => startEdit('phone')} className="text-[#525c72] hover:text-[#c2c8d8] transition-colors" title="Edit phone">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Permissions card (PM only) */}
        {resolvedUser.role === 'project_manager' && currentRole === 'admin' && (
          <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: '#161920', border: '1px solid #272b35' }}>
            <h2 className="text-white font-bold text-base mb-4">Permissions</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between py-2">
                <span style={{ color: '#c2c8d8' }}>Can create deals</span>
                <span className={resolvedUser.canCreateDeals ? 'text-[#00e07a] font-semibold' : 'text-[#525c72]'}>
                  {resolvedUser.canCreateDeals ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-[#272b35]">
                <span style={{ color: '#c2c8d8' }}>Can access blitz</span>
                <span className={resolvedUser.canAccessBlitz ? 'text-[#00e07a] font-semibold' : 'text-[#525c72]'}>
                  {resolvedUser.canAccessBlitz ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-[#272b35]">
                <span style={{ color: '#c2c8d8' }}>Can export</span>
                <span className={resolvedUser.canExport ? 'text-[#00e07a] font-semibold' : 'text-[#525c72]'}>
                  {resolvedUser.canExport ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            <p className="text-[11px] mt-4 pt-4 border-t border-[#272b35]" style={{ color: '#525c72' }}>
              Toggle these flags from Settings → Project Managers. Inline editing will move here in a follow-up.
            </p>
          </div>
        )}

        {/* ── Action footer ────────────────────────────────────────── */}
        {/* Three buttons: Deactivate/Reactivate, Send/Resend invite,
            Delete permanently. Visible only to admins. */}
        {isAdminViewer && (
          <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: '#161920', border: '1px solid #272b35' }}>
            <h2 className="text-white font-bold text-base mb-4">Account actions</h2>
            <div className="flex flex-wrap gap-3">
              {/* Deactivate / Reactivate */}
              {isInactive ? (
                <button
                  onClick={handleReactivate}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                  style={{ background: 'rgba(0,224,122,0.12)', color: '#00e07a', border: '1px solid rgba(0,224,122,0.3)' }}
                >
                  Reactivate
                </button>
              ) : (
                <button
                  onClick={handleDeactivate}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                  style={{ background: 'rgba(255,176,32,0.12)', color: '#ffb020', border: '1px solid rgba(255,176,32,0.3)' }}
                >
                  Deactivate
                </button>
              )}

              {/* Send / Resend invite — hidden once they have a Clerk account */}
              {userMeta && !userMeta.hasClerkAccount && !isInactive && (
                <button
                  onClick={handleSendInvite}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                  style={{ background: 'rgba(0,196,240,0.12)', color: '#00c4f0', border: '1px solid rgba(0,196,240,0.3)' }}
                >
                  {userMeta.pendingInvitation ? 'Resend invite' : 'Send invite'}
                </button>
              )}

              {/* Delete permanently — gated to zero relations */}
              {(() => {
                const hasRelations = (userMeta?.relationCount ?? 0) > 0;
                return (
                  <button
                    onClick={handleDeletePermanently}
                    disabled={hasRelations}
                    title={hasRelations ? `Has ${userMeta?.relationCount} related record(s) — deactivate instead` : 'Permanently delete this user (irreversible)'}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    Delete permanently
                  </button>
                );
              })()}
            </div>
            <p className="text-[11px] mt-4" style={{ color: '#525c72' }}>
              Deactivation locks the user out of Clerk and revokes any pending invitation. Their history is preserved. Hard delete is only allowed when the user has zero related records.
            </p>
          </div>
        )}

        <div className="card-surface rounded-2xl p-5" style={{ background: '#161920', border: '1px solid #272b35' }}>
          <p className="text-xs" style={{ color: '#8891a8' }}>
            {resolvedUser.role === 'sub-dealer'
              ? 'Sub-dealer accounts route deals through their own pricing. Project history lives on the projects they sourced.'
              : 'Admin and project manager accounts don\u2019t have commission, projects, or payroll data. Use Settings for permission management.'}
          </p>
        </div>
      </div>
    );
  }

  // Below this point, resolvedUser.role is 'rep' or 'sub-dealer'.
  // If `rep` wasn't in the context (sub-dealer or freshly fetched), reassign
  // it to whichever source resolved so the existing rep-detail JSX below
  // (which reads .name + .email) keeps working.
  if (!rep) {
    rep = resolvedUser as unknown as typeof rep;
  }
  // Type narrowing — at this point one of context lookup, sub-dealer
  // lookup, or fetched user must have populated `rep` (we already
  // returned for the not-found case + admin/PM case above).
  if (!rep) return null;

  const repProjects = projects.filter((p) => p.repId === id || p.setterId === id);
  const repPayroll = payrollEntries.filter((p) => p.repId === id);

  // Payment history pagination
  const payTotal = repPayroll.length;
  const payTotalPages = Math.max(1, Math.ceil(payTotal / payPageSize));
  const paySafePage = Math.min(payPage, payTotalPages);
  const payStart = (paySafePage - 1) * payPageSize;
  const payEnd = Math.min(payStart + payPageSize, payTotal);
  const pagedPayroll = repPayroll.slice(payStart, payEnd);

  // Projects pagination
  const projTotal = repProjects.length;
  const projTotalPages = Math.max(1, Math.ceil(projTotal / projPageSize));
  const projSafePage = Math.min(projPage, projTotalPages);
  const projStart = (projSafePage - 1) * projPageSize;
  const projEnd = Math.min(projStart + projPageSize, projTotal);
  const pagedProjects = repProjects.slice(projStart, projEnd);

  const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
  const totalEst = repProjects.reduce((s, p) => {
    if (p.repId === id) {
      // Closer: m1Amount is the setter's M1 when a setter exists, so closer earns 0 M1 in that case
      const closerM1 = p.setterId ? 0 : p.m1Amount;
      return s + closerM1 + p.m2Amount + (p.m3Amount ?? 0);
    } else {
      // Setter: earns m1Amount (setter's M1) + setter's M2/M3
      return s + p.m1Amount + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
    }
  }, 0);
  const totalPaid = repPayroll.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = repPayroll.filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0);
  const activeProjects = repProjects.filter((p) => !['Cancelled', 'On Hold', 'Completed'].includes(p.phase));

  // ── 6-month earnings sparkline data ───────────────────────────────────────
  const monthlyEarnings = (() => {
    const now = new Date();
    const months: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const total = repPayroll
        .filter((p) => p.date.startsWith(key))
        .reduce((s, p) => s + p.amount, 0);
      months.push(total);
    }
    return months;
  })();

  // ── Month-over-month trend for Total Deals and Total kW ───────────────────
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthDeals = repProjects.filter((p) => p.soldDate.startsWith(thisMonthKey)).length;
  const prevMonthDeals = repProjects.filter((p) => p.soldDate.startsWith(prevMonthKey)).length;
  const thisMonthKW = repProjects.filter((p) => p.soldDate.startsWith(thisMonthKey)).reduce((s, p) => s + p.kWSize, 0);
  const prevMonthKW = repProjects.filter((p) => p.soldDate.startsWith(prevMonthKey)).reduce((s, p) => s + p.kWSize, 0);
  const dealsTrend = thisMonthDeals - prevMonthDeals; // positive = up, negative = down
  const kwTrend = thisMonthKW - prevMonthKW;

  const assignment = trainerAssignments.find((a) => a.traineeId === id);
  const trainerRep = assignment ? reps.find((r) => r.id === assignment.trainerId) : null;
  const completedDeals = repProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length;
  const currentOverrideRate = assignment ? getTrainerOverrideRate(assignment, completedDeals) : 0;

  const initials = rep.name.split(' ').map((n) => n[0]).join('');

  return (
    <div className="p-4 md:p-8 max-w-4xl animate-fade-in-up">
      {/* Breadcrumb */}
      <nav className="animate-breadcrumb-enter flex items-center gap-1.5 text-xs text-[#8891a8] mb-6">
        <Link href="/dashboard" className="hover:text-[#c2c8d8] transition-colors">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href="/dashboard/users" className="hover:text-[#c2c8d8] transition-colors">Users</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#c2c8d8]">{rep.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
          style={{ backgroundColor: 'var(--brand-dark)' }}
        >
          {initials}
        </div>
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-[#00e07a]/15">
              <UserCheck className="w-5 h-5 text-[#00e07a]" />
            </span>
            <h1 className="text-3xl font-black tracking-tight text-gradient-brand">{rep.name}</h1>
          </div>
          <p className="text-[#c2c8d8] text-sm mt-1">{rep.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Deals',    value: repProjects.length,              color: 'text-[#00e07a]',    accentColor: 'rgba(59,130,246,0.08)',  glowClass: 'stat-glow-blue',    accentGradient: 'from-blue-500 to-blue-400', trend: dealsTrend, sparkData: null as number[] | null, sparkStroke: '' },
          { label: 'Active Pipeline', value: activeProjects.length,          color: 'text-[#00e07a]',    accentColor: 'rgba(59,130,246,0.08)',  glowClass: 'stat-glow-blue',    accentGradient: 'from-blue-500 to-blue-400', trend: null as number | null, sparkData: null as number[] | null, sparkStroke: '' },
          { label: 'Total kW',       value: `${totalKW.toFixed(1)} kW`,      color: 'text-yellow-400',  accentColor: 'rgba(234,179,8,0.08)',   glowClass: 'stat-glow-yellow',  accentGradient: 'from-yellow-500 to-yellow-400', trend: kwTrend, sparkData: null as number[] | null, sparkStroke: '' },
          ...(!isPM ? [{ label: 'Estimated Pay',  value: `$${totalEst.toLocaleString()}`, color: 'text-[#00e07a]', accentColor: 'rgba(16,185,129,0.08)', glowClass: 'stat-glow-emerald', accentGradient: 'from-emerald-500 to-emerald-400', trend: null as number | null, sparkData: monthlyEarnings, sparkStroke: '#00e07a' }] : []),
        ].map((s) => (
          <div
            key={s.label}
            className="card-surface card-surface-stat rounded-2xl p-4 transition-all duration-200 hover:translate-y-[-2px]"
            style={{ '--card-accent': s.accentColor } as CSSProperties}
          >
            <div className={`h-[2px] w-8 rounded-full bg-gradient-to-r mb-2 ${s.accentGradient}`} />
            <p className="text-[#c2c8d8] text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <div className="flex items-center gap-2">
              <p className={`stat-value stat-value-glow ${s.glowClass} text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              {s.trend !== null && s.trend > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#00e07a]/15 text-[#00e07a]">
                  <TrendingUp className="w-2.5 h-2.5" /> +{s.label === 'Total kW' ? s.trend.toFixed(1) : s.trend}
                </span>
              )}
              {s.trend !== null && s.trend < 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">
                  <TrendingDown className="w-2.5 h-2.5" /> {s.label === 'Total kW' ? s.trend.toFixed(1) : s.trend}
                </span>
              )}
            </div>
            {s.sparkData && <Sparkline data={s.sparkData} stroke={s.sparkStroke} />}
          </div>
        ))}
      </div>

      {/* ── Assign / View Trainer (admin only) ──────────────────────────── */}
      {currentRole === 'admin' && (
        <div className="card-surface rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-400" />
              <h2 className="text-white font-semibold text-sm">Trainer Assignment</h2>
            </div>
            {!assignment && !showTrainerPicker && (
              <button
                onClick={() => setShowTrainerPicker(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-[#00e07a] hover:text-[#00c4f0] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Assign Trainer
              </button>
            )}
          </div>

          {/* Already assigned — show trainer name + remove */}
          {assignment && (
            <div className="flex items-center justify-between mt-3 bg-[#1d2028]/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                {trainerRep ? (
                  <>
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {trainerRep.name.split(' ').map((n: string) => n[0]).join('')}
                    </span>
                    <div>
                      <p className="text-white text-sm font-medium">{trainerRep.name}</p>
                      <p className="text-[#8891a8] text-xs">Trainer &middot; ${currentOverrideRate.toFixed(2)}/W</p>
                    </div>
                  </>
                ) : (
                  <p className="text-[#8891a8] text-sm italic">Trainer no longer exists — remove stale assignment</p>
                )}
              </div>
              <button
                onClick={() => {
                  const snapshot = assignment;
                  setTrainerAssignments((prev) => prev.filter((a) => a.id !== snapshot.id));
                  fetch('/api/trainer-assignments', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: snapshot.id }),
                  }).then((res) => {
                    if (!res.ok) throw new Error();
                  }).catch(() => {
                    setTrainerAssignments((prev) => [...prev, snapshot]);
                    toast('Failed to remove trainer assignment', 'error');
                  });
                }}
                className="text-[#8891a8] hover:text-red-400 transition-colors text-xs font-medium flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          )}

          {/* No assignment — show picker */}
          {!assignment && showTrainerPicker && (
            <div className="mt-3">
              <RepSelector
                value=""
                onChange={(trainerId) => {
                  if (!trainerId) { setShowTrainerPicker(false); return; }
                  const tempId = `ta_${Date.now()}`;
                  setTrainerAssignments((prev) => [
                    ...prev,
                    {
                      id: tempId,
                      trainerId,
                      traineeId: id,
                      tiers: [{ upToDeal: null, ratePerW: 0.05 }],
                    },
                  ]);
                  setShowTrainerPicker(false);
                  fetch('/api/trainer-assignments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      trainerId,
                      traineeId: id,
                      tiers: [{ upToDeal: null, ratePerW: 0.05 }],
                    }),
                  })
                    .then((r) => r.json())
                    .then((assignment) => {
                      setTrainerAssignments((prev) =>
                        prev.map((a) =>
                          a.id === tempId
                            ? {
                                id: assignment.id,
                                trainerId: assignment.trainerId,
                                traineeId: assignment.traineeId,
                                tiers: (assignment.tiers ?? []).map((t: { upToDeal: number | null; ratePerW: number }) => ({
                                  upToDeal: t.upToDeal,
                                  ratePerW: t.ratePerW,
                                })),
                              }
                            : a
                        )
                      );
                    });
                }}
                reps={reps}
                placeholder="-- Select trainer --"
                clearLabel="Cancel"
                filterFn={(r) => r.id !== id}
              />
            </div>
          )}

          {/* No assignment and picker not shown — info message */}
          {!assignment && !showTrainerPicker && (
            <p className="text-[#8891a8] text-xs mt-2">No trainer assigned to this rep.</p>
          )}
        </div>
      )}

      {/* Trainer Override Card */}
      {assignment && trainerRep && (
        <TrainerOverrideCard
          assignment={assignment}
          trainerName={trainerRep.name}
          completedDeals={completedDeals}
          currentRate={currentOverrideRate}
          isAdmin={currentRole === 'admin'}
          onUpdate={(updatedTiers) => {
            setTrainerAssignments((prev) =>
              prev.map((a) =>
                a.id === assignment.id ? { ...a, tiers: updatedTiers } : a
              )
            );
          }}
        />
      )}

      {/* Commission roles table */}
      {!isPM && <div className="card-surface rounded-2xl p-5 mb-6">
        <h2 className="text-white font-semibold mb-4">Commission by Role</h2>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-[#333849]">
              <th className="text-left py-2 text-[#c2c8d8] font-medium">Role</th>
              <th className="text-left py-2 text-[#c2c8d8] font-medium">Deals</th>
              <th className="text-left py-2 text-[#c2c8d8] font-medium">Total Earned</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const closerDeals = projects.filter((p) => p.repId === id);
              const setterDeals = projects.filter((p) => p.setterId === id);
              const trainerDeals = trainerAssignments.filter((a) => a.trainerId === id);
              const closerPay = repPayroll
                .filter((e) => e.type === 'Deal' && e.notes !== 'Setter' && e.paymentStage !== 'Trainer')
                .reduce((s, e) => s + e.amount, 0);
              const setterPay = repPayroll
                .filter((e) => e.notes === 'Setter')
                .reduce((s, e) => s + e.amount, 0);
              const trainerPay = repPayroll
                .filter((e) => e.paymentStage === 'Trainer')
                .reduce((s, e) => s + e.amount, 0);
              return (
                <>
                  <tr className="table-row-enter row-stagger-0 relative border-b border-[#333849]/50 even:bg-[#1d2028]/20 hover:bg-[#00e07a]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[#00e07a] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Closer</td>
                    <td className="py-2.5 text-[#c2c8d8]">{closerDeals.length}</td>
                    <td className="py-2.5 text-[#00e07a] font-semibold">${closerPay.toLocaleString()}</td>
                  </tr>
                  <tr className="table-row-enter row-stagger-1 relative border-b border-[#333849]/50 even:bg-[#1d2028]/20 hover:bg-[#00e07a]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[#00e07a] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Setter</td>
                    <td className="py-2.5 text-[#c2c8d8]">{setterDeals.length}</td>
                    <td className="py-2.5 text-[#00e07a] font-semibold">${setterPay.toLocaleString()}</td>
                  </tr>
                  <tr className="table-row-enter row-stagger-2 relative even:bg-[#1d2028]/20 hover:bg-[#00e07a]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[#00e07a] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Trainer</td>
                    <td className="py-2.5 text-[#c2c8d8]">
                      {trainerDeals.length > 0 ? `${trainerDeals.length} trainee(s)` : '0'}
                    </td>
                    <td className="py-2.5 text-[#00e07a] font-semibold">${trainerPay.toLocaleString()}</td>
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>
      </div>}

      {/* Payment history */}
      {!isPM && <div className="card-surface rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[#333849] flex items-center justify-between">
          <h2 className="text-white font-semibold">Payment History</h2>
          <div className="flex gap-4 text-sm">
            <span className="text-[#00e07a]">Paid: ${totalPaid.toLocaleString()}</span>
            <span className="text-yellow-400">Pending: ${totalPending.toLocaleString()}</span>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-[#333849]">
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Customer / Notes</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Type</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Stage</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Amount</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Status</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {pagedPayroll.map((entry, i) => (
              <tr key={entry.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[#333849]/50 even:bg-[#1d2028]/20 hover:bg-[#00e07a]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[#00e07a] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                <td className="px-5 py-3 text-white">
                  {entry.customerName || entry.notes || '—'}
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    entry.type === 'Bonus' ? 'bg-blue-900/50 text-[#00e07a]' : 'bg-[#272b35] text-[#c2c8d8]'
                  }`}>
                    {entry.type}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="bg-[#272b35] text-[#c2c8d8] text-xs px-2 py-0.5 rounded font-medium">
                    {entry.paymentStage}
                  </span>
                </td>
                <td className="px-5 py-3 text-[#00e07a] font-semibold">
                  ${entry.amount.toLocaleString()}
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={entry.status} />
                </td>
                <td className="px-5 py-3 text-[#8891a8]">{formatDate(entry.date)}</td>
              </tr>
            ))}
            {repPayroll.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-[#8891a8]">
                  No payment history.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {repPayroll.length > 0 && (
          <PaginationBar totalResults={payTotal} startIdx={payStart} endIdx={payEnd}
            currentPage={paySafePage} totalPages={payTotalPages} rowsPerPage={payPageSize}
            onPageChange={setPayPage} onRowsPerPageChange={(n) => { setPayPageSize(n); setPayPage(1); }} />
        )}
      </div>}

      {/* Projects table */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#333849]">
          <h2 className="text-white font-semibold">All Projects</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-[#333849]">
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Customer</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Role</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Phase</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Installer</th>
              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">kW</th>
              {!isPM && <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Est. Pay</th>}
            </tr>
          </thead>
          <tbody>
            {pagedProjects.map((proj, i) => (
              <tr key={proj.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[#333849]/50 even:bg-[#1d2028]/20 hover:bg-[#00e07a]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[#00e07a] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                <td className="px-5 py-3">
                  <Link href={`/dashboard/projects/${proj.id}`} className="text-white hover:text-[#00e07a] transition-colors">
                    {proj.customerName}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs text-[#c2c8d8]">
                    {proj.repId === id ? 'Closer' : 'Setter'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <PhaseBadge phase={proj.phase} />
                </td>
                <td className="px-5 py-3 text-[#c2c8d8]">{proj.installer}</td>
                <td className="px-5 py-3 text-[#c2c8d8]">{proj.kWSize}</td>
                {!isPM && (
                  <td className="px-5 py-3 text-[#00e07a] font-semibold">
                    ${((proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0)).toLocaleString()}
                  </td>
                )}
              </tr>
            ))}
            {repProjects.length === 0 && (
              <tr>
                <td colSpan={isPM ? 5 : 6} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-[#1d2028]/80 flex items-center justify-center">
                      <FolderKanban className="w-6 h-6 text-[#525c72] animate-pulse" />
                    </div>
                    <p className="text-[#c2c8d8] text-sm font-medium">This rep has no deals yet</p>
                    <p className="text-[#525c72] text-xs">Projects assigned to this rep will appear here.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {repProjects.length > 0 && (
          <PaginationBar totalResults={projTotal} startIdx={projStart} endIdx={projEnd}
            currentPage={projSafePage} totalPages={projTotalPages} rowsPerPage={projPageSize}
            onPageChange={setProjPage} onRowsPerPageChange={(n) => { setProjPageSize(n); setProjPage(1); }} />
        )}
      </div>

      {/* ── Action footer ────────────────────────────────────────── */}
      {/* Same three-button footer as the admin/PM/SD shell — admin only. */}
      {isAdminViewer && (
        <div className="card-surface rounded-2xl p-6 mt-6" style={{ background: '#161920', border: '1px solid #272b35' }}>
          <h2 className="text-white font-bold text-base mb-4">Account actions</h2>
          <div className="flex flex-wrap gap-3">
            {isInactive ? (
              <button
                onClick={handleReactivate}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                style={{ background: 'rgba(0,224,122,0.12)', color: '#00e07a', border: '1px solid rgba(0,224,122,0.3)' }}
              >
                Reactivate
              </button>
            ) : (
              <button
                onClick={handleDeactivate}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                style={{ background: 'rgba(255,176,32,0.12)', color: '#ffb020', border: '1px solid rgba(255,176,32,0.3)' }}
              >
                Deactivate
              </button>
            )}
            {userMeta && !userMeta.hasClerkAccount && !isInactive && (
              <button
                onClick={handleSendInvite}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                style={{ background: 'rgba(0,196,240,0.12)', color: '#00c4f0', border: '1px solid rgba(0,196,240,0.3)' }}
              >
                {userMeta.pendingInvitation ? 'Resend invite' : 'Send invite'}
              </button>
            )}
            {(() => {
              const hasRelations = (userMeta?.relationCount ?? 0) > 0;
              return (
                <button
                  onClick={handleDeletePermanently}
                  disabled={hasRelations}
                  title={hasRelations ? `Has ${userMeta?.relationCount} related record(s) — deactivate instead` : 'Permanently delete this user (irreversible)'}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                >
                  Delete permanently
                </button>
              );
            })()}
          </div>
          <p className="text-[11px] mt-4" style={{ color: '#525c72' }}>
            Deactivation locks the user out of Clerk and revokes any pending invitation. Their history is preserved. Hard delete is only allowed when the user has zero related records.
          </p>
        </div>
      )}
    </div>
  );
}

// --- Trainer Override Card ---

interface TrainerOverrideCardProps {
  assignment: { id: string; trainerId: string; traineeId: string; tiers: TrainerOverrideTier[] };
  trainerName: string;
  completedDeals: number;
  currentRate: number;
  isAdmin: boolean;
  onUpdate: (tiers: TrainerOverrideTier[]) => void;
}

function TrainerOverrideCard({
  assignment,
  trainerName,
  completedDeals,
  currentRate,
  isAdmin,
  onUpdate,
}: TrainerOverrideCardProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftTiers, setDraftTiers] = useState<TrainerOverrideTier[]>([...assignment.tiers]);

  const updateTier = (index: number, field: keyof TrainerOverrideTier, value: string) => {
    setDraftTiers((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        if (field === 'upToDeal') {
          return { ...t, upToDeal: value === '' ? null : parseInt(value) || null };
        }
        return { ...t, ratePerW: parseFloat(value) || 0 };
      })
    );
  };

  const addTier = () => {
    setDraftTiers((prev) => {
      const updated = prev.map((t, i) =>
        i === prev.length - 1 && t.upToDeal === null
          ? { ...t, upToDeal: completedDeals + 10 }
          : t
      );
      return [...updated, { upToDeal: null, ratePerW: 0.05 }];
    });
  };

  const removeTier = (index: number) => {
    if (draftTiers.length <= 1) return;
    setDraftTiers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next[next.length - 1].upToDeal !== null) {
        next[next.length - 1] = { ...next[next.length - 1], upToDeal: null };
      }
      return next;
    });
  };

  const save = async () => {
    const res = await fetch('/api/trainer-assignments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assignment.id, tiers: draftTiers }),
    });
    if (!res.ok) { toast('Failed to save trainer override', 'error'); return; }
    onUpdate(draftTiers);
    setEditing(false);
    toast('Trainer override updated', 'success');
  };
  const cancel = () => { setDraftTiers([...assignment.tiers]); setEditing(false); };

  const activeTierIndex = assignment.tiers.findIndex(
    (t) => t.upToDeal === null || completedDeals < t.upToDeal
  );

  return (
    <div className="bg-[#161920] border border-amber-500/30 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-semibold">Trainer Override</h2>
          <p className="text-[#c2c8d8] text-sm mt-0.5">
            Trainer: <span className="text-amber-400">{trainerName}</span>
            <span className="text-[#525c72] mx-2">·</span>
            Current rate: <span className="text-amber-400 font-semibold">${currentRate.toFixed(2)}/W</span>
            <span className="text-[#525c72] mx-2">·</span>
            {completedDeals} deal{completedDeals !== 1 ? 's' : ''} completed
          </p>
        </div>
        {isAdmin && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-[#c2c8d8] hover:text-white text-sm transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button onClick={save} className="flex items-center gap-1 text-[#00e07a] hover:text-[#00c4f0] text-sm transition-colors">
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
            <button onClick={cancel} className="flex items-center gap-1 text-[#8891a8] hover:text-[#c2c8d8] text-sm transition-colors">
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(editing ? draftTiers : assignment.tiers).map((tier, i) => {
          const isActive = i === activeTierIndex;
          const prevUpTo = i === 0 ? 0 : (assignment.tiers[i - 1].upToDeal ?? 0);
          const dealRange = editing
            ? null
            : tier.upToDeal === null
            ? `Deal ${prevUpTo + 1}+`
            : `Deals ${prevUpTo + 1}–${tier.upToDeal}`;

          return (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                isActive && !editing
                  ? 'bg-amber-500/10 border border-amber-500/30'
                  : 'bg-[#1d2028]/50'
              }`}
            >
              {!editing ? (
                <>
                  <span className={`text-sm flex-1 ${isActive ? 'text-amber-300' : 'text-[#c2c8d8]'}`}>
                    {dealRange}
                  </span>
                  <span className={`font-semibold text-sm ${isActive ? 'text-amber-400' : 'text-[#c2c8d8]'}`}>
                    ${tier.ratePerW.toFixed(2)}/W
                  </span>
                  {isActive && (
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-lg">
                      Active
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-[#8891a8] text-xs w-16">Tier {i + 1}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-[#8891a8] text-xs">Up to deal</span>
                    <input
                      type="number"
                      min="1"
                      placeholder="∞"
                      value={tier.upToDeal ?? ''}
                      onChange={(e) => updateTier(i, 'upToDeal', e.target.value)}
                      disabled={i === draftTiers.length - 1}
                      className="w-20 bg-[#272b35] border border-[#272b35] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-40"
                    />
                    {i === draftTiers.length - 1 && (
                      <span className="text-[#8891a8] text-xs">(perpetual)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#8891a8] text-xs">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tier.ratePerW}
                      onChange={(e) => updateTier(i, 'ratePerW', e.target.value)}
                      className="w-20 bg-[#272b35] border border-[#272b35] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <span className="text-[#8891a8] text-xs">/W</span>
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    disabled={draftTiers.length <= 1}
                    className="text-[#525c72] hover:text-red-400 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}

        {editing && (
          <button
            onClick={addTier}
            className="flex items-center gap-1.5 text-[#c2c8d8] hover:text-white text-xs mt-2 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add tier
          </button>
        )}
      </div>
    </div>
  );
}

// ── Rep Detail Skeleton ───────────────────────────────────────────────────────

function RepDetailSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-6">
        <div className="h-3 w-16 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '0ms' }} />
        <div className="h-3 w-3 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '25ms' }} />
        <div className="h-3 w-10 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '50ms' }} />
        <div className="h-3 w-3 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        <div className="h-3 w-24 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '100ms' }} />
      </div>

      {/* Header — avatar + name */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-[#1d2028] animate-skeleton flex-shrink-0" style={{ animationDelay: '100ms' }} />
        <div>
          <div className="h-[3px] w-12 rounded-full bg-[#272b35] animate-skeleton mb-3" style={{ animationDelay: '150ms' }} />
          <div className="h-7 w-48 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '200ms' }} />
          <div className="h-4 w-56 bg-[#1d2028]/60 rounded animate-skeleton mt-1.5" style={{ animationDelay: '250ms' }} />
        </div>
      </div>

      {/* Stat cards — 4-column grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map((cardIdx) => {
          const base = 300 + cardIdx * 50;
          return (
            <div key={cardIdx} className="card-surface rounded-2xl p-4">
              <div className="h-[2px] w-8 rounded-full bg-[#272b35] animate-skeleton mb-2" style={{ animationDelay: `${base}ms` }} />
              <div className="h-3 w-20 bg-[#1d2028]/80 rounded animate-skeleton mb-2" style={{ animationDelay: `${base + 30}ms` }} />
              <div className="h-6 w-24 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${base + 60}ms` }} />
            </div>
          );
        })}
      </div>

      {/* Table skeleton — Payment History */}
      <div className="card-surface rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[#333849] flex items-center justify-between">
          <div className="h-5 w-36 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '550ms' }} />
          <div className="flex gap-4">
            <div className="h-4 w-24 bg-[#1d2028]/60 rounded animate-skeleton" style={{ animationDelay: '575ms' }} />
            <div className="h-4 w-28 bg-[#1d2028]/60 rounded animate-skeleton" style={{ animationDelay: '600ms' }} />
          </div>
        </div>
        {/* Header row */}
        <div className="border-b border-[#333849] px-5 py-3 flex gap-4">
          {[96, 56, 56, 64, 56, 64].map((w, i) => (
            <div key={i} className="h-4 bg-[#272b35]/70 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${625 + i * 30}ms` }} />
          ))}
        </div>
        {/* 6 placeholder rows */}
        {[0, 1, 2, 3, 4, 5].map((rowIdx) => {
          const delay = 700 + rowIdx * 40;
          return (
            <div key={rowIdx} className={`border-b border-[#333849]/50 px-5 py-3.5 flex gap-4 items-center ${rowIdx % 2 !== 0 ? 'bg-[#1d2028]/20' : ''}`}>
              {[120, 48, 48, 56, 52, 56].map((w, colIdx) => (
                <div key={colIdx} className="h-4 bg-[#1d2028]/60 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 20}ms` }} />
              ))}
            </div>
          );
        })}
      </div>

      {/* Table skeleton — All Projects */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#333849]">
          <div className="h-5 w-28 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '950ms' }} />
        </div>
        {/* Header row */}
        <div className="border-b border-[#333849] px-5 py-3 flex gap-4">
          {[80, 48, 56, 72, 40, 64].map((w, i) => (
            <div key={i} className="h-4 bg-[#272b35]/70 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${975 + i * 30}ms` }} />
          ))}
        </div>
        {/* 6 placeholder rows */}
        {[0, 1, 2, 3, 4, 5].map((rowIdx) => {
          const delay = 1050 + rowIdx * 40;
          return (
            <div key={rowIdx} className={`border-b border-[#333849]/50 px-5 py-3.5 flex gap-4 items-center ${rowIdx % 2 !== 0 ? 'bg-[#1d2028]/20' : ''}`}>
              {[100, 44, 56, 64, 36, 56].map((w, colIdx) => (
                <div key={colIdx} className="h-4 bg-[#1d2028]/60 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 20}ms` }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PHASE_PILL: Record<string, { gradient: string; border: string; shadow: string; text: string; dot: string }> = {
  'New':             { gradient: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         border: 'border-sky-700/30',      shadow: 'shadow-[0_0_6px_rgba(14,165,233,0.15)]',  text: 'text-sky-300',     dot: 'bg-sky-400'     },
  'Acceptance':      { gradient: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    border: 'border-indigo-700/30',   shadow: 'shadow-[0_0_6px_rgba(99,102,241,0.15)]',  text: 'text-indigo-300',  dot: 'bg-indigo-400'  },
  'Site Survey':     { gradient: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    border: 'border-violet-700/30',   shadow: 'shadow-[0_0_6px_rgba(139,92,246,0.15)]',  text: 'text-violet-300',  dot: 'bg-violet-400'  },
  'Design':          { gradient: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  border: 'border-fuchsia-700/30',  shadow: 'shadow-[0_0_6px_rgba(217,70,239,0.15)]',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  'Permitting':      { gradient: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      border: 'border-amber-700/30',    shadow: 'shadow-[0_0_6px_rgba(245,158,11,0.15)]',  text: 'text-amber-300',   dot: 'bg-amber-400'   },
  'Pending Install': { gradient: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    border: 'border-orange-700/30',   shadow: 'shadow-[0_0_6px_rgba(249,115,22,0.15)]',  text: 'text-orange-300',  dot: 'bg-orange-400'  },
  'Installed':       { gradient: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        border: 'border-teal-700/30',     shadow: 'shadow-[0_0_6px_rgba(20,184,166,0.15)]',  text: 'text-teal-300',    dot: 'bg-teal-400'    },
  'PTO':             { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  border: 'border-emerald-700/30',  shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]',  text: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Completed':       { gradient: 'bg-gradient-to-r from-green-900/50 to-green-800/30',      border: 'border-green-600/40',    shadow: 'shadow-[0_0_8px_rgba(34,197,94,0.25)]',   text: 'text-green-300',   dot: 'bg-green-400'   },
  'Cancelled':       { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',          border: 'border-red-700/30',      shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.15)]',   text: 'text-red-300',     dot: 'bg-red-400'     },
  'On Hold':         { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',    border: 'border-yellow-700/30',   shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',   text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
};

function PhaseBadge({ phase }: { phase: string }) {
  const s = PHASE_PILL[phase] ?? { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-[#272b35]/30', shadow: '', text: 'text-[#c2c8d8]', dot: 'bg-[#8891a8]' };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {phase}
    </span>
  );
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Paid:    { bg: 'bg-[#00e07a]/10 border-[#00e07a]/20', text: 'text-[#00e07a]', dot: 'bg-emerald-400' },
  Pending: { bg: 'bg-yellow-500/10 border-yellow-500/20',   text: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  Draft:   { bg: 'bg-[#8891a8]/10 border-[#333849]/20',     text: 'text-[#c2c8d8]',   dot: 'bg-[#8891a8]'   },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}
