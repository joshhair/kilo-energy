'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { Phase } from '../../../lib/data';
import { Search } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import { fmtCompact$ } from '../../../lib/utils';
import { myCommissionOnProject, type CommissionStatus } from '../../../lib/commissionHelpers';

// Color per commission status — aligns with hero colors used elsewhere.
const COMMISSION_COLORS: Record<CommissionStatus, { fg: string; bg: string; label: string }> = {
  paid:      { fg: '#00e5a0', bg: 'rgba(0,229,160,0.12)',  label: 'Paid' },
  partial:   { fg: '#ffb020', bg: 'rgba(255,176,32,0.12)', label: 'Partial' },
  projected: { fg: '#c2c8d8', bg: 'rgba(194,200,216,0.08)', label: 'Projected' },
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

  const isSubDealer = effectiveRole === 'sub-dealer';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<Phase | 'All'>('All');

  useEffect(() => {
    const delay = search === '' ? 0 : 300;
    const timer = setTimeout(() => setDebouncedSearch(search), delay);
    return () => clearTimeout(timer);
  }, [search]);

  const visibleProjects = useMemo(() => {
    if (effectiveRole === 'admin' || effectiveRole === 'project_manager') return projects;
    if (isSubDealer) return projects.filter((p) => p.subDealerId === effectiveRepId || p.repId === effectiveRepId);
    return projects.filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId);
  }, [effectiveRole, effectiveRepId, projects, isSubDealer]);

  const filtered = useMemo(() => {
    let result = visibleProjects;

    if (phaseFilter !== 'All') {
      result = result.filter((p) => p.phase === phaseFilter);
    }

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((p) => p.customerName.toLowerCase().includes(q));
    }

    return [...result].sort((a, b) => b.soldDate.localeCompare(a.soldDate));
  }, [visibleProjects, phaseFilter, debouncedSearch]);

  // Average days in each phase (based on days since sold for all projects in that phase)
  const phaseAvgDays = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const acc: Record<string, { total: number; count: number }> = {};
    const terminalPhases = ['Cancelled', 'Completed', 'PTO'];
    for (const p of visibleProjects) {
      if (terminalPhases.includes(p.phase)) continue;
      const [y, m, d] = p.soldDate.split('-').map(Number);
      const sold = new Date(y, m - 1, d);
      const days = Math.max(0, Math.floor((now.getTime() - sold.getTime()) / 86400000));
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
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--m-text-muted, #8899aa)' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="w-full min-h-[48px] rounded-2xl px-4 pl-10 text-base text-white outline-none transition-colors"
          style={{
            background: 'var(--m-card, #0d1525)',
            border: '1px solid var(--m-border, #1a2840)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        />
      </div>

      {/* Phase filter pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-5 px-5">
        {PHASE_FILTERS.map((phase) => {
          const isActive = phaseFilter === phase;
          return (
            <button
              key={phase}
              onClick={() => setPhaseFilter(phase)}
              className="shrink-0 min-h-[36px] px-4 rounded-xl text-base font-medium transition-colors"
              style={{
                background: isActive ? '#00e5a0' : 'var(--m-card, #0d1525)',
                color: isActive ? '#000' : 'var(--m-text-muted, #8899aa)',
                border: isActive ? 'none' : '1px solid var(--m-border, #1a2840)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {phase}
            </button>
          );
        })}
      </div>

      {/* Project cards */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No projects found</p>
          </div>
        ) : (
          filtered.map((project, index) => {
            const showCommission = effectiveRole === 'rep' || effectiveRole === 'sub-dealer';
            const commission = showCommission
              ? myCommissionOnProject(project, effectiveRepId, effectiveRole, payrollEntries)
              : null;
            const pill = commission && commission.total > 0 ? COMMISSION_COLORS[commission.status] : null;

            return (
              <MobileCard
                key={project.id}
                onTap={() => router.push(`/dashboard/projects/${project.id}`)}
                className="animate-card-enter"
                style={{ '--card-index': Math.min(index, 10) } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{project.customerName}</span>
                    {project.flagged && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                  </div>
                  <MobileBadge value={project.phase} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base min-w-0 truncate" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
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
