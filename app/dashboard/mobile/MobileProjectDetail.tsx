'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PHASES, Phase,
  getSolarTechBaseline, getProductCatalogBaseline, getInstallerRatesForDeal,
} from '../../../lib/data';
import { formatDate, fmt$ } from '../../../lib/utils';
import { myCommissionOnProject } from '../../../lib/commissionHelpers';
import { ArrowLeft, Flag, FlagOff, Trash2, X as XIcon, Clock, RefreshCw } from 'lucide-react';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileBottomSheet from './shared/MobileBottomSheet';
import ProjectChatter from '../components/ProjectChatter';

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

// ── Relative time ──

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

// ── Activity type styling ──

const ACTIVITY_STYLES: Record<string, string> = {
  phase_change:    'var(--m-accent2, #00b4d8)',
  flagged:         '#ef4444',
  unflagged:       '#f87171',
  m1_paid:         '#10b981',
  m2_paid:         '#10b981',
  note_edit:       '#f59e0b',
  field_edit:      'var(--m-text-muted, #8899aa)',
  created:         '#a855f7',
  setter_assigned: '#22d3ee',
};

// ── Activity Timeline ──

interface ActivityEntry {
  id: string;
  type: string;
  detail: string;
  meta: string | null;
  createdAt: string;
}

function MobileActivityTimeline({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 10;

  const fetchActivities = useCallback((skip: number, append: boolean) => {
    setLoading(true);
    fetch(`/api/projects/${projectId}/activity?limit=${LIMIT}&offset=${skip}`)
      .then((res) => res.json())
      .then((data) => {
        setActivities((prev) => append ? [...prev, ...data.activities] : data.activities);
        setTotal(data.total);
        setOffset(skip + data.activities.length);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { fetchActivities(0, false); }, [fetchActivities]);

  const hasMore = offset < total;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-slate-400" />
        <h2 className="text-base font-semibold text-white">Activity</h2>
        <span className="text-base text-slate-400">({total})</span>
      </div>

      {loading && activities.length === 0 ? (
        <div className="flex items-center gap-2 text-base text-slate-400 py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading...
        </div>
      ) : activities.length === 0 ? (
        <p className="text-base text-slate-400">No activity yet</p>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-2 top-0 bottom-0 w-px" style={{ background: 'var(--m-border, #1a2840)' }} />
          {activities.map((entry) => {
            const dotColor = ACTIVITY_STYLES[entry.type] ?? 'var(--m-text-dim, #445577)';
            return (
              <div key={entry.id} className="relative mb-3 last:mb-0">
                <div className="absolute -left-4 top-1 w-2 h-2 rounded-full" style={{ background: dotColor }} />
                <p className="text-base text-slate-300">{entry.detail}</p>
                <p className="text-base text-slate-400">{relativeTime(entry.createdAt)}</p>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => fetchActivities(offset, true)}
          disabled={loading}
          className="min-h-[48px] text-base text-blue-400 active:text-blue-300 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}

// ── Main Component ──

export default function MobileProjectDetail({ projectId }: { projectId: string }) {
  const {
    currentRole, effectiveRole, projects, currentRepId, payrollEntries,
    updateProject: ctxUpdateProject, installerPricingVersions, productCatalogProducts,
  } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const isAdmin = effectiveRole === 'admin';
  const isRep = effectiveRole === 'rep';
  const { toast } = useToast();
  const router = useRouter();

  const project = projects.find((p) => p.id === projectId);

  const [phaseSheetOpen, setPhaseSheetOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

  useEffect(() => {
    document.title = project ? `${project.customerName} | Kilo Energy` : 'Project | Kilo Energy';
  }, [project?.customerName]);

  if (!project) {
    return (
      <div className="px-5 pt-4 pb-24 text-center text-base text-slate-400">
        Project not found.
        <button onClick={() => router.push('/dashboard/projects')} className="text-blue-400 ml-1">Back to Projects</button>
      </div>
    );
  }

  if (currentRole === 'rep' && project.repId !== currentRepId && project.setterId !== currentRepId) {
    return (
      <div className="px-5 pt-4 pb-24 text-center text-base text-slate-400">
        You don&apos;t have permission to view this project.
        <button onClick={() => router.push('/dashboard/projects')} className="text-blue-400 ml-1">Back</button>
      </div>
    );
  }

  if (currentRole === 'sub-dealer' && project.subDealerId !== currentRepId && project.repId !== currentRepId) {
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
    if (phase === 'Cancelled') {
      updateProject({ phase: 'Cancelled' } as Partial<typeof project>);
      toast('Project cancelled', 'info');
      router.push('/dashboard/projects');
      return;
    }
    doPhaseChange(phase);
  };

  const handleFlag = () => {
    const newFlagged = !project.flagged;
    updateProject({ flagged: newFlagged });
    toast(newFlagged ? 'Project flagged' : 'Flag removed', newFlagged ? 'info' : 'success');
    setMoreSheetOpen(false);
  };

  const handleCancel = () => {
    setMoreSheetOpen(false);
    updateProject({ phase: 'Cancelled' } as Partial<typeof project>);
    toast('Project cancelled', 'info');
    router.push('/dashboard/projects');
  };

  const handleDelete = async () => {
    setMoreSheetOpen(false);
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast('Project deleted permanently');
      router.push('/dashboard/projects');
    } else {
      toast('Failed to delete project');
    }
  };

  // ── Commission data ──

  // Shared helper computes total + per-stage applicability + status for
  // both reps and sub-dealers. SDs don't get an M1, and M3 only applies
  // when the installer has an M2/M3 structure (project.m3Amount > 0).
  const myCommission = myCommissionOnProject(project, currentRepId, currentRole, payrollEntries);

  // Find payroll entry dates for milestones
  const projectEntries = payrollEntries.filter((e) => e.projectId === project.id);
  const getEntryDate = (stage: 'M1' | 'M2' | 'M3'): string | null => {
    const entry = projectEntries.find((e) => e.paymentStage === stage && e.status !== 'Draft');
    return entry ? entry.date : null;
  };
  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  // Estimate next Friday after a target date
  const estimateFriday = (baseDate: string, addDays: number): string => {
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
  if (project.leadSource) {
    infoRows.push(['Lead Source', project.leadSource === 'door_knock' ? 'Door Knock' : project.leadSource]);
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">

      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/projects')}
        className="flex items-center gap-1 text-base text-slate-400 mb-4 min-h-[48px]"
      >
        <ArrowLeft className="w-4 h-4" />
        Projects
      </button>

      {/* Customer name + phase badge + flagged */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">{project.customerName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <MobileBadge value={project.phase} />
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
                  background: isCompleted ? '#00e5a0' : isCurrent ? '#00b4d8' : 'var(--m-border, #1a2840)',
                  willChange: 'transform',
                  animation: `dotPop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 40}ms both`,
                  transition: 'width 300ms cubic-bezier(0.34, 1.56, 0.64, 1), height 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
                title={step}
              />
              {index < PIPELINE_STEPS.length - 1 && (
                <div className="w-3 h-px" style={{ background: isCompleted ? '#00e5a0' : 'var(--m-border, #1a2840)' }} />
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
            : 'var(--m-accent2, #00b4d8)',
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
          color: 'var(--m-text-dim, #445577)',
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
              color: 'var(--m-text-dim, #445577)',
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
                  ? '#00e5a0'
                  : myCommission.status === 'partial'
                  ? '#ffb020'
                  : 'var(--m-accent, #00e5a0)',
              lineHeight: 1.05,
            }}
          >
            {fmt$(myCommission.total)}
          </p>
          <p
            style={{
              color: 'var(--m-text-muted, #8899aa)',
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
        {infoRows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--m-border, #1a2840)' }}>
            <span className="text-base" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</span>
            <span className="text-base font-bold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Commission breakdown card — hide for PM.
          Rep/SD: pull per-stage amounts + paid status from myCommission.stages
            so setters see setter amounts, SDs skip M1, and M3 only shows if
            the installer structure produces an M3 (m3Amount > 0).
          Admin: show the deal's own amounts from project fields (viewing the
            deal, not "their" stake). */}
      {!isPM && (() => {
        const isMeView = currentRole === 'rep' || currentRole === 'sub-dealer';
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
          visibleStages.length <= 1
            ? paidCount > 0
              ? 100
              : 0
            : (paidCount / (visibleStages.length - 1)) * 100;

        return (
          <MobileCard>
            <h2 className="text-base font-semibold text-white mb-3" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Commission Breakdown</h2>
            <div className="relative flex items-start justify-between pt-2 pb-4">
              {visibleStages.length > 1 && (
                <>
                  <div className="absolute top-[18px] left-[14px] right-[14px] h-0.5" style={{ background: 'var(--m-border, #1a2840)' }} />
                  <div
                    className="absolute top-[18px] left-[14px] h-0.5 milestone-track-fill"
                    style={{
                      width: `calc(${Math.min(100, Math.max(0, fillPct))}% - 28px)`,
                      background: 'linear-gradient(90deg, #00e5a0, #00b4d8)',
                      animation: 'trackFill 600ms cubic-bezier(0.16, 1, 0.3, 1) 150ms both',
                    }}
                  />
                </>
              )}
              {visibleStages.map((stage, i) => (
                <div key={stage.key} className="flex flex-col items-center gap-1.5 relative z-10">
                  <div
                    className="milestone-node w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: stage.paid ? 'linear-gradient(135deg, #00e5a0, #00b4d8)' : 'var(--m-card, #0d1525)',
                      border: `2px solid ${stage.paid ? '#00e5a0' : 'var(--m-border, #1a2840)'}`,
                      color: stage.paid ? '#000' : 'var(--m-text-muted, #8899aa)',
                      animation: `nodePop 350ms cubic-bezier(0.34, 1.56, 0.64, 1) ${150 + i * 120}ms both`,
                    }}
                  >{stage.key}</div>
                  <span
                    className="milestone-amount text-sm font-bold tabular-nums"
                    style={{
                      color: stage.paid ? 'var(--m-accent, #00e5a0)' : 'var(--m-text-muted, #8899aa)',
                      fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                      animation: `amountFadeUp 280ms cubic-bezier(0.16,1,0.3,1) ${300 + i * 100}ms both`,
                    }}
                  >{fmt$(stage.amount)}</span>
                  <MobileBadge value={stage.paid ? 'Paid' : 'Pending'} variant="status" />
                </div>
              ))}
            </div>
          </MobileCard>
        );
      })()}

      {/* Notes — collapsible */}
      <MobileSection title="Notes" collapsible defaultOpen={false}>
        {project.notes ? (
          <p className="text-base text-slate-400 leading-relaxed">{project.notes}</p>
        ) : (
          <p className="text-base text-slate-400 italic">No notes</p>
        )}
      </MobileSection>

      {/* Messages / Chatter */}
      <ProjectChatter projectId={projectId} />

      {/* Activity Timeline */}
      <MobileActivityTimeline projectId={projectId} />

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-16 left-0 right-0 z-50 flex items-center gap-3 px-5 py-3" style={{ background: 'var(--m-card, #0d1525)', borderTop: '1px solid var(--m-border, #1a2840)' }}>
        {(isAdmin || isPM) && (
          <button
            onClick={() => setPhaseSheetOpen(true)}
            className="flex-1 min-h-[48px] text-black text-base font-medium rounded-xl active:scale-[0.97] transition-transform duration-75 ease-out"
            style={{
              background: 'linear-gradient(135deg, #00e5a0, #00b4d8)',
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
            background: 'var(--m-card, #0d1525)',
            border: '1px solid var(--m-border, #1a2840)',
            color: 'var(--m-text-muted, #8899aa)',
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
        <MobileBottomSheet.Item
          label={project.flagged ? 'Remove Flag' : 'Flag Project'}
          icon={project.flagged ? FlagOff : Flag}
          onTap={handleFlag}
        />
        {project.phase !== 'Cancelled' && (
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
    </div>
  );
}
