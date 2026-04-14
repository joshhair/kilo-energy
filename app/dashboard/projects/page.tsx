'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import { ACTIVE_PHASES, Phase } from '../../../lib/data';
import { X } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import ConfirmDialog from '../components/ConfirmDialog';
import MobileProjects from '../mobile/MobileProjects';
import KanbanView from './components/KanbanView';
import TableView from './components/TableView';
import ProjectsSkeleton from './components/ProjectsSkeleton';
import { applyStatusFilter, STATUS_LABELS, type StatusFilter } from './components/shared';

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
  const [qaOnly, setQaOnly] = useState(() => searchParams.get('qa') === '1');
  const isHydrated = useIsHydrated();

  // Sync filters to URL searchParams
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (tab !== 'phase') params.set('view', tab); else params.delete('view');
    if (statusFilter !== 'active') params.set('status', statusFilter); else params.delete('status');
    if (installerFilter) params.set('installer', installerFilter); else params.delete('installer');
    if (phaseFilter) params.set('phase', phaseFilter); else params.delete('phase');
    if (qaOnly) params.set('qa', '1'); else params.delete('qa');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/dashboard/projects', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, installerFilter, phaseFilter, qaOnly]);

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
    const STATUS_FILTER_TABS: StatusFilter[] = ['active', 'all', 'completed', 'cancelled', 'on-hold', 'inactive'];
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
    const matchQa = !qaOnly || p.customerName.startsWith('[QA]');
    return matchSearch && matchInstaller && matchPhase && matchQa;
  });

  // Destructive phase change confirmation
  const [phaseConfirm, setPhaseConfirm] = useState<{ projectId: string; phase: Phase; projectName: string } | null>(null);

  // Cancellation reason modal state
  const [cancelReasonModal, setCancelReasonModal] = useState<{ projectId: string; projectName: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');

  const doPhaseChange = (projectId: string, phase: Phase, silent?: boolean) => {
    const project = projects.find((p) => p.id === projectId);
    const previousPhase = project?.phase;
    updateProject(projectId, { phase });
    if (!silent && project) toast(
      `${project.customerName} moved to ${phase}`,
      'success',
      previousPhase && previousPhase !== phase
        ? { label: 'Undo', onClick: () => doPhaseChange(projectId, previousPhase) }
        : undefined,
    );
  };

  const handlePhaseChange = (projectId: string, phase: Phase, silent?: boolean) => {
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
    doPhaseChange(projectId, phase, silent);
  };

  const confirmCancelWithReason = () => {
    if (!cancelReasonModal) return;
    if (!cancelReason) {
      toast('Please select a cancellation reason.', 'error');
      return;
    }
    updateProject(cancelReasonModal.projectId, {
      phase: 'Cancelled',
      cancellationReason: cancelReason || undefined,
      cancellationNotes: cancelNotes || undefined,
    } as Partial<typeof projects[0]>);
    toast(`${cancelReasonModal.projectName} cancelled`, 'info');
    setCancelReasonModal(null);
  };

  const hasActiveFilters = statusFilter !== 'active' || installerFilter !== '' || searchInput !== '' || phaseFilter !== '' || qaOnly;

  const clearAllFilters = () => {
    setStatusFilter('active');
    setInstallerFilter('');
    setSearchInput('');
    setDebouncedSearch('');
    setPhaseFilter('');
    setQaOnly(false);
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
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Projects</h1>
          <p className="text-[var(--text-secondary)] text-sm font-medium mt-1 tracking-wide">{hasActiveFilters ? `${filtered.length} of ${visibleProjects.length} projects` : `${visibleProjects.length} total projects`}</p>
        </div>
        <Link
          href="/dashboard/new-deal"
          className="font-bold px-4 py-2 rounded-xl text-sm active:scale-[0.97]"
          style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#000', boxShadow: '0 0 20px rgba(0,224,122,0.25)' }}
        >
          + New Deal
        </Link>
      </div>

      {/* View + Status tabs */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-4 md:flex-wrap">
        <div className="flex gap-1 rounded-xl p-1 tab-bar-container" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {viewIndicator && <div className="tab-indicator" style={viewIndicator} />}
          {(['phase', 'all'] as const).map((t, i) => (
            <button
              key={t}
              ref={(el) => { viewTabRefs.current[i] = el; }}
              onClick={() => setTab(t)}
              className="relative z-10 px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-colors"
              style={tab === t
                ? { background: 'var(--accent-green)', color: '#000', fontWeight: 700 }
                : { color: 'var(--text-secondary)' }
              }
            >
              {t === 'phase' ? 'By Phase' : 'All Projects'}
            </button>
          ))}
        </div>

        {/* My Deals / All Deals segmented control — admin only */}
        {!isRep && (
          <div className="flex gap-0.5 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            {(['all', 'mine'] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setDealScope(scope)}
                className="relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                style={dealScope === scope
                  ? { background: 'var(--accent-green)', color: '#000', fontWeight: 700 }
                  : { color: 'var(--text-secondary)' }
                }
              >
                {scope === 'all' ? 'All Deals' : 'My Deals'}
              </button>
            ))}
          </div>
        )}

        {/* Status filter */}
        <div className="flex gap-1 rounded-xl p-1 tab-bar-container overflow-x-auto scrollbar-hide w-full md:w-auto" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {statusFilterIndicator && <div className="tab-indicator" style={statusFilterIndicator} />}
          {([
            { value: 'active', label: 'Active' },
            { value: 'all', label: 'All' },
            { value: 'completed', label: '✓ Completed' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'on-hold', label: 'On Hold' },
            { value: 'inactive', label: 'Inactive' },
          ] as { value: StatusFilter; label: string }[]).map((s, i) => (
            <button
              key={s.value}
              ref={(el) => { statusFilterRefs.current[i] = el; }}
              onClick={() => setStatusFilter(s.value)}
              className="relative z-10 px-4 py-1.5 min-h-[40px] rounded-lg text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap"
              style={statusFilter === s.value
                ? { background: 'var(--accent-green)', color: '#000', fontWeight: 700 }
                : { color: 'var(--text-muted)' }
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Installer filter */}
        <select
          aria-label="Installer"
          name="installer"
          value={installerFilter}
          onChange={(e) => setInstallerFilter(e.target.value)}
          className="rounded-xl px-3 py-1.5 min-h-[36px] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] w-full md:w-auto"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <option value="">All Installers</option>
          {activeInstallers.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>

        {/* [QA] filter — admin only, shows only agent-generated test deals */}
        {effectiveRole === 'admin' && (
          <button
            onClick={() => setQaOnly((v) => !v)}
            className="rounded-xl px-3 py-1.5 min-h-[36px] text-xs font-semibold transition-colors w-full md:w-auto"
            style={qaOnly
              ? { background: 'var(--accent-green)', color: '#000' }
              : { background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            title="Show only agent-generated test deals ([QA] prefix)"
          >
            [QA] only
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {statusFilter !== 'active' && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Status: {STATUS_LABELS[statusFilter]}
              <button
                onClick={() => setStatusFilter('active')}
                className="text-[var(--text-secondary)] hover:text-white transition-colors"
                aria-label="Clear status filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {installerFilter && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Installer: {installerFilter}
              <button
                onClick={() => setInstallerFilter('')}
                className="text-[var(--text-secondary)] hover:text-white transition-colors"
                aria-label="Clear installer filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {searchInput && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Search: &ldquo;{searchInput}&rdquo;
              <button
                onClick={() => { setSearchInput(''); setDebouncedSearch(''); }}
                className="text-[var(--text-secondary)] hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {phaseFilter && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Phase: {phaseFilter}
              <button
                onClick={() => setPhaseFilter('')}
                className="text-[var(--text-secondary)] hover:text-white transition-colors"
                aria-label="Clear phase filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {qaOnly && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              QA only
              <button
                onClick={() => setQaOnly(false)}
                className="text-[var(--text-secondary)] hover:text-white transition-colors"
                aria-label="Clear QA filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button
            onClick={clearAllFilters}
            className="text-[var(--text-secondary)] hover:text-white text-xs transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {tab === 'phase' ? (
        <KanbanView
          projects={filtered}
          isAdmin={effectiveRole === 'admin'}
          canEditPhase={effectiveRole === 'admin' || isPM}
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
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <h2 className="text-white font-bold text-base">Cancel Project</h2>
              <button onClick={() => setCancelReasonModal(null)} className="text-[var(--text-secondary)] hover:text-white transition-colors rounded-lg p-1 hover:bg-[var(--surface-card)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[var(--text-secondary)] text-sm">Why is <span className="text-white font-medium">{cancelReasonModal.projectName}</span> being cancelled?</p>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]">
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
                <textarea rows={2} value={cancelNotes} onChange={(e) => setCancelNotes(e.target.value)} placeholder="Additional details..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] resize-none placeholder-slate-500" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setCancelReasonModal(null)}
                  className="flex-1 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors">Go Back</button>
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
