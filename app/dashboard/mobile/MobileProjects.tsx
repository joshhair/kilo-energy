'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { Phase } from '../../../lib/data';
import { Search, Plus } from 'lucide-react';
import { applyStatusFilter, type StatusFilter } from '../projects/components/shared';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import { fmtCompact$ } from '../../../lib/utils';
import { myCommissionOnProject, type CommissionStatus } from '../../../lib/commissionHelpers';

// Color per commission status — aligns with hero colors used elsewhere.
const COMMISSION_COLORS: Record<CommissionStatus, { fg: string; bg: string; label: string }> = {
  paid:      { fg: 'var(--accent-emerald)', bg: 'rgba(0,229,160,0.12)',  label: 'Paid' },
  partial:   { fg: 'var(--accent-amber)', bg: 'rgba(255,176,32,0.12)', label: 'Partial' },
  projected: { fg: 'var(--text-secondary)', bg: 'rgba(194,200,216,0.08)', label: 'Projected' },
};

const PHASE_FILTERS: (Phase | 'All')[] = [
  'All',
  'New',
  'Acceptance',
  'Site Survey',
  'Design',
  'Permitting',
  'Pending Install',
  'Installed',
  'PTO',
  'Completed',
  'On Hold',
  'Cancelled',
];

// Sort modes match the desktop table view so users get consistent
// ordering between devices. Default matches prior mobile behavior:
// sold-desc (newest first).
type SortMode = 'soldDesc' | 'soldAsc' | 'customer' | 'kWDesc' | 'kWAsc';
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'soldDesc', label: 'Newest first' },
  { value: 'soldAsc',  label: 'Oldest first' },
  { value: 'customer', label: 'Customer A→Z' },
  { value: 'kWDesc',   label: 'kW (high→low)' },
  { value: 'kWAsc',    label: 'kW (low→high)' },
];

function relativeTime(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const past = new Date(year, month - 1, day);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export default function MobileProjects() {
  const { effectiveRole, effectiveRepId, projects, payrollEntries } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isSubDealer = effectiveRole === 'sub-dealer';
  const isPM = effectiveRole === 'project_manager';
  const isRep = effectiveRole !== 'admin' && !isPM;

  // Initial values read from URL so filters survive project-detail round trips,
  // matching desktop Projects page behaviour.
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q') ?? '');
  const [phaseFilter, setPhaseFilter] = useState<Phase | 'All'>(() => {
    const v = searchParams.get('phase');
    return v && (PHASE_FILTERS as readonly string[]).includes(v) ? (v as Phase | 'All') : 'All';
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const v = searchParams.get('status') as StatusFilter | null;
    return v && ['active', 'all', 'completed', 'cancelled', 'on-hold', 'inactive'].includes(v) ? v : 'active';
  });
  const [dealScope, setDealScope] = useState<'mine' | 'all'>(() => {
    const v = searchParams.get('scope');
    if (v === 'mine' || v === 'all') return v;
    return 'all';
  });
  const didInitDealScope = useRef(false);
  const [installerFilter, setInstallerFilter] = useState<string>(() => searchParams.get('installer') ?? '');
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const v = searchParams.get('sort');
    return v && SORT_OPTIONS.some((o) => o.value === v) ? (v as SortMode) : 'soldDesc';
  });

  // Re-initialise dealScope once effectiveRole resolves from null on first hydration.
  useEffect(() => {
    if (!didInitDealScope.current && effectiveRole !== null) {
      didInitDealScope.current = true;
      const scopeParam = searchParams.get('scope');
      if (scopeParam === 'mine' || scopeParam === 'all') return;
      setDealScope(effectiveRole !== 'admin' && effectiveRole !== 'project_manager' ? 'mine' : 'all');
    }
  }, [effectiveRole, searchParams]);

  // Persist filters to URL — fires only after debounce lands so keystrokes
  // don't spam router.replace.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (debouncedSearch) params.set('q', debouncedSearch); else params.delete('q');
    if (phaseFilter !== 'All') params.set('phase', phaseFilter); else params.delete('phase');
    if (installerFilter) params.set('installer', installerFilter); else params.delete('installer');
    if (sortMode !== 'soldDesc') params.set('sort', sortMode); else params.delete('sort');
    if (statusFilter !== 'active') params.set('status', statusFilter); else params.delete('status');
    if (dealScope === 'mine') params.set('scope', 'mine'); else params.delete('scope');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/dashboard/projects', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, phaseFilter, installerFilter, sortMode, statusFilter, dealScope]);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [spotlight, setSpotlight] = useState<{ left: number; width: number } | null>(null);
  const [listKey, setListKey] = useState(0);

  useEffect(() => {
    const delay = search === '' ? 0 : 300;
    const timer = setTimeout(() => setDebouncedSearch(search), delay);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const activeIndex = PHASE_FILTERS.indexOf(phaseFilter);
    const el = pillRefs.current[activeIndex];
    if (el) {
      setSpotlight({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [phaseFilter]);

  useEffect(() => {
    setListKey((k) => k + 1);
  }, [phaseFilter, debouncedSearch]);

  const visibleProjects = useMemo(() => {
    const isOnDeal = (p: typeof projects[0]) =>
      p.repId === effectiveRepId
      || p.setterId === effectiveRepId
      || p.trainerId === effectiveRepId
      || !!p.additionalClosers?.some((c) => c.userId === effectiveRepId)
      || !!p.additionalSetters?.some((s) => s.userId === effectiveRepId);

    if (effectiveRole === 'admin' || effectiveRole === 'project_manager') {
      return dealScope === 'mine' ? projects.filter(isOnDeal) : projects;
    }
    if (isSubDealer) return projects.filter((p) => p.subDealerId === effectiveRepId || p.repId === effectiveRepId);
    // Trainer (per-project override) + co-closer/co-setter must appear
    // in the rep's list too — same logic desktop uses. Matches the
    // "isOnDeal" helper in app/dashboard/projects/page.tsx so both
    // devices show the exact same set of projects for a given rep.
    return projects.filter(isOnDeal);
  }, [effectiveRole, effectiveRepId, projects, isSubDealer, dealScope]);

  const phaseCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const p of visibleProjects) acc[p.phase] = (acc[p.phase] ?? 0) + 1;
    return acc;
  }, [visibleProjects]);

  // Unique installer names present on visible projects — keeps the
  // dropdown scoped to what's actually shown rather than listing every
  // installer in the catalog.
  const installerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of visibleProjects) if (p.installer) set.add(p.installer);
    return Array.from(set).sort();
  }, [visibleProjects]);

  const filtered = useMemo(() => {
    let result = visibleProjects;

    result = applyStatusFilter(result, statusFilter);

    if (phaseFilter !== 'All') {
      result = result.filter((p) => p.phase === phaseFilter);
    }

    if (installerFilter) {
      result = result.filter((p) => p.installer === installerFilter);
    }

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((p) =>
        p.customerName.toLowerCase().includes(q) ||
        (p.repName ?? '').toLowerCase().includes(q) ||
        (p.setterName ?? '').toLowerCase().includes(q) ||
        p.phase.toLowerCase().includes(q) ||
        p.installer.toLowerCase().includes(q)
      );
    }

    const sorted = [...result];
    switch (sortMode) {
      case 'soldAsc':  sorted.sort((a, b) => a.soldDate.localeCompare(b.soldDate)); break;
      case 'customer': sorted.sort((a, b) => a.customerName.localeCompare(b.customerName)); break;
      case 'kWDesc':   sorted.sort((a, b) => b.kWSize - a.kWSize); break;
      case 'kWAsc':    sorted.sort((a, b) => a.kWSize - b.kWSize); break;
      case 'soldDesc':
      default:         sorted.sort((a, b) => b.soldDate.localeCompare(a.soldDate));
    }
    return sorted;
  }, [visibleProjects, phaseFilter, statusFilter, installerFilter, debouncedSearch, sortMode]);

  // "Are any non-default filters active?" — drives the empty-state CTA:
  // if yes, show Clear Filters; otherwise show Submit Deal.
  const hasActiveFilters = phaseFilter !== 'All' || !!installerFilter || !!debouncedSearch || statusFilter !== 'active' || dealScope !== (isRep ? 'mine' : 'all');

  // Average days in each phase (based on days since sold for all projects in that phase)
  const phaseAvgDays = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const acc: Record<string, { total: number; count: number }> = {};
    const terminalPhases = ['Cancelled', 'Completed', 'PTO'];
    for (const p of visibleProjects) {
      if (terminalPhases.includes(p.phase)) continue;
      const phaseStart = p.phaseChangedAt ? new Date(p.phaseChangedAt) : (() => { const [y, m, d] = p.soldDate.split('-').map(Number); return new Date(y, m - 1, d); })();
      const days = Math.max(0, Math.floor((now.getTime() - phaseStart.getTime()) / 86400000));
      if (!acc[p.phase]) acc[p.phase] = { total: 0, count: 0 };
      acc[p.phase].total += days;
      acc[p.phase].count += 1;
    }
    const result: Record<string, number> = {};
    for (const [phase, { total, count }] of Object.entries(acc)) {
      result[phase] = Math.round(total / count);
    }
    return result;
  }, [visibleProjects]);

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Projects" />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="w-full min-h-[48px] rounded-2xl px-4 pl-10 text-base text-white outline-none transition-colors"
          style={{
            background: 'var(--m-card, var(--surface-mobile-card))',
            border: '1px solid var(--m-border, var(--border-mobile))',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        />
      </div>

      {/* Installer + Sort dropdowns — parity with desktop Projects page.
          Shown as compact selects side-by-side to keep vertical space tight
          on phone. Installer select only renders when there's more than one
          to choose from. */}
      <div className="flex gap-2">
        {installerOptions.length > 1 && (
          <select
            value={installerFilter}
            onChange={(e) => setInstallerFilter(e.target.value)}
            className="flex-1 min-h-[44px] rounded-xl px-3 text-sm text-white outline-none appearance-none"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            <option value="">All installers</option>
            {installerOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="flex-1 min-h-[44px] rounded-xl px-3 text-sm text-white outline-none appearance-none"
          style={{
            background: 'var(--m-card, var(--surface-mobile-card))',
            border: '1px solid var(--m-border, var(--border-mobile))',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* My Deals / All Deals toggle — admin/PM only */}
      {!isRep && (
        <div className="flex gap-0.5 rounded-xl p-1 self-start" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
          {(['all', 'mine'] as const).map((scope) => (
            <button
              key={scope}
              onClick={() => setDealScope(scope)}
              className="min-h-[40px] px-4 rounded-lg text-sm font-semibold transition-all duration-150"
              style={dealScope === scope
                ? {
                    background: 'linear-gradient(135deg, rgba(0, 224, 122, 0.18), rgba(0, 196, 240, 0.18))',
                    border: '1px solid rgba(0, 224, 122, 0.45)',
                    color: '#fff',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }
                : {
                    border: '1px solid transparent',
                    color: 'var(--m-text-muted, var(--text-mobile-muted))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }
              }
            >
              {scope === 'all' ? 'All Deals' : 'My Deals'}
            </button>
          ))}
        </div>
      )}

      {/* Phase filter pills */}
      <div className="relative flex gap-2 overflow-x-auto scrollbar-hide -mx-5 px-5">
        {spotlight && (
          <div
            className="absolute top-0 rounded-xl pointer-events-none phase-spotlight"
            style={{
              // `left: 0` anchors the spotlight to the flex container's
              // content-box origin so the subsequent translateX(offsetLeft)
              // is the sole positional driver. Without this, the spotlight's
              // static position is determined by flex flow (which equals the
              // container's left padding), and the translateX gets added on
              // top — shifting the highlight ~20px right and landing it on
              // the wrong button.
              left: 0,
              height: 36,
              background: 'var(--accent-emerald)',
              transform: `translateX(${spotlight.left}px)`,
              width: spotlight.width,
              transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), width 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              willChange: 'transform, width',
            }}
          />
        )}
        {PHASE_FILTERS.map((phase, i) => {
          const isActive = phaseFilter === phase;
          return (
            <button
              key={phase}
              ref={el => { pillRefs.current[i] = el; }}
              onClick={() => setPhaseFilter(phase)}
              className="relative z-10 shrink-0 min-h-[44px] px-4 rounded-xl text-sm font-medium active:scale-[0.92]"
              style={{
                background: 'transparent',
                color: isActive ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                border: isActive ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                transition: 'color 200ms ease, transform 75ms cubic-bezier(0.34,1.56,0.64,1)',
              }}
            >
              {phase}
              {phase !== 'All' && (phaseCounts[phase] ?? 0) > 0 && (
                <span style={{
                  background: isActive ? 'rgba(0,0,0,0.2)' : 'var(--m-border, var(--border-mobile))',
                  color: isActive ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                  borderRadius: 999,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '1px 5px',
                  marginLeft: 5,
                  lineHeight: 1.5,
                  display: 'inline-block',
                  animation: 'scalePop 200ms cubic-bezier(0.34,1.56,0.64,1) both',
                }}>{phaseCounts[phase]}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Project cards */}
      <div key={listKey} className="space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 px-6 text-center">
            {/* Simple folder illustration — matches the visual
                language used in the desktop Projects empty state. */}
            <svg width="72" height="72" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
              <rect x="10" y="24" width="60" height="44" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
              <path d="M10 24 L30 24 L36 18 L70 18 L70 32 L10 32 Z" fill="#0f172a" stroke="#334155" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            {hasActiveFilters ? (
              <>
                <p className="text-base font-semibold text-white">No projects match your filters</p>
                <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                  Try a different phase, installer, or clear your search.
                </p>
                <button
                  onClick={() => { setPhaseFilter('All'); setInstallerFilter(''); setSearch(''); setSortMode('soldDesc'); setStatusFilter('active'); setDealScope(isRep ? 'mine' : 'all'); }}
                  className="mt-2 min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--m-border, var(--border-mobile))' }}
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-white">No projects yet</p>
                <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                  {effectiveRole === 'admin' || effectiveRole === 'project_manager'
                    ? 'Projects will appear here once deals are submitted.'
                    : 'Submit your first deal to get started.'}
                </p>
                {(effectiveRole === 'rep' || effectiveRole === 'sub-dealer') && (
                  <Link
                    href="/dashboard/new-deal"
                    className="mt-2 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl text-sm font-semibold"
                    style={{
                      background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))',
                      color: '#050d18',
                    }}
                  >
                    <Plus className="w-4 h-4" />
                    Submit a deal
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          filtered.map((project, index) => {
            const showCommission = !isPM && (effectiveRole === 'rep' || effectiveRole === 'sub-dealer');
            const commission = showCommission
              ? myCommissionOnProject(project, effectiveRepId, effectiveRole, payrollEntries)
              : null;
            const pill = commission && commission.total > 0 ? COMMISSION_COLORS[commission.status] : null;

            return (
              <MobileCard
                key={project.id}
                onTap={() => router.push(`/dashboard/projects/${project.id}`)}
                className="animate-card-enter"
                style={{ '--card-index': Math.min(index, 6) } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{project.customerName}</span>
                    {project.flagged && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                  </div>
                  <MobileBadge value={project.phase} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base min-w-0 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {project.installer} &middot; {project.kWSize} kW &middot; {relativeTime(project.soldDate)}
                  </p>
                  {pill && (
                    <span
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg tabular-nums font-bold"
                      style={{
                        background: pill.bg,
                        color: pill.fg,
                        fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                        fontSize: '0.875rem',
                        lineHeight: 1,
                      }}
                      title={`${pill.label} · ${commission!.total.toLocaleString()}`}
                    >
                      {fmtCompact$(commission!.total)}
                    </span>
                  )}
                </div>
                {phaseAvgDays[project.phase] !== undefined && (
                  <p style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.85rem', marginTop: 2 }}>
                    Phase avg: {phaseAvgDays[project.phase]}d
                  </p>
                )}
              </MobileCard>
            );
          })
        )}
      </div>
    </div>
  );
}
