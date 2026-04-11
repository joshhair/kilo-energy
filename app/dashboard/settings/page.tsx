'use client';

import React, { useState, useRef, useEffect, Fragment, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import MobileSettings from '../mobile/MobileSettings';
import { useToast } from '../../../lib/toast';
import { SOLARTECH_FAMILIES, SolarTechFamily, getTrainerOverrideRate, TrainerAssignment, TrainerOverrideTier, InstallerRates, FINANCERS, ProductCatalogInstallerConfig, makeProductCatalogTiers, ProductCatalogTier, DEFAULT_INSTALL_PAY_PCT } from '../../../lib/data';
import { getCustomConfig } from '../../../lib/utils';
import {
  Layers, Building2, Landmark, BookOpen, Shield, CreditCard, Download, FileSpreadsheet,
  Plus, Pencil, Check, X, EyeOff, Eye, Trash2, Settings, AlertTriangle, Search,
  ChevronRight, History, GitBranch, Copy, ChevronDown, ChevronUp, Sliders, DollarSign,
  UserPlus, ListChecks, CheckSquare, Square, Tent, Users, Handshake,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { PaginationBar } from '../components/PaginationBar';
import { SearchableSelect } from '../components/SearchableSelect';

// ─── Nav structure ────────────────────────────────────────────────────────────

type SettingsSection =
  | 'trainers'
  | 'installers' | 'financers' | 'baselines'
  | 'blitz-permissions'
  | 'export'
  | 'customization';

type NavItem = { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { group: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    group: 'Team',
    items: [
      { id: 'trainers', label: 'Trainer Overrides', icon: Layers },
      { id: 'blitz-permissions', label: 'Blitz Permissions', icon: Tent },
    ],
  },
  {
    group: 'Business',
    items: [
      { id: 'installers', label: 'Installers', icon: Building2 },
      { id: 'financers',  label: 'Financers',  icon: Landmark },
      { id: 'baselines',  label: 'Baselines',  icon: BookOpen },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'customization', label: 'Customization', icon: Sliders },
      { id: 'export', label: 'Export', icon: Download },
    ],
  },
];

// Flat ordered list used for ref indexing
const ALL_NAV_ITEMS = NAV.flatMap(g => g.items);

// ─── Blitz Permissions Component ──────────────────────────────────────────────

function BlitzPermissionsSection({ reps }: { reps: Array<{ id: string; name: string; repType: string; canRequestBlitz?: boolean; canCreateBlitz?: boolean }> }) {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<Record<string, { canRequestBlitz: boolean; canCreateBlitz: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'All' | 'Closer' | 'Setter' | 'Both'>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; action: 'grant' | 'revoke' }>({ open: false, action: 'grant' });

  // Debounce search input (200ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, roleFilter]);

  // Initialize permissions from context data (no N+1 fetches)
  useEffect(() => {
    const perms: Record<string, { canRequestBlitz: boolean; canCreateBlitz: boolean }> = {};
    reps.forEach((r) => {
      perms[r.id] = { canRequestBlitz: r.canRequestBlitz ?? false, canCreateBlitz: r.canCreateBlitz ?? false };
    });
    setPermissions(perms);
    setLoading(false);
  }, [reps]);

  const togglePermission = async (repId: string, field: 'canRequestBlitz' | 'canCreateBlitz', value: boolean) => {
    const prev = permissions[repId];
    setPermissions((p) => ({ ...p, [repId]: { ...p[repId], [field]: value } }));
    try {
      const res = await fetch(`/api/users/${repId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      toast('Permission updated');
    } catch {
      setPermissions((p) => ({ ...p, [repId]: prev }));
      toast('Failed to update permission', 'error');
    }
  };

  // Role counts
  const roleCounts = { All: reps.length, Closer: 0, Setter: 0, Both: 0 };
  reps.forEach((r) => {
    const rt = r.repType?.toLowerCase() ?? '';
    if (rt === 'closer') roleCounts.Closer++;
    else if (rt === 'setter') roleCounts.Setter++;
    else if (rt === 'both') roleCounts.Both++;
  });

  // Filter reps
  const filteredReps = reps.filter((r) => {
    const matchesSearch = !debouncedSearch || r.name.toLowerCase().includes(debouncedSearch.toLowerCase());
    const rt = r.repType?.toLowerCase() ?? '';
    const matchesRole = roleFilter === 'All' || rt === roleFilter.toLowerCase();
    return matchesSearch && matchesRole;
  });

  // Summary stats
  const canRequestCount = filteredReps.filter((r) => permissions[r.id]?.canRequestBlitz).length;
  const canCreateCount = filteredReps.filter((r) => permissions[r.id]?.canCreateBlitz).length;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredReps.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, filteredReps.length);
  const pageReps = filteredReps.slice(startIdx, endIdx);

  // Bulk actions
  const executeBulk = async (action: 'grant' | 'revoke') => {
    const value = action === 'grant';
    const updates: Promise<void>[] = [];
    const newPerms = { ...permissions };
    filteredReps.forEach((r) => {
      newPerms[r.id] = { canRequestBlitz: value, canCreateBlitz: value };
      updates.push(
        fetch(`/api/users/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canRequestBlitz: value, canCreateBlitz: value }),
        }).then(() => {})
      );
    });
    setPermissions(newPerms);
    await Promise.all(updates);
    toast(`${action === 'grant' ? 'Granted' : 'Revoked'} permissions for ${filteredReps.length} reps`);
  };

  // Initials + avatar color
  const getInitials = (name: string) => name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const avatarColor = (repType: string) => {
    const rt = repType?.toLowerCase() ?? '';
    if (rt === 'closer') return 'bg-purple-600';
    if (rt === 'setter') return 'bg-[#00e07a]';
    if (rt === 'both') return 'bg-teal-600';
    return 'bg-[#525c72]';
  };
  const roleBadge = (repType: string) => {
    const rt = repType?.toLowerCase() ?? '';
    if (rt === 'closer') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Closer</span>;
    if (rt === 'setter') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#00e07a]/20 text-[#00c4f0]">Setter</span>;
    if (rt === 'both') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300">Both</span>;
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#8891a8]/20 text-[#c2c8d8]">{repType || 'N/A'}</span>;
  };

  if (loading) return <div className="text-[#8891a8] text-sm py-8 text-center">Loading permissions...</div>;

  return (
    <div key="blitz-permissions" className="animate-tab-enter max-w-3xl">
      <h2 className="text-lg font-bold text-white mb-1">Blitz Permissions</h2>
      <p className="text-sm text-[#8891a8] mb-5">Control which reps can request or create blitzes.</p>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8891a8]" />
        <input
          type="text"
          placeholder="Search reps..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-[#1d2028] border border-[#333849] rounded-xl pl-9 pr-4 py-2 text-sm text-[#f0f2f7] placeholder-[#525c72] focus:outline-none input-focus-glow transition-colors"
        />
      </div>
      {searchTerm && (
        <span className="text-xs text-[#8891a8] bg-[#1d2028] px-2 py-0.5 rounded-full mb-3 inline-block">{filteredReps.length} result{filteredReps.length !== 1 ? 's' : ''}</span>
      )}

      {/* Role filter tabs */}
      <div className="flex items-center gap-1 mb-4">
        {(['All', 'Closer', 'Setter', 'Both'] as const).map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(role)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={roleFilter === role
              ? { background: '#00e07a', color: '#000' }
              : { background: '#1d2028', color: '#c2c8d8', border: '1px solid #333849' }
            }
          >
            {role} <span className="ml-1 text-[#8891a8]">{roleCounts[role]}</span>
          </button>
        ))}
      </div>

      {/* Summary stats + bulk actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-4 text-xs text-[#c2c8d8]">
          <span><strong className="text-[#00e07a]">{canRequestCount}</strong> can request</span>
          <span><strong className="text-[#00e07a]">{canCreateCount}</strong> can create</span>
          <span><strong className="text-[#c2c8d8]">{filteredReps.length}</strong> total reps</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmDialog({ open: true, action: 'grant' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#00e07a]/20 text-[#00e07a] hover:bg-[#00e07a]/30 transition-colors"
          >
            Grant All
          </button>
          <button
            onClick={() => setConfirmDialog({ open: true, action: 'revoke' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
          >
            Revoke All
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="table-header-frost">
            <tr className="text-xs uppercase tracking-wider" style={{ borderBottom: '1px solid #272b35', color: '#8891a8' }}>
              <th className="text-left px-4 py-3">Rep</th>
              <th className="text-center px-4 py-3">Can Request</th>
              <th className="text-center px-4 py-3">Can Create</th>
            </tr>
          </thead>
          <tbody>
            {pageReps.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-8 text-[#8891a8] text-sm">No reps match your filters.</td></tr>
            ) : pageReps.map((rep) => {
              const perms = permissions[rep.id] ?? { canRequestBlitz: false, canCreateBlitz: false };
              return (
                <tr key={rep.id} className="last:border-0 transition-colors" style={{ borderBottom: '1px solid rgba(39,43,53,0.5)' }} onMouseEnter={(e) => e.currentTarget.style.background='rgba(29,32,40,0.4)'} onMouseLeave={(e) => e.currentTarget.style.background='transparent'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${avatarColor(rep.repType)}`}>
                        {getInitials(rep.name)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white font-medium text-sm">{rep.name}</span>
                        <span className="mt-0.5">{roleBadge(rep.repType)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => togglePermission(rep.id, 'canRequestBlitz', !perms.canRequestBlitz)}
                        className={`w-9 h-5 rounded-full transition-colors relative inline-block ${perms.canRequestBlitz ? 'bg-[#00e07a]' : 'bg-[#1d2028]'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms.canRequestBlitz ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <span className={`text-[10px] font-medium ${perms.canRequestBlitz ? 'text-[#00e07a]' : 'text-[#8891a8]'}`}>
                        {perms.canRequestBlitz ? 'On' : 'Off'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => togglePermission(rep.id, 'canCreateBlitz', !perms.canCreateBlitz)}
                        className={`w-9 h-5 rounded-full transition-colors relative inline-block ${perms.canCreateBlitz ? 'bg-[#00e07a]' : 'bg-[#1d2028]'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms.canCreateBlitz ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <span className={`text-[10px] font-medium ${perms.canCreateBlitz ? 'text-[#00e07a]' : 'text-[#8891a8]'}`}>
                        {perms.canCreateBlitz ? 'On' : 'Off'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredReps.length > rowsPerPage && (
          <PaginationBar
            totalResults={filteredReps.length}
            startIdx={startIdx + 1}
            endIdx={endIdx}
            currentPage={safePage}
            totalPages={totalPages}
            rowsPerPage={rowsPerPage}
            onPageChange={setCurrentPage}
            onRowsPerPageChange={setRowsPerPage}
          />
        )}
      </div>

      <div className="mt-4 text-xs text-[#525c72] space-y-1">
        <p><strong className="text-[#c2c8d8]">Can Request:</strong> Rep can submit blitz requests for admin approval</p>
        <p><strong className="text-[#c2c8d8]">Can Create:</strong> Rep can create and manage blitzes directly</p>
      </div>

      {/* Bulk action confirm dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}
        onConfirm={() => { executeBulk(confirmDialog.action); setConfirmDialog({ ...confirmDialog, open: false }); }}
        title={confirmDialog.action === 'grant' ? 'Grant All Permissions' : 'Revoke All Permissions'}
        message={`This will ${confirmDialog.action === 'grant' ? 'grant' : 'revoke'} both Request and Create permissions for ${filteredReps.length} visible rep${filteredReps.length !== 1 ? 's' : ''}. Continue?`}
        confirmLabel={confirmDialog.action === 'grant' ? 'Grant All' : 'Revoke All'}
        danger={confirmDialog.action === 'revoke'}
      />
    </div>
  );
}

// ─── Sub-Dealers Section ─────────────────────────────────────────────────────

function SubDealersSection() {
  const { subDealers, addSubDealer, deactivateSubDealer, projects } = useApp();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleAdd = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast('First and last name are required', 'error');
      return;
    }
    if (email.trim() && subDealers.some((sd) => sd.email.toLowerCase() === email.trim().toLowerCase())) {
      toast('A sub-dealer with this email already exists', 'error');
      return;
    }
    addSubDealer(firstName, lastName, email, phone);
    toast(`Added sub-dealer ${firstName.trim()} ${lastName.trim()}`, 'success');
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
  };

  return (
    <div key="sub-dealers" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Sub-Dealers" subtitle="Manage sub-dealer accounts and track their deals" />

      {/* Add sub-dealer form */}
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-white font-semibold mb-3">Add Sub-Dealer</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="text" placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
          />
          <input
            type="text" placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="email" placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
          />
          <input
            type="tel" placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!firstName.trim() || !lastName.trim()}
          className="btn-primary text-black text-sm px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" /> Add Sub-Dealer
        </button>
      </div>

      {/* Sub-dealer list */}
      <div className="card-surface rounded-2xl">
        <div className="px-5 py-3.5 border-b border-[#333849]">
          <p className="text-white font-semibold text-sm">{subDealers.length} Sub-Dealer{subDealers.length !== 1 ? 's' : ''}</p>
        </div>
        {subDealers.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Handshake className="w-6 h-6 text-[#525c72] mx-auto mb-2" />
            <p className="text-[#8891a8] text-xs">No sub-dealers added yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {subDealers.map((sd) => {
              const dealCount = projects.filter((p) => p.subDealerId === sd.id).length;
              return (
                <div key={sd.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#1d2028]/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{sd.name}</p>
                    <p className="text-[#8891a8] text-xs truncate">{sd.email}{sd.phone ? ` \u00b7 ${sd.phone}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[#8891a8] text-xs tabular-nums">{dealCount} deal{dealCount !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setConfirmRemove(sd.id)}
                      className="text-[#525c72] hover:text-red-400 transition-colors p-1"
                      title="Deactivate sub-dealer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (confirmRemove) {
            const sd = subDealers.find((s) => s.id === confirmRemove);
            await deactivateSubDealer(confirmRemove);
            toast(`Deactivated sub-dealer ${sd?.name ?? ''}`, 'success');
          }
          setConfirmRemove(null);
        }}
        title="Deactivate Sub-Dealer"
        message="They will lose app access immediately. Their existing deals and history are preserved. You can reactivate them later from their profile."
        confirmLabel="Deactivate"
        danger
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsPageWrapper() {
  return <Suspense><SettingsPageInner /></Suspense>;
}

// ─── Project Managers Section ────────────────────────────────────────────────

function PMSection() {
  const { toast } = useToast();
  const [pms, setPms] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const loadPMs = () => {
    fetch('/api/reps?role=project_manager').then((r) => r.ok ? r.json() : []).then((data) => {
      setPms(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { loadPMs(); }, []);

  const handleAdd = async () => {
    if (!newFirstName.trim() || !newEmail.trim()) return;
    const res = await fetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: newFirstName.trim(), lastName: newLastName.trim(), email: newEmail.trim(), role: 'project_manager' }),
    });
    if (res.ok) {
      toast('Project manager added');
      setNewFirstName(''); setNewLastName(''); setNewEmail('');
      loadPMs();
    } else {
      toast('Failed to add project manager', 'error');
    }
  };

  const togglePerm = async (pmId: string, field: 'canExport' | 'canCreateDeals' | 'canAccessBlitz', current: boolean) => {
    const res = await fetch(`/api/users/${pmId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: !current }),
    });
    if (res.ok) {
      setPms((prev) => prev.map((pm) => pm.id === pmId ? { ...pm, [field]: !current } : pm));
    }
  };

  const handleDelete = async (pmId: string) => {
    const res = await fetch(`/api/users/${pmId}`, { method: 'DELETE' });
    if (res.ok) { toast('Project manager removed'); loadPMs(); }
  };

  if (loading) return <div className="text-sm text-[#8891a8] py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#8891a8]">Project managers can view all projects and reps but cannot access payroll, pricing, or settings.</p>

      {/* Add form */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-[10px] text-[#8891a8] mb-0.5">First Name</label>
          <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} className="w-full bg-[#1d2028] border border-[#333849] rounded-lg px-2.5 py-2 text-sm text-white" placeholder="First" />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] text-[#8891a8] mb-0.5">Last Name</label>
          <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} className="w-full bg-[#1d2028] border border-[#333849] rounded-lg px-2.5 py-2 text-sm text-white" placeholder="Last" />
        </div>
        <div className="flex-[2]">
          <label className="block text-[10px] text-[#8891a8] mb-0.5">Email</label>
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full bg-[#1d2028] border border-[#333849] rounded-lg px-2.5 py-2 text-sm text-white" placeholder="email@example.com" />
        </div>
        <button onClick={handleAdd} className="btn-primary px-3 py-2 rounded-xl active:scale-[0.97]" style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000' }}>
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* PM list with permission toggles */}
      {pms.length === 0 ? (
        <div className="card-surface rounded-2xl p-5 text-center">
          <p className="text-[#8891a8] text-sm">No project managers yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pms.map((pm) => (
            <div key={pm.id} className="card-surface rounded-xl px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-white font-medium text-sm">{pm.firstName} {pm.lastName}</p>
                  <p className="text-[#8891a8] text-xs">{pm.email}</p>
                </div>
                <button onClick={() => handleDelete(pm.id)} className="text-[#525c72] hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {([
                  { field: 'canCreateDeals' as const, label: 'Create Deals' },
                  { field: 'canAccessBlitz' as const, label: 'Blitz Access' },
                  { field: 'canExport' as const, label: 'Export Data' },
                ]).map(({ field, label }) => (
                  <button
                    key={field}
                    onClick={() => togglePerm(pm.id, field, pm[field])}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                      pm[field]
                        ? 'bg-emerald-900/30 text-emerald-300 border-[#00e07a]/30'
                        : 'bg-[#1d2028]/50 text-[#8891a8] border-[#272b35]/50'
                    }`}
                  >
                    {pm[field] ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPageInner() {
  const isHydrated = useIsHydrated();
  useEffect(() => { document.title = 'Settings | Kilo Energy'; }, []);
  const {
    currentRole,
    reps,
    installers, financers, setInstallerActive, setFinancerActive, addInstaller, addFinancer, deleteInstaller, deleteFinancer,
    projects, trainerAssignments, setTrainerAssignments,
    installerBaselines, updateInstallerBaseline, addInstallerBaseline,
    installerPricingVersions, createNewInstallerVersion,
    solarTechProducts, updateSolarTechProduct, updateSolarTechTier,
    productCatalogInstallerConfigs, productCatalogProducts,
    addProductCatalogInstaller, addProductCatalogProduct, updateProductCatalogProduct,
    updateProductCatalogTier, removeProductCatalogProduct,
    installerPrepaidOptions, getInstallerPrepaidOptions, addInstallerPrepaidOption, updateInstallerPrepaidOption, removeInstallerPrepaidOption,
    payrollEntries,
    productCatalogPricingVersions, createNewProductCatalogVersion, deleteProductCatalogPricingVersions,
    installerPayConfigs, updateInstallerPayConfig,
  } = useApp();

  const { toast } = useToast();

  const router = useRouter();
  const searchParams = useSearchParams();

  const validSections: SettingsSection[] = ['trainers', 'blitz-permissions', 'installers', 'financers', 'baselines', 'customization', 'export'];
  const paramSection = searchParams.get('section') as SettingsSection | null;
  const initialSection: SettingsSection = paramSection && validSections.includes(paramSection) ? paramSection : 'trainers';

  const [section, setSection] = useState<SettingsSection>(initialSection);

  /** Check whether the user has unsaved inline edits */
  const hasUnsavedChanges = () =>
    editingInstaller !== null ||
    editingAssignmentId !== null ||
    editingPrepaid !== null;

  /** Update URL when section changes */
  const handleSetSection = (s: SettingsSection) => {
    if (s !== section && hasUnsavedChanges()) {
      setPendingSection(s);
      return;
    }
    setSection(s);
    router.replace(`/dashboard/settings?section=${s}`, { scroll: false });
  };

  /** Discard unsaved edits and navigate to the pending section */
  const discardAndNavigate = () => {
    setEditingInstaller(null);
    setEditingAssignmentId(null);
    setEditingPrepaid(null);
    if (pendingSection) {
      setSection(pendingSection);
      router.replace(`/dashboard/settings?section=${pendingSection}`, { scroll: false });
      setPendingSection(null);
    }
  };

  // ── Sliding nav-pill state ───────────────────────────────────────────────────
  const navRef = useRef<HTMLElement>(null);
  const navBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{ top: number; height: number }>({ top: 0, height: 0 });

  useEffect(() => {
    const activeIdx = ALL_NAV_ITEMS.findIndex(item => item.id === section);
    const navEl = navRef.current;
    const btnEl = navBtnRefs.current[activeIdx];
    if (!navEl || !btnEl) return;
    const navRect = navEl.getBoundingClientRect();
    const btnRect = btnEl.getBoundingClientRect();
    setPillStyle({
      top: btnRect.top - navRect.top,
      height: btnRect.height,
    });
  }, [section]);

  // ── Baseline editing state ───────────────────────────────────────────────────
  const [editingInstaller, setEditingInstaller] = useState<string | null>(null);
  const [editInstallerVals, setEditInstallerVals] = useState({ closerPerW: '', setterPerW: '', kiloPerW: '', subDealerPerW: '' });
  const [newInstallerBaseline, setNewInstallerBaseline] = useState('');
  const [showSubDealerRates, setShowSubDealerRates] = useState(false);

  // ── Admin users count (for dashboard stat — see adminCount usage below).
  // The actual admin user management UI lives at /dashboard/users with the
  // role filter; this is just a count, no form state needed. ──
  const [adminUsers, setAdminUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  useEffect(() => {
    fetch('/api/reps?role=admin').then((r) => r.ok ? r.json() : []).then((users: Array<{ id: string; firstName: string; lastName: string; email: string }>) => {
      setAdminUsers(users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email })));
    }).catch(() => {});
  }, []);

  // ── Installers / Financers state ────────────────────────────────────────────
  const [newInstaller, setNewInstaller] = useState('');
  const [newInstallerStructure, setNewInstallerStructure] = useState<'standard' | 'product-catalog'>('standard');
  const [newInstallerCloser, setNewInstallerCloser] = useState('');
  const [newInstallerKilo, setNewInstallerKilo] = useState('');
  // Product Catalog installer config form state
  const [newPcFamilies, setNewPcFamilies] = useState<string[]>(['']);
  const [newFinancer, setNewFinancer] = useState('');

  // ── Unified delete-confirm dialog state ─────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'installer' | 'financer' | 'trainer';
    id: string;
    name: string;
    message: string;
  } | null>(null);
  // Generic confirm dialog state (replaces window.confirm for product/admin deletes)
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  // Tracks financers hidden from the UI after deletion
  const [hiddenFinancers, setHiddenFinancers] = useState<Set<string>>(new Set());
  // Stores the last deleted entity so the undo toast callback can restore it
  const deletedEntityRef = useRef<
    | { type: 'installer'; name: string }
    | { type: 'financer'; name: string }
    | { type: 'trainer'; assignment: TrainerAssignment }
    | null
  >(null);

  // ── Per-installer prepaid options state ─────────────────────────────────
  const [prepaidInstallerExpanded, setPrepaidInstallerExpanded] = useState<string | null>(null);
  const [newPrepaidOption, setNewPrepaidOption] = useState('');
  const [editingPrepaid, setEditingPrepaid] = useState<string | null>(null);
  const [editPrepaidVal, setEditPrepaidVal] = useState('');

  // ── Product name inline-edit state ──────────────────────────────────────
  const [editingProductName, setEditingProductName] = useState<string | null>(null);
  const [editProductNameVal, setEditProductNameVal] = useState('');

  // ── Per-installer pay schedule state ──────────────────────────────────
  const [payScheduleExpanded, setPayScheduleExpanded] = useState<string | null>(null);
  const [editPayPct, setEditPayPct] = useState('');

  // ── Installer / Financer search state ────────────────────────────────────
  const [installerSearch, setInstallerSearch] = useState('');
  const [financerSearch, setFinancerSearch] = useState('');

  // ── Trainer search + sort state ─────────────────────────────────────────
  const [trainerSearch, setTrainerSearch] = useState('');
  type TrainerSortKey = 'trainee' | 'trainer' | 'deals' | 'rate';
  const [trainerSortKey, setTrainerSortKey] = useState<TrainerSortKey>('trainee');
  const [trainerSortDir, setTrainerSortDir] = useState<'asc' | 'desc'>('asc');
  const [trainerPage, setTrainerPage] = useState(1);
  const [trainerRowsPerPage, setTrainerRowsPerPage] = useState(25);
  const trainerSearchRef = useRef<HTMLInputElement>(null);
  const toggleTrainerSort = (key: TrainerSortKey) => {
    if (trainerSortKey === key) {
      setTrainerSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTrainerSortKey(key);
      setTrainerSortDir('asc');
    }
  };

  // ── "/" shortcut to focus trainer search ────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        trainerSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Collapsible archived sections state ─────────────────────────────────
  const [archivedInstallersOpen, setArchivedInstallersOpen] = useState(false);
  const [archivedFinancersOpen, setArchivedFinancersOpen] = useState(false);

  // ── Bulk select state (installers + financers) ─────────────────────────
  const [installerSelectMode, setInstallerSelectMode] = useState(false);
  const [selectedInstallers, setSelectedInstallers] = useState<Set<string>>(new Set());
  const [financerSelectMode, setFinancerSelectMode] = useState(false);
  const [selectedFinancers, setSelectedFinancers] = useState<Set<string>>(new Set());

  // ── Export state ─────────────────────────────────────────────────────────
  const [exportSelected, setExportSelected] = useState<Set<'payments' | 'projects' | 'baselines' | 'trainers'>>(new Set());
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');

  // ── Pricing version state ────────────────────────────────────────────────────
  const [newVersionFor, setNewVersionFor] = useState<string | null>(null);
  const [newVersionLabel, setNewVersionLabel] = useState('');
  const [newVersionEffectiveFrom, setNewVersionEffectiveFrom] = useState('');
  const [newVersionVals, setNewVersionVals] = useState({ closerPerW: '', setterPerW: '', kiloPerW: '' });
  const [showVersionHistory, setShowVersionHistory] = useState<string | null>(null);
  // ── Product Catalog tab state ────────────────────────────────────────────────
  const [pcFamily, setPcFamily] = useState<Record<string, string>>({});
  const [addingProductFor, setAddingProductFor] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [newProductFamily, setNewProductFamily] = useState('');
  const [newProductTiers, setNewProductTiers] = useState([
    { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' },
  ]);
  // ── Product Catalog pricing version state ──────────────────────────────────
  const [pcNewVersionFor, setPcNewVersionFor] = useState<string | null>(null);  // productId
  const [pcNewVersionLabel, setPcNewVersionLabel] = useState('');
  const [pcNewVersionEffectiveFrom, setPcNewVersionEffectiveFrom] = useState('');
  const [pcNewVersionTiers, setPcNewVersionTiers] = useState<{ closerPerW: string; kiloPerW: string }[]>([
    { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
  ]);

  // ── Table-level version view state ──────────────────────────────────────────
  // 'current' = live editable data; any other value = a version key (label|effectiveFrom) for archived view
  const [stVersionView, setStVersionView] = useState<Record<string, string>>({}); // keyed by SolarTech family
  const [pcVersionView, setPcVersionView] = useState<Record<string, string>>({}); // keyed by "installer::family"

  // ── Duplicate All as New Version modal state ──────────────────────────────
  const [dupAllOpen, setDupAllOpen] = useState<'solartech' | 'productcatalog' | null>(null);
  const [dupAllLabel, setDupAllLabel] = useState('');
  const [dupAllEffectiveFrom, setDupAllEffectiveFrom] = useState('');

  // ── Bulk Adjust panel state ───────────────────────────────────────────────
  const [bulkAdjustOpen, setBulkAdjustOpen] = useState<'solartech' | 'productcatalog' | null>(null);
  const [bulkRateAdj, setBulkRateAdj] = useState('');
  const [bulkSpreadInputs, setBulkSpreadInputs] = useState<[string, string, string, string]>(['', '', '', '']);

  // ── Product search state (pricing tables) ──────────────────────────────────
  const [stProductSearch, setStProductSearch] = useState('');
  const [pcProductSearch, setPcProductSearch] = useState('');

  // ── Tier input cell ref map (keyboard navigation) ─────────────────────────
  // Key: `${productId}-${tierIndex}-${'closer'|'kilo'}`
  const tierInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const setTierInputRef = (key: string, el: HTMLInputElement | null) => {
    if (el) tierInputRefs.current.set(key, el);
    else tierInputRefs.current.delete(key);
  };

  // ── Delta badge original values snapshot ──────────────────────────────────
  // Key: `${productId}-${tierIndex}-${'closer'|'kilo'}`, Value: original number
  const originalTierValues = useRef<Map<string, number>>(new Map());
  const hasSnapshotted = useRef<string>(''); // tracks which family snapshot is active

  // ── Sortable baseline table state ──────────────────────────────────────────
  type BaselineSortKey = 'installer' | 'closer' | 'kilo';
  const [baselineSortKey, setBaselineSortKey] = useState<BaselineSortKey>('installer');
  const [baselineSortDir, setBaselineSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleBaselineSort = (key: BaselineSortKey) => {
    if (baselineSortKey === key) {
      setBaselineSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setBaselineSortKey(key);
      setBaselineSortDir('asc');
    }
  };

  // ── Unsaved-changes guard state ────────────────────────────────────────────
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);

  // ── Trainer state ───────────────────────────────────────────────────────────
  const [newTraineeId, setNewTraineeId] = useState('');
  const [newTrainerId, setNewTrainerId] = useState('');
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editingTiers, setEditingTiers] = useState<TrainerOverrideTier[]>([]);

  // ── Baselines sub-tab ────────────────────────────────────────────────────────
  const [baselineTab, setBaselineTab] = useState<string>('standard');

  // ── Customization state (hoisted from IIFE to avoid hooks violation) ──
  const CUSTOMIZATION_DEFAULT_THRESHOLDS: Record<string, number> = {
    'New': 5, 'Acceptance': 10, 'Site Survey': 20, 'Design': 30,
    'Permitting': 50, 'Pending Install': 65, 'Installed': 75,
  };
  const [customThresholds, setCustomThresholds] = useState<Record<string, number>>(() =>
    getCustomConfig('kilo-pipeline-thresholds', CUSTOMIZATION_DEFAULT_THRESHOLDS)
  );
  const [thresholdsSaved, setThresholdsSaved] = useState(false);
  const baselineTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [baselineIndicator, setBaselineIndicator] = useState<{ left: number; width: number } | null>(null);

  // ── SolarTech family sub-tab ─────────────────────────────────────────────────
  const [stFamily, setStFamily] = useState<SolarTechFamily>('Goodleap');
  const stFamilyRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [stFamilyIndicator, setStFamilyIndicator] = useState<{ left: number; width: number } | null>(null);

  // ── Product Catalog installer family sub-tab ─────────────────────────────────
  const pcFamilyTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pcFamilyIndicator, setPcFamilyIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const pcInstallerNames = Object.keys(productCatalogInstallerConfigs).filter((n) => n !== 'SolarTech');
    const allTabs = ['standard', 'solartech', ...pcInstallerNames];
    const idx = allTabs.indexOf(baselineTab);
    const el = baselineTabRefs.current[idx >= 0 ? idx : 0];
    if (el) setBaselineIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [baselineTab, productCatalogInstallerConfigs]);

  useEffect(() => {
    const idx = SOLARTECH_FAMILIES.indexOf(stFamily);
    const el = stFamilyRefs.current[idx];
    if (el) setStFamilyIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [stFamily]);

  useEffect(() => {
    const config = productCatalogInstallerConfigs[baselineTab];
    if (!config) return;
    const fam = pcFamily[baselineTab] ?? config.families[0] ?? '';
    const idx = config.families.indexOf(fam);
    const el = pcFamilyTabRefs.current[idx >= 0 ? idx : 0];
    if (el) setPcFamilyIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [baselineTab, pcFamily, productCatalogInstallerConfigs]);

  // ── Snapshot original tier values for delta badges ─────────────────────────
  useEffect(() => {
    const snapshotKey = `st::${stFamily}`;
    if (hasSnapshotted.current === snapshotKey) return;
    hasSnapshotted.current = snapshotKey;
    const familyProducts = solarTechProducts.filter((p) => p.family === stFamily);
    familyProducts.forEach((p) => {
      p.tiers.forEach((t, ti) => {
        const ck = `${p.id}-${ti}-closer`;
        const kk = `${p.id}-${ti}-kilo`;
        if (!originalTierValues.current.has(ck)) originalTierValues.current.set(ck, t.closerPerW);
        if (!originalTierValues.current.has(kk)) originalTierValues.current.set(kk, t.kiloPerW);
      });
    });
  }, [stFamily, solarTechProducts]);

  useEffect(() => {
    const config = productCatalogInstallerConfigs[baselineTab];
    if (!config) return;
    const currentFam = pcFamily[baselineTab] ?? config.families[0] ?? '';
    const snapshotKey = `pc::${baselineTab}::${currentFam}`;
    if (hasSnapshotted.current === snapshotKey) return;
    hasSnapshotted.current = snapshotKey;
    const familyProducts = productCatalogProducts.filter((p) => p.installer === baselineTab && p.family === currentFam);
    familyProducts.forEach((p) => {
      p.tiers.forEach((t, ti) => {
        const ck = `${p.id}-${ti}-closer`;
        const kk = `${p.id}-${ti}-kilo`;
        if (!originalTierValues.current.has(ck)) originalTierValues.current.set(ck, t.closerPerW);
        if (!originalTierValues.current.has(kk)) originalTierValues.current.set(kk, t.kiloPerW);
      });
    });
  }, [baselineTab, pcFamily, productCatalogInstallerConfigs, productCatalogProducts]);

  // ── Clear product search on family tab change ─────────────────────────────
  useEffect(() => { setStProductSearch(''); }, [stFamily]);
  useEffect(() => { setPcProductSearch(''); }, [baselineTab, pcFamily]);

  // ── Keyboard navigation helper for tier inputs ────────────────────────────
  const handleTierKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    productIds: string[],
    productId: string,
    tierIndex: number,
    field: 'closer' | 'kilo',
  ) => {
    const productIdx = productIds.indexOf(productId);
    const totalTiers = 4;
    let targetKey: string | null = null;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (field === 'closer') {
        targetKey = `${productId}-${tierIndex}-kilo`;
      } else {
        // kilo -> next tier closer, or wrap to next product first tier closer
        if (tierIndex < totalTiers - 1) {
          targetKey = `${productId}-${tierIndex + 1}-closer`;
        } else if (productIdx < productIds.length - 1) {
          targetKey = `${productIds[productIdx + 1]}-0-closer`;
        }
      }
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (productIdx < productIds.length - 1) {
        targetKey = `${productIds[productIdx + 1]}-${tierIndex}-${field}`;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (productIdx > 0) {
        targetKey = `${productIds[productIdx - 1]}-${tierIndex}-${field}`;
      }
    }

    if (targetKey) {
      const el = tierInputRefs.current.get(targetKey);
      if (el) { el.focus(); el.select(); }
    }
  };

  // ── Delta badge renderer ─────────────────────────────────────────────────
  const renderDeltaBadge = (productId: string, tierIndex: number, field: 'closer' | 'kilo', currentValue: number) => {
    const key = `${productId}-${tierIndex}-${field}`;
    const original = originalTierValues.current.get(key);
    if (original === undefined) return null;
    const delta = Math.round((currentValue - original) * 100) / 100;
    if (delta === 0) return null;
    const isPositive = delta > 0;
    return (
      <span className={`text-[9px] font-medium leading-none ${isPositive ? 'text-[#00e07a]' : 'text-red-400'}`}>
        {isPositive ? '+' : ''}{delta.toFixed(2)}
      </span>
    );
  };

  // ── Keyboard shortcuts for edits (Escape = cancel, Enter = save) ───────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only act when an edit is in progress
      const isEditActive = editingInstaller !== null || editingAssignmentId !== null || editingPrepaid !== null;
      if (!isEditActive) return;

      // Don't intercept if user is in an input/select/textarea (Enter should work normally there for some)
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingInstaller(null);
        setEditingAssignmentId(null);
        setEditingPrepaid(null);
        // Clear bulk selections
        if (installerSelectMode) { setInstallerSelectMode(false); setSelectedInstallers(new Set()); }
        if (financerSelectMode) { setFinancerSelectMode(false); setSelectedFinancers(new Set()); }
      }

      if (e.key === 'Enter' && !inInput) {
        e.preventDefault();
        // Save baseline edit
        if (editingInstaller) {
          const c = parseFloat(editInstallerVals.closerPerW);
          const k = parseFloat(editInstallerVals.kiloPerW);
          const s = parseFloat(editInstallerVals.setterPerW);
          if (!isNaN(c) && !isNaN(k)) {
            const sd = parseFloat(editInstallerVals.subDealerPerW);
            updateInstallerBaseline(editingInstaller, {
              closerPerW: c, kiloPerW: k,
              ...(editInstallerVals.setterPerW !== '' && !isNaN(s) ? { setterPerW: s } : {}),
              ...(editInstallerVals.subDealerPerW !== '' && !isNaN(sd) ? { subDealerPerW: sd } : {}),
            });
          }
          setEditingInstaller(null);
        }
        // Save trainer tier edit
        if (editingAssignmentId) {
          setTrainerAssignments((prev) =>
            prev.map((x) => (x.id === editingAssignmentId ? { ...x, tiers: editingTiers } : x))
          );
          setEditingAssignmentId(null);
        }
        // Save prepaid edit
        if (editingPrepaid) {
          const [instName, oldVal] = editingPrepaid.split('::');
          if (editPrepaidVal.trim() && instName && oldVal) {
            updateInstallerPrepaidOption(instName, oldVal, editPrepaidVal.trim());
          }
          setEditingPrepaid(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingInstaller, editInstallerVals, editingAssignmentId, editingTiers, editingPrepaid, editPrepaidVal, updateInstallerBaseline, setTrainerAssignments, updateInstallerPrepaidOption, installerSelectMode, financerSelectMode]);

  // ── Confirm-delete handler ───────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    const { type, id, name } = deleteConfirm;
    setDeleteConfirm(null);

    if (type === 'installer') {
      deletedEntityRef.current = { type: 'installer', name };
      try {
        await deleteInstaller(name);
      } catch {
        toast(`Failed to delete "${name}"`, 'error');
        return;
      }
      if (baselineTab === name) setBaselineTab('standard');
      toast(`"${name}" deleted`, 'info', {
        label: 'Undo',
        onClick: () => {
          const saved = deletedEntityRef.current;
          if (saved?.type === 'installer') addInstaller(saved.name);
        },
      });
    } else if (type === 'financer') {
      try {
        await deleteFinancer(name);
      } catch {
        toast(`Failed to delete "${name}"`, 'error');
        return;
      }
      toast(`"${name}" deleted`, 'info');
    } else if (type === 'trainer') {
      const assignment = trainerAssignments.find((a) => a.id === id);
      if (assignment) {
        deletedEntityRef.current = { type: 'trainer', assignment };
        setTrainerAssignments((prev) => prev.filter((a) => a.id !== id));
        // Persist delete to DB
        fetch('/api/trainer-assignments', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).catch(console.error);
        toast(`Trainer assignment removed`, 'info', {
          label: 'Undo',
          onClick: () => {
            const saved = deletedEntityRef.current;
            if (saved?.type === 'trainer') {
              setTrainerAssignments((prev) => [...prev, saved.assignment]);
            }
          },
        });
      }
    }
  };

  const isMobile = useMediaQuery('(max-width: 767px)');

  if (!isHydrated) return <SettingsSkeleton />;

  if (isMobile) return <MobileSettings />;

  if (currentRole !== 'admin') {
    return (
      <div className="p-8 text-center">
        <p className="text-[#8891a8] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen animate-fade-in-up">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 p-4 pt-8 hidden md:block" style={{ borderRight: '1px solid #272b35' }}>
        <div className="mb-6">
          <div className="h-[3px] w-8 rounded-full mb-3" style={{ background: 'linear-gradient(90deg, #00c4f0, #00e07a)' }} />
          <div className="flex items-center gap-2 mb-0.5">
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(0,196,240,0.15)' }}>
              <Settings className="w-4 h-4" style={{ color: '#00c4f0' }} />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>Settings</h1>
          </div>
          <p className="text-[#8891a8] text-xs ml-8">App configuration</p>
        </div>

        <nav ref={navRef} className="relative space-y-4">
          {/* Animated sliding pill — sits behind buttons (z-index 0) */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              width: '100%',
              borderRadius: '12px',
              background: 'rgba(0,196,240,0.1)',
              transition: 'top 250ms cubic-bezier(0.4, 0, 0.2, 1), height 250ms cubic-bezier(0.4, 0, 0.2, 1)',
              opacity: 1,
              zIndex: 0,
              pointerEvents: 'none',
              top: pillStyle.top,
              height: pillStyle.height,
              boxShadow: '0 0 12px rgba(0,196,240,0.1)',
              border: '1px solid rgba(0,196,240,0.25)',
            }}
          />

          {NAV.map(({ group, items }) => (
            <div key={group}>
              <p className="text-[10px] font-semibold uppercase mb-1 px-2" style={{ color: '#525c72', letterSpacing: '0.12em' }}>{group}</p>
              {items.map(({ id, label, icon: Icon }) => {
                const flatIdx = ALL_NAV_ITEMS.findIndex(item => item.id === id);
                const isActive = section === id;
                return (
                  <button
                    key={id}
                    ref={el => { navBtnRefs.current[flatIdx] = el; }}
                    onClick={() => handleSetSection(id)}
                    className={`relative z-[1] w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 group ${
                      isActive
                        ? 'before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full'
                        : 'hover:bg-[#1d2028]/60'
                    }`}
                    style={isActive ? { color: '#00c4f0' } : { color: '#c2c8d8' }}
                  >
                    <span style={isActive ? { color: '#00c4f0' } : { color: '#525c72' }}><Icon className="w-4 h-4 flex-shrink-0" /></span>
                    <span className="truncate">{label}</span>
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: '#00c4f0' }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile horizontal tab bar */}
      <div className="md:hidden border-b border-[#333849] w-full">
        <div className="flex items-center gap-1 px-3 pt-4 pb-2 overflow-x-auto scrollbar-hide">
          {ALL_NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = section === id;
            return (
              <button
                key={id}
                onClick={() => handleSetSection(id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 shrink-0 ${
                  isActive
                    ? 'bg-[#00e07a]/20 text-[#00e07a] border border-[#00e07a]/30 shadow-sm shadow-blue-500/10'
                    : 'text-[#c2c8d8] hover:text-white hover:bg-[#1d2028]/60 border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#00e07a]' : 'text-[#8891a8]'}`} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content panel */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto">

        {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
        {(() => {
          const currentNav = ALL_NAV_ITEMS.find(item => item.id === section);
          if (!currentNav) return null;
          const NavIcon = currentNav.icon;
          return (
            <div className="flex items-center gap-1.5 text-xs text-[#8891a8] mb-4">
              <Settings className="w-3 h-3 text-[#525c72]" />
              <span>Settings</span>
              <ChevronRight className="w-3 h-3 text-[#525c72]" />
              <NavIcon className="w-3 h-3 text-[#00e07a]" />
              <span className="text-[#c2c8d8] font-medium">{currentNav.label}</span>
            </div>
          );
        })()}

        {/* ── Settings Summary Dashboard ────────────────────────────────────── */}
        {editingInstaller === null && editingAssignmentId === null && editingPrepaid === null && (() => {
          const activeInstallerCount = installers.filter((i) => i.active).length;
          const activeFinancerCount = financers.filter((f) => f.active && !hiddenFinancers.has(f.name)).length;
          const trainerCount = trainerAssignments.length;
          const adminCount = adminUsers.length;
          return (
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              {[
                { label: 'Active Installers', value: activeInstallerCount, color: 'text-[#00e07a]', bg: 'bg-[#00e07a]/10 border-[#00e07a]/20' },
                { label: 'Active Financers', value: activeFinancerCount, color: 'text-[#00e07a]', bg: 'bg-[#00e07a]/10 border-[#00e07a]/20' },
                { label: 'Trainer Assignments', value: trainerCount, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
                { label: 'Admin Users', value: adminCount, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={`${bg} border rounded-xl px-3 py-1.5 flex items-center gap-2`}>
                  <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
                  <span className="text-xs text-[#c2c8d8]">{label}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Trainer Overrides ────────────────────────────────────────────────── */}
        {section === 'trainers' && (() => {
          // Build enriched rows once for stats + filtering + sorting + pagination
          const enrichedRows = trainerAssignments.map((a) => {
            const trainee = reps.find((r) => r.id === a.traineeId);
            const trainer = reps.find((r) => r.id === a.trainerId);
            const completedDeals = projects.filter((p) => p.repId === a.traineeId || p.setterId === a.traineeId).length;
            const currentRate = getTrainerOverrideRate(a, completedDeals);
            const activeTierIndex = a.tiers.findIndex((t) => t.upToDeal === null || completedDeals < t.upToDeal);
            const tierLabel = activeTierIndex >= 0 ? `Tier ${activeTierIndex + 1} of ${a.tiers.length}` : `Tier ${a.tiers.length}`;
            return { a, trainee, trainer, completedDeals, currentRate, activeTierIndex, tierLabel };
          });

          // Stats
          const uniqueTrainers = new Set(trainerAssignments.map((a) => a.trainerId)).size;
          const avgRate = enrichedRows.length > 0
            ? enrichedRows.reduce((sum, r) => sum + r.currentRate, 0) / enrichedRows.length
            : 0;

          // Filter
          const filtered = enrichedRows.filter(({ trainee, trainer }) => {
            if (!trainerSearch) return true;
            const q = trainerSearch.toLowerCase();
            return (trainee?.name ?? '').toLowerCase().includes(q) || (trainer?.name ?? '').toLowerCase().includes(q);
          });

          // Sort
          const sorted = [...filtered].sort((a, b) => {
            const dir = trainerSortDir === 'asc' ? 1 : -1;
            if (trainerSortKey === 'trainee') return dir * (a.trainee?.name ?? '').localeCompare(b.trainee?.name ?? '');
            if (trainerSortKey === 'trainer') return dir * (a.trainer?.name ?? '').localeCompare(b.trainer?.name ?? '');
            if (trainerSortKey === 'rate') return dir * (a.currentRate - b.currentRate);
            return dir * (a.completedDeals - b.completedDeals);
          });

          // Pagination
          const totalPages = Math.max(1, Math.ceil(sorted.length / trainerRowsPerPage));
          const safePage = Math.min(trainerPage, totalPages);
          const startIdx = (safePage - 1) * trainerRowsPerPage;
          const endIdx = Math.min(startIdx + trainerRowsPerPage, sorted.length);
          const pageRows = sorted.slice(startIdx, endIdx);

          // Initials helper
          const getInitials = (name: string) => name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

          return (
          <div key={section} className="animate-tab-enter max-w-4xl space-y-4">
            <SectionHeader title="Trainer Overrides" subtitle="Assign trainers and configure tiered override rates" />

            {/* Create new assignment */}
            <div className="card-surface rounded-2xl p-5">
              <h2 className="text-white font-semibold mb-4">Assign Trainer to Rep</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[#c2c8d8] mb-1">Trainee (Rep)</label>
                  <SearchableSelect
                    value={newTraineeId}
                    onChange={(v) => setNewTraineeId(v)}
                    placeholder="Select rep..."
                    options={reps.filter((r) => !trainerAssignments.some((a) => a.traineeId === r.id)).map((r) => ({ value: r.id, label: r.name, sub: r.repType }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-[#c2c8d8] mb-1">Trainer</label>
                  <SearchableSelect
                    value={newTrainerId}
                    onChange={(v) => setNewTrainerId(v)}
                    placeholder="Select trainer..."
                    options={reps.filter((r) => r.id !== newTraineeId).map((r) => ({ value: r.id, label: r.name, sub: r.repType }))}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={async () => {
                      if (!newTraineeId || !newTrainerId) return;
                      const tiers = [
                        { upToDeal: 10,   ratePerW: 0.20 },
                        { upToDeal: 25,   ratePerW: 0.10 },
                        { upToDeal: null, ratePerW: 0.05 },
                      ];
                      const tempId = `ta_${Date.now()}`;
                      setTrainerAssignments((prev) => [...prev, { id: tempId, trainerId: newTrainerId, traineeId: newTraineeId, tiers }]);
                      setNewTraineeId('');
                      setNewTrainerId('');
                      // Persist to DB
                      try {
                        const res = await fetch('/api/trainer-assignments', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ trainerId: newTrainerId, traineeId: newTraineeId, tiers }),
                        });
                        if (res.ok) {
                          const saved = await res.json();
                          setTrainerAssignments((prev) => prev.map((a) => a.id === tempId ? { ...a, id: saved.id } : a));
                        }
                      } catch (e) { console.error('Failed to persist trainer assignment:', e); }
                    }}
                    className="btn-primary text-black px-3 py-2 rounded-xl active:scale-[0.97]"
                    style={{ backgroundColor: 'var(--brand)' }}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-[#8891a8] mt-2">Default tiers: $0.20/W (deals 1-10) &rarr; $0.10/W (11-25) &rarr; $0.05/W (26+)</p>
            </div>

            {trainerAssignments.length === 0 ? (
              <div className="card-surface rounded-2xl p-5 border border-[#333849]/60">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 flex-shrink-0">
                    <Layers className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm mb-1">What are trainer overrides?</p>
                    <p className="text-[#c2c8d8] text-xs leading-relaxed">
                      When a rep is assigned a trainer, the trainer earns an override commission on every deal the trainee closes. Override rates are tiered and decrease as the trainee gains experience. Use the form above to create your first assignment.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Summary stats */}
                <div className="card-surface rounded-2xl p-4 flex items-center gap-6 mb-1 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#8891a8] uppercase tracking-wider font-semibold">Active Assignments</p>
                      <p className="text-white font-bold text-lg leading-tight">{trainerAssignments.length}</p>
                    </div>
                  </div>
                  <div className="w-px h-8 bg-[#1d2028]" />
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-[#00e07a]/10">
                      <Users className="w-3.5 h-3.5 text-[#00e07a]" />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#8891a8] uppercase tracking-wider font-semibold">Unique Trainers</p>
                      <p className="text-white font-bold text-lg leading-tight">{uniqueTrainers}</p>
                    </div>
                  </div>
                  <div className="w-px h-8 bg-[#1d2028]" />
                  <div>
                    <p className="text-[10px] text-[#8891a8] uppercase tracking-wider font-semibold">Avg Override Rate</p>
                    <p className="text-amber-400 font-bold text-lg leading-tight">${avgRate.toFixed(2)}/W</p>
                  </div>
                </div>

                {/* Search + sort */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8]" />
                    <input
                      ref={trainerSearchRef}
                      type="text" placeholder='Search trainee or trainer...  press "/" to focus'
                      value={trainerSearch}
                      onChange={(e) => { setTrainerSearch(e.target.value); setTrainerPage(1); }}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setTrainerSearch(''); (e.target as HTMLInputElement).blur(); } }}
                      className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                    />
                    {trainerSearch && (
                      <button onClick={() => { setTrainerSearch(''); setTrainerPage(1); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8891a8] hover:text-white transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {trainerSearch && (
                    <span className="text-xs text-[#8891a8] bg-[#1d2028] px-2 py-0.5 rounded-full">{sorted.length} result{sorted.length !== 1 ? 's' : ''}</span>
                  )}
                  <select
                    value={`${trainerSortKey}-${trainerSortDir}`}
                    onChange={(e) => {
                      const [key, dir] = e.target.value.split('-') as [TrainerSortKey, 'asc' | 'desc'];
                      setTrainerSortKey(key);
                      setTrainerSortDir(dir);
                    }}
                    className="bg-[#1d2028] border border-[#333849] text-[#c2c8d8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                  >
                    <option value="trainee-asc">Trainee A-Z</option>
                    <option value="trainee-desc">Trainee Z-A</option>
                    <option value="trainer-asc">Trainer A-Z</option>
                    <option value="trainer-desc">Trainer Z-A</option>
                    <option value="deals-desc">Most Deals</option>
                    <option value="deals-asc">Fewest Deals</option>
                    <option value="rate-desc">Highest Rate</option>
                    <option value="rate-asc">Lowest Rate</option>
                  </select>
                </div>

                {/* Compact table */}
                <div className="card-surface rounded-2xl overflow-hidden">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_1fr_70px_90px_100px_72px] gap-2 px-4 py-2.5 border-b border-[#333849] text-[10px] text-[#8891a8] uppercase tracking-wider font-semibold">
                    <span>Trainee</span>
                    <span>Trainer</span>
                    <span className="text-center">Deals</span>
                    <span className="text-center">Rate</span>
                    <span className="text-center">Tier</span>
                    <span></span>
                  </div>
                  {pageRows.length === 0 && (
                    <div className="px-4 py-8 text-center text-[#8891a8] text-sm">
                      No assignments match your search.
                    </div>
                  )}
                  {pageRows.map(({ a, trainee, trainer, completedDeals, currentRate, tierLabel }) => {
                    const isEditing = editingAssignmentId === a.id;
                    return (
                      <div key={a.id}>
                        {/* Compact row */}
                        <div className={`grid grid-cols-[1fr_1fr_70px_90px_100px_72px] gap-2 px-4 py-2.5 items-center text-sm border-b border-[#333849]/50 transition-colors ${isEditing ? 'bg-[#1d2028]/40' : 'hover:bg-[#1d2028]/30'}`}>
                          {/* Trainee */}
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-[#00e07a]/20 text-[#00e07a] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {getInitials(trainee?.name ?? '??')}
                            </div>
                            <Link href={`/dashboard/users/${a.traineeId}`} className="text-white truncate hover:text-[#00c4f0] transition-colors">{trainee?.name ?? 'Unknown'}</Link>
                          </div>
                          {/* Trainer */}
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {getInitials(trainer?.name ?? '??')}
                            </div>
                            <Link href={`/dashboard/users/${a.trainerId}`} className="text-[#c2c8d8] truncate hover:text-[#00c4f0] transition-colors">{trainer?.name ?? 'Unknown'}</Link>
                          </div>
                          {/* Deals */}
                          <span className="text-center text-[#c2c8d8]">{completedDeals}</span>
                          {/* Rate */}
                          <span className="text-center text-amber-400 font-medium">${currentRate.toFixed(2)}/W</span>
                          {/* Tier */}
                          <span className="text-center text-[#c2c8d8] text-xs">{tierLabel}</span>
                          {/* Actions */}
                          <div className="flex items-center justify-end gap-1.5">
                            {!isEditing ? (
                              <>
                                <button
                                  onClick={() => { setEditingAssignmentId(a.id); setEditingTiers([...a.tiers]); }}
                                  className="p-1.5 rounded-lg text-[#8891a8] hover:text-white hover:bg-[#272b35]/60 transition-colors"
                                  title="Edit tiers"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    const traineeName = reps.find((r) => r.id === a.traineeId)?.name ?? 'this assignment';
                                    setDeleteConfirm({
                                      type: 'trainer',
                                      id: a.id,
                                      name: traineeName,
                                      message: 'This will remove the trainer-trainee relationship. Both accounts remain active.',
                                    });
                                  }}
                                  className="p-1.5 rounded-lg text-[#525c72] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Delete assignment"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setTrainerAssignments((prev) =>
                                      prev.map((x) => (x.id === a.id ? { ...x, tiers: editingTiers } : x))
                                    );
                                    setEditingAssignmentId(null);
                                    // Persist tier edits to DB
                                    fetch('/api/trainer-assignments', {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: a.id, tiers: editingTiers }),
                                    }).catch(console.error);
                                  }}
                                  className="p-1.5 rounded-lg text-[#00e07a] hover:text-[#00c4f0] hover:bg-[#00e07a]/10 transition-colors"
                                  title="Save"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingAssignmentId(null)}
                                  className="p-1.5 rounded-lg text-[#8891a8] hover:text-[#c2c8d8] hover:bg-[#272b35]/60 transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Inline tier editor (expands below row when editing) */}
                        {isEditing && (
                          <div className="px-4 py-3 bg-[#1d2028]/30 border-b border-[#333849]/50 space-y-1.5">
                            {editingTiers.map((tier, i) => (
                              <div key={i} className="flex items-center gap-3 rounded px-3 py-2 text-sm bg-[#1d2028]/50">
                                <span className="text-[#8891a8] text-xs w-12">Tier {i + 1}</span>
                                <span className="text-[#8891a8] text-xs">Up to deal</span>
                                <input
                                  type="number" min="1" placeholder="Infinity"
                                  value={tier.upToDeal ?? ''}
                                  onChange={(e) =>
                                    setEditingTiers((prev) =>
                                      prev.map((t, idx) =>
                                        idx === i ? { ...t, upToDeal: e.target.value === '' ? null : parseInt(e.target.value) || null } : t
                                      )
                                    )
                                  }
                                  disabled={i === editingTiers.length - 1}
                                  className="w-16 bg-[#272b35] border border-[#272b35] text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-40"
                                />
                                <span className="text-[#8891a8] text-xs">$</span>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={tier.ratePerW}
                                  onChange={(e) =>
                                    setEditingTiers((prev) =>
                                      prev.map((t, idx) =>
                                        idx === i ? { ...t, ratePerW: parseFloat(e.target.value) || 0 } : t
                                      )
                                    )
                                  }
                                  className="w-16 bg-[#272b35] border border-[#272b35] text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                                />
                                <span className="text-[#8891a8] text-xs">/W</span>
                                <button
                                  onClick={() => {
                                    if (editingTiers.length <= 1) return;
                                    setEditingTiers((prev) => {
                                      const next = prev.filter((_, idx) => idx !== i);
                                      if (next[next.length - 1].upToDeal !== null) {
                                        next[next.length - 1] = { ...next[next.length - 1], upToDeal: null };
                                      }
                                      return next;
                                    });
                                  }}
                                  disabled={editingTiers.length <= 1}
                                  className="text-[#525c72] hover:text-red-400 transition-colors disabled:opacity-30"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                setEditingTiers((prev) => {
                                  const updated = prev.map((t, i) =>
                                    i === prev.length - 1 && t.upToDeal === null
                                      ? { ...t, upToDeal: completedDeals + 10 }
                                      : t
                                  );
                                  return [...updated, { upToDeal: null, ratePerW: 0.05 }];
                                });
                              }}
                              className="flex items-center gap-1 text-[#c2c8d8] hover:text-white text-xs mt-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Add tier
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Pagination */}
                  {sorted.length > trainerRowsPerPage && (
                    <PaginationBar
                      totalResults={sorted.length}
                      startIdx={startIdx + 1}
                      endIdx={endIdx}
                      currentPage={safePage}
                      totalPages={totalPages}
                      rowsPerPage={trainerRowsPerPage}
                      onPageChange={setTrainerPage}
                      onRowsPerPageChange={setTrainerRowsPerPage}
                    />
                  )}
                </div>
              </>
            )}
          </div>
          );
        })()}

        {/* ── Blitz Permissions ──────────────────────────────────────────────── */}
        {section === 'blitz-permissions' && (
          <BlitzPermissionsSection reps={reps} />
        )}

        {/* ── Installers ───────────────────────────────────────────────────────── */}
        {section === 'installers' && (
          <div key={section} className="animate-tab-enter max-w-xl">
            <SectionHeader title="Installers" subtitle="Manage active and archived installation companies" />
            <div className="card-surface rounded-2xl p-5 mb-4">
              <h2 className="text-white font-semibold mb-3">Add Installer</h2>
              {(() => {
                const installerDup = newInstaller.trim().length > 0 && installers.some((i) => i.name.toLowerCase() === newInstaller.trim().toLowerCase());
                return (<>
              <input
                type="text" placeholder="Installer name"
                value={newInstaller}
                onChange={(e) => setNewInstaller(e.target.value)}
                className={`w-full ${installerDup ? 'mb-1' : 'mb-3'} bg-[#1d2028] border ${installerDup ? 'border-red-500 focus:ring-red-500' : 'border-[#272b35] focus:ring-[#00e07a]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 placeholder-[#525c72]`}
              />
              {installerDup && <p className="text-red-400 text-[10px] mb-2">Already exists</p>}
              {/* Pricing structure selector */}
              <div className="flex gap-2 mb-3">
                {(['standard', 'product-catalog'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setNewInstallerStructure(s)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      newInstallerStructure === s
                        ? 'bg-[#00e07a]/20 border-[#00e07a] text-[#00c4f0]'
                        : 'bg-[#1d2028] border-[#272b35] text-[#c2c8d8] hover:text-white'
                    }`}
                  >
                    {s === 'standard' ? 'Standard (Flat Rate)' : 'Product Catalog'}
                  </button>
                ))}
              </div>
              {newInstallerStructure === 'standard' ? (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-[#8891a8] mb-1">Closer $/W</label>
                    <input type="number" step="0.01" min="0" placeholder="2.90"
                      value={newInstallerCloser} onChange={(e) => setNewInstallerCloser(e.target.value)}
                      className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8891a8] mb-1">Kilo $/W</label>
                    <input type="number" step="0.01" min="0" placeholder="2.35"
                      value={newInstallerKilo} onChange={(e) => setNewInstallerKilo(e.target.value)}
                      className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                    />
                  </div>
                </div>
              ) : (
                <div className="mb-3 space-y-2">
                  <p className="text-xs text-[#8891a8] mb-2">Add product families (you can add products after creating the installer)</p>
                  {newPcFamilies.map((fam, i) => (
                    <div key={i} className="grid grid-cols-[1fr_28px] gap-2 items-center">
                      <input type="text" placeholder="Family name (e.g. Goodleap)"
                        value={fam}
                        onChange={(e) => setNewPcFamilies((prev) => prev.map((f, j) => j === i ? e.target.value : f))}
                        className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                      />
                      <button onClick={() => {
                        if (newPcFamilies.length <= 1) return;
                        setNewPcFamilies((prev) => prev.filter((_, j) => j !== i));
                      }} disabled={newPcFamilies.length <= 1} className="text-[#525c72] hover:text-red-400 disabled:opacity-30 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setNewPcFamilies((prev) => [...prev, ''])}
                    className="flex items-center gap-1 text-[#c2c8d8] hover:text-white text-xs transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add family
                  </button>
                </div>
              )}
              <button
                disabled={!newInstaller.trim() || installerDup}
                onClick={() => {
                  if (!newInstaller.trim() || installerDup) return;
                  const name = newInstaller.trim();
                  if (newInstallerStructure === 'standard') {
                    const closerRate = parseFloat(newInstallerCloser) || 2.90;
                    const kiloRate = parseFloat(newInstallerKilo) || 2.35;
                    addInstaller(name, { closerPerW: closerRate, kiloPerW: kiloRate });
                    const usedCustom = newInstallerCloser.trim() || newInstallerKilo.trim();
                    toast(usedCustom ? `Added ${name} with rates $${closerRate.toFixed(2)}/$${kiloRate.toFixed(2)}` : `Added ${name} with default rates`, 'success');
                  } else {
                    const families = newPcFamilies.filter((f) => f.trim());
                    const config: ProductCatalogInstallerConfig = { families };
                    addProductCatalogInstaller(name, config);
                    setBaselineTab(name);
                  }
                  setNewInstaller('');
                  setNewInstallerCloser('');
                  setNewInstallerKilo('');
                  setNewInstallerStructure('standard');
                  setNewPcFamilies(['']);
                }}
                className="w-full flex items-center justify-center gap-2 text-white text-sm font-medium py-2 rounded-xl active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                <Plus className="w-4 h-4" /> Add Installer
              </button>
              <p className="text-xs text-[#525c72] mt-2">Standard: flat rate · Product Catalog: SolarTech-style per-product pricing</p>
              </>); })()}
            </div>

            {installers.length === 0 && (
              <div className="card-surface rounded-2xl p-5 border border-[#333849]/60">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#00e07a]/10 flex-shrink-0">
                    <Building2 className="w-4 h-4 text-[#00e07a]" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm mb-1">No installers yet</p>
                    <p className="text-[#c2c8d8] text-xs leading-relaxed">
                      Installers are the companies that handle solar panel installation. Add your first installer above to start configuring pricing baselines and creating deals.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {installers.some((i) => i.active) && (() => {
              const activeInstallers = installers.filter((i) => i.active);
              const filteredActive = installerSearch
                ? activeInstallers.filter((i) => i.name.toLowerCase().includes(installerSearch.toLowerCase()))
                : activeInstallers;
              return (
              <div className="mb-4">
                <div className="flex items-center gap-3 mb-2 px-1">
                  <p className="text-xs font-semibold text-[#8891a8] uppercase tracking-wider">Active</p>
                  <span className="text-[10px] text-[#525c72] tabular-nums">{filteredActive.length} of {activeInstallers.length} installers</span>
                  <button
                    onClick={() => { setInstallerSelectMode((v) => !v); setSelectedInstallers(new Set()); }}
                    className={`ml-auto flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg border transition-colors ${
                      installerSelectMode
                        ? 'bg-[#00e07a]/15 border-[#00e07a]/30 text-[#00e07a]'
                        : 'bg-[#1d2028] border-[#272b35] text-[#8891a8] hover:text-white'
                    }`}
                  >
                    <ListChecks className="w-3 h-3" /> {installerSelectMode ? 'Done' : 'Select'}
                  </button>
                </div>
                {installerSelectMode && filteredActive.length > 0 && (
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <button
                      onClick={() => {
                        if (selectedInstallers.size === filteredActive.length) setSelectedInstallers(new Set());
                        else setSelectedInstallers(new Set(filteredActive.map((i) => i.name)));
                      }}
                      className="flex items-center gap-1.5 text-xs text-[#c2c8d8] hover:text-white transition-colors"
                    >
                      {selectedInstallers.size === filteredActive.length
                        ? <CheckSquare className="w-3.5 h-3.5 text-[#00e07a]" />
                        : <Square className="w-3.5 h-3.5" />}
                      Select all
                    </button>
                  </div>
                )}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8]" />
                  <input
                    type="text" placeholder="Search installers..."
                    value={installerSearch}
                    onChange={(e) => setInstallerSearch(e.target.value)}
                    className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                  />
                </div>
                <div className="space-y-2">
                  {filteredActive.map((inst) => {
                    const instPrepaid = getInstallerPrepaidOptions(inst.name);
                    const isExpanded = prepaidInstallerExpanded === inst.name;
                    return (
                      <div key={inst.name} className={`card-surface rounded-xl overflow-hidden ${installerSelectMode && selectedInstallers.has(inst.name) ? 'ring-1 ring-[#00e07a]/40' : ''}`}>
                        <div className="px-4 py-3 flex items-center justify-between group">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {installerSelectMode && (
                              <button
                                onClick={() => setSelectedInstallers((prev) => {
                                  const next = new Set(prev);
                                  next.has(inst.name) ? next.delete(inst.name) : next.add(inst.name);
                                  return next;
                                })}
                                className="flex-shrink-0"
                              >
                                {selectedInstallers.has(inst.name)
                                  ? <CheckSquare className="w-4 h-4 text-[#00e07a]" />
                                  : <Square className="w-4 h-4 text-[#525c72]" />}
                              </button>
                            )}
                            <div>
                              <p className="text-white text-sm font-medium">{inst.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {productCatalogInstallerConfigs[inst.name] && (
                                  <span className="text-[10px] text-[#00e07a]/70">Product Catalog</span>
                                )}
                                {instPrepaid.length > 0 && (
                                  <span className="text-[10px] text-violet-400/70">Prepaid: {instPrepaid.join(', ')}</span>
                                )}
                              </div>
                              {(() => {
                                const usedFinancers = Array.from(new Set(projects.filter((p) => p.installer === inst.name).map((p) => p.financer))).filter(Boolean);
                                return usedFinancers.length > 0 ? (
                                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                                    <span className="text-[9px] text-[#525c72] mr-0.5">Used with:</span>
                                    {usedFinancers.map((f) => (
                                      <span key={f} className="text-[9px] text-[#8891a8] bg-[#1d2028]/80 border border-[#272b35]/50 px-1.5 py-0.5 rounded-full">{f}</span>
                                    ))}
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                            <button
                              onClick={() => {
                                const opening = payScheduleExpanded !== inst.name;
                                setPayScheduleExpanded(opening ? inst.name : null);
                                if (opening) {
                                  const pct = installerPayConfigs[inst.name]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
                                  setEditPayPct(String(pct));
                                  setPrepaidInstallerExpanded(null);
                                }
                              }}
                              title="Configure pay schedule"
                              className={`transition-colors ${payScheduleExpanded === inst.name ? 'text-[#00e07a]' : 'text-[#525c72] hover:text-[#00e07a] opacity-0 group-hover:opacity-100'}`}
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { setPrepaidInstallerExpanded(isExpanded ? null : inst.name); setNewPrepaidOption(''); setEditingPrepaid(null); setPayScheduleExpanded(null); }}
                              title="Configure prepaid options"
                              className={`transition-colors ${isExpanded ? 'text-violet-400' : 'text-[#525c72] hover:text-violet-400 opacity-0 group-hover:opacity-100'}`}
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setInstallerActive(inst.name, false)}
                              title="Archive installer"
                              className="text-[#525c72] hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                // Count exactly what cascades out when this
                                // installer is deleted. The schema's
                                // onDelete: Cascade on Product/InstallerPricing
                                // means ALL rows pointing at this installer
                                // go with it — we want the admin to see the
                                // real blast radius, not a vague warning.
                                const isSolarTech = inst.name === 'SolarTech';
                                const productCount = isSolarTech
                                  ? solarTechProducts.length
                                  : productCatalogProducts.filter((p) => p.installer === inst.name).length;
                                const versionCount = installerPricingVersions.filter((v) => v.installer === inst.name).length;
                                const parts: string[] = [];
                                if (productCount > 0) parts.push(`${productCount} product${productCount === 1 ? '' : 's'}`);
                                if (versionCount > 0) parts.push(`${versionCount} pricing version${versionCount === 1 ? '' : 's'}`);
                                const cascadeDetail = parts.length > 0
                                  ? `This will PERMANENTLY delete ${parts.join(' and ')} along with every baseline tier underneath them. This cannot be undone from the UI.\n\nExisting deals that reference this installer will remain but will no longer have a pricing source.`
                                  : 'This installer has no products or pricing configured yet. Existing deals referencing it (if any) will remain, but you will not be able to create new deals with this installer.';
                                setDeleteConfirm({
                                  type: 'installer',
                                  id: inst.name,
                                  name: inst.name,
                                  message: cascadeDetail,
                                });
                              }}
                              title="Permanently delete installer"
                              className="text-[#525c72] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Expandable prepaid options panel */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-[#333849]/50">
                            <p className="text-xs font-semibold text-violet-400/80 uppercase tracking-wider mb-2">Prepaid Options</p>
                            {instPrepaid.length > 0 && (
                              <div className="space-y-1.5 mb-3">
                                {instPrepaid.map((opt) => (
                                  <div key={opt} className="flex items-center justify-between bg-[#1d2028]/50 rounded-lg px-3 py-2 group/item">
                                    {editingPrepaid === `${inst.name}::${opt}` ? (
                                      <div className="flex items-center gap-2 flex-1 mr-2">
                                        <input type="text" value={editPrepaidVal}
                                          onChange={(e) => setEditPrepaidVal(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && editPrepaidVal.trim()) { updateInstallerPrepaidOption(inst.name, opt, editPrepaidVal.trim()); setEditingPrepaid(null); }
                                            if (e.key === 'Escape') setEditingPrepaid(null);
                                          }}
                                          autoFocus
                                          className="flex-1 bg-[#272b35] border border-[#272b35] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                        />
                                        <button onClick={() => { if (editPrepaidVal.trim()) { updateInstallerPrepaidOption(inst.name, opt, editPrepaidVal.trim()); setEditingPrepaid(null); } }}
                                          className="text-[#00e07a] hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => setEditingPrepaid(null)}
                                          className="text-[#8891a8] hover:text-[#c2c8d8]"><X className="w-3.5 h-3.5" /></button>
                                      </div>
                                    ) : (
                                      <>
                                        <span className="text-white text-xs font-medium">{opt}</span>
                                        <div className="flex items-center gap-1.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                          <button onClick={() => { setEditingPrepaid(`${inst.name}::${opt}`); setEditPrepaidVal(opt); }}
                                            className="text-[#8891a8] hover:text-[#00e07a] transition-colors"><Pencil className="w-3 h-3" /></button>
                                          <button onClick={() => removeInstallerPrepaidOption(inst.name, opt)}
                                            className="text-[#8891a8] hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <input type="text" placeholder="New option (e.g. HDM)"
                                value={newPrepaidOption}
                                onChange={(e) => setNewPrepaidOption(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newPrepaidOption.trim()) { addInstallerPrepaidOption(inst.name, newPrepaidOption.trim()); setNewPrepaidOption(''); }
                                }}
                                className="flex-1 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                              />
                              <button
                                onClick={() => { if (newPrepaidOption.trim()) { addInstallerPrepaidOption(inst.name, newPrepaidOption.trim()); setNewPrepaidOption(''); } }}
                                className="text-violet-400 hover:text-violet-300 transition-colors px-2"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {instPrepaid.length === 0 && (
                              <p className="text-[10px] text-[#525c72] mt-1.5">No prepaid options yet. Add one to enable prepaid tracking for this installer.</p>
                            )}
                          </div>
                        )}

                        {/* Expandable pay schedule panel */}
                        {payScheduleExpanded === inst.name && (() => {
                          const currentPct = installerPayConfigs[inst.name]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
                          const remainder = 100 - currentPct;
                          return (
                            <div className="px-4 pb-4 pt-1 border-t border-[#333849]/50">
                              <p className="text-xs font-semibold text-[#00e07a]/80 uppercase tracking-wider mb-2">Pay Schedule</p>
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-xs text-[#c2c8d8] mb-1">Install payment %</label>
                                  <input
                                    type="number" min="0" max="100" step="1"
                                    value={editPayPct}
                                    onChange={(e) => {
                                      setEditPayPct(e.target.value);
                                      const val = parseInt(e.target.value);
                                      if (!isNaN(val) && val >= 0 && val <= 100) {
                                        updateInstallerPayConfig(inst.name, val);
                                      }
                                    }}
                                    className="w-24 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                  />
                                  <p className="text-[10px] text-[#525c72] mt-1">% paid at Installed. Remainder paid at PTO (M3).</p>
                                </div>
                                <div className="bg-[#1d2028]/50 rounded-lg px-3 py-2">
                                  <p className="text-xs text-[#c2c8d8] font-medium">
                                    M2: <span className="text-[#00e07a]">{currentPct}%</span> at Install
                                    <span className="text-[#525c72] mx-1.5">&middot;</span>
                                    M3: <span className="text-[#00e07a]">{remainder}%</span> at PTO
                                  </p>
                                  {remainder === 0 && (
                                    <p className="text-[10px] text-[#525c72] mt-0.5">Full payment at install — no M3 created.</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {installers.some((i) => !i.active) && (() => {
              const archivedInstallers = installers.filter((i) => !i.active);
              return (
              <div>
                <button
                  onClick={() => setArchivedInstallersOpen((v) => !v)}
                  className="flex items-center gap-2 mb-2 px-1 w-full text-left group"
                >
                  {archivedInstallersOpen
                    ? <ChevronDown className="w-3.5 h-3.5 text-[#525c72]" />
                    : <ChevronRight className="w-3.5 h-3.5 text-[#525c72]" />}
                  <p className="text-xs font-semibold text-[#525c72] uppercase tracking-wider">Archived</p>
                  <span className="text-[10px] font-medium text-[#525c72] bg-[#1d2028] border border-[#333849]/50 px-1.5 py-0.5 rounded-full">
                    {archivedInstallers.length}
                  </span>
                  {installerSelectMode && archivedInstallers.length > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        const archivedNames = archivedInstallers.map((i) => i.name);
                        const allSelected = archivedNames.every((n) => selectedInstallers.has(n));
                        setSelectedInstallers((prev) => {
                          const next = new Set(prev);
                          archivedNames.forEach((n) => allSelected ? next.delete(n) : next.add(n));
                          return next;
                        });
                      }}
                      className="flex items-center gap-1.5 text-xs text-[#8891a8] hover:text-white transition-colors ml-auto"
                    >
                      {archivedInstallers.every((i) => selectedInstallers.has(i.name))
                        ? <CheckSquare className="w-3.5 h-3.5 text-[#00e07a]" />
                        : <Square className="w-3.5 h-3.5" />}
                      Select all
                    </span>
                  )}
                </button>
                {archivedInstallersOpen && (
                <div className="grid grid-cols-2 gap-2">
                  {archivedInstallers.map((inst) => (
                    <div key={inst.name} className={`bg-[#161920]/50 border border-[#333849]/50 rounded-xl px-4 py-3 flex items-center justify-between group ${installerSelectMode && selectedInstallers.has(inst.name) ? 'ring-1 ring-[#00e07a]/40' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {installerSelectMode && (
                          <button
                            onClick={() => setSelectedInstallers((prev) => {
                              const next = new Set(prev);
                              next.has(inst.name) ? next.delete(inst.name) : next.add(inst.name);
                              return next;
                            })}
                            className="flex-shrink-0"
                          >
                            {selectedInstallers.has(inst.name)
                              ? <CheckSquare className="w-4 h-4 text-[#00e07a]" />
                              : <Square className="w-4 h-4 text-[#525c72]" />}
                          </button>
                        )}
                        <p className="text-[#525c72] text-sm line-through">{inst.name}</p>
                      </div>
                      {!installerSelectMode && (
                      <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setInstallerActive(inst.name, true)}
                          title="Restore installer"
                          className="text-[#525c72] hover:text-[#00e07a] transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({
                            type: 'installer',
                            id: inst.name,
                            name: inst.name,
                            message: productCatalogInstallerConfigs[inst.name]
                              ? 'This will also remove all associated product catalog products and pricing data. Existing deals are unaffected.'
                              : 'This will not affect existing projects but will prevent new deals with this installer.',
                          })}
                          title="Permanently delete installer"
                          className="text-[#525c72] hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
              );
            })()}
          </div>
        )}

        {/* ── Financers ────────────────────────────────────────────────────────── */}
        {section === 'financers' && (
          <div key={section} className="animate-tab-enter max-w-xl">
            <SectionHeader title="Financers" subtitle="Manage active and archived financing partners" />
            <div className="card-surface rounded-2xl p-5 mb-4">
              <h2 className="text-white font-semibold mb-3">Add Financer</h2>
              {(() => {
                const financerDup = newFinancer.trim().length > 0 && financers.some((f) => f.name.toLowerCase() === newFinancer.trim().toLowerCase());
                return (<>
              <div className="flex gap-3">
                <div className="flex-1">
                  <input
                    type="text" placeholder="Financer name"
                    value={newFinancer}
                    onChange={(e) => setNewFinancer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newFinancer.trim() && !financerDup) { addFinancer(newFinancer.trim()); setNewFinancer(''); }
                    }}
                    className={`w-full bg-[#1d2028] border ${financerDup ? 'border-red-500 focus:ring-red-500' : 'border-[#272b35] focus:ring-[#00e07a]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 placeholder-[#525c72]`}
                  />
                  {financerDup && <p className="text-red-400 text-[10px] mt-1">Already exists</p>}
                </div>
                <button
                  disabled={!newFinancer.trim() || financerDup}
                  onClick={() => { if (newFinancer.trim() && !financerDup) { addFinancer(newFinancer.trim()); setNewFinancer(''); } }}
                  className="btn-primary text-black px-3 py-2 rounded-xl active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              </>); })()}
            </div>

            {financers.filter((f) => !hiddenFinancers.has(f.name)).length === 0 && (
              <div className="card-surface rounded-2xl p-5 border border-[#333849]/60">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#00e07a]/10 flex-shrink-0">
                    <Landmark className="w-4 h-4 text-[#00e07a]" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm mb-1">No financers yet</p>
                    <p className="text-[#c2c8d8] text-xs leading-relaxed">
                      Financers are the lending partners that fund solar installations. Add your first financer above to make it available in the deal form.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {financers.some((f) => f.active && !hiddenFinancers.has(f.name)) && (() => {
              const activeFinancers = financers.filter((f) => f.active && !hiddenFinancers.has(f.name));
              const filteredActiveFinancers = financerSearch
                ? activeFinancers.filter((f) => f.name.toLowerCase().includes(financerSearch.toLowerCase()))
                : activeFinancers;
              return (
              <div className="mb-4">
                <div className="flex items-center gap-3 mb-2 px-1">
                  <p className="text-xs font-semibold text-[#8891a8] uppercase tracking-wider">Active</p>
                  <span className="text-[10px] text-[#525c72] tabular-nums">{filteredActiveFinancers.length} of {activeFinancers.length} financers</span>
                  <button
                    onClick={() => { setFinancerSelectMode((v) => !v); setSelectedFinancers(new Set()); }}
                    className={`ml-auto flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg border transition-colors ${
                      financerSelectMode
                        ? 'bg-[#00e07a]/15 border-[#00e07a]/30 text-[#00e07a]'
                        : 'bg-[#1d2028] border-[#272b35] text-[#8891a8] hover:text-white'
                    }`}
                  >
                    <ListChecks className="w-3 h-3" /> {financerSelectMode ? 'Done' : 'Select'}
                  </button>
                </div>
                {financerSelectMode && filteredActiveFinancers.length > 0 && (
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <button
                      onClick={() => {
                        if (selectedFinancers.size === filteredActiveFinancers.length) setSelectedFinancers(new Set());
                        else setSelectedFinancers(new Set(filteredActiveFinancers.map((f) => f.name)));
                      }}
                      className="flex items-center gap-1.5 text-xs text-[#c2c8d8] hover:text-white transition-colors"
                    >
                      {selectedFinancers.size === filteredActiveFinancers.length
                        ? <CheckSquare className="w-3.5 h-3.5 text-[#00e07a]" />
                        : <Square className="w-3.5 h-3.5" />}
                      Select all
                    </button>
                  </div>
                )}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8]" />
                  <input
                    type="text" placeholder="Search financers..."
                    value={financerSearch}
                    onChange={(e) => setFinancerSearch(e.target.value)}
                    className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {filteredActiveFinancers.map((fin) => (
                    <div key={fin.name} className={`card-surface rounded-xl px-4 py-3 flex items-center justify-between group ${financerSelectMode && selectedFinancers.has(fin.name) ? 'ring-1 ring-[#00e07a]/40' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {financerSelectMode && (
                          <button
                            onClick={() => setSelectedFinancers((prev) => {
                              const next = new Set(prev);
                              next.has(fin.name) ? next.delete(fin.name) : next.add(fin.name);
                              return next;
                            })}
                            className="flex-shrink-0"
                          >
                            {selectedFinancers.has(fin.name)
                              ? <CheckSquare className="w-4 h-4 text-[#00e07a]" />
                              : <Square className="w-4 h-4 text-[#525c72]" />}
                          </button>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-white text-sm font-medium">{fin.name}</p>
                            {(() => {
                              const dealCount = projects.filter((p) => p.financer === fin.name).length;
                              return (
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                  dealCount > 0
                                    ? 'bg-[#00e07a]/10 text-[#00e07a] border border-[#00e07a]/20'
                                    : 'bg-[#1d2028] text-[#525c72] border border-[#272b35]/50'
                                }`}>
                                  {dealCount} deal{dealCount !== 1 ? 's' : ''}
                                </span>
                              );
                            })()}
                          </div>
                          {(() => {
                            const usedInstallers = Array.from(new Set(projects.filter((p) => p.financer === fin.name).map((p) => p.installer))).filter(Boolean);
                            return usedInstallers.length > 0 ? (
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                <span className="text-[9px] text-[#525c72] mr-0.5">Used with:</span>
                                {usedInstallers.map((inst) => (
                                  <span key={inst} className="text-[9px] text-[#8891a8] bg-[#1d2028]/80 border border-[#272b35]/50 px-1.5 py-0.5 rounded-full">{inst}</span>
                                ))}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      {!financerSelectMode && (
                      <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setFinancerActive(fin.name, false)}
                          title="Archive financer"
                          className="text-[#525c72] hover:text-amber-400 transition-colors"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({
                            type: 'financer',
                            id: fin.name,
                            name: fin.name,
                            message: 'This will not affect existing projects but will prevent new deals with this financer.',
                          })}
                          title="Archive financer"
                          className="text-[#525c72] hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              );
            })()}

            {financers.some((f) => !f.active && !hiddenFinancers.has(f.name)) && (() => {
              const archivedFinancers = financers.filter((f) => !f.active && !hiddenFinancers.has(f.name));
              return (
              <div>
                <button
                  onClick={() => setArchivedFinancersOpen((v) => !v)}
                  className="flex items-center gap-2 mb-2 px-1 w-full text-left group"
                >
                  {archivedFinancersOpen
                    ? <ChevronDown className="w-3.5 h-3.5 text-[#525c72]" />
                    : <ChevronRight className="w-3.5 h-3.5 text-[#525c72]" />}
                  <p className="text-xs font-semibold text-[#525c72] uppercase tracking-wider">Archived</p>
                  <span className="text-[10px] font-medium text-[#525c72] bg-[#1d2028] border border-[#333849]/50 px-1.5 py-0.5 rounded-full">
                    {archivedFinancers.length}
                  </span>
                  {financerSelectMode && archivedFinancers.length > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        const archivedNames = archivedFinancers.map((f) => f.name);
                        const allSelected = archivedNames.every((n) => selectedFinancers.has(n));
                        setSelectedFinancers((prev) => {
                          const next = new Set(prev);
                          archivedNames.forEach((n) => allSelected ? next.delete(n) : next.add(n));
                          return next;
                        });
                      }}
                      className="flex items-center gap-1.5 text-xs text-[#8891a8] hover:text-white transition-colors ml-auto"
                    >
                      {archivedFinancers.every((f) => selectedFinancers.has(f.name))
                        ? <CheckSquare className="w-3.5 h-3.5 text-[#00e07a]" />
                        : <Square className="w-3.5 h-3.5" />}
                      Select all
                    </span>
                  )}
                </button>
                {archivedFinancersOpen && (
                <div className="grid grid-cols-2 gap-2">
                  {archivedFinancers.map((fin) => (
                    <div key={fin.name} className={`bg-[#161920]/50 border border-[#333849]/50 rounded-xl px-4 py-3 flex items-center justify-between group ${financerSelectMode && selectedFinancers.has(fin.name) ? 'ring-1 ring-[#00e07a]/40' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {financerSelectMode && (
                          <button
                            onClick={() => setSelectedFinancers((prev) => {
                              const next = new Set(prev);
                              next.has(fin.name) ? next.delete(fin.name) : next.add(fin.name);
                              return next;
                            })}
                            className="flex-shrink-0"
                          >
                            {selectedFinancers.has(fin.name)
                              ? <CheckSquare className="w-4 h-4 text-[#00e07a]" />
                              : <Square className="w-4 h-4 text-[#525c72]" />}
                          </button>
                        )}
                        <p className="text-[#525c72] text-sm line-through">{fin.name}</p>
                      </div>
                      {!financerSelectMode && (
                      <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setFinancerActive(fin.name, true)}
                          title="Restore financer"
                          className="text-[#525c72] hover:text-[#00e07a] transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({
                            type: 'financer',
                            id: fin.name,
                            name: fin.name,
                            message: 'This will not affect existing projects but will prevent new deals with this financer.',
                          })}
                          title="Archive financer"
                          className="text-[#525c72] hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
              );
            })()}
          </div>
        )}

        {/* ── Customization ─────────────────────────────────────────────────── */}
        {section === 'customization' && (
          <div key={section} className="animate-tab-enter max-w-xl">
            <SectionHeader title="Customization" subtitle="Adjust pipeline alert thresholds" />

            {/* Pipeline Alert Thresholds */}
            <div className="card-surface rounded-2xl p-5 mb-6">
              <h2 className="text-white font-semibold mb-1">Pipeline Alert Thresholds</h2>
              <p className="text-[#8891a8] text-xs mb-4">Days from sold date before a project is flagged as &ldquo;stuck&rdquo; in each phase.</p>
              <div className="space-y-3">
                {['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed'].map((phase) => (
                  <div key={phase} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-[#c2c8d8] min-w-[120px]">{phase}</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={customThresholds[phase] ?? CUSTOMIZATION_DEFAULT_THRESHOLDS[phase]}
                      onChange={(e) => setCustomThresholds((prev) => ({ ...prev, [phase]: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-20 bg-[#1d2028] border border-[#333849] rounded-lg px-3 py-1.5 text-[#f0f2f7] text-sm text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-5">
                <button
                  onClick={() => {
                    localStorage.setItem('kilo-pipeline-thresholds', JSON.stringify(customThresholds));
                    setThresholdsSaved(true);
                    setTimeout(() => setThresholdsSaved(false), 2000);
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {thresholdsSaved ? 'Saved!' : 'Save Thresholds'}
                </button>
                <button
                  onClick={() => {
                    setCustomThresholds({ ...CUSTOMIZATION_DEFAULT_THRESHOLDS });
                    localStorage.removeItem('kilo-pipeline-thresholds');
                    setThresholdsSaved(true);
                    setTimeout(() => setThresholdsSaved(false), 2000);
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-[#c2c8d8] hover:text-white bg-[#1d2028] border border-[#333849] transition-colors"
                >
                  Reset to Defaults
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Export ────────────────────────────────────────────────────────────── */}
        {section === 'export' && (() => {
          const filteredPayroll = payrollEntries.filter((p) => {
            if (exportDateFrom && p.date < exportDateFrom) return false;
            if (exportDateTo && p.date > exportDateTo) return false;
            return true;
          });
          const filteredProjects = projects.filter((p) => {
            if (exportDateFrom && p.soldDate < exportDateFrom) return false;
            if (exportDateTo && p.soldDate > exportDateTo) return false;
            return true;
          });
          const toggleExport = (type: 'payments' | 'projects' | 'baselines' | 'trainers') => {
            setExportSelected((prev) => {
              const next = new Set(prev);
              if (next.has(type)) next.delete(type); else next.add(type);
              return next;
            });
          };
          return (
          <div key={section} className="animate-tab-enter max-w-2xl">
            <SectionHeader title="Export" subtitle="Download data exports as CSV" />

            {/* Date range filter */}
            <div className="card-surface rounded-2xl p-5 mb-6">
              <h2 className="text-white font-semibold mb-3">Date Range Filter</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#c2c8d8] mb-1">From</label>
                  <input type="date" value={exportDateFrom} onChange={(e) => setExportDateFrom(e.target.value)}
                    className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#c2c8d8] mb-1">To</label>
                  <input type="date" value={exportDateTo} onChange={(e) => setExportDateTo(e.target.value)}
                    className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                  />
                </div>
              </div>
              {(exportDateFrom || exportDateTo) && (
                <button onClick={() => { setExportDateFrom(''); setExportDateTo(''); }}
                  className="text-[#8891a8] hover:text-white text-xs mt-2 transition-colors">Clear dates</button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <button
                onClick={() => toggleExport('payments')}
                className={`bg-[#161920] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
                  exportSelected.has('payments')
                    ? 'border border-[#00e07a]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                    : 'border border-[#333849] hover:border-[#272b35]/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('payments') ? 'bg-[#00e07a]/15' : 'bg-[#1d2028]/80'}`}>
                    <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('payments') ? 'text-[#00e07a]' : 'text-[#c2c8d8]'}`} />
                  </div>
                  {exportSelected.has('payments') && (
                    <span className="text-xs font-medium text-[#00e07a] bg-[#00e07a]/10 border border-[#00e07a]/20 px-2 py-0.5 rounded-full">Selected</span>
                  )}
                </div>
                <h2 className="text-white font-bold tracking-tight text-base mb-1">Payments Export</h2>
                <p className="text-[#8891a8] text-sm leading-relaxed mb-3">All payroll entries including deal commissions, bonuses, and payment status.</p>
                <p className="text-[#c2c8d8] text-xs font-medium tabular-nums">{filteredPayroll.length} of {payrollEntries.length} records</p>
              </button>
              <button
                onClick={() => toggleExport('projects')}
                className={`bg-[#161920] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
                  exportSelected.has('projects')
                    ? 'border border-[#00e07a]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                    : 'border border-[#333849] hover:border-[#272b35]/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('projects') ? 'bg-[#00e07a]/15' : 'bg-[#1d2028]/80'}`}>
                    <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('projects') ? 'text-[#00e07a]' : 'text-[#c2c8d8]'}`} />
                  </div>
                  {exportSelected.has('projects') && (
                    <span className="text-xs font-medium text-[#00e07a] bg-[#00e07a]/10 border border-[#00e07a]/20 px-2 py-0.5 rounded-full">Selected</span>
                  )}
                </div>
                <h2 className="text-white font-bold tracking-tight text-base mb-1">Projects Export</h2>
                <p className="text-[#8891a8] text-sm leading-relaxed mb-3">Full project pipeline with installers, financers, kW size, PPW, and payment milestones.</p>
                <p className="text-[#c2c8d8] text-xs font-medium tabular-nums">{filteredProjects.length} of {projects.length} records</p>
              </button>
              <button
                onClick={() => toggleExport('baselines')}
                className={`bg-[#161920] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
                  exportSelected.has('baselines')
                    ? 'border border-[#00e07a]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                    : 'border border-[#333849] hover:border-[#272b35]/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('baselines') ? 'bg-[#00e07a]/15' : 'bg-[#1d2028]/80'}`}>
                    <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('baselines') ? 'text-[#00e07a]' : 'text-[#c2c8d8]'}`} />
                  </div>
                  {exportSelected.has('baselines') && (
                    <span className="text-xs font-medium text-[#00e07a] bg-[#00e07a]/10 border border-[#00e07a]/20 px-2 py-0.5 rounded-full">Selected</span>
                  )}
                </div>
                <h2 className="text-white font-bold tracking-tight text-base mb-1">Baselines Export</h2>
                <p className="text-[#8891a8] text-sm leading-relaxed mb-3">Installer baselines, SolarTech tiers, and Product Catalog tiers with closer/kilo rates.</p>
                <p className="text-[#c2c8d8] text-xs font-medium tabular-nums">{installerPricingVersions.length + solarTechProducts.length + productCatalogProducts.length} total rows</p>
              </button>
              <button
                onClick={() => toggleExport('trainers')}
                className={`bg-[#161920] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
                  exportSelected.has('trainers')
                    ? 'border border-[#00e07a]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                    : 'border border-[#333849] hover:border-[#272b35]/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('trainers') ? 'bg-[#00e07a]/15' : 'bg-[#1d2028]/80'}`}>
                    <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('trainers') ? 'text-[#00e07a]' : 'text-[#c2c8d8]'}`} />
                  </div>
                  {exportSelected.has('trainers') && (
                    <span className="text-xs font-medium text-[#00e07a] bg-[#00e07a]/10 border border-[#00e07a]/20 px-2 py-0.5 rounded-full">Selected</span>
                  )}
                </div>
                <h2 className="text-white font-bold tracking-tight text-base mb-1">Trainer Assignments</h2>
                <p className="text-[#8891a8] text-sm leading-relaxed mb-3">Trainee/trainer pairs with tier breakdowns and completed deal counts.</p>
                <p className="text-[#c2c8d8] text-xs font-medium tabular-nums">{trainerAssignments.length} assignments</p>
              </button>
            </div>
            {exportSelected.size > 0 && (
              <div className="mb-6">
                <div className="card-surface rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#00e07a]/10">
                      <FileSpreadsheet className="w-4 h-4 text-[#00e07a]" />
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">
                        {[...exportSelected].map((t) => ({ payments: 'Payments', projects: 'Projects', baselines: 'Baselines', trainers: 'Trainers' }[t])).join(' + ')} Export ready
                      </p>
                      <p className="text-[#8891a8] text-xs">
                        {[
                          exportSelected.has('payments') ? `${filteredPayroll.length} payment records` : '',
                          exportSelected.has('projects') ? `${filteredProjects.length} project records` : '',
                          exportSelected.has('baselines') ? `${installerPricingVersions.length + solarTechProducts.length + productCatalogProducts.length} baseline rows` : '',
                          exportSelected.has('trainers') ? `${trainerAssignments.length} assignments` : '',
                        ].filter(Boolean).join(' + ')}
                        {' will be exported as CSV'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;
                      const toCSV = (headers: string[], rows: string[][]) =>
                        [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
                      const download = (csv: string, filename: string) => {
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = filename; a.click();
                        URL.revokeObjectURL(url);
                      };
                      if (exportSelected.has('payments')) {
                        const csv = toCSV(
                          ['Rep', 'Customer / Notes', 'Type', 'Stage', 'Amount', 'Status', 'Date'],
                          filteredPayroll.map((p) => [p.repName, p.customerName || p.notes || '', p.type, String(p.paymentStage ?? ''), String(p.amount), p.status, p.date]),
                        );
                        download(csv, `kilo_payments_${new Date().toISOString().split('T')[0]}.csv`);
                      }
                      if (exportSelected.has('projects')) {
                        const csv = toCSV(
                          ['Customer', 'Rep', 'Phase', 'Installer', 'Financer', 'Product Type', 'kW Size', 'Net PPW', 'Sold Date', 'M1 Amount', 'M1 Paid', 'M2 Amount', 'M2 Paid', 'Flagged'],
                          filteredProjects.map((p) => [p.customerName, p.repName, p.phase, p.installer, p.financer, p.productType, String(p.kWSize), String(p.netPPW), p.soldDate, String(p.m1Amount), p.m1Paid ? 'Yes' : 'No', String(p.m2Amount), p.m2Paid ? 'Yes' : 'No', p.flagged ? 'Yes' : 'No']),
                        );
                        download(csv, `kilo_projects_${new Date().toISOString().split('T')[0]}.csv`);
                      }
                      if (exportSelected.has('baselines')) {
                        const rows: string[][] = [];
                        // Installer baselines (flat rate versions)
                        installerPricingVersions.forEach((v) => {
                          if (v.rates.type === 'flat') {
                            rows.push(['Installer Baseline', v.installer, v.label, v.effectiveFrom, v.effectiveTo || '', String(v.rates.closerPerW), String(v.rates.kiloPerW), '', '', '', '', '', '']);
                          } else {
                            v.rates.bands.forEach((b) => {
                              rows.push(['Installer Baseline (Tiered)', v.installer, v.label, v.effectiveFrom, v.effectiveTo || '', String(b.closerPerW), String(b.kiloPerW), '', '', String(b.minKW), String(b.maxKW ?? ''), '', '']);
                            });
                          }
                        });
                        // SolarTech products
                        solarTechProducts.forEach((p) => {
                          p.tiers.forEach((t) => {
                            rows.push(['SolarTech', p.name, p.family, '', '', String(t.closerPerW), String(t.kiloPerW), String(t.minKW), String(t.maxKW ?? ''), '', '', '', '']);
                          });
                        });
                        // Product Catalog products
                        productCatalogProducts.forEach((p) => {
                          p.tiers.forEach((t) => {
                            rows.push(['Product Catalog', p.name, p.family, p.installer, '', String(t.closerPerW), String(t.kiloPerW), String(t.minKW), String(t.maxKW ?? ''), '', '', '', '']);
                          });
                        });
                        const csv = toCSV(
                          ['Source', 'Name', 'Family / Label', 'Installer / EffectiveFrom', 'EffectiveTo', 'Closer $/W', 'Kilo $/W', 'Min kW', 'Max kW', 'Band Min kW', 'Band Max kW', '', ''],
                          rows,
                        );
                        download(csv, `kilo_baselines_${new Date().toISOString().split('T')[0]}.csv`);
                      }
                      if (exportSelected.has('trainers')) {
                        const rows: string[][] = [];
                        trainerAssignments.forEach((a) => {
                          const trainee = reps.find((r) => r.id === a.traineeId);
                          const trainer = reps.find((r) => r.id === a.trainerId);
                          const dealCount = projects.filter((p) => p.repId === a.traineeId || p.setterId === a.traineeId).length;
                          const tierStrs = a.tiers.map((t, i) => `Tier ${i + 1}: up to ${t.upToDeal === null ? '∞' : t.upToDeal} deals @ $${t.ratePerW}/W`).join(' | ');
                          rows.push([trainee?.name || a.traineeId, trainer?.name || a.trainerId, String(a.tiers.length), tierStrs, String(dealCount)]);
                        });
                        const csv = toCSV(
                          ['Trainee', 'Trainer', 'Tier Count', 'Tier Breakdown', 'Completed Deals'],
                          rows,
                        );
                        download(csv, `kilo_trainer_assignments_${new Date().toISOString().split('T')[0]}.csv`);
                      }
                      toast(`Export started — ${exportSelected.size} file${exportSelected.size > 1 ? 's' : ''} downloading`, 'info');
                    }}
                    className="flex items-center gap-2 bg-[#00e07a] hover:bg-[#00e07a] active:scale-[0.97] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/20 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    Download CSV{exportSelected.size > 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* ── Baselines ────────────────────────────────────────────────────────── */}
        {section === 'baselines' && (
          <div key={section} className="animate-tab-enter">
            <SectionHeader title="Baselines" subtitle="Standard installer rates and SolarTech product pricing" />

            {/* Sub-tabs */}
            {(() => {
              const pcInstallerNames = Object.keys(productCatalogInstallerConfigs).filter((n) => n !== 'SolarTech');
              const allTabs = ['standard', 'solartech', ...pcInstallerNames];
              return (
                <div className="flex gap-1 mb-5 bg-[#161920] border border-[#333849] rounded-xl p-1 w-fit tab-bar-container flex-wrap">
                  {baselineIndicator && <div className="tab-indicator" style={baselineIndicator} />}
                  {allTabs.map((t, i) => (
                    <button
                      key={t}
                      ref={(el) => { baselineTabRefs.current[i] = el; }}
                      onClick={() => setBaselineTab(t)}
                      className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.97] ${
                        baselineTab === t ? 'text-white' : 'text-[#c2c8d8] hover:text-white'
                      }`}
                    >
                      {t === 'standard' ? 'Standard' : t === 'solartech' ? 'SolarTech' : t}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Standard — flat installer baselines (inline-editable) */}
            {baselineTab === 'standard' && (
              <div className={`card-surface rounded-xl overflow-hidden transition-all duration-300 ${showSubDealerRates ? 'max-w-4xl' : 'max-w-2xl'}`}>
                <div className="px-5 py-4 border-b border-[#333849] flex items-center justify-between">
                  <div>
                    <h2 className="text-white font-semibold">Standard Installer Baselines</h2>
                    <p className="text-[#8891a8] text-xs mt-0.5">Click the pencil to edit · Setter defaults to Closer + $0.10/W (leave blank) · Kilo = company margin floor</p>
                  </div>
                  <button
                    onClick={() => setShowSubDealerRates((v) => !v)}
                    className="flex items-center gap-2 text-xs font-medium text-[#c2c8d8] hover:text-white transition-colors shrink-0"
                  >
                    <span>Sub-Dealer Rates</span>
                    <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showSubDealerRates ? 'bg-amber-500' : 'bg-[#272b35]'}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${showSubDealerRates ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                    </span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="table-header-frost">
                      <tr className="border-b border-[#333849]">
                        <th
                          className="text-left px-5 py-3 text-[#c2c8d8] font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => toggleBaselineSort('installer')}
                        >
                          <span className="inline-flex items-center gap-1">
                            Installer
                            {baselineSortKey === 'installer' && (
                              baselineSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                            )}
                          </span>
                        </th>
                        <th className="text-right px-4 py-3 text-[#c2c8d8] font-medium">Structure</th>
                        <th
                          className="text-right px-4 py-3 text-[#c2c8d8] font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => toggleBaselineSort('closer')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end">
                            Closer $/W
                            {baselineSortKey === 'closer' && (
                              baselineSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                            )}
                          </span>
                        </th>
                        <th className="text-right px-4 py-3 text-[#c2c8d8] font-medium">Setter $/W</th>
                        <th
                          className="text-right px-4 py-3 text-[#c2c8d8] font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => toggleBaselineSort('kilo')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end">
                            Kilo $/W
                            {baselineSortKey === 'kilo' && (
                              baselineSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                            )}
                          </span>
                        </th>
                        {showSubDealerRates && (
                          <th className="text-right px-4 py-3 text-amber-400/80 font-medium text-xs">SD Rate</th>
                        )}
                        <th className="px-4 py-3 w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const installerNames = Array.from(new Set(installerPricingVersions.map((v) => v.installer)));
                        const sorted = [...installerNames].sort((a, b) => {
                          let cmp = 0;
                          if (baselineSortKey === 'installer') {
                            cmp = a.localeCompare(b);
                          } else if (baselineSortKey === 'closer') {
                            cmp = (installerBaselines[a]?.closerPerW ?? 0) - (installerBaselines[b]?.closerPerW ?? 0);
                          } else if (baselineSortKey === 'kilo') {
                            cmp = (installerBaselines[a]?.kiloPerW ?? 0) - (installerBaselines[b]?.kiloPerW ?? 0);
                          }
                          return baselineSortDir === 'asc' ? cmp : -cmp;
                        });
                        return sorted;
                      })().map((installer) => {
                        const today = new Date().toISOString().split('T')[0];
                        const allVersions = installerPricingVersions.filter((v) => v.installer === installer);
                        const activeVersion = allVersions.reduce<typeof allVersions[0] | null>((best, v) => {
                          if (v.effectiveFrom > today || (v.effectiveTo !== null && v.effectiveTo < today)) return best;
                          if (!best || v.effectiveFrom >= best.effectiveFrom) return v;
                          return best;
                        }, null);
                        const rates = installerBaselines[installer];
                        if (!rates) return null;
                        const isEditing = editingInstaller === installer;
                        const displaySetter = rates.setterPerW != null
                          ? rates.setterPerW
                          : Math.round((rates.closerPerW + 0.10) * 100) / 100;
                        const hasCustomSetter = rates.setterPerW != null;
                        const historyCount = allVersions.filter((v) => v.effectiveTo !== null).length;
                        const isShowingHistory = showVersionHistory === installer;
                        return (
                          <Fragment key={installer}>
                            <tr className="border-b border-[#333849]/50 hover:bg-[#1d2028]/30 transition-colors group">
                              <td className="px-5 py-3 text-white font-medium">
                                {installer}
                                {historyCount > 0 && (
                                  <button
                                    onClick={() => setShowVersionHistory(isShowingHistory ? null : installer)}
                                    className="ml-2 text-[#525c72] hover:text-[#c2c8d8] transition-colors inline-flex items-center gap-0.5"
                                    title="View version history"
                                  >
                                    <History className="w-3 h-3" />
                                    <span className="text-[10px]">{historyCount}</span>
                                  </button>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#272b35] text-[#c2c8d8]">
                                  Standard
                                </span>
                              </td>
                              {isEditing ? (
                                <>
                                  <td className="px-4 py-2 text-right">
                                    <input type="number" step="0.01" min="0"
                                      value={editInstallerVals.closerPerW}
                                      onChange={(e) => setEditInstallerVals((v) => ({ ...v, closerPerW: e.target.value }))}
                                      className="w-20 bg-[#272b35] border border-[#272b35] text-white rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <input type="number" step="0.01" min="0"
                                      value={editInstallerVals.setterPerW}
                                      placeholder={editInstallerVals.closerPerW ? String(Math.round((parseFloat(editInstallerVals.closerPerW) + 0.10) * 100) / 100) : '—'}
                                      onChange={(e) => setEditInstallerVals((v) => ({ ...v, setterPerW: e.target.value }))}
                                      className="w-20 bg-[#272b35] border border-[#272b35] text-violet-300 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <input type="number" step="0.01" min="0"
                                      value={editInstallerVals.kiloPerW}
                                      onChange={(e) => setEditInstallerVals((v) => ({ ...v, kiloPerW: e.target.value }))}
                                      className="w-20 bg-[#272b35] border border-[#272b35] text-white rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                    />
                                  </td>
                                  {showSubDealerRates && (
                                    <td className="px-4 py-2 text-right">
                                      <input type="number" step="0.01" min="0"
                                        value={editInstallerVals.subDealerPerW}
                                        placeholder="—"
                                        onChange={(e) => setEditInstallerVals((v) => ({ ...v, subDealerPerW: e.target.value }))}
                                        className="w-20 bg-[#272b35] border border-[#272b35] text-amber-400 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"
                                      />
                                    </td>
                                  )}
                                  <td className="px-4 py-2">
                                    <div className="flex items-center gap-2 justify-end">
                                      <button onClick={() => {
                                        const c = parseFloat(editInstallerVals.closerPerW);
                                        const k = parseFloat(editInstallerVals.kiloPerW);
                                        const s = parseFloat(editInstallerVals.setterPerW);
                                        const sd = parseFloat(editInstallerVals.subDealerPerW);
                                        if (!isNaN(c) && !isNaN(k)) {
                                          updateInstallerBaseline(installer, {
                                            closerPerW: c, kiloPerW: k,
                                            ...(editInstallerVals.setterPerW !== '' && !isNaN(s) ? { setterPerW: s } : {}),
                                            ...(editInstallerVals.subDealerPerW !== '' && !isNaN(sd) ? { subDealerPerW: sd } : {}),
                                          });
                                        }
                                        setEditingInstaller(null);
                                      }} className="text-[#00e07a] hover:text-[#00c4f0] transition-colors">
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button onClick={() => setEditingInstaller(null)} className="text-[#8891a8] hover:text-[#c2c8d8] transition-colors">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-4 py-3 text-[#00e07a] font-medium text-right">${rates.closerPerW.toFixed(2)}</td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={`font-medium text-xs ${hasCustomSetter ? 'text-violet-300' : 'text-violet-400/60'}`}>
                                      ${displaySetter.toFixed(2)}
                                      {!hasCustomSetter && <span className="text-[#525c72] ml-1 text-[10px]">auto</span>}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-[#00e07a] font-medium text-right">${rates.kiloPerW.toFixed(2)}</td>
                                  {showSubDealerRates && (
                                    <td className="px-4 py-3 text-right">
                                      {rates.subDealerPerW != null
                                        ? <span className="text-amber-400 font-medium">${rates.subDealerPerW.toFixed(2)}</span>
                                        : <span className="text-[#525c72]">&mdash;</span>}
                                    </td>
                                  )}
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => {
                                          setEditingInstaller(installer);
                                          setEditInstallerVals({
                                            closerPerW: String(rates.closerPerW),
                                            setterPerW: rates.setterPerW != null ? String(rates.setterPerW) : '',
                                            kiloPerW: String(rates.kiloPerW),
                                            subDealerPerW: rates.subDealerPerW != null ? String(rates.subDealerPerW) : '',
                                          });
                                        }}
                                        title="Edit current rates"
                                        className="text-[#525c72] hover:text-[#c2c8d8] transition-colors"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setNewVersionFor(installer);
                                          const nextNum = allVersions.length + 1;
                                          setNewVersionLabel(`v${nextNum}`);
                                          setNewVersionEffectiveFrom('');
                                          const avRates = activeVersion?.rates;
                                          const avFlat = avRates?.type === 'flat' ? avRates : null;
                                          setNewVersionVals(avFlat
                                            ? { closerPerW: String(avFlat.closerPerW), setterPerW: avFlat.setterPerW != null ? String(avFlat.setterPerW) : '', kiloPerW: String(avFlat.kiloPerW) }
                                            : { closerPerW: '2.90', setterPerW: '', kiloPerW: '2.35' });
                                        }}
                                        title="Create new pricing version"
                                        className="text-[#525c72] hover:text-[#00e07a] transition-colors"
                                      >
                                        <GitBranch className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                            {/* Version history rows */}
                            {isShowingHistory && allVersions.filter((v) => v.effectiveTo !== null).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map((v) => (
                              <tr key={v.id} className="border-b border-[#333849]/30 bg-[#1d2028]/20">
                                <td className="px-5 py-2 pl-10 text-[#8891a8] text-xs">{v.label}</td>
                                <td className="px-4 py-2 text-right">
                                  <span className="text-[10px] text-[#525c72]">Standard</span>
                                </td>
                                <td colSpan={2} className="px-4 py-2 text-[#525c72] text-xs text-right">
                                  {v.effectiveFrom} → {v.effectiveTo}
                                </td>
                                <td className="px-4 py-2 text-[#525c72] text-right text-xs">
                                  {v.rates.type === 'flat' ? `$${v.rates.closerPerW.toFixed(2)} / $${v.rates.kiloPerW.toFixed(2)}` : 'Tiered'}
                                </td>
                                {showSubDealerRates && (
                                  <td className="px-4 py-2 text-[#525c72] text-right text-xs">
                                    {v.rates.type === 'flat' && v.rates.subDealerPerW != null ? `$${v.rates.subDealerPerW.toFixed(2)}` : '—'}
                                  </td>
                                )}
                                <td />
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── New Version Modal ─────────────────────────────────────────────── */}
            {newVersionFor && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                <div className="bg-[#161920] border border-[#272b35]/80 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-black/40 animate-modal-panel">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-white font-bold">New Pricing Version</h3>
                      <p className="text-[#8891a8] text-xs mt-0.5">{newVersionFor} — closes current version on the day before effective date</p>
                    </div>
                    <button onClick={() => setNewVersionFor(null)} className="text-[#8891a8] hover:text-white transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Label + effective date */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Version label</label>
                        <input type="text" placeholder="e.g. v2 — March 2025"
                          value={newVersionLabel} onChange={(e) => setNewVersionLabel(e.target.value)}
                          className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Effective from</label>
                        <input type="date"
                          value={newVersionEffectiveFrom} onChange={(e) => setNewVersionEffectiveFrom(e.target.value)}
                          className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                        />
                      </div>
                    </div>

                    {/* Rate inputs */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Closer $/W</label>
                        <input type="number" step="0.01" min="0"
                          value={newVersionVals.closerPerW} onChange={(e) => setNewVersionVals((v) => ({ ...v, closerPerW: e.target.value }))}
                          className="w-full bg-[#1d2028] border border-[#333849] text-[#00e07a] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Setter $/W</label>
                        <input type="number" step="0.01" min="0"
                          value={newVersionVals.setterPerW}
                          placeholder={newVersionVals.closerPerW ? String(Math.round((parseFloat(newVersionVals.closerPerW) + 0.10) * 100) / 100) : 'auto'}
                          onChange={(e) => setNewVersionVals((v) => ({ ...v, setterPerW: e.target.value }))}
                          className="w-full bg-[#1d2028] border border-[#333849] text-violet-400 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Kilo $/W</label>
                        <input type="number" step="0.01" min="0"
                          value={newVersionVals.kiloPerW} onChange={(e) => setNewVersionVals((v) => ({ ...v, kiloPerW: e.target.value }))}
                          className="w-full bg-[#1d2028] border border-[#333849] text-[#00e07a] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-5">
                    <button onClick={() => setNewVersionFor(null)}
                      className="flex-1 py-2 rounded-xl text-sm font-medium bg-[#1d2028] text-[#c2c8d8] hover:bg-[#272b35] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!newVersionLabel.trim() || !newVersionEffectiveFrom) return;
                        const c = parseFloat(newVersionVals.closerPerW);
                        const k = parseFloat(newVersionVals.kiloPerW);
                        if (isNaN(c) || isNaN(k)) return;
                        const s = parseFloat(newVersionVals.setterPerW);
                        const rates: InstallerRates = { type: 'flat', closerPerW: c, kiloPerW: k, ...(newVersionVals.setterPerW !== '' && !isNaN(s) ? { setterPerW: s } : {}) };
                        createNewInstallerVersion(newVersionFor!, newVersionLabel.trim(), newVersionEffectiveFrom, rates);
                        toast('Pricing version created', 'success');
                        setNewVersionFor(null);
                      }}
                      disabled={!newVersionLabel.trim() || !newVersionEffectiveFrom}
                      className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      style={{ backgroundColor: 'var(--brand)' }}
                    >
                      Create Version
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Product Catalog Installer — family sub-tabs + product tier table */}
            {productCatalogInstallerConfigs[baselineTab] && (() => {
              const installerName = baselineTab;
              const config = productCatalogInstallerConfigs[installerName];
              const currentFamily = pcFamily[installerName] ?? config.families[0] ?? '';
              const filteredProducts = productCatalogProducts.filter((p) => p.installer === installerName && p.family === currentFamily);
              return (
                <div>
                  {/* Family sub-tabs */}
                  {config.families.length > 0 && (
                    <div className="flex gap-1 mb-4 bg-[#161920] border border-[#333849] rounded-xl p-1 w-fit tab-bar-container">
                      {pcFamilyIndicator && <div className="tab-indicator" style={pcFamilyIndicator} />}
                      {config.families.map((fam, i) => {
                        const pcFamCount = productCatalogProducts.filter((p) => p.installer === installerName && p.family === fam).length;
                        return (
                        <button
                          key={fam}
                          ref={(el) => { pcFamilyTabRefs.current[i] = el; }}
                          onClick={() => setPcFamily((prev) => ({ ...prev, [installerName]: fam }))}
                          className={`relative z-10 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.97] ${
                            currentFamily === fam ? 'text-white' : pcFamCount === 0 ? 'text-[#525c72] hover:text-[#c2c8d8]' : 'text-[#c2c8d8] hover:text-white'
                          }`}
                        >
                          {fam} <span className={`ml-0.5 ${currentFamily === fam ? 'text-[#c2c8d8]' : 'text-[#525c72]'}`}>({pcFamCount})</span>
                        </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Action bar: Version selector + Duplicate All + Bulk Adjust toggle */}
                  {(() => {
                    const versionKey = `${installerName}::${currentFamily}`;
                    const currentView = pcVersionView[versionKey] ?? 'current';
                    const familyProductIds = new Set(filteredProducts.map((p) => p.id));
                    const familyVersions = productCatalogPricingVersions.filter((v) => familyProductIds.has(v.productId) && v.effectiveTo !== null);
                    // Group by label|effectiveFrom
                    const versionGroups = new Map<string, { label: string; effectiveFrom: string; effectiveTo: string }>();
                    familyVersions.forEach((v) => {
                      const key = `${v.label}|${v.effectiveFrom}`;
                      if (!versionGroups.has(key)) versionGroups.set(key, { label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo ?? '' });
                    });
                    const sortedGroups = [...versionGroups.entries()].sort((a, b) => b[1].effectiveFrom.localeCompare(a[1].effectiveFrom));
                    const isViewingArchive = currentView !== 'current';
                    return (
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        {/* Version selector */}
                        <select
                          value={currentView}
                          onChange={(e) => setPcVersionView((prev) => ({ ...prev, [versionKey]: e.target.value }))}
                          className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                        >
                          <option value="current">Current (editable)</option>
                          {sortedGroups.map(([key, g]) => (
                            <option key={key} value={key}>{g.label} — {g.effectiveFrom}</option>
                          ))}
                        </select>
                        {isViewingArchive && (
                          <>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium">
                              <History className="w-3 h-3" />
                              Viewing archived version
                              {(() => { const g = versionGroups.get(currentView); return g ? ` · ${g.effectiveFrom} → ${g.effectiveTo}` : ''; })()}
                            </span>
                            <button
                              onClick={() => {
                                const [label, effectiveFrom] = currentView.split('|');
                                setConfirmAction({
                                  title: 'Delete Pricing Version',
                                  message: 'Delete this pricing version? This cannot be undone.',
                                  onConfirm: () => {
                                    const idsToDelete = productCatalogPricingVersions
                                      .filter((v) => familyProductIds.has(v.productId) && v.label === label && v.effectiveFrom === effectiveFrom)
                                      .map((v) => v.id);
                                    deleteProductCatalogPricingVersions(idsToDelete);
                                    setPcVersionView((prev) => ({ ...prev, [versionKey]: 'current' }));
                                    toast('Pricing version deleted', 'success');
                                    setConfirmAction(null);
                                  },
                                });
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete Version
                            </button>
                          </>
                        )}
                        {!isViewingArchive && (
                          <>
                            <button
                              onClick={() => { setDupAllOpen('productcatalog'); setDupAllLabel(''); setDupAllEffectiveFrom(''); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1d2028] border border-[#333849] text-[#c2c8d8] hover:text-white hover:border-[#272b35] transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" /> Duplicate All as New Version
                            </button>
                          </>
                        )}
                        {!isViewingArchive && (
                          <button
                            onClick={() => { setBulkAdjustOpen(bulkAdjustOpen === 'productcatalog' ? null : 'productcatalog'); setBulkRateAdj(''); setBulkSpreadInputs(['', '', '', '']); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                              bulkAdjustOpen === 'productcatalog'
                                ? 'bg-[#00e07a]/15 border-[#00e07a]/30 text-[#00e07a]'
                                : 'bg-[#1d2028] border-[#272b35] text-[#c2c8d8] hover:text-white hover:border-[#272b35]'
                            }`}
                          >
                            <Sliders className="w-3.5 h-3.5" /> Bulk Adjust
                            {bulkAdjustOpen === 'productcatalog' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Bulk Adjust Panel — Product Catalog */}
                  {bulkAdjustOpen === 'productcatalog' && (() => {
                    const adjVal = parseFloat(bulkRateAdj) || 0;
                    const spreadVals = bulkSpreadInputs.map((v) => parseFloat(v));
                    const anySpreadSet = spreadVals.some((v) => !isNaN(v) && v !== 0);

                    return (
                      <div className="card-surface rounded-xl p-4 mb-3 space-y-4 max-w-3xl">
                        {/* Tool A: Bulk Rate Adjustment */}
                        <div>
                          <p className="text-white text-xs font-semibold mb-2">Bulk Rate Adjustment</p>
                          <div className="flex items-center gap-3 flex-wrap">
                            <label className="text-[#c2c8d8] text-xs whitespace-nowrap">Adjust closer baselines by</label>
                            <div className="flex items-center gap-1">
                              <span className="text-[#8891a8] text-xs">$</span>
                              <input
                                type="number" step="0.01"
                                value={bulkRateAdj}
                                onChange={(e) => setBulkRateAdj(e.target.value)}
                                placeholder="+/- 0.00"
                                className="w-24 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                              />
                              <span className="text-[#8891a8] text-xs">/W</span>
                            </div>
                            {adjVal !== 0 && (
                              <span className="text-[#8891a8] text-[10px]">
                                {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} x 4 tiers affected
                              </span>
                            )}
                            <button
                              disabled={adjVal === 0}
                              onClick={() => {
                                filteredProducts.forEach((p) => {
                                  p.tiers.forEach((tier, ti) => {
                                    const newCloser = Math.round((tier.closerPerW + adjVal) * 100) / 100;
                                    updateProductCatalogTier(p.id, ti, { closerPerW: newCloser });
                                  });
                                });
                                toast(`Closer adjusted by $${adjVal >= 0 ? '+' : ''}${adjVal.toFixed(2)}/W on ${filteredProducts.length} products`, 'success');
                                setBulkRateAdj('');
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              style={{ backgroundColor: 'var(--brand)' }}
                            >
                              Apply
                            </button>
                          </div>
                        </div>

                        {/* Tool B: Kilo Spread Minimums */}
                        <div className="border-t border-[#333849] pt-4">
                          <p className="text-white text-xs font-semibold mb-2">Kilo Spread Minimums</p>
                          <p className="text-[#8891a8] text-[10px] mb-2">Sets closerPerW = kiloPerW + spread for each tier (Kilo rate is the anchor)</p>
                          <div className="grid grid-cols-4 gap-2 mb-3">
                            {['Under 5kW', '5-10kW', '10-13kW', '13+ kW'].map((label, i) => (
                              <div key={label}>
                                <p className="text-[10px] text-[#8891a8] mb-1 text-center">{label} spread</p>
                                <div className="flex items-center gap-1 justify-center">
                                  <span className="text-[#8891a8] text-xs">$</span>
                                  <input
                                    type="number" step="0.01" min="0"
                                    value={bulkSpreadInputs[i]}
                                    onChange={(e) => setBulkSpreadInputs((prev) => {
                                      const next = [...prev] as [string, string, string, string];
                                      next[i] = e.target.value;
                                      return next;
                                    })}
                                    placeholder="0.00"
                                    className="w-16 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          {anySpreadSet && (
                            <p className="text-[#8891a8] text-[10px] mb-2">
                              Preview: {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} will have closer baselines recalculated per tier
                            </p>
                          )}
                          <button
                            disabled={!anySpreadSet}
                            onClick={() => {
                              filteredProducts.forEach((p) => {
                                p.tiers.forEach((tier, ti) => {
                                  const spread = spreadVals[ti];
                                  if (!isNaN(spread) && spread !== 0) {
                                    const newCloser = Math.round((tier.kiloPerW + spread) * 100) / 100;
                                    updateProductCatalogTier(p.id, ti, { closerPerW: newCloser });
                                  }
                                });
                              });
                              toast(`Closer spreads applied to ${filteredProducts.length} products`, 'success');
                              setBulkSpreadInputs(['', '', '', '']);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Apply Spreads
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Product table */}
                  {(() => {
                    const pcVKey = `${installerName}::${currentFamily}`;
                    const pcCurrentView = pcVersionView[pcVKey] ?? 'current';
                    const pcIsArchive = pcCurrentView !== 'current';
                    // For archive view, find matching versions per product
                    const [pcArchiveLabel, pcArchiveFrom] = pcIsArchive ? pcCurrentView.split('|') : ['', ''];
                    const pcDisplayProducts = pcProductSearch.trim()
                      ? filteredProducts.filter((p) => p.name.toLowerCase().includes(pcProductSearch.toLowerCase().trim()))
                      : filteredProducts;
                    const pcDisplayProductIds = pcDisplayProducts.map((p) => p.id);
                    // Summary stats
                    const pcSummaryCount = filteredProducts.length;
                    const pcAllClosers = filteredProducts.flatMap((p) => p.tiers.map((t) => t.closerPerW));
                    const pcSpreadMin = pcAllClosers.length > 0 ? Math.min(...pcAllClosers) : 0;
                    const pcSpreadMax = pcAllClosers.length > 0 ? Math.max(...pcAllClosers) : 0;
                    return (
                      <div className="card-surface rounded-xl overflow-hidden max-w-3xl">
                        <div className="px-5 py-4 border-b border-[#333849]">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h2 className="text-white font-semibold">{installerName} — {currentFamily}</h2>
                              <p className="text-[#8891a8] text-xs mt-0.5">
                                {pcIsArchive ? 'Viewing archived version (read-only)' : 'Click any value to edit · Setter = Closer + $0.10/W auto-calculated'}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setShowSubDealerRates((v) => !v)}
                                className="flex items-center gap-2 text-xs font-medium text-[#c2c8d8] hover:text-white transition-colors shrink-0"
                              >
                                <span>SD Rate</span>
                                <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showSubDealerRates ? 'bg-amber-500' : 'bg-[#272b35]'}`}>
                                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${showSubDealerRates ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                                </span>
                              </button>
                              <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8]" />
                                <input
                                  type="text"
                                  placeholder="Search products..."
                                  value={pcProductSearch}
                                  onChange={(e) => setPcProductSearch(e.target.value)}
                                  className="w-48 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="table-header-frost">
                              <tr className="border-b border-[#333849]">
                                <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Product</th>
                                {['1–5 kW', '5–10 kW', '10–13 kW', '13+ kW'].map((label) => (
                                  <th key={label} className="text-center px-4 py-3 text-[#c2c8d8] font-medium whitespace-nowrap">{label}</th>
                                ))}
                                <th className="px-4 py-3 w-10" />
                              </tr>
                              {showSubDealerRates && (
                                <tr><td colSpan={6} className="px-4 py-1 text-amber-400/60 text-[10px] text-right">Amber values = Sub-Dealer Rate</td></tr>
                              )}
                            </thead>
                            <tbody>
                              {/* Family summary stats row */}
                              {filteredProducts.length > 0 && (
                                <tr className="bg-[#1d2028]/60 border-b border-[#333849]">
                                  <td className="px-5 py-2 text-[#c2c8d8] text-xs font-medium">{pcSummaryCount} product{pcSummaryCount !== 1 ? 's' : ''}</td>
                                  {[0, 1, 2, 3].map((ti) => {
                                    const profits = filteredProducts.map((p) => (p.tiers[ti]?.closerPerW ?? 0) - (p.tiers[ti]?.kiloPerW ?? 0));
                                    const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
                                    return (
                                      <td key={ti} className="px-2 py-2 text-center">
                                        <span className={`text-[10px] font-semibold ${avgProfit > 0 ? 'text-[#00e07a]/70' : 'text-red-400/70'}`}>
                                          ${avgProfit.toFixed(2)} profit
                                        </span>
                                      </td>
                                    );
                                  })}
                                  {showSubDealerRates && <td />}
                                  <td className="px-4 py-2 text-center">
                                    <span className="text-[#8891a8] text-[10px]">${pcSpreadMin.toFixed(2)}–${pcSpreadMax.toFixed(2)}</span>
                                  </td>
                                </tr>
                              )}
                              {pcDisplayProducts.map((product) => {
                                const pcAllVersions = productCatalogPricingVersions.filter((v) => v.productId === product.id);
                                // Archive mode: find the matching version for this product
                                const archiveVersion = pcIsArchive
                                  ? pcAllVersions.find((v) => v.label === pcArchiveLabel && v.effectiveFrom === pcArchiveFrom)
                                  : null;
                                return (
                                  <tr key={product.id} className="border-b border-[#333849]/50 hover:bg-[#1d2028]/30 transition-colors group">
                                    <td className="px-5 py-3 text-white text-xs max-w-[200px]">
                                      {editingProductName === product.id ? (
                                        <input
                                          autoFocus
                                          type="text"
                                          value={editProductNameVal}
                                          onChange={(e) => setEditProductNameVal(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const trimmed = editProductNameVal.trim();
                                              if (trimmed && trimmed !== product.name) {
                                                updateProductCatalogProduct(product.id, { name: trimmed });
                                                toast(`Renamed to "${trimmed}"`, 'success');
                                              }
                                              setEditingProductName(null);
                                            } else if (e.key === 'Escape') {
                                              setEditingProductName(null);
                                            }
                                          }}
                                          onBlur={() => {
                                            const trimmed = editProductNameVal.trim();
                                            if (trimmed && trimmed !== product.name) {
                                              updateProductCatalogProduct(product.id, { name: trimmed });
                                              toast(`Renamed to "${trimmed}"`, 'success');
                                            }
                                            setEditingProductName(null);
                                          }}
                                          className="w-full bg-[#1d2028] border border-[#00e07a] text-white rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                        />
                                      ) : (
                                        <span
                                          className="cursor-pointer hover:text-[#00c4f0] transition-colors inline-flex items-center gap-1.5 group/name"
                                          onClick={() => { if (!pcIsArchive) { setEditingProductName(product.id); setEditProductNameVal(product.name); } }}
                                        >
                                          {product.name}
                                          {!pcIsArchive && <Pencil className="w-3 h-3 text-[#525c72] opacity-0 group-hover/name:opacity-100 transition-opacity" />}
                                        </span>
                                      )}
                                      {pcIsArchive && !archiveVersion && (
                                        <span className="ml-2 text-[#525c72] text-[10px]">(no data for this version)</span>
                                      )}
                                    </td>
                                    {pcIsArchive ? (
                                      archiveVersion ? archiveVersion.tiers.map((tier, ti) => (
                                        <td key={ti} className="px-2 py-2 text-center">
                                          <div className="flex flex-col gap-1 items-center">
                                            <span className="text-[#00e07a]/60 font-medium text-xs">${tier.closerPerW.toFixed(2)}</span>
                                            <span className="text-[#00e07a]/50 text-xs">${tier.kiloPerW.toFixed(2)}</span>
                                          </div>
                                        </td>
                                      )) : (
                                        <td colSpan={4} className="px-4 py-3 text-center text-[#525c72] text-xs">No version data</td>
                                      )
                                    ) : (
                                      product.tiers.map((tier, ti) => (
                                        <td key={ti} className="px-2 py-2 text-center">
                                          <div className="flex flex-col gap-0.5 items-center">
                                            <input
                                              ref={(el) => setTierInputRef(`${product.id}-${ti}-closer`, el)}
                                              type="number" step="0.01" min="0"
                                              value={tier.closerPerW}
                                              onFocus={(e) => e.target.select()}
                                              onChange={(e) => updateProductCatalogTier(product.id, ti, { closerPerW: parseFloat(e.target.value) || 0 })}
                                              onKeyDown={(e) => handleTierKeyDown(e, pcDisplayProductIds, product.id, ti, 'closer')}
                                              className="w-16 bg-[#1d2028] border border-[#333849] text-[#00e07a] font-medium rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                            />
                                            {renderDeltaBadge(product.id, ti, 'closer', tier.closerPerW)}
                                            <input
                                              ref={(el) => setTierInputRef(`${product.id}-${ti}-kilo`, el)}
                                              type="number" step="0.01" min="0"
                                              value={tier.kiloPerW}
                                              onFocus={(e) => e.target.select()}
                                              onChange={(e) => updateProductCatalogTier(product.id, ti, { kiloPerW: parseFloat(e.target.value) || 0 })}
                                              onKeyDown={(e) => handleTierKeyDown(e, pcDisplayProductIds, product.id, ti, 'kilo')}
                                              className="w-16 bg-[#1d2028] border border-[#333849] text-[#00e07a]/80 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                            />
                                            {renderDeltaBadge(product.id, ti, 'kilo', tier.kiloPerW)}
                                            {showSubDealerRates && (
                                              <input
                                                type="number" step="0.01" min="0"
                                                value={tier.subDealerPerW ?? ''}
                                                placeholder="—"
                                                onFocus={(e) => e.target.select()}
                                                onChange={(e) => {
                                                  const val = e.target.value === '' ? undefined : parseFloat(e.target.value) || 0;
                                                  updateProductCatalogTier(product.id, ti, { subDealerPerW: val });
                                                }}
                                                className="w-16 bg-[#1d2028] border border-amber-700/50 text-amber-400 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                                              />
                                            )}
                                          </div>
                                        </td>
                                      ))
                                    )}
                                    <td className="px-4 py-3 text-center">
                                      {!pcIsArchive && (
                                        <div className="flex items-center gap-2 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                            onClick={() => {
                                              setPcNewVersionFor(product.id);
                                              const nextNum = pcAllVersions.length + 1;
                                              setPcNewVersionLabel(`v${nextNum}`);
                                              setPcNewVersionEffectiveFrom('');
                                              setPcNewVersionTiers(product.tiers.map((t) => ({
                                                closerPerW: String(t.closerPerW),
                                                kiloPerW: String(t.kiloPerW),
                                              })));
                                            }}
                                            title="Create new pricing version"
                                            className="text-[#525c72] hover:text-[#00e07a] transition-colors"
                                          >
                                            <GitBranch className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => {
                                              setConfirmAction({
                                                title: `Delete ${product.name}?`,
                                                message: 'Existing deals are unaffected.',
                                                onConfirm: async () => {
                                                  try {
                                                    await removeProductCatalogProduct(product.id);
                                                    toast('Product removed', 'info');
                                                  } catch {
                                                    toast('Failed to delete product', 'error');
                                                  }
                                                  setConfirmAction(null);
                                                },
                                              });
                                            }}
                                            className="text-[#525c72] hover:text-red-400 transition-colors"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {pcDisplayProducts.length === 0 && (
                                <tr>
                                  <td colSpan={6} className="px-5 py-8 text-center text-[#525c72]">
                                    {pcProductSearch.trim() ? 'No products match your search.' : 'No products for this family.'}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div className="px-5 py-3 border-t border-[#333849]/50 bg-[#1d2028]/20">
                          <p className="text-xs text-[#525c72]">Green = Closer $/W · Blue = Kilo $/W · Setter = Closer + $0.10/W (auto)</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Add product */}
                  <div className="mt-4 max-w-3xl">
                    {addingProductFor === installerName ? (
                      <div className="card-surface rounded-xl p-4">
                        <p className="text-white text-sm font-medium mb-3">Add Product to {installerName}</p>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs text-[#c2c8d8] mb-1">Product name</label>
                            <input type="text" placeholder="e.g. SunPower 400W"
                              value={newProductName} onChange={(e) => setNewProductName(e.target.value)}
                              className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-[#c2c8d8] mb-1">Family</label>
                            <select value={newProductFamily || currentFamily}
                              onChange={(e) => setNewProductFamily(e.target.value)}
                              className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                            >
                              {config.families.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </div>
                        </div>
                        {/* Tier pricing inputs */}
                        <div className="mb-3">
                          <p className="text-xs text-[#c2c8d8] mb-2">Tier Pricing ($/W)</p>
                          <div className="space-y-2">
                            {[
                              { label: '1–5 kW', idx: 0, cPlaceholder: '2.90', kPlaceholder: '2.35' },
                              { label: '5–10 kW', idx: 1, cPlaceholder: '2.85', kPlaceholder: '2.30' },
                              { label: '10–13 kW', idx: 2, cPlaceholder: '2.80', kPlaceholder: '2.25' },
                              { label: '13+ kW', idx: 3, cPlaceholder: '2.75', kPlaceholder: '2.20' },
                            ].map(({ label, idx, cPlaceholder, kPlaceholder }) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-xs text-[#8891a8] w-16 flex-shrink-0">{label}</span>
                                <div className="flex items-center gap-1 flex-1">
                                  <span className="text-[10px] text-[#525c72]">Closer</span>
                                  <input
                                    type="number" step="0.01" min="0" placeholder={cPlaceholder}
                                    value={newProductTiers[idx].closerPerW}
                                    onChange={(e) => setNewProductTiers((prev) => prev.map((t, i) => i === idx ? { ...t, closerPerW: e.target.value } : t))}
                                    className="w-20 bg-[#272b35] border border-[#272b35] text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                                  />
                                </div>
                                <div className="flex items-center gap-1 flex-1">
                                  <span className="text-[10px] text-[#525c72]">Kilo</span>
                                  <input
                                    type="number" step="0.01" min="0" placeholder={kPlaceholder}
                                    value={newProductTiers[idx].kiloPerW}
                                    onChange={(e) => setNewProductTiers((prev) => prev.map((t, i) => i === idx ? { ...t, kiloPerW: e.target.value } : t))}
                                    className="w-20 bg-[#272b35] border border-[#272b35] text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              const name = newProductName.trim();
                              if (!name) return;
                              const family = newProductFamily || currentFamily;
                              const defaultCloser = [2.90, 2.85, 2.80, 2.75];
                              const defaultKilo = [2.35, 2.30, 2.25, 2.20];
                              const closerArr = newProductTiers.map((t, i) => t.closerPerW ? parseFloat(t.closerPerW) : defaultCloser[i]);
                              const kiloArr = newProductTiers.map((t, i) => t.kiloPerW ? parseFloat(t.kiloPerW) : defaultKilo[i]);
                              addProductCatalogProduct({
                                id: `pc_${installerName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
                                installer: installerName,
                                family,
                                name,
                                tiers: makeProductCatalogTiers(closerArr, kiloArr),
                              });
                              toast('Product added', 'success');
                              setNewProductName('');
                              setNewProductFamily('');
                              setNewProductTiers([
                                { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
                                { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
                              ]);
                              setAddingProductFor(null);
                              // Switch to the family tab of the new product
                              setPcFamily((prev) => ({ ...prev, [installerName]: family }));
                            }}
                            className="flex-1 py-2 rounded-xl text-sm font-medium text-white transition-colors"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Add Product
                          </button>
                          <button
                            onClick={() => {
                              setAddingProductFor(null); setNewProductName(''); setNewProductFamily('');
                              setNewProductTiers([
                                { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
                                { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
                              ]);
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-medium bg-[#1d2028] text-[#c2c8d8] hover:bg-[#272b35] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingProductFor(installerName); setNewProductFamily(currentFamily); setNewProductTiers([{ closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }]); }}
                        className="flex items-center gap-2 text-[#c2c8d8] hover:text-white text-sm transition-colors"
                      >
                        <Plus className="w-4 h-4" /> Add product to {installerName}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── Product Catalog New Version Modal ───────────────────────────── */}
            {pcNewVersionFor && (() => {
              const pcProduct = productCatalogProducts.find((p) => p.id === pcNewVersionFor) || solarTechProducts.find((p) => p.id === pcNewVersionFor);
              return pcProduct ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                  <div className="bg-[#161920] border border-[#272b35]/80 rounded-2xl p-6 w-full max-w-lg shadow-2xl shadow-black/40 animate-modal-panel">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-white font-bold">New Pricing Version</h3>
                        <p className="text-[#8891a8] text-xs mt-0.5">{pcProduct.name} — closes current version on the day before effective date</p>
                      </div>
                      <button onClick={() => setPcNewVersionFor(null)} className="text-[#8891a8] hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* Label + effective date */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#c2c8d8] mb-1">Version label</label>
                          <input type="text" placeholder="e.g. v2 — March 2026"
                            value={pcNewVersionLabel} onChange={(e) => setPcNewVersionLabel(e.target.value)}
                            className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#c2c8d8] mb-1">Effective from</label>
                          <input type="date"
                            value={pcNewVersionEffectiveFrom} onChange={(e) => setPcNewVersionEffectiveFrom(e.target.value)}
                            className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                          />
                        </div>
                      </div>

                      {/* Tier inputs — 4 brackets */}
                      <div>
                        <p className="text-xs text-[#c2c8d8] mb-2">Tier pricing (Closer $/W · Kilo $/W)</p>
                        <div className="grid grid-cols-4 gap-2">
                          {['1–5 kW', '5–10 kW', '10–13 kW', '13+ kW'].map((bracket, i) => (
                            <div key={bracket} className="space-y-1">
                              <p className="text-[10px] text-[#8891a8] text-center">{bracket}</p>
                              <input type="number" step="0.01" min="0"
                                value={pcNewVersionTiers[i]?.closerPerW ?? ''}
                                onChange={(e) => setPcNewVersionTiers((prev) => prev.map((t, idx) => idx === i ? { ...t, closerPerW: e.target.value } : t))}
                                className="w-full bg-[#1d2028] border border-[#333849] text-[#00e07a] rounded-xl px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                placeholder="Closer"
                              />
                              <input type="number" step="0.01" min="0"
                                value={pcNewVersionTiers[i]?.kiloPerW ?? ''}
                                onChange={(e) => setPcNewVersionTiers((prev) => prev.map((t, idx) => idx === i ? { ...t, kiloPerW: e.target.value } : t))}
                                className="w-full bg-[#1d2028] border border-[#333849] text-[#00e07a] rounded-xl px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                placeholder="Kilo"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 mt-5">
                      <button onClick={() => setPcNewVersionFor(null)}
                        className="flex-1 py-2 rounded-xl text-sm font-medium bg-[#1d2028] text-[#c2c8d8] hover:bg-[#272b35] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (!pcNewVersionLabel.trim() || !pcNewVersionEffectiveFrom) return;
                          const tiers: ProductCatalogTier[] = pcNewVersionTiers.map((t, i) => {
                            const breaks = [1, 5, 10, 13];
                            const maxBreaks = [5, 10, 13, null];
                            return {
                              minKW: breaks[i],
                              maxKW: maxBreaks[i],
                              closerPerW: parseFloat(t.closerPerW) || 0,
                              setterPerW: Math.round(((parseFloat(t.closerPerW) || 0) + 0.10) * 100) / 100,
                              kiloPerW: parseFloat(t.kiloPerW) || 0,
                            };
                          });
                          createNewProductCatalogVersion(pcNewVersionFor!, pcNewVersionLabel.trim(), pcNewVersionEffectiveFrom, tiers);
                          setPcNewVersionFor(null);
                          toast('Pricing version created', 'success');
                        }}
                        disabled={!pcNewVersionLabel.trim() || !pcNewVersionEffectiveFrom}
                        className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        style={{ backgroundColor: 'var(--brand)' }}
                      >
                        Create Version
                      </button>
                    </div>
                  </div>
                </div>
              ) : null;
            })()}

            {/* ── Duplicate All as New Version Modal ────────────────────────── */}
            {dupAllOpen && (() => {
              const isSt = dupAllOpen === 'solartech';
              const targetProducts = isSt
                ? solarTechProducts.filter((p) => p.family === stFamily)
                : (() => {
                    const installerName = baselineTab;
                    const config = productCatalogInstallerConfigs[installerName];
                    if (!config) return [];
                    const currentFamily = pcFamily[installerName] ?? config.families[0] ?? '';
                    return productCatalogProducts.filter((p) => p.installer === installerName && p.family === currentFamily);
                  })();
              const familyLabel = isSt
                ? stFamily
                : (() => {
                    const config = productCatalogInstallerConfigs[baselineTab];
                    return config ? `${baselineTab} — ${pcFamily[baselineTab] ?? config.families[0] ?? ''}` : baselineTab;
                  })();

              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                  <div className="bg-[#161920] border border-[#272b35]/80 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-black/40 animate-modal-panel">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-white font-bold">Duplicate All as New Version</h3>
                        <p className="text-[#8891a8] text-xs mt-0.5">Snapshot current pricing for {targetProducts.length} product{targetProducts.length !== 1 ? 's' : ''} in {familyLabel}</p>
                      </div>
                      <button onClick={() => setDupAllOpen(null)} className="text-[#8891a8] hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Version label</label>
                        <input type="text" placeholder="e.g. Q2 2026 Pricing"
                          value={dupAllLabel} onChange={(e) => setDupAllLabel(e.target.value)}
                          className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a] placeholder-[#525c72]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#c2c8d8] mb-1">Effective from</label>
                        <input type="date"
                          value={dupAllEffectiveFrom} onChange={(e) => setDupAllEffectiveFrom(e.target.value)}
                          className="w-full bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00e07a]"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 mt-5">
                      <button onClick={() => setDupAllOpen(null)}
                        className="flex-1 py-2 rounded-xl text-sm font-medium bg-[#1d2028] text-[#c2c8d8] hover:bg-[#272b35] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (!dupAllLabel.trim() || !dupAllEffectiveFrom) return;
                          const breaks = [1, 5, 10, 13];
                          const maxBreaks: (number | null)[] = [5, 10, 13, null];
                          targetProducts.forEach((product) => {
                            const tiers: ProductCatalogTier[] = product.tiers.map((t, i) => ({
                              minKW: breaks[i],
                              maxKW: maxBreaks[i],
                              closerPerW: t.closerPerW,
                              setterPerW: Math.round((t.closerPerW + 0.10) * 100) / 100,
                              kiloPerW: t.kiloPerW,
                            }));
                            createNewProductCatalogVersion(product.id, dupAllLabel.trim(), dupAllEffectiveFrom, tiers);
                          });
                          toast(`New version created for ${targetProducts.length} product${targetProducts.length !== 1 ? 's' : ''}`, 'success');
                          setDupAllOpen(null);
                        }}
                        disabled={!dupAllLabel.trim() || !dupAllEffectiveFrom || targetProducts.length === 0}
                        className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        style={{ backgroundColor: 'var(--brand)' }}
                      >
                        Duplicate {targetProducts.length} Product{targetProducts.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* SolarTech — product family sub-tabs + tier table */}
            {baselineTab === 'solartech' && (
              <div>
                {/* Family sub-tabs */}
                <div className="flex gap-1 mb-4 bg-[#161920] border border-[#333849] rounded-xl p-1 w-fit tab-bar-container">
                  {stFamilyIndicator && <div className="tab-indicator" style={stFamilyIndicator} />}
                  {SOLARTECH_FAMILIES.map((fam, i) => {
                    const famCount = solarTechProducts.filter((p) => p.family === fam).length;
                    return (
                    <button
                      key={fam}
                      ref={(el) => { stFamilyRefs.current[i] = el; }}
                      onClick={() => setStFamily(fam)}
                      className={`relative z-10 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.97] ${
                        stFamily === fam ? 'text-white' : famCount === 0 ? 'text-[#525c72] hover:text-[#c2c8d8]' : 'text-[#c2c8d8] hover:text-white'
                      }`}
                    >
                      {fam} <span className={`ml-0.5 ${stFamily === fam ? 'text-[#c2c8d8]' : 'text-[#525c72]'}`}>({famCount})</span>
                    </button>
                    );
                  })}
                </div>

                {/* Action bar: Version selector + Duplicate All + Bulk Adjust toggle */}
                {(() => {
                  const stCurrentView = stVersionView[stFamily] ?? 'current';
                  const stFamilyProductIds = new Set(solarTechProducts.filter((p) => p.family === stFamily).map((p) => p.id));
                  const stFamilyVersions = productCatalogPricingVersions.filter((v) => stFamilyProductIds.has(v.productId) && v.effectiveTo !== null);
                  const stVersionGroups = new Map<string, { label: string; effectiveFrom: string; effectiveTo: string }>();
                  stFamilyVersions.forEach((v) => {
                    const key = `${v.label}|${v.effectiveFrom}`;
                    if (!stVersionGroups.has(key)) stVersionGroups.set(key, { label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo ?? '' });
                  });
                  const stSortedGroups = [...stVersionGroups.entries()].sort((a, b) => b[1].effectiveFrom.localeCompare(a[1].effectiveFrom));
                  const stIsArchive = stCurrentView !== 'current';
                  return (
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {/* Version selector */}
                      <select
                        value={stCurrentView}
                        onChange={(e) => setStVersionView((prev) => ({ ...prev, [stFamily]: e.target.value }))}
                        className="bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                      >
                        <option value="current">Current (editable)</option>
                        {stSortedGroups.map(([key, g]) => (
                          <option key={key} value={key}>{g.label} — {g.effectiveFrom}</option>
                        ))}
                      </select>
                      {stIsArchive && (
                        <>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium">
                            <History className="w-3 h-3" />
                            Viewing archived version
                            {(() => { const g = stVersionGroups.get(stCurrentView); return g ? ` · ${g.effectiveFrom} → ${g.effectiveTo}` : ''; })()}
                          </span>
                          <button
                            onClick={() => {
                              const [label, effectiveFrom] = stCurrentView.split('|');
                              setConfirmAction({
                                title: 'Delete Pricing Version',
                                message: 'Delete this pricing version? This cannot be undone.',
                                onConfirm: () => {
                                  const idsToDelete = productCatalogPricingVersions
                                    .filter((v) => stFamilyProductIds.has(v.productId) && v.label === label && v.effectiveFrom === effectiveFrom)
                                    .map((v) => v.id);
                                  deleteProductCatalogPricingVersions(idsToDelete);
                                  setStVersionView((prev) => ({ ...prev, [stFamily]: 'current' }));
                                  toast('Pricing version deleted', 'success');
                                  setConfirmAction(null);
                                },
                              });
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete Version
                          </button>
                        </>
                      )}
                      {!stIsArchive && (
                        <>
                          <button
                            onClick={() => { setDupAllOpen('solartech'); setDupAllLabel(''); setDupAllEffectiveFrom(''); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1d2028] border border-[#333849] text-[#c2c8d8] hover:text-white hover:border-[#272b35] transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" /> Duplicate All as New Version
                          </button>
                          <button
                            onClick={() => { setBulkAdjustOpen(bulkAdjustOpen === 'solartech' ? null : 'solartech'); setBulkRateAdj(''); setBulkSpreadInputs(['', '', '', '']); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                              bulkAdjustOpen === 'solartech'
                                ? 'bg-[#00e07a]/15 border-[#00e07a]/30 text-[#00e07a]'
                                : 'bg-[#1d2028] border-[#272b35] text-[#c2c8d8] hover:text-white hover:border-[#272b35]'
                            }`}
                          >
                            <Sliders className="w-3.5 h-3.5" /> Bulk Adjust
                            {bulkAdjustOpen === 'solartech' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Bulk Adjust Panel — SolarTech */}
                {bulkAdjustOpen === 'solartech' && (() => {
                  const familyProducts = solarTechProducts.filter((p) => p.family === stFamily);
                  const adjVal = parseFloat(bulkRateAdj) || 0;
                  const spreadVals = bulkSpreadInputs.map((v) => parseFloat(v));
                  const anySpreadSet = spreadVals.some((v) => !isNaN(v) && v !== 0);

                  return (
                    <div className="card-surface rounded-xl p-4 mb-3 space-y-4">
                      {/* Tool A: Bulk Rate Adjustment */}
                      <div>
                        <p className="text-white text-xs font-semibold mb-2">Bulk Rate Adjustment</p>
                        <div className="flex items-center gap-3">
                          <label className="text-[#c2c8d8] text-xs whitespace-nowrap">Adjust closer baselines by</label>
                          <div className="flex items-center gap-1">
                            <span className="text-[#8891a8] text-xs">$</span>
                            <input
                              type="number" step="0.01"
                              value={bulkRateAdj}
                              onChange={(e) => setBulkRateAdj(e.target.value)}
                              placeholder="+/- 0.00"
                              className="w-24 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                            />
                            <span className="text-[#8891a8] text-xs">/W</span>
                          </div>
                          {adjVal !== 0 && (
                            <span className="text-[#8891a8] text-[10px]">
                              {familyProducts.length} product{familyProducts.length !== 1 ? 's' : ''} x 4 tiers affected
                            </span>
                          )}
                          <button
                            disabled={adjVal === 0}
                            onClick={() => {
                              familyProducts.forEach((p) => {
                                p.tiers.forEach((tier, ti) => {
                                  const newCloser = Math.round((tier.closerPerW + adjVal) * 100) / 100;
                                  updateSolarTechTier(p.id, ti, { closerPerW: newCloser });
                                });
                              });
                              toast(`Closer adjusted by $${adjVal >= 0 ? '+' : ''}${adjVal.toFixed(2)}/W on ${familyProducts.length} products`, 'success');
                              setBulkRateAdj('');
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Apply
                          </button>
                        </div>
                      </div>

                      {/* Tool B: Kilo Spread Minimums */}
                      <div className="border-t border-[#333849] pt-4">
                        <p className="text-white text-xs font-semibold mb-2">Kilo Spread Minimums</p>
                        <p className="text-[#8891a8] text-[10px] mb-2">Sets closerPerW = kiloPerW + spread for each tier (Kilo rate is the anchor)</p>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {['Under 5kW', '5-10kW', '10-13kW', '13+ kW'].map((label, i) => (
                            <div key={label}>
                              <p className="text-[10px] text-[#8891a8] mb-1 text-center">{label} spread</p>
                              <div className="flex items-center gap-1 justify-center">
                                <span className="text-[#8891a8] text-xs">$</span>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={bulkSpreadInputs[i]}
                                  onChange={(e) => setBulkSpreadInputs((prev) => {
                                    const next = [...prev] as [string, string, string, string];
                                    next[i] = e.target.value;
                                    return next;
                                  })}
                                  placeholder="0.00"
                                  className="w-16 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        {anySpreadSet && (
                          <p className="text-[#8891a8] text-[10px] mb-2">
                            Preview: {familyProducts.length} product{familyProducts.length !== 1 ? 's' : ''} will have closer baselines recalculated per tier
                          </p>
                        )}
                        <button
                          disabled={!anySpreadSet}
                          onClick={() => {
                            familyProducts.forEach((p) => {
                              p.tiers.forEach((tier, ti) => {
                                const spread = spreadVals[ti];
                                if (!isNaN(spread) && spread !== 0) {
                                  const newCloser = Math.round((tier.kiloPerW + spread) * 100) / 100;
                                  updateSolarTechTier(p.id, ti, { closerPerW: newCloser });
                                }
                              });
                            });
                            toast(`Closer spreads applied to ${familyProducts.length} products`, 'success');
                            setBulkSpreadInputs(['', '', '', '']);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          style={{ backgroundColor: 'var(--brand)' }}
                        >
                          Apply Spreads
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Product table — inline cell editing */}
                {(() => {
                  const stCurrentView = stVersionView[stFamily] ?? 'current';
                  const stIsArchive = stCurrentView !== 'current';
                  const [stArchiveLabel, stArchiveFrom] = stIsArchive ? stCurrentView.split('|') : ['', ''];
                  const stAllFamilyProducts = solarTechProducts.filter((p) => p.family === stFamily);
                  const stDisplayProducts = stProductSearch.trim()
                    ? stAllFamilyProducts.filter((p) => p.name.toLowerCase().includes(stProductSearch.toLowerCase().trim()))
                    : stAllFamilyProducts;
                  const stDisplayProductIds = stDisplayProducts.map((p) => p.id);
                  // Summary stats
                  const stSummaryCount = stAllFamilyProducts.length;
                  const stAllClosers = stAllFamilyProducts.flatMap((p) => p.tiers.map((t) => t.closerPerW));
                  const stSpreadMin = stAllClosers.length > 0 ? Math.min(...stAllClosers) : 0;
                  const stSpreadMax = stAllClosers.length > 0 ? Math.max(...stAllClosers) : 0;
                  return (
                    <div className="card-surface rounded-xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-[#333849]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-white font-semibold">{stFamily}</h2>
                            <p className="text-[#8891a8] text-xs mt-0.5">
                              {stIsArchive ? 'Viewing archived version (read-only)' : 'Click any value to edit · Setter = Closer + $0.10/W auto-calculated'}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setShowSubDealerRates((v) => !v)}
                              className="flex items-center gap-2 text-xs font-medium text-[#c2c8d8] hover:text-white transition-colors shrink-0"
                            >
                              <span>SD Rate</span>
                              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showSubDealerRates ? 'bg-amber-500' : 'bg-[#272b35]'}`}>
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${showSubDealerRates ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                              </span>
                            </button>
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8]" />
                              <input
                                type="text"
                                placeholder="Search products..."
                                value={stProductSearch}
                                onChange={(e) => setStProductSearch(e.target.value)}
                                className="w-48 bg-[#1d2028] border border-[#333849] text-[#f0f2f7] rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a] placeholder-[#525c72]"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="table-header-frost">
                            <tr className="border-b border-[#333849]">
                              <th className="text-left px-5 py-3 text-[#c2c8d8] font-medium">Product</th>
                              {['1–5 kW', '5–10 kW', '10–13 kW', '13+ kW'].map((label) => (
                                <th key={label} className="text-center px-4 py-3 text-[#c2c8d8] font-medium whitespace-nowrap">{label}</th>
                              ))}
                              <th className="px-4 py-3 w-10" />
                            </tr>
                            {showSubDealerRates && (
                              <tr><td colSpan={6} className="px-4 py-1 text-amber-400/60 text-[10px] text-right">Amber values = Sub-Dealer Rate</td></tr>
                            )}
                          </thead>
                          <tbody>
                            {/* Family summary stats row */}
                            {stAllFamilyProducts.length > 0 && (
                              <tr className="bg-[#1d2028]/60 border-b border-[#333849]">
                                <td className="px-5 py-2 text-[#c2c8d8] text-xs font-medium">{stSummaryCount} product{stSummaryCount !== 1 ? 's' : ''}</td>
                                {[0, 1, 2, 3].map((ti) => {
                                  const profits = stAllFamilyProducts.map((p) => (p.tiers[ti]?.closerPerW ?? 0) - (p.tiers[ti]?.kiloPerW ?? 0));
                                  const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
                                  return (
                                    <td key={ti} className="px-2 py-2 text-center">
                                      <span className={`text-[10px] font-semibold ${avgProfit > 0 ? 'text-[#00e07a]/70' : 'text-red-400/70'}`}>
                                        ${avgProfit.toFixed(2)} profit
                                      </span>
                                    </td>
                                  );
                                })}
                                {showSubDealerRates && <td />}
                                <td className="px-4 py-2 text-center">
                                  <span className="text-[#8891a8] text-[10px]">${stSpreadMin.toFixed(2)}–${stSpreadMax.toFixed(2)}</span>
                                </td>
                              </tr>
                            )}
                            {stDisplayProducts.map((product) => {
                              const stAllVersions = productCatalogPricingVersions.filter((v) => v.productId === product.id);
                              const archiveVersion = stIsArchive
                                ? stAllVersions.find((v) => v.label === stArchiveLabel && v.effectiveFrom === stArchiveFrom)
                                : null;
                              return (
                                <tr key={product.id} className="border-b border-[#333849]/50 hover:bg-[#1d2028]/30 transition-colors group">
                                  <td className="px-5 py-3 text-white text-xs max-w-[200px]">
                                    {editingProductName === product.id ? (
                                      <input
                                        autoFocus
                                        type="text"
                                        value={editProductNameVal}
                                        onChange={(e) => setEditProductNameVal(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const trimmed = editProductNameVal.trim();
                                            if (trimmed && trimmed !== product.name) {
                                              updateSolarTechProduct(product.id, { name: trimmed });
                                              toast(`Renamed to "${trimmed}"`, 'success');
                                            }
                                            setEditingProductName(null);
                                          } else if (e.key === 'Escape') {
                                            setEditingProductName(null);
                                          }
                                        }}
                                        onBlur={() => {
                                          const trimmed = editProductNameVal.trim();
                                          if (trimmed && trimmed !== product.name) {
                                            updateSolarTechProduct(product.id, { name: trimmed });
                                            toast(`Renamed to "${trimmed}"`, 'success');
                                          }
                                          setEditingProductName(null);
                                        }}
                                        className="w-full bg-[#1d2028] border border-[#00e07a] text-white rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                      />
                                    ) : (
                                      <span
                                        className="cursor-pointer hover:text-[#00c4f0] transition-colors inline-flex items-center gap-1.5 group/name"
                                        onClick={() => { if (!stIsArchive) { setEditingProductName(product.id); setEditProductNameVal(product.name); } }}
                                      >
                                        {product.name}
                                        {!stIsArchive && <Pencil className="w-3 h-3 text-[#525c72] opacity-0 group-hover/name:opacity-100 transition-opacity" />}
                                      </span>
                                    )}
                                    {stIsArchive && !archiveVersion && (
                                      <span className="ml-2 text-[#525c72] text-[10px]">(no data for this version)</span>
                                    )}
                                  </td>
                                  {stIsArchive ? (
                                    archiveVersion ? archiveVersion.tiers.map((tier, ti) => (
                                      <td key={ti} className="px-2 py-2 text-center">
                                        <div className="flex flex-col gap-1 items-center">
                                          <span className="text-[#00e07a]/60 font-medium text-xs">${tier.closerPerW.toFixed(2)}</span>
                                          <span className="text-[#00e07a]/50 text-xs">${tier.kiloPerW.toFixed(2)}</span>
                                          {showSubDealerRates && (
                                            <span className="text-amber-400/50 text-xs">{(tier as any).subDealerPerW != null ? `$${(tier as any).subDealerPerW.toFixed(2)}` : '—'}</span>
                                          )}
                                        </div>
                                      </td>
                                    )) : (
                                      <td colSpan={4} className="px-4 py-3 text-center text-[#525c72] text-xs">No version data</td>
                                    )
                                  ) : (
                                    product.tiers.map((tier, ti) => (
                                      <td key={ti} className="px-2 py-2 text-center">
                                        <div className="flex flex-col gap-0.5 items-center">
                                          <input
                                            ref={(el) => setTierInputRef(`${product.id}-${ti}-closer`, el)}
                                            type="number" step="0.01" min="0"
                                            value={tier.closerPerW}
                                            onFocus={(e) => e.target.select()}
                                            onChange={(e) => updateSolarTechTier(product.id, ti, { closerPerW: parseFloat(e.target.value) || 0 })}
                                            onKeyDown={(e) => handleTierKeyDown(e, stDisplayProductIds, product.id, ti, 'closer')}
                                            className="w-16 bg-[#1d2028] border border-[#333849] text-[#00e07a] font-medium rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                          />
                                          {renderDeltaBadge(product.id, ti, 'closer', tier.closerPerW)}
                                          <input
                                            ref={(el) => setTierInputRef(`${product.id}-${ti}-kilo`, el)}
                                            type="number" step="0.01" min="0"
                                            value={tier.kiloPerW}
                                            onFocus={(e) => e.target.select()}
                                            onChange={(e) => updateSolarTechTier(product.id, ti, { kiloPerW: parseFloat(e.target.value) || 0 })}
                                            onKeyDown={(e) => handleTierKeyDown(e, stDisplayProductIds, product.id, ti, 'kilo')}
                                            className="w-16 bg-[#1d2028] border border-[#333849] text-[#00e07a]/80 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                                          />
                                          {renderDeltaBadge(product.id, ti, 'kilo', tier.kiloPerW)}
                                          {showSubDealerRates && (
                                            <input
                                              type="number" step="0.01" min="0"
                                              value={tier.subDealerPerW ?? ''}
                                              placeholder="—"
                                              onFocus={(e) => e.target.select()}
                                              onChange={(e) => {
                                                const val = e.target.value === '' ? undefined : parseFloat(e.target.value) || 0;
                                                updateSolarTechTier(product.id, ti, { subDealerPerW: val });
                                              }}
                                              className="w-16 bg-[#1d2028] border border-amber-700/50 text-amber-400 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            />
                                          )}
                                        </div>
                                      </td>
                                    ))
                                  )}
                                  <td className="px-4 py-3 text-center">
                                    {!stIsArchive && (
                                      <div className="flex items-center gap-2 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => {
                                            setPcNewVersionFor(product.id);
                                            const nextNum = stAllVersions.length + 1;
                                            setPcNewVersionLabel(`v${nextNum}`);
                                            setPcNewVersionEffectiveFrom('');
                                            setPcNewVersionTiers(product.tiers.map((t) => ({
                                              closerPerW: String(t.closerPerW),
                                              kiloPerW: String(t.kiloPerW),
                                            })));
                                          }}
                                          title="Create new pricing version"
                                          className="text-[#525c72] hover:text-[#00e07a] transition-colors"
                                        >
                                          <GitBranch className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {stDisplayProducts.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-5 py-8 text-center text-[#525c72]">
                                  {stProductSearch.trim() ? 'No products match your search.' : 'No products for this family.'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="px-5 py-3 border-t border-[#333849]/50 bg-[#1d2028]/20">
                        <p className="text-xs text-[#525c72]">Green = Closer $/W · Blue = Kilo $/W · Setter = Closer + $0.10/W (auto)</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}


        {/* ── Spacer so content is never hidden behind the fixed action bar ── */}
        {(selectedInstallers.size > 0 || selectedFinancers.size > 0) && <div className="h-20" />}

      </main>

      {/* ── Floating bulk-action toolbar (installers + financers) ─────────── */}
      {(selectedInstallers.size > 0 || selectedFinancers.size > 0) && (() => {
        const selInstallers = [...selectedInstallers];
        const selFinancers = [...selectedFinancers];
        const totalCount = selInstallers.length + selFinancers.length;
        // Determine if selected items are all active, all archived, or mixed
        const selectedActiveInstallers = selInstallers.filter((n) => installers.find((i) => i.name === n)?.active);
        const selectedArchivedInstallers = selInstallers.filter((n) => !installers.find((i) => i.name === n)?.active);
        const selectedActiveFinancers = selFinancers.filter((n) => financers.find((f) => f.name === n)?.active);
        const selectedArchivedFinancers = selFinancers.filter((n) => !financers.find((f) => f.name === n)?.active);
        const hasActive = selectedActiveInstallers.length > 0 || selectedActiveFinancers.length > 0;
        const hasArchived = selectedArchivedInstallers.length > 0 || selectedArchivedFinancers.length > 0;
        return (
          <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 backdrop-blur-xl bg-[#161920]/80 border border-[#272b35]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40 animate-float-toolbar-in"
            role="toolbar"
            aria-label="Batch actions for selected items"
          >
            <div className="flex items-center gap-3">
              {/* Selection count badge */}
              <span className="flex items-center gap-1.5 bg-[#00e07a]/15 border border-[#00e07a]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
                <span className="text-white font-bold tabular-nums">{totalCount}</span>
                <span className="text-[#00e07a] font-medium">selected</span>
              </span>

              {/* Visual divider */}
              <div className="h-5 w-px bg-[#272b35]/80 flex-shrink-0" />

              {/* Archive Selected — only if some active items are selected */}
              {hasActive && (
                <button
                  onClick={() => {
                    selectedActiveInstallers.forEach((n) => setInstallerActive(n, false));
                    selectedActiveFinancers.forEach((n) => setFinancerActive(n, false));
                    const count = selectedActiveInstallers.length + selectedActiveFinancers.length;
                    toast(`${count} item${count !== 1 ? 's' : ''} archived`, 'info');
                    setSelectedInstallers(new Set());
                    setSelectedFinancers(new Set());
                    setInstallerSelectMode(false);
                    setFinancerSelectMode(false);
                  }}
                  className="flex items-center gap-1.5 text-white font-semibold px-4 py-1.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20 active:scale-[0.97] transition-all whitespace-nowrap"
                >
                  <EyeOff className="w-3.5 h-3.5" /> Archive Selected
                </button>
              )}

              {/* Restore Selected — only if some archived items are selected */}
              {hasArchived && (
                <button
                  onClick={() => {
                    selectedArchivedInstallers.forEach((n) => setInstallerActive(n, true));
                    selectedArchivedFinancers.forEach((n) => setFinancerActive(n, true));
                    const count = selectedArchivedInstallers.length + selectedArchivedFinancers.length;
                    toast(`${count} item${count !== 1 ? 's' : ''} restored`, 'info');
                    setSelectedInstallers(new Set());
                    setSelectedFinancers(new Set());
                    setInstallerSelectMode(false);
                    setFinancerSelectMode(false);
                  }}
                  className="flex items-center gap-1.5 text-white font-semibold px-4 py-1.5 rounded-xl text-sm bg-[#00e07a] hover:bg-[#00e07a] shadow-lg shadow-emerald-500/20 active:scale-[0.97] transition-all whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" /> Restore Selected
                </button>
              )}

              {/* Dismiss / deselect-all button */}
              <button
                onClick={() => { setSelectedInstallers(new Set()); setSelectedFinancers(new Set()); setInstallerSelectMode(false); setFinancerSelectMode(false); }}
                aria-label="Deselect all and dismiss toolbar"
                className="btn-secondary p-1.5 rounded-lg bg-[#272b35]/60 hover:bg-[#525c72]/80 border border-[#272b35]/40 text-[#c2c8d8] hover:text-white transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Shared confirm dialog (product / admin-user deletes) ──────────── */}
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel="Delete"
        danger
      />

      {/* ── Unified delete-confirm dialog ─────────────────────────────────── */}
      {deleteConfirm && (
        <ConfirmDeleteDialog
          confirm={deleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {/* ── Unsaved-changes guard dialog ─────────────────────────────────── */}
      <ConfirmDialog
        open={pendingSection !== null}
        onClose={() => setPendingSection(null)}
        onConfirm={discardAndNavigate}
        title="Discard unsaved changes?"
        message="You have unsaved edits in progress. Switching sections will discard them."
        confirmLabel="Discard"
        danger
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── ConfirmDeleteDialog ───────────────────────────────────────────────────────

function ConfirmDeleteDialog({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: { type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Installer deletes with cascade require typing the name to confirm.
  // The message contains "PERMANENTLY delete" when there's a non-trivial
  // cascade (products and/or pricing versions about to be wiped).
  // For no-cascade installer deletes and all other types (financer,
  // trainer), a simple click-to-confirm is still fine.
  const requiresTypeToConfirm = confirm.type === 'installer' && confirm.message.includes('PERMANENTLY delete');
  const [typed, setTyped] = useState('');
  const canConfirm = !requiresTypeToConfirm || typed === confirm.name;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-[#161920] border border-[#272b35]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <h3 className="text-white font-bold">
            Delete {confirm.type === 'trainer' ? `Assignment: ${confirm.name}` : confirm.name}?
          </h3>
        </div>
        {/* whitespace-pre-line so embedded \n in the message survive rendering */}
        <p className="text-[#c2c8d8] text-sm mb-5 whitespace-pre-line">{confirm.message}</p>
        {requiresTypeToConfirm && (
          <div className="mb-5">
            <label className="text-xs font-medium mb-2 block" style={{ color: '#8891a8' }}>
              Type <span className="text-white font-bold">{confirm.name}</span> to confirm:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              className="w-full rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-red-500/50"
              style={{ background: '#1d2028', border: '1px solid #333849' }}
              placeholder={confirm.name}
            />
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[#272b35] text-[#c2c8d8] hover:bg-[#525c72] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold" style={{ color: '#f0f2f7' }}>{title}</h2>
      <p className="text-sm mt-0.5" style={{ color: '#8891a8' }}>{subtitle}</p>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar — 5 nav item lines matching real NAV groups */}
      <aside className="w-56 flex-shrink-0 border-r border-[#333849] p-4 pt-8 hidden md:block">
        <div className="mb-6">
          <div className="h-[3px] w-8 rounded-full bg-[#272b35] animate-skeleton mb-3" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 bg-[#1d2028] rounded-lg animate-skeleton" />
            <div className="h-6 w-20 bg-[#1d2028] rounded animate-skeleton" />
          </div>
        </div>
        {/* Group label + 1 item, group label + 3 items, group label + 1 item = 5 items */}
        <div className="space-y-4">
          {/* Team group */}
          <div>
            <div className="h-2 w-10 bg-[#272b35]/50 rounded animate-skeleton mb-1.5 ml-2" />
            <div className="h-9 bg-[#1d2028]/60 rounded-xl animate-skeleton" style={{ animationDelay: '0ms' }} />
          </div>
          {/* Business group */}
          <div>
            <div className="h-2 w-14 bg-[#272b35]/50 rounded animate-skeleton mb-1.5 ml-2" style={{ animationDelay: '50ms' }} />
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 bg-[#1d2028]/60 rounded-xl animate-skeleton" style={{ animationDelay: `${i * 50}ms` }} />
              ))}
            </div>
          </div>
          {/* System group */}
          <div>
            <div className="h-2 w-12 bg-[#272b35]/50 rounded animate-skeleton mb-1.5 ml-2" style={{ animationDelay: '200ms' }} />
            <div className="h-9 bg-[#1d2028]/60 rounded-xl animate-skeleton" style={{ animationDelay: '250ms' }} />
          </div>
        </div>
      </aside>

      {/* Content area — 3 card placeholders */}
      <main className="flex-1 p-8">
        <div className="max-w-xl">
          {/* Page heading */}
          <div className="h-7 w-40 bg-[#1d2028] rounded animate-skeleton mb-1" />
          <div className="h-4 w-64 bg-[#1d2028]/70 rounded animate-skeleton mb-6" />

          {/* Card 1 */}
          <div className="card-surface rounded-2xl p-5 mb-4">
            <div className="h-5 w-32 bg-[#1d2028] rounded animate-skeleton mb-4" style={{ animationDelay: '50ms' }} />
            <div className="flex gap-3 mb-3">
              <div className="flex-1 h-9 bg-[#1d2028] rounded-xl animate-skeleton" style={{ animationDelay: '100ms' }} />
              <div className="w-10 h-9 bg-[#1d2028] rounded-xl animate-skeleton" style={{ animationDelay: '100ms' }} />
            </div>
            <div className="h-9 w-full bg-[#1d2028]/60 rounded-xl animate-skeleton" style={{ animationDelay: '150ms' }} />
          </div>

          {/* Card 2 */}
          <div className="card-surface rounded-2xl p-5 mb-4" style={{ animationDelay: '80ms' }}>
            <div className="h-5 w-24 bg-[#1d2028] rounded animate-skeleton mb-4" style={{ animationDelay: '130ms' }} />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-11 bg-[#1d2028]/60 rounded-xl animate-skeleton" style={{ animationDelay: `${180 + i * 55}ms` }} />
              ))}
            </div>
          </div>

          {/* Card 3 */}
          <div className="card-surface rounded-2xl p-5" style={{ animationDelay: '160ms' }}>
            <div className="h-5 w-28 bg-[#1d2028] rounded animate-skeleton mb-4" style={{ animationDelay: '210ms' }} />
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-11 bg-[#1d2028]/60 rounded-xl animate-skeleton" style={{ animationDelay: `${260 + i * 55}ms` }} />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
