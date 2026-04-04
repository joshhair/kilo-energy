'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { ACTIVE_PHASES, Phase } from '../../../lib/data';
import { Search } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';

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

/** Returns a human-readable relative time string. */
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
  const { effectiveRole, effectiveRepId, projects } = useApp();
  const router = useRouter();

  const isRep = effectiveRole !== 'admin' && effectiveRole !== 'project_manager';
  const isSubDealer = effectiveRole === 'sub-dealer';
  const isPM = effectiveRole === 'project_manager';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<Phase | 'All'>('All');

  // Debounce search
  useEffect(() => {
    const delay = search === '' ? 0 : 300;
    const timer = setTimeout(() => setDebouncedSearch(search), delay);
    return () => clearTimeout(timer);
  }, [search]);

  // Filter projects by role — same logic as desktop
  const visibleProjects = useMemo(() => {
    if (effectiveRole === 'admin' || effectiveRole === 'project_manager') return projects;
    if (isSubDealer) return projects.filter((p) => p.subDealerId === effectiveRepId || p.repId === effectiveRepId);
    return projects.filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId);
  }, [effectiveRole, effectiveRepId, projects, isSubDealer]);

  // Apply phase + search filters, then sort by soldDate desc
  const filtered = useMemo(() => {
    let result = visibleProjects;

    // Phase filter
    if (phaseFilter !== 'All') {
      result = result.filter((p) => p.phase === phaseFilter);
    }

    // Search by customerName
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((p) => p.customerName.toLowerCase().includes(q));
    }

    // Sort by soldDate desc
    return [...result].sort((a, b) => b.soldDate.localeCompare(a.soldDate));
  }, [visibleProjects, phaseFilter, debouncedSearch]);

  return (
    <div className="px-4 pt-3 pb-24 space-y-4">
      <MobilePageHeader title="Projects" />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Phase filter pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4">
        {PHASE_FILTERS.map((phase) => (
          <button
            key={phase}
            onClick={() => setPhaseFilter(phase)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              phaseFilter === phase
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800/60 text-slate-400 active:bg-slate-700/60'
            }`}
          >
            {phase}
          </button>
        ))}
      </div>

      {/* Project cards */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500 text-sm">No projects found</p>
          </div>
        ) : (
          filtered.map((project) => (
            <MobileCard
              key={project.id}
              accent={project.flagged ? 'red' : undefined}
              onTap={() => router.push(`/dashboard/projects/${project.id}`)}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-medium text-white truncate mr-2">{project.customerName}</p>
                <MobileBadge value={project.phase} variant="phase" />
              </div>
              <p className="text-xs text-slate-500">
                {project.installer} &middot; {project.kWSize} kW &middot; {relativeTime(project.soldDate)}
              </p>
            </MobileCard>
          ))
        )}
      </div>
    </div>
  );
}
