'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PHASES, Phase,
  getSolarTechBaseline, getProductCatalogBaseline, getInstallerRatesForDeal,
} from '../../../lib/data';
import { formatDate } from '../../../lib/utils';
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
  phase_change:    'bg-blue-500',
  flagged:         'bg-red-500',
  unflagged:       'bg-red-400',
  m1_paid:         'bg-emerald-500',
  m2_paid:         'bg-emerald-500',
  note_edit:       'bg-amber-500',
  field_edit:      'bg-slate-500',
  created:         'bg-purple-500',
  setter_assigned: 'bg-cyan-500',
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
          <div className="absolute left-2 top-0 bottom-0 w-px bg-slate-800" />
          {activities.map((entry) => {
            const dotColor = ACTIVITY_STYLES[entry.type] ?? 'bg-slate-600';
            return (
              <div key={entry.id} className="relative mb-3 last:mb-0">
                <div className={`absolute -left-4 top-1 w-2 h-2 rounded-full ${dotColor}`} />
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
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo(0, 0);
  }, [projectId]);

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

  const myEntries = currentRole === 'rep'
    ? payrollEntries.filter((e) => e.projectId === project.id && e.repId === currentRepId)
    : [];

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
                className="rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  background: isCompleted ? '#00e5a0' : isCurrent ? '#00b4d8' : 'var(--m-border, #1a2840)',
                  boxShadow: isCurrent ? '0 0 0 3px rgba(0,180,216,0.3)' : 'none',
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

      {/* Info rows — no card wrapper, thin separators */}
      <div className="space-y-0">
        {infoRows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--m-border, #1a2840)' }}>
            <span className="text-base" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</span>
            <span className="text-base font-bold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Commission card — hide for PM */}
      {!isPM && (
        <MobileCard>
          <h2 className="text-base font-semibold text-white mb-3" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Commission</h2>
          {myEntries.length > 0 && currentRole === 'rep' ? (
            <div className="space-y-3">
              {myEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between">
                  <span className="text-base text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.paymentStage}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${entry.amount.toLocaleString()}</span>
                    <MobileBadge value={entry.status} variant="status" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {/* M1 */}
              <div className="flex items-center justify-between">
                <span className="text-base text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>M1</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${project.m1Amount.toLocaleString()}</span>
                  <MobileBadge value={project.m1Paid ? 'Paid' : 'Pending'} variant="status" />
                </div>
              </div>
              {/* M2 */}
              <div className="flex items-center justify-between">
                <span className="text-base text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>M2</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${project.m2Amount.toLocaleString()}</span>
                  <MobileBadge value={project.m2Paid ? 'Paid' : 'Pending'} variant="status" />
                </div>
              </div>
              {/* M3 */}
              {(project.m3Amount ?? 0) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-base text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>M3</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${(project.m3Amount ?? 0).toLocaleString()}</span>
                    <MobileBadge value="Pending" variant="status" />
                  </div>
                </div>
              )}
            </div>
          )}
        </MobileCard>
      )}

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
            className="flex-1 min-h-[48px] text-black text-base font-medium rounded-xl active:opacity-90"
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
          className="min-h-[48px] px-5 text-base font-medium rounded-xl active:opacity-80"
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
