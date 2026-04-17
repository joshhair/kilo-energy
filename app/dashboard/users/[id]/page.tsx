'use client';

import { use, useState, useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileRepDetail from '../../mobile/MobileRepDetail';
import { getTrainerOverrideRate, TrainerOverrideTier } from '../../../../lib/data';
import { formatDate, formatCompactKW, todayLocalDateStr } from '../../../../lib/utils';
import { useToast } from '../../../../lib/toast';
import { PaginationBar } from '../../components/PaginationBar';
import { ChevronRight, ChevronLeft, ChevronDown, Pencil, Check, X, Plus, Trash2, FolderKanban, UserCheck, UserPlus, TrendingUp, TrendingDown } from 'lucide-react';
import { RepSelector } from '../../components/RepSelector';
import { Sparkline } from '../../../../lib/sparkline';
import ConfirmDialog from '../../components/ConfirmDialog';

const PIPELINE_PHASES = ['New','Acceptance','Site Survey','Design','Permitting','Pending Install','Installed','PTO','Completed'] as const;

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
  const { projects, payrollEntries, trainerAssignments, setTrainerAssignments, currentRole, effectiveRole, currentRepId, effectiveRepId, reps, subDealers, deactivateRep, reactivateRep, deleteRepPermanently, deactivateSubDealer, reactivateSubDealer, deleteSubDealerPermanently, updateRepContact, updateSubDealerContact } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const hydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { toast } = useToast();
  const router = useRouter();

  // Pagination state — payment history
  const [payPage, setPayPage] = useState(1);
  const [payPageSize, setPayPageSize] = useState(10);
  // Sort state — payment history
  const [paySortCol, setPaySortCol] = useState<'amount' | 'date' | 'status' | null>(null);
  const [paySortDir, setPaySortDir] = useState<'asc' | 'desc'>('desc');
  const togglePaySort = (col: typeof paySortCol) => {
    if (paySortCol === col) {
      setPaySortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setPaySortCol(col);
      setPaySortDir('desc');
    }
  };
  // Pagination state — projects
  const [projPage, setProjPage] = useState(1);
  const [projPageSize, setProjPageSize] = useState(10);
  // Trainer assignment picker state
  const [showTrainerPicker, setShowTrainerPicker] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Commission-by-Role drill-down — admin-only slide-over that lists the
  // PayrollEntries making up a total when the amount cell is clicked.
  const [drillRole, setDrillRole] = useState<'Closer' | 'Setter' | 'Trainer' | 'Bonus' | null>(null);
  const [drillEntries, setDrillEntries] = useState<Array<{ id: string; customerName?: string; projectId?: string | null; amount: number; date: string; paymentStage: string; status: string; notes?: string }>>([]);
  const [drillTotal, setDrillTotal] = useState(0);

  // ── Admin-only metadata for the action footer ─────────────────────────
  // The /api/users/[id] route exposes relationCount + pendingInvitation
  // which the deactivate / send-invite / hard-delete buttons need to know
  // about. Only fetched when the viewer is an admin.
  const [userMeta, setUserMeta] = useState<UserMeta | null>(null);
  const [userMetaError, setUserMetaError] = useState(false);
  const [metaRefreshKey, setMetaRefreshKey] = useState(0);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  useEffect(() => {
    if (currentRole !== 'admin') return;
    setUserMetaError(false);
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
        } else {
          setUserMetaError(true);
        }
      })
      .catch(() => { setUserMetaError(true); });
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
  // Stable ref so the keydown effect can call startEdit without capturing a TDZ binding.
  const startEditRef = useRef<((field: 'name' | 'email' | 'phone') => void) | null>(null);

  // First try the app context — reps + sub-dealers are already hydrated there.
  // `rep` is `let` so we can reassign to a sub-dealer/fetched user before
  // falling through to the existing rep-detail JSX (which reads .name + .email).
  let rep = reps.find((r) => r.id === id);
  // Stable const — captures whether this id was found in context BEFORE the
  // `rep` variable is potentially reassigned to resolvedUser later in render.
  // Used in saveEdit so updateRepContact is only called when the rep actually
  // lives in context (preventing a silent no-op against a stale context array).
  const repInContext = rep;
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
  // NOTE: preserve `rep.role` — it may be 'rep' OR 'admin' (selling
  // admins are now included in the reps[] array so they appear in
  // closer/setter dropdowns). Hardcoding 'rep' here caused the admin
  // shell branch below to never match for selling admins, and they
  // rendered the rep-specific UI (trainer assignment, "this rep has no
  // deals yet") instead of the Admin+Sales card + action footer.
  const resolvedUser =
    rep
      ? { ...rep, role: rep.role as string, canCreateDeals: false, canAccessBlitz: false, canExport: false }
      : subDealer
      ? { ...subDealer, role: 'sub-dealer' as string, repType: 'both' as string, canCreateDeals: false, canAccessBlitz: false, canExport: false }
      : fetchedUser;

  const displayName = resolvedUser ? `${resolvedUser.firstName} ${resolvedUser.lastName}` : '';
  useEffect(() => { document.title = displayName ? `${displayName} | Kilo Energy` : 'User Detail | Kilo Energy'; }, [displayName]);

  const isAdminViewer = effectiveRole === 'admin';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingField !== null) return;
      if (!isAdminViewer) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'e' || e.key === 'E') startEditRef.current?.('name');
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editingField, isAdminViewer]);

  const [barsMounted, setBarsMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setBarsMounted(true), 50); return () => clearTimeout(t); }, []);

  if (!hydrated || currentRole === null) return <RepDetailSkeleton />;

  if (isMobile) return <MobileRepDetail repId={id} />;

  if (effectiveRole !== 'admin' && effectiveRole !== 'project_manager' && id !== effectiveRepId) {
    return (
      <div className="p-8 text-center text-[var(--text-muted)] text-sm">
        You don&apos;t have permission to view this page.
      </div>
    );
  }

  // Still fetching and nothing found in context yet — show skeleton.
  if (!resolvedUser && !lookupFailed) return <RepDetailSkeleton />;

  if (!resolvedUser) {
    return (
      <div className="p-8 text-[var(--text-muted)] text-center">
        User not found.{' '}
        <Link href="/dashboard/users" className="text-[var(--accent-green)] hover:underline">
          Back to Users
        </Link>
      </div>
    );
  }

  const isInactive = (rep || subDealer)
    ? (resolvedUser as { active?: boolean }).active === false
    : userMeta
    ? !userMeta.active
    : (resolvedUser as { active?: boolean }).active === false;

  // ── Save handler for contact edits ────────────────────────────────────
  const startEdit = (field: 'name' | 'email' | 'phone') => {
    setEditFirstName(resolvedUser.firstName);
    setEditLastName(resolvedUser.lastName);
    setEditEmail(resolvedUser.email ?? '');
    setEditPhone(resolvedUser.phone ?? '');
    setEditingField(field);
  };
  startEditRef.current = startEdit;
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
      body.email = editEmail.trim().toLowerCase();
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
      if (repInContext) updateRepContact(id, body, true);
      else if (subDealer) updateSubDealerContact(id, body, true);
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
    if (isDeactivating) return;
    setIsDeactivating(true);
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
        // Invalidate the router cache so the users list page refetches
        // adminUsers/pmUsers when the user navigates back (they live in
        // local state there, not in the shared context).
        router.refresh();
      }
      setMetaRefreshKey((k) => k + 1);
      toast(`${resolvedUser.firstName} deactivated`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to deactivate', 'error');
    } finally {
      setIsDeactivating(false);
    }
  };
  const handleReactivate = async () => {
    if (isReactivating) return;
    setIsReactivating(true);
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
        // Invalidate the router cache so the users list page refetches
        // adminUsers/pmUsers when the user navigates back (they live in
        // local state there, not in the shared context).
        router.refresh();
      }
      setMetaRefreshKey((k) => k + 1);
      toast(`${resolvedUser.firstName} reactivated`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reactivate', 'error');
    } finally {
      setIsReactivating(false);
    }
  };
  const handleSendInvite = async () => {
    if (isSendingInvite) return;
    setIsSendingInvite(true);
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
    } finally {
      setIsSendingInvite(false);
    }
  };
  const handleDeletePermanently = async () => {
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
      resolvedUser.role === 'admin' ? 'var(--accent-amber)'
      : resolvedUser.role === 'project_manager' ? 'var(--accent-cyan)'
      : '#b47dff'; // sub-dealer purple
    const badgeBg =
      resolvedUser.role === 'admin' ? 'rgba(255,176,32,0.12)'
      : resolvedUser.role === 'project_manager' ? 'rgba(0,196,240,0.12)'
      : 'rgba(180,125,255,0.12)';
    const initials = `${resolvedUser.firstName[0] ?? ''}${resolvedUser.lastName[0] ?? ''}`.toUpperCase();

    return (
      <div className="p-4 md:p-8 animate-fade-in-up">
        {/* Breadcrumb */}
        <nav className="animate-breadcrumb-enter flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-6">
          <Link href="/dashboard" className="hover:text-[var(--text-secondary)] transition-colors">Dashboard</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/dashboard/users" className="hover:text-[var(--text-secondary)] transition-colors">Users</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[var(--text-secondary)]">{resolvedUser.firstName} {resolvedUser.lastName}</span>
        </nav>

        {/* Header card */}
        <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${badgeColor}`, opacity: isInactive ? 0.75 : 1 }}>
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
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                    className="rounded-xl px-3 py-1.5 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: '#fff', maxWidth: 180 }}
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                    className="rounded-xl px-3 py-1.5 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: '#fff', maxWidth: 180 }}
                  />
                  <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1 text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-sm transition-colors disabled:opacity-50">
                    <Check className="w-4 h-4" /> Save
                  </button>
                  <button onClick={cancelEdit} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm transition-colors">
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
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: 'var(--border)', color: 'var(--text-muted)', border: '1px solid var(--text-dim)' }}>
                      Inactive
                    </span>
                  )}
                  {isAdminViewer && (
                    <span className="group relative">
                      <button onClick={() => startEdit('name')} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors" title="Edit name (E)">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <span className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-[var(--border)] text-[var(--text-secondary)] text-[10px] px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap">Press E</span>
                    </span>
                  )}
                </div>
              )}

              {/* Email (editable) */}
              <div className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                {editingField === 'email' ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                      className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50"
                      style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: '#fff', minWidth: 280 }}
                      autoFocus
                    />
                    <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1 text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-sm transition-colors disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button onClick={cancelEdit} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{resolvedUser.email || <span style={{ color: 'var(--text-dim)' }}>No email</span>}</span>
                    {isAdminViewer && (
                      <button onClick={() => startEdit('email')} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors" title="Edit email">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Phone (editable) */}
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {editingField === 'phone' ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                      placeholder="(555) 000-0000"
                      className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50 placeholder-slate-500"
                      style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: '#fff', minWidth: 200 }}
                      autoFocus
                    />
                    <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1 text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-sm transition-colors disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button onClick={cancelEdit} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{resolvedUser.phone || <span style={{ color: 'var(--text-dim)' }}>No phone</span>}</span>
                    {isAdminViewer && (
                      <button onClick={() => startEdit('phone')} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors" title="Edit phone">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sales preferences (admin viewing an admin) — sets repType so the
            admin appears in closer/setter dropdowns on new deals and gets a
            My Pay tab scoped to their own earnings. Non-admin roles either
            don't have this (PMs) or already have it by default (reps). */}
        {resolvedUser.role === 'admin' && effectiveRole === 'admin' && (
          <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-white font-bold text-base mb-2">Sales</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Set this if {resolvedUser.id === currentRepId ? 'you' : 'this admin'} also sells deals. Once set, {resolvedUser.id === currentRepId ? 'you' : 'they'} appear in closer/setter pickers on new deals and get a My Pay tab with {resolvedUser.id === currentRepId ? 'your' : 'their'} own earnings.
            </p>
            <div className="flex items-center gap-3">
              <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Role for deals
              </label>
              <select
                value={resolvedUser.repType ?? ''}
                onChange={async (e) => {
                  const newRepType = e.target.value === '' ? null : e.target.value;
                  try {
                    const res = await fetch(`/api/users/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ repType: newRepType }),
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error(err.error ?? 'Failed to save');
                    }
                    // Reflect locally — the next /api/data hydrate will pick
                    // this admin up in the reps array (if repType is set) or
                    // drop them (if cleared). The My Pay tab + dropdown
                    // presence follow from that.
                    if (fetchedUser) {
                      // Store empty string for null to match FetchedUser.repType shape.
                      setFetchedUser({ ...fetchedUser, repType: newRepType ?? '' });
                    }
                    setMetaRefreshKey((k) => k + 1);
                    toast(newRepType ? `Saved — ${resolvedUser.id === currentRepId ? 'you' : 'they'} now appear as a ${newRepType}` : 'Saved — pure-admin mode', 'success');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Failed to save', 'error');
                  }
                }}
                className="rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]/50"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: '#fff' }}
              >
                <option value="">Not a seller (admin-only)</option>
                <option value="closer">Closer</option>
                <option value="setter">Setter</option>
                <option value="both">Both</option>
              </select>
            </div>
            {resolvedUser.id === currentRepId && (
              <p className="text-[11px] mt-3" style={{ color: 'var(--text-dim)' }}>
                Refresh the page after changing this to see the My Pay tab update in the nav.
              </p>
            )}
          </div>
        )}

        {/* Permissions card (PM only) */}
        {resolvedUser.role === 'project_manager' && effectiveRole === 'admin' && (
          <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-white font-bold text-base mb-4">Permissions</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between py-2">
                <span style={{ color: 'var(--text-secondary)' }}>Can create deals</span>
                <span className={resolvedUser.canCreateDeals ? 'text-[var(--accent-green)] font-semibold' : 'text-[var(--text-dim)]'}>
                  {resolvedUser.canCreateDeals ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-[var(--border)]">
                <span style={{ color: 'var(--text-secondary)' }}>Can access blitz</span>
                <span className={resolvedUser.canAccessBlitz ? 'text-[var(--accent-green)] font-semibold' : 'text-[var(--text-dim)]'}>
                  {resolvedUser.canAccessBlitz ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-[var(--border)]">
                <span style={{ color: 'var(--text-secondary)' }}>Can export</span>
                <span className={resolvedUser.canExport ? 'text-[var(--accent-green)] font-semibold' : 'text-[var(--text-dim)]'}>
                  {resolvedUser.canExport ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            <p className="text-[11px] mt-4 pt-4 border-t border-[var(--border)]" style={{ color: 'var(--text-dim)' }}>
              Toggle these flags from Settings → Project Managers. Inline editing will move here in a follow-up.
            </p>
          </div>
        )}

        {/* ── Action footer ────────────────────────────────────────── */}
        {/* Three buttons: Deactivate/Reactivate, Send/Resend invite,
            Delete permanently. Visible only to admins. */}
        {isAdminViewer && (
          <div className="card-surface rounded-2xl p-6 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-white font-bold text-base mb-4">Account actions</h2>
            <div className="flex flex-wrap gap-3">
              {/* Deactivate / Reactivate */}
              {isInactive ? (
                <button
                  onClick={handleReactivate}
                  disabled={isReactivating}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(0,224,122,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,224,122,0.3)' }}
                >
                  {isReactivating ? 'Reactivating…' : 'Reactivate'}
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={isDeactivating}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber)', border: '1px solid rgba(255,176,32,0.3)' }}
                >
                  {isDeactivating ? 'Deactivating…' : 'Deactivate'}
                </button>
              )}

              {/* Retry meta load — shown only when fetch failed */}
              {userMetaError && (
                <button
                  onClick={() => setMetaRefreshKey((k) => k + 1)}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                  style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)' }}
                >
                  Retry
                </button>
              )}

              {/* Send / Resend invite — hidden once they have a Clerk account */}
              {userMeta && !userMeta.hasClerkAccount && !isInactive && resolvedUser?.email && (
                <button
                  onClick={handleSendInvite}
                  disabled={isSendingInvite}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(0,196,240,0.12)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,196,240,0.3)' }}
                >
                  {isSendingInvite ? 'Sending…' : userMeta.pendingInvitation ? 'Resend invite' : 'Send invite'}
                </button>
              )}

              {/* Delete permanently — gated to zero relations */}
              {(() => {
                const hasRelations = !userMeta || (userMeta.relationCount ?? 0) > 0;
                return (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={hasRelations}
                    title={userMetaError ? 'Failed to load user data — use Retry to reload' :!userMeta ? 'Loading user data…' : hasRelations ? `Has ${userMeta?.relationCount} related record(s) — deactivate instead` : 'Permanently delete this user (irreversible)'}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    Delete permanently
                  </button>
                );
              })()}
            </div>
            <p className="text-[11px] mt-4" style={{ color: 'var(--text-dim)' }}>
              Deactivation locks the user out of Clerk and revokes any pending invitation. Their history is preserved. Hard delete is only allowed when the user has zero related records.
            </p>
          </div>
        )}

        <div className="card-surface rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {resolvedUser.role === 'sub-dealer'
              ? 'Sub-dealer accounts route deals through their own pricing. Project history lives on the projects they sourced.'
              : 'Admin and project manager accounts don\u2019t have commission, projects, or payroll data. Use Settings for permission management.'}
          </p>
        </div>

        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); handleDeletePermanently(); }}
          title="Permanently delete user"
          message={`PERMANENTLY delete ${displayName}? This cannot be undone. Their Clerk account will also be removed.`}
          confirmLabel="Delete permanently"
          danger
        />

        <ConfirmDialog
          open={confirmDeactivate}
          onClose={() => setConfirmDeactivate(false)}
          onConfirm={() => { setConfirmDeactivate(false); handleDeactivate(); }}
          title="Deactivate user"
          message={`Deactivate ${displayName}? This will lock them out of Clerk and revoke any pending invitation.`}
          confirmLabel="Deactivate"
          danger
        />
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
  const sortedPayroll = paySortCol
    ? [...repPayroll].sort((a, b) => {
        let cmp = 0;
        if (paySortCol === 'amount') cmp = a.amount - b.amount;
        else if (paySortCol === 'date') cmp = (a.date ?? '').localeCompare(b.date ?? '');
        else if (paySortCol === 'status') cmp = (a.status ?? '').localeCompare(b.status ?? '');
        return paySortDir === 'asc' ? cmp : -cmp;
      })
    : repPayroll;
  const payTotal = sortedPayroll.length;
  const payTotalPages = Math.max(1, Math.ceil(payTotal / payPageSize));
  const paySafePage = Math.min(payPage, payTotalPages);
  const payStart = (paySafePage - 1) * payPageSize;
  const payEnd = Math.min(payStart + payPageSize, payTotal);
  const pagedPayroll = sortedPayroll.slice(payStart, payEnd);

  // Projects pagination
  const projTotal = repProjects.length;
  const projTotalPages = Math.max(1, Math.ceil(projTotal / projPageSize));
  const projSafePage = Math.min(projPage, projTotalPages);
  const projStart = (projSafePage - 1) * projPageSize;
  const projEnd = Math.min(projStart + projPageSize, projTotal);
  const pagedProjects = repProjects.slice(projStart, projEnd);

  const totalKW = repProjects.filter(p => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0);
  const totalEst = repProjects.filter(p => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => {
    if (p.repId === id) {
      // Closer: gets $0 M1 when a setter exists (setter takes M1); otherwise earns m1Amount
      const closerM1 = p.setterId ? 0 : p.m1Amount;
      // Self-gen: rep is also the setter; m1Amount holds the full M1 (setterM1Amount is 0 for self-gen)
      const selfGenM1 = p.setterId === id ? (p.m1Amount ?? 0) : 0;
      return s + closerM1 + selfGenM1 + p.m2Amount + (p.m3Amount ?? 0) + (p.setterId === id ? (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) : 0);
    } else {
      // Setter: earns setterM1Amount + setter's M2/M3
      return s + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
    }
  }, 0);
  const todayStr = todayLocalDateStr();
  const totalPaid = repPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((s, p) => s + p.amount, 0);
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
        .filter((p) => p.date?.startsWith(key) && p.status === 'Paid')
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
  const thisMonthDeals = repProjects.filter((p) => p.soldDate?.startsWith(thisMonthKey)).length;
  const prevMonthDeals = repProjects.filter((p) => p.soldDate?.startsWith(prevMonthKey)).length;
  const thisMonthKW = repProjects.filter((p) => p.soldDate?.startsWith(thisMonthKey)).reduce((s, p) => s + p.kWSize, 0);
  const prevMonthKW = repProjects.filter((p) => p.soldDate?.startsWith(prevMonthKey)).reduce((s, p) => s + p.kWSize, 0);
  const dealsTrend = thisMonthDeals - prevMonthDeals; // positive = up, negative = down
  const kwTrend = thisMonthKW - prevMonthKW;

  const assignment = trainerAssignments.find((a) => a.traineeId === id);
  const trainerRep = assignment ? reps.find((r) => r.id === assignment.trainerId) : null;
  const completedDeals = repProjects.filter((p) => (p.repId === id || p.setterId === id) && (p.phase === 'Installed' || p.phase === 'PTO' || p.phase === 'Completed')).length;
  const currentOverrideRate = assignment ? getTrainerOverrideRate(assignment, completedDeals) : 0;

  const initials = rep.name.split(' ').map((n) => n[0]).join('');

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      {/* Breadcrumb */}
      <nav className="animate-breadcrumb-enter flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-6">
        <Link href="/dashboard" className="hover:text-[var(--text-secondary)] transition-colors">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href="/dashboard/users" className="hover:text-[var(--text-secondary)] transition-colors">Users</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[var(--text-secondary)]">{rep.name}</span>
      </nav>

      {/* Two-column layout at xl+ */}
      <div className="xl:grid xl:grid-cols-[300px_1fr] xl:gap-8 xl:items-start">
        {/* LEFT: sticky sidebar */}
        <div className="xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
          <div className="xl:flex xl:flex-col xl:gap-6">

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
            <span className="p-2 rounded-lg bg-[var(--accent-green)]/15">
              <UserCheck className="w-5 h-5 text-[var(--accent-green)]" />
            </span>
            <h1 className="text-3xl font-black tracking-tight text-gradient-brand">{rep.name}</h1>
          </div>
          <p className="text-[var(--text-secondary)] text-sm mt-1">{rep.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-4 mb-8">
        {[
          { label: 'Total Deals',    value: repProjects.length,              color: 'text-[var(--accent-green)]',    accentColor: 'rgba(59,130,246,0.08)',  glowClass: 'stat-glow-blue',    accentGradient: 'from-blue-500 to-blue-400', trend: dealsTrend, sparkData: null as number[] | null, sparkStroke: '' },
          { label: 'Active Pipeline', value: activeProjects.length,          color: 'text-[var(--accent-green)]',    accentColor: 'rgba(59,130,246,0.08)',  glowClass: 'stat-glow-blue',    accentGradient: 'from-blue-500 to-blue-400', trend: null as number | null, sparkData: null as number[] | null, sparkStroke: '' },
          { label: 'Total kW',       value: formatCompactKW(totalKW),         color: 'text-yellow-400',  accentColor: 'rgba(234,179,8,0.08)',   glowClass: 'stat-glow-yellow',  accentGradient: 'from-yellow-500 to-yellow-400', trend: kwTrend, sparkData: null as number[] | null, sparkStroke: '' },
          ...(!isPM ? [{ label: 'Estimated Pay',  value: `$${totalEst.toLocaleString()}`, color: 'text-[var(--accent-green)]', accentColor: 'rgba(16,185,129,0.08)', glowClass: 'stat-glow-emerald', accentGradient: 'from-emerald-500 to-emerald-400', trend: null as number | null, sparkData: monthlyEarnings, sparkStroke: 'var(--accent-green)' }] : []),
        ].map((s) => (
          <div
            key={s.label}
            className="card-surface card-surface-stat rounded-2xl p-4 transition-all duration-200 hover:translate-y-[-2px]"
            style={{ '--card-accent': s.accentColor } as CSSProperties}
          >
            <div className={`h-[2px] w-8 rounded-full bg-gradient-to-r mb-2 ${s.accentGradient}`} />
            <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <div className="flex items-center gap-2">
              <p className={`stat-value stat-value-glow ${s.glowClass} text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              {s.trend !== null && s.trend > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)]">
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
      {effectiveRole === 'admin' && (
        <div className="card-surface rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-400" />
              <h2 className="text-white font-semibold text-sm">Trainer Assignment</h2>
            </div>
            {!assignment && !showTrainerPicker && (
              <button
                onClick={() => setShowTrainerPicker(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Assign Trainer
              </button>
            )}
          </div>

          {/* Already assigned — show trainer name + remove */}
          {assignment && (
            <div className="flex items-center justify-between mt-3 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                {trainerRep ? (
                  <>
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {trainerRep.name.split(' ').map((n: string) => n[0]).join('')}
                    </span>
                    <div>
                      <p className="text-white text-sm font-medium">{trainerRep.name}</p>
                      <p className="text-[var(--text-muted)] text-xs">Trainer &middot; ${currentOverrideRate.toFixed(2)}/W</p>
                    </div>
                  </>
                ) : (
                  <p className="text-[var(--text-muted)] text-sm italic">Trainer no longer exists — remove stale assignment</p>
                )}
              </div>
              <button
                onClick={() => {
                  const snapshot = assignment;
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
                className="text-[var(--text-muted)] hover:text-red-400 transition-colors text-xs font-medium flex items-center gap-1"
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
                    .then((r) => { if (!r.ok) throw new Error('Failed to assign trainer'); return r.json(); })
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
                    })
                    .catch(() => {
                      setTrainerAssignments((prev) => prev.filter((a) => a.id !== tempId));
                      toast('Failed to assign trainer', 'error');
                    });
                }}
                reps={reps.filter((r) => r.active !== false)}
                placeholder="-- Select trainer --"
                clearLabel="Cancel"
                filterFn={(r) => r.id !== id}
              />
            </div>
          )}

          {/* No assignment and picker not shown — info message */}
          {!assignment && !showTrainerPicker && (
            <p className="text-[var(--text-muted)] text-xs mt-2">No trainer assigned to this rep.</p>
          )}
        </div>
      )}

      {/* Trainer Override Card — hidden for the trainee themselves once they've
          graduated (isActiveTraining === false). Admins still see it so they
          can audit residual-override earnings after graduation. */}
      {assignment && trainerRep && !(
        effectiveRole !== 'admin'
        && id === effectiveRepId
        && assignment.isActiveTraining === false
      ) && (
        <TrainerOverrideCard
          assignment={assignment}
          trainerName={trainerRep.name}
          completedDeals={completedDeals}
          currentRate={currentOverrideRate}
          isAdmin={effectiveRole === 'admin'}
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
      {!isPM && (() => {
        // Hoist role-specific filters so the drill-down slide-over can reuse
        // them without re-deriving. Each filter mirrors the classification in
        // the row below so totals and drill-down sets are guaranteed to match.
        const closerDealCount = projects.filter((p) => p.repId === id).length;
        const setterDealCount = projects.filter((p) => p.setterId === id && p.repId !== id).length;
        const trainerDealCount = new Set(repPayroll.filter((e) => e.paymentStage === 'Trainer' && e.projectId !== null).map((e) => e.projectId)).size;
        const closerEntries = repPayroll.filter((e) => e.type === 'Deal' && e.notes !== 'Setter' && !e.notes?.startsWith('Co-setter') && e.paymentStage !== 'Trainer');
        const setterEntries = repPayroll.filter((e) => e.notes === 'Setter' || e.notes?.startsWith('Co-setter'));
        const trainerEntries = repPayroll.filter((e) => e.paymentStage === 'Trainer');
        const bonusEntries = repPayroll.filter((e) => e.type !== 'Deal' && e.notes !== 'Setter' && e.paymentStage !== 'Trainer');
        const sum = (arr: typeof repPayroll) => arr.reduce((s, e) => s + e.amount, 0);
        const closerPay = sum(closerEntries);
        const setterPay = sum(setterEntries);
        const trainerPay = sum(trainerEntries);
        const bonusPay = sum(bonusEntries);

        const openDrill = (role: typeof drillRole, entries: typeof repPayroll, total: number) => {
          if (!isAdminViewer) return;
          setDrillRole(role);
          setDrillEntries(entries);
          setDrillTotal(total);
        };
        const amountCls = `py-2.5 text-[var(--accent-green)] font-semibold${isAdminViewer ? ' cursor-pointer hover:underline decoration-dotted underline-offset-4' : ''}`;

        return (
          <div className="card-surface rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold mb-4">Commission by Role</h2>
            <table className="w-full text-sm">
              <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left py-2 text-[var(--text-secondary)] font-medium">Role</th>
                  <th className="text-left py-2 text-[var(--text-secondary)] font-medium">Deals</th>
                  <th className="text-left py-2 text-[var(--text-secondary)] font-medium">Total Earned</th>
                </tr>
              </thead>
              <tbody>
                <tr className="table-row-enter row-stagger-0 relative border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-green)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                  <td className="py-2.5 text-white">Closer</td>
                  <td className="py-2.5 text-[var(--text-secondary)]">{closerDealCount}</td>
                  <td className={amountCls} onClick={() => openDrill('Closer', closerEntries, closerPay)}>${closerPay.toLocaleString()}</td>
                </tr>
                <tr className="table-row-enter row-stagger-1 relative border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-green)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                  <td className="py-2.5 text-white">Setter</td>
                  <td className="py-2.5 text-[var(--text-secondary)]">{setterDealCount}</td>
                  <td className={amountCls} onClick={() => openDrill('Setter', setterEntries, setterPay)}>${setterPay.toLocaleString()}</td>
                </tr>
                <tr className={`table-row-enter row-stagger-2 relative ${bonusPay > 0 ? 'border-b border-[var(--border-subtle)]/50' : ''} even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-green)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                  <td className="py-2.5 text-white">Trainer</td>
                  <td className="py-2.5 text-[var(--text-secondary)]">{trainerDealCount}</td>
                  <td className={amountCls} onClick={() => openDrill('Trainer', trainerEntries, trainerPay)}>${trainerPay.toLocaleString()}</td>
                </tr>
                {bonusPay > 0 && (
                  <tr className="table-row-enter row-stagger-3 relative even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-green)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Bonus / Other</td>
                    <td className="py-2.5 text-[var(--text-secondary)]">—</td>
                    <td className={amountCls} onClick={() => openDrill('Bonus', bonusEntries, bonusPay)}>${bonusPay.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {isAdminViewer && (
              <p className="text-[var(--text-muted)] text-[11px] mt-3">
                Click any total to see the contributing payroll entries.
              </p>
            )}
          </div>
        );
      })()}

          </div>{/* end xl:flex xl:flex-col left inner */}
        </div>{/* end xl:sticky left col */}

        {/* RIGHT: scrollable main content */}
        <div className="xl:flex xl:flex-col xl:gap-6 xl:min-w-0">

      {/* Payment history */}
      {!isPM && <div className="card-surface rounded-2xl overflow-clip mb-6">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-white font-semibold">Payment History</h2>
          <div className="flex gap-4 text-sm">
            <span className="text-[var(--accent-green)]">Paid: ${totalPaid.toLocaleString()}</span>
            <span className="text-yellow-400">Pending: ${totalPending.toLocaleString()}</span>
          </div>
        </div>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Customer / Notes</th>
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Type</th>
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Stage</th>
              <th className="text-right px-5 py-3 font-medium">
                <button onClick={() => togglePaySort('amount')} className={`flex items-center justify-end gap-1 w-full transition-colors duration-150 ${paySortCol === 'amount' ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)] hover:text-white'}`}>
                  Amount <ChevronDown className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-200 ${paySortCol === 'amount' && paySortDir === 'asc' ? 'rotate-180' : ''}`} />
                </button>
              </th>
              <th className="text-left px-5 py-3 font-medium">
                <button onClick={() => togglePaySort('status')} className={`flex items-center gap-1 transition-colors duration-150 ${paySortCol === 'status' ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)] hover:text-white'}`}>
                  Status <ChevronDown className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-200 ${paySortCol === 'status' && paySortDir === 'asc' ? 'rotate-180' : ''}`} />
                </button>
              </th>
              <th className="text-left px-5 py-3 font-medium">
                <button onClick={() => togglePaySort('date')} className={`flex items-center gap-1 transition-colors duration-150 ${paySortCol === 'date' ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)] hover:text-white'}`}>
                  Date <ChevronDown className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-200 ${paySortCol === 'date' && paySortDir === 'asc' ? 'rotate-180' : ''}`} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {pagedPayroll.map((entry, i) => (
              <tr key={entry.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-green)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                <td className="px-5 py-3 text-white">
                  {entry.customerName || entry.notes || '—'}
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    entry.type === 'Bonus' ? 'bg-blue-900/50 text-[var(--accent-green)]' : 'bg-[var(--border)] text-[var(--text-secondary)]'
                  }`}>
                    {entry.type}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="bg-[var(--border)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded font-medium">
                    {entry.paymentStage}
                  </span>
                </td>
                <td className={`px-5 py-3 text-right text-[var(--accent-green)] font-semibold tabular-nums${paySortCol === 'amount' ? ' bg-[var(--accent-green)]/[0.015]' : ''}`}>
                  ${entry.amount.toLocaleString()}
                </td>
                <td className={`px-5 py-3${paySortCol === 'status' ? ' bg-[var(--accent-green)]/[0.015]' : ''}`}>
                  <StatusBadge status={entry.status} />
                </td>
                <td className={`px-5 py-3 text-[var(--text-muted)]${paySortCol === 'date' ? ' bg-[var(--accent-green)]/[0.015]' : ''}`}>{formatDate(entry.date)}</td>
              </tr>
            ))}
            {repPayroll.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-[var(--text-muted)]">
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
        <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-white font-semibold">All Projects</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Customer</th>
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Role</th>
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Phase</th>
              <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Installer</th>
              <th className="hidden xl:table-cell text-right px-5 py-3 text-[var(--text-secondary)] font-medium">Sold</th>
              <th className="text-right px-5 py-3 text-[var(--text-secondary)] font-medium tabular-nums">kW</th>
              {!isPM && <th className="text-right px-5 py-3 text-[var(--text-secondary)] font-medium tabular-nums">Est. Pay</th>}
            </tr>
          </thead>
          <tbody>
            {pagedProjects.map((proj, i) => (
              <tr key={proj.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-green)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                <td className="px-5 py-3">
                  <Link href={`/dashboard/projects/${proj.id}`} className="text-white hover:text-[var(--accent-green)] transition-colors">
                    {proj.customerName}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs text-[var(--text-secondary)]">
                    {proj.repId === id && proj.setterId === id ? 'Self-gen' : proj.repId === id ? 'Closer' : 'Setter'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-col gap-1.5">
                    <PhaseBadge phase={proj.phase} />
                    {!['Cancelled', 'On Hold'].includes(proj.phase) && (
                      <div className="h-[3px] w-full rounded-full bg-[var(--border)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-green)] motion-safe:transition-[width] motion-safe:duration-700 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)]"
                          style={{
                            width: barsMounted
                              ? `${Math.round(((PIPELINE_PHASES.indexOf(proj.phase as typeof PIPELINE_PHASES[number]) + 1) / PIPELINE_PHASES.length) * 100)}%`
                              : '0%',
                            transitionDelay: barsMounted ? `${Math.min(i, 12) * 35}ms` : '0ms',
                          }}
                        />
                      </div>
                    )}
                    {proj.phase === 'Cancelled' && (
                      <div className="h-[3px] w-full rounded-full bg-red-500/30" />
                    )}
                    {proj.phase === 'On Hold' && (
                      <div className="h-[3px] w-full rounded-full bg-yellow-500/30" />
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-[var(--text-secondary)]">{proj.installer}</td>
                <td className="hidden xl:table-cell text-right px-5 py-3 text-[var(--text-muted)] tabular-nums">{formatDate(proj.soldDate)}</td>
                <td className="px-5 py-3 text-right text-[var(--text-secondary)] tabular-nums">{proj.kWSize}</td>
                {!isPM && (
                  <td className="px-5 py-3 text-right text-[var(--accent-green)] font-semibold tabular-nums">
                    {(proj.phase === 'Cancelled' || proj.phase === 'On Hold') ? '$0' : `$${(proj.repId === id
                        ? (proj.setterId === id ? (proj.m1Amount ?? 0) : (proj.setterId ? 0 : (proj.m1Amount ?? 0))) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) + (proj.setterId === id ? (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0) : 0)
                        : (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0)
                      ).toLocaleString()}`}
                  </td>
                )}
              </tr>
            ))}
            {repProjects.length === 0 && (
              <tr>
                <td colSpan={isPM ? 6 : 7} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-[var(--surface-card)]/80 flex items-center justify-center">
                      <FolderKanban className="w-6 h-6 text-[var(--text-dim)] animate-pulse" />
                    </div>
                    <p className="text-[var(--text-secondary)] text-sm font-medium">This rep has no deals yet</p>
                    <p className="text-[var(--text-dim)] text-xs">Projects assigned to this rep will appear here.</p>
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

        </div>{/* end right col */}
      </div>{/* end xl:grid two-column layout */}

      {/* ── Action footer ────────────────────────────────────────── */}
      {/* Same three-button footer as the admin/PM/SD shell — admin only. */}
      {isAdminViewer && (
        <div className="card-surface rounded-2xl p-6 mt-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-white font-bold text-base mb-4">Account actions</h2>
          <div className="flex flex-wrap gap-3">
            {isInactive ? (
              <button
                onClick={handleReactivate}
                disabled={isReactivating}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(0,224,122,0.12)', color: 'var(--accent-green)', border: '1px solid rgba(0,224,122,0.3)' }}
              >
                {isReactivating ? 'Reactivating…' : 'Reactivate'}
              </button>
            ) : (
              <button
                onClick={() => setConfirmDeactivate(true)}
                disabled={isDeactivating}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,176,32,0.12)', color: 'var(--accent-amber)', border: '1px solid rgba(255,176,32,0.3)' }}
              >
                {isDeactivating ? 'Deactivating…' : 'Deactivate'}
              </button>
            )}
            {userMeta && !userMeta.hasClerkAccount && !isInactive && resolvedUser?.email && (
              <button
                onClick={handleSendInvite}
                disabled={isSendingInvite}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(0,196,240,0.12)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,196,240,0.3)' }}
              >
                {isSendingInvite ? 'Sending…' : userMeta.pendingInvitation ? 'Resend invite' : 'Send invite'}
              </button>
            )}
            {/* Retry meta load — shown only when fetch failed */}
            {userMetaError && (
              <button
                onClick={() => setMetaRefreshKey((k) => k + 1)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
                style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)' }}
              >
                Retry
              </button>
            )}
            {(() => {
              const hasRelations = !userMeta || (userMeta.relationCount ?? 0) > 0;
              return (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={hasRelations}
                  title={userMetaError ? 'Failed to load user data — use Retry to reload' : !userMeta ? 'Loading user data…' : hasRelations ? `Has ${userMeta?.relationCount} related record(s) — deactivate instead` : 'Permanently delete this user (irreversible)'}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                >
                  Delete permanently
                </button>
              );
            })()}
          </div>
          <p className="text-[11px] mt-4" style={{ color: 'var(--text-dim)' }}>
            Deactivation locks the user out of Clerk and revokes any pending invitation. Their history is preserved. Hard delete is only allowed when the user has zero related records.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={() => { setConfirmDeactivate(false); handleDeactivate(); }}
        title="Deactivate user"
        message={`Deactivate ${displayName}? This will lock them out of Clerk and revoke any pending invitation.`}
        confirmLabel="Deactivate"
        danger
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); handleDeletePermanently(); }}
        title="Permanently delete user"
        message={`PERMANENTLY delete ${displayName}? This cannot be undone. Their Clerk account will also be removed.`}
        confirmLabel="Delete permanently"
        danger
      />

      {/* Commission drill-down slide-over — admin audit of what makes up each role total. */}
      {drillRole && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
            onClick={() => setDrillRole(null)}
          />
          <div className="fixed top-0 right-0 bottom-0 z-[70] w-full md:w-[560px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl overflow-y-auto motion-safe:animate-slide-in-right">
            <div className="sticky top-0 z-10 bg-[var(--surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{drillRole} commission breakdown</p>
                <h3 className="text-white text-lg font-semibold mt-0.5">${drillTotal.toLocaleString()} <span className="text-[var(--text-muted)] text-sm font-normal">across {drillEntries.length} {drillEntries.length === 1 ? 'entry' : 'entries'}</span></h3>
              </div>
              <button onClick={() => setDrillRole(null)} aria-label="Close" className="p-2 rounded-lg hover:bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              {drillEntries.length === 0 ? (
                <p className="text-[var(--text-muted)] text-sm text-center py-8">No entries for this role yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left py-2 text-[var(--text-secondary)] font-medium">Customer</th>
                      <th className="text-left py-2 text-[var(--text-secondary)] font-medium">Stage</th>
                      <th className="text-right py-2 text-[var(--text-secondary)] font-medium">Amount</th>
                      <th className="text-left py-2 pl-3 text-[var(--text-secondary)] font-medium">Status</th>
                      <th className="text-left py-2 pl-3 text-[var(--text-secondary)] font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...drillEntries].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e, i) => (
                      <tr key={e.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-green)]/[0.03] transition-colors duration-150`}>
                        <td className="py-2.5 text-white">
                          {e.projectId ? (
                            <Link href={`/dashboard/projects/${e.projectId}`} className="hover:text-[var(--accent-green)] transition-colors">
                              {e.customerName || e.notes || '—'}
                            </Link>
                          ) : (
                            <span>{e.customerName || e.notes || '—'}</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span className="bg-[var(--border)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded font-medium">{e.paymentStage}</span>
                        </td>
                        <td className="py-2.5 text-right text-[var(--accent-green)] font-semibold tabular-nums">${e.amount.toLocaleString()}</td>
                        <td className="py-2.5 pl-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${e.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' : e.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>{e.status}</span>
                        </td>
                        <td className="py-2.5 pl-3 text-[var(--text-muted)] tabular-nums">{formatDate(e.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
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
  const [saving, setSaving] = useState(false);
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
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/trainer-assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assignment.id, tiers: draftTiers }),
      });
      if (!res.ok) { toast('Failed to save trainer override', 'error'); return; }
      onUpdate(draftTiers);
      setEditing(false);
      toast('Trainer override updated', 'success');
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => { setDraftTiers([...assignment.tiers]); setEditing(false); };

  const activeTierSource = editing ? draftTiers : assignment.tiers;
  const sortedTiers = [...activeTierSource].sort((a, b) => {
    if (a.upToDeal === null) return 1;
    if (b.upToDeal === null) return -1;
    return a.upToDeal - b.upToDeal;
  });
  const activeTierIndex = sortedTiers.findIndex(
    (t) => t.upToDeal === null || completedDeals < t.upToDeal
  );

  return (
    <div className="bg-[var(--surface)] border border-amber-500/30 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-semibold">Trainer Override</h2>
          <p className="text-[var(--text-secondary)] text-sm mt-0.5">
            Trainer: <span className="text-amber-400">{trainerName}</span>
            <span className="text-[var(--text-dim)] mx-2">·</span>
            Current rate: <span className="text-amber-400 font-semibold">${currentRate.toFixed(2)}/W</span>
            <span className="text-[var(--text-dim)] mx-2">·</span>
            {completedDeals} deal{completedDeals !== 1 ? 's' : ''} completed
          </p>
        </div>
        {isAdmin && !editing && (
          <button
            onClick={() => { setDraftTiers([...assignment.tiers]); setEditing(true); }}
            className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-white text-sm transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex items-center gap-1 text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancel} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm transition-colors">
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(editing ? draftTiers : assignment.tiers).map((tier, i) => {
          const isActive = i === activeTierIndex;
          const prevUpTo = i === 0 ? 0 : ((editing ? draftTiers : assignment.tiers)[i - 1].upToDeal ?? 0);
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
                  : 'bg-[var(--surface-card)]/50'
              }`}
            >
              {!editing ? (
                <>
                  <span className={`text-sm flex-1 ${isActive ? 'text-amber-300' : 'text-[var(--text-secondary)]'}`}>
                    {dealRange}
                  </span>
                  <span className={`font-semibold text-sm ${isActive ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
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
                  <span className="text-[var(--text-muted)] text-xs w-16">Tier {i + 1}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-[var(--text-muted)] text-xs">Up to deal</span>
                    <input
                      type="number"
                      min="1"
                      placeholder="∞"
                      value={tier.upToDeal ?? ''}
                      onChange={(e) => updateTier(i, 'upToDeal', e.target.value)}
                      disabled={i === draftTiers.length - 1}
                      className="w-20 bg-[var(--border)] border border-[var(--border)] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-40"
                    />
                    {i === draftTiers.length - 1 && (
                      <span className="text-[var(--text-muted)] text-xs">(perpetual)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--text-muted)] text-xs">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tier.ratePerW}
                      onChange={(e) => updateTier(i, 'ratePerW', e.target.value)}
                      className="w-20 bg-[var(--border)] border border-[var(--border)] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <span className="text-[var(--text-muted)] text-xs">/W</span>
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    disabled={draftTiers.length <= 1}
                    className="text-[var(--text-dim)] hover:text-red-400 transition-colors disabled:opacity-30"
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
            className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-white text-xs mt-2 transition-colors"
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
        <div className="h-3 w-16 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '0ms' }} />
        <div className="h-3 w-3 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '25ms' }} />
        <div className="h-3 w-10 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '50ms' }} />
        <div className="h-3 w-3 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        <div className="h-3 w-24 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '100ms' }} />
      </div>

      {/* Header — avatar + name */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-[var(--surface-card)] animate-skeleton flex-shrink-0" style={{ animationDelay: '100ms' }} />
        <div>
          <div className="h-[3px] w-12 rounded-full bg-[var(--border)] animate-skeleton mb-3" style={{ animationDelay: '150ms' }} />
          <div className="h-7 w-48 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '200ms' }} />
          <div className="h-4 w-56 bg-[var(--surface-card)]/60 rounded animate-skeleton mt-1.5" style={{ animationDelay: '250ms' }} />
        </div>
      </div>

      {/* Stat cards — 4-column grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map((cardIdx) => {
          const base = 300 + cardIdx * 50;
          return (
            <div key={cardIdx} className="card-surface rounded-2xl p-4">
              <div className="h-[2px] w-8 rounded-full bg-[var(--border)] animate-skeleton mb-2" style={{ animationDelay: `${base}ms` }} />
              <div className="h-3 w-20 bg-[var(--surface-card)]/80 rounded animate-skeleton mb-2" style={{ animationDelay: `${base + 30}ms` }} />
              <div className="h-6 w-24 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${base + 60}ms` }} />
            </div>
          );
        })}
      </div>

      {/* Table skeleton — Payment History */}
      <div className="card-surface rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div className="h-5 w-36 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '550ms' }} />
          <div className="flex gap-4">
            <div className="h-4 w-24 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ animationDelay: '575ms' }} />
            <div className="h-4 w-28 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ animationDelay: '600ms' }} />
          </div>
        </div>
        {/* Header row */}
        <div className="border-b border-[var(--border-subtle)] px-5 py-3 flex gap-4">
          {[96, 56, 56, 64, 56, 64].map((w, i) => (
            <div key={i} className="h-4 bg-[var(--border)]/70 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${625 + i * 30}ms` }} />
          ))}
        </div>
        {/* 6 placeholder rows */}
        {[0, 1, 2, 3, 4, 5].map((rowIdx) => {
          const delay = 700 + rowIdx * 40;
          return (
            <div key={rowIdx} className={`border-b border-[var(--border-subtle)]/50 px-5 py-3.5 flex gap-4 items-center ${rowIdx % 2 !== 0 ? 'bg-[var(--surface-card)]/20' : ''}`}>
              {[120, 48, 48, 56, 52, 56].map((w, colIdx) => (
                <div key={colIdx} className="h-4 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 20}ms` }} />
              ))}
            </div>
          );
        })}
      </div>

      {/* Table skeleton — All Projects */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
          <div className="h-5 w-28 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '950ms' }} />
        </div>
        {/* Header row */}
        <div className="border-b border-[var(--border-subtle)] px-5 py-3 flex gap-4">
          {[80, 48, 56, 72, 40, 64].map((w, i) => (
            <div key={i} className="h-4 bg-[var(--border)]/70 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${975 + i * 30}ms` }} />
          ))}
        </div>
        {/* 6 placeholder rows */}
        {[0, 1, 2, 3, 4, 5].map((rowIdx) => {
          const delay = 1050 + rowIdx * 40;
          return (
            <div key={rowIdx} className={`border-b border-[var(--border-subtle)]/50 px-5 py-3.5 flex gap-4 items-center ${rowIdx % 2 !== 0 ? 'bg-[var(--surface-card)]/20' : ''}`}>
              {[100, 44, 56, 64, 36, 56].map((w, colIdx) => (
                <div key={colIdx} className="h-4 bg-[var(--surface-card)]/60 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 20}ms` }} />
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
  const s = PHASE_PILL[phase] ?? { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-[var(--border)]/30', shadow: '', text: 'text-[var(--text-secondary)]', dot: 'bg-[var(--text-muted)]' };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {phase}
    </span>
  );
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Paid:    { bg: 'bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20', text: 'text-[var(--accent-green)]', dot: 'bg-emerald-400' },
  Pending: { bg: 'bg-yellow-500/10 border-yellow-500/20',   text: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  Draft:   { bg: 'bg-[var(--text-muted)]/10 border-[var(--border-subtle)]/20',     text: 'text-[var(--text-secondary)]',   dot: 'bg-[var(--text-muted)]'   },
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
