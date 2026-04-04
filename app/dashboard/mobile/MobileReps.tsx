'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { Search, Plus, Users } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

const ROLE_LABELS: Record<string, string> = { closer: 'Closer', setter: 'Setter', both: 'Both' };
const PIPELINE_EXCLUDED: ReadonlySet<string> = new Set(['Cancelled', 'On Hold', 'Completed']);

export default function MobileReps() {
  const router = useRouter();
  const { currentRole, effectiveRole, projects, payrollEntries, reps, addRep } = useApp();
  const { toast } = useToast();

  const isAdmin = currentRole === 'admin';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showAddRep, setShowAddRep] = useState(false);
  const [addForm, setAddForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    repType: 'closer' as 'closer' | 'setter' | 'both',
  });

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
      return true;
    });
  }, [reps, debouncedSearch]);

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0]?.[0] ?? '?').toUpperCase();
  };

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader
        title="Reps"
        right={
          isAdmin ? (
            <button
              onClick={() => setShowAddRep(true)}
              className="flex items-center justify-center w-10 h-10 rounded-2xl bg-blue-600 text-white active:bg-blue-700 transition-colors"
              aria-label="Add rep"
            >
              <Plus className="w-5 h-5" />
            </button>
          ) : null
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search reps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[48px] pl-10 pr-4 py-2.5 bg-slate-800/40 rounded-2xl text-base text-white placeholder:text-slate-400 focus:outline-none transition-colors"
        />
      </div>

      {/* Rep list */}
      {filtered.length === 0 ? (
        <MobileEmptyState icon={Users} title="No reps found" subtitle="Try adjusting your search" />
      ) : (
        <div className="space-y-3">
          {filtered.map((rep) => {
            const deals = activeDealsByRep.get(rep.id) ?? 0;
            const kw = kwByRep.get(rep.id) ?? 0;
            const paid = paidByRep.get(rep.id) ?? 0;

            return (
              <MobileCard key={rep.id} onTap={() => router.push(`/dashboard/reps/${rep.id}`)}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-base font-bold shrink-0">
                    {getInitials(rep.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-white truncate">{rep.name}</p>
                    {rep.email && (
                      <p className="text-base text-slate-400 truncate">{rep.email}</p>
                    )}
                  </div>
                  <MobileBadge value={ROLE_LABELS[rep.repType] ?? rep.repType} />
                </div>

                {isAdmin && (
                  <div className="flex gap-4 mt-3 text-base text-slate-400">
                    <span><span className="font-bold">{deals}</span> deals</span>
                    <span>&middot;</span>
                    <span><span className="font-bold">{kw.toFixed(1)}</span> kW</span>
                    <span>&middot;</span>
                    <span><span className="font-bold">${paid.toLocaleString()}</span> paid</span>
                  </div>
                )}
              </MobileCard>
            );
          })}
        </div>
      )}

      {/* Add Rep Bottom Sheet */}
      <MobileBottomSheet
        open={showAddRep}
        onClose={() => setShowAddRep(false)}
        title="Add Rep"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!addForm.firstName.trim() || !addForm.lastName.trim()) {
              toast('First and last name are required', 'error');
              return;
            }
            try {
              const res = await fetch('/api/reps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  firstName: addForm.firstName.trim(),
                  lastName: addForm.lastName.trim(),
                  email: addForm.email.trim(),
                  phone: addForm.phone.trim(),
                  repType: addForm.repType,
                }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              addRep(addForm.firstName.trim(), addForm.lastName.trim(), addForm.email.trim(), addForm.phone.trim(), addForm.repType, data.id);
              setShowAddRep(false);
              setAddForm({ firstName: '', lastName: '', email: '', phone: '', repType: 'closer' });
              toast(`${addForm.firstName} ${addForm.lastName} added`, 'success');
            } catch {
              toast('Failed to add rep', 'error');
            }
          }}
          className="px-5 space-y-4 pb-2"
        >
          <div>
            <label className="block text-base font-medium text-slate-400 mb-1.5 uppercase tracking-wider">First Name</label>
            <input
              type="text"
              required
              value={addForm.firstName}
              onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="First name"
              className="w-full min-h-[48px] bg-slate-800 border border-slate-700 text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Last Name</label>
            <input
              type="text"
              required
              value={addForm.lastName}
              onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Last name"
              className="w-full min-h-[48px] bg-slate-800 border border-slate-700 text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="email@example.com"
              className="w-full min-h-[48px] bg-slate-800 border border-slate-700 text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Rep Type</label>
            <div className="flex gap-2">
              {(['closer', 'setter', 'both'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAddForm((f) => ({ ...f, repType: type }))}
                  className={`flex-1 min-h-[48px] rounded-2xl text-base font-semibold transition-colors ${
                    addForm.repType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl bg-blue-600 text-white text-base font-semibold active:bg-blue-700 transition-colors"
          >
            Add Rep
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
