'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PHASES, Phase, InstallerBaseline, DEFAULT_INSTALL_PAY_PCT,
  getSolarTechBaseline, getProductCatalogBaselineVersioned,
  getInstallerRatesForDeal, calculateCommission, resolveTrainerRate,
} from '../../../lib/data';
import { formatDate, fmt$ } from '../../../lib/utils';
import { myCommissionOnProject } from '../../../lib/commissionHelpers';
import { ArrowLeft, Flag, FlagOff, Trash2, X as XIcon, Pencil, Copy } from 'lucide-react';
import MobileActivityTimeline from './MobileActivityTimeline';
import RecordChargebackModal from '../projects/components/RecordChargebackModal';
import { findChargebackForEntry } from '../../../lib/chargebacks';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ProjectChatter from '../components/ProjectChatter';
import { CoPartySection, type CoPartyDraft } from '../projects/components/CoPartySection';
import ConfirmDialog from '../components/ConfirmDialog';
// AdminNotesEditor removed 2026-04-23 — admin notes now render via ProjectNotes kind='admin'.
import { ProjectNotes } from '../components/ProjectNotes';

// ── Pipeline steps ──

const PIPELINE_STEPS: Phase[] = [
  'New', 'Acceptance', 'Site Survey', 'Design', 'Permitting',
  'Pending Install', 'Installed', 'PTO', 'Completed',
];

// Expected time a project typically spends in each phase.
// Used on the project detail stepper caption.
const PHASE_EXPECTED_TIME: Record<string, string> = {
  'New': 'Typically 1–3 days',
  'Acceptance': 'Typically 3–7 days',
  'Site Survey': 'Typically 5–10 days',
  'Design': 'Typically 7–14 days',
  'Permitting': 'Typically 2–4 weeks',
  'Pending Install': 'Typically 1–2 weeks',
  'Installed': 'Typically 2–6 weeks until PTO',
  'PTO': 'Final stage · utility approval',
  'Completed': 'Finalized',
  'Cancelled': 'Cancelled',
  'On Hold': 'Paused',
};

// ── Main Component ──

export default function MobileProjectDetail({ projectId }: { projectId: string }) {
  // Reset scroll on every project navigation. Without this the App Router
  // restores the parent (Projects list) scroll position, dropping users into
  // the middle of the detail page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [projectId]);

  const {
    effectiveRole, effectiveRepId, currentRepId, projects, setProjects, payrollEntries, reps,
    trainerAssignments,
    updateProject: ctxUpdateProject, installerPayConfigs,
    installerPricingVersions,
    productCatalogProducts, productCatalogPricingVersions, solarTechProducts,
  } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const isAdmin = effectiveRole === 'admin';
  const { toast } = useToast();
  const router = useRouter();

  const project = projects.find((p) => p.id === projectId);

  const [phaseSheetOpen, setPhaseSheetOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [phaseConfirm, setPhaseConfirm] = useState<Phase | null>(null);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');
  const [_notesExpanded, _setNotesExpanded] = useState(false);
  const [editM1, setEditM1] = useState(false);
  const [editM2, setEditM2] = useState(false);
  const [m1Val, setM1Val] = useState('');
  const [m2Val, setM2Val] = useState('');
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [showRecordChargeback, setShowRecordChargeback] = useState(false);
  const [, setEditErrors] = useState<Record<string, string>>({});
  const [editDraft, setEditDraft] = useState<{
    installer: string;
    financer: string;
    productType: string;
    kWSize: string;
    netPPW: string;
    soldDate: string;
    setterId: string;
    notes: string;
    useBaselineOverride: boolean;
    overrideCloserPerW: string;
    overrideSetterPerW: string;
    overrideKiloPerW: string;
    solarTechProductId: string;
    additionalClosers: CoPartyDraft[];
    additionalSetters: CoPartyDraft[];
    trainerId: string;
    trainerRate: string;
  }>({
    installer: '', financer: '', productType: '', kWSize: '', netPPW: '', soldDate: '',
    setterId: '', notes: '', useBaselineOverride: false,
    overrideCloserPerW: '', overrideSetterPerW: '', overrideKiloPerW: '',
    solarTechProductId: '', additionalClosers: [], additionalSetters: [],
    trainerId: '', trainerRate: '',
  });

  useEffect(() => {
    document.title = project ? `${project.customerName} | Kilo Energy` : 'Project | Kilo Energy';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend only on customerName to avoid re-fires on any project field change
  }, [project?.customerName]);

  if (!project) {
    return (
      <div className="px-5 pt-4 pb-24 text-center text-base text-slate-400">
        Project not found.
        <button onClick={() => router.push('/dashboard/projects')} className="text-blue-400 ml-1">Back to Projects</button>
      </div>
    );
  }

  if (
    effectiveRole === 'rep' &&
    project.repId !== effectiveRepId &&
    project.setterId !== effectiveRepId &&
    project.trainerId !== effectiveRepId &&
    !project.additionalClosers?.some((p) => p.userId === effectiveRepId) &&
    !project.additionalSetters?.some((p) => p.userId === effectiveRepId)
  ) {
    return (
      <div className="px-5 pt-4 pb-24 text-center text-base text-slate-400">
        You don&apos;t have permission to view this project.
        <button onClick={() => router.push('/dashboard/projects')} className="text-blue-400 ml-1">Back</button>
      </div>
    );
  }

  if (effectiveRole === 'sub-dealer' && project.subDealerId !== effectiveRepId && project.repId !== effectiveRepId) {
    return (
      <div className="px-5 pt-4 pb-24 text-center text-base text-slate-400">
        You don&apos;t have permission to view this project.
        <button onClick={() => router.push('/dashboard/projects')} className="text-blue-400 ml-1">Back</button>
      </div>
    );
  }

  const updateProject = (updates: Partial<typeof project>) => {
    ctxUpdateProject(projectId, updates);
  };

  const handleToggleM1 = () => {
    const previousM1Paid = project.m1Paid;
    const next = !previousM1Paid;
    updateProject({ m1Paid: next });
    toast(`M1 marked as ${next ? 'Paid' : 'Unpaid'}`, 'success', { label: 'Undo', onClick: () => { updateProject({ m1Paid: previousM1Paid }); } });
  };

  const handleToggleM2 = () => {
    const previousM2Paid = project.m2Paid;
    const next = !previousM2Paid;
    updateProject({ m2Paid: next });
    toast(`M2 marked as ${next ? 'Paid' : 'Unpaid'}`, 'success', { label: 'Undo', onClick: () => { updateProject({ m2Paid: previousM2Paid }); } });
  };

  const handleToggleM3 = () => {
    const previousM3Paid = project.m3Paid;
    const next = !previousM3Paid;
    updateProject({ m3Paid: next });
    toast(`M3 marked as ${next ? 'Paid' : 'Unpaid'}`, 'success', { label: 'Undo', onClick: () => { updateProject({ m3Paid: previousM3Paid }); } });
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
      const scale = originalM2 > 0 ? val / originalM2 : 1;
      const newSetterM2 = Math.round((project.setterM2Amount ?? 0) * scale * 100) / 100;
      const newSetterM3 = installPayPct < 100 && !project.subDealerId && project.setterId
        ? Math.round(newSetterM2 * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      updateProject({ m2Amount: val, m3Amount: newM3, setterM2Amount: newSetterM2, setterM3Amount: newSetterM3 });
      if (originalM2 === 0 && project.setterId) {
        toast('M2 updated — closer M2 was $0 so setter M2 could not be auto-scaled.', 'error');
      } else {
        toast('M2 amount updated', 'success');
      }
      setEditM2(false);
    } else { toast('Invalid amount', 'error'); }
  };

  // ── Edit sheet handlers ─────────────────────────────────────────────
  const openEditSheet = () => {
    setEditDraft({
      installer: project.installer,
      financer: project.financer,
      productType: project.productType,
      kWSize: String(project.kWSize),
      netPPW: String(project.netPPW),
      soldDate: project.soldDate,
      setterId: project.setterId ?? '',
      notes: project.notes ?? '',
      useBaselineOverride: !!project.baselineOverride,
      overrideCloserPerW: project.baselineOverride ? String(project.baselineOverride.closerPerW) : '',
      overrideSetterPerW: project.baselineOverride?.setterPerW != null ? String(project.baselineOverride.setterPerW) : '',
      overrideKiloPerW: project.baselineOverride ? String(project.baselineOverride.kiloPerW) : '',
      solarTechProductId: project.solarTechProductId ?? '',
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
    });
    setEditErrors({});
    setMoreSheetOpen(false);
    setEditSheetOpen(true);
  };

  const saveEditSheet = () => {
    const toNum = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const cleanClosers = editDraft.additionalClosers
      .filter((c) => !!c.userId && c.userId !== project.repId)
      .map((c, i) => ({
        userId: c.userId,
        userName: reps.find((r) => r.id === c.userId)?.name ?? '',
        m1Amount: toNum(c.m1Amount),
        m2Amount: toNum(c.m2Amount),
        m3Amount: c.m3Amount.trim() === '' ? null : toNum(c.m3Amount),
        position: i + 1,
      }));
    const cleanSetters = editDraft.additionalSetters
      .filter((s) => !!s.userId && s.userId !== editDraft.setterId)
      .map((s, i) => ({
        userId: s.userId,
        userName: reps.find((r) => r.id === s.userId)?.name ?? '',
        m1Amount: toNum(s.m1Amount),
        m2Amount: toNum(s.m2Amount),
        m3Amount: s.m3Amount.trim() === '' ? null : toNum(s.m3Amount),
        position: i + 1,
      }));
    const setterRep = editDraft.setterId ? reps.find((r) => r.id === editDraft.setterId) : undefined;
    const trainerRateNum = editDraft.trainerRate.trim() !== '' ? parseFloat(editDraft.trainerRate) : NaN;
    const nextTrainerId = editDraft.trainerId || undefined;
    const nextTrainerRate = nextTrainerId && Number.isFinite(trainerRateNum) ? trainerRateNum : undefined;
    const trainerRep = nextTrainerId ? reps.find((r) => r.id === nextTrainerId) : undefined;

    // Recalculate milestone amounts — setter presence changes closer M1 ($0 with setter, flat without)
    const kw = project.kWSize;
    const ppw = project.netPPW;
    let baseline: InstallerBaseline;
    if (project.baselineOverride) {
      baseline = project.baselineOverride;
    } else if (project.installer === 'SolarTech' && project.solarTechProductId) {
      baseline = getSolarTechBaseline(project.solarTechProductId, kw, solarTechProducts);
    } else if (project.installerProductId) {
      baseline = getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, kw, project.soldDate, productCatalogPricingVersions);
    } else {
      baseline = getInstallerRatesForDeal(project.installer, project.soldDate, kw, installerPricingVersions);
    }
    const closerTotal = calculateCommission(ppw, baseline.closerPerW, kw);
    const m1Flat = kw >= 5 ? 1000 : 500;
    const setterPerW = 'setterPerW' in baseline && baseline.setterPerW != null
      ? baseline.setterPerW
      : Math.round((baseline.closerPerW + 0.10) * 100) / 100;
    const setterTotal = calculateCommission(ppw, setterPerW, kw);
    const hasSetter = !!editDraft.setterId;
    const newSetterM1Amount = hasSetter ? Math.min(m1Flat, Math.max(0, setterTotal)) : 0;
    const installPayPct = installerPayConfigs[project.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    const hasM3 = installPayPct < 100 && !project.subDealerId;
    const newM1Amount = hasSetter ? 0 : Math.min(m1Flat, Math.max(0, closerTotal));
    const closerM2Full = Math.max(0, closerTotal - newM1Amount);
    const setterM2Full = Math.max(0, setterTotal - newSetterM1Amount);
    const newM2Amount = Math.round(closerM2Full * (installPayPct / 100) * 100) / 100;
    const newM3Amount = hasM3 ? Math.round(closerM2Full * ((100 - installPayPct) / 100) * 100) / 100 : 0;
    const newSetterM2Amount = hasSetter ? Math.round(setterM2Full * (installPayPct / 100) * 100) / 100 : 0;
    const newSetterM3Amount = hasSetter && hasM3 ? Math.round(setterM2Full * ((100 - installPayPct) / 100) * 100) / 100 : 0;

    updateProject({
      setterId: editDraft.setterId || undefined,
      setterName: setterRep?.name ?? (editDraft.setterId ? project.setterName : undefined),
      notes: editDraft.notes,
      additionalClosers: cleanClosers,
      additionalSetters: cleanSetters,
      trainerId: nextTrainerId,
      trainerName: trainerRep?.name,
      trainerRate: nextTrainerRate,
      m1Amount: newM1Amount,
      m2Amount: newM2Amount,
      m3Amount: newM3Amount,
      setterM1Amount: newSetterM1Amount,
      setterM2Amount: newSetterM2Amount,
      setterM3Amount: newSetterM3Amount,
    });
    setEditSheetOpen(false);
    toast('Project updated', 'success');
  };

  // ── Phase change handlers ──

  const doPhaseChange = (phase: Phase) => {
    const previousPhase = project.phase;
    updateProject({ phase });
    toast(`Phase updated to ${phase}`, 'success', {
      label: 'Undo',
      onClick: () => updateProject({ phase: previousPhase }),
    });
  };

  const handlePhaseChange = (phase: Phase) => {
    setPhaseSheetOpen(false);
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

  const confirmCancelWithReason = () => {
    if (!cancelReason) {
      toast('Please select a cancellation reason', 'error');
      return;
    }
    updateProject({
      phase: 'Cancelled',
      cancellationReason: cancelReason,
      cancellationNotes: cancelNotes || undefined,
    } as Partial<typeof project>);
    setShowCancelReasonModal(false);
    toast('Project cancelled', 'info');
    router.push('/dashboard/projects');
  };

  const handleFlag = () => {
    const newFlagged = !project.flagged;
    updateProject({ flagged: newFlagged });
    toast(newFlagged ? 'Project flagged' : 'Flag removed', newFlagged ? 'info' : 'success');
    setMoreSheetOpen(false);
  };

  const handleCancel = () => {
    setMoreSheetOpen(false);
    setCancelReason('');
    setCancelNotes('');
    setShowCancelReasonModal(true);
  };

  const handleDelete = () => {
    setMoreSheetOpen(false);
    setShowDeleteConfirm(true);
  };

  const doDelete = async () => {
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

  // ── Commission data ──

  // Shared helper computes total + per-stage applicability + status for
  // both reps and sub-dealers. SDs don't get an M1, and M3 only applies
  // when the installer has an M2/M3 structure (project.m3Amount > 0).
  const myCommission = myCommissionOnProject(project, effectiveRepId, effectiveRole, payrollEntries);

  // Find payroll entry dates for milestones
  const projectEntries = payrollEntries.filter((e) => e.projectId === project.id);
  const _getEntryDate = (stage: 'M1' | 'M2' | 'M3'): string | null => {
    const entry = projectEntries.find((e) => e.paymentStage === stage && e.status !== 'Draft');
    return entry ? entry.date : null;
  };
  const _formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  // Estimate next Friday after a target date
  const _estimateFriday = (baseDate: string, addDays: number): string => {
    const d = new Date(baseDate + 'T12:00:00');
    d.setDate(d.getDate() + addDays);
    const day = d.getDay();
    const diff = ((5 - day + 7) % 7) || 7;
    if (day !== 5) d.setDate(d.getDate() + diff);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ── Phase stepper ──

  const currentStepIndex = PIPELINE_STEPS.indexOf(project.phase);
  const isOffTrack = currentStepIndex === -1;

  // ── Info rows ──

  const infoRows: [string, string][] = [
    ['Rep', project.repName],
    ['Installer', project.installer],
    ['Financer', project.financer],
    ['Product Type', project.productType],
    ['System Size', `${project.kWSize} kW`],
    ...(!isPM ? [['Net PPW', `$${project.netPPW}`] as [string, string]] : []),
    ['Sold Date', formatDate(project.soldDate)],
  ];
  if (project.setterId) {
    infoRows.push(['Setter', project.setterName ?? '']);
  }
  // Tag-team co-parties — display names after primary closer/setter so
  // a mobile user can see the full attribution at a glance.
  if (project.additionalClosers && project.additionalClosers.length > 0) {
    for (const co of project.additionalClosers) {
      infoRows.push([`Co-closer #${co.position}`, co.userName]);
    }
  }
  if (project.additionalSetters && project.additionalSetters.length > 0) {
    for (const co of project.additionalSetters) {
      infoRows.push([`Co-setter #${co.position}`, co.userName]);
    }
  }
  if (project.leadSource) {
    infoRows.push(['Lead Source', project.leadSource === 'door_knock' ? 'Door Knock' : project.leadSource]);
  }

  return (
    <div className="px-5 pt-4 pb-40 space-y-4 animate-mobile-slide-in">

      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/projects')}
        className="flex items-center gap-1 text-base text-slate-400 mb-4 min-h-[48px]"
      >
        <ArrowLeft className="w-4 h-4" />
        Projects
      </button>

      {/* Customer name + phase badge + flagged.
          For admin / internal PM viewers, the phase badge is wrapped in
          a button that opens the same phase bottom sheet the sticky
          footer uses — lets a busy admin bump a phase without scrolling
          to the footer. Min-height 44px for touch target; chevron
          signals tappability. Rep/SD/vendor-PM still see a plain pill. */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">{project.customerName}</h1>
          <div className="flex items-center gap-2 mt-1">
            {(isAdmin || isPM) ? (
              <button
                type="button"
                onClick={() => setPhaseSheetOpen(true)}
                aria-label={`Change phase — currently ${project.phase}`}
                className="inline-flex items-center gap-1.5 min-h-[36px] rounded-full active:scale-[0.97] transition-transform duration-75 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-cyan-solid)]/50"
              >
                <MobileBadge value={project.phase} />
                <span
                  aria-hidden="true"
                  className="text-xs leading-none"
                  style={{ color: 'var(--text-dim)' }}
                >
                  &#x25BE;
                </span>
              </button>
            ) : (
              <MobileBadge value={project.phase} />
            )}
            {project.flagged && <span className="w-2 h-2 rounded-full bg-red-500" />}
          </div>
        </div>
      </div>

      {/* Phase stepper — compact dots */}
      <div className="flex items-center gap-1.5 px-1">
        {PIPELINE_STEPS.map((step, index) => {
          const isCompleted = !isOffTrack && currentStepIndex > index;
          const isCurrent = !isOffTrack && currentStepIndex === index;
          return (
            <div key={step} className="flex items-center gap-1.5">
              <div
                className={`rounded-full${isCurrent ? ' mobile-stepper-current' : ''}`}
                style={{
                  width: isCurrent ? 14 : 10,
                  height: isCurrent ? 14 : 10,
                  background: isCompleted ? 'var(--accent-emerald-solid)' : isCurrent ? 'var(--accent-cyan-solid)' : 'var(--border-subtle)',
                  willChange: 'transform',
                  animation: `dotPop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 40}ms both`,
                  transition: 'width 300ms cubic-bezier(0.34, 1.56, 0.64, 1), height 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
                title={step}
              />
              {index < PIPELINE_STEPS.length - 1 && (
                <div className="w-3 h-px" style={{ background: isCompleted ? 'var(--accent-emerald-solid)' : 'var(--border-subtle)', transition: 'background 350ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
              )}
            </div>
          );
        })}
      </div>

      <p
        className="font-bold tracking-wide mt-2"
        style={{
          color: isOffTrack
            ? (project.phase === 'Cancelled' ? '#ef4444' : '#f59e0b')
            : 'var(--accent-cyan-solid)',
          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          letterSpacing: '0.02em',
          fontSize: '1rem',
          lineHeight: 1.2,
        }}
      >
        {project.phase}
      </p>
      <p
        className="mt-0.5"
        style={{
          color: 'var(--text-dim)',
          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          fontSize: '0.85rem',
          lineHeight: 1.3,
        }}
      >
        {PHASE_EXPECTED_TIME[project.phase] ?? '—'}
      </p>

      {/* YOUR COMMISSION — dominant total header (reps + sub-dealers only).
          The M1/M2/M3 breakdown card below this shows the stage split. */}
      {!isPM && !isAdmin && myCommission.total > 0 && (
        <MobileCard hero>
          <p
            className="tracking-widest uppercase"
            style={{
              color: 'var(--text-dim)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              fontSize: '0.75rem',
              fontWeight: 500,
              marginBottom: '0.25rem',
            }}
          >
            Your Commission
          </p>
          <p
            className="tabular-nums break-words"
            style={{
              fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
              fontSize: 'clamp(2.5rem, 13vw, 3.5rem)',
              color:
                myCommission.status === 'paid'
                  ? 'var(--accent-emerald-solid)'
                  : myCommission.status === 'partial'
                  ? 'var(--accent-amber-solid)'
                  : 'var(--accent-emerald-solid)',
              lineHeight: 1.05,
            }}
          >
            {fmt$(myCommission.total)}
          </p>
          <p
            style={{
              color: 'var(--text-muted)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              fontSize: '0.85rem',
              marginTop: '0.35rem',
            }}
          >
            {myCommission.status === 'paid'
              ? 'Fully paid'
              : myCommission.status === 'partial'
              ? 'Partially paid · see breakdown below'
              : 'Projected earnings on this deal'}
          </p>
        </MobileCard>
      )}

      {/* Info rows — no card wrapper, thin separators */}
      <div className="space-y-0">
        {infoRows.map(([label, value], index) => (
          <div key={label} className="flex items-center justify-between py-3 animate-info-row-enter" style={{ borderBottom: '1px solid var(--border-subtle)', animationDelay: `${index * 35}ms` }}>
            <span className="text-base" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</span>
            <span className="text-base font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Commission breakdown card — hide for PM.
          Rep/SD: pull per-stage amounts + paid status from myCommission.stages
            so setters see setter amounts, SDs skip M1, and M3 only shows if
            the installer structure produces an M3 (m3Amount > 0).
          Admin: show the deal's own amounts from project fields (viewing the
            deal, not "their" stake).

          Total-expected rows (top of each card) mirror desktop behavior —
          rep/SD see their own sum; admin sees closer + setter sums when
          applicable; closer-viewing-own sees setter total too. */}
      {!isPM && (() => {
        const isMeView = effectiveRole === 'rep' || effectiveRole === 'sub-dealer';
        const isCloserRep = isMeView && project.repId === effectiveRepId;
        type Stage = { key: 'M1' | 'M2' | 'M3'; amount: number; paid: boolean };
        const allStages: Stage[] = isMeView
          ? [
              { key: 'M1', amount: myCommission.stages.m1.amount, paid: myCommission.stages.m1.paid },
              { key: 'M2', amount: myCommission.stages.m2.amount, paid: myCommission.stages.m2.paid },
              { key: 'M3', amount: myCommission.stages.m3.amount, paid: myCommission.stages.m3.paid },
            ]
          : [
              { key: 'M1', amount: project.m1Amount ?? 0, paid: project.m1Paid ?? false },
              { key: 'M2', amount: project.m2Amount ?? 0, paid: project.m2Paid ?? false },
              { key: 'M3', amount: project.m3Amount ?? 0, paid: project.m3Paid ?? false },
            ];
        // Decide which stages to render: for rep/SD use the applicable flag,
        // for admin include M1/M2 always and M3 only if it has an amount.
        const visibleStages: Stage[] = isMeView
          ? allStages.filter((s) =>
              s.key === 'M1'
                ? myCommission.stages.m1.applicable
                : s.key === 'M2'
                ? myCommission.stages.m2.applicable
                : myCommission.stages.m3.applicable,
            )
          : allStages.filter((s) => s.key === 'M1' || s.key === 'M2' || s.amount > 0);

        // Track-fill percentage across the visible stages.
        const paidCount = visibleStages.filter((s) => s.paid).length;
        const fillPct =
          visibleStages.length === 0
            ? 0
            : (paidCount / visibleStages.length) * 100;

        // Totals for the summary row(s).
        const myTotalExpected = isMeView
          ? myCommission.stages.m1.amount + myCommission.stages.m2.amount + myCommission.stages.m3.amount
          : 0;
        const closerTotalExpected =
          (project.m1Amount ?? 0) + (project.m2Amount ?? 0) + (project.m3Amount ?? 0);
        const setterTotalExpected = project.setterId
          ? (project.setterM1Amount ?? 0) + (project.setterM2Amount ?? 0) + (project.setterM3Amount ?? 0)
          : 0;
        const showSetterTotalToCloser = isCloserRep && project.setterId && setterTotalExpected > 0;

        return (
          <MobileCard>
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Commission Breakdown</h2>

            {/* Total-expected summary row — rep/SD see own total; admin sees
                closer (and setter, if applicable) totals. */}
            {isMeView && myTotalExpected > 0 && (
              <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-card)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total expected</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(myTotalExpected)}</span>
              </div>
            )}
            {showSetterTotalToCloser && (
              <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-card)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{project.setterName} (setter) total</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt$(setterTotalExpected)}</span>
              </div>
            )}
            {!isMeView && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--surface-card)' }}>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{project.repName} (closer)</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Total expected</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(closerTotalExpected)}</span>
                </div>
                {project.setterId && setterTotalExpected > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--surface-card)' }}>
                    <div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{project.setterName} (setter)</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Total expected</p>
                    </div>
                    <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(setterTotalExpected)}</span>
                  </div>
                )}
                {/* Co-closers — desktop renders these as full cards with
                    M1/M2/M3 breakdown; mobile keeps it compact with one
                    row per party showing the sum. Only rendered for
                    admin/PM since scrubber zeros these amounts for reps. */}
                {(project.additionalClosers ?? []).map((co) => {
                  const coTotal = co.m1Amount + co.m2Amount + (co.m3Amount ?? 0);
                  if (coTotal <= 0) return null;
                  return (
                    <div key={`cc-${co.userId}`} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--surface-card)' }}>
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{co.userName} (co-closer · #{co.position})</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                          M1 ${co.m1Amount.toLocaleString()} · M2 ${co.m2Amount.toLocaleString()}
                          {(co.m3Amount ?? 0) > 0 && ` · M3 $${co.m3Amount!.toLocaleString()}`}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(coTotal)}</span>
                    </div>
                  );
                })}
                {(project.additionalSetters ?? []).map((co) => {
                  const coTotal = co.m1Amount + co.m2Amount + (co.m3Amount ?? 0);
                  if (coTotal <= 0) return null;
                  return (
                    <div key={`cs-${co.userId}`} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--surface-card)' }}>
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{co.userName} (co-setter · #{co.position})</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                          M1 ${co.m1Amount.toLocaleString()} · M2 ${co.m2Amount.toLocaleString()}
                          {(co.m3Amount ?? 0) > 0 && ` · M3 $${co.m3Amount!.toLocaleString()}`}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(coTotal)}</span>
                    </div>
                  );
                })}
                {/* Trainer row — matches desktop's dedicated trainer card.
                    trainerId/trainerName/trainerRate are scrubbed server-
                    side for non-admin/PM viewers, so this block only
                    renders for admin. Explicit isAdmin guard mirrors the
                    desktop gate (effectiveRole === 'admin' && !isPM). */}
                {isAdmin && (() => {
                  const { rate: effTrainerRate, trainerId: effTrainerId } = resolveTrainerRate(
                    { id: project.id, trainerId: project.trainerId ?? null, trainerRate: project.trainerRate ?? null },
                    project.repId,
                    trainerAssignments,
                    payrollEntries,
                  );
                  const trainerName = project.trainerName ?? reps.find((r) => r.id === effTrainerId)?.name ?? 'Trainer';
                  if (!effTrainerId || effTrainerRate <= 0) return null;
                  return (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{trainerName} (trainer)</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                          ${effTrainerRate.toFixed(2)}/W × {project.kWSize} kW
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-amber-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                        {fmt$(effTrainerRate * (project.kWSize ?? 0) * 1000)}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="relative flex items-start justify-between pt-2 pb-4">
              {visibleStages.length > 1 && (
                <>
                  <div className="absolute top-[18px] left-[14px] right-[14px] h-0.5" style={{ background: 'var(--border-subtle)' }} />
                  <div
                    className="absolute top-[18px] left-[14px] h-0.5 milestone-track-fill"
                    style={{
                      width: `calc(${Math.min(100, Math.max(0, fillPct))}% - 28px)`,
                      background: 'linear-gradient(90deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
                      animation: 'trackFill 600ms cubic-bezier(0.16, 1, 0.3, 1) 150ms both',
                    }}
                  />
                </>
              )}
              {visibleStages.map((stage, i) => {
                const isEditableStage = !isMeView && isAdmin && (stage.key === 'M1' || stage.key === 'M2');
                const isToggleableM3 = !isMeView && isAdmin && stage.key === 'M3' && stage.amount > 0;
                const isEditing = stage.key === 'M1' ? editM1 : editM2;
                return (
                  <div key={stage.key} className="flex flex-col items-center gap-1.5 relative z-10">
                    <div
                      className="milestone-node w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: stage.paid ? 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))' : 'var(--surface-card)',
                        border: `2px solid ${stage.paid ? 'var(--accent-emerald-solid)' : 'var(--border-subtle)'}`,
                        color: stage.paid ? '#000' : 'var(--text-muted)',
                        animation: `nodePop 350ms cubic-bezier(0.34, 1.56, 0.64, 1) ${150 + i * 120}ms both`,
                      }}
                    >{stage.key}</div>
                    {isEditableStage && isEditing ? (
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="number"
                          value={stage.key === 'M1' ? m1Val : m2Val}
                          onChange={(e) => stage.key === 'M1' ? setM1Val(e.target.value) : setM2Val(e.target.value)}
                          className="w-20 text-xs text-center rounded px-1 py-0.5 text-[var(--text-primary)]"
                          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
                        />
                        <div className="flex gap-1.5">
                          <button onClick={stage.key === 'M1' ? saveM1 : saveM2} className="text-[10px] font-medium" style={{ color: 'var(--accent-emerald-text)' }}>Save</button>
                          <button onClick={() => stage.key === 'M1' ? setEditM1(false) : setEditM2(false)} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {isEditableStage ? (
                          <button
                            onClick={() => {
                              if (stage.key === 'M1') { setM1Val(String(stage.amount)); setEditM1(true); }
                              else { setM2Val(String(stage.amount)); setEditM2(true); }
                            }}
                            className="milestone-amount text-sm font-bold tabular-nums underline-offset-2"
                            style={{
                              color: stage.paid ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                              fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                              animation: `amountFadeUp 280ms cubic-bezier(0.16,1,0.3,1) ${300 + i * 100}ms both`,
                            }}
                          >{fmt$(stage.amount)}</button>
                        ) : (
                          <span
                            className="milestone-amount text-sm font-bold tabular-nums"
                            style={{
                              color: stage.paid ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                              fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                              animation: `amountFadeUp 280ms cubic-bezier(0.16,1,0.3,1) ${300 + i * 100}ms both`,
                            }}
                          >{fmt$(stage.amount)}</span>
                        )}
                        <MobileBadge value={stage.paid ? 'Paid' : 'Pending'} variant="status" />
                        {(isEditableStage || isToggleableM3) && (
                          <button
                            onClick={stage.key === 'M1' ? handleToggleM1 : stage.key === 'M2' ? handleToggleM2 : handleToggleM3}
                            className="text-[10px] px-1.5 py-0.5 rounded-md font-medium min-h-[28px]"
                            style={{ background: stage.paid ? 'rgba(16,185,129,0.12)' : 'var(--accent-amber-soft)', color: stage.paid ? 'var(--accent-emerald-solid)' : '#f59e0b' }}
                          >
                            {stage.paid ? 'Mark Unpaid' : 'Mark Paid'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </MobileCard>
        );
      })()}

      {/* Cancelled banner + chargeback affordance (admin only) */}
      {isAdmin && project.phase === 'Cancelled' && (() => {
        const eligiblePaidEntries = projectEntries
          .filter((e) => e.status === 'Paid' && !e.isChargeback && !findChargebackForEntry(e.id, projectEntries));
        if (eligiblePaidEntries.length === 0) return null;
        return (
          <div className="flex items-center justify-between gap-3 bg-amber-900/20 border border-amber-500/30 rounded-xl p-4">
            <div>
              <p className="text-amber-300 text-sm font-semibold">Deal cancelled — chargeback(s) pending</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
                {eligiblePaidEntries.length} Paid milestone{eligiblePaidEntries.length !== 1 ? 's' : ''} without a linked chargeback.
              </p>
            </div>
            <button
              onClick={() => setShowRecordChargeback(true)}
              className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 active:bg-amber-500/30 text-amber-300 border border-amber-500/40"
            >
              Record Chargeback
            </button>
          </div>
        );
      })()}

      {/* Notes — per-note rows (added + individually deletable). */}
      <MobileSection title="Notes" collapsible defaultOpen={false}>
        <ProjectNotes projectId={project.id} />
      </MobileSection>

      {/* Admin Notes — per-note list, admin + internal PM only. Vendor
          PMs are blocked at the endpoint. */}
      {(isAdmin || isPM) && (
        <MobileSection title="Admin Notes" collapsible defaultOpen={false}>
          <p className="text-xs text-[var(--text-dim)] mb-2">
            Private reference notes. Never visible to reps, trainers, sub-dealers, or vendor PMs.
          </p>
          <ProjectNotes projectId={projectId} kind="admin" />
        </MobileSection>
      )}

      {/* Messages / Chatter */}
      <ProjectChatter projectId={projectId} />

      {/* Activity Timeline */}
      <MobileActivityTimeline projectId={projectId} />

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-16 left-0 right-0 z-50 flex items-center gap-3 px-5 py-3" style={{ background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)' }}>
        {(isAdmin || isPM) && (
          <button
            onClick={() => setPhaseSheetOpen(true)}
            className="flex-1 min-h-[48px] text-[var(--text-primary)] text-base font-semibold rounded-xl active:scale-[0.97] transition-transform duration-75 ease-out"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
              boxShadow: '0 4px 20px rgba(0,229,160,0.25)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Change Phase &#x25BE;
          </button>
        )}
        <button
          onClick={() => setMoreSheetOpen(true)}
          className="min-h-[48px] px-5 text-base font-medium rounded-xl active:scale-[0.95] transition-transform duration-75 ease-out"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          &middot; &middot; &middot;
        </button>
      </div>

      {/* Phase bottom sheet */}
      <MobileBottomSheet open={phaseSheetOpen} onClose={() => setPhaseSheetOpen(false)} title="Change Phase">
        {PHASES.map((phase) => (
          <MobileBottomSheet.Item
            key={phase}
            label={phase}
            onTap={() => handlePhaseChange(phase)}
            danger={phase === 'Cancelled'}
            active={phase === project.phase}
          />
        ))}
      </MobileBottomSheet>

      {/* More actions bottom sheet */}
      <MobileBottomSheet open={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} title="Actions">
        {isAdmin && (
          <MobileBottomSheet.Item
            label="Edit Project"
            icon={Pencil}
            onTap={openEditSheet}
          />
        )}
        {(isAdmin && !isPM || currentRepId === project.repId) && (
          <MobileBottomSheet.Item
            label="Duplicate Deal"
            icon={Copy}
            onTap={() => {
              setMoreSheetOpen(false);
              router.push(`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`);
            }}
          />
        )}
        <MobileBottomSheet.Item
          label={project.flagged ? 'Remove Flag' : 'Flag Project'}
          icon={project.flagged ? FlagOff : Flag}
          onTap={handleFlag}
        />
        {project.phase !== 'Cancelled' && (isAdmin || isPM || currentRepId === project.repId) && (
          <MobileBottomSheet.Item
            label="Cancel Project"
            icon={XIcon}
            onTap={handleCancel}
            danger
          />
        )}
        {isAdmin && (
          <MobileBottomSheet.Item
            label="Delete Project"
            icon={Trash2}
            onTap={handleDelete}
            danger
          />
        )}
      </MobileBottomSheet>

      {/* Edit Project bottom sheet — admin-only, scoped to setter + notes
          + co-party management. Heavier edits (installer, financer, kW,
          PPW, baseline override) remain on desktop where the commission
          preview UI lives. */}
      <MobileBottomSheet open={editSheetOpen} onClose={() => setEditSheetOpen(false)} title="Edit Project">
        <div className="px-5 space-y-5 pb-24">
          {/* Setter */}
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 500 }}>
              Setter (optional)
            </label>
            <select
              value={editDraft.setterId}
              onChange={(e) => setEditDraft((d) => ({ ...d, setterId: e.target.value }))}
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '12px 14px', color: 'var(--text-primary)', fontSize: '1rem' }}
            >
              <option value="">— None —</option>
              {reps.filter((r) => (r.repType === 'setter' || r.repType === 'both') && (r.active || r.id === editDraft.setterId) && r.id !== project.repId).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 500 }}>
              Notes
            </label>
            <textarea
              rows={3}
              value={editDraft.notes}
              onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
              className="w-full outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '14px 16px', color: 'var(--text-primary)', fontSize: '1rem' }}
            />
          </div>

          {/* Co-closers + Co-setters — reuse the CoPartySection from desktop.
              Grid gets tight on narrow phones but stays tappable. */}
          <CoPartySection
            label="Co-closers"
            rows={editDraft.additionalClosers}
            primaryUserId={project.repId}
            excludeUserIds={[editDraft.setterId, ...editDraft.additionalClosers.map((c) => c.userId), ...editDraft.additionalSetters.map((s) => s.userId)].filter(Boolean)}
            repTypeFilter={(r) => r.repType === 'closer' || r.repType === 'both'}
            reps={reps}
            onChange={(rows) => setEditDraft((d) => ({ ...d, additionalClosers: rows }))}
          />
          <CoPartySection
            label="Co-setters"
            rows={editDraft.additionalSetters}
            primaryUserId={editDraft.setterId}
            excludeUserIds={[project.repId, editDraft.setterId, ...editDraft.additionalSetters.map((s) => s.userId), ...editDraft.additionalClosers.map((c) => c.userId)].filter(Boolean)}
            repTypeFilter={(r) => r.repType === 'setter' || r.repType === 'both'}
            reps={reps}
            onChange={(rows) => setEditDraft((d) => ({ ...d, additionalSetters: rows }))}
            disabled={!editDraft.setterId}
            disabledReason="Select a primary setter to add co-setters."
          />

          {/* Per-project trainer override — admin only. */}
          {isAdmin && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Per-project trainer</span>
                {editDraft.trainerId && (
                  <button
                    type="button"
                    onClick={() => setEditDraft((d) => ({ ...d, trainerId: '', trainerRate: '' }))}
                    className="text-xs"
                    style={{ color: 'rgba(255,100,100,0.8)' }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Attaches a trainer + rate to this deal only. Overrides the rep&apos;s assignment chain.
              </p>
              <select
                value={editDraft.trainerId}
                onChange={(e) => setEditDraft((d) => ({ ...d, trainerId: e.target.value }))}
                className="w-full mb-2"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '12px', fontSize: '0.95rem', color: 'var(--text-primary)' }}
              >
                <option value="">— no trainer override —</option>
                {reps.filter((r) => r.active && r.id !== project.repId && r.id !== editDraft.setterId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                max="5"
                placeholder="Rate $/W (e.g. 0.20)"
                value={editDraft.trainerRate}
                disabled={!editDraft.trainerId}
                onChange={(e) => setEditDraft((d) => ({ ...d, trainerRate: e.target.value }))}
                className="w-full"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '12px', fontSize: '0.95rem', color: 'var(--text-primary)', opacity: editDraft.trainerId ? 1 : 0.45 }}
              />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={saveEditSheet}
              className="flex-1 font-semibold"
              style={{ background: 'linear-gradient(135deg, #1de9b6, #00b894)', borderRadius: '14px', padding: '16px', fontSize: '1rem', color: 'var(--text-primary)' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditSheetOpen(false)}
              className="flex-1"
              style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '14px', padding: '16px', fontSize: '1rem', color: 'var(--text-primary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </MobileBottomSheet>

      {/* Cancellation reason modal */}
      {showCancelReasonModal && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4 pb-8"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCancelReasonModal(false); }}
        >
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-[var(--text-primary)] font-bold text-base">Cancel Project</span>
              <button onClick={() => setShowCancelReasonModal(false)} className="text-slate-400 p-1"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-slate-400 text-sm">Please provide a reason for cancelling <span className="text-[var(--text-primary)] font-medium">{project.customerName}</span>.</p>
              <div>
                <label className="block text-xs uppercase tracking-wider mb-1.5 text-slate-400">Reason</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)' }}
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
                <label className="block text-xs uppercase tracking-wider mb-1.5 text-slate-400">Notes <span className="normal-case font-normal text-slate-500">(optional)</span></label>
                <textarea
                  rows={3}
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none resize-none placeholder-slate-500"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)' }}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowCancelReasonModal(false)}
                  className="flex-1 font-medium text-sm rounded-xl py-3"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}
                >
                  Go Back
                </button>
                <button
                  onClick={confirmCancelWithReason}
                  className="flex-1 font-semibold text-sm rounded-xl py-3 bg-red-600 active:bg-red-500 text-[var(--text-primary)]"
                >
                  Cancel Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!phaseConfirm}
        title={`Move to ${phaseConfirm ?? ''}?`}
        message={`Are you sure you want to move "${project.customerName}" to ${phaseConfirm ?? ''}? This will remove it from the active pipeline.`}
        confirmLabel="Confirm"
        onConfirm={() => {
          if (phaseConfirm) {
            doPhaseChange(phaseConfirm);
            setPhaseConfirm(null);
          }
        }}
        onClose={() => setPhaseConfirm(null)}
      />
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Project"
        message={`Permanently delete ${project.customerName}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onClose={() => setShowDeleteConfirm(false)}
        danger
      />

      {/* Record Chargeback modal (admin-only, cancelled deals) */}
      {isAdmin && (
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
      )}
    </div>
  );
}
