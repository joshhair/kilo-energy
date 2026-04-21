'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { DEFAULT_INSTALL_PAY_PCT } from '../../../lib/data';
import {
  ArrowLeft, Tent, Users, Handshake,
  Building2, Landmark, BookOpen, Shield, Download,
  Trash2, CheckSquare, Square, SlidersHorizontal,
} from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileListItem from './shared/MobileListItem';
import MobileSection from './shared/MobileSection';
import MobileEmptyState from './shared/MobileEmptyState';
import ConfirmDialog from '../components/ConfirmDialog';

// ─── Types ──────────────────────────────────────────────────────────────────

type SettingsSection =
  | 'trainers' | 'blitz-permissions' | 'project-managers' | 'sub-dealers'
  | 'installers' | 'financers' | 'baselines'
  | 'users' | 'export' | 'customization';

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
      { id: 'customization', label: 'Customization', icon: SlidersHorizontal },
    ],
  },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MobileSettings() {
  const { effectiveRole } = useApp();

  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [navReturning, setNavReturning] = useState(false);

  function handleBack() {
    setLeaving(true);
    setTimeout(() => {
      setActiveSection(null);
      setLeaving(false);
      setNavReturning(true);
      setTimeout(() => setNavReturning(false), 300);
    }, 255);
  }

  // Admin guard — uses effectiveRole so View As respects what reps actually see.
  if (effectiveRole !== 'admin') {
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
      <div className={`px-5 pt-4 pb-24 space-y-6 ${leaving ? 'ms-slide-out' : 'ms-slide-in'}`}>
        <style>{`
          @keyframes ms-slide-in   { from { transform: translateX(28px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
          @keyframes ms-slide-out  { from { transform: translateX(0); opacity: 1; } to { transform: translateX(28px); opacity: 0; } }
          @keyframes ms-slide-back { from { transform: translateX(-20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
          @media (prefers-reduced-motion: reduce) {
            .ms-slide-in, .ms-slide-out, .ms-slide-back { animation: none !important; }
          }
          .ms-slide-in   { animation: ms-slide-in   320ms cubic-bezier(0.16,1,0.3,1) both; }
          .ms-slide-out  { animation: ms-slide-out  240ms cubic-bezier(0.55,0,1,0.45) both; }
          .ms-slide-back { animation: ms-slide-back 280ms cubic-bezier(0.16,1,0.3,1) both; }
        `}</style>
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 min-h-[48px] text-base font-medium active:opacity-70 transition-colors"
          style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Settings
        </button>

        {/* Section title */}
        <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
          {NAV.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label ?? activeSection}
        </h1>

        {/* Section content */}
        <SectionContent section={activeSection} />
      </div>
    );
  }

  // Navigation list
  return (
    <div className={`px-5 pt-4 pb-24 space-y-4 ${navReturning ? 'ms-slide-back' : ''}`}>
      <MobilePageHeader title="Settings" />

      {NAV.map(({ group, items }) => (
        <MobileSection key={group} title={group}>
          <MobileCard>
            {items.map((item, idx) => (
              <div key={item.id}>
                {idx > 0 && <div className="mx-1" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }} />}
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
    case 'trainers': return <ReadOnlyListSection title="Trainer Overrides" description="Manage trainer overrides in the Training page." />;
    case 'baselines': return <ReadOnlyListSection title="Baselines" description="View and edit baseline pricing on desktop for the full experience." />;
    case 'sub-dealers': return <SubDealersSection />;
    case 'customization': return <CustomizationSection />;
    default: return null;
  }
}

// ─── Settings Skeleton ──────────────────────────────────────────────────────

function SettingsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      <style>{`
        @keyframes sk-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .sk { background: linear-gradient(90deg,
          var(--m-border,var(--border-mobile)) 25%,
          rgba(255,255,255,0.04) 50%,
          var(--m-border,var(--border-mobile)) 75%);
          background-size: 200% 100%;
          animation: sk-shimmer 1.4s linear infinite;
          border-radius: 6px;
        }
        @media(prefers-reduced-motion:reduce){.sk{animation:none;}}
      `}</style>
      <MobileCard>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>
            {i > 0 && <div className="mx-1" style={{ borderTop: '1px solid var(--m-border,var(--border-mobile))' }} />}
            <div className="flex items-center gap-3 min-h-[56px] py-3 px-1">
              <div className="flex-1 space-y-2">
                <div className="sk h-3.5 w-32" />
                <div className="sk h-3 w-44" />
              </div>
              <div className="sk h-8 w-8 rounded-lg shrink-0" />
            </div>
          </div>
        ))}
      </MobileCard>
    </>
  );
}

// ─── Toggle Switch ──────────────────────────────────────────────────────────

function Toggle({ value, onChange, color }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-11 h-6 rounded-full relative active:scale-[0.88] transition-transform duration-100 ease-out p-1 -m-1"
      style={{
        background: value ? (color ?? 'var(--accent-emerald)') : 'var(--m-border, var(--border-mobile))',
        transition: 'background-color 200ms ease',
      }}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full ${value ? 'translate-x-5' : 'translate-x-0.5'}`}
        style={{
          transition: typeof window !== 'undefined' && window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 'transform 150ms ease'
            : 'transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  );
}

// ─── Installers Section ─────────────────────────────────────────────────────

function InstallersSection() {
  const { installers, setInstallerActive, installerPayConfigs } = useApp();

  return (
    <div className="space-y-3">
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Manage installer companies. Full editing available on desktop.</p>
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
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{inst.name}</p>
                  <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Install Pay: <span style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{installPct}%</span></p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-base font-medium px-2 py-0.5 rounded-lg"
                    style={{
                      background: inst.active ? 'rgba(0,229,160,0.15)' : 'var(--m-card, var(--surface-mobile-card))',
                      color: inst.active ? 'var(--m-accent, var(--accent-emerald))' : 'var(--m-text-muted, var(--text-mobile-muted))',
                      fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    }}
                  >
                    {inst.active ? 'Active' : 'Inactive'}
                  </span>
                  <Toggle
                    value={inst.active}
                    onChange={() => setInstallerActive(inst.name, !inst.active)}
                    color="var(--accent-emerald)"
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
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Manage financing companies.</p>
      {financers.length === 0 ? (
        <MobileEmptyState icon={Landmark} title="No financers" />
      ) : (
        financers.filter(fin => fin.name !== 'Cash').map((fin) => (
          <MobileCard key={fin.name}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{fin.name}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className="text-base font-medium px-2 py-0.5 rounded-lg"
                  style={{
                    background: fin.active ? 'rgba(0,229,160,0.15)' : 'var(--m-card, var(--surface-mobile-card))',
                    color: fin.active ? 'var(--m-accent, var(--accent-emerald))' : 'var(--m-text-muted, var(--text-mobile-muted))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {fin.active ? 'Active' : 'Inactive'}
                </span>
                <Toggle
                  value={fin.active}
                  onChange={() => setFinancerActive(fin.name, !fin.active)}
                  color="var(--accent-emerald)"
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email: newEmail.trim(), role: 'admin' }),
    });
    if (res.ok) {
      toast('Admin user invited');
      setNewName('');
      setNewEmail('');
      loadAdmins();
    } else {
      toast('Failed to add admin', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    const res = await fetch(`/api/users/${confirmDeleteId}`, { method: 'DELETE' });
    if (res.ok) {
      toast('Admin removed');
      loadAdmins();
    } else {
      toast('Failed to remove admin', 'error');
    }
  };

  if (loading) return <SettingsSkeleton rows={3} />;

  return (
    <div className="space-y-4">
      {/* Add form */}
      <MobileCard>
        <p className="text-base mb-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Add a new admin user</p>
        <div className="space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Full name"
            autoComplete="name"
            autoCapitalize="words"
            inputMode="text"
            className="w-full rounded-xl px-3 py-2.5 text-base text-white focus:outline-none focus:ring-1"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald)',
            } as React.CSSProperties}
          />
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-xl px-3 py-2.5 text-base text-white focus:outline-none focus:ring-1"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald)',
            } as React.CSSProperties}
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || !newEmail.trim()}
            className="w-full min-h-[48px] rounded-2xl text-black text-base font-semibold disabled:opacity-40 active:opacity-80 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 0 20px rgba(0,229,160,0.3)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
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
              {idx > 0 && <div className="mx-1" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }} />}
              <div className="flex items-center gap-3 min-h-[48px] py-3 px-1">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{admin.name}</p>
                  <p className="text-base mt-0.5 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{admin.email}</p>
                </div>
                <button
                  onClick={() => setConfirmDeleteId(admin.id)}
                  className="p-2 active:opacity-70 transition-colors"
                  style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </MobileCard>
      )}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Remove Admin User"
        message="Are you sure you want to remove this admin user? This cannot be undone."
        confirmLabel="Remove"
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    const res = await fetch(`/api/users/${confirmDeleteId}`, { method: 'DELETE' });
    if (res.ok) { toast('PM removed'); loadPMs(); }
    setConfirmDeleteId(null);
  };

  if (loading) return <SettingsSkeleton rows={4} />;

  return (
    <div className="space-y-3">
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Project managers can view projects and reps but not payroll or settings.</p>
      {pms.length === 0 ? (
        <MobileEmptyState icon={Users} title="No project managers" />
      ) : (
        pms.map((pm) => (
          <MobileCard key={pm.id}>
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{pm.firstName} {pm.lastName}</p>
                <p className="text-base mt-0.5 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{pm.email}</p>
              </div>
              <button
                onClick={() => setConfirmDeleteId(pm.id)}
                className="p-2 active:opacity-70 transition-colors shrink-0"
                style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
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
                  className="flex items-center gap-1.5 text-base px-3 py-2.5 rounded-xl border transition-colors min-h-[44px] active:scale-[0.95] transition-transform duration-100"
                  style={{
                    background: pm[field] ? 'rgba(0,229,160,0.15)' : 'var(--m-card, var(--surface-mobile-card))',
                    color: pm[field] ? 'var(--m-accent, var(--accent-emerald))' : 'var(--m-text-muted, var(--text-mobile-muted))',
                    borderColor: pm[field] ? 'rgba(0,229,160,0.3)' : 'var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {pm[field] ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {label}
                </button>
              ))}
            </div>
          </MobileCard>
        ))
      )}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Remove Project Manager"
        message="Are you sure you want to remove this project manager? This cannot be undone."
        confirmLabel="Remove"
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
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
      const flags = r as { canRequestBlitz?: boolean; canCreateBlitz?: boolean };
      perms[r.id] = { canRequestBlitz: flags.canRequestBlitz ?? false, canCreateBlitz: flags.canCreateBlitz ?? false };
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
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Control which reps can request or create blitzes.</p>
      {reps.length === 0 ? (
        <MobileEmptyState icon={Tent} title="No reps" />
      ) : (
        reps.map((rep) => {
          const perms = permissions[rep.id] ?? { canRequestBlitz: false, canCreateBlitz: false };
          return (
            <MobileCard key={rep.id}>
              <p className="text-base font-semibold text-white mb-0.5" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.name}</p>
              <p className="text-base mb-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.repType || 'Rep'}</p>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Toggle
                    value={perms.canRequestBlitz}
                    onChange={(v) => togglePermission(rep.id, 'canRequestBlitz', v)}
                    color="var(--m-accent2, var(--accent-cyan2))"
                  />
                  <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Request</span>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    value={perms.canCreateBlitz}
                    onChange={(v) => togglePermission(rep.id, 'canCreateBlitz', v)}
                    color="var(--accent-emerald)"
                  />
                  <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Create</span>
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
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Sub-dealer accounts. Full editing available on desktop.</p>
      {!subDealers || subDealers.length === 0 ? (
        <MobileEmptyState icon={Handshake} title="No sub-dealers" subtitle="Add sub-dealers from the desktop view." />
      ) : (
        <MobileCard>
          {subDealers.map((sd, idx: number) => (
            <div key={sd.id ?? idx}>
              {idx > 0 && <div className="mx-1" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }} />}
              <div className="flex items-center gap-3 min-h-[48px] py-3 px-1">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {sd.firstName ?? ''} {sd.lastName ?? ''}
                  </p>
                  {sd.email && <p className="text-base mt-0.5 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{sd.email}</p>}
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
  const [status, setStatus] = useState<Record<string, 'idle' | 'loading' | 'done'>>({});
  const getStatus = (t: string) => status[t] ?? 'idle';

  const handleExport = async (type: string) => {
    if (getStatus(type) !== 'idle') return;
    setStatus(p => ({ ...p, [type]: 'loading' }));
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
      setStatus(p => ({ ...p, [type]: 'done' }));
      setTimeout(() => setStatus(p => ({ ...p, [type]: 'idle' })), 1400);
      toast(`${type} exported`);
    } catch {
      setStatus(p => ({ ...p, [type]: 'idle' }));
      toast('Export failed', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <style>{`
        @keyframes exportSpin { to { transform: rotate(360deg); } }
        @keyframes exportPulse {
          0%   { box-shadow: 0 0 0 0 rgba(0,229,160,0.5); }
          60%  { box-shadow: 0 0 0 8px rgba(0,229,160,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,229,160,0); }
        }
        @keyframes exportShimmer {
          from { transform: translateX(-100%); }
          to   { transform: translateX(100%); }
        }
        @media(prefers-reduced-motion:reduce){ .export-shimmer{ display:none; } .export-pulse{ animation:none; } }
      `}</style>
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Download data as CSV files.</p>
      {['payments', 'projects', 'baselines', 'trainers'].map((type) => (
        <button
          key={type}
          onClick={() => handleExport(type)}
          disabled={getStatus(type) === 'loading'}
          className="w-full min-h-[56px] rounded-2xl px-5 text-left flex items-center gap-3 relative overflow-hidden"
          style={{
            background: getStatus(type) === 'done' ? 'rgba(0,229,160,0.1)' : 'var(--m-card, var(--surface-mobile-card))',
            border: `1px solid ${
              getStatus(type) === 'done' ? 'rgba(0,229,160,0.4)'
              : getStatus(type) === 'loading' ? 'rgba(255,255,255,0.08)'
              : 'var(--m-border, var(--border-mobile))'
            }`,
            transition: 'background 300ms ease, border-color 300ms ease',
            animation: getStatus(type) === 'done' ? 'exportPulse 600ms cubic-bezier(0.16,1,0.3,1) both' : 'none',
          }}
        >
          {getStatus(type) === 'loading' && (
            <span
              className="export-shimmer absolute inset-y-0 left-0 w-1/2 pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
                animation: 'exportShimmer 900ms cubic-bezier(0.4,0,0.6,1) infinite',
              }}
            />
          )}
          <Download
            className="w-5 h-5 shrink-0"
            style={{
              color: getStatus(type) === 'done' ? 'var(--m-accent, var(--accent-emerald))' : 'var(--m-text-muted, var(--text-mobile-muted))',
              transition: 'color 300ms ease',
              animation: getStatus(type) === 'loading' ? 'exportSpin 600ms linear infinite' : 'none',
            }}
          />
          <span
            className="text-base font-semibold capitalize"
            style={{
              color: getStatus(type) === 'done' ? 'var(--m-accent, var(--accent-emerald))' : 'white',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              transition: 'color 300ms ease',
            }}
          >{type}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Customization Section ──────────────────────────────────────────────────

const PIPELINE_THRESHOLDS_KEY = 'kilo-pipeline-thresholds';
const THRESHOLD_DEFAULTS: Record<string, number> = {
  'New': 5, 'Acceptance': 10, 'Site Survey': 20, 'Design': 30,
  'Permitting': 50, 'Pending Install': 65, 'Installed': 75,
};
const THRESHOLD_PHASES = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed'];

function CustomizationSection() {
  const { toast } = useToast();
  const [thresholds, setThresholds] = useState<Record<string, number>>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(PIPELINE_THRESHOLDS_KEY) : null;
      return stored ? { ...THRESHOLD_DEFAULTS, ...JSON.parse(stored) } : { ...THRESHOLD_DEFAULTS };
    } catch { return { ...THRESHOLD_DEFAULTS }; }
  });

  const handleSave = () => {
    localStorage.setItem(PIPELINE_THRESHOLDS_KEY, JSON.stringify(thresholds));
    toast('Thresholds saved');
  };

  const handleReset = () => {
    setThresholds({ ...THRESHOLD_DEFAULTS });
    localStorage.removeItem(PIPELINE_THRESHOLDS_KEY);
    toast('Thresholds reset');
  };

  return (
    <div className="space-y-4">
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        Days from sold date before a project is flagged as &ldquo;stuck&rdquo; in each phase.
      </p>
      <MobileCard>
        <div className="space-y-3">
          {THRESHOLD_PHASES.map((phase) => (
            <div key={phase} className="flex items-center justify-between gap-4">
              <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{phase}</span>
              <input
                type="number"
                min={1}
                max={365}
                value={thresholds[phase] ?? THRESHOLD_DEFAULTS[phase]}
                onChange={(e) => setThresholds((prev) => ({ ...prev, [phase]: Math.max(1, parseInt(e.target.value) || 1) }))}
                inputMode="numeric"
                className="w-20 rounded-xl px-3 py-2 text-base text-white text-center focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--m-card, var(--surface-mobile-card))',
                  border: '1px solid var(--m-border, var(--border-mobile))',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald)',
                } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      </MobileCard>
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="flex-1 min-h-[48px] rounded-2xl text-black text-base font-semibold active:opacity-80 transition-colors"
          style={{
            background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
            boxShadow: '0 0 20px rgba(0,229,160,0.3)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          Save
        </button>
        <button
          onClick={handleReset}
          className="flex-1 min-h-[48px] rounded-2xl text-base font-medium active:opacity-80 transition-colors"
          style={{
            background: 'var(--m-card, var(--surface-mobile-card))',
            border: '1px solid var(--m-border, var(--border-mobile))',
            color: 'var(--m-text-muted, var(--text-mobile-muted))',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ─── Read-Only Section (for complex desktop-only settings) ──────────────────

function ReadOnlyListSection({ title, description }: { title: string; description: string }) {
  return (
    <MobileCard>
      <p className="text-base mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{description}</p>
      <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Open the desktop version for full access to {title.toLowerCase()}.</p>
    </MobileCard>
  );
}
