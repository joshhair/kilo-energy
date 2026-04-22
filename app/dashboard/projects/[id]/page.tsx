'use client';

import { use, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileProjectDetail from '../../mobile/MobileProjectDetail';
import {
  PHASES, Phase, InstallerBaseline,
  getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal,
  calculateCommission, resolveTrainerRate,
  DEFAULT_INSTALL_PAY_PCT,
} from '../../../../lib/data';
import { formatDate } from '../../../../lib/utils';
import { Flag, FlagOff, AlertTriangle, X, Pencil, ChevronLeft, ChevronRight, Copy, Trash2 } from 'lucide-react';
import { SearchableSelect } from '../../components/SearchableSelect';
import ConfirmDialog from '../../components/ConfirmDialog';
import ProjectChatter from '../../components/ProjectChatter';
import { CoPartySection, type CoPartyDraft } from '../components/CoPartySection';
import { PipelineStepper, PhaseBadge, PIPELINE_STEPS } from '../components/detail/PipelineStepper';
import { RepCommissionCard } from '../components/detail/RepCommissionCard';
import { ProjectDetailSkeleton } from '../components/detail/ProjectDetailSkeleton';
import { InlineNotesEditor } from '../components/detail/InlineNotesEditor';
import { ActivityTimeline } from '../components/detail/ActivityTimeline';
import { AdminNotesEditor } from '../components/detail/AdminNotesEditor';
import RecordChargebackModal from '../components/RecordChargebackModal';
import { findChargebackForEntry } from '../../../../lib/chargebacks';


export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { effectiveRole, effectiveRepId, projects, setProjects, payrollEntries, currentRepId, reps, activeInstallers, activeFinancers, installerBaselines, updateProject: ctxUpdateProject, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions, installerPayConfigs, solarTechProducts, trainerAssignments } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const { toast } = useToast();
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const project = projects.find((p) => p.id === id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- depend only on customerName to avoid re-fires on any project field change
  useEffect(() => { document.title = project ? `${project.customerName} | Kilo Energy` : 'Project Detail | Kilo Energy'; }, [project?.customerName]);
  const [notesDraft, setNotesDraft] = useState(project?.notes ?? '');
  const [notesDraftSaved, setNotesDraftSaved] = useState(false);
  const notesDraftDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the last project.notes value we synced from so we can detect external
  // changes (e.g. the Edit modal saving new notes) without clobbering unsaved
  // local edits the admin is actively typing.
  const lastSyncedNotes = useRef(project?.notes ?? '');
  useEffect(() => {
    const incoming = project?.notes ?? '';
    if (incoming !== lastSyncedNotes.current) {
      // project.notes changed externally — only overwrite local textarea if the
      // admin hasn't started typing something new (i.e. textarea still matches
      // the previous synced value).
      if (notesDraft === lastSyncedNotes.current) {
        setNotesDraft(incoming);
      }
      // Cancel any pending debounce so it cannot overwrite the externally-saved value.
      if (notesDraftDebounce.current) { clearTimeout(notesDraftDebounce.current); notesDraftDebounce.current = null; }
      lastSyncedNotes.current = incoming;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.notes]);

  // Auto-save admin notes with 1s debounce
  const doSaveNotesDraft = useCallback((value: string) => {
    if (project && value !== (project.notes ?? '')) {
      ctxUpdateProject(id, { notes: value });
      lastSyncedNotes.current = value;
      setNotesDraftSaved(true);
      setTimeout(() => setNotesDraftSaved(false), 2000);
    }
  }, [project, id, ctxUpdateProject]);

  const handleNotesDraftChange = (value: string) => {
    setNotesDraft(value);
    if (notesDraftDebounce.current) clearTimeout(notesDraftDebounce.current);
    notesDraftDebounce.current = setTimeout(() => doSaveNotesDraft(value), 1000);
  };

  // Save on blur immediately (cancel pending debounce)
  const handleNotesDraftBlur = () => {
    if (notesDraftDebounce.current) { clearTimeout(notesDraftDebounce.current); notesDraftDebounce.current = null; }
    doSaveNotesDraft(notesDraft);
  };

  // Cancel debounce timer on unmount
  useEffect(() => {
    return () => { if (notesDraftDebounce.current) clearTimeout(notesDraftDebounce.current); };
  }, []);

  // Warn on navigation if notes are dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (project && notesDraft !== (project.notes ?? '')) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [notesDraft, project]);
  const [editM1, setEditM1] = useState(false);
  const [editM2, setEditM2] = useState(false);
  const [m1Val, setM1Val] = useState('');
  const [m2Val, setM2Val] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRecordChargeback, setShowRecordChargeback] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');
  const [phaseConfirm, setPhaseConfirm] = useState<Phase | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const [editVals, setEditVals] = useState({
    installer: '',
    financer: '',
    productType: '',
    kWSize: '',
    netPPW: '',
    setterId: '',
    soldDate: '',
    notes: '',
    useBaselineOverride: false,
    overrideCloserPerW: '',
    overrideSetterPerW: '',
    overrideKiloPerW: '',
    additionalClosers: [] as CoPartyDraft[],
    additionalSetters: [] as CoPartyDraft[],
    // Per-project trainer override. Admin-only; when empty, the rep-level
    // TrainerAssignment chain applies. When set, this project uses these
    // values instead of the chain.
    trainerId: '',
    trainerRate: '',
    solarTechProductId: '',
  });

  // ── Prev/Next project navigation ─────────────────────────────────────────
  const [navIds, setNavIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('kilo-project-nav');
      if (raw) setNavIds(JSON.parse(raw));
    } catch { /* SSR / quota guard */ }
  }, []);
  const navIndex = navIds.indexOf(id);
  const prevProjectId = navIndex > 0 ? navIds[navIndex - 1] : null;
  const nextProjectId = navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null;

  // ArrowLeft / ArrowRight keyboard shortcuts (only when no input is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showEditModal || showCancelConfirm || showDeleteConfirm || showCancelReasonModal || phaseConfirm || editM1 || editM2) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'ArrowLeft' && prevProjectId) {
        e.preventDefault();
        router.push(`/dashboard/projects/${prevProjectId}`);
      } else if (e.key === 'ArrowRight' && nextProjectId) {
        e.preventDefault();
        router.push(`/dashboard/projects/${nextProjectId}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is a stable singleton from Next; omitting is intentional
  }, [prevProjectId, nextProjectId, showEditModal, showCancelConfirm, showDeleteConfirm, showCancelReasonModal, phaseConfirm, editM1, editM2]);

  // Escape to close Edit Project modal
  useEffect(() => {
    if (!showEditModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowEditModal(false); setEditErrors({}); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showEditModal]);

  // Lock scroll on the actual scroll container while the Edit modal is
  // open. The dashboard's scroller is <main> (see app/dashboard/layout.tsx),
  // not <body> or window — the previous implementation scrolled window
  // which is a no-op because window isn't the scroll context. That's
  // what was causing the "modal pops up somewhere random, have to scroll
  // to it" bug: the modal was correctly fixed to the viewport, but the
  // <main> scrolled independently behind it, and nothing prevented the
  // user from scrolling the page content away while the modal was open.
  // Combined with createPortal (modal renders as a direct child of body,
  // sidestepping any ancestor transform/filter issues), this pins the
  // modal and keeps the background stable.
  useEffect(() => {
    if (!showEditModal) return;
    const mainEl = document.querySelector('main');
    const prevBodyOverflow = document.body.style.overflow;
    const prevMainOverflow = mainEl instanceof HTMLElement ? mainEl.style.overflow : '';
    document.body.style.overflow = 'hidden';
    if (mainEl instanceof HTMLElement) mainEl.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      if (mainEl instanceof HTMLElement) mainEl.style.overflow = prevMainOverflow;
    };
  }, [showEditModal]);

  // (Cancel Confirm Escape handler removed — ConfirmDialog handles it internally)

  // Mobile layout
  if (isMobile) return <MobileProjectDetail projectId={id} />;

  // Return the skeleton loader during the server→client hydration window so
  // the page never flashes raw blank content when navigating to a project.
  if (!isHydrated) return <ProjectDetailSkeleton />;

  if (!project) {
    return (
      <div className="p-4 md:p-8 text-center text-[var(--text-muted)]">
        Project not found.{' '}
        <Link href="/dashboard/projects" className="text-[var(--accent-green)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  // Reps can only view their own projects
  if (
    effectiveRole === 'rep' &&
    project.repId !== effectiveRepId &&
    project.setterId !== effectiveRepId &&
    project.trainerId !== effectiveRepId &&
    !project.additionalClosers?.some((p) => p.userId === effectiveRepId) &&
    !project.additionalSetters?.some((p) => p.userId === effectiveRepId)
  ) {
    return (
      <div className="p-4 md:p-8 text-center text-[var(--text-muted)] text-sm">
        You don&apos;t have permission to view this project.{' '}
        <Link href="/dashboard/projects" className="text-[var(--accent-green)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  // Sub-dealers can only view projects assigned to them
  if (effectiveRole === 'sub-dealer' && project.subDealerId !== effectiveRepId && project.repId !== effectiveRepId) {
    return (
      <div className="p-4 md:p-8 text-center text-[var(--text-muted)] text-sm">
        You don&apos;t have permission to view this project.{' '}
        <Link href="/dashboard/projects" className="text-[var(--accent-green)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  const updateProject = (updates: Partial<typeof project>) => {
    ctxUpdateProject(id, updates);
  };

  const handleCancel = () => {
    setShowCancelConfirm(false);
    setCancelReason('');
    setCancelNotes('');
    setShowCancelReasonModal(true);
  };

  const confirmCancelWithReason = () => {
    if (!cancelReason) {
      toast('Please select a cancellation reason', 'error');
      return;
    }
    updateProject({
      phase: 'Cancelled',
      cancellationReason: cancelReason || undefined,
      cancellationNotes: cancelNotes || undefined,
    } as Partial<typeof project>);
    setShowCancelReasonModal(false);
    toast('Project cancelled', 'info');
    router.push('/dashboard/projects');
  };

  const handleDeleteProject = async () => {
    setShowDeleteConfirm(false);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== project.id));
        toast('Project deleted permanently');
        router.push('/dashboard/projects');
      } else {
        toast('Failed to delete project', 'error');
      }
    } catch {
      toast('Failed to delete project', 'error');
    }
  };

  const doPhaseChange = (phase: Phase) => {
    if (phase === 'Cancelled') {
      setCancelReason('');
      setCancelNotes('');
      setShowCancelReasonModal(true);
      return;
    }
    const previousPhase = project.phase;
    updateProject({ phase });
    toast(`Phase updated to ${phase}`, 'success', {
      label: 'Undo',
      onClick: () => {
        updateProject({ phase: previousPhase });
      },
    });
  };

  const handlePhaseChange = (phase: Phase) => {
    if (phase === 'On Hold') {
      setPhaseConfirm(phase);
      return;
    }
    if (phase === 'Cancelled') {
      setCancelReason('');
      setCancelNotes('');
      setShowCancelReasonModal(true);
      return;
    }
    doPhaseChange(phase);
  };

  const handleFlag = () => {
    const newFlagged = !project.flagged;
    updateProject({ flagged: newFlagged });
    toast(newFlagged ? 'Project flagged' : 'Flag removed', newFlagged ? 'info' : 'success');
  };

  const handleToggleM1 = () => {
    const previousM1Paid = project.m1Paid;
    const next = !previousM1Paid;
    updateProject({ m1Paid: next });
    toast(
      `M1 marked as ${next ? 'Paid' : 'Unpaid'}`,
      'success',
      { label: 'Undo', onClick: () => { updateProject({ m1Paid: previousM1Paid }); } },
    );
  };

  const handleToggleM2 = () => {
    const previousM2Paid = project.m2Paid;
    const next = !previousM2Paid;
    updateProject({ m2Paid: next });
    toast(
      `M2 marked as ${next ? 'Paid' : 'Unpaid'}`,
      'success',
      { label: 'Undo', onClick: () => { updateProject({ m2Paid: previousM2Paid }); } },
    );
  };

  const handleToggleM3 = () => {
    const previousM3Paid = project.m3Paid;
    const next = !previousM3Paid;
    updateProject({ m3Paid: next });
    toast(
      `M3 marked as ${next ? 'Paid' : 'Unpaid'}`,
      'success',
      { label: 'Undo', onClick: () => { updateProject({ m3Paid: previousM3Paid }); } },
    );
  };

  const saveM1 = () => {
    const val = parseFloat(m1Val);
    if (!isNaN(val)) { updateProject({ m1Amount: val }); toast('M1 amount updated', 'success'); setEditM1(false); }
    else { toast('Invalid amount', 'error'); }
  };

  const saveM2 = () => {
    const val = parseFloat(m2Val);
    if (!isNaN(val)) {
      const installPayPct = installerPayConfigs[project.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      const newM3 = installPayPct < 100 && !project.subDealerId
        ? Math.round(val * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      const originalM2 = project.m2Amount ?? 0;
      // scale is based on the closer's old M2; if it was $0 we can't compute a ratio, so setter M2 is left unchanged
      const scale = originalM2 > 0 ? val / originalM2 : 1;
      const newSetterM2 = Math.round((project.setterM2Amount ?? 0) * scale * 100) / 100;
      const newSetterM3 = installPayPct < 100 && !project.subDealerId && project.setterId
        ? Math.round(newSetterM2 * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      updateProject({ m2Amount: val, m3Amount: newM3, setterM2Amount: newSetterM2, setterM3Amount: newSetterM3 });
      if (originalM2 === 0 && project.setterId) {
        toast('M2 updated — closer M2 was $0 so setter M2 could not be auto-scaled. Use Edit Deal to recalculate setter amounts.', 'error');
      } else {
        toast('M2 amount updated', 'success');
      }
      setEditM2(false);
    } else { toast('Invalid amount', 'error'); }
  };

  const openEditModal = () => {
    setEditVals({
      installer: project.installer,
      financer: project.financer,
      productType: project.productType,
      kWSize: String(project.kWSize),
      netPPW: String(project.netPPW),
      setterId: project.setterId ?? '',
      soldDate: project.soldDate,
      notes: notesDraft ?? '',
      useBaselineOverride: !!project.baselineOverride,
      overrideCloserPerW: project.baselineOverride ? String(project.baselineOverride.closerPerW) : '',
      overrideSetterPerW: project.baselineOverride?.setterPerW != null ? String(project.baselineOverride.setterPerW) : '',
      overrideKiloPerW: project.baselineOverride ? String(project.baselineOverride.kiloPerW) : '',
      additionalClosers: (project.additionalClosers ?? []).map((c) => ({
        userId: c.userId,
        m1Amount: String(c.m1Amount ?? 0),
        m2Amount: String(c.m2Amount ?? 0),
        m3Amount: c.m3Amount != null ? String(c.m3Amount) : '',
      })),
      additionalSetters: (project.additionalSetters ?? []).map((s) => ({
        userId: s.userId,
        m1Amount: String(s.m1Amount ?? 0),
        m2Amount: String(s.m2Amount ?? 0),
        m3Amount: s.m3Amount != null ? String(s.m3Amount) : '',
      })),
      trainerId: project.trainerId ?? '',
      trainerRate: project.trainerRate != null ? String(project.trainerRate) : '',
      solarTechProductId: project.solarTechProductId ?? '',
    });
    setEditErrors({});
    setShowEditModal(true);
  };

  const saveEditModal = () => {
    const kw = parseFloat(editVals.kWSize);
    const ppw = parseFloat(editVals.netPPW);

    // Validate required fields before saving
    const errs: Record<string, string> = {};
    if (!editVals.installer) errs.installer = 'Installer is required';
    if (editVals.installer === 'SolarTech' && !editVals.solarTechProductId) errs.installer = 'SolarTech requires a product — select a SolarTech product';
    if (!editVals.soldDate) errs.soldDate = 'Sold date is required';
    if (!editVals.kWSize || isNaN(kw) || kw <= 0) errs.kWSize = 'Must be a number greater than 0';
    if (!editVals.netPPW || isNaN(ppw) || ppw <= 0) errs.netPPW = 'Must be a number greater than 0';
    if (editVals.productType !== 'Cash' && !editVals.financer) errs.financer = 'Financer is required';
    if (editVals.useBaselineOverride) {
      const oc = parseFloat(editVals.overrideCloserPerW);
      const ok = parseFloat(editVals.overrideKiloPerW);
      if (!editVals.overrideCloserPerW || isNaN(oc) || oc <= 0) errs.overrideCloserPerW = 'Must be a number greater than 0';
      if (!editVals.overrideKiloPerW || isNaN(ok) || ok <= 0) errs.overrideKiloPerW = 'Must be a number greater than 0';
    }
    setEditErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    const setterRep = reps.find((r) => r.id === editVals.setterId);
    const parsedSetterPerW = parseFloat(editVals.overrideSetterPerW);
    const baselineOverride: InstallerBaseline | undefined = editVals.useBaselineOverride
      ? {
          closerPerW: parseFloat(editVals.overrideCloserPerW) || 0,
          kiloPerW: parseFloat(editVals.overrideKiloPerW) || 0,
          ...(editVals.overrideSetterPerW !== '' && !isNaN(parsedSetterPerW) ? { setterPerW: parsedSetterPerW } : {}),
        }
      : undefined;
    let editBaseline: InstallerBaseline;
    if (editVals.useBaselineOverride) {
      editBaseline = { closerPerW: parseFloat(editVals.overrideCloserPerW) || 0, kiloPerW: parseFloat(editVals.overrideKiloPerW) || 0, ...(editVals.overrideSetterPerW !== '' && !isNaN(parsedSetterPerW) ? { setterPerW: parsedSetterPerW } : {}) };
    } else if (editVals.installer === 'SolarTech' && editVals.solarTechProductId) {
      editBaseline = getSolarTechBaseline(editVals.solarTechProductId, kw, solarTechProducts);
    } else if (project.installerProductId && editVals.installer === project.installer) {
      editBaseline = getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, kw, editVals.soldDate || project.soldDate, productCatalogPricingVersions);
    } else {
      editBaseline = getInstallerRatesForDeal(editVals.installer, editVals.soldDate || project.soldDate, kw, installerPricingVersions);
    }
    const editCloserTotal = calculateCommission(ppw, editBaseline.closerPerW, kw);
    const editM1Flat = kw >= 5 ? 1000 : 500;
    const editSetterPerW = 'setterPerW' in editBaseline && editBaseline.setterPerW != null
      ? editBaseline.setterPerW
      : Math.round((editBaseline.closerPerW + 0.10) * 100) / 100;
    const editSetterTotal = calculateCommission(ppw, editSetterPerW, kw);
    const editSetterM1Amount = editVals.setterId ? Math.min(editM1Flat, Math.max(0, editSetterTotal)) : 0;
    const editInstallPayPct = installerPayConfigs[editVals.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    const editHasM3 = editInstallPayPct < 100 && !project.subDealerId;
    const editCloserM1 = editVals.setterId ? 0 : Math.min(editM1Flat, Math.max(0, editCloserTotal));
    const editCloserM2Full = Math.max(0, editCloserTotal - editCloserM1);
    const editSetterM2Full = Math.max(0, editSetterTotal - editSetterM1Amount);
    const editM2Amount = Math.round(editCloserM2Full * (editInstallPayPct / 100) * 100) / 100;
    const editM3Amount = editHasM3 ? Math.round(editCloserM2Full * ((100 - editInstallPayPct) / 100) * 100) / 100 : 0;
    const editSetterM2Amount = editVals.setterId ? Math.round(editSetterM2Full * (editInstallPayPct / 100) * 100) / 100 : 0;
    const editSetterM3Amount = editVals.setterId && editHasM3 ? Math.round(editSetterM2Full * ((100 - editInstallPayPct) / 100) * 100) / 100 : 0;
    // Serialize co-party drafts — skip rows missing a user picker (abandoned
    // adds). Empty amount strings parse to 0 (intentional — admin may want
    // to pre-add a co-closer with zero cut now and backfill later).
    const toNum = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const additionalClosersOut = editVals.additionalClosers
      .filter((c) => !!c.userId && c.userId !== project.repId)
      .map((c, i) => ({
        userId: c.userId,
        userName: reps.find((r) => r.id === c.userId)?.name ?? '',
        m1Amount: toNum(c.m1Amount),
        m2Amount: toNum(c.m2Amount),
        m3Amount: c.m3Amount.trim() === '' ? null : toNum(c.m3Amount),
        position: i + 1,
      }));
    const additionalSettersOut = (editVals.setterId ? editVals.additionalSetters : [])
      .filter((s) => !!s.userId && s.userId !== editVals.setterId)
      .map((s, i) => ({
        userId: s.userId,
        userName: reps.find((r) => r.id === s.userId)?.name ?? '',
        m1Amount: toNum(s.m1Amount),
        m2Amount: toNum(s.m2Amount),
        m3Amount: s.m3Amount.trim() === '' ? null : toNum(s.m3Amount),
        position: i + 1,
      }));

    // Per-project trainer — normalize empty strings to undefined so the API
    // treats "no override" correctly (PATCH body only sends defined fields).
    const trainerRateNum = editVals.trainerRate.trim() !== '' ? parseFloat(editVals.trainerRate) : NaN;
    const nextTrainerId = editVals.trainerId || undefined;
    const nextTrainerRate = nextTrainerId && Number.isFinite(trainerRateNum) ? trainerRateNum : undefined;
    const trainerRep = nextTrainerId ? reps.find((r) => r.id === nextTrainerId) : undefined;

    ctxUpdateProject(project.id, {
      installer: editVals.installer,
      financer: editVals.financer,
      productType: editVals.productType,
      kWSize: kw,
      netPPW: ppw,
      m1Amount: editVals.setterId ? 0 : Math.min(editM1Flat, Math.max(0, editCloserTotal)),
      m2Amount: editM2Amount,
      m3Amount: editM3Amount,
      setterId: editVals.setterId || undefined,
      setterName: setterRep?.name ?? (editVals.setterId ? project.setterName : undefined),
      soldDate: editVals.soldDate,
      notes: editVals.notes,
      baselineOverride,
      setterM1Amount: editSetterM1Amount,
      setterM2Amount: editSetterM2Amount,
      setterM3Amount: editSetterM3Amount,
      additionalClosers: additionalClosersOut,
      additionalSetters: additionalSettersOut,
      trainerId: nextTrainerId,
      trainerName: trainerRep?.name,
      trainerRate: nextTrainerRate,
      solarTechProductId: (editVals.installer !== project.installer && editVals.installer !== 'SolarTech') ? undefined : (editVals.solarTechProductId || undefined),
      ...(editVals.installer !== project.installer ? { installerProductId: undefined } : {}),
    });
    setShowEditModal(false);
    setEditErrors({});
    toast('Project updated', 'success');
  };

  // Commission entries for this project (rep view)
  const myEntries = effectiveRole === 'rep'
    ? payrollEntries.filter((e) => e.projectId === project.id && e.repId === effectiveRepId)
    : [];

  // All payroll entries for this project (admin view)
  const projectEntries = payrollEntries.filter((e) => e.projectId === project.id);
  const closerEntries = projectEntries.filter((e) => e.repId === project.repId && e.paymentStage !== 'Trainer');
  const setterEntries = project.setterId ? projectEntries.filter((e) => e.repId === project.setterId && e.paymentStage !== 'Trainer') : [];
  const coCloserIds = new Set((project.additionalClosers ?? []).map((c) => c.userId));
  const coSetterIds = new Set((project.additionalSetters ?? []).map((c) => c.userId));
  // Trainer payouts belong in their own card so the admin view shows a
  // dedicated slot matching closer/setter. Identified by paymentStage
  // (some trainers are admins/reps too, so repId alone isn't reliable).
  const trainerEntries = projectEntries.filter((e) => e.paymentStage === 'Trainer');
  const otherEntries  = projectEntries.filter((e) => !closerEntries.includes(e) && !setterEntries.includes(e) && !coCloserIds.has(e.repId) && !coSetterIds.has(e.repId) && !trainerEntries.includes(e));

  // Resolved baseline rates for this project
  const projectBaselines = (() => {
    if (project.baselineOverride) return project.baselineOverride;
    if (project.installer === 'SolarTech' && project.solarTechProductId) {
      try {
        return getSolarTechBaseline(project.solarTechProductId, project.kWSize, solarTechProducts);
      } catch {
        // Product deactivated — fall through to generic installer rates
      }
    }
    if (project.installerProductId) {
      return getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, project.kWSize, project.soldDate, productCatalogPricingVersions);
    }
    return getInstallerRatesForDeal(project.installer, project.soldDate, project.kWSize, installerPricingVersions);
  })();

  const closerExpectedM2 = project.m2Amount ?? 0;
  const setterPerW = 'setterPerW' in projectBaselines && projectBaselines.setterPerW != null
    ? projectBaselines.setterPerW
    : Math.round((projectBaselines.closerPerW + 0.10) * 100) / 100;
  const _m1Flat = project.kWSize >= 5 ? 1000 : 500;

  // Per-person total expected commission (sum of all milestones). Displayed
  // under each rep's name on the admin commission breakdown so admin can
  // eyeball each rep's full expected payout at a glance. Milestone
  // breakdown stays visible on the right.
  const closerTotalExpected =
    (project.m1Amount ?? 0) + (project.m2Amount ?? 0) + (project.m3Amount ?? 0);
  const setterTotalExpected = project.setterId
    ? (project.setterM1Amount ?? 0) + (project.setterM2Amount ?? 0) + (project.setterM3Amount ?? 0)
    : 0;
  const { rate: effectiveTrainerRate, trainerId: effTrainerId } = resolveTrainerRate(
    { id: project.id, trainerId: project.trainerId ?? null, trainerRate: project.trainerRate ?? null },
    project.repId,
    trainerAssignments,
    payrollEntries,
  );
  const trainerTotalExpected = effectiveTrainerRate * (project.kWSize ?? 0) * 1000;

  const inputCls =
    'bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]';

  return (
    <div className="px-3 pt-2 pb-4 md:p-8 max-w-3xl">
      {/* Breadcrumb + Prev/Next */}
      <div className="flex items-center justify-between mb-6">
        <nav className="animate-breadcrumb-enter inline-flex items-center gap-0.5 text-xs text-[var(--text-secondary)] bg-[var(--surface)]/60 backdrop-blur-md border border-[var(--border-subtle)]/60 rounded-xl px-4 py-2.5">
          <Link href="/dashboard" className="hover:bg-[var(--surface-card)]/50 hover:text-[var(--text-secondary)] transition-colors px-2 py-1 rounded-lg">Dashboard</Link>
          <span className="text-[var(--text-dim)] mx-1">/</span>
          <Link href="/dashboard/projects" className="hover:bg-[var(--surface-card)]/50 hover:text-[var(--text-secondary)] transition-colors px-2 py-1 rounded-lg">Projects</Link>
          <span className="text-[var(--text-dim)] mx-1">/</span>
          <span className="text-white font-medium bg-[var(--accent-green)]/10 px-2.5 py-1 rounded-lg">{project.customerName}</span>
        </nav>

        {/* Prev / Next project buttons */}
        {(prevProjectId || nextProjectId) && (
          <div className="flex items-center gap-1.5">
            {prevProjectId ? (
              <Link
                href={`/dashboard/projects/${prevProjectId}`}
                title="Previous project (←)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/60 border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-white hover:border-[var(--border)] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/30 border border-[var(--border-subtle)]/40 text-[var(--text-dim)] cursor-default">
                <ChevronLeft className="w-4 h-4" />
              </span>
            )}
            {nextProjectId ? (
              <Link
                href={`/dashboard/projects/${nextProjectId}`}
                title="Next project (→)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/60 border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-white hover:border-[var(--border)] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/30 border border-[var(--border-subtle)]/40 text-[var(--text-dim)] cursor-default">
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pipeline stage tracker */}
      <PipelineStepper phase={project.phase} soldDate={project.soldDate} />

      {/* Phase quick-advance strip — admin/PM only, hidden when off-track */}
      {(effectiveRole === 'admin' || isPM) && !['Cancelled', 'On Hold'].includes(project.phase) && (() => {
        const phaseIdx = PIPELINE_STEPS.indexOf(project.phase as typeof PIPELINE_STEPS[number]);
        const prevStep = phaseIdx > 0 ? PIPELINE_STEPS[phaseIdx - 1] : null;
        const nextStep = phaseIdx < PIPELINE_STEPS.length - 1 ? PIPELINE_STEPS[phaseIdx + 1] : null;
        return (
          <div className="flex items-center gap-2 mb-5 -mt-3">
            {prevStep ? (
              <button
                onClick={() => handlePhaseChange(prevStep)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-amber-500/50 transition-colors"
              >
                ← {prevStep}
              </button>
            ) : <span />}
            {nextStep && (
              <button
                onClick={() => handlePhaseChange(nextStep)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent-green)]/50 transition-colors ml-auto"
              >
                {nextStep} →
              </button>
            )}
          </div>
        );
      })()}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight">{project.customerName}</h1>
            {project.flagged && (
              <span className="flex items-center gap-1 bg-red-900/40 border border-red-500/30 text-red-400 text-xs px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                Flagged
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PhaseBadge phase={project.phase} />
            <span className="text-[var(--text-muted)] text-sm">Sold {formatDate(project.soldDate)}</span>
          </div>
        </div>

        {(effectiveRole === 'admin' || isPM) ? (
          <div className="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-2">
            {!isPM && (
              <button
                onClick={openEditModal}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--accent-green)]/30 text-[var(--accent-green)] hover:bg-blue-900/20 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button
              onClick={handleFlag}
              className={`flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border transition-colors ${
                project.flagged
                  ? 'border-red-500/40 text-red-400 hover:bg-red-900/20'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)]'
              }`}
            >
              {project.flagged ? <FlagOff className="w-3.5 h-3.5" /> : <Flag className="w-3.5 h-3.5" />}
              {project.flagged ? 'Unflag' : 'Flag'}
            </button>
            {!isPM && (
              <Link
                href={`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </Link>
            )}
            {project.phase !== 'Cancelled' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-red-500/30 text-red-400 hover:bg-red-900/20 transition-colors"
              >
                Cancel
              </button>
            )}
            {!isPM && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-red-500/30 text-red-400 hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
            {(currentRepId === project.repId) && (
              <Link
                href={`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </Link>
            )}
            {(currentRepId === project.repId) && project.phase !== 'Cancelled' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="bg-red-900/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 text-sm px-4 py-2 min-h-[44px] w-full md:w-auto rounded-xl transition-colors"
              >
                Cancel Project
              </button>
            )}
          </div>
        )}
      </div>

      {/* Details grid */}
      <div className="card-surface rounded-2xl p-6 mb-5">
        <h2 className="text-white font-semibold mb-4">Project Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">
          {[
            ['Rep', project.repName],
            ['Installer', project.installer],
            ['Financer', project.financer],
            ['Product Type', project.productType],
            ['System Size', `${project.kWSize} kW`],
            ...(!isPM ? [['Net PPW', `$${project.netPPW}`]] : []),
            ['Sold Date', formatDate(project.soldDate)],
            ['Phase', project.phase],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-white">{value}</p>
            </div>
          ))}
          {project.setterId && (
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Setter</p>
              <p className="text-white">{project.setterName}</p>
            </div>
          )}
          {project.leadSource && (
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Lead Source</p>
              <p className="text-white capitalize">{project.leadSource === 'door_knock' ? 'Door Knock' : project.leadSource}</p>
            </div>
          )}
        </div>

        {(effectiveRole === 'admin' || isPM) && (
          <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-2">Change Phase</p>
            <select
              value={project.phase}
              onChange={(e) => handlePhaseChange(e.target.value as Phase)}
              className="bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]"
            >
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>{ph}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Commission — rep view shows their own payroll entries */}
      {(effectiveRole === 'rep' || effectiveRole === 'sub-dealer') && !isPM && (() => {
        const isTrainerOnDeal = project.trainerId === effectiveRepId && project.repId !== effectiveRepId && project.setterId !== effectiveRepId && !(project.additionalClosers ?? []).some((c) => c.userId === effectiveRepId);
        const trainerOnlyEntries = isTrainerOnDeal ? payrollEntries.filter((e) => e.projectId === project.id && e.repId === effectiveRepId && e.paymentStage === 'Trainer') : [];
        return (
        <div className="card-surface rounded-2xl p-6 mb-5">
          <h2 className="text-white font-semibold mb-4">{isTrainerOnDeal ? 'My Commission (Trainer)' : 'My Commission'}</h2>
          {(() => {
            // Compute the rep's total once so both the payroll view and the
            // "projected" view use the same hero number. Matches the
            // MobileProjectDetail "Your Commission $X" hero — parity fix
            // so a rep sees one total on their phone and the same total
            // on desktop (previously desktop only showed milestone boxes).
            const coCloserEntry = (project.additionalClosers ?? []).find((c) => c.userId === effectiveRepId);
            const coSetterEntry = (project.additionalSetters ?? []).find((s) => s.userId === effectiveRepId);
            const isSetterRep = project.setterId === effectiveRepId;
            const isCloserRep2 = project.repId === effectiveRepId;
            const isTrainerRep = project.trainerId === effectiveRepId && !isCloserRep2 && !isSetterRep && !(project.additionalClosers ?? []).some((c) => c.userId === effectiveRepId);

            // Trainer path: single lump paid at Trainer stage, no M1/M2/M3.
            // Projected as trainerRate × kW × 1000; paid entries override if
            // they exist.
            if (isTrainerRep) {
              const trainerEntries = payrollEntries.filter((e) => e.projectId === project.id && e.repId === effectiveRepId && e.paymentStage === 'Trainer');
              const paidTotal = trainerEntries.filter((e) => e.status === 'Paid').reduce((s, e) => s + e.amount, 0);
              const pendingTotal = trainerEntries.filter((e) => e.status !== 'Paid').reduce((s, e) => s + e.amount, 0);
              const projected = (project.trainerRate ?? 0) * (project.kWSize ?? 0) * 1000;
              const myTotal = trainerEntries.length > 0 ? (paidTotal + pendingTotal) : projected;
              return myTotal > 0 ? (
                <div className="mb-5 rounded-2xl p-5 relative overflow-hidden"
                     style={{ background: 'linear-gradient(135deg, rgba(0,229,160,0.10), rgba(0,180,216,0.06))', border: '1px solid rgba(0,229,160,0.25)' }}>
                  <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-40 pointer-events-none"
                       style={{ background: 'radial-gradient(circle, rgba(0,229,160,0.25) 0%, transparent 65%)' }} />
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest mb-1">Your Commission (Trainer)</p>
                  <p className="text-[var(--accent-green)] text-4xl font-black tabular-nums">
                    ${myTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Trainer payout on this deal
                    {project.trainerRate != null && ` · $${project.trainerRate.toFixed(2)}/W × ${project.kWSize} kW`}
                  </p>
                </div>
              ) : null;
            }

            const myExpM1 = isSetterRep ? (project.setterM1Amount ?? 0) : coCloserEntry ? coCloserEntry.m1Amount : coSetterEntry ? coSetterEntry.m1Amount : (project.m1Amount ?? 0);
            const myExpM2 = isSetterRep ? (project.setterM2Amount ?? 0) : coCloserEntry ? coCloserEntry.m2Amount : coSetterEntry ? coSetterEntry.m2Amount : (project.m2Amount ?? 0);
            const myExpM3 = isSetterRep ? (project.setterM3Amount ?? 0) : coCloserEntry ? (coCloserEntry.m3Amount ?? 0) : coSetterEntry ? (coSetterEntry.m3Amount ?? 0) : (project.m3Amount ?? 0);
            const myTotal = myExpM1 + myExpM2 + (myExpM3 ?? 0);
            return myTotal > 0 ? (
              <div className="mb-5 rounded-2xl p-5 relative overflow-hidden"
                   style={{ background: 'linear-gradient(135deg, rgba(0,229,160,0.10), rgba(0,180,216,0.06))', border: '1px solid rgba(0,229,160,0.25)' }}>
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-40 pointer-events-none"
                     style={{ background: 'radial-gradient(circle, rgba(0,229,160,0.25) 0%, transparent 65%)' }} />
                <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest mb-1">Your Commission</p>
                <p className="text-[var(--accent-green)] text-4xl font-black tabular-nums">
                  ${myTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[var(--text-secondary)] text-sm mt-1">Projected earnings on this deal</p>
              </div>
            ) : null;
          })()}
          {/* Trainer branch: they don't have M1/M2/M3 — the hero above is
              their full total. If Trainer-stage entries exist, list them;
              else show "no payments yet" (phase will trigger generation). */}
          {isTrainerOnDeal ? (
            trainerOnlyEntries.length > 0 ? (
              <div className="space-y-2">
                {trainerOnlyEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-[var(--text-secondary)] text-sm font-medium">{entry.paymentStage}</p>
                      <p className="text-[var(--text-muted)] text-xs mt-0.5">{formatDate(entry.date)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                        entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                        entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                        'bg-[var(--border)] text-[var(--text-secondary)]'
                      }`}>{entry.status}</span>
                      <span className="text-[var(--accent-green)] font-bold">${entry.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--text-muted)] text-sm">
                No payments yet &mdash; trainer payout is released when the deal progresses past Acceptance.
              </p>
            )
          ) : myEntries.length > 0 ? (
            <div className="space-y-2">
              {myEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-[var(--text-secondary)] text-sm font-medium">
                      {entry.paymentStage}
                      {entry.notes ? <span className="text-[var(--text-muted)] font-normal ml-1.5 text-xs">({entry.notes})</span> : null}
                    </p>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5">{formatDate(entry.date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                      entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                      entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                      'bg-[var(--border)] text-[var(--text-secondary)]'
                    }`}>
                      {entry.status}
                    </span>
                    <span className="text-[var(--accent-green)] font-bold">${entry.amount.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (() => {
              const coCloserEntry = (project.additionalClosers ?? []).find((c) => c.userId === effectiveRepId);
              const coSetterEntry = (project.additionalSetters ?? []).find((s) => s.userId === effectiveRepId);
              const isSetterRep = project.setterId === effectiveRepId;
              const isCloserRep = project.repId === effectiveRepId;
              const expM1 = isSetterRep ? (project.setterM1Amount ?? 0) : coCloserEntry ? coCloserEntry.m1Amount : coSetterEntry ? coSetterEntry.m1Amount : (project.m1Amount ?? 0);
              const expM2 = isSetterRep ? (project.setterM2Amount ?? 0) : coCloserEntry ? coCloserEntry.m2Amount : coSetterEntry ? coSetterEntry.m2Amount : (project.m2Amount ?? 0);
              const expM3 = isSetterRep ? (project.setterM3Amount ?? 0) : coCloserEntry ? (coCloserEntry.m3Amount ?? 0) : coSetterEntry ? (coSetterEntry.m3Amount ?? 0) : (project.m3Amount ?? 0);
              // Closer viewing their own deal: show setter's TOTAL (not breakdown)
              // so they can see what their setter is making. Policy: setters and
              // trainers don't get this reciprocal visibility.
              const showSetterTotal = isCloserRep && project.setterId && setterTotalExpected > 0;
              return (
            <div>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M1</p>
                  <p className="text-[var(--accent-green)] font-bold">${expM1.toLocaleString()}</p>
                </div>
                <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M2</p>
                  <p className="text-[var(--accent-green)] font-bold">${expM2.toLocaleString()}</p>
                </div>
                {expM3 > 0 && (
                  <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                    <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M3</p>
                    <p className="text-teal-400 font-bold">${expM3.toLocaleString()}</p>
                  </div>
                )}
              </div>
              {showSetterTotal && (
                <div className="mb-3 bg-[var(--surface-card)]/50 rounded-xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[var(--text-muted)] text-xs">{project.setterName} (setter) total</span>
                  <span className="text-[var(--text-secondary)] font-semibold text-sm">${setterTotalExpected.toLocaleString()}</span>
                </div>
              )}
              <p className="text-[var(--text-muted)] text-sm">
                No payments yet &mdash; commission will appear here as milestones are reached.
              </p>
            </div>
              );
            })()}
        </div>
        );
      })()}

      {/* Commission breakdown (admin) */}
      {effectiveRole === 'admin' && !isPM && (
        <div className="card-surface rounded-2xl p-6 mb-5">
          <h2 className="text-white font-semibold mb-1">Commission Breakdown</h2>

          {/* Baseline rates summary */}
          <div className="flex flex-wrap gap-3 mb-4 mt-2">
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Closer baseline: <span className="text-[var(--accent-cyan)] font-semibold">${projectBaselines.closerPerW.toFixed(3)}/W</span>
            </span>
            {project.setterId && (
              <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
                Setter baseline: <span className="text-[var(--accent-cyan)] font-semibold">${setterPerW.toFixed(3)}/W</span>
              </span>
            )}
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Kilo cost: <span className="text-purple-300 font-semibold">${projectBaselines.kiloPerW.toFixed(3)}/W</span>
            </span>
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Sold: <span className="text-white font-semibold">${project.netPPW.toFixed(3)}/W</span>
            </span>
          </div>

          <div className="space-y-4">
            {/* ── Closer ── */}
            <RepCommissionCard
              name={project.repName}
              role="Closer"
              totalExpected={closerTotalExpected}
              expectedAmounts={[
                ...(!project.setterId ? [{ label: 'Expected M1', amount: project.m1Amount ?? 0 }] : []),
                { label: 'Expected M2', amount: closerExpectedM2 },
                ...((project.m3Amount ?? 0) > 0 ? [{ label: 'Expected M3', amount: project.m3Amount ?? 0 }] : []),
              ]}
              entries={closerEntries}
            />

            {/* ── Setter ── */}
            {project.setterId ? (
              <RepCommissionCard
                name={project.setterName ?? ''}
                role="Setter"
                totalExpected={setterTotalExpected}
                expectedAmounts={[
                  { label: 'Expected M1', amount: project.setterM1Amount ?? 0 },
                  { label: 'Expected M2', amount: project.setterM2Amount ?? 0 },
                  ...((project.setterM3Amount ?? 0) > 0 ? [{ label: 'Expected M3', amount: project.setterM3Amount ?? 0 }] : []),
                ]}
                entries={setterEntries}
              />
            ) : (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <p className="text-white text-sm font-semibold mb-0.5">{project.repName} <span className="text-[var(--text-muted)] font-normal text-xs">(self-gen)</span></p>
                <p className="text-[var(--text-muted)] text-xs">M1 flat goes to closer — no setter on this deal</p>
              </div>
            )}

            {/* ── Co-closers / Co-setters (tag-team attribution) ──
                Only renders if the deal actually has tag-team participants.
                Each card mirrors the primary closer/setter card so the
                payroll picture is consistent at a glance. */}
            {(project.additionalClosers ?? []).map((co) => {
              const coEntries = projectEntries.filter((e) => e.repId === co.userId);
              return (
                <div key={`cc-${co.userId}`} className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-white text-sm font-semibold">{co.userName}</p>
                      <p className="text-[var(--text-muted)] text-xs">Co-closer · #{co.position}</p>
                    </div>
                    <div className="text-right space-y-0.5">
                      {(co.m1Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-green)] font-bold text-sm">M1 · ${co.m1Amount.toLocaleString()}</p>
                      )}
                      {(co.m2Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-green)] font-bold text-sm">M2 · ${co.m2Amount.toLocaleString()}</p>
                      )}
                      {(co.m3Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-green)] font-bold text-sm">M3 · ${co.m3Amount!.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  {coEntries.length > 0 && (
                    <div className="space-y-1.5">
                      {coEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                              entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                              'bg-[var(--border)] text-[var(--text-secondary)]'
                            }`}>{entry.status}</span>
                            <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {(project.additionalSetters ?? []).map((co) => {
              const coEntries = projectEntries.filter((e) => e.repId === co.userId);
              return (
                <div key={`cs-${co.userId}`} className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-white text-sm font-semibold">{co.userName}</p>
                      <p className="text-[var(--text-muted)] text-xs">Co-setter · #{co.position}</p>
                    </div>
                    <div className="text-right space-y-0.5">
                      {(co.m1Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-green)] font-bold text-sm">M1 · ${co.m1Amount.toLocaleString()}</p>
                      )}
                      {(co.m2Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-green)] font-bold text-sm">M2 · ${co.m2Amount.toLocaleString()}</p>
                      )}
                      {(co.m3Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-green)] font-bold text-sm">M3 · ${co.m3Amount!.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  {coEntries.length > 0 && (
                    <div className="space-y-1.5">
                      {coEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                              entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                              'bg-[var(--border)] text-[var(--text-secondary)]'
                            }`}>{entry.status}</span>
                            <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Trainer ──
                Only renders if the project has a trainerId pinned (per-project
                override) OR if any Trainer-stage payroll rows exist. Trainer
                info is scrubbed server-side for non-admin/PM viewers, so
                project.trainerName / trainerRate will be undefined for reps. */}
            {(project.trainerId || trainerEntries.length > 0) && (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-white text-sm font-semibold">{project.trainerName ?? reps.find((r) => r.id === effTrainerId)?.name ?? '(trainer)'}</p>
                    <p className="text-[var(--text-muted)] text-xs">Trainer{effectiveTrainerRate > 0 ? ` · $${effectiveTrainerRate.toFixed(2)}/W` : ''}</p>
                    {trainerTotalExpected > 0 && (
                      <p className="text-[var(--accent-green)] text-xs font-semibold mt-0.5">Total expected: ${trainerTotalExpected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                    )}
                  </div>
                </div>
                {trainerEntries.length > 0 ? (
                  <div className="space-y-1.5">
                    {trainerEntries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                          <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                            entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                            'bg-[var(--border)] text-[var(--text-secondary)]'
                          }`}>{entry.status}</span>
                          <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[var(--text-dim)] text-xs italic">No payroll entries yet — generated on phase progression.</p>
                )}
              </div>
            )}

            {/* ── Other entries (trainer overrides, bonuses, etc.) ── */}
            {otherEntries.length > 0 && (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <p className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider mb-2">Other Payouts</p>
                <div className="space-y-1.5">
                  {otherEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.repName}</span>
                        <span className="text-[var(--text-muted)] text-xs ml-1.5">{entry.paymentStage}</span>
                        {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                        <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                          entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-[var(--border)] text-[var(--text-secondary)]'
                        }`}>{entry.status}</span>
                        <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Cancelled banner + chargeback affordance ── */}
            {project.phase === 'Cancelled' && (() => {
              const eligiblePaidEntries = projectEntries
                .filter((e) => e.status === 'Paid' && !e.isChargeback && !findChargebackForEntry(e.id, projectEntries));
              if (eligiblePaidEntries.length === 0) return null;
              return (
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <div className="flex items-center justify-between gap-3 bg-amber-900/20 border border-amber-500/30 rounded-xl p-4">
                    <div>
                      <p className="text-amber-300 text-sm font-semibold">Deal cancelled — chargeback(s) pending</p>
                      <p className="text-[var(--text-muted)] text-xs mt-0.5">
                        {eligiblePaidEntries.length} Paid milestone{eligiblePaidEntries.length !== 1 ? 's' : ''} without a linked chargeback. Record a clawback so payroll totals stay net-correct.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowRecordChargeback(true)}
                      className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors"
                    >
                      Record Chargeback
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ── Milestone toggles ── */}
            <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Milestone Status</p>

              {/* M1 */}
              <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl p-4">
                <div>
                  <p className="text-[var(--text-secondary)] text-sm font-medium">Milestone 1 (M1)</p>
                  {editM1 ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={m1Val}
                        onChange={(e) => setM1Val(e.target.value)}
                        placeholder={String(project.m1Amount)}
                        className={inputCls + ' w-28'}
                      />
                      <button onClick={saveM1} className="text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-xs">Save</button>
                      <button onClick={() => setEditM1(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[var(--accent-green)] font-semibold">${project.m1Amount != null ? project.m1Amount.toLocaleString() : '—'}</p>
                      <button
                        onClick={() => { setM1Val(String(project.m1Amount ?? 0)); setEditM1(true); }}
                        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleToggleM1}
                    className="text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--border)] hover:bg-[var(--text-dim)] px-2 py-1 rounded-lg transition-colors"
                  >
                    {project.m1Paid ? 'Mark Unpaid' : 'Mark Paid'}
                  </button>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                    project.m1Paid ? 'bg-emerald-900/50 text-[var(--accent-green)]' : 'bg-yellow-900/50 text-yellow-400'
                  }`}>
                    {project.m1Paid ? 'Paid' : 'Pending'}
                  </span>
                </div>
              </div>

              {/* M2 */}
              <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl p-4">
                <div>
                  <p className="text-[var(--text-secondary)] text-sm font-medium">Milestone 2 (M2)</p>
                  {editM2 ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={m2Val}
                        onChange={(e) => setM2Val(e.target.value)}
                        placeholder={String(project.m2Amount)}
                        className={inputCls + ' w-28'}
                      />
                      <button onClick={saveM2} className="text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-xs">Save</button>
                      <button onClick={() => setEditM2(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[var(--accent-green)] font-semibold">${(project.m2Amount ?? 0).toLocaleString()}</p>
                      <button
                        onClick={() => { setM2Val(String(project.m2Amount ?? 0)); setEditM2(true); }}
                        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleToggleM2}
                    className="text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--border)] hover:bg-[var(--text-dim)] px-2 py-1 rounded-lg transition-colors"
                  >
                    {project.m2Paid ? 'Mark Unpaid' : 'Mark Paid'}
                  </button>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                    project.m2Paid ? 'bg-emerald-900/50 text-[var(--accent-green)]' : 'bg-yellow-900/50 text-yellow-400'
                  }`}>
                    {project.m2Paid ? 'Paid' : 'Pending'}
                  </span>
                </div>
              </div>

              {/* M3 */}
              {(project.m3Amount ?? 0) > 0 && (
                <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl p-4">
                  <div>
                    <p className="text-[var(--text-secondary)] text-sm font-medium">Milestone 3 (M3) — PTO</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-teal-400 font-semibold">${(project.m3Amount ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleToggleM3}
                      className="text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--border)] hover:bg-[var(--text-dim)] px-2 py-1 rounded-lg transition-colors"
                    >
                      {project.m3Paid ? 'Mark Unpaid' : 'Mark Paid'}
                    </button>
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                      project.m3Paid ? 'bg-emerald-900/50 text-[var(--accent-green)]' : 'bg-yellow-900/50 text-yellow-400'
                    }`}>
                      {project.m3Paid ? 'Paid' : 'Pending'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-3">Notes</h2>

        {(effectiveRole === 'admin' || isPM) ? (
          <div>
            <textarea
              rows={4}
              value={notesDraft}
              onChange={(e) => handleNotesDraftChange(e.target.value)}
              onBlur={handleNotesDraftBlur}
              placeholder="Add notes about this project..."
              maxLength={1000}
              className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-slate-500 resize-none"
            />
            <div className="flex items-center justify-between mt-1">
              <p className={`text-xs transition-colors duration-200 ${
                notesDraft.length >= 960 ? 'text-red-400' :
                notesDraft.length >= 800 ? 'text-amber-400' :
                'text-[var(--text-muted)]'
              }`}>
                {notesDraft.length} / 1000
              </p>
              {notesDraftSaved && <span className="text-xs text-[var(--accent-green)] animate-fade-in-up">Saved</span>}
              {!notesDraftSaved && notesDraft !== (project.notes ?? '') && (
                <span className="text-xs text-[var(--text-muted)]">Auto-saving...</span>
              )}
            </div>
          </div>
        ) : (
          <InlineNotesEditor
            notes={project.notes ?? ''}
            onSave={(text) => { updateProject({ notes: text }); }}
          />
        )}
      </div>

      {/* Admin Notes — visible only to admin + PM. Reps, trainers, and
          sub-dealers never receive this field (scrubbed server-side by
          fieldVisibility.ts). Distinct from the regular Notes above;
          this is for private admin reference. */}
      {(effectiveRole === 'admin' || isPM) && (
        <AdminNotesEditor
          projectId={id}
          initial={project.adminNotes ?? ''}
          onPatch={(text) => ctxUpdateProject(id, { adminNotes: text })}
        />
      )}

      {/* Activity Timeline */}
      <ActivityTimeline projectId={id} />

      {/* Chatter */}
      <ProjectChatter projectId={id} />

      {/* Edit Project Modal
          Portaled to document.body so fixed positioning is relative to the
          actual viewport, not the <main> scroll container. Without the
          portal, if Josh opens the modal from a deep scroll position, the
          ancestor's scroll context can trap the modal below the fold. */}
      {showEditModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowEditModal(false); setEditErrors({}); } }}>
          <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-900/30">
                  <Pencil className="w-5 h-5 text-[var(--accent-green)]" />
                </div>
                <h2 className="text-white font-semibold">Edit Project</h2>
              </div>
              <button onClick={() => { setShowEditModal(false); setEditErrors({}); }} className="text-[var(--text-muted)] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Installer */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Installer</label>
                <SearchableSelect
                  value={editVals.installer}
                  onChange={(val) => { setEditVals((v) => ({ ...v, installer: val, solarTechProductId: val === 'SolarTech' ? v.solarTechProductId : '' })); setEditErrors((prev) => ({ ...prev, installer: '' })); }}
                  options={(activeInstallers.includes(editVals.installer) || !editVals.installer ? activeInstallers : [editVals.installer, ...activeInstallers]).map((inst) => ({ value: inst, label: !activeInstallers.includes(inst) ? `${inst} (archived)` : inst }))}
                  placeholder="Select installer…"
                  error={!!editErrors.installer}
                />
                {editErrors.installer && <p className="text-red-400 text-xs mt-1">{editErrors.installer}</p>}
              </div>

              {/* SolarTech Product — shown only when installer is SolarTech */}
              {editVals.installer === 'SolarTech' && (
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">SolarTech Product</label>
                  <select
                    value={editVals.solarTechProductId}
                    onChange={(e) => { setEditVals((v) => ({ ...v, solarTechProductId: e.target.value })); setEditErrors((prev) => ({ ...prev, installer: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.installer && !editVals.solarTechProductId ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`}
                  >
                    <option value="">— Select product —</option>
                    {solarTechProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Financer */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Financer</label>
                <SearchableSelect
                  value={editVals.financer}
                  onChange={(val) => setEditVals((v) => ({ ...v, financer: val }))}
                  options={(activeFinancers.includes(editVals.financer) || !editVals.financer ? activeFinancers : [editVals.financer, ...activeFinancers]).filter((fin) => fin !== 'Cash' || editVals.productType === 'Cash').map((fin) => ({ value: fin, label: !activeFinancers.includes(fin) ? `${fin} (archived)` : fin }))}
                  placeholder="Select financer…"
                />
              </div>

              {/* Product Type */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Product Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['PPA', 'Lease', 'Loan', 'Cash'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setEditVals((v) => ({ ...v, productType: pt, financer: pt === 'Cash' ? 'Cash' : v.financer === 'Cash' ? '' : v.financer }))}
                      className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                        editVals.productType === pt
                          ? 'bg-[var(--accent-green)] border-[var(--accent-green)] text-black shadow-[0_0_10px_rgba(37,99,235,0.3)]'
                          : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
                      }`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>

              {/* kW + PPW */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">System Size (kW)</label>
                  <input type="number" step="0.1" value={editVals.kWSize}
                    onChange={(e) => { setEditVals((v) => ({ ...v, kWSize: e.target.value })); setEditErrors((prev) => ({ ...prev, kWSize: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.kWSize ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                  {editErrors.kWSize && <p className="text-red-400 text-xs mt-1">{editErrors.kWSize}</p>}
                </div>
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Net PPW ($)</label>
                  <input type="number" step="0.01" value={editVals.netPPW}
                    onChange={(e) => { setEditVals((v) => ({ ...v, netPPW: e.target.value })); setEditErrors((prev) => ({ ...prev, netPPW: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.netPPW ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                  {editErrors.netPPW && <p className="text-red-400 text-xs mt-1">{editErrors.netPPW}</p>}
                </div>
              </div>

              {/* Setter */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Setter (optional)</label>
                <select value={editVals.setterId} onChange={(e) => setEditVals((v) => ({ ...v, setterId: e.target.value }))}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]">
                  <option value="">— None —</option>
                  {reps.filter((r) => (r.repType === 'setter' || r.repType === 'both') && (r.active || r.id === editVals.setterId) && r.id !== project.repId).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* ── Co-closers (tag-team) ─────────────────────────────────
                  Each row is one person + their M1/M2/M3 cut. The primary
                  closer's cut stays on m1Amount/m2Amount/m3Amount above;
                  these are ADDITIONAL people, not replacements. Adding the
                  2nd closer evenly re-splits the closer commission 50/50
                  using evenSplit (reuses lib/money's cent-exact allocator
                  so no cent is lost in the round-trip). */}
              <CoPartySection
                label="Co-closers"
                rows={editVals.additionalClosers}
                primaryUserId={project.repId}
                excludeUserIds={[editVals.setterId, ...editVals.additionalClosers.map((c) => c.userId), ...editVals.additionalSetters.map((s) => s.userId)].filter(Boolean)}
                repTypeFilter={(r) => r.repType === 'closer' || r.repType === 'both'}
                reps={reps}
                onChange={(rows) => setEditVals((v) => ({ ...v, additionalClosers: rows }))}
                onFirstAdd={() => {
                  // Re-split the current commission evenly across [primary + 1 new].
                  // Primary's m1/m2/m3 on editVals isn't directly editable here;
                  // we operate on parseFloat(editVals.netPPW/kWSize)-derived
                  // preview numbers instead. Simpler: default new row to 0
                  // and let admin enter amounts manually — safer than
                  // silently mutating the primary's cut on first add.
                }}
              />

              {/* Co-setters — same shape. */}
              <CoPartySection
                label="Co-setters"
                rows={editVals.additionalSetters}
                primaryUserId={editVals.setterId}
                excludeUserIds={[editVals.setterId, ...editVals.additionalSetters.map((s) => s.userId), ...editVals.additionalClosers.map((c) => c.userId)].filter(Boolean)}
                repTypeFilter={(r) => r.repType === 'setter' || r.repType === 'both'}
                reps={reps}
                onChange={(rows) => setEditVals((v) => ({ ...v, additionalSetters: rows }))}
                disabled={!editVals.setterId}
                disabledReason="Select a primary setter above to add co-setters."
              />

              {/* Per-project trainer override — admin-only one-off attachment. */}
              <div className="bg-[var(--surface-card)]/60 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Per-project trainer override</label>
                  {editVals.trainerId && (
                    <button
                      type="button"
                      onClick={() => setEditVals((v) => ({ ...v, trainerId: '', trainerRate: '' }))}
                      className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[var(--text-muted)] text-xs mb-3">
                  Optional: attach a specific trainer + rate to this deal only. Bypasses the rep-level
                  TrainerAssignment chain. Use for historical deals or one-off mentors.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[var(--text-secondary)] text-[11px] block mb-1">Trainer</label>
                    <select
                      value={editVals.trainerId}
                      onChange={(e) => setEditVals((v) => ({ ...v, trainerId: e.target.value }))}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]"
                    >
                      <option value="">— none —</option>
                      {reps
                        .filter((r) => r.active && r.id !== project.repId && r.id !== editVals.setterId)
                        .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-[11px] block mb-1">Rate ($/W)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="5"
                      placeholder="0.20"
                      value={editVals.trainerRate}
                      onChange={(e) => setEditVals((v) => ({ ...v, trainerRate: e.target.value }))}
                      disabled={!editVals.trainerId}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>


              {/* Sold Date */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Sold Date</label>
                <input type="date" value={editVals.soldDate}
                  onChange={(e) => { setEditVals((v) => ({ ...v, soldDate: e.target.value })); setEditErrors((prev) => ({ ...prev, soldDate: '' })); }}
                  className={`w-full bg-[var(--surface-card)] border ${editErrors.soldDate ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                {editErrors.soldDate && <p className="text-red-400 text-xs mt-1">{editErrors.soldDate}</p>}
              </div>

              {/* Notes */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Notes</label>
                <textarea rows={2} value={editVals.notes} onChange={(e) => setEditVals((v) => ({ ...v, notes: e.target.value }))}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] resize-none" />
              </div>

              {/* Baseline Override */}
              <div className="bg-[var(--surface-card)]/60 rounded-xl p-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={editVals.useBaselineOverride}
                    onChange={(e) => setEditVals((v) => ({ ...v, useBaselineOverride: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[var(--accent-green)]" />
                  <span className="text-[var(--text-secondary)] text-sm font-medium">Override baseline for this project</span>
                </label>
                {editVals.useBaselineOverride && (
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Closer $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideCloserPerW}
                        placeholder={String(installerBaselines[editVals.installer]?.closerPerW ?? 2.90)}
                        onChange={(e) => { setEditVals((v) => ({ ...v, overrideCloserPerW: e.target.value })); setEditErrors((prev) => ({ ...prev, overrideCloserPerW: '' })); }}
                        className={`w-full bg-[var(--border)] border ${editErrors.overrideCloserPerW ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                      {editErrors.overrideCloserPerW && <p className="text-red-400 text-xs mt-1">{editErrors.overrideCloserPerW}</p>}
                    </div>
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Setter $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideSetterPerW}
                        placeholder={editVals.overrideCloserPerW
                          ? String(Math.round((parseFloat(editVals.overrideCloserPerW) + 0.10) * 100) / 100)
                          : String(Math.round(((installerBaselines[editVals.installer]?.closerPerW ?? 2.90) + 0.10) * 100) / 100)}
                        onChange={(e) => setEditVals((v) => ({ ...v, overrideSetterPerW: e.target.value }))}
                        className="w-full bg-[var(--border)] border border-[var(--border)] text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]" />
                    </div>
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Kilo $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideKiloPerW}
                        placeholder={String(installerBaselines[editVals.installer]?.kiloPerW ?? 2.35)}
                        onChange={(e) => { setEditVals((v) => ({ ...v, overrideKiloPerW: e.target.value })); setEditErrors((prev) => ({ ...prev, overrideKiloPerW: '' })); }}
                        className={`w-full bg-[var(--border)] border ${editErrors.overrideKiloPerW ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                      {editErrors.overrideKiloPerW && <p className="text-red-400 text-xs mt-1">{editErrors.overrideKiloPerW}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Live Commission Preview ────────────────────────────────── */}
            {(() => {
              const previewKW = parseFloat(editVals.kWSize);
              const previewPPW = parseFloat(editVals.netPPW);
              if (isNaN(previewKW) || isNaN(previewPPW) || previewKW <= 0 || previewPPW <= 0) return null;

              let previewBaseline: InstallerBaseline;
              if (editVals.useBaselineOverride) {
                const overrideCloser = parseFloat(editVals.overrideCloserPerW);
                const overrideKilo = parseFloat(editVals.overrideKiloPerW);
                if (isNaN(overrideCloser) || isNaN(overrideKilo)) {
                  return (
                    <div className="mt-4 rounded-xl p-4 bg-amber-900/20 border border-amber-500/30">
                      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                      <p className="text-amber-400 text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Enter valid Closer $/W and Kilo $/W values to see the commission preview.
                      </p>
                    </div>
                  );
                }
                const overrideSetter = parseFloat(editVals.overrideSetterPerW);
                previewBaseline = {
                  closerPerW: overrideCloser,
                  kiloPerW: overrideKilo,
                  ...(!isNaN(overrideSetter) ? { setterPerW: overrideSetter } : {}),
                };
              } else if (editVals.installer === 'SolarTech' && !editVals.solarTechProductId) {
                return (
                  <div className="mt-4 rounded-xl p-4 bg-amber-900/20 border border-amber-500/30">
                    <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                    <p className="text-amber-400 text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> A SolarTech product selection is required to preview commission.
                    </p>
                  </div>
                );
              } else if (editVals.installer === 'SolarTech' && editVals.solarTechProductId) {
                previewBaseline = getSolarTechBaseline(editVals.solarTechProductId, previewKW, solarTechProducts);
              } else if (project.installerProductId && editVals.installer === project.installer) {
                previewBaseline = getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, previewKW, editVals.soldDate || project.soldDate, productCatalogPricingVersions);
              } else {
                previewBaseline = getInstallerRatesForDeal(editVals.installer, editVals.soldDate || project.soldDate, previewKW, installerPricingVersions);
              }

              const previewInstallPayPct = installerPayConfigs[editVals.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const closerTotal = calculateCommission(previewPPW, previewBaseline.closerPerW, previewKW);
              const editM1Flat = previewKW >= 5 ? 1000 : 500;
              const closerM1 = editVals.setterId ? 0 : Math.min(editM1Flat, Math.max(0, closerTotal));
              const closerM2 = Math.round(Math.max(0, closerTotal - closerM1) * (previewInstallPayPct / 100) * 100) / 100;
              const belowBaseline = previewPPW < previewBaseline.closerPerW;
              const previewSetterPerW = 'setterPerW' in previewBaseline && (previewBaseline as { setterPerW?: number | null }).setterPerW != null
                ? (previewBaseline as { setterPerW: number }).setterPerW
                : Math.round((previewBaseline.closerPerW + 0.10) * 100) / 100;
              const setterTotal = editVals.setterId ? calculateCommission(previewPPW, previewSetterPerW, previewKW) : 0;
              // Actual Kilo take on this deal: gross above wholesale, minus all
              // commission paid out. (Trainer override isn't edited from this
              // modal; if a trainer is attached, the server-computed margin on
              // the stored project covers it — this preview is for editing.)
              const kiloMargin = Math.max(0, Math.round(
                ((previewPPW - previewBaseline.kiloPerW) * previewKW * 1000 - closerTotal - setterTotal) * 100,
              ) / 100);
              const setterM1 = editVals.setterId ? Math.min(editM1Flat, Math.max(0, setterTotal)) : 0;
              const setterM2 = editVals.setterId ? Math.round(Math.max(0, setterTotal - setterM1) * (previewInstallPayPct / 100) * 100) / 100 : 0;
              const previewHasM3 = previewInstallPayPct < 100 && !project.subDealerId;
              const closerM3 = previewHasM3 ? Math.round(Math.max(0, closerTotal - closerM1) * ((100 - previewInstallPayPct) / 100) * 100) / 100 : 0;
              const setterM3 = editVals.setterId && previewHasM3 ? Math.round(Math.max(0, setterTotal - setterM1) * ((100 - previewInstallPayPct) / 100) * 100) / 100 : 0;

              return (
                <div className={`mt-4 rounded-xl p-4 ${belowBaseline ? 'bg-amber-900/20 border border-amber-500/30' : 'bg-[var(--surface-card)]/60 border border-[var(--border)]/40'}`}>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                  {editVals.setterId ? (
                    <div className={`grid ${previewHasM3 ? 'grid-cols-6' : 'grid-cols-4'} gap-3 text-center`}>
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M1</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${setterM1.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M2</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${setterM2.toLocaleString()}</p>
                      </div>
                      {previewHasM3 && (
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M3</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${setterM3.toLocaleString()}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M2</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM2.toLocaleString()}</p>
                      </div>
                      {previewHasM3 && (
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M3</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM3.toLocaleString()}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Kilo Margin</p>
                        <p className={`font-bold text-sm ${kiloMargin < 0 ? 'text-red-400' : 'text-[var(--accent-green)]'}`}>${kiloMargin.toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                  <div className={`grid ${previewHasM3 ? 'grid-cols-4' : 'grid-cols-3'} gap-3 text-center`}>
                    <div>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M1</p>
                      <p className="text-white font-bold text-sm">${closerM1.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M2</p>
                      <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM2.toLocaleString()}</p>
                    </div>
                    {previewHasM3 && (
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M3</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM3.toLocaleString()}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase">Kilo Margin</p>
                      <p className={`font-bold text-sm ${kiloMargin < 0 ? 'text-red-400' : 'text-[var(--accent-green)]'}`}>${kiloMargin.toLocaleString()}</p>
                    </div>
                  </div>
                  )}
                  {belowBaseline && (
                    <p className="text-amber-400 text-xs mt-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> PPW is below the installer baseline (${previewBaseline.closerPerW}/W)
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-3 mt-6">
              <button onClick={saveEditModal}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                style={{ backgroundColor: 'var(--brand)' }}>
                Save Changes
              </button>
              <button onClick={() => { setShowEditModal(false); setEditErrors({}); }}
                className="flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-white font-medium py-2.5 rounded-xl transition-colors text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Record Chargeback modal (admin-only on cancelled deals) */}
      <RecordChargebackModal
        open={showRecordChargeback}
        onClose={() => setShowRecordChargeback(false)}
        onSaved={() => { /* next data fetch picks up the new entry */ }}
        projectId={project.id}
        paidEntries={projectEntries
          .filter((e) => e.status === 'Paid' && !e.isChargeback && !findChargebackForEntry(e.id, projectEntries))
          .map((e) => ({
            id: e.id,
            repId: e.repId,
            repName: e.repName,
            paymentStage: e.paymentStage,
            amount: e.amount,
            date: e.date,
          }))}
      />

      {/* Cancel Confirm Modal */}
      <ConfirmDialog
        open={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleCancel}
        title="Cancel Project"
        message={`This will mark ${project.customerName} as Cancelled. This can be reversed by an admin.`}
        confirmLabel="Cancel Project"
        danger={true}
      />

      {/* Delete Confirm Modal — Admin only */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteProject}
        title="Permanently Delete Project"
        message={`This will permanently delete "${project.customerName}" and all associated payroll entries, activity, and messages. This cannot be undone.`}
        confirmLabel="Delete Forever"
        danger={true}
      />

      {/* Phase change confirmation for destructive transitions */}
      <ConfirmDialog
        open={!!phaseConfirm}
        onClose={() => setPhaseConfirm(null)}
        onConfirm={() => {
          if (phaseConfirm) {
            const previousPhase = project.phase;
            const previousCancelReason = project.cancellationReason;
            const previousCancelNotes = project.cancellationNotes;
            updateProject({ phase: phaseConfirm });
            toast(`Phase updated to ${phaseConfirm}`, 'success', {
              label: 'Undo',
              onClick: () => {
                if (previousPhase === 'Cancelled') {
                  updateProject({ phase: 'Cancelled', cancellationReason: previousCancelReason, cancellationNotes: previousCancelNotes });
                } else {
                  updateProject({ phase: previousPhase });
                }
              },
            });
          }
          setPhaseConfirm(null);
        }}
        title={`Move to ${phaseConfirm ?? ''}?`}
        message={`Are you sure you want to move "${project.customerName}" to ${phaseConfirm ?? ''}? This will remove it from the active pipeline.`}
        confirmLabel="Put On Hold"
        danger={false}
      />

      {/* Cancellation Reason Modal — portaled to document.body for the same
          reason as the Edit modal: ancestor transform/filter contexts trap
          fixed descendants relative to the ancestor, not the viewport. */}
      {showCancelReasonModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCancelReasonModal(false); }}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="text-white font-bold text-base">Cancel Project</h2>
              </div>
              <button onClick={() => setShowCancelReasonModal(false)} className="text-[var(--text-secondary)] hover:text-white transition-colors rounded-lg p-1 hover:bg-[var(--surface-card)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[var(--text-secondary)] text-sm">Please provide a reason for cancelling <span className="text-white font-medium">{project.customerName}</span>.</p>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]"
                >
                  <option value="">Select a reason...</option>
                  <option value="Customer changed mind">Customer changed mind</option>
                  <option value="Credit denied">Credit denied</option>
                  <option value="Roof not suitable">Roof not suitable</option>
                  <option value="Competitor won">Competitor won</option>
                  <option value="Pricing issue">Pricing issue</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Notes <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span></label>
                <textarea
                  rows={3}
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] resize-none placeholder-slate-500"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowCancelReasonModal(false)}
                  className="flex-1 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  Go Back
                </button>
                <button
                  onClick={confirmCancelWithReason}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors active:scale-[0.97]"
                >
                  Cancel Project
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
