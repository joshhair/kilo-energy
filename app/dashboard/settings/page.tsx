'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import MobileSettings from '../mobile/MobileSettings';
import { useToast } from '../../../lib/toast';
import { TrainerAssignment, TrainerOverrideTier } from '../../../lib/data';
import {
  Layers, Building2, Landmark, BookOpen, Download, Settings,
  ChevronRight, Sliders, Tent, EyeOff, Eye, X, Handshake, UserCog,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Extracted components ──────────────────────────────────────────────────────
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog';
import { SectionHeader } from './components/SectionHeader';
import { SettingsSkeleton } from './components/SettingsSkeleton';
import { BlitzPermissionsSection } from './sections/BlitzPermissionsSection';
import { SubDealersSection } from './sections/SubDealersSection';
import { PMSection } from './sections/PMSection';
import { TrainersSection } from './sections/TrainersSection';
import { InstallersSection } from './sections/InstallersSection';
import { FinancersSection } from './sections/FinancersSection';
import { CustomizationSection } from './sections/CustomizationSection';
import { ExportSection } from './sections/ExportSection';
import { BaselinesSection } from './sections/BaselinesSection';

// ─── Nav structure ────────────────────────────────────────────────────────────

type SettingsSection =
  | 'trainers'
  | 'installers' | 'financers' | 'baselines'
  | 'blitz-permissions'
  | 'sub-dealers'
  | 'project-managers'
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
      { id: 'sub-dealers', label: 'Sub-Dealers', icon: Handshake },
      { id: 'project-managers', label: 'Project Managers', icon: UserCog },
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsPageWrapper() {
  return <Suspense><SettingsPageInner /></Suspense>;
}

function SettingsPageInner() {
  const isHydrated = useIsHydrated();
  useEffect(() => { document.title = 'Settings | Kilo Energy'; }, []);
  const {
    effectiveRole,
    reps,
    installers, financers, setInstallerActive, setFinancerActive, deleteInstaller, deleteFinancer,
    projects, trainerAssignments, setTrainerAssignments,
    installerBaselines, updateInstallerBaseline,
    installerPrepaidOptions, updateInstallerPrepaidOption,
  } = useApp();

  const { toast } = useToast();

  const router = useRouter();
  const searchParams = useSearchParams();

  const validSections: SettingsSection[] = ['trainers', 'blitz-permissions', 'sub-dealers', 'project-managers', 'installers', 'financers', 'baselines', 'customization', 'export'];
  const paramSection = searchParams.get('section') as SettingsSection | null;
  const initialSection: SettingsSection = paramSection && validSections.includes(paramSection) ? paramSection : 'trainers';

  const [section, setSection] = useState<SettingsSection>(initialSection);

  useEffect(() => {
    const p = searchParams.get('section') as SettingsSection | null;
    const next = p && validSections.includes(p) ? p : 'trainers';
    // URL changed externally (back/forward, manual edit) — guard unsaved edits
    if (next !== section && hasUnsavedChanges()) {
      setPendingSection(next);
      router.replace(`/dashboard/settings?section=${section}`, { scroll: false });
      return;
    }
    setSection(next);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared editing state (unsaved-changes guard) ────────────────────────────
  const [editingInstaller, setEditingInstaller] = useState<string | null>(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editingTiers, setEditingTiers] = useState<TrainerOverrideTier[]>([]);
  const [editingPrepaid, setEditingPrepaid] = useState<string | null>(null);
  const [editingProductName, setEditingProductName] = useState<string | null>(null);
  const [newVersionFor, setNewVersionFor] = useState<string | null>(null);
  const [pcNewVersionFor, setPcNewVersionFor] = useState<string | null>(null);
  const [dupAllOpen, setDupAllOpen] = useState<'solartech' | 'productcatalog' | null>(null);
  const [payScheduleExpanded, setPayScheduleExpanded] = useState<string | null>(null);
  const [baselineTab, setBaselineTab] = useState<string>('standard');

  // ── Unified delete-confirm dialog state ─────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'installer' | 'financer' | 'trainer';
    id: string;
    name: string;
    message: string;
  } | null>(null);
  const [hiddenFinancers, setHiddenFinancers] = useState<Set<string>>(new Set());
  const deletedEntityRef = useRef<
    | { type: 'installer'; name: string }
    | { type: 'financer'; name: string }
    | { type: 'trainer'; assignment: TrainerAssignment }
    | null
  >(null);

  // ── Bulk select state (installers + financers) for floating toolbar ─────────
  const [installerSelectMode, setInstallerSelectMode] = useState(false);
  const [selectedInstallers, setSelectedInstallers] = useState<Set<string>>(new Set());
  const [financerSelectMode, setFinancerSelectMode] = useState(false);
  const [selectedFinancers, setSelectedFinancers] = useState<Set<string>>(new Set());

  // ── Admin users count ───────────────────────────────────────────────────────
  const [adminUsers, setAdminUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  useEffect(() => {
    fetch('/api/reps?role=admin').then((r) => r.ok ? r.json() : []).then((users: Array<{ id: string; firstName: string; lastName: string; email: string }>) => {
      setAdminUsers(users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email })));
    }).catch(() => {});
  }, []);

  /** Check whether the user has unsaved inline edits or open version-creation modals */
  const hasUnsavedChanges = () =>
    editingInstaller !== null ||
    editingAssignmentId !== null ||
    editingPrepaid !== null ||
    editingProductName !== null ||
    newVersionFor !== null ||
    pcNewVersionFor !== null ||
    dupAllOpen;

  // ── Unsaved-changes guard state ────────────────────────────────────────────
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);

  /** Update URL when section changes */
  const handleSetSection = (s: SettingsSection) => {
    if (s !== section && hasUnsavedChanges()) {
      setPendingSection(s);
      return;
    }
    setSelectedInstallers(new Set());
    setSelectedFinancers(new Set());
    setInstallerSelectMode(false);
    setFinancerSelectMode(false);
    setSection(s);
    router.replace(`/dashboard/settings?section=${s}`, { scroll: false });
  };

  /** Discard unsaved edits and navigate to the pending section */
  const discardAndNavigate = () => {
    setEditingInstaller(null);
    setEditingAssignmentId(null);
    setEditingPrepaid(null);
    setEditingProductName(null);
    setNewVersionFor(null);
    setPcNewVersionFor(null);
    setDupAllOpen(null);
    setPayScheduleExpanded(null);
    setSelectedInstallers(new Set());
    setSelectedFinancers(new Set());
    setInstallerSelectMode(false);
    setFinancerSelectMode(false);
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

  // ── Keyboard shortcuts for edits (Escape = cancel, Enter = save) ───────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isEditActive = editingInstaller !== null || editingAssignmentId !== null || editingPrepaid !== null || editingProductName !== null;
      if (!isEditActive) return;

      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON';

      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingInstaller(null);
        setEditingAssignmentId(null);
        setEditingPrepaid(null);
        setEditingProductName(null);
        if (installerSelectMode) { setInstallerSelectMode(false); setSelectedInstallers(new Set()); }
        if (financerSelectMode) { setFinancerSelectMode(false); setSelectedFinancers(new Set()); }
      }

      if (e.key === 'Enter' && !inInput) {
        e.preventDefault();
        if (editingAssignmentId) {
          setTrainerAssignments((prev) =>
            prev.map((x) => (x.id === editingAssignmentId ? { ...x, tiers: editingTiers } : x))
          );
          fetch('/api/trainer-assignments', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editingAssignmentId, tiers: editingTiers }),
          }).catch(console.error);
          setEditingAssignmentId(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingInstaller, editingAssignmentId, editingTiers, editingPrepaid, editingProductName, updateInstallerBaseline, setTrainerAssignments, updateInstallerPrepaidOption, installerSelectMode, financerSelectMode]);

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
      toast(`"${name}" deleted`, 'info');
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
        const savedAssignment = assignment;
        setTrainerAssignments((prev) => prev.filter((a) => a.id !== id));
        fetch('/api/trainer-assignments', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).catch(console.error);
        toast(`Trainer assignment removed`, 'info', {
          label: 'Undo',
          onClick: () => {
            const saved = savedAssignment;
            if (saved) {
              setTrainerAssignments((prev) => [...prev, saved]);
              fetch('/api/trainer-assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  trainerId: saved.trainerId,
                  traineeId: saved.traineeId,
                  tiers: saved.tiers,
                }),
              })
                .then((r) => r.json())
                .then((created) => {
                  if (created?.id) {
                    setTrainerAssignments((prev) =>
                      prev.map((a) =>
                        a.id === saved.id ? { ...a, id: created.id } : a,
                      ),
                    );
                  }
                })
                .catch(console.error);
            }
          },
        });
      }
    }
  };

  const isMobile = useMediaQuery('(max-width: 767px)');

  if (!isHydrated) return <SettingsSkeleton />;

  if (isMobile) return <MobileSettings />;

  if (effectiveRole !== 'admin') {
    return (
      <div className="p-8 text-center">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen animate-fade-in-up">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 p-4 pt-8 hidden md:block" style={{ borderRight: '1px solid var(--border)' }}>
        <div className="mb-6">
          <div className="h-[3px] w-8 rounded-full mb-3" style={{ background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))' }} />
          <div className="flex items-center gap-2 mb-0.5">
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(0,196,240,0.15)' }}>
              <Settings className="w-4 h-4" style={{ color: 'var(--accent-cyan)' }} />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Settings</h1>
          </div>
          <p className="text-[var(--text-muted)] text-xs ml-8">App configuration</p>
        </div>

        <nav ref={navRef} className="relative space-y-4">
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: 0, width: '100%', borderRadius: '12px',
              background: 'rgba(0,196,240,0.1)',
              transition: 'top 250ms cubic-bezier(0.4, 0, 0.2, 1), height 250ms cubic-bezier(0.4, 0, 0.2, 1)',
              opacity: 1, zIndex: 0, pointerEvents: 'none',
              top: pillStyle.top, height: pillStyle.height,
              boxShadow: '0 0 12px rgba(0,196,240,0.1)',
              border: '1px solid rgba(0,196,240,0.25)',
            }}
          />

          {NAV.map(({ group, items }) => (
            <div key={group}>
              <p className="text-[10px] font-semibold uppercase mb-1 px-2" style={{ color: 'var(--text-dim)', letterSpacing: '0.12em' }}>{group}</p>
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
                        : 'hover:bg-[var(--surface-card)]/60'
                    }`}
                    style={isActive ? { color: 'var(--accent-cyan)' } : { color: 'var(--text-secondary)' }}
                  >
                    <span style={isActive ? { color: 'var(--accent-cyan)' } : { color: 'var(--text-dim)' }}><Icon className="w-4 h-4 flex-shrink-0" /></span>
                    <span className="truncate">{label}</span>
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: 'var(--accent-cyan)' }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile horizontal tab bar */}
      <div className="md:hidden border-b border-[var(--border-subtle)] w-full">
        <div className="flex items-center gap-1 px-3 pt-4 pb-2 overflow-x-auto scrollbar-hide">
          {ALL_NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = section === id;
            return (
              <button
                key={id}
                onClick={() => handleSetSection(id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 shrink-0 ${
                  isActive
                    ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)] border border-[var(--accent-green)]/30 shadow-sm shadow-blue-500/10'
                    : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)]/60 border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content panel */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto">

        {/* Breadcrumb */}
        {(() => {
          const currentNav = ALL_NAV_ITEMS.find(item => item.id === section);
          if (!currentNav) return null;
          const NavIcon = currentNav.icon;
          return (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-4">
              <Settings className="w-3 h-3 text-[var(--text-dim)]" />
              <span>Settings</span>
              <ChevronRight className="w-3 h-3 text-[var(--text-dim)]" />
              <NavIcon className="w-3 h-3 text-[var(--accent-green)]" />
              <span className="text-[var(--text-secondary)] font-medium">{currentNav.label}</span>
            </div>
          );
        })()}

        {/* Settings Summary Dashboard */}
        {editingInstaller === null && editingAssignmentId === null && editingPrepaid === null && editingProductName === null && (() => {
          const activeInstallerCount = installers.filter((i) => i.active).length;
          const activeFinancerCount = financers.filter((f) => f.active && !hiddenFinancers.has(f.name) && f.name !== 'Cash').length;
          const trainerCount = trainerAssignments.length;
          const adminCount = adminUsers.length;
          return (
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              {[
                { label: 'Active Installers', value: activeInstallerCount, color: 'text-[var(--accent-green)]', bg: 'bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
                { label: 'Active Financers', value: activeFinancerCount, color: 'text-[var(--accent-green)]', bg: 'bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
                { label: 'Trainer Assignments', value: trainerCount, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
                { label: 'Admin Users', value: adminCount, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={`${bg} border rounded-xl px-3 py-1.5 flex items-center gap-2`}>
                  <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{label}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Section rendering ──────────────────────────────────────────────── */}

        {section === 'trainers' && (
          <TrainersSection
            editingAssignmentId={editingAssignmentId}
            setEditingAssignmentId={setEditingAssignmentId}
            editingTiers={editingTiers}
            setEditingTiers={setEditingTiers}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
          />
        )}

        {section === 'blitz-permissions' && (
          <BlitzPermissionsSection reps={reps} />
        )}

        {section === 'sub-dealers' && <SubDealersSection />}

        {section === 'project-managers' && <PMSection />}

        {section === 'installers' && (
          <InstallersSection
            editingPrepaid={editingPrepaid}
            setEditingPrepaid={setEditingPrepaid}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            setBaselineTab={setBaselineTab}
            installerSelectMode={installerSelectMode}
            setInstallerSelectMode={setInstallerSelectMode}
            selectedInstallers={selectedInstallers}
            setSelectedInstallers={setSelectedInstallers}
            payScheduleExpanded={payScheduleExpanded}
            setPayScheduleExpanded={setPayScheduleExpanded}
          />
        )}

        {section === 'financers' && (
          <FinancersSection
            hiddenFinancers={hiddenFinancers}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            financerSelectMode={financerSelectMode}
            setFinancerSelectMode={setFinancerSelectMode}
            selectedFinancers={selectedFinancers}
            setSelectedFinancers={setSelectedFinancers}
          />
        )}

        {section === 'baselines' && (
          <BaselinesSection
            editingInstaller={editingInstaller}
            setEditingInstaller={setEditingInstaller}
            editingProductName={editingProductName}
            setEditingProductName={setEditingProductName}
            newVersionFor={newVersionFor}
            setNewVersionFor={setNewVersionFor}
            pcNewVersionFor={pcNewVersionFor}
            setPcNewVersionFor={setPcNewVersionFor}
            dupAllOpen={dupAllOpen}
            setDupAllOpen={setDupAllOpen}
            baselineTab={baselineTab}
            setBaselineTab={setBaselineTab}
          />
        )}

        {section === 'customization' && <CustomizationSection />}

        {section === 'export' && <ExportSection />}

        {/* Spacer so content is never hidden behind the fixed action bar */}
        {(selectedInstallers.size > 0 || selectedFinancers.size > 0) && <div className="h-20" />}

      </main>

      {/* Floating bulk-action toolbar (installers + financers) */}
      {(selectedInstallers.size > 0 || selectedFinancers.size > 0) && (() => {
        const selInstallers = [...selectedInstallers];
        const selFinancers = [...selectedFinancers];
        const totalCount = selInstallers.length + selFinancers.length;
        const selectedActiveInstallers = selInstallers.filter((n) => installers.find((i) => i.name === n)?.active);
        const selectedArchivedInstallers = selInstallers.filter((n) => !installers.find((i) => i.name === n)?.active);
        const selectedActiveFinancers = selFinancers.filter((n) => financers.find((f) => f.name === n)?.active);
        const selectedArchivedFinancers = selFinancers.filter((n) => !financers.find((f) => f.name === n)?.active);
        const hasActive = selectedActiveInstallers.length > 0 || selectedActiveFinancers.length > 0;
        const hasArchived = selectedArchivedInstallers.length > 0 || selectedArchivedFinancers.length > 0;
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 backdrop-blur-xl bg-[var(--surface)]/80 border border-[var(--border)]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40 animate-float-toolbar-in" role="toolbar" aria-label="Batch actions for selected items">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 bg-[var(--accent-green)]/15 border border-[var(--accent-green)]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
                <span className="text-white font-bold tabular-nums">{totalCount}</span>
                <span className="text-[var(--accent-green)] font-medium">selected</span>
              </span>
              <div className="h-5 w-px bg-[var(--border)]/80 flex-shrink-0" />
              {hasActive && (
                <button onClick={() => { selectedActiveInstallers.forEach((n) => setInstallerActive(n, false)); selectedActiveFinancers.forEach((n) => setFinancerActive(n, false)); const count = selectedActiveInstallers.length + selectedActiveFinancers.length; toast(`${count} item${count !== 1 ? 's' : ''} archived`, 'info'); setSelectedInstallers(new Set()); setSelectedFinancers(new Set()); setInstallerSelectMode(false); setFinancerSelectMode(false); }}
                  className="flex items-center gap-1.5 text-white font-semibold px-4 py-1.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20 active:scale-[0.97] transition-all whitespace-nowrap">
                  <EyeOff className="w-3.5 h-3.5" /> Archive Selected
                </button>
              )}
              {hasArchived && (
                <button onClick={() => { selectedArchivedInstallers.forEach((n) => setInstallerActive(n, true)); selectedArchivedFinancers.forEach((n) => setFinancerActive(n, true)); const count = selectedArchivedInstallers.length + selectedArchivedFinancers.length; toast(`${count} item${count !== 1 ? 's' : ''} restored`, 'info'); setSelectedInstallers(new Set()); setSelectedFinancers(new Set()); setInstallerSelectMode(false); setFinancerSelectMode(false); }}
                  className="flex items-center gap-1.5 text-black font-semibold px-4 py-1.5 rounded-xl text-sm bg-[var(--accent-green)] hover:bg-[var(--accent-green)] shadow-lg shadow-emerald-500/20 active:scale-[0.97] transition-all whitespace-nowrap">
                  <Eye className="w-3.5 h-3.5" /> Restore Selected
                </button>
              )}
              <button onClick={() => { setSelectedInstallers(new Set()); setSelectedFinancers(new Set()); setInstallerSelectMode(false); setFinancerSelectMode(false); }} aria-label="Deselect all and dismiss toolbar"
                className="btn-secondary p-1.5 rounded-lg bg-[var(--border)]/60 hover:bg-[var(--text-dim)]/80 border border-[var(--border)]/40 text-[var(--text-secondary)] hover:text-white transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* Unified delete-confirm dialog */}
      {deleteConfirm && (
        <ConfirmDeleteDialog
          confirm={deleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {/* Unsaved-changes guard dialog */}
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
