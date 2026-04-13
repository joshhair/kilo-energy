'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery, useTableKeyNav } from '../../../lib/hooks';
import { PHASES, ACTIVE_PHASES, Phase, Rep, TrainerAssignment } from '../../../lib/data';
import { formatDate, downloadCSV } from '../../../lib/utils';
import { Search, Flag, X, ChevronUp, ChevronDown, ChevronsUpDown, FolderKanban, ChevronRight, ChevronLeft, UserPlus, ArrowLeftRight, Check, ArrowRight, Download } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import { PaginationBar, buildPageRange } from '../components/PaginationBar';
import ConfirmDialog from '../components/ConfirmDialog';
import MobileProjects from '../mobile/MobileProjects';

type StatusFilter = 'active' | 'all' | 'completed' | 'cancelled' | 'on-hold' | 'inactive';

/** Returns the number of calendar days between a YYYY-MM-DD date string and today. */
function daysSince(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const past = new Date(year, month - 1, day);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Returns a human-readable relative time string like "3d ago", "2mo ago", "1y ago". */
function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const days = daysSince(dateStr);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Badge shown on Kanban cards when a project has been in the pipeline for
 * more than 30 days since the sold date.
 *   30–59 days → amber
 *   60+ days   → red
 */
function StaleBadge({ soldDate, phase }: { soldDate: string | null; phase: Phase }) {
  if (!ACTIVE_PHASES.includes(phase) || phase === 'Completed') return null;
  if (!soldDate) return null;
  const days = daysSince(soldDate);
  if (days < 30) return null;
  const isRed = days >= 60;
  return (
    <span
      title={`${days} days since sold`}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0"
      style={isRed
        ? { background: 'rgba(255,82,82,0.15)', color: '#ff5252', border: '1px solid rgba(255,82,82,0.3)' }
        : { background: 'rgba(255,176,32,0.15)', color: '#ffb020', border: '1px solid rgba(255,176,32,0.3)' }
      }
    >
      {days}d
    </span>
  );
}

function applyStatusFilter(projects: ReturnType<typeof useApp>['projects'], status: StatusFilter) {
  if (status === 'all') return projects;
  if (status === 'active') return projects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  if (status === 'completed') return projects.filter((p) => p.phase === 'Completed');
  if (status === 'cancelled') return projects.filter((p) => p.phase === 'Cancelled');
  if (status === 'on-hold') return projects.filter((p) => p.phase === 'On Hold');
  if (status === 'inactive') return projects.filter((p) => p.phase === 'Cancelled' || p.phase === 'On Hold');
  return projects;
}

const PHASE_COLORS: Record<string, string> = {
  'New': '#00c4f0',
  'Acceptance': '#4d9fff',
  'Site Survey': '#b47dff',
  'Design': '#b47dff',
  'Permitting': '#ffb020',
  'Pending Install': '#ffb020',
  'Installed': '#00d4c8',
  'PTO': '#00e07a',
  'Completed': '#00e07a',
  'Cancelled': '#ff5252',
  'On Hold': '#ffb020',
};

const PHASE_PILL: Record<string, { gradient: string; border: string; shadow: string; text: string; dot: string; hex: string }> = {
  'New':             { gradient: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         border: 'border-sky-700/30',      shadow: 'shadow-[0_0_6px_rgba(14,165,233,0.15)]',  text: 'text-sky-300',     dot: 'bg-sky-400',     hex: '#00c4f0' },
  'Acceptance':      { gradient: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    border: 'border-indigo-700/30',   shadow: 'shadow-[0_0_6px_rgba(99,102,241,0.15)]',  text: 'text-indigo-300',  dot: 'bg-indigo-400',  hex: '#4d9fff' },
  'Site Survey':     { gradient: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    border: 'border-violet-700/30',   shadow: 'shadow-[0_0_6px_rgba(139,92,246,0.15)]',  text: 'text-violet-300',  dot: 'bg-violet-400',  hex: '#b47dff' },
  'Design':          { gradient: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  border: 'border-fuchsia-700/30',  shadow: 'shadow-[0_0_6px_rgba(217,70,239,0.15)]',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400', hex: '#b47dff' },
  'Permitting':      { gradient: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      border: 'border-amber-700/30',    shadow: 'shadow-[0_0_6px_rgba(245,158,11,0.15)]',  text: 'text-amber-300',   dot: 'bg-amber-400',   hex: '#ffb020' },
  'Pending Install': { gradient: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    border: 'border-orange-700/30',   shadow: 'shadow-[0_0_6px_rgba(249,115,22,0.15)]',  text: 'text-orange-300',  dot: 'bg-orange-400',  hex: '#ffb020' },
  'Installed':       { gradient: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        border: 'border-teal-700/30',     shadow: 'shadow-[0_0_6px_rgba(20,184,166,0.15)]',  text: 'text-teal-300',    dot: 'bg-teal-400',    hex: '#00d4c8' },
  'PTO':             { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  border: 'border-emerald-700/30',  shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]',  text: 'text-emerald-300', dot: 'bg-emerald-400', hex: '#00e07a' },
  'Completed':       { gradient: 'bg-gradient-to-r from-green-900/50 to-green-800/30',      border: 'border-green-600/40',    shadow: 'shadow-[0_0_8px_rgba(34,197,94,0.25)]',   text: 'text-green-300',   dot: 'bg-green-400',   hex: '#00e07a' },
  'Cancelled':       { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',          border: 'border-red-700/30',      shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.15)]',   text: 'text-red-300',     dot: 'bg-red-400',     hex: '#ff5252' },
  'On Hold':         { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',    border: 'border-yellow-700/30',   shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',   text: 'text-yellow-300',  dot: 'bg-yellow-400',  hex: '#ffb020' },
};


function PhaseBadge({ phase }: { phase: Phase }) {
  const s = PHASE_PILL[phase] ?? { gradient: '', border: '', shadow: '', text: '', dot: '', hex: '#8891a8' };
  const hex = s.hex ?? '#8891a8';
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: `${hex}12`, border: `1px solid ${hex}30`, color: hex }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: hex }} />
      {phase}
    </span>
  );
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: 'Active',
  all: 'All',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'on-hold': 'On Hold',
  inactive: 'Inactive',
};

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  );
}

function ProjectsPageInner() {
  const { currentRole, effectiveRole, currentRepId, effectiveRepId, projects, setProjects, updateProject, activeInstallers, dbReady } = useApp();
  const { toast } = useToast();
  useEffect(() => { document.title = 'Projects | Kilo Energy'; }, []);
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isRep = effectiveRole !== 'admin' && effectiveRole !== 'project_manager';
  const isSubDealer = effectiveRole === 'sub-dealer';
  const isPM = effectiveRole === 'project_manager';

  // Read initial values from URL searchParams
  const [tab, setTab] = useState<'phase' | 'all'>(() => {
    const v = searchParams.get('view');
    return v === 'all' ? 'all' : 'phase';
  });
  const [dealScope, setDealScope] = useState<'mine' | 'all'>(isRep ? 'mine' : 'all');
  // Re-initialise dealScope once effectiveRole resolves from null (context not yet hydrated on first render).
  const didInitDealScope = useRef(false);
  useEffect(() => {
    if (!didInitDealScope.current && effectiveRole !== null) {
      didInitDealScope.current = true;
      setDealScope(effectiveRole !== 'admin' && effectiveRole !== 'project_manager' ? 'mine' : 'all');
    }
  }, [effectiveRole]);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const v = searchParams.get('status') as StatusFilter | null;
    return v && ['active', 'all', 'completed', 'cancelled', 'on-hold', 'inactive'].includes(v) ? v : 'active';
  });
  const [installerFilter, setInstallerFilter] = useState(() => searchParams.get('installer') ?? '');
  const [phaseFilter, setPhaseFilter] = useState(() => searchParams.get('phase') ?? '');
  const isHydrated = useIsHydrated();

  // Sync filters to URL searchParams
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (tab !== 'phase') params.set('view', tab); else params.delete('view');
    if (statusFilter !== 'active') params.set('status', statusFilter); else params.delete('status');
    if (installerFilter) params.set('installer', installerFilter); else params.delete('installer');
    if (phaseFilter) params.set('phase', phaseFilter); else params.delete('phase');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/dashboard/projects', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, installerFilter, phaseFilter]);

  // Sliding tab indicators
  const viewTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [viewIndicator, setViewIndicator] = useState<{ left: number; width: number } | null>(null);
  const statusFilterRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [statusFilterIndicator, setStatusFilterIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const VIEW_TABS = ['phase', 'all'] as const;
    const idx = VIEW_TABS.indexOf(tab);
    const el = viewTabRefs.current[idx];
    if (el) setViewIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  useEffect(() => {
    const STATUS_FILTER_TABS: StatusFilter[] = ['active', 'all', 'completed', 'cancelled', 'on-hold'];
    const idx = STATUS_FILTER_TABS.indexOf(statusFilter);
    const el = statusFilterRefs.current[idx];
    if (el) setStatusFilterIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [statusFilter]);

  // Debounce searchInput → debouncedSearch (300ms; 0ms when cleared for instant feedback).
  useEffect(() => {
    const delay = searchInput === '' ? 0 : 300;
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, delay);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // All projects the current user is allowed to see.
  // Admins see everything; reps ONLY see their own deals; sub-dealers see their sub-dealer deals.
  const visibleProjects =
    effectiveRole === 'admin' || effectiveRole === 'project_manager'
      ? (dealScope === 'mine' ? projects.filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId) : projects)
      : isSubDealer
        ? projects.filter((p) => p.subDealerId === effectiveRepId || p.repId === effectiveRepId)
        : projects.filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId);

  const statusFiltered = applyStatusFilter(visibleProjects, statusFilter);

  const filtered = statusFiltered.filter((p) => {
    const matchSearch =
      p.customerName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (p.repName ?? '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (p.setterName ?? '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      p.phase.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      p.installer.toLowerCase().includes(debouncedSearch.toLowerCase());
    const matchInstaller = !installerFilter || p.installer === installerFilter;
    const matchPhase = !phaseFilter || p.phase === phaseFilter;
    return matchSearch && matchInstaller && matchPhase;
  });

  // Destructive phase change confirmation
  const [phaseConfirm, setPhaseConfirm] = useState<{ projectId: string; phase: Phase; projectName: string } | null>(null);

  // Cancellation reason modal state
  const [cancelReasonModal, setCancelReasonModal] = useState<{ projectId: string; projectName: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');

  const doPhaseChange = (projectId: string, phase: Phase) => {
    const project = projects.find((p) => p.id === projectId);
    const previousPhase = project?.phase;
    updateProject(projectId, { phase });
    if (project) toast(
      `${project.customerName} moved to ${phase}`,
      'success',
      previousPhase && previousPhase !== phase
        ? { label: 'Undo', onClick: () => doPhaseChange(projectId, previousPhase) }
        : undefined,
    );
  };

  const handlePhaseChange = (projectId: string, phase: Phase) => {
    if (phase === 'Cancelled') {
      const project = projects.find((p) => p.id === projectId);
      setCancelReason('');
      setCancelNotes('');
      setCancelReasonModal({ projectId, projectName: project?.customerName ?? 'this project' });
      return;
    }
    if (phase === 'On Hold') {
      const project = projects.find((p) => p.id === projectId);
      setPhaseConfirm({ projectId, phase, projectName: project?.customerName ?? 'this project' });
      return;
    }
    doPhaseChange(projectId, phase);
  };

  const confirmCancelWithReason = () => {
    if (!cancelReasonModal) return;
    updateProject(cancelReasonModal.projectId, {
      phase: 'Cancelled',
      cancellationReason: cancelReason || undefined,
      cancellationNotes: cancelNotes || undefined,
    } as Partial<typeof projects[0]>);
    toast(`${cancelReasonModal.projectName} cancelled`, 'info');
    setCancelReasonModal(null);
  };

  const hasActiveFilters = statusFilter !== 'active' || installerFilter !== '' || searchInput !== '' || phaseFilter !== '';

  const clearAllFilters = () => {
    setStatusFilter('active');
    setInstallerFilter('');
    setSearchInput('');
    setDebouncedSearch('');
    setPhaseFilter('');
    toast('Filters cleared', 'info');
  };

  if (isMobile) return <MobileProjects />;

  if (!isHydrated || !dbReady) {
    return <ProjectsSkeleton />;
  }

  return (
    <div className="px-3 pt-2 pb-4 md:p-8 animate-fade-in-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>Projects</h1>
          <p className="text-[#c2c8d8] text-sm font-medium mt-1 tracking-wide">{hasActiveFilters ? `${filtered.length} of ${visibleProjects.length} projects` : `${visibleProjects.length} total projects`}</p>
        </div>
        <Link
          href="/dashboard/new-deal"
          className="font-bold px-4 py-2 rounded-xl text-sm active:scale-[0.97]"
          style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000', boxShadow: '0 0 20px rgba(0,224,122,0.25)' }}
        >
          + New Deal
        </Link>
      </div>

      {/* View + Status tabs */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-4 md:flex-wrap">
        <div className="flex gap-1 rounded-xl p-1 tab-bar-container" style={{ background: '#1d2028', border: '1px solid #333849' }}>
          {viewIndicator && <div className="tab-indicator" style={viewIndicator} />}
          {(['phase', 'all'] as const).map((t, i) => (
            <button
              key={t}
              ref={(el) => { viewTabRefs.current[i] = el; }}
              onClick={() => setTab(t)}
              className="relative z-10 px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-colors"
              style={tab === t
                ? { background: '#00e07a', color: '#000', fontWeight: 700 }
                : { color: '#c2c8d8' }
              }
            >
              {t === 'phase' ? 'By Phase' : 'All Projects'}
            </button>
          ))}
        </div>

        {/* My Deals / All Deals segmented control — admin only */}
        {!isRep && (
          <div className="flex gap-0.5 rounded-xl p-1" style={{ background: '#1d2028', border: '1px solid #333849' }}>
            {(['all', 'mine'] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setDealScope(scope)}
                className="relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                style={dealScope === scope
                  ? { background: '#00e07a', color: '#000', fontWeight: 700 }
                  : { color: '#c2c8d8' }
                }
              >
                {scope === 'all' ? 'All Deals' : 'My Deals'}
              </button>
            ))}
          </div>
        )}

        {/* Status filter */}
        <div className="flex gap-1 rounded-xl p-1 tab-bar-container overflow-x-auto scrollbar-hide w-full md:w-auto" style={{ background: '#1d2028', border: '1px solid #333849' }}>
          {statusFilterIndicator && <div className="tab-indicator" style={statusFilterIndicator} />}
          {([
            { value: 'active', label: 'Active' },
            { value: 'all', label: 'All' },
            { value: 'completed', label: '✓ Completed' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'on-hold', label: 'On Hold' },
          ] as { value: StatusFilter; label: string }[]).map((s, i) => (
            <button
              key={s.value}
              ref={(el) => { statusFilterRefs.current[i] = el; }}
              onClick={() => setStatusFilter(s.value)}
              className="relative z-10 px-4 py-1.5 min-h-[40px] rounded-lg text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap"
              style={statusFilter === s.value
                ? { background: '#00e07a', color: '#000', fontWeight: 700 }
                : { color: '#8891a8' }
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Installer filter */}
        <select
          value={installerFilter}
          onChange={(e) => setInstallerFilter(e.target.value)}
          className="rounded-xl px-3 py-1.5 min-h-[36px] text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] w-full md:w-auto"
          style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}
        >
          <option value="">All Installers</option>
          {activeInstallers.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {statusFilter !== 'active' && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}>
              Status: {STATUS_LABELS[statusFilter]}
              <button
                onClick={() => setStatusFilter('active')}
                className="text-[#c2c8d8] hover:text-white transition-colors"
                aria-label="Clear status filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {installerFilter && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}>
              Installer: {installerFilter}
              <button
                onClick={() => setInstallerFilter('')}
                className="text-[#c2c8d8] hover:text-white transition-colors"
                aria-label="Clear installer filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {searchInput && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}>
              Search: &ldquo;{searchInput}&rdquo;
              <button
                onClick={() => { setSearchInput(''); setDebouncedSearch(''); }}
                className="text-[#c2c8d8] hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {phaseFilter && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}>
              Phase: {phaseFilter}
              <button
                onClick={() => setPhaseFilter('')}
                className="text-[#c2c8d8] hover:text-white transition-colors"
                aria-label="Clear phase filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button
            onClick={clearAllFilters}
            className="text-[#c2c8d8] hover:text-white text-xs transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {tab === 'phase' ? (
        <KanbanView
          projects={filtered}
          isAdmin={effectiveRole === 'admin'}
          currentRepId={effectiveRepId}
          dealScope={dealScope}
          onPhaseChange={isSubDealer ? () => {} : handlePhaseChange}
          readOnly={isSubDealer}
          hideFinancials={isPM}
        />
      ) : (
        <TableView
          projects={filtered}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          isAdmin={effectiveRole === 'admin'}
          currentRepId={effectiveRepId}
          dealScope={dealScope}
          onPhaseChange={isSubDealer ? () => {} : handlePhaseChange}
          setProjects={setProjects}
          hasActiveFilters={hasActiveFilters}
          clearAllFilters={clearAllFilters}
          readOnly={isSubDealer}
          hideFinancials={isPM}
        />
      )}

      {/* Destructive phase change confirmation */}
      <ConfirmDialog
        open={!!phaseConfirm}
        onClose={() => setPhaseConfirm(null)}
        onConfirm={() => {
          if (phaseConfirm) doPhaseChange(phaseConfirm.projectId, phaseConfirm.phase);
          setPhaseConfirm(null);
        }}
        title={`Move to ${phaseConfirm?.phase ?? ''}?`}
        message={`Are you sure you want to move "${phaseConfirm?.projectName ?? ''}" to ${phaseConfirm?.phase ?? ''}? This will remove it from the active pipeline.`}
        confirmLabel="Put On Hold"
        danger={false}
      />

      {/* Cancellation Reason Modal */}
      {cancelReasonModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCancelReasonModal(null); }}>
          <div className="bg-[#161920] border border-[#272b35] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#333849]">
              <h2 className="text-white font-bold text-base">Cancel Project</h2>
              <button onClick={() => setCancelReasonModal(null)} className="text-[#c2c8d8] hover:text-white transition-colors rounded-lg p-1 hover:bg-[#1d2028]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[#c2c8d8] text-sm">Why is <span className="text-white font-medium">{cancelReasonModal.projectName}</span> being cancelled?</p>
              <div>
                <label className="text-[#c2c8d8] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-[#1d2028] border border-[#272b35] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]">
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
                <label className="text-[#c2c8d8] text-xs uppercase tracking-wider block mb-1.5">Notes <span className="text-[#525c72] font-normal normal-case">(optional)</span></label>
                <textarea rows={2} value={cancelNotes} onChange={(e) => setCancelNotes(e.target.value)} placeholder="Additional details..."
                  className="w-full bg-[#1d2028] border border-[#272b35] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] resize-none placeholder-slate-500" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setCancelReasonModal(null)}
                  className="flex-1 bg-[#1d2028] hover:bg-[#272b35] border border-[#272b35] text-[#c2c8d8] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors">Go Back</button>
                <button onClick={confirmCancelWithReason}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors active:scale-[0.97]">Cancel Project</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanView({
  projects,
  isAdmin,
  currentRepId,
  dealScope,
  onPhaseChange,
  readOnly = false,
  hideFinancials = false,
}: {
  projects: ReturnType<typeof useApp>['projects'];
  isAdmin: boolean;
  currentRepId: string | null;
  dealScope: 'mine' | 'all';
  onPhaseChange: (id: string, phase: Phase) => void;
  readOnly?: boolean;
  hideFinancials?: boolean;
}) {
  const { toast } = useToast();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const activePhasesForKanban = PHASES.filter((p) => p !== 'Cancelled' && p !== 'On Hold' && p !== 'Completed');
  const cancelledAndHold = ['Completed', 'Cancelled', 'On Hold'] as Phase[];

  // ── Kanban search — filters cards by customer name ────────────────────────
  const [kanbanSearchInput, setKanbanSearchInput] = useState('');
  const [kanbanDebouncedSearch, setKanbanDebouncedSearch] = useState('');
  const kanbanSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const delay = kanbanSearchInput === '' ? 0 : 300;
    const timer = setTimeout(() => setKanbanDebouncedSearch(kanbanSearchInput), delay);
    return () => clearTimeout(timer);
  }, [kanbanSearchInput]);

  const kanbanFiltered = kanbanDebouncedSearch
    ? projects.filter((p) => {
        const q = kanbanDebouncedSearch.toLowerCase();
        return p.customerName.toLowerCase().includes(q)
          || (p.repName ?? '').toLowerCase().includes(q)
          || (p.setterName ?? '').toLowerCase().includes(q)
          || p.installer.toLowerCase().includes(q);
      })
    : projects;

  // Summary stats for search results
  const kanbanResultCount = kanbanFiltered.length;
  const kanbanPhaseCount = kanbanDebouncedSearch
    ? new Set(kanbanFiltered.map((p) => p.phase)).size
    : 0;

  // Determine the "current" phase: first active phase that has at least one project,
  // falling back to the first phase in the pipeline.
  const currentPhase =
    activePhasesForKanban.find((phase) => projects.some((p) => p.phase === phase)) ??
    activePhasesForKanban[0];

  // Accordion open/close state — only used on mobile.
  const [openPhases, setOpenPhases] = useState<Set<string>>(() => new Set([currentPhase]));
  const [offTrackOpen, setOffTrackOpen] = useState(false);

  // When outer filters change the set of visible projects, currentPhase may
  // shift to a different phase. Sync openPhases so the accordion auto-opens
  // the correct phase instead of keeping an empty one open.
  useEffect(() => {
    setOpenPhases((prev) => new Set([...prev, currentPhase]));
  }, [currentPhase]);

  // Kanban column card limit — columns show up to KANBAN_CARD_LIMIT cards
  // collapsed, or up to KANBAN_EXPANDED_MAX when the user clicks "Show all".
  // The expanded cap exists because at real scale some phases hold 400+
  // projects (Installed, PTO) and rendering every card in a DOM column
  // freezes the page on scroll. If a phase exceeds the expanded cap, the
  // toggle button directs users to the filtered list view instead, which
  // has proper pagination.
  const KANBAN_CARD_LIMIT = 20;
  const KANBAN_EXPANDED_MAX = 80;
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());
  const toggleExpand = (phase: string) => {
    setExpandedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  };

  const togglePhase = (phase: string) => {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  };

  // ── Save project nav list to sessionStorage on click ─────────────────────
  const saveProjectNav = () => {
    try {
      const ids = kanbanFiltered.map((p) => p.id);
      sessionStorage.setItem('kilo-project-nav', JSON.stringify(ids));
    } catch { /* quota / SSR guard */ }
  };

  // ── Shared kanban search bar ─────────────────────────────────────────────
  const kanbanSearchBar = (
    <div className="mb-4">
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8891a8] pointer-events-none" />
        <input
          ref={kanbanSearchRef}
          type="text"
          placeholder="Search projects..."
          value={kanbanSearchInput}
          onChange={(e) => setKanbanSearchInput(e.target.value)}
          className="w-full rounded-xl pl-9 pr-8 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-slate-500"
          style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
        />
        {kanbanSearchInput && (
          <button
            onClick={() => { setKanbanSearchInput(''); setKanbanDebouncedSearch(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#c2c8d8] hover:text-white transition-colors"
            aria-label="Clear kanban search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {kanbanDebouncedSearch && (
        <p className="text-[#c2c8d8] text-xs mt-2">
          {kanbanResultCount} result{kanbanResultCount !== 1 ? 's' : ''} across {kanbanPhaseCount} phase{kanbanPhaseCount !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );

  // ── Mobile: expand/collapse-all helper ───────────────────────────────────
  const allPhasesOpen = activePhasesForKanban.every((p) => openPhases.has(p));
  const toggleAllPhases = () => {
    if (allPhasesOpen) {
      setOpenPhases(new Set());
      setOffTrackOpen(false);
    } else {
      setOpenPhases(new Set(activePhasesForKanban));
      setOffTrackOpen(true);
    }
  };

  // ── Mobile: vertically stacked accordion ──────────────────────────────────
  if (isMobile) {
    return (
      <div className="space-y-2">
        {kanbanSearchBar}
        {/* Expand All / Collapse All toggle */}
        <div className="flex justify-end mb-1">
          <button
            onClick={toggleAllPhases}
            className="text-xs font-medium text-[#c2c8d8] hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-[#1d2028]"
          >
            {allPhasesOpen ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
        {/* Active phases */}
        {activePhasesForKanban.map((phase) => {
          const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
          const isOpen = openPhases.has(phase);
          const s = PHASE_PILL[phase];
          const mobilePhaseIdx = activePhasesForKanban.indexOf(phase);
          const nextPhase = activePhasesForKanban[mobilePhaseIdx + 1] as Phase | undefined;
          const prevPhase = activePhasesForKanban[mobilePhaseIdx - 1] as Phase | undefined;

          return (
            <div key={phase} className="card-surface rounded-xl overflow-hidden">
              {/* Accordion header — 52px min-height for comfortable tap target */}
              <button
                onClick={() => togglePhase(phase)}
                className="w-full flex items-center justify-between px-4 min-h-[52px] gap-3 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s?.dot ?? 'bg-[#8891a8]'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${s?.text ?? 'text-[#c2c8d8]'}`}>{phase}</span>
                      <span className="bg-[#1d2028] text-[#c2c8d8] text-xs px-2 py-0.5 rounded-full font-medium">
                        {phaseProjects.length}
                      </span>
                    </div>
                    {!hideFinancials && (
                      <p className="text-xs text-[#8891a8] mt-0.5">
                        ${phaseProjects.reduce((sum, p) => {
                          if (!isAdmin && dealScope === 'mine') {
                            if (p.repId === currentRepId) return sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
                            if (p.setterId === currentRepId) return sum + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
                            return sum;
                          }
                          return sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
                        }, 0).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-[#8891a8] flex-shrink-0 transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Accordion body */}
              {isOpen && (
                <div className="px-3 pb-3 space-y-2 border-t border-[#333849]">
                  {phaseProjects.length === 0 && (
                    <div className="py-6 flex flex-col items-center text-center">
                      <FolderKanban className="w-6 h-6 text-[#525c72] mb-1.5 opacity-60" />
                      <p className="text-[#525c72] text-xs">No projects in this phase</p>
                    </div>
                  )}
                  {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => {
                    const myRole = !isAdmin
                      ? (proj.repId === currentRepId ? 'Closer' : proj.setterId === currentRepId ? 'Setter' : null)
                      : null;
                    const isMyCard = myRole !== null;
                    const commissionTotal = !isAdmin && dealScope === 'mine'
                      ? (myRole === 'Closer' ? (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) : (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0))
                      : (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) + (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0);
                    return (
                      <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                      <div
                        className={`relative overflow-hidden bg-[#1d2028]/60 border rounded-xl flex items-center justify-between gap-2 transition-all duration-200 group hover:translate-y-[-2px] hover:shadow-lg hover:shadow-blue-500/5 hover:border-[#00e07a]/20 active:scale-[0.98] active:shadow-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-blue-500/30 after:to-transparent after:opacity-0 hover:after:opacity-100 after:transition-opacity ${
                          proj.flagged
                            ? 'border-l-2 border-l-red-500 border-[#272b35]/60'
                            : isMyCard && dealScope === 'all'
                              ? 'border-[#272b35]/60 border-l-[3px] border-l-blue-500'
                              : 'border-[#272b35]/60'
                        }`}
                      >
                        <div className={`kanban-accent-bar absolute inset-x-0 top-0 h-[2px] rounded-t-xl bg-gradient-to-r ${PHASE_PILL[proj.phase]?.gradient || ''}`} />
                        {/* Card content — py-3 ensures at least 44px total height with text */}
                        <div className="flex-1 px-4 py-3 min-h-[44px]">
                          <p className="text-white text-sm font-medium leading-snug group-hover:text-[#00e07a] transition-colors flex items-center gap-1.5 flex-wrap">
                            {proj.customerName}
                            {proj.flagged && (
                              <Flag className="w-3 h-3 text-red-400 flex-shrink-0" />
                            )}
                            <StaleBadge soldDate={proj.soldDate} phase={proj.phase} />
                            {/* Prominent "You" role pill next to customer name — shown in All Deals mode */}
                            {isMyCard && dealScope === 'all' && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none ${
                                myRole === 'Closer'
                                  ? 'bg-blue-900/60 text-[#00c4f0] border border-[#00e07a]/40'
                                  : 'bg-emerald-900/60 text-emerald-300 border border-[#00e07a]/40'
                              }`}>
                                You · {myRole}
                              </span>
                            )}
                          </p>
                          <p className="text-[#8891a8] text-xs mt-0.5">
                            {proj.kWSize} kW · {proj.installer}
                          </p>
                          <p className={`text-xs ${isMyCard && dealScope === 'all' ? 'text-[#c2c8d8] font-semibold' : 'text-[#525c72]'}`}>
                            {proj.repName}
                          </p>
                          {/* Commission row */}
                          {!hideFinancials && (
                            <div className="flex items-center justify-end mt-1">
                              <span className="text-[#00e07a]/70 text-[10px] font-medium tabular-nums">
                                ${commissionTotal.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Phase navigation — admin only; 44px touch targets */}
                        {isAdmin && (prevPhase || nextPhase) && (
                          <div className="mr-3 flex gap-1.5 flex-shrink-0">
                            {prevPhase && (
                              <button
                                title={`Move back to ${prevPhase}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onPhaseChange(proj.id, prevPhase);
                                }}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#272b35] hover:bg-amber-600 text-[#c2c8d8] hover:text-white active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                                aria-label={`Move ${proj.customerName} back to ${prevPhase}`}
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                            )}
                            {nextPhase && (
                              <button
                                title={`Move to ${nextPhase}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onPhaseChange(proj.id, nextPhase);
                                }}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[#272b35] hover:bg-[#00e07a] text-[#c2c8d8] hover:text-white active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                                aria-label={`Move ${proj.customerName} to ${nextPhase}`}
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                    );
                  })}
                  {/* "Show all / Show less" toggle when column exceeds card limit */}
                  {phaseProjects.length > KANBAN_CARD_LIMIT && (
                    <button
                      onClick={() => toggleExpand(phase)}
                      className="w-full text-center py-2 text-xs font-medium text-[#00e07a] hover:text-[#00c4f0] transition-colors"
                    >
                      {expandedColumns.has(phase)
                        ? (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Showing ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length} — Show less` : 'Show less')
                        : (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Show ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length} projects` : `Show all ${phaseProjects.length} projects`)}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Off-Track group (Cancelled + On Hold) — collapsed by default */}
        <div className="bg-[#161920]/60 border border-[#333849]/60 rounded-xl overflow-hidden">
          <button
            onClick={() => setOffTrackOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 min-h-[52px] gap-3 text-left"
            aria-expanded={offTrackOpen}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-[#525c72] flex-shrink-0" />
              <span className="text-sm font-semibold text-[#8891a8]">Off-Track</span>
              <span className="bg-[#1d2028] text-[#8891a8] text-xs px-2 py-0.5 rounded-full font-medium">
                {cancelledAndHold.reduce(
                  (acc, ph) => acc + kanbanFiltered.filter((p) => p.phase === ph).length,
                  0
                )}
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#525c72] flex-shrink-0 transition-transform duration-200 ${
                offTrackOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {offTrackOpen && (
            <div className="px-3 pb-3 border-t border-[#333849]/60 space-y-3">
              {cancelledAndHold.map((phase) => {
                const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
                if (phaseProjects.length === 0) return null;
                return (
                  <div key={phase}>
                    <p className="text-xs font-semibold text-[#8891a8] uppercase tracking-wider px-1 pt-3 pb-1">
                      {phase}
                    </p>
                    <div className="space-y-2">
                      {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => (
                        <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                          <div className="bg-[#1d2028]/40 border border-[#272b35]/40 hover:border-[#272b35] rounded-xl px-4 min-h-[44px] flex items-center opacity-70 hover:opacity-100 transition-all">
                            <div className="py-3">
                              <p className="text-[#c2c8d8] text-sm font-medium">{proj.customerName}</p>
                              <p className="text-[#525c72] text-xs">
                                {proj.kWSize} kW · {proj.installer}
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))}
                      {phaseProjects.length > KANBAN_CARD_LIMIT && (
                        <button
                          onClick={() => toggleExpand(phase)}
                          className="w-full text-center py-2 text-xs font-medium text-[#00e07a] hover:text-[#00c4f0] transition-colors"
                        >
                          {expandedColumns.has(phase)
                            ? (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Showing ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length} — Show less` : 'Show less')
                            : (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Show ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length} projects` : `Show all ${phaseProjects.length} projects`)}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop (md+): existing horizontal Kanban ─────────────────────────────
  return (
    <div className="space-y-6">
      {kanbanSearchBar}
      <div className="flex gap-4 overflow-x-auto [overflow-y:clip] snap-x snap-mandatory pb-4">
        {activePhasesForKanban.map((phase) => {
          const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
          // Next phase in the pipeline (undefined for PTO — the last active phase).
          const phaseIdx = activePhasesForKanban.indexOf(phase);
          const nextPhase = activePhasesForKanban[phaseIdx + 1] as Phase | undefined;
          const prevPhase = activePhasesForKanban[phaseIdx - 1] as Phase | undefined;
          return (
            <div key={phase} className={`flex-shrink-0 w-52 snap-start kanban-col-enter kanban-col-${phaseIdx}`}>
              {/* Sticky column header — stays visible while cards scroll */}
              <div className="sticky top-0 z-10 backdrop-blur-sm pb-2 mb-1 px-2 py-1.5 rounded-lg" style={{ background: `${PHASE_COLORS[phase] ?? '#8891a8'}12`, border: `1px solid ${PHASE_COLORS[phase] ?? '#8891a8'}30` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: PHASE_COLORS[phase] ?? '#8891a8' }}>{phase}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#1d2028', color: '#8891a8' }}>
                    {phaseProjects.length}
                  </span>
                </div>
                {!hideFinancials && (
                  <p className="text-xs text-[#8891a8] mt-0.5">
                    ${phaseProjects.reduce((sum, p) => {
                      if (!isAdmin && dealScope === 'mine') {
                        if (p.repId === currentRepId) return sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
                        if (p.setterId === currentRepId) return sum + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
                        return sum;
                      }
                      return sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
                    }, 0).toLocaleString()}
                  </p>
                )}
              </div>
              {/* Scrollable card container with bottom-fade overflow hint */}
              <div className="relative">
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {phaseProjects.length === 0 && (
                    <div className="bg-[#161920]/40 border border-dashed border-[#333849] rounded-xl p-4 flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-full bg-[#1d2028]/80 flex items-center justify-center mb-2">
                        <FolderKanban className="w-5 h-5 text-[#525c72] opacity-60 animate-pulse" />
                      </div>
                      <p className="text-[#c2c8d8] text-xs font-semibold">{phase}</p>
                      <p className="text-[#525c72] text-xs mt-0.5">No projects here</p>
                    </div>
                  )}
                  {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => {
                    const myRole = !isAdmin
                      ? (proj.repId === currentRepId ? 'Closer' : proj.setterId === currentRepId ? 'Setter' : null)
                      : null;
                    const isMyCard = myRole !== null;
                    const commissionTotal = !isAdmin && dealScope === 'mine'
                      ? (myRole === 'Closer' ? (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) : (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0))
                      : (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) + (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0);
                    return (
                      <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                      <div
                        className={`relative overflow-hidden rounded-xl p-3 cursor-pointer transition-all duration-200 group hover:translate-y-[-2px] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] active:shadow-none ${
                          proj.flagged ? '' : ''
                        }`}
                        style={{
                          background: '#161920',
                          border: `1px solid #272b35`,
                          borderLeft: proj.flagged
                            ? '3px solid #ff5252'
                            : isMyCard && dealScope === 'all'
                              ? '3px solid #4d9fff'
                              : `3px solid ${PHASE_COLORS[proj.phase] ?? '#272b35'}`,
                        }}
                      >
                        <div className={`kanban-accent-bar absolute inset-x-0 top-0 h-[2px] rounded-t-xl bg-gradient-to-r ${PHASE_PILL[proj.phase]?.gradient || ''}`} />
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <p className="text-white text-xs font-medium leading-tight group-hover:text-[#00e07a] transition-colors">
                            {proj.customerName}
                          </p>
                          <div className="flex items-center gap-1 shrink-0 mt-0.5">
                            <StaleBadge soldDate={proj.soldDate} phase={proj.phase} />
                            {proj.flagged && <Flag className="w-3 h-3 text-red-400" />}
                          </div>
                        </div>
                        {/* "You" role pill — prominent, shown in All Deals mode */}
                        {isMyCard && dealScope === 'all' && (
                          <span className={`inline-flex items-center mb-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none ${
                            myRole === 'Closer'
                              ? 'bg-blue-900/60 text-[#00c4f0] border border-[#00e07a]/40'
                              : 'bg-emerald-900/60 text-emerald-300 border border-[#00e07a]/40'
                          }`}>
                            You · {myRole}
                          </span>
                        )}
                        <p className="text-[#8891a8] text-xs">{proj.kWSize} kW</p>
                        <p className="text-[#8891a8] text-xs">{proj.installer}</p>
                        <p className={`text-xs ${isMyCard && dealScope === 'all' ? 'text-[#c2c8d8] font-semibold' : 'text-[#525c72]'}`}>
                          {proj.repName}
                        </p>
                        {/* Mini commission preview + phase nav row */}
                        {!hideFinancials && (
                          <div className="flex items-center mt-1.5 justify-end">
                            <span className="text-[10px] font-medium tabular-nums" style={{ color: '#00e07a', fontFamily: "'DM Serif Display', serif" }}>
                              ${commissionTotal.toLocaleString()}
                            </span>
                          </div>
                        )}

                        {/* Phase navigation — admin only, shows on hover */}
                        {isAdmin && (prevPhase || nextPhase) && (
                          <div className="flex gap-1 justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {prevPhase && (
                              <button
                                title={`Move back to ${prevPhase}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onPhaseChange(proj.id, prevPhase);
                                }}
                                className="p-1 rounded-md bg-[#272b35] hover:bg-amber-600 text-[#c2c8d8] hover:text-white active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                                aria-label={`Move ${proj.customerName} back to ${prevPhase}`}
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {nextPhase && (
                              <button
                                title={`Move to ${nextPhase}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onPhaseChange(proj.id, nextPhase);
                                }}
                                className="p-1 rounded-md bg-[#272b35] hover:bg-[#00e07a] text-[#c2c8d8] hover:text-white active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                                aria-label={`Move ${proj.customerName} to ${nextPhase}`}
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                    );
                  })}
                  {/* "Show all / Show less" toggle when column exceeds card limit */}
                  {phaseProjects.length > KANBAN_CARD_LIMIT && (
                    <button
                      onClick={() => toggleExpand(phase)}
                      className="w-full text-center py-1.5 text-[10px] font-medium text-[#00e07a] hover:text-[#00c4f0] transition-colors"
                    >
                      {expandedColumns.has(phase)
                        ? (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Showing ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length} — Show less` : 'Show less')
                        : (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Show ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length}` : `Show all ${phaseProjects.length}`)}
                    </button>
                  )}
                </div>
                {/* Bottom scroll-shadow gradient — only visible when content overflows */}
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-950/80 to-transparent rounded-b-xl" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancelled / On Hold row */}
      <div className="flex gap-4">
        {cancelledAndHold.map((phase) => {
          const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
          return (
            <div key={phase} className="flex-shrink-0 w-52">
              {/* Sticky column header — stays visible while cards scroll */}
              <div className="sticky top-0 z-10 backdrop-blur-sm pb-2 mb-1 px-2 py-1.5 rounded-lg" style={{ background: `${PHASE_COLORS[phase] ?? '#8891a8'}12`, border: `1px solid ${PHASE_COLORS[phase] ?? '#8891a8'}30` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: PHASE_COLORS[phase] ?? '#8891a8' }}>{phase}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#1d2028', color: '#8891a8' }}>
                    {phaseProjects.length}
                  </span>
                </div>
                {!hideFinancials && (
                  <p className="text-xs text-[#8891a8] mt-0.5">
                    ${phaseProjects.reduce((sum, p) => {
                      if (!isAdmin && dealScope === 'mine') {
                        if (p.repId === currentRepId) return sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
                        if (p.setterId === currentRepId) return sum + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
                        return sum;
                      }
                      return sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
                    }, 0).toLocaleString()}
                  </p>
                )}
              </div>
              {/* Scrollable card container with bottom-fade overflow hint */}
              <div className="relative">
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => (
                    <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                      <div className="relative rounded-xl p-3 cursor-pointer opacity-70 hover:opacity-100 transition-all duration-200 hover:translate-y-[-2px] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] active:shadow-none" style={{ background: '#161920', border: '1px solid #272b35', borderLeft: `3px solid ${PHASE_COLORS[phase] ?? '#525c72'}` }}>
                        <p className="text-xs font-medium" style={{ color: '#8891a8' }}>{proj.customerName}</p>
                        <p className="text-[#525c72] text-xs">{proj.kWSize} kW · {proj.installer}</p>
                      </div>
                    </Link>
                  ))}
                  {/* "Show all / Show less" toggle when column exceeds card limit */}
                  {phaseProjects.length > KANBAN_CARD_LIMIT && (
                    <button
                      onClick={() => toggleExpand(phase)}
                      className="w-full text-center py-1.5 text-[10px] font-medium text-[#00e07a] hover:text-[#00c4f0] transition-colors"
                    >
                      {expandedColumns.has(phase)
                        ? (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Showing ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length} — Show less` : 'Show less')
                        : (phaseProjects.length > KANBAN_EXPANDED_MAX ? `Show ${KANBAN_EXPANDED_MAX} of ${phaseProjects.length}` : `Show all ${phaseProjects.length}`)}
                    </button>
                  )}
                </div>
                {/* Bottom scroll-shadow gradient — only visible when content overflows */}
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-950/80 to-transparent rounded-b-xl" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Skeleton components ──────────────────────────────────────────────────────

/** 8 cols for the All Projects table (customer, rep, phase, installer, financer, kW, netPPW, date). */
const TABLE_COL_WIDTHS = ['w-36', 'w-24', 'w-20', 'w-24', 'w-24', 'w-10', 'w-12', 'w-20'] as const;

function ProjectsSkeleton() {
  return (
    <div className="px-3 pt-2 pb-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <div className="h-8 w-32 bg-[#1d2028] rounded animate-skeleton" />
          <div className="h-3 w-28 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-9 w-24 bg-[#1d2028] rounded-xl animate-skeleton" />
      </div>

      {/* Tab + filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-4 md:flex-wrap">
        <div className="flex gap-1 bg-[#161920] border border-[#333849] rounded-xl p-1">
          <div className="h-8 w-20 bg-[#1d2028] rounded-lg animate-skeleton" />
          <div className="h-8 w-24 bg-[#272b35]/50 rounded-lg animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="flex gap-1 bg-[#1d2028] rounded-xl p-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-7 w-16 bg-[#272b35]/60 rounded-lg animate-skeleton" style={{ animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
        <div className="h-8 w-32 bg-[#1d2028] rounded-xl animate-skeleton" style={{ animationDelay: '150ms' }} />
      </div>

      {/* Kanban skeleton — 9 columns × 3 placeholder cards */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[...Array(9)].map((_, colIdx) => (
          <div key={colIdx} className="flex-shrink-0 w-52 space-y-2">
            {/* Column header */}
            <div className="flex items-center justify-between pb-2 mb-1">
              <div
                className="h-3 w-20 bg-[#1d2028] rounded animate-skeleton"
                style={{ animationDelay: `${colIdx * 60}ms` }}
              />
              <div
                className="h-5 w-6 bg-[#1d2028] rounded-full animate-skeleton"
                style={{ animationDelay: `${colIdx * 60}ms` }}
              />
            </div>
            {/* 3 placeholder cards per column */}
            {[...Array(3)].map((_, cardIdx) => {
              const delay = colIdx * 60 + cardIdx * 75;
              return (
                <div key={cardIdx} className="card-surface rounded-xl p-3 space-y-2">
                  <div
                    className="h-4 bg-[#1d2028] rounded animate-skeleton"
                    style={{ width: cardIdx === 0 ? '80%' : cardIdx === 1 ? '65%' : '75%', animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-12 bg-[#1d2028]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-20 bg-[#1d2028]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-16 bg-[#1d2028]/50 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Setter Popover ───────────────────────────────────────────────────────────

function SetterPopover({
  projectId,
  customerName,
  currentSetterId,
  currentSetterName,
  reps,
  trainerAssignments,
  setProjects,
  updateProject,
}: {
  projectId: string;
  customerName: string;
  currentSetterId?: string;
  currentSetterName?: string;
  reps: Rep[];
  trainerAssignments: TrainerAssignment[];
  setProjects: React.Dispatch<React.SetStateAction<ReturnType<typeof useApp>['projects']>>;
  updateProject: ReturnType<typeof useApp>['updateProject'];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchRaw, setSearchRaw] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // 150 ms debounce for the rep search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchRaw), 150);
    return () => clearTimeout(timer);
  }, [searchRaw]);

  // Focus search input whenever the popover opens
  useEffect(() => {
    if (open) {
      // Defer so the element is in the DOM
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  /** Close the popover and reset search state (called from event handlers, not effects). */
  const closePopover = () => {
    setOpen(false);
    setSearchRaw('');
    setSearchQuery('');
  };

  // Compute portal dropdown position aligned to the right edge of the trigger
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, { capture: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  // Dismiss on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      closePopover();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleAssign = (rep: Rep) => {
    updateProject(projectId, { setterId: rep.id, setterName: rep.name });
    toast(`Setter assigned: ${rep.name}`, 'success');
    closePopover();
  };

  /** Build 1-2 letter initials from a full name. */
  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  /** True if a rep appears as a trainee in any trainer assignment. */
  const isTrainee = (repId: string): boolean =>
    trainerAssignments.some((a) => a.traineeId === repId);

  // Currently-assigned rep object (may be undefined if rep was removed)
  const currentSetter = currentSetterId ? reps.find((r) => r.id === currentSetterId) ?? null : null;

  // Apply search filter; exclude closers and the current setter (shown pinned at top)
  const otherReps = reps
    .filter((r) => r.active)
    .filter((r) => r.id !== currentSetterId)
    .filter((r) => r.repType !== 'closer')
    .filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* ── Trigger button ── */}
      <button
        onClick={(e) => { e.stopPropagation(); if (open) { closePopover(); } else { setOpen(true); } }}
        title={currentSetterId ? `Reassign setter for ${customerName}` : `Assign a setter to ${customerName}`}
        className="relative inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#272b35] hover:bg-indigo-600 text-[#c2c8d8] hover:text-white text-xs font-medium transition-all active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap"
        aria-label={currentSetterId ? 'Reassign setter' : 'Assign setter'}
        aria-expanded={open}
      >
        {/* Pulsing indigo attention dot — only when no setter is assigned */}
        {!currentSetterId && (
          <span
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse"
            aria-hidden="true"
          />
        )}
        {currentSetterId ? (
          <>
            <ArrowLeftRight className="w-3 h-3 flex-shrink-0" />
            <span className="max-w-[96px] truncate">{currentSetterName ?? 'Setter'}</span>
          </>
        ) : (
          <>
            <UserPlus className="w-3 h-3 flex-shrink-0" />
            Assign Setter
          </>
        )}
      </button>

      {/* ── Dropdown popover (portaled to escape overflow-auto table container) ── */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-64 bg-[#1d2028] border border-[#272b35] rounded-xl shadow-xl shadow-black/40 overflow-hidden animate-modal-panel"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-[#272b35]/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8] pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search reps..."
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-[#161920] border border-[#272b35] text-white rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* ── Currently-assigned setter pinned at top ── */}
            {currentSetter && (
              <>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[#8891a8] uppercase tracking-wider">
                  Currently assigned
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAssign(currentSetter); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-indigo-600/20 transition-colors min-h-[44px]"
                >
                  {/* Initials avatar */}
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                    {getInitials(currentSetter.name)}
                  </span>
                  <span className="flex-1 text-sm text-white font-medium truncate">{currentSetter.name}</span>
                  {/* Role badge */}
                  {isTrainee(currentSetter.id)
                    ? <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★ Trainee</span>
                    : <span className="text-[#00e07a] text-[10px] font-medium flex-shrink-0">Setter</span>
                  }
                  {/* Green checkmark */}
                  <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                </button>
                {/* Divider + "Reassign" label */}
                <div className="mx-3 border-t border-[#272b35]/60" />
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[#8891a8] uppercase tracking-wider">
                  Reassign
                </p>
              </>
            )}

            {/* Section header when no setter yet */}
            {!currentSetter && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[#8891a8] uppercase tracking-wider">
                Select setter
              </p>
            )}

            {/* ── Rep list ── */}
            {otherReps.length === 0 ? (
              <div className="px-3 py-4 text-center text-[#8891a8] text-xs">
                No reps found
              </div>
            ) : (
              otherReps.map((rep) => (
                <button
                  key={rep.id}
                  onClick={(e) => { e.stopPropagation(); handleAssign(rep); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-indigo-600/20 transition-colors min-h-[44px]"
                >
                  {/* Initials avatar */}
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                    {getInitials(rep.name)}
                  </span>
                  <span className="flex-1 text-sm text-[#c2c8d8] hover:text-white truncate">{rep.name}</span>
                  {/* Role badge */}
                  {isTrainee(rep.id)
                    ? <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★ Trainee</span>
                    : <span className="text-[#00e07a] text-[10px] font-medium flex-shrink-0">Setter</span>
                  }
                </button>
              ))
            )}

            {/* Spacer at bottom for breathing room */}
            <div className="h-1" />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Pipeline phases used for the phase-advance quick action ──────────────────
const PIPELINE_PHASES: Phase[] = [
  'New', 'Acceptance', 'Site Survey', 'Design',
  'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed',
];

type SortKey = 'customerName' | 'repName' | 'phase' | 'installer' | 'financer' | 'kWSize' | 'netPPW' | 'soldDate';
type SortDirection = 'asc' | 'desc';

function SortIcon({ colKey, sortKey, sortDirection }: { colKey: SortKey; sortKey: SortKey; sortDirection: SortDirection }) {
  if (sortKey !== colKey) return <ChevronsUpDown className="w-3.5 h-3.5 ml-1 inline-block text-[#525c72]" />;
  if (sortDirection === 'asc') return <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" />;
  return <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />;
}

function TableView({
  projects,
  searchInput,
  setSearchInput,
  isAdmin,
  currentRepId,
  dealScope,
  onPhaseChange,
  setProjects,
  hasActiveFilters,
  clearAllFilters,
  readOnly = false,
  hideFinancials = false,
}: {
  projects: ReturnType<typeof useApp>['projects'];
  searchInput: string;
  setSearchInput: (s: string) => void;
  isAdmin: boolean;
  currentRepId: string | null;
  dealScope: 'mine' | 'all';
  onPhaseChange: (id: string, phase: Phase) => void;
  setProjects: React.Dispatch<React.SetStateAction<ReturnType<typeof useApp>['projects']>>;
  hasActiveFilters: boolean;
  clearAllFilters: () => void;
  readOnly?: boolean;
  hideFinancials?: boolean;
}) {
  const { reps, trainerAssignments, updateProject } = useApp();
  const { toast } = useToast();
  const tableRouter = useRouter();
  const tableSearchParams = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const VALID_SORT_KEYS: SortKey[] = ['customerName', 'repName', 'phase', 'installer', 'financer', 'kWSize', 'netPPW', 'soldDate'];
    const v = tableSearchParams.get('sort') as SortKey | null;
    return v && VALID_SORT_KEYS.includes(v) ? v : 'soldDate';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const v = tableSearchParams.get('dir');
    return v === 'asc' ? 'asc' : 'desc';
  });

  // Sync sort to URL (read current params to preserve other filters)
  useEffect(() => {
    // Skip if the URL already reflects the current sort state — avoids overwriting
    // the parent's concurrent router.replace when both effects fire on initial mount.
    const currentSort = tableSearchParams.get('sort') ?? 'soldDate';
    const currentDir = tableSearchParams.get('dir') ?? 'desc';
    if (currentSort === sortKey && currentDir === sortDirection) return;
    const params = new URLSearchParams(window.location.search);
    if (sortKey !== 'soldDate') params.set('sort', sortKey); else params.delete('sort');
    if (sortDirection !== 'desc') params.set('dir', sortDirection); else params.delete('dir');
    const qs = params.toString();
    tableRouter.replace(qs ? `?${qs}` : '/dashboard/projects', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDirection]);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // ── Table row keyboard navigation ──────────────────────────────────────────
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  useTableKeyNav(tbodyRef);

  // ── Keyboard shortcut: '/' focuses the search input ──────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Keyboard shortcut: ArrowLeft / ArrowRight for pagination ──────────────
  useEffect(() => {
    const handlePageNav = (e: KeyboardEvent) => {
      // Skip when an input, select, or textarea is focused
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;
      if (e.key === 'ArrowLeft') {
        setCurrentPage((p) => Math.max(1, p - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentPage((p) => Math.min(Math.max(1, Math.ceil(projects.length / rowsPerPage)), p + 1));
      }
    };
    document.addEventListener('keydown', handlePageNav);
    return () => document.removeEventListener('keydown', handlePageNav);
  }, [projects.length, rowsPerPage]);

  // ── Bulk selection state (admin only) ──────────────────────────────────────
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const showActionBar = isAdmin && selectedProjectIds.size > 0;

  // Escape key → deselect all selected projects
  useEffect(() => {
    if (!isAdmin) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedProjectIds(new Set());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAdmin]);

  // Reset to page 1 when the upstream projects list changes identity (i.e. the
  // parent's search / status / installer filter changed).  Calling setState
  // during render (when a prop changes) is the React-recommended alternative to
  // a useEffect that would trigger a second render anyway.
  const [prevProjects, setPrevProjects] = useState(projects);
  if (projects !== prevProjects) {
    setPrevProjects(projects);
    setCurrentPage(1);
    setSelectedProjectIds(new Set());
  }

  const handleSort = (key: SortKey) => {
    // Reset to page 1 so the user sees results from the top after re-sorting.
    setCurrentPage(1);
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'customerName':
        case 'repName':
        case 'installer':
        case 'financer':
          cmp = (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '');
          break;
        case 'phase':
          cmp = PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase);
          break;
        case 'kWSize':
        case 'netPPW':
          cmp = a[sortKey] - b[sortKey];
          break;
        case 'soldDate':
          cmp = (a.soldDate ?? '').localeCompare(b.soldDate ?? '');
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [projects, sortKey, sortDirection]);

  const totalResults = sortedProjects.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, totalResults);
  const pagedProjects = sortedProjects.slice(startIdx, endIdx);

  // ── Bulk selection helpers (depend on pagedProjects) ─────────────────────
  const allPageSelected = isAdmin && pagedProjects.length > 0 && pagedProjects.every((p) => selectedProjectIds.has(p.id));

  const toggleProject = (id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllProjects = () => {
    const pageIds = pagedProjects.map((p) => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedProjectIds.has(id));
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleBulkAdvance = () => {
    let advanced = 0;
    selectedProjectIds.forEach((id) => {
      const proj = projects.find((p) => p.id === id);
      if (!proj) return;
      const phaseIdx = PIPELINE_PHASES.indexOf(proj.phase);
      const nextPhase = phaseIdx >= 0 ? PIPELINE_PHASES[phaseIdx + 1] : undefined;
      if (nextPhase) {
        onPhaseChange(id, nextPhase);
        advanced++;
      }
    });
    setSelectedProjectIds(new Set());
    if (advanced > 0) {
      toast(`${advanced} project${advanced > 1 ? 's' : ''} advanced to next phase`, 'success');
    } else {
      toast('No projects advanced — selected projects may be Cancelled, On Hold, or already at the final phase', 'error');
    }
  };

  // Derived selection stats — used by the floating action bar
  const selectedFlaggedCount = [...selectedProjectIds].filter((id) => projects.find((p) => p.id === id)?.flagged).length;
  const bulkFlagLabel = selectedFlaggedCount > selectedProjectIds.size / 2 ? 'Unflag' : 'Flag';
  const selectedTotalKw = [...selectedProjectIds].reduce((sum, id) => {
    const p = projects.find((proj) => proj.id === id);
    return sum + (p?.kWSize ?? 0);
  }, 0);
  const [bulkPhaseTarget, setBulkPhaseTarget] = useState<Phase | ''>('');

  const handleBulkFlag = () => {
    const shouldFlag = bulkFlagLabel === 'Flag';
    selectedProjectIds.forEach((id) => {
      updateProject(id, { flagged: shouldFlag });
    });
    const count = selectedProjectIds.size;
    toast(`${count} project${count > 1 ? 's' : ''} ${shouldFlag ? 'flagged' : 'unflagged'}`, 'success');
    setSelectedProjectIds(new Set());
  };

  // Bulk change phase — with ConfirmDialog for destructive phases
  const [bulkConfirm, setBulkConfirm] = useState<{ phase: Phase; count: number } | null>(null);

  // Bulk cancellation reason modal state (mirrors the single-project cancel reason modal)
  const [bulkCancelReasonModal, setBulkCancelReasonModal] = useState<{ count: number } | null>(null);
  const [bulkCancelReason, setBulkCancelReason] = useState('');
  const [bulkCancelNotes, setBulkCancelNotes] = useState('');

  const handleBulkChangePhase = (targetPhase: Phase) => {
    if (targetPhase === 'Cancelled') {
      setBulkCancelReason('');
      setBulkCancelNotes('');
      setBulkCancelReasonModal({ count: selectedProjectIds.size });
      setBulkPhaseTarget('');
      return;
    }
    if (targetPhase === 'On Hold') {
      setBulkConfirm({ phase: targetPhase, count: selectedProjectIds.size });
      setBulkPhaseTarget('');
      return;
    }
    executeBulkPhaseChange(targetPhase);
  };

  const confirmBulkCancelWithReason = () => {
    if (!bulkCancelReasonModal) return;
    const count = selectedProjectIds.size;
    selectedProjectIds.forEach((id) => {
      updateProject(id, {
        phase: 'Cancelled',
        cancellationReason: bulkCancelReason || undefined,
        cancellationNotes: bulkCancelNotes || undefined,
      } as Partial<typeof projects[0]>);
    });
    toast(`${count} project${count > 1 ? 's' : ''} moved to Cancelled`, 'info');
    setSelectedProjectIds(new Set());
    setBulkPhaseTarget('');
    setBulkCancelReasonModal(null);
  };

  const executeBulkPhaseChange = (targetPhase: Phase) => {
    const count = selectedProjectIds.size;
    if (targetPhase === 'On Hold') {
      // onPhaseChange opens a per-project setPhaseConfirm modal and returns early,
      // so bulk 'On Hold' must call updateProject directly (bulkConfirm already confirmed).
      selectedProjectIds.forEach((id) => {
        updateProject(id, { phase: 'On Hold' });
      });
    } else {
      selectedProjectIds.forEach((id) => {
        onPhaseChange(id, targetPhase);
      });
    }
    setSelectedProjectIds(new Set());
    setBulkPhaseTarget('');
    setBulkConfirm(null);
    toast(`${count} project${count > 1 ? 's' : ''} moved to ${targetPhase}`, 'success');
  };

  function thClass(colKey: SortKey) {
    const active = sortKey === colKey;
    return `text-left px-5 py-3 font-medium cursor-pointer select-none transition-colors hover:text-white ${
      active ? 'text-white' : 'text-[#c2c8d8]'
    }`;
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 md:gap-3 mb-4">
        <div className="relative flex-1 max-w-full md:max-w-xs min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8891a8]" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search customers, reps, phases..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full rounded-xl pl-9 pr-8 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-slate-500"
            style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
          />
          {/* Clear button — shown when there is a search query */}
          {searchInput ? (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#c2c8d8] hover:text-white transition-colors"
              aria-label="Clear search input"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            /* '/' shortcut hint — shown when input is empty and not focused */
            !searchFocused && (
              <kbd
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 px-1.5 rounded border border-[#272b35] bg-[#272b35]/60 text-[#c2c8d8] font-mono text-[11px] leading-none select-none"
                aria-hidden="true"
              >
                /
              </kbd>
            )
          )}
        </div>
        {/* Inline row-count summary — gives instant feedback on the current page slice */}
        {searchInput.trim() && (
          <span className="text-xs text-[#8891a8] bg-[#1d2028] px-2 py-0.5 rounded-full">{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
        )}
        <span className="text-[#8891a8] text-sm">
          {totalResults === 0
            ? 'No results'
            : `Showing ${startIdx + 1}–${endIdx} of ${totalResults}`}
        </span>
        {isAdmin && !hideFinancials && sortedProjects.length > 0 && (
          <button
            onClick={() => {
              const headers = ['Customer', 'Rep', 'Phase', 'Installer', 'Financer', 'kW', 'Net PPW', 'Sold Date', 'Flagged'];
              const rows = sortedProjects.map((p) => [
                p.customerName,
                p.repName,
                p.phase,
                p.installer,
                p.financer,
                p.kWSize.toString(),
                `$${p.netPPW.toFixed(2)}`,
                formatDate(p.soldDate),
                p.flagged ? 'Yes' : 'No',
              ]);
              downloadCSV(`projects-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
            }}
            className="flex items-center gap-1.5 text-xs text-[#c2c8d8] hover:text-white bg-[#1d2028] hover:bg-[#272b35] border border-[#272b35] px-3 py-1.5 rounded-lg transition-colors"
            title="Download filtered projects as CSV"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        )}
      </div>

      {/* ── Mobile card view (below md) ──────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {pagedProjects.length === 0 && (
          <div className="card-surface rounded-2xl px-5 py-12 text-center">
            <p className="text-[#c2c8d8] text-sm">
              {hasActiveFilters ? 'No projects match your filters.' : 'No projects yet.'}
            </p>
          </div>
        )}
        {pagedProjects.map((proj) => (
          <Link key={proj.id} href={`/dashboard/projects/${proj.id}`}>
            <div className={`card-surface rounded-xl p-3 md:p-4 active:scale-[0.98] transition-transform min-h-[44px] ${proj.flagged ? 'border-l-2 border-l-red-500' : ''}`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-white font-medium text-sm flex items-center gap-1.5">
                  {proj.customerName}
                  {proj.flagged && <Flag className="w-3 h-3 text-red-400" />}
                </span>
                <PhaseBadge phase={proj.phase} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#c2c8d8]">
                <span>{proj.kWSize} kW</span>
                <span>{proj.installer}</span>
                <span>{relativeTime(proj.soldDate)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Mobile pagination */}
      <div className="md:hidden">
        <PaginationBar
          totalResults={totalResults} startIdx={startIdx} endIdx={endIdx}
          currentPage={safeCurrentPage} totalPages={totalPages} rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage} onRowsPerPageChange={setRowsPerPage}
        />
      </div>

      {/* ── Desktop table view (md+) ─────────────────────────────────── */}
      <div className="hidden md:block card-surface rounded-2xl overflow-x-auto scroll-smooth">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10" style={{ background: '#1d2028' }}>
              <tr>
                {isAdmin && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleAllProjects}
                      className="accent-[#00e07a] w-4 h-4 rounded cursor-pointer"
                      aria-label="Select all projects on this page"
                    />
                  </th>
                )}
                <th className={thClass('customerName')} onClick={() => handleSort('customerName')}>
                  Customer<SortIcon colKey="customerName" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                {(isAdmin || (!isAdmin && dealScope === 'all')) && (
                  <th className={thClass('repName')} onClick={() => handleSort('repName')}>
                    Rep<SortIcon colKey="repName" sortKey={sortKey} sortDirection={sortDirection} />
                  </th>
                )}
                <th className={thClass('phase')} onClick={() => handleSort('phase')}>
                  Phase<SortIcon colKey="phase" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                <th className={thClass('installer')} onClick={() => handleSort('installer')}>
                  Installer<SortIcon colKey="installer" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                <th className={thClass('financer')} onClick={() => handleSort('financer')}>
                  Financer<SortIcon colKey="financer" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                <th className={thClass('kWSize')} onClick={() => handleSort('kWSize')}>
                  kW<SortIcon colKey="kWSize" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                {!hideFinancials && (
                  <th className={thClass('netPPW')} onClick={() => handleSort('netPPW')}>
                    Net PPW<SortIcon colKey="netPPW" sortKey={sortKey} sortDirection={sortDirection} />
                  </th>
                )}
                <th className={thClass('soldDate')} onClick={() => handleSort('soldDate')}>
                  Sold Date<SortIcon colKey="soldDate" sortKey={sortKey} sortDirection={sortDirection} />
                </th>
                {isAdmin && (
                  <th className="text-left px-5 py-3 font-medium text-[#c2c8d8] select-none whitespace-nowrap">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {pagedProjects.map((proj, i) => {
                const myRole = !isAdmin
                  ? (proj.repId === currentRepId ? 'Closer' : proj.setterId === currentRepId ? 'Setter' : null)
                  : null;
                const isMyRow = myRole !== null && dealScope === 'all';
                return (
                  <tr
                    key={proj.id}
                    tabIndex={0}
                    role="row"
                    onClick={() => { try { sessionStorage.setItem('kilo-project-nav', JSON.stringify(sortedProjects.map((p) => p.id))); } catch {} tableRouter.push(`/dashboard/projects/${proj.id}`); }}
                  className={`group table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e07a]/60 focus-visible:ring-inset`}
                  style={{
                    borderBottom: '1px solid #272b35',
                    background: selectedProjectIds.has(proj.id)
                      ? 'rgba(77,159,255,0.08)'
                      : i % 2 === 0 ? '#161920' : '#191c24',
                    borderLeft: proj.flagged
                      ? '3px solid #ff5252'
                      : isMyRow
                        ? '3px solid #4d9fff'
                        : undefined,
                  }}
                >
                  {isAdmin && (
                    <td className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.has(proj.id)}
                        onChange={() => toggleProject(proj.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-[#00e07a] w-4 h-4 rounded cursor-pointer"
                        aria-label={`Select ${proj.customerName}`}
                      />
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/projects/${proj.id}`}
                      className="text-white hover:text-[#00e07a] transition-colors flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {proj.customerName}
                      {proj.flagged && <Flag className="w-3 h-3 text-red-400" />}
                      <StaleBadge soldDate={proj.soldDate} phase={proj.phase} />
                    </Link>
                  </td>
                  {isAdmin && <td className="px-5 py-3 text-[#c2c8d8]">{proj.repName}</td>}
                  {/* Rep name cell for reps in All Deals mode — shows "You" pill + bold name on own rows */}
                  {!isAdmin && dealScope === 'all' && (
                    <td className="px-5 py-3">
                      <span className={`flex items-center gap-1.5 ${isMyRow ? 'text-[#c2c8d8] font-semibold' : 'text-[#c2c8d8]'}`}>
                        {proj.repName}
                        {isMyRow && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none ${
                            myRole === 'Closer'
                              ? 'bg-blue-900/60 text-[#00c4f0] border border-[#00e07a]/40'
                              : 'bg-emerald-900/60 text-emerald-300 border border-[#00e07a]/40'
                          }`}>
                            You · {myRole}
                          </span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className="px-5 py-3">
                    {isAdmin ? (
                      <select
                        value={proj.phase}
                        onChange={(e) => onPhaseChange(proj.id, e.target.value as Phase)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-[#1d2028] border border-[#272b35] text-[#c2c8d8] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                      >
                        {PHASES.map((ph) => (
                          <option key={ph} value={ph}>{ph}</option>
                        ))}
                      </select>
                    ) : (
                      <PhaseBadge phase={proj.phase} />
                    )}
                  </td>
                  <td className="px-5 py-3 text-[#c2c8d8]">{proj.installer}</td>
                  <td className="px-5 py-3 text-[#c2c8d8]">{proj.financer}</td>
                  <td className="px-5 py-3 text-[#c2c8d8]">{proj.kWSize}</td>
                  {!hideFinancials && <td className="px-5 py-3" style={{ color: '#00e07a', fontFamily: "'DM Serif Display', serif" }}>${proj.netPPW.toFixed(2)}</td>}
                  <td className="px-5 py-3 text-[#8891a8]">
                    <div>{formatDate(proj.soldDate)}</div>
                    <div className="text-[10px] text-[#525c72]">{relativeTime(proj.soldDate)}</div>
                  </td>
                  {isAdmin && (() => {
                    const phaseIdx = PIPELINE_PHASES.indexOf(proj.phase);
                    const nextPhase = phaseIdx >= 0 ? PIPELINE_PHASES[phaseIdx + 1] : undefined;
                    return (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Phase-advance quick-action — fades in on row hover (identical to Kanban card behaviour) */}
                          {nextPhase && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onPhaseChange(proj.id, nextPhase); }}
                              title={`Advance to ${nextPhase}`}
                              className="opacity-40 group-hover:opacity-100 transition-opacity duration-150 inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#272b35] hover:bg-[#00e07a] text-[#c2c8d8] hover:text-white active:scale-[0.97] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                              aria-label={`Advance ${proj.customerName} to ${nextPhase}`}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {/* Assign / Reassign Setter */}
                          <SetterPopover
                            projectId={proj.id}
                            customerName={proj.customerName}
                            currentSetterId={proj.setterId}
                            currentSetterName={proj.setterName}
                            reps={reps}
                            trainerAssignments={trainerAssignments}
                            setProjects={setProjects}
                            updateProject={updateProject}
                          />
                        </div>
                      </td>
                    );
                  })()}
                </tr>
                );
              })}
              {pagedProjects.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 10 : dealScope === 'all' ? 8 : 7} className="px-5 py-12 text-center">
                    <div className="flex justify-center">
                      {hasActiveFilters ? (
                        /* ── Filtered: no results ─────────────────────────────────── */
                        <div className="animate-fade-in w-60 border border-dashed border-[#333849] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — magnifying glass over empty grid */}
                          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                            <rect x="8" y="18" width="46" height="44" rx="5" stroke="#475569" strokeWidth="2" fill="none"/>
                            <rect x="14" y="26" width="12" height="8" rx="2" fill="#334155"/>
                            <rect x="32" y="26" width="16" height="3" rx="1.5" fill="#334155"/>
                            <rect x="32" y="32" width="10" height="3" rx="1.5" fill="#1e293b"/>
                            <rect x="14" y="40" width="34" height="3" rx="1.5" fill="#1e293b"/>
                            <rect x="14" y="47" width="22" height="3" rx="1.5" fill="#1e293b"/>
                            {/* Magnifying glass */}
                            <circle cx="56" cy="52" r="12" stroke="#00c4f0" strokeWidth="2.5" fill="none" strokeOpacity="0.6"/>
                            <circle cx="56" cy="52" r="7" stroke="#00c4f0" strokeWidth="1.5" fill="none" strokeOpacity="0.3"/>
                            <line x1="64.5" y1="61" x2="72" y2="69" stroke="#00c4f0" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"/>
                            {/* X inside lens */}
                            <line x1="53" y1="49" x2="59" y2="55" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
                            <line x1="59" y1="49" x2="53" y2="55" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
                          </svg>
                          <p className="text-[#c2c8d8] text-sm font-semibold leading-snug">No projects match your filters</p>
                          <p className="text-[#8891a8] text-xs leading-relaxed">Try adjusting your search query or active filters to find what you&apos;re looking for.</p>
                          <button
                            onClick={clearAllFilters}
                            className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Clear Filters
                          </button>
                        </div>
                      ) : (
                        /* ── No deals at all ──────────────────────────────────────── */
                        <div className="animate-fade-in w-60 border border-dashed border-[#333849] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
                          {/* Illustration — folder with solar panel motif */}
                          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                            {/* Folder body */}
                            <path d="M10 28 C10 24.7 12.7 22 16 22 L30 22 L34 27 L64 27 C67.3 27 70 29.7 70 33 L70 58 C70 61.3 67.3 64 64 64 L16 64 C12.7 64 10 61.3 10 58 Z" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                            {/* Folder tab */}
                            <path d="M10 22 L30 22 L34 27 L10 27 Z" fill="#334155"/>
                            {/* Solar panel grid inside folder */}
                            <rect x="22" y="36" width="8" height="6" rx="1" fill="#00e07a" fillOpacity="0.5" stroke="#00c4f0" strokeWidth="0.75" strokeOpacity="0.6"/>
                            <rect x="32" y="36" width="8" height="6" rx="1" fill="#00e07a" fillOpacity="0.5" stroke="#00c4f0" strokeWidth="0.75" strokeOpacity="0.6"/>
                            <rect x="42" y="36" width="8" height="6" rx="1" fill="#00e07a" fillOpacity="0.5" stroke="#00c4f0" strokeWidth="0.75" strokeOpacity="0.6"/>
                            <rect x="22" y="44" width="8" height="6" rx="1" fill="#1d4ed8" fillOpacity="0.4" stroke="#00c4f0" strokeWidth="0.75" strokeOpacity="0.4"/>
                            <rect x="32" y="44" width="8" height="6" rx="1" fill="#1d4ed8" fillOpacity="0.4" stroke="#00c4f0" strokeWidth="0.75" strokeOpacity="0.4"/>
                            <rect x="42" y="44" width="8" height="6" rx="1" fill="#1d4ed8" fillOpacity="0.4" stroke="#00c4f0" strokeWidth="0.75" strokeOpacity="0.4"/>
                            {/* Sparkle / plus icon */}
                            <circle cx="58" cy="22" r="8" fill="#1d2028"/>
                            <line x1="58" y1="17" x2="58" y2="27" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
                            <line x1="53" y1="22" x2="63" y2="22" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                          <p className="text-[#c2c8d8] text-sm font-semibold leading-snug">Submit your first deal</p>
                          <p className="text-[#8891a8] text-xs leading-relaxed">Your pipeline is empty. Create a new deal to start tracking projects and commissions.</p>
                          <a
                            href="/dashboard/new-deal"
                            className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            + Submit Deal
                          </a>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        {/* ── Pagination bar ─────────────────────────────────────────── */}
        <PaginationBar
          totalResults={totalResults} startIdx={startIdx} endIdx={endIdx}
          currentPage={safeCurrentPage} totalPages={totalPages} rowsPerPage={rowsPerPage}
          onPageChange={setCurrentPage} onRowsPerPageChange={setRowsPerPage}
        />
      </div>

      {/* Spacer so content is never hidden behind the fixed action bar */}
      {showActionBar && <div className="h-20" />}

      {/* ── Floating bulk-action toolbar ──────────────────────────────────
           Glass-morphism pill centred at the viewport bottom. Mounts with a
           spring-eased slide-up entrance whenever one or more projects are
           selected (admin only). Escape key and the × button both clear the
           selection.                                                          */}
      {showActionBar && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 backdrop-blur-xl bg-[#161920]/80 border border-[#272b35]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40 animate-float-toolbar-in"
          role="toolbar"
          aria-label="Batch actions for selected projects"
        >
          <div className="flex items-center gap-3">

            {/* Selection count badge — blue accent pill with total kW */}
            <span className="flex items-center gap-1.5 bg-[#00e07a]/15 border border-[#00e07a]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
              <span className="text-white font-bold tabular-nums">{selectedProjectIds.size}</span>
              <span className="text-[#00e07a] font-medium">selected</span>
              {selectedTotalKw > 0 && (
                <>
                  <span className="text-[#525c72] mx-0.5">&middot;</span>
                  <span className="text-[#00e07a] font-semibold tabular-nums">{selectedTotalKw.toFixed(1)} kW</span>
                </>
              )}
            </span>

            {/* Visual divider */}
            <div className="h-5 w-px bg-[#272b35]/80 flex-shrink-0" />

            {/* Advance Phase — primary action */}
            <button
              onClick={handleBulkAdvance}
              className="btn-primary text-black font-semibold px-4 py-1.5 rounded-xl text-sm shadow-lg shadow-blue-500/20 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Advance Phase
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {/* Change Phase — dropdown to pick any target phase */}
            <select
              value={bulkPhaseTarget}
              onChange={(e) => { if (e.target.value) handleBulkChangePhase(e.target.value as Phase); }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#272b35]/60 border border-[#272b35]/40 text-[#c2c8d8] rounded-xl px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#00e07a] cursor-pointer hover:bg-[#525c72]/80 transition-colors"
            >
              <option value="">Change Phase...</option>
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>{ph}</option>
              ))}
            </select>

            {/* Flag / Unflag toggle */}
            <button
              onClick={handleBulkFlag}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap bg-[#272b35]/60 hover:bg-red-600/80 border border-[#272b35]/40 text-[#c2c8d8] hover:text-white transition-colors active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <Flag className="w-3.5 h-3.5" />
              {bulkFlagLabel}
            </button>

            {/* Dismiss / deselect-all × button */}
            <button
              onClick={() => setSelectedProjectIds(new Set())}
              aria-label="Deselect all and dismiss toolbar"
              className="btn-secondary p-1.5 rounded-lg bg-[#272b35]/60 hover:bg-[#525c72]/80 border border-[#272b35]/40 text-[#c2c8d8] hover:text-white transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>

          </div>
        </div>
      )}

      {/* Bulk phase change confirmation (On Hold only) */}
      <ConfirmDialog
        open={!!bulkConfirm}
        onClose={() => { setBulkConfirm(null); setBulkPhaseTarget(''); }}
        onConfirm={() => { if (bulkConfirm) executeBulkPhaseChange(bulkConfirm.phase); }}
        title={`Move ${bulkConfirm?.count ?? 0} project${(bulkConfirm?.count ?? 0) > 1 ? 's' : ''} to ${bulkConfirm?.phase ?? ''}?`}
        message={`This will move ${bulkConfirm?.count ?? 0} selected project${(bulkConfirm?.count ?? 0) > 1 ? 's' : ''} to ${bulkConfirm?.phase ?? ''}. On-hold projects are paused.`}
        confirmLabel="Put On Hold"
        danger={false}
      />

      {/* Bulk Cancellation Reason Modal */}
      {bulkCancelReasonModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setBulkCancelReasonModal(null); }}>
          <div className="bg-[#161920] border border-[#272b35] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#333849]">
              <h2 className="text-white font-bold text-base">Cancel {bulkCancelReasonModal.count} Project{bulkCancelReasonModal.count > 1 ? 's' : ''}</h2>
              <button onClick={() => setBulkCancelReasonModal(null)} className="text-[#c2c8d8] hover:text-white transition-colors rounded-lg p-1 hover:bg-[#1d2028]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[#c2c8d8] text-sm">Why are <span className="text-white font-medium">{bulkCancelReasonModal.count} project{bulkCancelReasonModal.count > 1 ? 's' : ''}</span> being cancelled?</p>
              <div>
                <label className="text-[#c2c8d8] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select value={bulkCancelReason} onChange={(e) => setBulkCancelReason(e.target.value)}
                  className="w-full bg-[#1d2028] border border-[#272b35] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]">
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
                <label className="text-[#c2c8d8] text-xs uppercase tracking-wider block mb-1.5">Notes <span className="text-[#525c72] font-normal normal-case">(optional)</span></label>
                <textarea rows={2} value={bulkCancelNotes} onChange={(e) => setBulkCancelNotes(e.target.value)} placeholder="Additional details..."
                  className="w-full bg-[#1d2028] border border-[#272b35] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] resize-none placeholder-slate-500" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setBulkCancelReasonModal(null)}
                  className="flex-1 bg-[#1d2028] hover:bg-[#272b35] border border-[#272b35] text-[#c2c8d8] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors">Go Back</button>
                <button onClick={confirmBulkCancelWithReason}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors active:scale-[0.97]">Cancel Projects</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

