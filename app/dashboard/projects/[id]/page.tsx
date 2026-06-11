'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileProjectDetail from '../../mobile/MobileProjectDetail';
import {
  Phase, InstallerBaseline,
  getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal,
  splitCloserSetterPay,
  DEFAULT_INSTALL_PAY_PCT,
} from '../../../../lib/data';
import ConfirmDialog from '../../components/ConfirmDialog';
import ProjectChatter from '../../components/ProjectChatter';
import { type CoPartyDraft } from '../components/CoPartySection';
import { PipelineStepper } from '../components/detail/PipelineStepper';
import { ProjectDetailSkeleton } from '../components/detail/ProjectDetailSkeleton';
import { ProjectNotes } from '../../components/ProjectNotes';
import { ActivityTimeline } from '../components/detail/ActivityTimeline';
import { EquipmentSnapshot } from '../components/detail/EquipmentSnapshot';
import { InstallerFiles } from '../components/detail/InstallerFiles';
import { SiteSurveyLinks } from '../components/detail/SiteSurveyLinks';
import { InstallerNotes } from '../components/detail/InstallerNotes';
import { HandoffStatusCard } from '../components/detail/HandoffStatusCard';
import { CollapsibleSection } from '../components/detail/CollapsibleSection';
// AdminNotesEditor removed 2026-04-23 — admin notes now render via ProjectNotes kind='admin'.
import RecordChargebackModal from '../components/RecordChargebackModal';
import RecordTrainerPaymentModal from '../components/RecordTrainerPaymentModal';
import PaidCorrectionModal from '../../components/PaidCorrectionModal';
import type { PayrollEntry } from '../../../../lib/data';
import { findChargebackForEntry } from '../../../../lib/chargebacks';
import { deriveProjectCommissionView } from '../components/detail/commission-derived';
import { ProjectHeaderNav } from '../components/detail/ProjectHeaderNav';
import { PhaseQuickAdvance } from '../components/detail/PhaseQuickAdvance';
import { ProjectHeaderToolbar } from '../components/detail/ProjectHeaderToolbar';
import { ProjectDetailsGrid } from '../components/detail/ProjectDetailsGrid';
import { MyCommissionCard } from '../components/detail/MyCommissionCard';
import { CommissionBreakdownAdmin } from '../components/detail/CommissionBreakdownAdmin';
import { CancelReasonModal } from '../components/detail/CancelReasonModal';
import { EditProjectModal } from '../components/detail/EditProjectModal';


export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { effectiveRole, effectiveRepId, projects, setProjects, payrollEntries, setPayrollEntries, reps, activeInstallers, activeFinancers, installerBaselines, updateProject: ctxUpdateProject, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions, installerPayConfigs, solarTechProducts, trainerAssignments, isViewingAs, viewAsUser, currentUserScopedInstallerId, getInstallerPrepaidOptions } = useApp();
  const isPM = effectiveRole === 'project_manager';
  // Internal-only gate: admin OR an internal PM (no installer scope on
  // either the signed-in user or the View-As target). Vendor PMs are
  // hidden from admin-only UI surfaces like the Admin Notes section.
  const canSeeInternalOnlyUi = effectiveRole === 'admin'
    || (isPM && !currentUserScopedInstallerId && !viewAsUser?.scopedInstallerId);
  const { toast } = useToast();
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const project = projects.find((p) => p.id === id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- depend only on customerName to avoid re-fires on any project field change
  useEffect(() => { document.title = project ? `${project.customerName} | Kilo Energy` : 'Project Detail | Kilo Energy'; }, [project?.customerName]);
  // Notes moved to the ProjectNotes list component (per-note rows).
  // The legacy notesDraft / auto-save textarea was removed 2026-04-23.
  const [editM1, setEditM1] = useState(false);
  const [editM2, setEditM2] = useState(false);
  const [m1Val, setM1Val] = useState('');
  const [m2Val, setM2Val] = useState('');
  // Optional reason attached to amount edits — shows alongside the
  // resulting field_edit entry in the activity feed so future readers
  // know why this number changed.
  const [editReason, setEditReason] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRecordChargeback, setShowRecordChargeback] = useState(false);
  // PaidCorrectionModal state — admin-only inline edit of a Paid payroll
  // entry's recorded amount. Opened by the pencil affordance on closer /
  // setter / co-party / trainer entry rows. Chargeback branch is suppressed
  // here (the project page is for data fixes, not money movement — admins
  // record chargebacks from the Payroll page).
  const [paidCorrectionEntryId, setPaidCorrectionEntryId] = useState<string | null>(null);
  // Admin-only: open the Record Trainer Payment modal. Used for Glide
  // cleanup where the trainer is attached to a project but no Trainer-
  // stage payroll entries were ever auto-generated.
  const [showRecordTrainerPayment, setShowRecordTrainerPayment] = useState(false);
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
    // Primary closer (server: closerId, client: repId). Required on save —
    // closerId is a non-null FK in the DB. Picker offered 2026-05-25 after
    // Josh's "I am unable to change who the closer is on a project" report.
    repId: '',
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
    // Admin's "remove all trainers" flag — true means chain trainer is
    // suppressed for this deal (deal disappears from chain trainer's view
    // and they no longer earn override). Only set true via the Clear button.
    noChainTrainer: false,
    solarTechProductId: '',
    // Installer-specific prepaid sub-option (HDM/PE…). Mirrors New Deal —
    // PATCH support added 2026-06-10 (Rebekah's report).
    prepaidSubType: '',
    // Lead-source attribution. Editable from the modal by admin/internal-PM
    // only — see canSeeInternalOnlyUi gate where this section renders.
    // Reps' updates would be stripped by the API anyway (REP_BLOCKED_FIELDS).
    leadSource: '',
    blitzId: '',
  });

  // Blitz list — used by the edit modal's Lead Source / Blitz controls
  // to surface only the blitzes this project's closer is approved on.
  // Loaded once on mount; light-weight (a handful of rows).
  const [rawBlitzes, setRawBlitzes] = useState<Array<{
    id: string; name: string; status: string; startDate?: string; endDate?: string;
    participants?: Array<{ userId: string; joinStatus: string }>;
  }>>([]);
  useEffect(() => {
    fetch('/api/blitzes')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRawBlitzes(Array.isArray(data) ? data : []))
      .catch(() => { /* silent — control falls back to "no blitzes available" */ });
  }, []);
  const editAvailableBlitzes = useMemo(() => {
    const closerId = project?.repId;
    if (!closerId) return [];
    return rawBlitzes.filter((b) => {
      const statusOk = b.status === 'upcoming' || b.status === 'active' || b.status === 'completed';
      if (!statusOk) return false;
      // Only blitzes the project's closer is an approved participant on —
      // matches the API's blitzParticipant.findFirst gate so the admin
      // can't pick a blitz the closer isn't actually on (would 403).
      return !!b.participants?.some((p) => p.userId === closerId && p.joinStatus === 'approved');
    });
  }, [rawBlitzes, project?.repId]);

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
      if (showEditModal || showDeleteConfirm || showCancelReasonModal || phaseConfirm) return;
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
  }, [prevProjectId, nextProjectId, showEditModal, showDeleteConfirm, showCancelReasonModal, phaseConfirm]);

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
        <Link href="/dashboard/projects" className="text-[var(--accent-emerald-text)] hover:underline">
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
        <Link href="/dashboard/projects" className="text-[var(--accent-emerald-text)] hover:underline">
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
        <Link href="/dashboard/projects" className="text-[var(--accent-emerald-text)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  const updateProject = (updates: Partial<typeof project>, opts?: { editReason?: string }) => {
    ctxUpdateProject(id, updates, opts);
  };

  const handleCancel = () => {
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
    if (!isNaN(val)) {
      updateProject({ m1Amount: val }, { editReason });
      toast('M1 amount updated', 'success');
      setEditM1(false);
      setEditReason('');
    } else { toast('Invalid amount', 'error'); }
  };

  const saveM2 = () => {
    const val = parseFloat(m2Val);
    if (!isNaN(val)) {
      const installPayPct = installerPayConfigs[project.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      const newM3 = installPayPct < 100 && !project.subDealerId
        ? Math.round(val * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      const originalM2 = project.m2Amount ?? 0;
      const scale = originalM2 > 0 ? val / originalM2 : 1;
      const newSetterM2 = Math.round((project.setterM2Amount ?? 0) * scale * 100) / 100;
      const newSetterM3 = installPayPct < 100 && !project.subDealerId && project.setterId
        ? Math.round(newSetterM2 * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      updateProject({ m2Amount: val, m3Amount: newM3, setterM2Amount: newSetterM2, setterM3Amount: newSetterM3 }, { editReason });
      if (originalM2 === 0 && project.setterId) {
        toast('M2 updated — closer M2 was $0 so setter M2 could not be auto-scaled.', 'error');
      } else {
        toast('M2 amount updated', 'success');
      }
      setEditM2(false);
      setEditReason('');
    } else { toast('Invalid amount', 'error'); }
  };

  const openEditModal = () => {
    setEditVals({
      installer: project.installer,
      financer: project.financer,
      productType: project.productType,
      kWSize: String(project.kWSize),
      netPPW: String(project.netPPW),
      repId: project.repId,
      setterId: project.setterId ?? '',
      soldDate: project.soldDate,
      notes: project.notes ?? '',
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
      noChainTrainer: project.noChainTrainer ?? false,
      solarTechProductId: project.solarTechProductId ?? '',
      prepaidSubType: project.prepaidSubType ?? '',
      leadSource: project.leadSource ?? '',
      blitzId: project.blitzId ?? '',
    });
    setEditErrors({});
    setShowEditModal(true);
  };

  const saveEditModal = () => {
    const kw = parseFloat(editVals.kWSize);
    const ppw = parseFloat(editVals.netPPW);

    // Validate required fields before saving.
    //
    // Track whether ANY baseline-affecting field changed since the modal
    // opened. When none changed, the saved sold-at pricing remains
    // authoritative — the SolarTech product selection isn't required even
    // if the legacy product is no longer in the active catalog. Server
    // also preserves stored amounts via pricingSource=fallback defense.
    // (Corrine Brooks: sold with Hyundai 435 which is no longer listed —
    // admin needs to add a trainer override without re-pricing the deal.)
    const baselineAffectingChanged =
      parseFloat(editVals.kWSize) !== project.kWSize ||
      parseFloat(editVals.netPPW) !== project.netPPW ||
      editVals.installer !== project.installer ||
      editVals.productType !== project.productType ||
      editVals.soldDate !== project.soldDate ||
      editVals.solarTechProductId !== (project.solarTechProductId ?? '') ||
      editVals.useBaselineOverride !== !!project.baselineOverride;

    const errs: Record<string, string> = {};
    if (!editVals.repId) errs.repId = 'Closer is required';
    if (!editVals.installer) errs.installer = 'Installer is required';
    if (editVals.installer === 'SolarTech' && !editVals.solarTechProductId && baselineAffectingChanged) errs.installer = 'SolarTech requires a product — select a SolarTech product';
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
    // Resolve baseline for optimistic client-side recompute. Legacy
    // SolarTech projects (product no longer in active catalog) throw
    // from getSolarTechBaseline — catch and preserve stored amounts.
    // Server-side defense (pricingSource=fallback) ensures the DB
    // amounts aren't wiped; this just keeps the optimistic UI honest.
    let editBaseline: InstallerBaseline;
    let baselineResolutionFailed = false;
    if (editVals.useBaselineOverride) {
      editBaseline = { closerPerW: parseFloat(editVals.overrideCloserPerW) || 0, kiloPerW: parseFloat(editVals.overrideKiloPerW) || 0, ...(editVals.overrideSetterPerW !== '' && !isNaN(parsedSetterPerW) ? { setterPerW: parsedSetterPerW } : {}) };
    } else if (editVals.installer === 'SolarTech' && editVals.solarTechProductId) {
      try {
        editBaseline = getSolarTechBaseline(editVals.solarTechProductId, kw, solarTechProducts);
      } catch {
        editBaseline = { closerPerW: 0, kiloPerW: 0 };
        baselineResolutionFailed = true;
      }
    } else if (editVals.installer === 'SolarTech' && !editVals.solarTechProductId) {
      editBaseline = { closerPerW: 0, kiloPerW: 0 };
      baselineResolutionFailed = true;
    } else if (project.installerProductId && editVals.installer === project.installer) {
      editBaseline = getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, kw, editVals.soldDate || project.soldDate, productCatalogPricingVersions);
    } else {
      editBaseline = getInstallerRatesForDeal(editVals.installer, editVals.soldDate || project.soldDate, kw, installerPricingVersions);
    }
    // Use the canonical splitCloserSetterPay to compute optimistic amounts —
    // independent calculateCommission calls overstate both rep totals when
    // a setter is on the deal (they each get their full above-baseline spread
    // instead of the proper closer-differential + half-split). Server defense
    // already overrides on PATCH, but the optimistic UI was showing inflated
    // values until reconciliation. Mirrors the new-deal forms which already
    // use splitCloserSetterPay (2026-05-11).
    const editSetterPerW = 'setterPerW' in editBaseline && editBaseline.setterPerW != null
      ? editBaseline.setterPerW
      : Math.round((editBaseline.closerPerW + 0.10) * 100) / 100;
    const editInstallPayPct = installerPayConfigs[editVals.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    const editTrainerRateNum = (() => {
      const r = parseFloat(editVals.trainerRate);
      return editVals.trainerId && Number.isFinite(r) ? r : 0;
    })();
    const editSplit = splitCloserSetterPay(
      ppw,
      editBaseline.closerPerW,
      editVals.setterId ? editSetterPerW : 0,
      editTrainerRateNum,
      kw,
      editInstallPayPct,
    );
    const editHasM3 = editInstallPayPct < 100 && !project.subDealerId;
    const editCloserM1 = editSplit.closerM1;
    const editM2Amount = editSplit.closerM2;
    const editM3Amount = editHasM3 ? editSplit.closerM3 : 0;
    const editSetterM1Amount = editSplit.setterM1;
    const editSetterM2Amount = editSplit.setterM2;
    const editSetterM3Amount = editVals.setterId && editHasM3 ? editSplit.setterM3 : 0;
    // Serialize co-party drafts — skip rows missing a user picker (abandoned
    // adds). Empty amount strings parse to 0 (intentional — admin may want
    // to pre-add a co-closer with zero cut now and backfill later).
    const toNum = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const additionalClosersOut = editVals.additionalClosers
      .filter((c) => !!c.userId && c.userId !== (editVals.repId || project.repId))
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

    // Lead source / blitz pairing rule: leadSource='blitz' implies a
    // blitzId is set; any other source clears blitzId. Mirror the
    // new-deal form's contract so we can't ship orphan blitzIds.
    const nextLeadSource = editVals.leadSource || null;
    const nextBlitzId = editVals.leadSource === 'blitz' ? (editVals.blitzId || null) : null;

    // When baseline couldn't be resolved (legacy SolarTech product),
    // omit amount fields so the optimistic update preserves stored
    // values. The server-side defense will likewise skip the
    // amount overwrite. The PATCH still re-syncs the project from
    // the server response so the final state matches the DB.
    ctxUpdateProject(project.id, {
      installer: editVals.installer,
      financer: editVals.financer,
      productType: editVals.productType,
      kWSize: kw,
      netPPW: ppw,
      ...(baselineResolutionFailed ? {} : {
        m1Amount: editCloserM1,
        m2Amount: editM2Amount,
        m3Amount: editM3Amount,
        setterM1Amount: editSetterM1Amount,
        setterM2Amount: editSetterM2Amount,
        setterM3Amount: editSetterM3Amount,
      }),
      // Primary closer — required. mapProjectUpdateToDb renames repId →
      // closerId on the wire so the rest of the app keeps using `repId`.
      ...(editVals.repId !== project.repId ? {
        repId: editVals.repId,
        repName: reps.find((r) => r.id === editVals.repId)?.name ?? project.repName,
      } : {}),
      setterId: editVals.setterId || undefined,
      setterName: setterRep?.name ?? (editVals.setterId ? project.setterName : undefined),
      soldDate: editVals.soldDate,
      notes: editVals.notes,
      baselineOverride,
      additionalClosers: additionalClosersOut,
      additionalSetters: additionalSettersOut,
      trainerId: nextTrainerId,
      trainerName: trainerRep?.name,
      trainerRate: nextTrainerRate,
      noChainTrainer: editVals.noChainTrainer,
      solarTechProductId: (editVals.installer !== project.installer && editVals.installer !== 'SolarTech') ? undefined : (editVals.solarTechProductId || undefined),
      ...(editVals.installer !== project.installer ? { installerProductId: undefined } : {}),
      // Always sent: '' clears (PATCH maps empty → null), a value sets.
      prepaidSubType: editVals.prepaidSubType,
      leadSource: nextLeadSource ?? undefined,
      blitzId: nextBlitzId ?? undefined,
    });
    setShowEditModal(false);
    setEditErrors({});
    toast('Project updated', 'success');
  };

  // Derived commission view-model (entry partitions, baseline resolution,
  // expected totals, projected trainer legs, admin rollups) — moved
  // verbatim to components/detail/commission-derived.ts (T4.1 split).
  // ONE call so the partitions keep object identity (otherEntries
  // excludes via .includes against the sibling arrays).
  const derived = deriveProjectCommissionView({
    project,
    payrollEntries,
    effectiveRole,
    effectiveRepId,
    trainerAssignments,
    solarTechProducts,
    productCatalogProducts,
    productCatalogPricingVersions,
    installerPricingVersions,
  });
  const { myEntries, projectEntries, setterTotalExpected, effTrainerId, effectiveTrainerRate } = derived;

  return (
    <div className="px-3 pt-2 pb-4 md:p-8 max-w-6xl">
      {/* Breadcrumb + Prev/Next */}
      <ProjectHeaderNav
        customerName={project.customerName}
        prevProjectId={prevProjectId}
        nextProjectId={nextProjectId}
      />

      {/* Pipeline stage tracker */}
      <PipelineStepper phase={project.phase} soldDate={project.soldDate} />

      {/* Phase quick-advance strip — admin/PM only, hidden when off-track */}
      {(effectiveRole === 'admin' || isPM) && !['Cancelled', 'On Hold'].includes(project.phase) && (
        <PhaseQuickAdvance phase={project.phase} onPhaseChange={handlePhaseChange} />
      )}

      {/* Header */}
      <ProjectHeaderToolbar
        project={project}
        isAdminOrPM={effectiveRole === 'admin' || isPM}
        isPM={isPM}
        effectiveRepId={effectiveRepId}
        onEdit={openEditModal}
        onFlag={handleFlag}
        onCancel={handleCancel}
        onDelete={() => setShowDeleteConfirm(true)}
      />

      {/* Details grid */}
      <ProjectDetailsGrid
        project={project}
        isPM={isPM}
        canChangePhase={effectiveRole === 'admin' || isPM}
        onPhaseChange={handlePhaseChange}
      />

      {/* Commission — rep view shows their own payroll entries */}
      {(effectiveRole === 'rep' || effectiveRole === 'sub-dealer') && !isPM && (
        <MyCommissionCard
          project={project}
          effectiveRole={effectiveRole}
          effectiveRepId={effectiveRepId}
          payrollEntries={payrollEntries}
          trainerAssignments={trainerAssignments}
          myEntries={myEntries}
          setterTotalExpected={setterTotalExpected}
        />
      )}

      {/* Commission breakdown (admin) */}
      {effectiveRole === 'admin' && !isPM && (
        <CommissionBreakdownAdmin
          project={project}
          derived={derived}
          reps={reps}
          effectiveRole={effectiveRole}
          isPM={isPM}
          onEditPaid={setPaidCorrectionEntryId}
          onRecordTrainerPayment={() => setShowRecordTrainerPayment(true)}
          onRecordChargeback={() => setShowRecordChargeback(true)}
          milestoneEditor={{
            editM1, editM2, m1Val, m2Val, editReason,
            setEditM1, setEditM2, setM1Val, setM2Val, setEditReason,
            saveM1, saveM2,
            onToggleM1: handleToggleM1, onToggleM2: handleToggleM2, onToggleM3: handleToggleM3,
          }}
        />
      )}

      {/* Notes — per-note rows, each individually deletable. Replaced
          the single-textarea InlineNotesEditor on 2026-04-23. Legacy
          Project.notes content was migrated into ProjectNote rows by
          scripts/migrate-add-project-notes-table.mjs. */}
      <CollapsibleSection title="Notes">
        <div className="card-surface rounded-2xl p-6">
          <ProjectNotes projectId={id} />
        </div>
      </CollapsibleSection>

      {/* Admin Notes — per-note list, admin + internal PM only. Vendor
          PMs are also blocked at the endpoint level (GET returns 403),
          but the section header itself was rendering for them prior to
          2026-05-06 because the UI gate was just `isPM` — now uses
          canSeeInternalOnlyUi which respects scopedInstallerId on both
          the signed-in user and the View-As target. */}
      {canSeeInternalOnlyUi && (
        <CollapsibleSection
          title="Admin Notes"
          badge={
            <span className="text-[10px] text-[var(--accent-amber-text)] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-semibold uppercase tracking-wider">
              Admin · PM Only
            </span>
          }
        >
          <div className="card-surface rounded-2xl p-6" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-amber-solid) 4%, transparent), transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)' }}>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Private reference notes. Never visible to reps, trainers, sub-dealers, or vendor PMs.
            </p>
            <ProjectNotes projectId={id} kind="admin" />
          </div>
        </CollapsibleSection>
      )}

      {/* Equipment Snapshot — moved out of the top slot; demoted to a
          collapsible card alongside the other installer-surface sections
          for parity with mobile. Visible to all roles. */}
      <CollapsibleSection title="Equipment">
        <EquipmentSnapshot projectId={id} />
      </CollapsibleSection>

      {/* Installer-handoff surfaces — admin + PM only (gate uses
          effectiveRole, not currentRole, so admin View-As-Rep correctly
          hides these per project_kilo_client_filter_leaks.md). Server's
          privacy gate is the load-bearing enforcement; this client-side
          gate prevents reps from seeing the section headers at all. */}
      {(effectiveRole === 'admin' || isPM) && (
        <>
          <CollapsibleSection title="Installer Handoff">
            <HandoffStatusCard
              projectId={id}
              canResend={effectiveRole === 'admin' || (isPM && !viewAsUser?.scopedInstallerId)}
            />
          </CollapsibleSection>
          <CollapsibleSection title="Installer Files">
            <InstallerFiles
              projectId={id}
              canManage={effectiveRole === 'admin' || isPM}
            />
          </CollapsibleSection>
          <CollapsibleSection title="Site Survey Links">
            <SiteSurveyLinks
              projectId={id}
              canManage={effectiveRole === 'admin' || isPM}
            />
          </CollapsibleSection>
          <CollapsibleSection title="Installer Notes">
            <InstallerNotes
              projectId={id}
              canManage={effectiveRole === 'admin' || isPM}
            />
          </CollapsibleSection>
        </>
      )}

      {/* Chatter — above Activity so in-project discussion is the
          primary surface, with the activity log reachable just below. */}
      <CollapsibleSection title="Messages">
        <ProjectChatter projectId={id} />
      </CollapsibleSection>

      {/* Activity Timeline */}
      <CollapsibleSection title="Activity">
        <ActivityTimeline projectId={id} viewAsUserId={isViewingAs && viewAsUser ? viewAsUser.id : undefined} />
      </CollapsibleSection>

      {/* Edit Project modal — extracted to components/detail/EditProjectModal
          (T4.1 inc 2, strict pure move of the JSX). Form state, the
          imperative openEditModal seed, and saveEditModal stay page-owned;
          the Escape + scroll-lock effects above key on showEditModal. */}
      <EditProjectModal
        open={showEditModal}
        project={project}
        effectiveRole={effectiveRole}
        canSeeInternalOnlyUi={canSeeInternalOnlyUi}
        editAvailableBlitzes={editAvailableBlitzes}
        form={{ editVals, setEditVals, editErrors, setEditErrors }}
        data={{
          reps, activeInstallers, activeFinancers, solarTechProducts, installerBaselines,
          installerPricingVersions, productCatalogProducts, productCatalogPricingVersions,
          installerPayConfigs, trainerAssignments, payrollEntries, getInstallerPrepaidOptions,
        }}
        onSave={saveEditModal}
        onClose={() => { setShowEditModal(false); setEditErrors({}); }}
      />

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

      {/* Paid-amount correction modal (admin-only inline edit). Opened from
          the pencil affordance on Paid commission entries. onOpenChargeback
          intentionally omitted so the modal opens directly into fix-amount
          mode — chargeback recording lives on the Payroll page. */}
      <PaidCorrectionModal
        entry={paidCorrectionEntryId
          ? payrollEntries.find((e) => e.id === paidCorrectionEntryId) ?? null
          : null}
        onClose={() => setPaidCorrectionEntryId(null)}
        onCorrected={(updated: PayrollEntry) => {
          setPayrollEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        }}
      />

      {/* Record Trainer Payment modal (admin-only). Creates a Trainer-stage
          payroll entry on this project — used for Glide-imported deals where
          the trainer is attached but no Trainer payroll was auto-generated.
          installPayPct drives the M2/M3 split fraction. */}
      <RecordTrainerPaymentModal
        open={showRecordTrainerPayment}
        onClose={() => setShowRecordTrainerPayment(false)}
        onSaved={(entry: PayrollEntry) => {
          setPayrollEntries((prev) => [entry, ...prev]);
        }}
        projectId={project.id}
        projectCustomerName={project.customerName}
        projectKWSize={project.kWSize}
        defaultTrainerId={project.trainerId ?? effTrainerId ?? null}
        defaultTrainerRate={project.trainerRate ?? effectiveTrainerRate ?? null}
        installPayPct={installerPayConfigs[project.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT}
        reps={reps}
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

      {/* Cancellation Reason Modal — extracted to components/detail/
          CancelReasonModal (T4.1). State stays page-owned: the arrow-key
          nav effect reads showCancelReasonModal to suppress shortcuts. */}
      <CancelReasonModal
        open={showCancelReasonModal}
        customerName={project.customerName}
        reason={cancelReason}
        notes={cancelNotes}
        onReasonChange={setCancelReason}
        onNotesChange={setCancelNotes}
        onConfirm={confirmCancelWithReason}
        onClose={() => setShowCancelReasonModal(false)}
      />
    </div>
  );
}
