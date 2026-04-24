'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { DEFAULT_INSTALL_PAY_PCT, InstallerBaseline, InstallerRates, SOLARTECH_FAMILIES } from '../../../lib/data';
import {
  ArrowLeft, Tent, Users, Handshake,
  Building2, Landmark, BookOpen, Shield, Download,
  Trash2, CheckSquare, Square, SlidersHorizontal, Pencil, Plus,
} from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileListItem from './shared/MobileListItem';
import MobileSection from './shared/MobileSection';
import MobileEmptyState from './shared/MobileEmptyState';
import MobilePillTabs from './shared/MobilePillTabs';
import ConfirmDialog from '../components/ConfirmDialog';

// ─── Types ──────────────────────────────────────────────────────────────────

type SettingsSection =
  | 'trainers' | 'blitz-permissions' | 'project-managers' | 'sub-dealers'
  | 'installers' | 'financers' | 'baselines'
  | 'admin-users' | 'export' | 'customization';

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
      { id: 'sub-dealers', label: 'Sub-Dealers', icon: Handshake },
      { id: 'project-managers', label: 'Project Managers', icon: Users },
      { id: 'admin-users', label: 'Admin Users', icon: Shield },
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
      { id: 'customization', label: 'Customization', icon: SlidersHorizontal },
      { id: 'export', label: 'Export', icon: Download },
    ],
  },
];

// ─── Animation Keyframes ─────────────────────────────────────────────────────
// Defined at module scope so keyframes survive every JSX branch transition.
// ms-slide-back is applied to the nav container (activeSection=null branch) but
// was previously defined only inside the activeSection branch — causing it to
// unmount the instant handleBack() fired.

const SETTINGS_KEYFRAMES = `
  @keyframes ms-slide-in   { from { transform: translateX(28px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes ms-slide-out  { from { transform: translateX(0); opacity: 1; } to { transform: translateX(28px); opacity: 0; } }
  @keyframes ms-slide-back { from { transform: translateX(-20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes ms-nav-group-in { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes bs-up   { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes bs-down { from { transform: translateY(0);    } to { transform: translateY(100%); } }
  @keyframes bs-backdrop-in  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes bs-backdrop-out { from { opacity: 1; } to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .bs-panel, .bs-backdrop { animation: none !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ms-slide-in, .ms-slide-out, .ms-slide-back { animation: none !important; }
  }
  .ms-slide-in   { animation: ms-slide-in   320ms cubic-bezier(0.16,1,0.3,1) both; }
  .ms-slide-out  { animation: ms-slide-out  240ms cubic-bezier(0.55,0,1,0.45) both; }
  .ms-slide-back { animation: ms-slide-back 280ms cubic-bezier(0.16,1,0.3,1) both; }
  @keyframes sk-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position:  200% 0; }
  }
  .sk {
    background: linear-gradient(90deg,
      var(--m-border,var(--border-mobile)) 25%,
      rgba(255,255,255,0.04) 50%,
      var(--m-border,var(--border-mobile)) 75%);
    background-size: 200% 100%;
    animation: sk-shimmer 1.4s linear infinite;
    border-radius: 6px;
  }
  @media(prefers-reduced-motion:reduce){.sk{animation:none;}}
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
`;

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MobileSettings() {
  const { effectiveRole } = useApp();

  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [navKey, setNavKey] = useState(0);
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function handleBack() {
    setLeaving(true);
    setTimeout(() => {
      setActiveSection(null);
      setLeaving(false);
      setNavKey(k => k + 1);
    }, 255);
  }

  // Admin guard — uses effectiveRole so View As respects what reps actually see.
  if (effectiveRole !== 'admin') {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <style>{SETTINGS_KEYFRAMES}</style>
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
        <style>{SETTINGS_KEYFRAMES}</style>
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
    <div key={navKey} className="px-5 pt-4 pb-24 space-y-4">
      <style>{SETTINGS_KEYFRAMES}</style>
      <MobilePageHeader title="Settings" />

      {NAV.map(({ group, items }, groupIdx) => (
        <div
          key={group}
          style={{
            animation: prefersReducedMotion ? 'none' : 'ms-nav-group-in 300ms cubic-bezier(0.16,1,0.3,1) both',
            animationDelay: prefersReducedMotion ? undefined : `${groupIdx * 70}ms`,
          }}
        >
          <MobileSection title={group}>
            <MobileCard>
              {items.map((item, idx) => (
                <div key={item.id}>
                  {idx > 0 && <div className="mx-1" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }} />}
                  <div className="active:scale-[0.97] transition-transform duration-100 ease-out">
                    <MobileListItem title={item.label} onTap={() => setActiveSection(item.id)} />
                  </div>
                </div>
              ))}
            </MobileCard>
          </MobileSection>
        </div>
      ))}
    </div>
  );
}

// ─── Section Content Router ─────────────────────────────────────────────────

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'installers': return <InstallersSection />;
    case 'financers': return <FinancersSection />;
    case 'admin-users': return <AdminUsersSection />;
    case 'project-managers': return <ProjectManagersSection />;
    case 'blitz-permissions': return <BlitzPermissionsSection />;
    case 'export': return <ExportSection />;
    case 'trainers': return <ReadOnlyListSection title="Trainer Overrides" description="Manage trainer overrides in the Training page." />;
    case 'baselines': return <MobileBaselinesSection />;
    case 'sub-dealers': return <SubDealersSection />;
    case 'customization': return <CustomizationSection />;
    default: return null;
  }
}

// ─── Settings Skeleton ──────────────────────────────────────────────────────

function SettingsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
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
      {financers.filter(fin => fin.name !== 'Cash').length === 0 ? (
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
    setConfirmDeleteId(null);
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
    } else {
      toast('Failed to update permission', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    const res = await fetch(`/api/users/${confirmDeleteId}`, { method: 'DELETE' });
    if (res.ok) {
      toast('PM removed');
      loadPMs();
      setConfirmDeleteId(null);
    } else {
      toast('Failed to remove PM', 'error');
      setConfirmDeleteId(null);
    }
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
    const prevValue = permissions[repId]?.[field];
    setPermissions((prev) => ({ ...prev, [repId]: { ...prev[repId], [field]: value } }));
    try {
      const res = await fetch(`/api/users/${repId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      toast('Permission updated');
    } catch {
      setPermissions((prev) => ({ ...prev, [repId]: { ...prev[repId], [field]: prevValue } }));
      toast('Failed to update permission', 'error');
    }
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

// ─── Baselines Section ──────────────────────────────────────────────────────

function MobileBaselinesSection() {
  const { productCatalogInstallerConfigs } = useApp();
  const [activeTab, setActiveTab] = useState<'standard' | 'solartech' | 'productcatalog'>('standard');
  const hasPCInstallers = Object.keys(productCatalogInstallerConfigs).length > 0;

  const tabs: Array<['standard' | 'solartech' | 'productcatalog', string]> = [
    ['standard', 'Standard'],
    ['solartech', 'SolarTech'],
    ...(hasPCInstallers ? [['productcatalog', 'Product Catalog'] as ['productcatalog', string]] : []),
  ];

  return (
    <div className="space-y-4">
      <MobilePillTabs
        items={tabs.map(([id, label]) => ({ id, label }))}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as 'standard' | 'solartech' | 'productcatalog')}
      />
      {activeTab === 'standard' && <StandardBaselines />}
      {activeTab === 'solartech' && <SolarTechBaselines />}
      {activeTab === 'productcatalog' && <ProductCatalogBaselines />}
    </div>
  );
}

function StandardBaselines() {
  const { installerBaselines, updateInstallerBaseline, createNewInstallerVersion } = useApp();
  const { toast } = useToast();
  const [editingInstaller, setEditingInstaller] = useState<string | null>(null);
  const [editVals, setEditVals] = useState({ closerPerW: '', kiloPerW: '', setterPerW: '', subDealerPerW: '' });
  const [newVersionFor, setNewVersionFor] = useState<string | null>(null);
  const [sheetLeaving, setSheetLeaving] = useState(false);
  const [nvLabel, setNvLabel] = useState('');
  const [nvDate, setNvDate] = useState('');
  const [nvCloser, setNvCloser] = useState('');
  const [nvKilo, setNvKilo] = useState('');

  const entries = Object.entries(installerBaselines);

  function startEdit(installer: string) {
    const b = installerBaselines[installer];
    setEditVals({
      closerPerW: String(b.closerPerW),
      kiloPerW: String(b.kiloPerW),
      setterPerW: b.setterPerW != null ? String(b.setterPerW) : '',
      subDealerPerW: b.subDealerPerW != null ? String(b.subDealerPerW) : '',
    });
    setEditingInstaller(installer);
  }

  function saveEdit() {
    if (!editingInstaller) return;
    const closer = parseFloat(editVals.closerPerW);
    const kilo = parseFloat(editVals.kiloPerW);
    if (isNaN(closer) || isNaN(kilo)) { toast('Invalid rates', 'error'); return; }
    const baseline: InstallerBaseline = { closerPerW: closer, kiloPerW: kilo };
    const setter = parseFloat(editVals.setterPerW);
    if (!isNaN(setter)) baseline.setterPerW = setter;
    const sub = parseFloat(editVals.subDealerPerW);
    if (!isNaN(sub)) baseline.subDealerPerW = sub;
    updateInstallerBaseline(editingInstaller, baseline);
    toast('Baseline updated');
    setEditingInstaller(null);
  }

  function openNewVersion(installer: string) {
    const b = installerBaselines[installer];
    setNewVersionFor(installer);
    setNvLabel('');
    setNvDate(new Date().toISOString().slice(0, 10));
    setNvCloser(b ? String(b.closerPerW) : '');
    setNvKilo(b ? String(b.kiloPerW) : '');
  }

  function closeSheet() {
    setSheetLeaving(true);
    setTimeout(() => { setNewVersionFor(null); setSheetLeaving(false); }, 280);
  }

  function saveNewVersion() {
    if (!newVersionFor) return;
    const closer = parseFloat(nvCloser);
    const kilo = parseFloat(nvKilo);
    if (isNaN(closer) || isNaN(kilo) || !nvLabel.trim() || !nvDate) {
      toast('Fill all fields', 'error'); return;
    }
    const rates: InstallerRates = { type: 'flat', closerPerW: closer, kiloPerW: kilo };
    createNewInstallerVersion(newVersionFor, nvLabel.trim(), nvDate, rates);
    toast('Version created');
    closeSheet();
  }

  const inputStyle = {
    background: 'var(--m-card, var(--surface-mobile-card))',
    border: '1px solid var(--m-border, var(--border-mobile))',
    '--tw-ring-color': 'var(--accent-emerald)',
  } as React.CSSProperties;
  const inputClass = 'flex-1 rounded-xl px-3 py-2 text-base text-white focus:outline-none focus:ring-1';

  if (entries.length === 0) return <MobileEmptyState icon={BookOpen} title="No baselines configured" />;

  return (
    <div className="space-y-3">
      {entries.map(([installer, baseline]) => {
        const isEditing = editingInstaller === installer;
        const setterAuto = Math.round((baseline.closerPerW + 0.10) * 100) / 100;
        return (
          <MobileCard key={installer}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-base font-semibold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                {installer}
              </p>
              {!isEditing && (
                <div className="flex gap-1">
                  <button
                    onClick={() => openNewVersion(installer)}
                    className="p-2 active:opacity-70 transition-colors"
                    style={{ color: 'var(--accent-emerald)' }}
                    title="New version"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => startEdit(installer)}
                    className="p-2 active:opacity-70 transition-colors"
                    style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
                    title="Edit baseline"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2">
                {([
                  { key: 'closerPerW', label: 'Closer $/W' },
                  { key: 'kiloPerW', label: 'Kilo $/W' },
                  { key: 'setterPerW', label: 'Setter $/W (blank = auto)' },
                  { key: 'subDealerPerW', label: 'Sub-Dealer $/W (opt.)' },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-sm w-36 shrink-0" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {label}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={editVals[key]}
                      onChange={(e) => setEditVals((p) => ({ ...p, [key]: e.target.value }))}
                      className={inputClass}
                      style={inputStyle}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveEdit}
                    className="flex-1 min-h-[44px] rounded-2xl text-black text-base font-semibold active:opacity-80"
                    style={{ background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingInstaller(null)}
                    className="flex-1 min-h-[44px] rounded-2xl text-base active:opacity-80"
                    style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {([
                  ['Closer', `$${baseline.closerPerW.toFixed(2)}/W`],
                  ['Kilo', `$${baseline.kiloPerW.toFixed(2)}/W`],
                  ['Setter', `$${(baseline.setterPerW ?? setterAuto).toFixed(2)}/W${baseline.setterPerW == null ? ' (auto)' : ''}`],
                  ...(baseline.subDealerPerW != null ? [['Sub-Dealer', `$${baseline.subDealerPerW.toFixed(2)}/W`]] : []),
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-1">
                    <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}:</span>
                    <span className="text-sm text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </MobileCard>
        );
      })}

      {newVersionFor && (
        <div
          className="bs-backdrop fixed inset-0 z-50 flex items-end justify-center"
          style={{
            background: 'rgba(0,0,0,0.6)',
            animation: sheetLeaving
              ? 'bs-backdrop-out 280ms ease both'
              : 'bs-backdrop-in 200ms ease both',
          }}
        >
          <div
            className="bs-panel w-full max-w-lg rounded-t-3xl px-6 pt-6 space-y-4"
            style={{
              background: 'var(--navy-card, var(--navy-base))',
              paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
              animation: sheetLeaving
                ? 'bs-down 280ms cubic-bezier(0.55,0,1,0.45) both'
                : 'bs-up 360ms cubic-bezier(0.16,1,0.3,1) both',
            }}
          >
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
              New Version — {newVersionFor}
            </h2>
            {([
              { label: 'Label', value: nvLabel, set: setNvLabel, type: 'text' },
              { label: 'Effective From', value: nvDate, set: setNvDate, type: 'date' },
              { label: 'Closer $/W', value: nvCloser, set: setNvCloser, type: 'number' },
              { label: 'Kilo $/W', value: nvKilo, set: setNvKilo, type: 'number' },
            ] as Array<{ label: string; value: string; set: (v: string) => void; type: string }>).map(({ label, value, set, type }) => (
              <div key={label}>
                <p className="text-sm mb-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</p>
                <input
                  type={type}
                  step={type === 'number' ? '0.01' : undefined}
                  inputMode={type === 'number' ? 'decimal' : undefined}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-base text-white focus:outline-none focus:ring-1"
                  style={inputStyle}
                />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button
                onClick={saveNewVersion}
                className="flex-1 min-h-[48px] rounded-2xl text-black font-semibold active:opacity-80"
                style={{ background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                Create Version
              </button>
              <button
                onClick={closeSheet}
                className="flex-1 min-h-[48px] rounded-2xl active:opacity-80"
                style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SolarTechBaselines() {
  const { solarTechProducts } = useApp();
  const [activeFamily, setActiveFamily] = useState<string>(SOLARTECH_FAMILIES[0]);

  const familyProducts = solarTechProducts.filter((p) => p.family === activeFamily);

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        Current rates by family. Full editing available on desktop.
      </p>
      <MobilePillTabs
        items={SOLARTECH_FAMILIES.map(f => ({ id: f, label: f }))}
        activeId={activeFamily}
        onChange={setActiveFamily}
      />
      {familyProducts.length === 0 ? (
        <MobileEmptyState icon={BookOpen} title="No products in this family" />
      ) : (
        familyProducts.map((product) => (
          <MobileCard key={product.id}>
            <p className="text-base font-semibold text-white mb-2" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              {product.name}
            </p>
            <div className="space-y-1">
              {product.tiers.map((tier) => (
                <div key={tier.minKW} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {tier.minKW}–{tier.maxKW ?? '∞'} kW
                  </span>
                  <span className="text-sm text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    C: ${tier.closerPerW.toFixed(2)} · K: ${tier.kiloPerW.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </MobileCard>
        ))
      )}
    </div>
  );
}

function ProductCatalogBaselines() {
  const { productCatalogInstallerConfigs, productCatalogProducts } = useApp();
  const installerNames = Object.keys(productCatalogInstallerConfigs);
  const [activeInstaller, setActiveInstaller] = useState<string>(installerNames[0] ?? '');
  const [activeFamily, setActiveFamily] = useState<string>(
    productCatalogInstallerConfigs[installerNames[0] ?? '']?.families[0] ?? ''
  );

  if (installerNames.length === 0) return <MobileEmptyState icon={BookOpen} title="No product catalog installers" />;

  const config = productCatalogInstallerConfigs[activeInstaller];
  const familyProducts = productCatalogProducts.filter(
    (p) => p.installer === activeInstaller && p.family === activeFamily
  );

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        Current rates by installer and family. Full editing available on desktop.
      </p>
      {installerNames.length > 1 && (
        <MobilePillTabs
          items={installerNames.map(n => ({ id: n, label: n }))}
          activeId={activeInstaller}
          onChange={(id) => { setActiveInstaller(id); setActiveFamily(productCatalogInstallerConfigs[id]?.families[0] ?? ''); }}
        />
      )}
      {config?.families && config.families.length > 1 && (
        <MobilePillTabs
          items={config.families.map(f => ({ id: f, label: f }))}
          activeId={activeFamily}
          onChange={setActiveFamily}
        />
      )}
      {familyProducts.length === 0 ? (
        <MobileEmptyState icon={BookOpen} title="No products" />
      ) : (
        familyProducts.map((product) => (
          <MobileCard key={product.id}>
            <p className="text-base font-semibold text-white mb-2" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              {product.name}
            </p>
            <div className="space-y-1">
              {product.tiers.map((tier) => (
                <div key={tier.minKW} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {tier.minKW}–{tier.maxKW ?? '∞'} kW
                  </span>
                  <span className="text-sm text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    C: ${tier.closerPerW.toFixed(2)} · K: ${tier.kiloPerW.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </MobileCard>
        ))
      )}
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
