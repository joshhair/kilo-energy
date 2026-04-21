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

const REP_TYPE_LABELS: Record<string, string> = { closer: 'Closer', setter: 'Setter', both: 'Both' };
const PIPELINE_EXCLUDED: ReadonlySet<string> = new Set(['Cancelled', 'On Hold', 'Completed']);

// Top-level role filter — matches the desktop Users page.
const ROLE_FILTERS = [
  { value: 'all',              label: 'All' },
  { value: 'rep',              label: 'Reps' },
  { value: 'sub-dealer',       label: 'SDs' },
  { value: 'project_manager',  label: 'PMs' },
  { value: 'admin',            label: 'Admins' },
] as const;
type RoleFilter = typeof ROLE_FILTERS[number]['value'];

type SimpleUser = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  repType?: string;
};

const ROLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  rep:              { label: 'Rep',      color: 'var(--accent-emerald)', bg: 'rgba(0,229,160,0.12)' },
  'sub-dealer':     { label: 'SD',       color: '#b47dff', bg: 'rgba(180,125,255,0.12)' },
  project_manager:  { label: 'PM',       color: 'var(--accent-cyan)', bg: 'rgba(0,196,240,0.12)' },
  admin:            { label: 'Admin',    color: 'var(--accent-amber)', bg: 'rgba(255,176,32,0.12)' },
};

export default function MobileReps() {
  const router = useRouter();
  const { effectiveRole, projects, payrollEntries, reps, subDealers, addRep } = useApp();
  const { toast } = useToast();

  const isAdmin = effectiveRole === 'admin';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [adminUsers, setAdminUsers] = useState<SimpleUser[]>([]);
  const [pmUsers, setPmUsers] = useState<SimpleUser[]>([]);

  // Fetch admins + PMs for admin viewers so the role filter can show them.
  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/reps?role=admin')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string }>) => {
        setAdminUsers(data.map((u) => ({ ...u, role: 'admin' })));
      })
      .catch(() => {});
    fetch('/api/reps?role=project_manager')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string }>) => {
        setPmUsers(data.map((u) => ({ ...u, role: 'project_manager' })));
      })
      .catch(() => {});
  }, [isAdmin]);
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
      if (PIPELINE_EXCLUDED.has(p.phase)) continue;
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
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, number>();
    for (const pe of payrollEntries) {
      if (pe.status === 'Paid' && pe.date <= today) {
        map.set(pe.repId, (map.get(pe.repId) ?? 0) + pe.amount);
      }
    }
    return map;
  }, [payrollEntries]);

  const filtered = useMemo(() => {
    return reps.filter((r) => {
      if (r.active === false) return false;
      if (r.role !== 'rep') return false;
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
        title="Users"
        right={
          isAdmin ? (
            <button
              onClick={() => setShowAddRep(true)}
              className="flex items-center justify-center w-10 h-10 rounded-2xl text-black active:opacity-80 transition-colors"
              style={{ background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))', boxShadow: '0 0 20px rgba(0,229,160,0.3)' }}
              aria-label="Add rep"
            >
              <Plus className="w-5 h-5" />
            </button>
          ) : null
        }
      />

      {/* Role filter pills — horizontal scroll for small screens */}
      <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: 'none' }}>
        {ROLE_FILTERS.map((rf) => {
          const active = roleFilter === rf.value;
          return (
            <button
              key={rf.value}
              onClick={() => setRoleFilter(rf.value)}
              className={`shrink-0 min-h-[40px] px-4 rounded-xl text-sm font-semibold transition-colors`}
              style={{
                background: active ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                color: active ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                border: active ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {rf.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
        <input
          type="text"
          placeholder={roleFilter === 'rep' ? 'Search reps...' : 'Search users...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-2xl text-base text-white focus:outline-none focus:ring-1 transition-colors"
          style={{
            background: 'var(--m-card, var(--surface-mobile-card))',
            border: '1px solid var(--m-border, var(--border-mobile))',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        />
      </div>

      {/* Non-rep simple user list — shown for all filters except 'rep' */}
      {roleFilter !== 'rep' && (() => {
        const pool: SimpleUser[] =
          roleFilter === 'all'
            ? [
                ...reps.filter((r) => r.active !== false && r.role === 'rep').map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, role: 'rep', repType: r.repType })),
                ...subDealers.filter((s) => s.active !== false).map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, role: 'sub-dealer' })),
                ...pmUsers,
                ...adminUsers,
              ]
            : roleFilter === 'sub-dealer'
            ? subDealers.filter((s) => s.active !== false).map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, role: 'sub-dealer' }))
            : roleFilter === 'project_manager'
            ? pmUsers
            : adminUsers;

        const q = debouncedSearch.trim().toLowerCase();
        const filteredPool = q
          ? pool.filter((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
          : pool;

        if (filteredPool.length === 0) {
          return <MobileEmptyState icon={Users} title="No users found" subtitle={q ? 'Try adjusting your search' : 'No users in this category yet'} />;
        }
        return (
          <div className="space-y-3">
            {filteredPool.map((u) => {
              const badge = ROLE_BADGE[u.role] ?? { label: u.role, color: 'var(--text-muted)', bg: 'rgba(136,145,168,0.12)' };
              const initials = `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
              return (
                <MobileCard key={u.id} onTap={() => router.push(`/dashboard/users/${u.id}`)}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.firstName} {u.lastName}</p>
                      {u.email && (
                        <p className="text-sm truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{u.email}</p>
                      )}
                    </div>
                    <MobileBadge value={badge.label} />
                  </div>
                </MobileCard>
              );
            })}
          </div>
        );
      })()}

      {/* Rep list — shown only when the role filter is 'rep' */}
      {roleFilter === 'rep' && (filtered.length === 0 ? (
        <MobileEmptyState icon={Users} title="No reps found" subtitle="Try adjusting your search" />
      ) : (
        <div className="space-y-3">
          {filtered.map((rep) => {
            const deals = activeDealsByRep.get(rep.id) ?? 0;
            const kw = kwByRep.get(rep.id) ?? 0;
            const paid = paidByRep.get(rep.id) ?? 0;

            return (
              <MobileCard key={rep.id} onTap={() => router.push(`/dashboard/users/${rep.id}`)}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-black text-base font-bold shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--accent-cyan2), var(--accent-emerald))' }}
                  >
                    {getInitials(rep.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.name}</p>
                    {rep.email && (
                      <p className="text-base truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
                    )}
                  </div>
                  <MobileBadge value={REP_TYPE_LABELS[rep.repType] ?? rep.repType} />
                </div>

                {isAdmin && (
                  <div className="flex gap-4 mt-3 text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{deals}</span> deals</span>
                    <span>&middot;</span>
                    <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{kw.toFixed(1)}</span> kW</span>
                    <span>&middot;</span>
                    <span><span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${paid.toLocaleString()}</span> paid</span>
                  </div>
                )}
              </MobileCard>
            );
          })}
        </div>
      ))}

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
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>First Name</label>
            <input
              type="text"
              required
              value={addForm.firstName}
              onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="First name"
              className="w-full min-h-[48px] text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Last Name</label>
            <input
              type="text"
              required
              value={addForm.lastName}
              onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Last name"
              className="w-full min-h-[48px] text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Email</label>
            <input
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="email@example.com"
              className="w-full min-h-[48px] text-white text-base rounded-2xl px-3 py-2.5 focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep Type</label>
            <div className="flex gap-2">
              {(['closer', 'setter', 'both'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAddForm((f) => ({ ...f, repType: type }))}
                  className="flex-1 min-h-[48px] rounded-2xl text-base font-semibold transition-colors"
                  style={{
                    background: addForm.repType === type ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                    color: addForm.repType === type ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                    border: addForm.repType === type ? '1px solid var(--accent-emerald)' : '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-80 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 0 20px rgba(0,229,160,0.3)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Add Rep
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
