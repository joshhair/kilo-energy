'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { DEFAULT_INSTALL_PAY_PCT } from '../../../lib/data';
import {
  ArrowLeft, Layers, Tent, Users, Handshake,
  Building2, Landmark, BookOpen, Shield, Download,
  Plus, Trash2, CheckSquare, Square,
} from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileListItem from './shared/MobileListItem';
import MobileSection from './shared/MobileSection';
import MobileEmptyState from './shared/MobileEmptyState';

// ─── Types ──────────────────────────────────────────────────────────────────

type SettingsSection =
  | 'trainers' | 'blitz-permissions' | 'project-managers' | 'sub-dealers'
  | 'installers' | 'financers' | 'baselines'
  | 'users' | 'export';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: 'Team',
    items: [
      { id: 'trainers', label: 'Trainer Overrides', icon: Layers },
      { id: 'blitz-permissions', label: 'Blitz Permissions', icon: Tent },
      { id: 'project-managers', label: 'Project Managers', icon: Users },
      { id: 'sub-dealers', label: 'Sub-Dealers', icon: Handshake },
    ],
  },
  {
    group: 'Business',
    items: [
      { id: 'installers', label: 'Installers', icon: Building2 },
      { id: 'financers', label: 'Financers', icon: Landmark },
      { id: 'baselines', label: 'Baselines', icon: BookOpen },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'users', label: 'Admin Users', icon: Shield },
      { id: 'export', label: 'Export', icon: Download },
    ],
  },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MobileSettings() {
  const { currentRole } = useApp();

  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);

  // Admin guard (uses currentRole, not effectiveRole)
  if (currentRole !== 'admin') {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Settings" />
        <MobileEmptyState
          icon={Shield}
          title="Access Denied"
          subtitle="You don't have permission to view settings."
        />
      </div>
    );
  }

  if (activeSection) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-6">
        {/* Back button */}
        <button
          onClick={() => setActiveSection(null)}
          className="flex items-center gap-1.5 min-h-[48px] text-sm font-medium text-blue-400 active:text-blue-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Settings
        </button>

        {/* Section title */}
        <h1 className="text-2xl font-bold text-white">
          {NAV.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label ?? activeSection}
        </h1>

        {/* Section content */}
        <SectionContent section={activeSection} />
      </div>
    );
  }

  // Navigation list
  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Settings" />

      {NAV.map(({ group, items }) => (
        <MobileSection key={group} title={group}>
          <MobileCard>
            {items.map((item, idx) => (
              <div key={item.id}>
                {idx > 0 && <div className="border-t border-slate-800/40 mx-1" />}
                <MobileListItem
                  title={item.label}
                  onTap={() => setActiveSection(item.id)}
                />
              </div>
            ))}
          </MobileCard>
        </MobileSection>
      ))}
    </div>
  );
}

// ─── Section Content Router ─────────────────────────────────────────────────

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'installers': return <InstallersSection />;
    case 'financers': return <FinancersSection />;
    case 'users': return <AdminUsersSection />;
    case 'project-managers': return <ProjectManagersSection />;
    case 'blitz-permissions': return <BlitzPermissionsSection />;
    case 'export': return <ExportSection />;
    case 'trainers': return <ReadOnlyListSection title="Trainer Overrides" description="View and edit trainer overrides on desktop for the full experience." />;
    case 'baselines': return <ReadOnlyListSection title="Baselines" description="View and edit baseline pricing on desktop for the full experience." />;
    case 'sub-dealers': return <SubDealersSection />;
    default: return null;
  }
}

// ─── Toggle Switch ──────────────────────────────────────────────────────────

function Toggle({ value, onChange, color = 'bg-blue-600' }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-11 h-6 rounded-full transition-colors relative ${value ? color : 'bg-slate-700'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ─── Installers Section ─────────────────────────────────────────────────────

function InstallersSection() {
  const { installers, setInstallerActive, installerPayConfigs, updateInstallerPayConfig } = useApp();

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">Manage installer companies. Full editing available on desktop.</p>
      {installers.length === 0 ? (
        <MobileEmptyState icon={Building2} title="No installers" />
      ) : (
        installers.map((inst) => {
          const payConfig = installerPayConfigs?.[inst.name];
          const installPct = payConfig?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
          return (
            <MobileCard key={inst.name}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white truncate">{inst.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">Install Pay: {Math.round(installPct * 100)}%</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-medium px-2 py-0.5 rounded-lg ${inst.active ? 'bg-emerald-900/30 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                    {inst.active ? 'Active' : 'Inactive'}
                  </span>
                  <Toggle
                    value={inst.active}
                    onChange={() => setInstallerActive(inst.name, !inst.active)}
                    color="bg-emerald-600"
                  />
                </div>
              </div>
            </MobileCard>
          );
        })
      )}
    </div>
  );
}

// ─── Financers Section ──────────────────────────────────────────────────────

function FinancersSection() {
  const { financers, setFinancerActive } = useApp();

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">Manage financing companies.</p>
      {financers.length === 0 ? (
        <MobileEmptyState icon={Landmark} title="No financers" />
      ) : (
        financers.map((fin) => (
          <MobileCard key={fin.name}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white truncate">{fin.name}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-sm font-medium px-2 py-0.5 rounded-lg ${fin.active ? 'bg-emerald-900/30 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                  {fin.active ? 'Active' : 'Inactive'}
                </span>
                <Toggle
                  value={fin.active}
                  onChange={() => setFinancerActive(fin.name, !fin.active)}
                  color="bg-emerald-600"
                />
              </div>
            </div>
          </MobileCard>
        ))
      )}
    </div>
  );
}

// ─── Admin Users Section ────────────────────────────────────────────────────

function AdminUsersSection() {
  const { toast } = useToast();
  const [admins, setAdmins] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const loadAdmins = useCallback(() => {
    fetch('/api/reps?role=admin')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: Array<{ id: string; firstName: string; lastName: string; email: string }>) => {
        setAdmins(users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  const handleAdd = async () => {
    const parts = newName.trim().split(/\s+/);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');
    if (!firstName || !newEmail.trim()) return;
    const res = await fetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email: newEmail.trim(), role: 'admin' }),
    });
    if (res.ok) {
      toast('Admin user added');
      setNewName('');
      setNewEmail('');
      loadAdmins();
    } else {
      toast('Failed to add admin', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/reps/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast('Admin removed');
      loadAdmins();
    } else {
      toast('Failed to remove admin', 'error');
    }
  };

  if (loading) return <p className="text-sm text-slate-500 py-8 text-center">Loading...</p>;

  return (
    <div className="space-y-4">
      {/* Add form */}
      <MobileCard>
        <p className="text-sm text-slate-500 mb-3">Add a new admin user</p>
        <div className="space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Full name"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || !newEmail.trim()}
            className="w-full min-h-[48px] rounded-2xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 active:bg-blue-700 transition-colors"
          >
            Add Admin
          </button>
        </div>
      </MobileCard>

      {/* List */}
      {admins.length === 0 ? (
        <MobileEmptyState icon={Shield} title="No admin users" />
      ) : (
        <MobileCard>
          {admins.map((admin, idx) => (
            <div key={admin.id}>
              {idx > 0 && <div className="border-t border-slate-800/40 mx-1" />}
              <div className="flex items-center gap-3 min-h-[48px] py-3 px-1">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white truncate">{admin.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5 truncate">{admin.email}</p>
                </div>
                <button
                  onClick={() => handleDelete(admin.id)}
                  className="p-2 text-slate-500 active:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </MobileCard>
      )}
    </div>
  );
}

// ─── Project Managers Section ───────────────────────────────────────────────

function ProjectManagersSection() {
  const { toast } = useToast();
  const [pms, setPms] = useState<Array<{
    id: string; firstName: string; lastName: string; email: string;
    canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean;
  }>>([]);
  const [loading, setLoading] = useState(true);

  const loadPMs = useCallback(() => {
    fetch('/api/reps?role=project_manager')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { setPms(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadPMs(); }, [loadPMs]);

  const togglePerm = async (pmId: string, field: 'canExport' | 'canCreateDeals' | 'canAccessBlitz', current: boolean) => {
    const res = await fetch(`/api/users/${pmId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: !current }),
    });
    if (res.ok) {
      setPms((prev) => prev.map((pm) => pm.id === pmId ? { ...pm, [field]: !current } : pm));
      toast('Permission updated');
    }
  };

  const handleDelete = async (pmId: string) => {
    const res = await fetch(`/api/reps/${pmId}`, { method: 'DELETE' });
    if (res.ok) { toast('PM removed'); loadPMs(); }
  };

  if (loading) return <p className="text-sm text-slate-500 py-8 text-center">Loading...</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">Project managers can view projects and reps but not payroll or settings.</p>
      {pms.length === 0 ? (
        <MobileEmptyState icon={Users} title="No project managers" />
      ) : (
        pms.map((pm) => (
          <MobileCard key={pm.id}>
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-white truncate">{pm.firstName} {pm.lastName}</p>
                <p className="text-sm text-slate-500 mt-0.5 truncate">{pm.email}</p>
              </div>
              <button
                onClick={() => handleDelete(pm.id)}
                className="p-2 text-slate-500 active:text-red-400 transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { field: 'canCreateDeals' as const, label: 'Create Deals' },
                { field: 'canAccessBlitz' as const, label: 'Blitz Access' },
                { field: 'canExport' as const, label: 'Export Data' },
              ]).map(({ field, label }) => (
                <button
                  key={field}
                  onClick={() => togglePerm(pm.id, field, pm[field])}
                  className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border transition-colors min-h-[36px] ${
                    pm[field]
                      ? 'bg-emerald-900/30 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-800/50 text-slate-500 border-slate-700/50'
                  }`}
                >
                  {pm[field] ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                  {label}
                </button>
              ))}
            </div>
          </MobileCard>
        ))
      )}
    </div>
  );
}

// ─── Blitz Permissions Section ──────────────────────────────────────────────

function BlitzPermissionsSection() {
  const { reps } = useApp();
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<Record<string, { canRequestBlitz: boolean; canCreateBlitz: boolean }>>({});

  useEffect(() => {
    const perms: Record<string, { canRequestBlitz: boolean; canCreateBlitz: boolean }> = {};
    reps.forEach((r) => {
      perms[r.id] = { canRequestBlitz: (r as any).canRequestBlitz ?? false, canCreateBlitz: (r as any).canCreateBlitz ?? false };
    });
    setPermissions(perms);
  }, [reps]);

  const togglePermission = async (repId: string, field: 'canRequestBlitz' | 'canCreateBlitz', value: boolean) => {
    setPermissions((prev) => ({ ...prev, [repId]: { ...prev[repId], [field]: value } }));
    await fetch(`/api/users/${repId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    toast('Permission updated');
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">Control which reps can request or create blitzes.</p>
      {reps.length === 0 ? (
        <MobileEmptyState icon={Tent} title="No reps" />
      ) : (
        reps.map((rep) => {
          const perms = permissions[rep.id] ?? { canRequestBlitz: false, canCreateBlitz: false };
          return (
            <MobileCard key={rep.id}>
              <p className="text-base font-semibold text-white mb-0.5">{rep.name}</p>
              <p className="text-sm text-slate-500 mb-3">{rep.repType || 'Rep'}</p>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Toggle
                    value={perms.canRequestBlitz}
                    onChange={(v) => togglePermission(rep.id, 'canRequestBlitz', v)}
                  />
                  <span className="text-sm text-slate-400">Request</span>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    value={perms.canCreateBlitz}
                    onChange={(v) => togglePermission(rep.id, 'canCreateBlitz', v)}
                    color="bg-emerald-600"
                  />
                  <span className="text-sm text-slate-400">Create</span>
                </div>
              </div>
            </MobileCard>
          );
        })
      )}
    </div>
  );
}

// ─── Sub-Dealers Section ────────────────────────────────────────────────────

function SubDealersSection() {
  const { subDealers } = useApp();

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">Sub-dealer accounts. Full editing available on desktop.</p>
      {!subDealers || subDealers.length === 0 ? (
        <MobileEmptyState icon={Handshake} title="No sub-dealers" subtitle="Add sub-dealers from the desktop view." />
      ) : (
        <MobileCard>
          {subDealers.map((sd: any, idx: number) => (
            <div key={sd.id ?? idx}>
              {idx > 0 && <div className="border-t border-slate-800/40 mx-1" />}
              <div className="flex items-center gap-3 min-h-[48px] py-3 px-1">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white truncate">
                    {sd.firstName ?? ''} {sd.lastName ?? ''}
                  </p>
                  {sd.email && <p className="text-sm text-slate-500 mt-0.5 truncate">{sd.email}</p>}
                </div>
              </div>
            </div>
          ))}
        </MobileCard>
      )}
    </div>
  );
}

// ─── Export Section ─────────────────────────────────────────────────────────

function ExportSection() {
  const { toast } = useToast();

  const handleExport = async (type: string) => {
    try {
      const res = await fetch(`/api/export?type=${type}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${type} exported`);
    } catch {
      toast('Export failed', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 mb-2">Download data as CSV files.</p>
      {['payments', 'projects', 'baselines', 'trainers'].map((type) => (
        <button
          key={type}
          onClick={() => handleExport(type)}
          className="w-full min-h-[52px] rounded-2xl bg-slate-900/60 border border-slate-800/20 px-5 text-left flex items-center gap-3 active:bg-slate-800/40 transition-colors"
        >
          <Download className="w-5 h-5 text-slate-500 shrink-0" />
          <span className="text-base font-semibold text-white capitalize">{type}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Read-Only Section (for complex desktop-only settings) ──────────────────

function ReadOnlyListSection({ title, description }: { title: string; description: string }) {
  return (
    <MobileCard>
      <p className="text-sm text-slate-400 mb-2">{description}</p>
      <p className="text-base text-slate-400">Open the desktop version for full access to {title.toLowerCase()}.</p>
    </MobileCard>
  );
}
