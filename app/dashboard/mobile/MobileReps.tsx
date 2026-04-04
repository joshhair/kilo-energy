'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { Search, Plus, Users } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileEmptyState from './shared/MobileEmptyState';

const ROLE_LABELS = { closer: 'Closer', setter: 'Setter', both: 'Both' } as const;
const ROLE_BADGE_CLS = {
  closer: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  setter: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  both: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
} as const;

const FILTER_TABS = [
  { value: 'all', label: 'All' },
  { value: 'closer', label: 'Closers' },
  { value: 'setter', label: 'Setters' },
  { value: 'both', label: 'Both' },
] as const;
type FilterTab = typeof FILTER_TABS[number]['value'];

const PIPELINE_EXCLUDED: ReadonlySet<string> = new Set(['Cancelled', 'On Hold', 'Completed']);

export default function MobileReps() {
  const router = useRouter();
  const { currentRole, effectiveRole, projects, payrollEntries, reps } = useApp();

  const isAdmin = currentRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  // Debounce search
  useEffect(() => {
    const delay = search === '' ? 0 : 200;
    const timer = setTimeout(() => setDebouncedSearch(search), delay);
    return () => clearTimeout(timer);
  }, [search]);

  // Active deals count per rep
  const activeDealsByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      if (PIPELINE_EXCLUDED.has(p.phase)) continue;
      map.set(p.repId, (map.get(p.repId) ?? 0) + 1);
      if (p.setterId && p.setterId !== p.repId) {
        map.set(p.setterId, (map.get(p.setterId) ?? 0) + 1);
      }
    }
    return map;
  }, [projects]);

  // kW sold per rep
  const kwByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      const kw = p.kWSize ?? 0;
      map.set(p.repId, (map.get(p.repId) ?? 0) + kw);
      if (p.setterId && p.setterId !== p.repId) {
        map.set(p.setterId, (map.get(p.setterId) ?? 0) + kw);
      }
    }
    return map;
  }, [projects]);

  // Total paid per rep
  const paidByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const pe of payrollEntries) {
      if (pe.status === 'Paid') {
        map.set(pe.repId, (map.get(pe.repId) ?? 0) + pe.amount);
      }
    }
    return map;
  }, [payrollEntries]);

  const filtered = useMemo(() => {
    return reps.filter((r) => {
      if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (filterTab === 'all') return true;
      if (filterTab === 'both') return r.repType === 'both';
      return r.repType === filterTab || r.repType === 'both';
    });
  }, [reps, debouncedSearch, filterTab]);

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  };

  return (
    <div className="px-4 pt-3 pb-24">
      <MobilePageHeader
        title="Reps"
        right={
          isAdmin ? (
            <button
              onClick={() => router.push('/dashboard/reps?add=true')}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white active:bg-blue-700 transition-colors"
              aria-label="Add rep"
            >
              <Plus className="w-5 h-5" />
            </button>
          ) : null
        }
      />

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search reps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[44px] pl-10 pr-4 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {FILTER_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilterTab(t.value)}
            className={`min-h-[36px] px-4 py-1.5 text-xs font-semibold rounded-full border whitespace-nowrap transition-colors ${
              filterTab === t.value
                ? 'bg-blue-600/20 text-blue-400 border-blue-500/30'
                : 'bg-slate-800/40 text-slate-400 border-slate-700/30 active:bg-slate-700/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Rep count */}
      <p className="text-xs text-slate-500 mb-2">{filtered.length} rep{filtered.length !== 1 ? 's' : ''}</p>

      {/* Rep cards */}
      {filtered.length === 0 ? (
        <MobileEmptyState icon={Users} title="No reps found" subtitle="Try adjusting your search or filter" />
      ) : (
        <div className="space-y-2">
          {filtered.map((rep) => {
            const deals = activeDealsByRep.get(rep.id) ?? 0;
            const kw = kwByRep.get(rep.id) ?? 0;
            const paid = paidByRep.get(rep.id) ?? 0;

            return (
              <MobileCard key={rep.id} onTap={() => router.push(`/dashboard/reps/${rep.id}`)}>
                <div className="flex items-center gap-3">
                  {/* Initials circle */}
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white text-sm font-bold shrink-0">
                    {getInitials(rep.name)}
                  </div>

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm truncate">{rep.name}</p>
                    {rep.email && (
                      <p className="text-xs text-slate-500 truncate">{rep.email}</p>
                    )}
                  </div>

                  {/* Rep type badge */}
                  <span className={`inline-flex items-center min-h-[28px] px-3 py-1 text-[11px] font-semibold rounded-full ${ROLE_BADGE_CLS[rep.repType]}`}>
                    {ROLE_LABELS[rep.repType]}
                  </span>
                </div>

                {/* Stats row — admin sees deals, kW, total paid; PM sees deals + kW only */}
                {(isAdmin || isPM) && (
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-800/40">
                    <div>
                      <p className="text-[11px] text-slate-500">Deals</p>
                      <p className="text-sm font-semibold text-white">{deals}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">kW</p>
                      <p className="text-sm font-semibold text-white">{kw.toFixed(1)}</p>
                    </div>
                    {isAdmin && (
                      <div>
                        <p className="text-[11px] text-slate-500">Paid</p>
                        <p className="text-sm font-semibold text-white">${paid.toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                )}
              </MobileCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
