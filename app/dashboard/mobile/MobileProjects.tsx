'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { Phase } from '../../../lib/data';
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
          filtered.map((project) => (
            <MobileCard
              key={project.id}
              onTap={() => router.push(`/dashboard/projects/${project.id}`)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{project.customerName}</span>
                  {project.flagged && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                </div>
                <MobileBadge value={project.phase} />
              </div>
              <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                {project.installer} &middot; {project.kWSize} kW &middot; {relativeTime(project.soldDate)}
              </p>
            </MobileCard>
          ))
        )}
      </div>
    </div>
  );
}
