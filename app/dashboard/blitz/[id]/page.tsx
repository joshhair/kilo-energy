'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApp } from '../../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileBlitzDetail from '../../mobile/MobileBlitzDetail';
import { formatDate, formatCurrency, formatCompactKW } from '../../../../lib/utils';
import { getSolarTechBaseline, getProductCatalogBaseline, getInstallerRatesForDeal } from '../../../../lib/data';
import { ArrowLeft, MapPin, Calendar, Home, Users, Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Zap, CheckCircle, XCircle, Clock, UserPlus, X, Pencil, Save, Loader2, FolderKanban, Trophy, ChevronUp } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import Link from 'next/link';

const COST_CATEGORIES = ['housing', 'travel', 'gas', 'meals', 'incentives', 'swag', 'other'] as const;

const PHASE_COLORS: Record<string, string> = {
  'New': 'bg-sky-900/40 text-sky-300 border-sky-700/30',
  'Acceptance': 'bg-indigo-900/40 text-indigo-300 border-indigo-700/30',
  'Site Survey': 'bg-violet-900/40 text-violet-300 border-violet-700/30',
  'Design': 'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-700/30',
  'Permitting': 'bg-amber-900/40 text-amber-300 border-amber-700/30',
  'Pending Install': 'bg-orange-900/40 text-orange-300 border-orange-700/30',
  'Installed': 'bg-teal-900/40 text-teal-300 border-teal-700/30',
  'PTO': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30',
  'Completed': 'bg-green-900/40 text-green-300 border-green-600/30',
  'Cancelled': 'bg-red-900/40 text-red-300 border-red-700/30',
  'On Hold': 'bg-[var(--surface-card)]/40 text-[var(--text-secondary)] border-[var(--border)]/30',
};

const COST_CATEGORY_STYLES: Record<string, { badge: string; bar: string }> = {
  housing:    { badge: 'bg-blue-900/40 text-[var(--accent-cyan)] border border-blue-700/30',       bar: 'bg-[var(--accent-green)]' },
  travel:     { badge: 'bg-purple-900/40 text-purple-300 border border-purple-700/30',  bar: 'bg-purple-500' },
  gas:        { badge: 'bg-amber-900/40 text-amber-300 border border-amber-700/30',     bar: 'bg-amber-500' },
  meals:      { badge: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/30', bar: 'bg-[var(--accent-green)]' },
  incentives: { badge: 'bg-pink-900/40 text-pink-300 border border-pink-700/30',        bar: 'bg-pink-500' },
  swag:       { badge: 'bg-orange-900/40 text-orange-300 border border-orange-700/30',  bar: 'bg-orange-500' },
  other:      { badge: 'bg-[var(--surface-card)]/60 text-[var(--text-secondary)] border border-[var(--border)]/30',        bar: 'bg-[var(--text-muted)]' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  upcoming:  { bg: 'bg-blue-900/30',    text: 'text-[var(--accent-cyan)]',    dot: 'bg-blue-400',    border: 'border-blue-700/30' },
  active:    { bg: 'bg-emerald-900/30',  text: 'text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-700/30' },
  completed: { bg: 'bg-[var(--surface-card)]/50',     text: 'text-[var(--text-secondary)]',    dot: 'bg-[var(--text-muted)]',    border: 'border-[var(--border)]/30' },
  cancelled: { bg: 'bg-red-900/30',      text: 'text-red-300',     dot: 'bg-red-400',     border: 'border-red-700/30' },
};

type TabKey = 'overview' | 'participants' | 'deals' | 'costs' | 'profitability';

export default function BlitzDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentRole, currentRepId, effectiveRole, effectiveRepId, reps, installerPricingVersions, productCatalogProducts, solarTechProducts } = useApp();
  const hydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isAdmin = effectiveRole === 'admin';
  const { toast } = useToast();
  const blitzId = params.id as string;

  const [blitz, setBlitz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');
  const [dealsSort, setDealsSort] = useState<{ col: 'customer' | 'kw' | 'ppw' | 'payout'; dir: 'asc' | 'desc' }>({ col: 'kw', dir: 'desc' });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', location: '', housing: '', startDate: '', endDate: '', notes: '', status: '', ownerId: '' });

  // Confirmation dialog
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);

  // Loading states for async ops
  const [saving, setSaving] = useState(false);
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [addingCost, setAddingCost] = useState(false);

  // Cost form
  const [showAddCost, setShowAddCost] = useState(false);
  const [costCategory, setCostCategory] = useState<string>('housing');
  const [costAmount, setCostAmount] = useState('');
  const [costDesc, setCostDesc] = useState('');
  const [costDate, setCostDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });

  // Participant form
  const [showAddParticipant, setShowAddParticipant] = useState(false);

  // Escape key closes Add Participant modal
  useEffect(() => {
    if (!showAddParticipant) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowAddParticipant(false); setSelectedRepId(''); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showAddParticipant]);
  const [selectedRepId, setSelectedRepId] = useState('');

  const loadBlitz = (forceUpdateForm = false) => {
    fetch(`/api/blitzes/${blitzId}`).then((r) => r.json()).then((data) => {
      if (data.error) { router.push('/dashboard/blitz'); return; }
      setBlitz(data);
      if (!editing || forceUpdateForm) setEditForm({ name: data.name, location: data.location, housing: data.housing, startDate: data.startDate, endDate: data.endDate, notes: data.notes, status: data.status, ownerId: data.owner?.id ?? '' });
      setLoading(false);
    }).catch(() => { setLoading(false); });
  };

  useEffect(() => { loadBlitz(); }, [blitzId]);

  // Dynamic page title
  useEffect(() => {
    document.title = blitz ? `${blitz.name} | Kilo Energy` : 'Blitz | Kilo Energy';
  }, [blitz?.name]);

  // Sliding tab indicator
  useEffect(() => {
    const allTabs: TabKey[] = ['overview', 'participants', 'deals', ...(isAdmin ? ['costs' as TabKey, 'profitability' as TabKey] : [])];
    const idx = allTabs.indexOf(tab);
    const el = tabRefs.current[idx];
    if (el) setTabIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab, isAdmin, blitz]);

  // Rep permissions (canRequestBlitz)
  const [canRequestBlitz, setCanRequestBlitz] = useState(false);
  const [processingParticipants, setProcessingParticipants] = useState<Set<string>>(new Set());
  const [updatingAttendance, setUpdatingAttendance] = useState<Set<string>>(new Set());
  const [cancelRequesting, setCancelRequesting] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  useEffect(() => {
    if (isAdmin || !effectiveRepId) return;
    fetch(`/api/users/${effectiveRepId}`).then((r) => r.json()).then((u) => {
      setCanRequestBlitz(u.canRequestBlitz ?? false);
    }).catch(() => {});
  }, [effectiveRepId, isAdmin]);

  // Computed metrics
  const approvedParticipants = blitz?.participants?.filter((p: any) => p.joinStatus === 'approved') ?? [];
  // Owner check — blitz leaders get participant management powers
  const isOwner = !isAdmin && effectiveRepId != null && blitz?.owner?.id === effectiveRepId;
  const canManage = isAdmin || isOwner;

  // For reps (non-admin, non-owner), filter deals to only their own
  const visibleProjects = useMemo(() => {
    if (!blitz?.projects) return [];
    if (isAdmin || isOwner) return blitz.projects.filter((p: any) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
    return blitz.projects.filter((p: any) => (p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId) && p.phase !== 'Cancelled' && p.phase !== 'On Hold');
  }, [blitz?.projects, isAdmin, isOwner, effectiveRepId]);

  const approvedParticipantIds = useMemo(
    () => new Set((blitz?.participants ?? []).filter((p: any) => p.joinStatus === 'approved').map((p: any) => p.user.id)),
    [blitz?.participants],
  );
  const approvedVisibleProjects = useMemo(
    () => (isAdmin || isOwner)
      ? visibleProjects.filter((p: any) => approvedParticipantIds.has(p.closer?.id) || approvedParticipantIds.has(p.setter?.id))
      : visibleProjects,
    [visibleProjects, isAdmin, isOwner, approvedParticipantIds],
  );
  const totalDeals = approvedVisibleProjects.length;

  const sortedDeals = useMemo(() => {
    const arr = [...approvedVisibleProjects];
    arr.sort((a: any, b: any) => {
      let av: number | string, bv: number | string;
      if (dealsSort.col === 'customer') { av = a.customerName ?? ''; bv = b.customerName ?? ''; }
      else if (dealsSort.col === 'kw') { av = a.kWSize; bv = b.kWSize; }
      else if (dealsSort.col === 'ppw') { av = a.netPPW; bv = b.netPPW; }
      else { av = (a.m1Amount ?? 0) + (a.m2Amount ?? 0) + (a.m3Amount ?? 0) + (a.setterM1Amount ?? 0) + (a.setterM2Amount ?? 0) + (a.setterM3Amount ?? 0); bv = (b.m1Amount ?? 0) + (b.m2Amount ?? 0) + (b.m3Amount ?? 0) + (b.setterM1Amount ?? 0) + (b.setterM2Amount ?? 0) + (b.setterM3Amount ?? 0); }
      if (av < bv) return dealsSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return dealsSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [approvedVisibleProjects, dealsSort]);
  const totalKW = useMemo(
    () => approvedVisibleProjects.reduce((s: number, p: any) => s + (isAdmin || isOwner ? p.kWSize : (p.closer?.id === effectiveRepId ? p.kWSize : 0)), 0),
    [approvedVisibleProjects, isAdmin, isOwner, effectiveRepId],
  );
  const totalCosts = useMemo(
    () => blitz?.costs?.reduce((s: number, c: any) => s + c.amount, 0) ?? 0,
    [blitz?.costs],
  );

  // Profitability (admin only — uses ALL projects, not filtered)
  // Kilo profit = spread between closer baseline and kilo baseline per deal
  // kiloMargin per deal = (closerPerW - kiloPerW) × kW × 1000, minus $0.10/W setter cost for split deals
  const getBlitzProjectBaselines = (p: any): { closerPerW: number; kiloPerW: number } => {
    if (p.baselineOverrideJson) return JSON.parse(p.baselineOverrideJson);
    if (p.installer?.name === 'SolarTech' && p.productId) {
      return getSolarTechBaseline(p.productId, p.kWSize, solarTechProducts);
    }
    if (p.productId) {
      return getProductCatalogBaseline(productCatalogProducts, p.productId, p.kWSize);
    }
    const installerName = typeof p.installer === 'string' ? p.installer : p.installer?.name ?? '';
    return getInstallerRatesForDeal(installerName, p.soldDate ?? '', p.kWSize, installerPricingVersions);
  };

  const kiloMargin = useMemo(() => {
    if (!blitz?.projects) return 0;
    return blitz.projects.filter((p: any) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s: number, p: any) => {
      const { closerPerW, kiloPerW } = getBlitzProjectBaselines(p);
      const setterCost = p.setterId ? 0.10 * p.kWSize * 1000 : 0;
      return s + (closerPerW - kiloPerW) * p.kWSize * 1000 - setterCost;
    }, 0);
  }, [blitz?.projects, installerPricingVersions, productCatalogProducts, solarTechProducts]);
  const netProfit = kiloMargin - totalCosts;
  const roi = totalCosts > 0 ? ((netProfit / totalCosts) * 100) : 0;

  // Cost breakdown by category
  const costsByCategory = useMemo(() => {
    if (!blitz?.costs) return {};
    const result: Record<string, number> = {};
    for (const c of blitz.costs) {
      result[c.category] = (result[c.category] ?? 0) + c.amount;
    }
    return result;
  }, [blitz?.costs]);

  // Available reps (not already participants)
  const availableReps = useMemo(() => {
    if (!blitz?.participants) return reps;
    const participantIds = new Set(blitz.participants.map((p: any) => p.user.id));
    return reps.filter((r) => r.active && !participantIds.has(r.id));
  }, [reps, blitz?.participants]);

  // ── Leaderboard + per-rep performance ────────────────────────────────
  // Shared by: overview leaderboard, participants tab leaderboard,
  // participants table deal counts, AND the Rep Performance analytics
  // card. Previously each location ran its own O(participants × projects)
  // scan inside an IIFE on every render — at 25 participants × 28
  // projects that was 700 comparisons × 4 locations = 2800 per render,
  // re-run on every tab switch and state change.
  //
  // New approach: one single walk through projects, attribute each deal's
  // (deals count, kW, and payout) to both closer and setter per the
  // blitz-payout split logic. Participant rows then hydrate in O(1) via
  // Map lookup.
  //
  // Payout formula (unchanged from the original per-row computation):
  //   closer + setter are SAME person (self-gen via blitz):
  //       full amount (m1 + m2 + m3 + setterM2 + setterM3)
  //   person is the setter (but not closer):
  //       setterM1 + setterM2 + setterM3
  //   person is the closer (with a separate setter):
  //       m1 + m2 + m3 (closer always gets m1Amount; setter gets setterM1Amount independently)
  //   person is the closer (no setter on project):
  //       m1 + m2 + m3
  type LeaderboardEntry = {
    userId: string;
    user: { id: string; firstName: string; lastName: string };
    name: string;
    initials: string;
    deals: number;
    kW: number;
    payout: number;
  };
  const leaderboard: LeaderboardEntry[] = useMemo(() => {
    const participants = (blitz?.participants ?? []).filter((p: any) => p.joinStatus === 'approved');
    if (participants.length === 0) return [];

    const participantIds = new Set(participants.map((p: any) => p.user.id));
    const statsByUserId = new Map<string, { deals: number; kW: number; payout: number }>();
    const bump = (userId: string, dKw: number, dPayout: number) => {
      const s = statsByUserId.get(userId) ?? { deals: 0, kW: 0, payout: 0 };
      s.deals += 1;
      s.kW += dKw;
      s.payout += dPayout;
      statsByUserId.set(userId, s);
    };

    for (const proj of blitz?.projects ?? []) {
      if (proj.phase === 'Cancelled' || proj.phase === 'On Hold') continue;
      const closerId = proj.closer?.id;
      const setterId = proj.setter?.id;
      const m1 = proj.m1Amount ?? 0;
      const m2 = proj.m2Amount ?? 0;
      const m3 = proj.m3Amount ?? 0;
      const sM1 = proj.setterM1Amount ?? 0;
      const sM2 = proj.setterM2Amount ?? 0;
      const sM3 = proj.setterM3Amount ?? 0;
      const kW = proj.kWSize;

      if (closerId && setterId && closerId === setterId) {
        // Same person closed and set (self-gen) — gets everything
        if (participantIds.has(closerId)) bump(closerId, kW, m1 + m2 + m3 + sM1 + sM2 + sM3);
      } else {
        if (closerId && participantIds.has(closerId)) {
          // Closer always gets M1/M2/M3; setter has separate setterM1Amount.
          const closerPayout = m1 + m2 + m3;
          bump(closerId, kW, closerPayout);
        }
        if (setterId && setterId !== closerId && participantIds.has(setterId)) {
          // Setter owns M1 when present, plus setterM2/M3.
          // kW is attributed to the closer; pass 0 here to avoid double-counting.
          bump(setterId, 0, sM1 + sM2 + sM3);
        }
      }
    }

    const entries: LeaderboardEntry[] = participants.map((p: any) => {
      const stats = statsByUserId.get(p.user.id) ?? { deals: 0, kW: 0, payout: 0 };
      return {
        userId: p.user.id,
        user: p.user, // full user object, so Rep Performance card can render firstName/lastName
        name: `${p.user.firstName ?? ''} ${p.user.lastName ?? ''}`.trim(),
        initials: `${(p.user.firstName?.[0] ?? '').toUpperCase()}${(p.user.lastName?.[0] ?? '').toUpperCase()}`,
        deals: stats.deals,
        kW: stats.kW,
        payout: stats.payout,
      };
    });
    entries.sort((a, b) => b.deals - a.deals || b.kW - a.kW);
    return entries;
  }, [blitz?.participants, blitz?.projects]);

  const handleSave = async () => {
    if (!editForm.name?.trim()) {
      toast('Blitz name is required', 'error');
      return;
    }
    if (editForm.startDate && editForm.endDate && editForm.endDate < editForm.startDate) {
      toast('End date must be on or after start date', 'error');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/blitzes/${blitzId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!r.ok) { toast('Failed to update blitz', 'error'); return; }
      const savedBlitz = await r.json();
      // If the owner changed, ensure they are an approved participant
      if (editForm.ownerId && blitz?.owner?.id !== editForm.ownerId) {
        const revertOwner = async () => {
          const rv = await fetch(`/api/blitzes/${blitzId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ownerId: blitz?.owner?.id ?? null }),
          });
          if (!rv.ok) throw new Error('revert_failed');
        };
        const existingParticipant = (savedBlitz.participants ?? []).find((p: any) => p.user.id === editForm.ownerId);
        if (!existingParticipant) {
          const pr = await fetch(`/api/blitzes/${blitzId}/participants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: editForm.ownerId, joinStatus: 'approved' }),
          });
          if (!pr.ok) {
            try { await revertOwner(); toast('Failed to add owner as participant — owner change reverted', 'error'); }
            catch { toast('Failed to add owner as participant — owner revert also failed, blitz is in inconsistent state', 'error'); }
            setEditing(false); loadBlitz(true); return;
          }
        } else if (existingParticipant.joinStatus !== 'approved') {
          const pr = await fetch(`/api/blitzes/${blitzId}/participants`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: editForm.ownerId, joinStatus: 'approved' }),
          });
          if (!pr.ok) {
            try { await revertOwner(); toast('Failed to approve owner as participant — owner change reverted', 'error'); }
            catch { toast('Failed to approve owner as participant — owner revert also failed, blitz is in inconsistent state', 'error'); }
            setEditing(false); loadBlitz(true); return;
          }
        }
      }
      toast('Blitz updated');
      setEditing(false);
      loadBlitz(true);
    } catch {
      toast('Network error — changes may not have been saved', 'error');
      setEditing(false);
      loadBlitz(true);
    } finally { setSaving(false); }
  };

  const handleAddParticipant = async () => {
    if (!selectedRepId) return;
    setAddingParticipant(true);
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedRepId, joinStatus: 'approved' }),
      });
      if (!r.ok) { toast('Failed to add participant', 'error'); return; }
      toast('Participant added');
      setShowAddParticipant(false);
      setSelectedRepId('');
      loadBlitz();
    } finally { setAddingParticipant(false); }
  };

  const handleRemoveParticipant = async (userId: string) => {
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/participants?userId=${userId}`, { method: 'DELETE' });
      if (!r.ok) { toast('Failed to remove participant', 'error'); return; }
      toast('Participant removed');
      loadBlitz();
    } catch {
      toast('Failed to remove participant', 'error');
    }
  };

  const handleUpdateAttendance = async (userId: string, attendanceStatus: string | null) => {
    if (updatingAttendance.has(userId)) return;
    setUpdatingAttendance((s) => new Set(s).add(userId));
    let r: Response;
    try {
      r = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, attendanceStatus }),
      });
    } catch {
      toast('Failed to update attendance', 'error');
      setUpdatingAttendance((s) => { const n = new Set(s); n.delete(userId); return n; });
      return;
    }
    if (!r.ok) {
      toast('Failed to update attendance', 'error');
      setUpdatingAttendance((s) => { const n = new Set(s); n.delete(userId); return n; });
      return;
    }
    fetch(`/api/blitzes/${blitzId}`).then((res) => res.json()).then((data) => {
      if (!data.error) setBlitz(data);
    }).finally(() => {
      setUpdatingAttendance((s) => { const n = new Set(s); n.delete(userId); return n; });
    });
  };

  const handleAddCost = async () => {
    if (!costAmount || parseFloat(costAmount) <= 0) return;
    setAddingCost(true);
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: costCategory, amount: parseFloat(costAmount), description: costDesc.trim(), date: costDate }),
      });
      if (!r.ok) { toast('Failed to add cost', 'error'); return; }
      toast('Cost added');
      setCostAmount('');
      setCostDesc('');
      const today = new Date();
      setCostDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
      setShowAddCost(false);
      loadBlitz();
    } finally { setAddingCost(false); }
  };

  const handleDeleteCost = async (costId: string) => {
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/costs?costId=${costId}`, { method: 'DELETE' });
      if (!r.ok) { toast('Failed to remove cost', 'error'); return; }
      toast('Cost removed');
      loadBlitz();
    } catch { toast('Failed to remove cost', 'error'); }
  };

  const handleDeleteBlitz = async () => {
    try {
      const res = await fetch(`/api/blitzes/${blitzId}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Blitz deleted');
        router.push('/dashboard/blitz');
      } else {
        toast('Failed to delete blitz', 'error');
      }
    } catch { toast('Failed to delete blitz', 'error'); }
  };

  const handleRequestCancellation = async (reason: string) => {
    setCancelRequesting(true);
    try {
      const res = await fetch('/api/blitz-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'cancel',
          requestedById: effectiveRepId,
          blitzId,
          name: blitz?.name ?? '',
          notes: reason,
          startDate: blitz?.startDate ?? '',
          endDate: blitz?.endDate ?? '',
        }),
      });
      if (res.ok) {
        toast('Cancellation request submitted for admin approval');
      } else {
        toast('Failed to submit cancellation request', 'error');
      }
    } catch {
      toast('Failed to submit cancellation request', 'error');
    } finally {
      setCancelRequesting(false);
    }
  };

  if (isMobile) return <MobileBlitzDetail blitzId={blitzId} />;

  if (!hydrated || loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-[var(--border)]/40" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/60 animate-spin" />
      </div>
      <p className="text-sm text-[var(--text-muted)] font-medium">Loading blitz details...</p>
    </div>
  );
  if (!blitz) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <XCircle className="w-14 h-14 text-[var(--text-dim)]" />
      <p className="text-lg font-semibold text-white">Blitz not found</p>
      <p className="text-sm text-[var(--text-muted)]">It may have been deleted or the link is invalid</p>
      <Link href="/dashboard/blitz" className="mt-2 px-4 py-2 text-sm font-semibold bg-[var(--surface-card)] text-[var(--text-secondary)] border border-[var(--border)] rounded-lg hover:bg-[var(--border)] transition-colors">
        Back to Blitzes
      </Link>
    </div>
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'participants', label: `Participants (${approvedParticipants.length})` },
    { key: 'deals', label: `Deals (${totalDeals})` },
    ...(isAdmin ? [
      { key: 'costs' as TabKey, label: `Costs (${blitz.costs?.length ?? 0})` },
      { key: 'profitability' as TabKey, label: 'Profitability' },
    ] : []),
  ];

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Back + header */}
      <div>
        <Link href="/dashboard/blitz" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to Blitzes
        </Link>

        {editing ? (
          /* ── Full edit form ── */
          <div className="card-surface rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Edit Blitz</h2>
              <div className="flex items-center gap-2">
                <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))} className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs font-medium text-white">
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Blitz Name</label>
              <input autoFocus value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none" onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Location</label>
                <input value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Housing / Address</label>
                <input value={editForm.housing} onChange={(e) => setEditForm((f) => ({ ...f, housing: e.target.value }))} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Start Date</label>
                <input type="date" value={editForm.startDate} onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">End Date</label>
                <input type="date" value={editForm.endDate} onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Blitz Leader</label>
                <select value={editForm.ownerId} onChange={(e) => setEditForm((f) => ({ ...f, ownerId: e.target.value }))} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none">
                  {(() => {
                    const activeReps = reps.filter((r) => r.active);
                    const currentOwnerInList = activeReps.some((r) => r.id === blitz?.owner?.id);
                    return (
                      <>
                        {!currentOwnerInList && blitz?.owner && (
                          <option key={blitz.owner.id} value={blitz.owner.id}>{blitz.owner.firstName} {blitz.owner.lastName}</option>
                        )}
                        {activeReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </>
                    );
                  })()}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[var(--accent-green)] focus:border-transparent outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setEditing(false); if (blitz) setEditForm({ name: blitz.name, location: blitz.location, housing: blitz.housing, startDate: blitz.startDate, endDate: blitz.endDate, notes: blitz.notes, status: blitz.status, ownerId: blitz.owner?.id ?? '' }); }} disabled={saving} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-white disabled:opacity-50 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[var(--accent-green)] text-black rounded-lg hover:bg-[var(--accent-green)] disabled:opacity-50 transition-colors">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        ) : (
          /* ── Read-only header ── */
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">{blitz.name}</h1>
                {(() => { const s = STATUS_STYLES[blitz.status] ?? STATUS_STYLES.upcoming; return (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${s.bg} ${s.text} ${s.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${blitz.status === 'active' ? 'animate-pulse' : ''}`} />
                    {blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1)}
                  </span>
                ); })()}
              </div>
              <div className="flex flex-wrap gap-3 mt-2 text-sm text-[var(--text-secondary)]">
                {blitz.location && <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{blitz.location}</span>}
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{formatDate(blitz.startDate)} — {formatDate(blitz.endDate)}</span>
                {blitz.housing && <span className="flex items-center gap-1.5"><Home className="w-3.5 h-3.5" />{blitz.housing}</span>}
              </div>
            </div>
            {isAdmin ? (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border)] rounded-lg hover:text-white hover:border-[var(--border)] transition-colors"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                <button onClick={() => setConfirmAction({ title: 'Delete this blitz?', message: `Permanently delete "${blitz.name}"? This will remove all participants, costs, and associated data. This cannot be undone.`, onConfirm: () => { handleDeleteBlitz(); setConfirmAction(null); }, confirmLabel: 'Delete' })} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-900/20 transition-colors"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            ) : canRequestBlitz && (blitz.status === 'upcoming' || blitz.status === 'active') && (blitz.ownerId === effectiveRepId || blitz.createdById === effectiveRepId) && (
              <button
                disabled={cancelRequesting}
                onClick={() => { setCancelReason(''); setShowCancelDialog(true); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-900/20 transition-colors shrink-0 disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" /> {cancelRequesting ? 'Submitting...' : 'Request Cancellation'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-[var(--border-subtle)]/50 overflow-x-auto tab-bar-container">
        {tabIndicator && <div className="tab-indicator" style={tabIndicator} />}
        {tabs.map((t, i) => (
          <button key={t.key} ref={(el) => { tabRefs.current[i] = el; }} onClick={() => setTab(t.key)} className={`relative z-10 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (<div key="overview" className="animate-tab-enter">{(() => {
        const startMs = new Date(blitz.startDate + 'T00:00:00').getTime();
        const endMs = new Date(blitz.endDate + 'T00:00:00').getTime();
        const nowMs = new Date().setHours(0, 0, 0, 0);
        const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
        const elapsed = Math.max(0, Math.min(totalDays, Math.round((nowMs - startMs) / 86400000) + 1));
        const progressPct = blitz.status === 'completed' ? 100 : blitz.status === 'active' ? Math.round((elapsed / totalDays) * 100) : 0;
        const approvedIds = new Set((blitz?.participants ?? []).filter((pt: any) => pt.joinStatus === 'approved').map((pt: any) => pt.user.id));

        return (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card-surface rounded-2xl p-4 animate-slide-in-scale stagger-0">
              <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Participants</p>
              <p className="text-2xl font-bold text-white">{approvedParticipants.length}</p>
            </div>
            <div className="card-surface rounded-2xl p-4 animate-slide-in-scale stagger-1">
              <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Deals</p>
              <p className="text-2xl font-bold text-white">{totalDeals}</p>
            </div>
            <div className="card-surface rounded-2xl p-4 animate-slide-in-scale stagger-2">
              <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Total kW</p>
              <p className="text-2xl font-bold text-white">{formatCompactKW(totalKW)}</p>
            </div>
            {isAdmin ? (
              <div className="card-surface rounded-2xl p-4 animate-slide-in-scale stagger-3">
                <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Net Profit</p>
                <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-[var(--accent-green)]' : 'text-red-400'}`}>{formatCurrency(netProfit)}</p>
              </div>
            ) : (
              <div className="card-surface rounded-2xl p-4 animate-slide-in-scale stagger-3">
                <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> My Pay</p>
                <p className="text-2xl font-bold text-[var(--accent-green)]">{formatCurrency(visibleProjects.reduce((s: number, p: any) => { return s + (p.closer?.id === effectiveRepId ? (p.setter?.id === effectiveRepId ? (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) : (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0)) : (p.setter?.id === effectiveRepId ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) : 0)); }, 0))}</p>
              </div>
            )}
          </div>

          {/* Rep personal blitz summary */}
          {!isAdmin && effectiveRepId && visibleProjects.length > 0 && (
            <div className="card-surface border-l-2 border-l-blue-500/60 rounded-2xl p-4">
              <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider mb-3">Your Blitz Summary</p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-white">{visibleProjects.filter((p: any) => p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId).length}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Deal{visibleProjects.filter((p: any) => p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId).length !== 1 ? 's' : ''} Attributed</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{visibleProjects.filter((p: any) => p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId).reduce((s: number, p: any) => s + (p.closer?.id === effectiveRepId ? p.kWSize : 0), 0).toFixed(1)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">kW Sold</p>
                </div>
                <div>
                    <p className="text-2xl font-bold text-[var(--accent-green)]">{formatCurrency(visibleProjects.reduce((s: number, p: any) => { return s + (p.closer?.id === effectiveRepId ? (p.setter?.id === effectiveRepId ? (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) : (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0)) : (p.setter?.id === effectiveRepId ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) : 0)); }, 0))}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Projected Pay</p>
                </div>
              </div>
            </div>
          )}

          {/* Timeline progress bar */}
          {(blitz.status === 'active' || blitz.status === 'completed') && (
            <div className="card-surface rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[var(--text-muted)] font-medium">Progress</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {blitz.status === 'completed' ? 'Completed' : `Day ${elapsed} of ${totalDays}`}
                </p>
              </div>
              <div className="w-full bg-[var(--surface-card)] rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${blitz.status === 'completed' ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-green)]'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-[var(--text-dim)]">
                <span>{formatDate(blitz.startDate)}</span>
                <span>{formatDate(blitz.endDate)}</span>
              </div>
            </div>
          )}

          {/* Leaderboard on overview (active/completed blitzes with deals).
              Uses the shared `leaderboard` memo — computed once per render
              instead of re-running the O(participants × projects) scan
              inside an IIFE. */}
          {(blitz.status === 'active' || blitz.status === 'completed') && leaderboard.length > 0 && (() => {
            const RANK_GRADIENTS_OV = ['from-yellow-400 to-amber-600', 'from-slate-300 to-slate-500', 'from-amber-600 to-amber-800'];
            const RANK_BG_OV = ['bg-yellow-900/20 border-yellow-600/30', 'bg-[var(--surface-card)]/40 border-[var(--border)]/30', 'bg-amber-900/20 border-amber-700/30'];
            const RANK_TEXT_OV = ['text-yellow-400', 'text-[var(--text-secondary)]', 'text-amber-400'];
            return (
              <div className="card-surface rounded-2xl p-4">
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2"><Trophy className="w-3.5 h-3.5 text-amber-400" /> Leaderboard</h3>
                <div className="space-y-2">
                  {leaderboard.slice(0, 5).map((rep, idx) => {
                    const rank = idx + 1;
                    const isTop3 = rank <= 3;
                    return (
                      <div key={rep.userId} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${isTop3 ? RANK_BG_OV[rank - 1] : 'bg-[var(--surface)]/40 border-[var(--border-subtle)]/40'}`}>
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isTop3 ? `bg-gradient-to-br ${RANK_GRADIENTS_OV[rank - 1]} text-white` : 'bg-[var(--surface-card)] text-[var(--text-secondary)]'}`}>{rank}</span>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isTop3 ? `bg-gradient-to-br ${RANK_GRADIENTS_OV[rank - 1]} text-white` : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>{rep.initials}</div>
                        <Link href={`/dashboard/users/${rep.userId}`} className={`flex-1 text-sm font-medium truncate hover:text-[var(--accent-cyan)] transition-colors ${isTop3 ? RANK_TEXT_OV[rank - 1] : 'text-[var(--text-secondary)]'}`}>{rep.name}</Link>
                        <span className="text-xs text-[var(--text-secondary)] tabular-nums">{rep.deals} deal{rep.deals !== 1 ? 's' : ''}</span>
                        <span className="text-xs text-[var(--text-muted)] tabular-nums">{rep.kW.toFixed(1)} kW</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Blitz details */}
            <div className="card-surface rounded-2xl p-4 space-y-3">
              <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">Details</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Leader</span>
                  <Link href={`/dashboard/users/${blitz.owner.id}`} className="text-white font-medium hover:text-[var(--accent-cyan)] transition-colors">{blitz.owner.firstName} {blitz.owner.lastName}</Link>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Duration</span>
                  <span className="text-white">{totalDays} days</span>
                </div>
                {blitz.location && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Location</span>
                    <span className="text-white">{blitz.location}</span>
                  </div>
                )}
                {blitz.housing && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Housing</span>
                    <span className="text-white">{blitz.housing}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Participant avatars / quick list */}
            <div className="card-surface rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">Team</p>
                <button onClick={() => setTab('participants')} className="text-xs text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors">View all</button>
              </div>
              {approvedParticipants.length === 0 ? (
                <p className="text-sm text-[var(--text-dim)]">No participants yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {approvedParticipants.slice(0, 8).map((p: any) => (
                    <Link key={p.user.id} href={`/dashboard/users/${p.user.id}`} className="flex items-center gap-1.5 bg-[var(--surface-card)]/60 border border-[var(--border)]/50 rounded-full px-2.5 py-1 hover:border-[var(--accent-green)]/40 hover:bg-[var(--surface-card)] transition-colors">
                      <div className="w-5 h-5 rounded-full bg-[var(--accent-green)]/30 border border-[var(--accent-green)]/30 flex items-center justify-center text-[10px] font-bold text-[var(--accent-cyan)]">
                        {(p.user.firstName?.[0] ?? '').toUpperCase()}{(p.user.lastName?.[0] ?? '').toUpperCase()}
                      </div>
                      <span className="text-xs text-[var(--text-secondary)]">{p.user.firstName}</span>
                    </Link>
                  ))}
                  {approvedParticipants.length > 8 && (
                    <div className="flex items-center px-2.5 py-1 text-xs text-[var(--text-muted)]">+{approvedParticipants.length - 8} more</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {blitz.notes && (
            <div className="card-surface rounded-2xl p-4">
              <p className="text-xs text-[var(--text-muted)] mb-1 font-medium uppercase tracking-wider">Notes</p>
              <p className="text-sm text-[var(--text-secondary)]">{blitz.notes}</p>
            </div>
          )}
        </div>
        );
      })()}</div>)}

      {/* Participants */}
      {tab === 'participants' && (
        <div key="participants" className="animate-tab-enter space-y-4">
          {/* Mini-leaderboard — same shared `leaderboard` memo as the
              overview panel. No second scan. */}
          {(blitz.status === 'active' || blitz.status === 'completed') && leaderboard.length > 0 && (() => {
            const RANK_GRADIENTS = [
              'from-yellow-400 to-amber-600',
              'from-slate-300 to-slate-500',
              'from-amber-600 to-amber-800',
            ];
            const RANK_BG = [
              'bg-yellow-900/20 border-yellow-600/30',
              'bg-[var(--surface-card)]/40 border-[var(--border)]/30',
              'bg-amber-900/20 border-amber-700/30',
            ];
            const RANK_TEXT = ['text-yellow-400', 'text-[var(--text-secondary)]', 'text-amber-400'];
            return (
              <div className="card-surface rounded-2xl p-4">
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Leaderboard</h3>
                <div className="space-y-2">
                  {leaderboard.slice(0, 5).map((rep, idx) => {
                    const rank = idx + 1;
                    const isTop3 = rank <= 3;
                    return (
                      <div key={rep.userId} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${isTop3 ? RANK_BG[rank - 1] : 'bg-[var(--surface)]/40 border-[var(--border-subtle)]/40'}`}>
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          isTop3 ? `bg-gradient-to-br ${RANK_GRADIENTS[rank - 1]} text-white` : 'bg-[var(--surface-card)] text-[var(--text-secondary)]'
                        }`}>
                          {rank}
                        </span>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          isTop3 ? `bg-gradient-to-br ${RANK_GRADIENTS[rank - 1]} text-white` : 'bg-[var(--border)] text-[var(--text-secondary)]'
                        }`}>
                          {rep.initials}
                        </div>
                        <Link href={`/dashboard/users/${rep.userId}`} className={`flex-1 text-sm font-medium truncate hover:text-[var(--accent-cyan)] transition-colors ${isTop3 ? RANK_TEXT[rank - 1] : 'text-[var(--text-secondary)]'}`}>{rep.name}</Link>
                        <span className="text-xs text-[var(--text-secondary)] tabular-nums whitespace-nowrap">{rep.deals} deal{rep.deals !== 1 ? 's' : ''}</span>
                        <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">{rep.kW.toFixed(1)} kW</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {canManage && (
            <div className="flex justify-end">
              <button onClick={() => setShowAddParticipant(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[var(--accent-green)] text-black rounded-lg hover:bg-[var(--accent-green)] transition-colors"><UserPlus className="w-4 h-4" /> Add Rep</button>
            </div>
          )}
          {blitz.participants?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-[var(--surface)]/30 border border-dashed border-[var(--border-subtle)]">
              <Users className="w-12 h-12 text-[var(--text-dim)]" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">No participants yet</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">Add reps to this blitz to start tracking participation</p>
              </div>
              {canManage && (
                <button onClick={() => setShowAddParticipant(true)} className="mt-1 px-4 py-2 text-sm font-semibold bg-[var(--accent-green)]/20 text-[var(--accent-green)] border border-[var(--accent-green)]/30 rounded-lg hover:bg-[var(--accent-green)]/30 transition-colors">
                  <span className="flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Add Rep</span>
                </button>
              )}
            </div>
          ) : (
            <div className="card-surface rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="table-header-frost"><tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Rep</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Deals</th>
                  <th className="text-right px-4 py-3">kW</th>
                  <th className="text-left px-4 py-3">Attendance</th>
                  {canManage && <th className="text-right px-4 py-3">Actions</th>}
                </tr></thead>
                <tbody>
                  {(() => {
                    // Lookup map from the already-computed leaderboard memo.
                    // Replaces a fresh O(projects) scan per participant row —
                    // was N×P per render, now just N map lookups.
                    const statsByUserId = new Map(leaderboard.map((r) => [r.userId, r]));
                    return blitz.participants.map((p: any, idx: number) => {
                    const stats = p.joinStatus === 'approved' ? statsByUserId.get(p.user.id) : null;
                    const repDealCount = stats?.deals ?? 0;
                    const repKW = stats?.kW ?? 0;
                    return (
                    <tr key={p.id} className={`border-b border-[var(--border-subtle)]/50 last:border-0 hover:bg-[var(--surface-card)]/40 transition-colors ${idx % 2 === 0 ? 'bg-[var(--surface)]/20' : ''}`}>
                      <td className="px-4 py-3 text-white font-medium"><Link href={`/dashboard/users/${p.user.id}`} className="hover:text-[var(--accent-cyan)] transition-colors">{p.user.firstName} {p.user.lastName}</Link></td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.joinStatus === 'approved' ? 'bg-emerald-900/30 text-emerald-300' : p.joinStatus === 'pending' ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300'}`}>
                          {p.joinStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">{repDealCount || <span className="text-[var(--text-dim)]">—</span>}</td>
                      <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">{repKW > 0 ? repKW.toFixed(1) : <span className="text-[var(--text-dim)]">—</span>}</td>
                      <td className="px-4 py-3">
                        {canManage && p.joinStatus === 'approved' ? (
                          <select value={p.attendanceStatus ?? ''} onChange={(e) => handleUpdateAttendance(p.user.id, e.target.value || null)} disabled={updatingAttendance.has(p.user.id)} className="bg-[var(--surface-card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-white disabled:opacity-50 disabled:cursor-not-allowed">
                            <option value="">—</option>
                            <option value="attended">Attended</option>
                            <option value="partial">Partial</option>
                            <option value="no_show">No-show</option>
                          </select>
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)]">{p.attendanceStatus ?? '—'}</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          {p.joinStatus === 'pending' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button disabled={processingParticipants.has(p.user.id)} onClick={() => { const uid = p.user.id; setProcessingParticipants((s) => new Set(s).add(uid)); fetch(`/api/blitzes/${blitzId}/participants`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid, joinStatus: 'approved' }) }).then((r) => { if (r.ok) { toast('Approved'); loadBlitz(); } else { toast('Failed to approve', 'error'); } }).finally(() => { setProcessingParticipants((s) => { const n = new Set(s); n.delete(uid); return n; }); }); }} className="px-2 py-1 text-[11px] font-semibold bg-[var(--accent-green)] text-black rounded hover:bg-[var(--accent-green)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Approve</button>
                              <button disabled={processingParticipants.has(p.user.id)} onClick={() => { const uid = p.user.id; setProcessingParticipants((s) => new Set(s).add(uid)); fetch(`/api/blitzes/${blitzId}/participants`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid, joinStatus: 'declined' }) }).then((r) => { if (r.ok) { toast('Declined'); loadBlitz(); } else { toast('Failed to decline', 'error'); } }).finally(() => { setProcessingParticipants((s) => { const n = new Set(s); n.delete(uid); return n; }); }); }} className="px-2 py-1 text-[11px] font-semibold bg-red-600/20 text-red-400 border border-red-500/30 rounded hover:bg-red-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Decline</button>
                            </div>
                          ) : (
                            p.user.id !== blitz.owner.id && <button onClick={() => setConfirmAction({ title: `Remove ${p.user.firstName} ${p.user.lastName}?`, message: 'This will permanently remove them from the blitz. Deals where their co-participant (closer or setter) is also no longer in the blitz will be unlinked; deals where the co-participant remains will stay linked to the blitz. This cannot be undone.', onConfirm: () => { handleRemoveParticipant(p.user.id); setConfirmAction(null); } })} className="text-[var(--text-dim)] hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </td>
                      )}
                    </tr>
                    );
                  });
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* Add participant modal */}
          {showAddParticipant && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-modal-backdrop" onClick={() => { setShowAddParticipant(false); setSelectedRepId(''); }}>
              <div className="bg-[var(--surface)] border border-[var(--border)]/80 rounded-2xl p-6 w-full max-w-sm shadow-2xl shadow-black/40 animate-modal-panel" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-4">Add Participant</h3>
                <select value={selectedRepId} onChange={(e) => setSelectedRepId(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white mb-4">
                  <option value="">Select a rep...</option>
                  {availableReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowAddParticipant(false); setSelectedRepId(''); }} className="px-3 py-2 text-sm text-[var(--text-secondary)]">Cancel</button>
                  <button onClick={handleAddParticipant} disabled={!selectedRepId || addingParticipant} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[var(--accent-green)] text-black rounded-lg hover:bg-[var(--accent-green)] disabled:opacity-40 transition-colors">{addingParticipant ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{addingParticipant ? 'Adding...' : 'Add'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deals */}
      {tab === 'deals' && (
        <div key="deals" className="animate-tab-enter space-y-3">
          {visibleProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-[var(--surface)]/30 border border-dashed border-[var(--border-subtle)]">
              <FolderKanban className="w-12 h-12 text-[var(--text-dim)]" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">No deals yet</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">{isAdmin || isOwner ? 'Deals attributed to this blitz will appear here' : 'Your deals attributed to this blitz will appear here'}</p>
              </div>
            </div>
          ) : (
            <div className="card-surface rounded-2xl overflow-x-clip">
              <table className="w-full text-sm">
                <thead className="table-header-frost sticky top-0 z-10"><tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="text-left px-4 py-3">
                    <button onClick={() => setDealsSort(s => s.col === 'customer' ? { col: 'customer', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'customer', dir: 'desc' })} className="flex items-center gap-1 cursor-pointer select-none group/th hover:text-[var(--text-secondary)] transition-colors">
                      Customer<span className={'transition-transform duration-150 inline-block ' + (dealsSort.col === 'customer' ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40')}><ChevronUp className={'w-3 h-3' + (dealsSort.col === 'customer' && dealsSort.dir === 'desc' ? ' rotate-180' : '')} /></span>
                    </button>
                  </th>
                  <th className="text-left px-4 py-3">Closer</th>
                  {!isAdmin && !isOwner && <th className="text-left px-4 py-3">Role</th>}
                  <th className="text-left px-4 py-3">Phase</th>
                  <th className="text-right px-4 py-3">
                    <button onClick={() => setDealsSort(s => s.col === 'kw' ? { col: 'kw', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'kw', dir: 'desc' })} className="flex items-center gap-1 cursor-pointer select-none group/th hover:text-[var(--text-secondary)] transition-colors ml-auto">
                      kW<span className={'transition-transform duration-150 inline-block ' + (dealsSort.col === 'kw' ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40')}><ChevronUp className={'w-3 h-3' + (dealsSort.col === 'kw' && dealsSort.dir === 'desc' ? ' rotate-180' : '')} /></span>
                    </button>
                  </th>
                  <th className="text-right px-4 py-3">
                    <button onClick={() => setDealsSort(s => s.col === 'ppw' ? { col: 'ppw', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'ppw', dir: 'desc' })} className="flex items-center gap-1 cursor-pointer select-none group/th hover:text-[var(--text-secondary)] transition-colors ml-auto">
                      Net PPW<span className={'transition-transform duration-150 inline-block ' + (dealsSort.col === 'ppw' ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40')}><ChevronUp className={'w-3 h-3' + (dealsSort.col === 'ppw' && dealsSort.dir === 'desc' ? ' rotate-180' : '')} /></span>
                    </button>
                  </th>
                  {isAdmin && <th className="text-right px-4 py-3">
                    <button onClick={() => setDealsSort(s => s.col === 'payout' ? { col: 'payout', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'payout', dir: 'desc' })} className="flex items-center gap-1 cursor-pointer select-none group/th hover:text-[var(--text-secondary)] transition-colors ml-auto">
                      Payout<span className={'transition-transform duration-150 inline-block ' + (dealsSort.col === 'payout' ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40')}><ChevronUp className={'w-3 h-3' + (dealsSort.col === 'payout' && dealsSort.dir === 'desc' ? ' rotate-180' : '')} /></span>
                    </button>
                  </th>}
                </tr></thead>
                <tbody>
                  {sortedDeals.map((p: any, idx: number) => (
                    <tr key={p.id} className={`border-b border-[var(--border-subtle)]/50 last:border-0 hover:bg-[var(--surface-card)]/40 transition-colors ${idx % 2 === 0 ? 'bg-[var(--surface)]/20' : ''}`}>
                      <td className={'px-4 py-3' + (dealsSort.col === 'customer' ? ' bg-[var(--surface-card)]/20' : '')}>
                        <Link href={`/dashboard/projects/${p.id}`} className="text-white font-medium hover:text-[var(--accent-cyan)] transition-colors">{p.customerName}</Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{p.closer?.id ? <Link href={`/dashboard/users/${p.closer.id}`} className="hover:text-[var(--accent-cyan)] transition-colors">{p.closer?.firstName} {p.closer?.lastName}</Link> : <>{p.closer?.firstName} {p.closer?.lastName}</>}</td>
                      {!isAdmin && !isOwner && <td className="px-4 py-3 text-[var(--text-secondary)]">{p.closer?.id === effectiveRepId && p.setter?.id === effectiveRepId ? 'Self-gen' : p.closer?.id === effectiveRepId ? 'Closer' : 'Setter'}</td>}
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${PHASE_COLORS[p.phase] ?? 'bg-[var(--surface-card)]/40 text-[var(--text-secondary)] border-[var(--border)]/30'}`}>{p.phase}</span>
                      </td>
                      <td className={'px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums' + (dealsSort.col === 'kw' ? ' bg-[var(--surface-card)]/20' : '')}>{p.kWSize.toFixed(1)}</td>
                      <td className={'px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums' + (dealsSort.col === 'ppw' ? ' bg-[var(--surface-card)]/20' : '')}>${p.netPPW.toFixed(2)}</td>
                      {isAdmin && <td className={'px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums' + (dealsSort.col === 'payout' ? ' bg-[var(--surface-card)]/20' : '')}>{formatCurrency((p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0))}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--border)] bg-[var(--surface-card)]/30">
                    <td colSpan={!isAdmin && !isOwner ? 4 : 3} className="px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]">{sortedDeals.length} deal{sortedDeals.length !== 1 ? 's' : ''}</td>
                    <td className={'px-4 py-3 text-right text-sm font-bold text-white tabular-nums' + (dealsSort.col === 'kw' ? ' bg-[var(--surface-card)]/20' : '')}>{totalKW.toFixed(1)} kW</td>
                    <td className="px-4 py-3 text-right text-sm text-[var(--text-muted)]">—</td>
                    {isAdmin && <td className={'px-4 py-3 text-right text-sm font-bold text-white tabular-nums' + (dealsSort.col === 'payout' ? ' bg-[var(--surface-card)]/20' : '')}>{formatCurrency(approvedVisibleProjects.reduce((s: number, p: any) => s + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0), 0))}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Costs (admin only) */}
      {tab === 'costs' && isAdmin && (
        <div key="costs" className="animate-tab-enter space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAddCost(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[var(--accent-green)] text-black rounded-lg hover:bg-[var(--accent-green)] transition-colors"><Plus className="w-4 h-4" /> Add Cost</button>
          </div>

          {showAddCost && (
            <div className="card-surface rounded-2xl p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <select value={costCategory} onChange={(e) => setCostCategory(e.target.value)} className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white">
                  {COST_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
                <input type="number" value={costAmount} onChange={(e) => setCostAmount(e.target.value)} placeholder="Amount" className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white" />
                <input value={costDesc} onChange={(e) => setCostDesc(e.target.value)} placeholder="Description" className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white" />
                <input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} className="bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddCost(false)} className="px-3 py-1.5 text-sm text-[var(--text-secondary)]">Cancel</button>
                <button onClick={handleAddCost} disabled={addingCost || !costAmount || parseFloat(costAmount) <= 0} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-[var(--accent-green)] text-black rounded-lg hover:bg-[var(--accent-green)] disabled:opacity-50 transition-colors">{addingCost ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{addingCost ? 'Adding...' : 'Add Cost'}</button>
              </div>
            </div>
          )}

          {blitz.costs?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-[var(--surface)]/30 border border-dashed border-[var(--border-subtle)]">
              <DollarSign className="w-12 h-12 text-[var(--text-dim)]" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">No costs recorded</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">Track housing, travel, meals, and other blitz expenses</p>
              </div>
              <button onClick={() => setShowAddCost(true)} className="mt-1 px-4 py-2 text-sm font-semibold bg-[var(--accent-green)]/20 text-[var(--accent-green)] border border-[var(--accent-green)]/30 rounded-lg hover:bg-[var(--accent-green)]/30 transition-colors">
                <span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add Cost</span>
              </button>
            </div>
          ) : (
            <div className="card-surface rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="table-header-frost"><tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr></thead>
                <tbody>
                  {blitz.costs.map((c: any, idx: number) => (
                    <tr key={c.id} className={`border-b border-[var(--border-subtle)]/50 last:border-0 hover:bg-[var(--surface-card)]/40 transition-colors ${idx % 2 === 0 ? 'bg-[var(--surface)]/20' : ''}`}>
                      <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${COST_CATEGORY_STYLES[c.category]?.badge ?? COST_CATEGORY_STYLES.other.badge}`}>{c.category}</span></td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{c.description || '—'}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{formatDate(c.date)}</td>
                      <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setConfirmAction({ title: 'Delete this cost?', message: `Remove the ${c.category} cost of ${formatCurrency(c.amount)}? This cannot be undone.`, onConfirm: () => { handleDeleteCost(c.id); setConfirmAction(null); } })} className="text-[var(--text-dim)] hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-[var(--border)] bg-[var(--surface-card)]/30">
                    <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]">Total</td>
                    <td className="px-4 py-3 text-right text-lg font-bold text-white">{formatCurrency(totalCosts)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Profitability (admin only) */}
      {tab === 'profitability' && isAdmin && (
        <div key="profitability" className="animate-tab-enter space-y-6">
          {/* Top-level P&L */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-0" style={{ '--card-accent': 'var(--accent-cyan)' } as React.CSSProperties}>
              <p className="text-xs text-[var(--text-muted)] mb-1">Kilo Margin</p>
              <p className="text-2xl font-bold text-[var(--accent-green)]">{formatCurrency(Math.round(kiloMargin))}</p>
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Baseline spread × kW</p>
            </div>
            <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-1" style={{ '--card-accent': '#f59e0b' } as React.CSSProperties}>
              <p className="text-xs text-[var(--text-muted)] mb-1">Blitz Costs</p>
              <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalCosts)}</p>
            </div>
            <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-2" style={{ '--card-accent': 'var(--accent-green)' } as React.CSSProperties}>
              <p className="text-xs text-[var(--text-muted)] mb-1">Net Profit</p>
              <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-[var(--accent-green)]' : 'text-red-400'}`}>{formatCurrency(Math.round(netProfit))}</p>
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Margin − Costs</p>
            </div>
            <div className="card-surface card-surface-stat rounded-2xl p-4 animate-slide-in-scale stagger-3" style={{ '--card-accent': '#8b5cf6' } as React.CSSProperties}>
              <p className="text-xs text-[var(--text-muted)] mb-1">ROI</p>
              <p className={`text-2xl font-bold flex items-center gap-1.5 ${roi > 100 ? 'text-[var(--accent-green)]' : roi >= 0 ? 'text-[var(--accent-green)]' : 'text-red-400'}`}>
                {roi.toFixed(0)}%
                {roi >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              </p>
            </div>
          </div>

          {/* Cost breakdown */}
          {Object.keys(costsByCategory).length > 0 && (
            <div className="card-surface rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">Cost Breakdown</h3>
              <div className="space-y-2">
                {Object.entries(costsByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                  const pct = totalCosts > 0 ? (amt / totalCosts) * 100 : 0;
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full w-22 text-center ${COST_CATEGORY_STYLES[cat]?.badge ?? COST_CATEGORY_STYLES.other.badge}`}>{cat}</span>
                      <div className="flex-1 bg-[var(--surface-card)] rounded-full h-2 overflow-hidden">
                        <div className={`${COST_CATEGORY_STYLES[cat]?.bar ?? 'bg-[var(--text-muted)]'} h-full rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-medium text-white w-20 text-right">{formatCurrency(amt)}</span>
                      <span className="text-xs text-[var(--text-muted)] w-12 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-rep performance — uses the shared `leaderboard` memo
              which now carries deals/kW/payout per approved participant.
              Renamed fields from the memo (kW → kw) to match the
              downstream render. */}
          {approvedParticipants.length > 0 && blitz.projects?.length > 0 && (() => {
            const repStats = leaderboard.map((r) => ({ user: r.user, deals: r.deals, kw: r.kW, payout: r.payout }));
            const maxKW = Math.max(...repStats.map((r) => r.kw), 1);

            return (
            <div className="card-surface rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">Rep Performance</h3>
              <div className="space-y-3">
                {repStats.map((rep: { user: { id: string; firstName: string; lastName: string }; deals: number; kw: number; payout: number }, idx: number) => (
                  <div key={rep.user.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : idx === 1 ? 'bg-[var(--text-muted)]/20 text-[var(--text-secondary)] border border-[var(--border-subtle)]/30' : idx === 2 ? 'bg-orange-800/30 text-orange-300 border border-orange-700/30' : 'bg-[var(--surface-card)] text-[var(--text-muted)] border border-[var(--border)]'}`}>
                          {idx + 1}
                        </div>
                        <Link href={`/dashboard/users/${rep.user.id}`} className="text-sm text-white font-medium hover:text-[var(--accent-cyan)] transition-colors">{rep.user.firstName} {rep.user.lastName}</Link>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-[var(--text-secondary)]">{rep.deals} deal{rep.deals !== 1 ? 's' : ''}</span>
                        <span className="text-[var(--text-secondary)] font-semibold">{rep.kw.toFixed(1)} kW</span>
                        <span className="text-[var(--accent-green)] font-semibold">{formatCurrency(rep.payout)}</span>
                      </div>
                    </div>
                    <div className="w-full bg-[var(--surface-card)] rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-[var(--text-muted)]' : idx === 2 ? 'bg-orange-600' : 'bg-[var(--text-dim)]'}`}
                        style={{ width: `${(rep.kw / maxKW) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            );
          })()}
        </div>
      )}

      {/* Cancellation request dialog with reason input */}
      {showCancelDialog && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCancelDialog(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-white font-bold mb-1">Request Blitz Cancellation?</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">This will send a cancellation request for &quot;{blitz.name}&quot; to an admin for approval. The blitz will remain active until approved.</p>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Reason <span className="text-[var(--text-dim)]">(optional)</span></label>
            <textarea
              className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder-[var(--text-dim)] resize-none focus:outline-none focus:border-[var(--text-dim)] mb-4"
              rows={3}
              placeholder="Let the admin know why you're requesting cancellation…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelDialog(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--text-dim)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowCancelDialog(false); handleRequestCancellation(cancelReason.trim() || 'No reason provided'); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 transition-colors"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation dialog for destructive actions */}
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
