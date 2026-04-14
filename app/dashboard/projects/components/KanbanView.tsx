'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useMediaQuery } from '../../../../lib/hooks';
import { PHASES, ACTIVE_PHASES, Phase } from '../../../../lib/data';
import { Search, Flag, X, ChevronDown, FolderKanban, ChevronRight, ChevronLeft } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import { PHASE_COLORS, PHASE_PILL, StaleBadge, type ProjectList } from './shared';

export default function KanbanView({
  projects,
  isAdmin,
  canEditPhase = isAdmin,
  currentRepId,
  dealScope,
  onPhaseChange,
  readOnly = false,
  hideFinancials = false,
}: {
  projects: ProjectList;
  isAdmin: boolean;
  canEditPhase?: boolean;
  currentRepId: string | null;
  dealScope: 'mine' | 'all';
  onPhaseChange: (id: string, phase: Phase) => void;
  readOnly?: boolean;
  hideFinancials?: boolean;
}) {
  const { toast } = useToast();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const activePhasesForKanban = PHASES.filter((p) => p !== 'Cancelled' && p !== 'On Hold');
  const cancelledAndHold = ['Cancelled', 'On Hold'] as Phase[];

  // ── Kanban search — filters cards by customer name ────────────────────────
  const [kanbanSearchInput, setKanbanSearchInput] = useState('');
  const [kanbanDebouncedSearch, setKanbanDebouncedSearch] = useState('');
  const kanbanSearchRef = useRef<HTMLInputElement>(null);
  const kanbanHeaderRef = useRef<HTMLDivElement>(null);
  const kanbanBodyRef = useRef<HTMLDivElement>(null);

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
    activePhasesForKanban.find((phase) => kanbanFiltered.some((p) => p.phase === phase)) ??
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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
        <input
          ref={kanbanSearchRef}
          type="text"
          placeholder="Search projects..."
          value={kanbanSearchInput}
          onChange={(e) => setKanbanSearchInput(e.target.value)}
          className="w-full rounded-xl pl-9 pr-8 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-slate-500"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
        />
        {kanbanSearchInput && (
          <button
            onClick={() => { setKanbanSearchInput(''); setKanbanDebouncedSearch(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-white transition-colors"
            aria-label="Clear kanban search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {kanbanDebouncedSearch && (
        <p className="text-[var(--text-secondary)] text-xs mt-2">
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
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-[var(--surface-card)]"
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
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s?.dot ?? 'bg-[var(--text-muted)]'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${s?.text ?? 'text-[var(--text-secondary)]'}`}>{phase}</span>
                      <span className="bg-[var(--surface-card)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded-full font-medium">
                        {phaseProjects.length}
                      </span>
                    </div>
                    {!hideFinancials && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
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
                  className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Accordion body */}
              {isOpen && (
                <div className="px-3 pb-3 space-y-2 border-t border-[var(--border-subtle)]">
                  {phaseProjects.length === 0 && (
                    <div className="py-6 flex flex-col items-center text-center">
                      <FolderKanban className="w-6 h-6 text-[var(--text-dim)] mb-1.5 opacity-60" />
                      <p className="text-[var(--text-dim)] text-xs">No projects in this phase</p>
                    </div>
                  )}
                  {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => {
                    const myRole = !isAdmin
                      ? (proj.repId === currentRepId ? 'Closer' : proj.setterId === currentRepId ? 'Setter' : null)
                      : null;
                    const isMyCard = myRole !== null;
                    const commissionTotal = dealScope === 'mine'
                      ? (proj.repId === currentRepId
                          ? (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0)
                          : proj.setterId === currentRepId
                            ? (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0)
                            : 0)
                      : (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) + (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0);
                    return (
                      <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                      <div
                        className={`relative overflow-hidden bg-[var(--surface-card)]/60 border rounded-xl flex items-center justify-between gap-2 transition-all duration-200 group hover:translate-y-[-2px] hover:shadow-lg hover:shadow-blue-500/5 hover:border-[var(--accent-green)]/20 active:scale-[0.98] active:shadow-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-blue-500/30 after:to-transparent after:opacity-0 hover:after:opacity-100 after:transition-opacity ${
                          proj.flagged
                            ? 'border-l-2 border-l-red-500 border-[var(--border)]/60'
                            : isMyCard && dealScope === 'all'
                              ? 'border-[var(--border)]/60 border-l-[3px] border-l-blue-500'
                              : 'border-[var(--border)]/60'
                        }`}
                      >
                        <div className={`kanban-accent-bar absolute inset-x-0 top-0 h-[2px] rounded-t-xl bg-gradient-to-r ${PHASE_PILL[proj.phase]?.gradient || ''}`} />
                        {/* Card content — py-3 ensures at least 44px total height with text */}
                        <div className="flex-1 px-4 py-3 min-h-[44px]">
                          <p className="text-white text-sm font-medium leading-snug group-hover:text-[var(--accent-green)] transition-colors flex items-center gap-1.5 flex-wrap">
                            {proj.customerName}
                            {proj.flagged && (
                              <Flag className="w-3 h-3 text-red-400 flex-shrink-0" />
                            )}
                            <StaleBadge soldDate={proj.soldDate} phase={proj.phase} />
                            {/* Prominent "You" role pill next to customer name — shown in All Deals mode */}
                            {isMyCard && dealScope === 'all' && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none ${
                                myRole === 'Closer'
                                  ? 'bg-blue-900/60 text-[var(--accent-cyan)] border border-[var(--accent-green)]/40'
                                  : 'bg-emerald-900/60 text-emerald-300 border border-[var(--accent-green)]/40'
                              }`}>
                                You · {myRole}
                              </span>
                            )}
                          </p>
                          <p className="text-[var(--text-muted)] text-xs mt-0.5">
                            {proj.kWSize} kW · {proj.installer}
                          </p>
                          <p className={`text-xs ${isMyCard && dealScope === 'all' ? 'text-[var(--text-secondary)] font-semibold' : 'text-[var(--text-dim)]'}`}>
                            {proj.repName}
                          </p>
                          {/* Commission row */}
                          {!hideFinancials && (
                            <div className="flex items-center justify-end mt-1">
                              <span className="text-[var(--accent-green)]/70 text-[10px] font-medium tabular-nums">
                                ${commissionTotal.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Phase navigation — admin/PM; 44px touch targets */}
                        {canEditPhase && (prevPhase || nextPhase) && (
                          <div className="mr-3 flex gap-1.5 flex-shrink-0">
                            {prevPhase && (
                              <button
                                title={`Move back to ${prevPhase}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onPhaseChange(proj.id, prevPhase);
                                }}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[var(--border)] hover:bg-amber-600 text-[var(--text-secondary)] hover:text-white active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
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
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-[var(--border)] hover:bg-[var(--accent-green)] text-[var(--text-secondary)] hover:text-white active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
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
                      className="w-full text-center py-2 text-xs font-medium text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors"
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
        <div className="bg-[var(--surface)]/60 border border-[var(--border-subtle)]/60 rounded-xl overflow-hidden">
          <button
            onClick={() => setOffTrackOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 min-h-[52px] gap-3 text-left"
            aria-expanded={offTrackOpen}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-[var(--text-dim)] flex-shrink-0" />
              <span className="text-sm font-semibold text-[var(--text-muted)]">Off-Track</span>
              <span className="bg-[var(--surface-card)] text-[var(--text-muted)] text-xs px-2 py-0.5 rounded-full font-medium">
                {cancelledAndHold.reduce(
                  (acc, ph) => acc + kanbanFiltered.filter((p) => p.phase === ph).length,
                  0
                )}
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[var(--text-dim)] flex-shrink-0 transition-transform duration-200 ${
                offTrackOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {offTrackOpen && (
            <div className="px-3 pb-3 border-t border-[var(--border-subtle)]/60 space-y-3">
              {cancelledAndHold.map((phase) => {
                const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
                if (phaseProjects.length === 0) return null;
                return (
                  <div key={phase}>
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider px-1 pt-3 pb-1">
                      {phase}
                    </p>
                    <div className="space-y-2">
                      {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => (
                        <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                          <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/40 hover:border-[var(--border)] rounded-xl px-4 min-h-[44px] flex items-center opacity-70 hover:opacity-100 transition-all">
                            <div className="py-3">
                              <p className="text-[var(--text-secondary)] text-sm font-medium">{proj.customerName}</p>
                              <p className="text-[var(--text-dim)] text-xs">
                                {proj.kWSize} kW · {proj.installer}
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))}
                      {phaseProjects.length > KANBAN_CARD_LIMIT && (
                        <button
                          onClick={() => toggleExpand(phase)}
                          className="w-full text-center py-2 text-xs font-medium text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors"
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
      {/* Sticky header row — outside overflow-x-auto so sticky top-0 is relative to page scroll,
          not the horizontal scroll container. Scrolls horizontally in sync with the body via ref. */}
      <div
        ref={kanbanHeaderRef}
        className="sticky top-0 z-20 overflow-x-hidden"
        style={{ background: 'var(--navy-base)' }}
      >
        <div className="flex gap-4 pb-1">
          {activePhasesForKanban.map((phase) => {
            const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
            return (
              <div key={phase} className="flex-shrink-0 w-52">
                <div className="backdrop-blur-sm px-2 py-1.5 rounded-lg" style={{ background: `${PHASE_COLORS[phase] ?? 'var(--text-muted)'}12`, border: `1px solid ${PHASE_COLORS[phase] ?? 'var(--text-muted)'}30` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: PHASE_COLORS[phase] ?? 'var(--text-muted)' }}>{phase}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-card)', color: 'var(--text-muted)' }}>
                      {phaseProjects.length}
                    </span>
                  </div>
                  {!hideFinancials && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      ${phaseProjects.reduce((sum, p) => {
                        if (dealScope === 'mine') {
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
            );
          })}
        </div>
      </div>
      <div
        ref={kanbanBodyRef}
        className="flex gap-4 overflow-x-auto [overflow-y:clip] snap-x snap-mandatory pb-4"
        onScroll={() => {
          if (kanbanHeaderRef.current && kanbanBodyRef.current) {
            kanbanHeaderRef.current.scrollLeft = kanbanBodyRef.current.scrollLeft;
          }
        }}
      >
        {activePhasesForKanban.map((phase) => {
          const phaseProjects = kanbanFiltered.filter((p) => p.phase === phase);
          // Next phase in the pipeline (undefined for PTO — the last active phase).
          const phaseIdx = activePhasesForKanban.indexOf(phase);
          const nextPhase = activePhasesForKanban[phaseIdx + 1] as Phase | undefined;
          const prevPhase = activePhasesForKanban[phaseIdx - 1] as Phase | undefined;
          return (
            <div key={phase} className={`flex-shrink-0 w-52 snap-start kanban-col-enter kanban-col-${phaseIdx}`}>
              {/* Scrollable card container with bottom-fade overflow hint */}
              <div className="relative">
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {phaseProjects.length === 0 && (
                    <div className="bg-[var(--surface)]/40 border border-dashed border-[var(--border-subtle)] rounded-xl p-4 flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-full bg-[var(--surface-card)]/80 flex items-center justify-center mb-2">
                        <FolderKanban className="w-5 h-5 text-[var(--text-dim)] opacity-60 animate-pulse" />
                      </div>
                      <p className="text-[var(--text-secondary)] text-xs font-semibold">{phase}</p>
                      <p className="text-[var(--text-dim)] text-xs mt-0.5">No projects here</p>
                    </div>
                  )}
                  {(expandedColumns.has(phase) ? phaseProjects.slice(0, KANBAN_EXPANDED_MAX) : phaseProjects.slice(0, KANBAN_CARD_LIMIT)).map((proj) => {
                    const myRole = !isAdmin
                      ? (proj.repId === currentRepId ? 'Closer' : proj.setterId === currentRepId ? 'Setter' : null)
                      : null;
                    const isMyCard = myRole !== null;
                    const commissionTotal = dealScope === 'mine'
                      ? (proj.repId === currentRepId
                          ? (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0)
                          : proj.setterId === currentRepId
                            ? (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0)
                            : 0)
                      : (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) + (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0);
                    return (
                      <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} onClick={saveProjectNav}>
                      <div
                        className={`relative overflow-hidden rounded-xl p-3 cursor-pointer transition-all duration-200 group hover:translate-y-[-2px] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] active:shadow-none ${
                          proj.flagged ? '' : ''
                        }`}
                        style={{
                          background: 'var(--surface)',
                          border: `1px solid var(--border)`,
                          borderLeft: proj.flagged
                            ? '3px solid var(--accent-red)'
                            : isMyCard && dealScope === 'all'
                              ? '3px solid var(--accent-blue)'
                              : `3px solid ${PHASE_COLORS[proj.phase] ?? 'var(--border)'}`,
                        }}
                      >
                        <div className={`kanban-accent-bar absolute inset-x-0 top-0 h-[2px] rounded-t-xl bg-gradient-to-r ${PHASE_PILL[proj.phase]?.gradient || ''}`} />
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <p className="text-white text-xs font-medium leading-tight group-hover:text-[var(--accent-green)] transition-colors">
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
                              ? 'bg-blue-900/60 text-[var(--accent-cyan)] border border-[var(--accent-green)]/40'
                              : 'bg-emerald-900/60 text-emerald-300 border border-[var(--accent-green)]/40'
                          }`}>
                            You · {myRole}
                          </span>
                        )}
                        <p className="text-[var(--text-muted)] text-xs">{proj.kWSize} kW</p>
                        <p className="text-[var(--text-muted)] text-xs">{proj.installer}</p>
                        <p className={`text-xs ${isMyCard && dealScope === 'all' ? 'text-[var(--text-secondary)] font-semibold' : 'text-[var(--text-dim)]'}`}>
                          {proj.repName}
                        </p>
                        {/* Mini commission preview + phase nav row */}
                        {!hideFinancials && (
                          <div className="flex items-center mt-1.5 justify-end">
                            <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--accent-green)', fontFamily: "'DM Serif Display', serif" }}>
                              ${commissionTotal.toLocaleString()}
                            </span>
                          </div>
                        )}

                        {/* Phase navigation — admin/PM, shows on hover */}
                        {canEditPhase && (prevPhase || nextPhase) && (
                          <div className="flex gap-1 justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {prevPhase && (
                              <button
                                title={`Move back to ${prevPhase}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onPhaseChange(proj.id, prevPhase);
                                }}
                                className="p-1 rounded-md bg-[var(--border)] hover:bg-amber-600 text-[var(--text-secondary)] hover:text-white active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
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
                                className="p-1 rounded-md bg-[var(--border)] hover:bg-[var(--accent-green)] text-[var(--text-secondary)] hover:text-white active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
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
                      className="w-full text-center py-1.5 text-[10px] font-medium text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors"
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
              <div className="sticky top-0 z-10 backdrop-blur-sm pb-2 mb-1 px-2 py-1.5 rounded-lg" style={{ background: `${PHASE_COLORS[phase] ?? 'var(--text-muted)'}12`, border: `1px solid ${PHASE_COLORS[phase] ?? 'var(--text-muted)'}30` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: PHASE_COLORS[phase] ?? 'var(--text-muted)' }}>{phase}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-card)', color: 'var(--text-muted)' }}>
                    {phaseProjects.length}
                  </span>
                </div>
                {!hideFinancials && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    ${phaseProjects.reduce((sum, p) => {
                      if (dealScope === 'mine') {
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
                      <div className="relative rounded-xl p-3 cursor-pointer opacity-70 hover:opacity-100 transition-all duration-200 hover:translate-y-[-2px] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] active:shadow-none" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${PHASE_COLORS[phase] ?? 'var(--text-dim)'}` }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{proj.customerName}</p>
                        <p className="text-[var(--text-dim)] text-xs">{proj.kWSize} kW · {proj.installer}</p>
                      </div>
                    </Link>
                  ))}
                  {/* "Show all / Show less" toggle when column exceeds card limit */}
                  {phaseProjects.length > KANBAN_CARD_LIMIT && (
                    <button
                      onClick={() => toggleExpand(phase)}
                      className="w-full text-center py-1.5 text-[10px] font-medium text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors"
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
