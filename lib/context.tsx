'use client';

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef, ReactNode } from 'react';
import { PROJECTS, PAYROLL_ENTRIES, REIMBURSEMENTS, TRAINER_ASSIGNMENTS, INCENTIVES, INSTALLERS, FINANCERS, Project, PayrollEntry, Reimbursement, TrainerAssignment, Incentive, getTrainerOverrideRate, REPS, Rep, SubDealer, SUB_DEALERS, NON_SOLARTECH_BASELINES, SOLARTECH_PRODUCTS, InstallerBaseline, SolarTechProduct, INSTALLER_PRICING_VERSIONS, InstallerPricingVersion, InstallerRates, PRODUCT_CATALOG_INSTALLER_CONFIGS, PRODUCT_CATALOG_PRODUCTS, ProductCatalogInstallerConfig, ProductCatalogProduct, PREPAID_OPTIONS, Phase, PRODUCT_CATALOG_PRICING_VERSIONS, ProductCatalogPricingVersion, ProductCatalogTier, INSTALLER_PAY_CONFIGS, InstallerPayConfig, DEFAULT_INSTALL_PAY_PCT } from './data';
import { getM1PayDate, getM2PayDate, localDateString } from './utils';
import { persistFetch, emitPersistError } from './persist';
import { createUserActions } from './context/users';
import { createInstallerActions } from './context/installers';
import { createPayrollActions } from './context/payroll';
import {
  mapProjectUpdateToDb, computeM3Amount, repairM3AmountAtPTO, deriveM3FromM2Edit,
  handleChargebacks, getOrphanedChargebackIds, handlePhaseRollback,
  createMilestonePayroll, createM3Payroll, syncPayrollAmounts,
  type ProjectTransitionDeps,
} from './context/project-transitions';

type Role = 'rep' | 'admin' | 'sub-dealer' | 'project_manager' | null;

export interface ManagedItem { name: string; active: boolean; }

interface AppContextType {
  dbReady: boolean;
  dataError: boolean;
  currentRole: Role;
  currentRepId: string | null;
  currentRepName: string | null;
  setRole: (role: Role, repId?: string, repName?: string, pmPerms?: { canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean }) => void;
  logout: () => void;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  payrollEntries: PayrollEntry[];
  setPayrollEntries: React.Dispatch<React.SetStateAction<PayrollEntry[]>>;
  reimbursements: Reimbursement[];
  setReimbursements: React.Dispatch<React.SetStateAction<Reimbursement[]>>;
  trainerAssignments: TrainerAssignment[];
  setTrainerAssignments: React.Dispatch<React.SetStateAction<TrainerAssignment[]>>;
  incentives: Incentive[];
  setIncentives: React.Dispatch<React.SetStateAction<Incentive[]>>;
  // Adds a project and auto-creates Draft payroll entries for all involved reps
  addDeal: (project: Project, closerM1: number, closerM2: number, setterM1?: number, setterM2?: number, trainerM1?: number, trainerM2?: number, trainerId?: string) => boolean;
  // Marks individual payroll entries as Pending
  markForPayroll: (entryIds: string[]) => Promise<void>;
  // Persists a new payroll entry to the DB, registers its temp ID in the resolution map
  // so markForPayroll waits for the real DB id before sending PATCH
  persistPayrollEntry: (entry: PayrollEntry) => void;
  // Installer / financer management
  installers: ManagedItem[];
  financers: ManagedItem[];
  activeInstallers: string[];
  activeFinancers: string[];
  setInstallerActive: (name: string, active: boolean) => void;
  setFinancerActive: (name: string, active: boolean) => void;
  addInstaller: (name: string, initialRates?: { closerPerW: number; kiloPerW: number }) => void;
  addFinancer: (name: string) => void;
  // Rep management
  reps: Rep[];
  addRep: (firstName: string, lastName: string, email: string, phone: string, repType?: 'closer' | 'setter' | 'both', id?: string, role?: 'rep' | 'admin' | 'sub-dealer') => Promise<{ id: string } | undefined>;
  /** @deprecated Use `deactivateRep` (preserves entry, marks inactive) or `deleteRepPermanently` (hard delete). */
  removeRep: (id: string) => void;
  /** Soft-deactivate: marks active=false, keeps the entry in `reps` array so historical views can render greyed-out. Calls Clerk lock + invitation revoke server-side. */
  deactivateRep: (id: string) => Promise<void>;
  /** Re-enable a previously deactivated rep. Calls Clerk unlock server-side. */
  reactivateRep: (id: string) => Promise<void>;
  /** Hard delete — removes the row entirely. Server enforces zero-relations gate (returns 409 if user has any history). */
  deleteRepPermanently: (id: string) => Promise<{ success: boolean; error?: string }>;
  updateRepType: (id: string, repType: 'closer' | 'setter' | 'both') => void;
  updateRepContact: (id: string, updates: { firstName?: string; lastName?: string; email?: string; phone?: string }) => void;
  // Sub-dealer management
  subDealers: SubDealer[];
  addSubDealer: (firstName: string, lastName: string, email: string, phone: string, id?: string) => Promise<{ id: string } | undefined>;
  /** @deprecated Use `deactivateSubDealer` or `deleteSubDealerPermanently`. */
  removeSubDealer: (id: string) => void;
  deactivateSubDealer: (id: string) => Promise<void>;
  reactivateSubDealer: (id: string) => Promise<void>;
  deleteSubDealerPermanently: (id: string) => Promise<{ success: boolean; error?: string }>;
  updateSubDealerContact: (id: string, updates: { firstName?: string; lastName?: string; email?: string; phone?: string }) => void;
  // Project editing
  updateProject: (id: string, updates: Partial<Project>) => void;
  // Editable baselines (derived from active pricing versions for backward compat)
  installerBaselines: Record<string, InstallerBaseline>;
  updateInstallerBaseline: (installer: string, baseline: InstallerBaseline) => void;
  addInstallerBaseline: (installer: string) => void;
  // Installer pricing versions
  installerPricingVersions: InstallerPricingVersion[];
  addInstallerPricingVersion: (version: InstallerPricingVersion) => void;
  updateInstallerPricingVersion: (id: string, updates: Partial<InstallerPricingVersion>) => void;
  // Close current active version and create a new one with updated rates
  createNewInstallerVersion: (installer: string, label: string, effectiveFrom: string, rates: InstallerRates) => void;
  solarTechProducts: SolarTechProduct[];
  updateSolarTechProduct: (id: string, updates: Partial<SolarTechProduct>) => void;
  updateSolarTechTier: (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) => void;
  // Product Catalog installer system
  productCatalogInstallerConfigs: Record<string, ProductCatalogInstallerConfig>;
  productCatalogProducts: ProductCatalogProduct[];
  addProductCatalogInstaller: (name: string, config: ProductCatalogInstallerConfig) => void;
  updateProductCatalogInstallerConfig: (name: string, config: Partial<ProductCatalogInstallerConfig>) => void;
  addProductCatalogProduct: (product: ProductCatalogProduct) => void;
  updateProductCatalogProduct: (id: string, updates: Partial<ProductCatalogProduct>) => void;
  updateProductCatalogTier: (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) => void;
  removeProductCatalogProduct: (id: string) => Promise<void>;
  // Product Catalog pricing versions
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  addProductCatalogPricingVersion: (version: ProductCatalogPricingVersion) => void;
  updateProductCatalogPricingVersion: (id: string, updates: Partial<ProductCatalogPricingVersion>) => void;
  createNewProductCatalogVersion: (productId: string, label: string, effectiveFrom: string, tiers: ProductCatalogTier[]) => void;
  deleteProductCatalogPricingVersions: (versionIds: string[]) => void;
  deleteInstaller: (name: string) => Promise<void>;
  deleteFinancer: (name: string) => Promise<void>;
  // Per-installer prepaid options management
  installerPrepaidOptions: Record<string, string[]>;
  getInstallerPrepaidOptions: (installer: string) => string[];
  addInstallerPrepaidOption: (installer: string, option: string) => void;
  updateInstallerPrepaidOption: (installer: string, oldName: string, newName: string) => void;
  removeInstallerPrepaidOption: (installer: string, option: string) => void;
  // Installer pay configs (install % vs PTO %)
  installerPayConfigs: Record<string, InstallerPayConfig>;
  setInstallerPayConfigs: React.Dispatch<React.SetStateAction<Record<string, InstallerPayConfig>>>;
  updateInstallerPayConfig: (installer: string, pct: number) => void;
  // Project Chatter — lightweight unread mention count for nav badge
  unreadMentionCount: number;
  refreshMentionCount: () => void;
  // View As (admin impersonation)
  viewAsUser: { id: string; name: string; role: 'rep' | 'sub-dealer' } | null;
  setViewAsUser: (user: { id: string; name: string; role: 'rep' | 'sub-dealer' }) => void;
  clearViewAs: () => void;
  isViewingAs: boolean;
  effectiveRole: Role;
  effectiveRepId: string | null;
  effectiveRepName: string | null;
  // PM permissions
  pmPermissions: { canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean } | null;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentRole, setCurrentRole] = useState<Role>(() => {
    if (typeof window === 'undefined') return null;
    return (localStorage.getItem('kilo-role') as Role) ?? null;
  });
  const [currentRepId, setCurrentRepId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('kilo-rep-id') ?? null;
  });
  const [currentRepName, setCurrentRepName] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('kilo-rep-name') ?? null;
  });
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>(PAYROLL_ENTRIES);
  const payrollEntriesRef = useRef(payrollEntries);
  payrollEntriesRef.current = payrollEntries;
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>(REIMBURSEMENTS);
  const [trainerAssignments, setTrainerAssignments] = useState<TrainerAssignment[]>(TRAINER_ASSIGNMENTS);
  const [incentives, setIncentives] = useState<Incentive[]>(INCENTIVES);
  const [installers, setInstallers] = useState<ManagedItem[]>(INSTALLERS.map((name) => ({ name, active: true })));
  const [financers, setFinancers] = useState<ManagedItem[]>(FINANCERS.map((name) => ({ name, active: true })));
  const [reps, setReps] = useState<Rep[]>(REPS.map((r) => ({ ...r })));
  const repsRef = useRef(reps);
  repsRef.current = reps;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const trainerAssignmentsRef = useRef(trainerAssignments);
  trainerAssignmentsRef.current = trainerAssignments;
  const [subDealers, setSubDealers] = useState<SubDealer[]>(SUB_DEALERS.map((sd) => ({ ...sd })));
  const [installerPricingVersions, setInstallerPricingVersions] = useState<InstallerPricingVersion[]>(INSTALLER_PRICING_VERSIONS.map((v) => ({ ...v })));
  const [solarTechProducts, setSolarTechProducts] = useState<SolarTechProduct[]>(SOLARTECH_PRODUCTS.map((p) => ({ ...p, tiers: p.tiers.map((t) => ({ ...t })) })));
  const [productCatalogInstallerConfigs, setProductCatalogInstallerConfigs] = useState<Record<string, ProductCatalogInstallerConfig>>({ ...PRODUCT_CATALOG_INSTALLER_CONFIGS });
  const [productCatalogProducts, setProductCatalogProducts] = useState<ProductCatalogProduct[]>(PRODUCT_CATALOG_PRODUCTS.map((p) => ({ ...p, tiers: p.tiers.map((t) => ({ ...t })) })));
  const [productCatalogPricingVersions, setProductCatalogPricingVersions] = useState<ProductCatalogPricingVersion[]>(PRODUCT_CATALOG_PRICING_VERSIONS.map((v) => ({ ...v, tiers: v.tiers.map((t) => ({ ...t })) })));
  const [installerPrepaidOptions, setInstallerPrepaidOptions] = useState<Record<string, string[]>>({
    'SolarTech': [...PREPAID_OPTIONS],
  });
  const [installerPayConfigs, setInstallerPayConfigs] = useState<Record<string, InstallerPayConfig>>({ ...INSTALLER_PAY_CONFIGS });
  const [dbReady, setDbReady] = useState(false);
  const [dataError, setDataError] = useState(false);
  const [unreadMentionCount, setUnreadMentionCount] = useState(0);
  const [viewAsUser, setViewAsUserState] = useState<{ id: string; name: string; role: 'rep' | 'sub-dealer' } | null>(null);
  const [pmPermissions, setPmPermissions] = useState<{ canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean } | null>(null);

  // Maps temp client IDs (pay_${ts}_...) → Promise<realDbId> for in-flight payroll POSTs.
  // markForPayroll awaits these before sending PATCH so it never sends temp IDs to the DB.
  const payrollIdResolutionMap = useRef<Map<string, Promise<string>>>(new Map());

  // Maps installer name → Promise<realDbId> for in-flight installer POSTs.
  // addProductCatalogProduct awaits this when the installer ID isn't in idMaps yet.
  const pendingInstallerIdRef = useRef<Map<string, Promise<string>>>(new Map());

  const setViewAsUser = useCallback((user: { id: string; name: string; role: 'rep' | 'sub-dealer' }) => {
    setViewAsUserState(user);
  }, []);
  const clearViewAs = useCallback(() => { setViewAsUserState(null); }, []);
  const isViewingAs = currentRole === 'admin' && viewAsUser !== null;
  const effectiveRole: Role = isViewingAs ? viewAsUser!.role : currentRole;
  const effectiveRepId = isViewingAs ? viewAsUser!.id : currentRepId;
  const effectiveRepName = isViewingAs ? viewAsUser!.name : currentRepName;
  const [idMaps, setIdMaps] = useState<{
    installerNameToId: Record<string, string>;
    financerNameToId: Record<string, string>;
  }>({ installerNameToId: {}, financerNameToId: {} });

  // Hydrate all state from the database on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/data')
      .then((res) => {
        if (!res.ok) throw new Error(`/api/data returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setReps(data.reps ?? []);
        setSubDealers(data.subDealers ?? []);
        setInstallers((data.installers ?? []).map((i: { name: string; active: boolean }) => ({ name: i.name, active: i.active })));
        setFinancers((data.financers ?? []).map((f: { name: string; active: boolean }) => ({ name: f.name, active: f.active })));
        setProjects(data.projects ?? []);
        setPayrollEntries(data.payrollEntries ?? []);
        setReimbursements(data.reimbursements ?? []);
        setTrainerAssignments(data.trainerAssignments ?? []);
        setIncentives(data.incentives ?? []);
        setInstallerPricingVersions(data.installerPricingVersions ?? []);
        setSolarTechProducts(data.solarTechProducts ?? []);
        setProductCatalogInstallerConfigs(data.productCatalogInstallerConfigs ?? {});
        setProductCatalogProducts(data.productCatalogProducts ?? []);
        setProductCatalogPricingVersions(data.productCatalogPricingVersions ?? []);
        setInstallerPrepaidOptions(data.installerPrepaidOptions ?? {});
        setInstallerPayConfigs(data.installerPayConfigs ?? {});
        if (data._idMaps) setIdMaps(data._idMaps);
        setDbReady(true);
      })
      .catch((err) => {
        console.error('Failed to load data from API:', err);
        setDataError(true);
        setDbReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch unread mention count for current rep
  const refreshMentionCount = useCallback(() => {
    if (!effectiveRepId) { setUnreadMentionCount(0); return; }
    fetch(`/api/mentions?userId=${encodeURIComponent(effectiveRepId)}`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data) => {
        if (Array.isArray(data)) setUnreadMentionCount(data.length);
      })
      .catch(() => {});
  }, [effectiveRepId]);

  useEffect(() => {
    if (dbReady && effectiveRepId) refreshMentionCount();
  }, [dbReady, effectiveRepId]);

  // ── Payroll actions (delegated to lib/context/payroll.ts) ──
  const payrollActions = useMemo(() => createPayrollActions({
    getPayrollEntries: () => payrollEntries,
    setPayrollEntries,
    payrollIdResolutionMap,
  }), [payrollEntries, setPayrollEntries]);
  const { persistPayrollEntry, deletePayrollEntriesFromDb } = payrollActions;
  // markForPayroll needs live payrollEntries for originalStatuses snapshot — see value block

  // installerBaselines is derived from the currently active pricing version per installer
  // (flat rate only — tiered installers show the first band for backward compat display)
  const installerBaselines = useMemo<Record<string, InstallerBaseline>>(() => {
    const today = localDateString(new Date());
    const result: Record<string, InstallerBaseline> = {};
    const allInstallerNames = Array.from(new Set(installerPricingVersions.map((v) => v.installer)));
    for (const name of allInstallerNames) {
      const candidates = installerPricingVersions.filter(
        (v) => v.installer === name && v.effectiveFrom <= today && (v.effectiveTo === null || v.effectiveTo >= today),
      );
      const active = candidates.reduce<InstallerPricingVersion | null>((best, v) =>
        best === null || v.effectiveFrom >= best.effectiveFrom ? v : best, null);
      if (!active) continue;
      const { rates } = active;
      // Tiered installers cannot be collapsed to a single baseline without knowing kW.
      // Callers needing tiered rates must use getInstallerRatesForDeal() with the deal's kW.
      if (rates.type === 'tiered') continue;
      const flatRates = rates;
      result[name] = { closerPerW: flatRates.closerPerW, kiloPerW: flatRates.kiloPerW, ...(flatRates.setterPerW != null ? { setterPerW: flatRates.setterPerW } : {}), ...(flatRates.subDealerPerW != null ? { subDealerPerW: flatRates.subDealerPerW } : {}) };
    }
    // Also include any NON_SOLARTECH_BASELINES entries without a pricing version
    for (const [name, baseline] of Object.entries(NON_SOLARTECH_BASELINES)) {
      if (!(name in result)) result[name] = baseline;
    }
    return result;
  }, [installerPricingVersions]);

  const activeInstallers = installers.filter((i) => i.active).map((i) => i.name);
  const activeFinancers = financers.filter((f) => f.active).map((f) => f.name);
  // ── Installer / financer / pricing actions (delegated to lib/context/installers.ts) ──
  const installerActions = useMemo(() => createInstallerActions({
    installers,
    setInstallers,
    setFinancers,
    setInstallerPricingVersions,
    setSolarTechProducts,
    setProductCatalogInstallerConfigs,
    setProductCatalogProducts,
    getProductCatalogProducts: () => productCatalogProducts,
    setProductCatalogPricingVersions,
    setInstallerPrepaidOptions,
    setInstallerPayConfigs,
    getIdMaps: () => idMaps,
    setIdMaps,
    pendingInstallerIdRef,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [installers, idMaps, productCatalogProducts]);
  const {
    setInstallerActive, setFinancerActive, addInstaller, addFinancer,
  } = installerActions;
  // ── User / sub-dealer actions (delegated to lib/context/users.ts) ──
  const userActions = useMemo(() => createUserActions({
    getReps: () => repsRef.current,
    setReps,
    setSubDealers,
    getSubDealers: () => subDealers,
  }), [setReps, setSubDealers, subDealers]);
  const { addRep, deactivateRep, reactivateRep, deleteRepPermanently, removeRep, updateRepType, updateRepContact, addSubDealer, deactivateSubDealer, reactivateSubDealer, deleteSubDealerPermanently, removeSubDealer, updateSubDealerContact } = userActions;

  // ── Activity logging helper (fire-and-forget) ──
  const logProjectActivity = (projectId: string, type: string, detail: string, meta?: string) => {
    fetch(`/api/projects/${projectId}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, detail, meta }),
    }).catch(console.error);
  };

  const transitionDeps: ProjectTransitionDeps = {
    repsRef, trainerAssignmentsRef, projectsRef, installerPayConfigs,
    persistPayrollEntry, deletePayrollEntriesFromDb, logProjectActivity,
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    // ── 1. Find old project & log activity ──
    const old = projects.find((p) => p.id === id);
    if (old) {
      if (updates.phase !== undefined && updates.phase !== old.phase) {
        logProjectActivity(id, 'phase_change', `Phase changed from ${old.phase} to ${updates.phase}`, JSON.stringify({ oldPhase: old.phase, newPhase: updates.phase }));
      }
      if (updates.flagged !== undefined && updates.flagged !== old.flagged) {
        logProjectActivity(id, updates.flagged ? 'flagged' : 'unflagged', updates.flagged ? 'Project flagged' : 'Project unflagged');
      }
      if (updates.m1Paid !== undefined && updates.m1Paid !== old.m1Paid) {
        logProjectActivity(id, 'm1_paid', updates.m1Paid ? 'M1 marked as paid' : 'M1 marked as unpaid');
      }
      if (updates.m2Paid !== undefined && updates.m2Paid !== old.m2Paid) {
        logProjectActivity(id, 'm2_paid', updates.m2Paid ? 'M2 marked as paid' : 'M2 marked as unpaid');
      }
      if (updates.notes !== undefined && updates.notes !== old.notes) {
        logProjectActivity(id, 'note_edit', 'Notes updated');
      }
      const fieldLabels: Record<string, string> = {
        installer: 'Installer', financer: 'Financer', productType: 'Product Type',
        kWSize: 'System Size (kW)', netPPW: 'Net PPW', soldDate: 'Sold Date',
        m1Amount: 'M1 Amount', m2Amount: 'M2 Amount',
      };
      for (const [key, label] of Object.entries(fieldLabels)) {
        const k = key as keyof Project;
        if (updates[k] !== undefined && updates[k] !== old[k]) {
          logProjectActivity(id, 'field_edit', `${label} changed from ${old[k]} to ${updates[k]}`, JSON.stringify({ field: key, old: old[k], new: updates[k] }));
        }
      }

      // ── 2. Setter reassignment (stays inline — deeply interleaved with state) ──
      if (updates.setterId !== undefined && updates.setterId !== old.setterId) {
        const oldSetter = old.setterId ? reps.find((r) => r.id === old.setterId)?.name ?? old.setterId : 'none';
        const newSetter = updates.setterId ? reps.find((r) => r.id === updates.setterId)?.name ?? updates.setterId : 'none';
        logProjectActivity(id, 'setter_assigned', `Setter changed from ${oldSetter} to ${newSetter}`, JSON.stringify({ oldSetterId: old.setterId, newSetterId: updates.setterId }));
        // Purge the old setter's Draft/Pending payroll entries for this project
        if (old.setterId) {
          const oldSetterName = repsRef.current.find((r) => r.id === old.setterId)?.name ?? '';
          const oldSetterTrainerAssignment = trainerAssignmentsRef.current.find((a) => a.traineeId === old.setterId);
          setPayrollEntries((prevEntries) => {
            const toRemove = prevEntries.filter((e) => {
              if (e.projectId !== id || (e.status !== 'Draft' && e.status !== 'Pending')) return false;
              if (e.repId === old.setterId) return true;
              if (
                oldSetterTrainerAssignment &&
                e.repId === oldSetterTrainerAssignment.trainerId &&
                e.paymentStage === 'Trainer' &&
                (e.notes?.startsWith('Trainer override M2') || e.notes?.startsWith('Trainer override M3')) &&
                (oldSetterName ? e.notes?.includes(`— ${oldSetterName} (`) : false)
              ) return true;
              return false;
            });
            if (toRemove.length > 0) {
              deletePayrollEntriesFromDb(toRemove.map((e) => e.id));
              return prevEntries.filter((e) => !toRemove.includes(e));
            }
            return prevEntries;
          });
        }

        // When a setter is removed, create the closer's M1 entry
        if (!updates.setterId && old.setterId) {
          const effectivePhase = (updates.phase ?? old.phase) as string;
          const PIPELINE_PHASES = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];
          const effectiveIdx = PIPELINE_PHASES.indexOf(effectivePhase);
          const pastAcceptance = effectiveIdx >= PIPELINE_PHASES.indexOf('Acceptance');
          const closerM1Amount = updates.m1Amount ?? old.m1Amount;

          if (pastAcceptance && !old.subDealerId && (closerM1Amount ?? 0) > 0) {
            setPayrollEntries((prevEntries) => {
              const hasM1 = prevEntries.some((e) => e.projectId === id && e.paymentStage === 'M1' && (e.repId === old.repId || e.status === 'Paid'));
              if (hasM1) return prevEntries;
              const closerRep = repsRef.current.find((r) => r.id === old.repId);
              const ts = Date.now();
              const newEntry: PayrollEntry = {
                id: `pay_${ts}_m1_c`,
                repId: old.repId,
                repName: closerRep?.name ?? old.repName,
                projectId: id,
                customerName: old.customerName,
                amount: closerM1Amount ?? 0,
                type: 'Deal',
                paymentStage: 'M1',
                status: 'Draft',
                date: getM1PayDate(),
                notes: '',
              };
              persistPayrollEntry(newEntry);
              return [...prevEntries, newEntry];
            });
          }
        }

        // Create Draft payroll entries for the incoming setter
        if (updates.setterId) {
          const newSetterId = updates.setterId;
          const newSetterRep = repsRef.current.find((r) => r.id === newSetterId);
          const effectivePhase = (updates.phase ?? old.phase) as string;
          const PIPELINE_PHASES = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];
          const effectiveIdx = PIPELINE_PHASES.indexOf(effectivePhase);
          const pastAcceptance = effectiveIdx >= PIPELINE_PHASES.indexOf('Acceptance');
          const pastInstalled = effectiveIdx >= PIPELINE_PHASES.indexOf('Installed');
          const pastPTO = effectiveIdx >= PIPELINE_PHASES.indexOf('PTO');

          setPayrollEntries((prevEntries) => {
            const ts = Date.now();
            const newEntries: PayrollEntry[] = [];

            let baseEntries = prevEntries;
            if (!old.setterId && pastAcceptance) {
              const closerM1 = prevEntries.filter(
                (e) => e.projectId === id && e.repId === old.repId && e.paymentStage === 'M1' && (e.status === 'Draft' || e.status === 'Pending')
              );
              if (closerM1.length > 0) {
                deletePayrollEntriesFromDb(closerM1.map((e) => e.id));
                baseEntries = prevEntries.filter((e) => !closerM1.includes(e));
              }
            }

            const effectiveSetterM1 = updates.setterM1Amount ?? old.setterM1Amount;
            const effectiveSetterM2 = updates.setterM2Amount ?? old.setterM2Amount;
            const effectiveSetterM3 = updates.setterM3Amount ?? old.setterM3Amount;
            const closerHasPaidM1 = !old.setterId && prevEntries.some(
              (e) => e.projectId === id && e.repId === old.repId && e.paymentStage === 'M1' && e.status === 'Paid'
            );
            if (pastAcceptance && (effectiveSetterM1 ?? 0) > 0) {
              const hasM1 = prevEntries.some((e) => e.projectId === id && e.repId === newSetterId && e.paymentStage === 'M1');
              if (!hasM1 && !closerHasPaidM1) {
                newEntries.push({
                  id: `pay_${ts}_m1_s`,
                  repId: newSetterId,
                  repName: newSetterRep?.name ?? '',
                  projectId: id,
                  customerName: old.customerName,
                  amount: effectiveSetterM1 ?? 0,
                  type: 'Deal',
                  paymentStage: 'M1',
                  status: 'Draft',
                  date: getM1PayDate(),
                  notes: 'Setter',
                });
              }
            }

            // Pre-compute setter trainer deductions so the trainer's cut comes from
            // the setter's entry rather than being paid on top (mirrors project-transitions.ts:362/541)
            let setterM2TrainerDeduction = 0;
            let setterM3TrainerDeduction = 0;
            if (!old.subDealerId) {
              const earlySetterTA = trainerAssignmentsRef.current.find((a) => a.traineeId === newSetterId);
              if (earlySetterTA) {
                const earlyDeals = projectsRef.current.filter((p) =>
                  (p.repId === earlySetterTA.traineeId || p.setterId === earlySetterTA.traineeId) &&
                  ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)
                ).length;
                const earlyRate = getTrainerOverrideRate(earlySetterTA, earlyDeals);
                const earlyInstPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
                setterM2TrainerDeduction = Math.round(earlyRate * old.kWSize * 1000 * (earlyInstPct / 100) * 100) / 100;
                setterM3TrainerDeduction = Math.round(earlyRate * old.kWSize * 1000 * ((100 - earlyInstPct) / 100) * 100) / 100;
              }
            }

            if (pastInstalled && (effectiveSetterM2 ?? 0) > 0) {
              const hasM2 = prevEntries.some((e) => e.projectId === id && e.repId === newSetterId && e.paymentStage === 'M2');
              if (!hasM2) {
                newEntries.push({
                  id: `pay_${ts}_m2_s`,
                  repId: newSetterId,
                  repName: newSetterRep?.name ?? '',
                  projectId: id,
                  customerName: old.customerName,
                  amount: Math.max(0, (effectiveSetterM2 ?? 0) - setterM2TrainerDeduction),
                  type: 'Deal',
                  paymentStage: 'M2',
                  status: 'Draft',
                  date: getM2PayDate(),
                  notes: 'Setter',
                });
              }
            }

            if (pastPTO) {
              const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const hasM2Entry = prevEntries.some((e) => e.projectId === id && e.paymentStage === 'M2');
              const setterM3 = effectiveSetterM3 != null
                ? effectiveSetterM3
                : installPayPct > 0 && installPayPct < 100 && !old.subDealerId
                  ? Math.round((effectiveSetterM2 ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
                  : 0;
              if (setterM3 > 0 && hasM2Entry) {
                const hasM3 = prevEntries.some((e) => e.projectId === id && e.repId === newSetterId && e.paymentStage === 'M3');
                if (!hasM3) {
                  newEntries.push({
                    id: `pay_${ts}_m3_s`,
                    repId: newSetterId,
                    repName: newSetterRep?.name ?? '',
                    projectId: id,
                    customerName: old.customerName,
                    amount: Math.max(0, setterM3 - setterM3TrainerDeduction),
                    type: 'Deal',
                    paymentStage: 'M3',
                    status: 'Draft',
                    date: getM2PayDate(),
                    notes: 'Setter',
                  });
                }
              }
            }

            // Trainer override entries for the new setter's trainer
            const setterTrainerAssignment = trainerAssignmentsRef.current.find((a) => a.traineeId === newSetterId);
            if (setterTrainerAssignment) {
              const setterTrainerRep = repsRef.current.find((r) => r.id === setterTrainerAssignment.trainerId);
              const setterTraineeDeals = projectsRef.current.filter((p) =>
                (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) &&
                ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)
              ).length;
              const setterOverrideRate = getTrainerOverrideRate(setterTrainerAssignment, setterTraineeDeals);
              const trainerInstallPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const setterName = newSetterRep?.name ?? '';

              if (pastInstalled && !old.subDealerId) {
                const hasTrainerM2 = prevEntries.some((e) =>
                  e.projectId === id &&
                  e.repId === setterTrainerAssignment.trainerId &&
                  e.paymentStage === 'Trainer' &&
                  e.notes?.startsWith('Trainer override M2') &&
                  (setterName ? e.notes?.includes(`— ${setterName} (`) : true)
                );
                if (!hasTrainerM2) {
                  const m2TrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * (trainerInstallPayPct / 100) * 100) / 100;
                  if (m2TrainerAmount > 0) {
                    newEntries.push({
                      id: `pay_${ts}_m2_trainer_s`,
                      repId: setterTrainerAssignment.trainerId,
                      repName: setterTrainerRep?.name ?? '',
                      projectId: id,
                      customerName: old.customerName,
                      amount: m2TrainerAmount,
                      type: 'Deal',
                      paymentStage: 'Trainer',
                      status: 'Draft',
                      date: getM2PayDate(),
                      notes: `Trainer override M2 — ${setterName} ($${setterOverrideRate.toFixed(2)}/W)`,
                    });
                  }
                }
              }

              if (pastPTO && !old.subDealerId) {
                const hasTrainerM3 = prevEntries.some((e) =>
                  e.projectId === id &&
                  e.repId === setterTrainerAssignment.trainerId &&
                  e.paymentStage === 'Trainer' &&
                  e.notes?.startsWith('Trainer override M3') &&
                  (setterName ? e.notes?.includes(`— ${setterName} (`) : true)
                );
                if (!hasTrainerM3) {
                  const m3TrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * ((100 - trainerInstallPayPct) / 100) * 100) / 100;
                  if (m3TrainerAmount > 0) {
                    newEntries.push({
                      id: `pay_${ts}_m3_trainer_s`,
                      repId: setterTrainerAssignment.trainerId,
                      repName: setterTrainerRep?.name ?? '',
                      projectId: id,
                      customerName: old.customerName,
                      amount: m3TrainerAmount,
                      type: 'Deal',
                      paymentStage: 'Trainer',
                      status: 'Draft',
                      date: getM2PayDate(),
                      notes: `Trainer override M3 — ${setterName} ($${setterOverrideRate.toFixed(2)}/W)`,
                    });
                  }
                }
              }
            }

            const validEntries = newEntries.filter((e) => e.amount > 0);
            validEntries.forEach((entry) => persistPayrollEntry(entry));
            return [...baseEntries, ...validEntries];
          });
        }
      }
    }

    // ── 3. Build DB updates ──
    const dbUpdates = mapProjectUpdateToDb(updates);

    // Bundle m3Amount into the same PATCH as the Installed phase transition
    let m3AtInstalled: number | null = null;
    if (old && updates.phase === 'Installed' && old.phase !== 'Installed' && !old.subDealerId) {
      m3AtInstalled = computeM3Amount(old, updates, installerPayConfigs);
      if (m3AtInstalled !== null) dbUpdates.m3Amount = m3AtInstalled;
    }
    // Repair m3Amount / setterM3Amount at PTO
    if (old && updates.phase === 'PTO' && old.phase !== 'PTO') {
      const { closer: repairedM3, setter: repairedSetterM3 } = repairM3AmountAtPTO(old, updates, installerPayConfigs);
      if (repairedM3 !== null) {
        dbUpdates.m3Amount = repairedM3;
        updates.m3Amount = repairedM3;
      }
      if (repairedSetterM3 !== null) {
        dbUpdates.setterM3Amount = repairedSetterM3;
        updates.setterM3Amount = repairedSetterM3;
      }
    }
    // Derive m3 from m2 edits on projects past Installed
    if (old) deriveM3FromM2Edit(updates, old, installerPayConfigs, dbUpdates);

    // Guard: abort the entire transition if m2Amount is missing at Installed
    if (updates.phase === 'Installed' && old && old.phase !== 'Installed' && !old.subDealerId) {
      if ((updates.m2Amount ?? old.m2Amount) == null) {
        emitPersistError(`M2 payroll skipped for ${old.customerName} — m2Amount is missing. Re-save the project to recalculate.`);
        return;
      }
    }

    // Guard: abort the entire transition if m1Amount is missing at Acceptance
    if (updates.phase === 'Acceptance' && old && old.phase !== 'Acceptance' && !old.subDealerId) {
      const effectiveSetterId = updates.setterId ?? old.setterId;
      const effectiveSetterM1 = updates.setterM1Amount ?? old.setterM1Amount;
      if (
        (updates.m1Amount ?? old.m1Amount) == null ||
        (effectiveSetterId != null && effectiveSetterM1 == null)
      ) {
        emitPersistError(`M1 payroll skipped for ${old.customerName} — m1Amount is missing. Re-save the project to recalculate.`);
        return;
      }
    }

    // ── 4. Persist DB changes ──
    if (Object.keys(dbUpdates).length > 0) {
      persistFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdates),
      }, 'Failed to save project changes').catch(() => {});
    }

    // ── 5. Update local project state + phase-transition payroll ──
    setProjects((prev) => {
      const old = prev.find((p) => p.id === id);
      let updated = prev.map((p) => p.id === id ? { ...p, ...updates } : p);

      if (old && updates.phase && updates.phase !== old.phase) {
        const newPhase = updates.phase as Phase;

        // Un-cancelling: remove orphaned chargebacks
        if (old.phase === 'Cancelled' && newPhase !== 'Cancelled') {
          setPayrollEntries((prevEntries) => {
            const orphanIds = getOrphanedChargebackIds(id, prevEntries);
            if (orphanIds.length > 0) deletePayrollEntriesFromDb(orphanIds);
            return prevEntries.filter((e) => !orphanIds.includes(e.id));
          });
        }

        // Cancellation: chargebacks
        if (newPhase === 'Cancelled' && old.phase !== 'Cancelled') {
          setPayrollEntries((prevEntries) => {
            const result = handleChargebacks(id, old, prevEntries);
            if (result.toDeleteIds.length > 0) deletePayrollEntriesFromDb(result.toDeleteIds);
            const remaining = result.toDeleteIds.length > 0
              ? prevEntries.filter((e) => !result.toDeleteIds.includes(e.id))
              : prevEntries;
            result.toAdd.forEach((cb) => persistPayrollEntry(cb));
            return [...remaining, ...result.toAdd];
          });
        }

        // Rollback: delete Draft entries for milestones we rolled past.
        // PMs cannot delete Pending/Paid entries (server returns 403), so only
        // remove entries from client state that the current actor can actually
        // delete — otherwise the optimistic filter causes a permanent desync.
        setPayrollEntries((prevEntries) => {
          const toDelete = handlePhaseRollback(id, old.phase, newPhase, prevEntries);
          const safeToDelete = effectiveRole === 'admin'
            ? toDelete
            : toDelete.filter((delId) => prevEntries.find((e) => e.id === delId)?.status === 'Draft');
          if (safeToDelete.length > 0) {
            deletePayrollEntriesFromDb(safeToDelete);
            return prevEntries.filter((e) => !safeToDelete.includes(e.id));
          }
          return prevEntries;
        });

        const isSubDealerDeal = !!old.subDealerId;
        const isAcceptance = newPhase === 'Acceptance' && old.phase !== 'Acceptance';
        const isInstalled = newPhase === 'Installed' && old.phase !== 'Installed';
        const isPTO = newPhase === 'PTO' && old.phase !== 'PTO';

        // Sub-dealer deals skip M1 payroll entirely
        if ((isAcceptance && !isSubDealerDeal) || isInstalled) {
          const freshProject = updated.find((p) => p.id === id);
          if (!freshProject) return updated;
          const fullAmount = isAcceptance ? old.m1Amount : freshProject.m2Amount;

          // Guard: m2Amount must be present for M2 payroll
          if (isInstalled && fullAmount == null) {
            emitPersistError(`M2 payroll skipped for ${old.customerName} — m2Amount is missing. Re-save the project to recalculate.`);
            return updated;
          }

          const installPayPct = isInstalled
            ? (installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT)
            : 100;

          // Apply computed M3 to local state
          if (isInstalled && m3AtInstalled !== null) {
            updated = updated.map((p) => p.id === id ? { ...p, m3Amount: m3AtInstalled! } : p);
          }

          const m1m2Entries = createMilestonePayroll({
            projectId: id, old, updatedProjects: updated,
            stage: isAcceptance ? 'M1' : 'M2',
            isAcceptance, isInstalled, installPayPct,
            computedM3Amount: m3AtInstalled, deps: transitionDeps,
          }, payrollEntriesRef.current);
          if (m1m2Entries.length > 0) {
            m1m2Entries.forEach((entry) => persistPayrollEntry(entry));
            setPayrollEntries((prevEntries) => [...prevEntries, ...m1m2Entries]);
          }
        }

        // M3: Auto-draft at PTO
        if (isPTO) {
          const m3Entries = createM3Payroll({
            projectId: id, old, updatedProjects: updated, deps: transitionDeps,
          }, payrollEntriesRef.current);
          if (m3Entries.length > 0) {
            m3Entries.forEach((entry) => persistPayrollEntry(entry));
            setPayrollEntries((prevEntries) => [...prevEntries, ...m3Entries]);
          }
        }
      }

      return updated;
    });

    // ── 6. Amount sync: patch Draft/Pending entries when amounts are edited ──
    const hasAmountUpdates = updates.m1Amount !== undefined || updates.m2Amount !== undefined
      || updates.m3Amount !== undefined || updates.setterM1Amount !== undefined
      || updates.setterM2Amount !== undefined || updates.setterM3Amount !== undefined;
    if (hasAmountUpdates) {
      // Re-compute closer M2 trainer deduction so syncPayrollAmounts subtracts it,
      // mirroring the deduction applied at createMilestonePayroll time (line 309).
      const updatedProjects = projects.map((p) => p.id === id ? { ...p, ...updates } : p);
      let closerM2TrainerDeduction = 0;
      if (updates.m2Amount !== undefined && old) {
        const cta = trainerAssignmentsRef.current.find((a) => a.traineeId === old.repId);
        if (cta) {
          const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
          const ctDeals = updatedProjects.filter((p) =>
            (p.repId === cta.traineeId || p.setterId === cta.traineeId) &&
            ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100
              ? p.m3Paid === true : p.m2Paid === true)
          ).length;
          closerM2TrainerDeduction = Math.round(getTrainerOverrideRate(cta, ctDeals) * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
        }
      }
      // Re-compute closer M3 trainer deduction, mirroring createM3Payroll's deduction logic.
      let closerM3TrainerDeduction = 0;
      if (updates.m3Amount !== undefined && old) {
        const cta = trainerAssignmentsRef.current.find((a) => a.traineeId === old.repId);
        if (cta) {
          const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
          if (installPayPct < 100) {
            const ctDeals = updatedProjects.filter((p) =>
              (p.repId === cta.traineeId || p.setterId === cta.traineeId) &&
              ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100
                ? p.m3Paid === true : p.m2Paid === true)
            ).length;
            closerM3TrainerDeduction = Math.round(getTrainerOverrideRate(cta, ctDeals) * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
          }
        }
      }
      // Re-compute setter M2 trainer deduction, mirroring createMilestonePayroll's deduction logic.
      let setterM2TrainerDeduction = 0;
      if (updates.setterM2Amount !== undefined && old && old.setterId) {
        const sta = trainerAssignmentsRef.current.find((a) => a.traineeId === old.setterId);
        if (sta) {
          const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
          const stDeals = updatedProjects.filter((p) =>
            (p.repId === sta.traineeId || p.setterId === sta.traineeId) &&
            ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100
              ? p.m3Paid === true : p.m2Paid === true)
          ).length;
          setterM2TrainerDeduction = Math.round(getTrainerOverrideRate(sta, stDeals) * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
        }
      }
      // Re-compute setter M3 trainer deduction, mirroring createM3Payroll's deduction logic.
      let setterM3TrainerDeduction = 0;
      if (updates.setterM3Amount !== undefined && old && old.setterId) {
        const sta = trainerAssignmentsRef.current.find((a) => a.traineeId === old.setterId);
        if (sta) {
          const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
          if (installPayPct < 100) {
            const stDeals = updatedProjects.filter((p) =>
              (p.repId === sta.traineeId || p.setterId === sta.traineeId) &&
              ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100
                ? p.m3Paid === true : p.m2Paid === true)
            ).length;
            setterM3TrainerDeduction = Math.round(getTrainerOverrideRate(sta, stDeals) * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
          }
        }
      }
      const effectiveKWSize = old ? (updates.kWSize ?? old.kWSize) : 0;
      const effectiveInstallPayPct = old ? (installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) : 100;
      const pendingPatches: Array<{ id: string; newAmount: number }> = [];
      setPayrollEntries((prev) => {
        const result = syncPayrollAmounts(id, updates, prev, closerM2TrainerDeduction, closerM3TrainerDeduction, effectiveKWSize, effectiveInstallPayPct, setterM2TrainerDeduction, setterM3TrainerDeduction);
        pendingPatches.push(...result.patches);
        return result.patches.length > 0 ? result.updatedEntries : prev;
      });
      // pendingPatches is populated synchronously by the updater above in React's
      // batching model. Persist each patch to DB.
      // Skip entries with temp client IDs (pay_${ts}_...) — they were created in
      // this same updateProject call and don't have a real DB row yet. Their amount
      // is already correct in the POST body, so no PATCH is needed.
      for (const { id: entryId, newAmount } of pendingPatches) {
        if (entryId.startsWith('pay_')) continue;
        persistFetch(`/api/payroll/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: newAmount }),
        }, 'Failed to update payroll entry amount').catch(() => {});
      }
    }
  };

  // Remaining installer actions destructured from installerActions (defined above)
  const {
    updateInstallerBaseline, addInstallerBaseline,
    addInstallerPricingVersion, updateInstallerPricingVersion, createNewInstallerVersion,
    updateSolarTechProduct, updateSolarTechTier,
    addProductCatalogInstaller, updateProductCatalogInstallerConfig,
    addProductCatalogProduct, updateProductCatalogProduct,
    updateProductCatalogTier, removeProductCatalogProduct,
    addProductCatalogPricingVersion, updateProductCatalogPricingVersion,
    createNewProductCatalogVersion, deleteProductCatalogPricingVersions,
    addInstallerPrepaidOption, updateInstallerPrepaidOption, removeInstallerPrepaidOption,
    updateInstallerPayConfig, deleteInstaller, deleteFinancer,
  } = installerActions;
  const getInstallerPrepaidOptions = (installer: string) => installerPrepaidOptions[installer] ?? [];

  const setRole = (role: Role, repId?: string, repName?: string, pmPerms?: { canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean }) => {
    setCurrentRole(role);
    setCurrentRepId(repId ?? null);
    setCurrentRepName(repName ?? null);
    setPmPermissions(role === 'project_manager' && pmPerms ? pmPerms : null);
    if (role) localStorage.setItem('kilo-role', role);
    else localStorage.removeItem('kilo-role');
    if (repId) localStorage.setItem('kilo-rep-id', repId);
    else localStorage.removeItem('kilo-rep-id');
    if (repName) localStorage.setItem('kilo-rep-name', repName);
    else localStorage.removeItem('kilo-rep-name');
  };

  const logout = () => {
    setCurrentRole(null);
    setCurrentRepId(null);
    setCurrentRepName(null);
    setViewAsUserState(null);
    setPmPermissions(null);
    localStorage.removeItem('kilo-role');
    localStorage.removeItem('kilo-rep-id');
    localStorage.removeItem('kilo-rep-name');
  };

  const addDeal = (
    project: Project,
    _closerM1: number,
    _closerM2: number,
    _setterM1 = 0,
    _setterM2 = 0,
    _trainerM1 = 0,
    _trainerM2 = 0,
    _trainerId?: string,
  ) => {
    // Validate installer mapping before mutating local state to avoid split-brain
    const installerId = idMaps.installerNameToId[project.installer];
    if (!installerId) {
      console.error('[addDeal] Cannot persist: missing installer ID mapping', { installer: project.installer });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save deal — installer not yet saved. Please refresh and try again.' }));
      }
      return false;
    }

    // Validate financer mapping before mutating local state to avoid split-brain.
    // Cash deals can proceed without a financer ID — the server resolves it via upsert.
    const financerId = idMaps.financerNameToId[project.financer] ?? '';
    const isCashDeal = project.productType === 'Cash' || project.financer === 'Cash';
    if (!financerId && !isCashDeal) {
      console.error('[addDeal] Cannot persist: missing financer ID mapping', { financer: project.financer });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save deal — financer not found. Please refresh and try again.' }));
      }
      return false;
    }

    // Only add the project. Payroll entries are now auto-drafted when
    // milestone phases are reached (Acceptance → M1, Installed → M2).
    // Trainer override entries are auto-drafted at M2 (80%) and M3 (20%).
    setProjects((prev) => [...prev, project]);

    // Persist to DB
    const persistProject = (fId: string) => {
      fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: project.customerName,
          closerId: project.repId,
          setterId: project.setterId || null,
          soldDate: project.soldDate,
          installerId,
          financerId: fId,
          productType: project.productType,
          kWSize: project.kWSize,
          netPPW: project.netPPW,
          phase: project.phase || 'New',
          m1Amount: project.m1Amount || 0,
          m2Amount: project.m2Amount || 0,
          m3Amount: project.m3Amount || 0,
          setterM1Amount: project.setterM1Amount || 0,
          setterM2Amount: project.setterM2Amount || 0,
          setterM3Amount: project.setterM3Amount || 0,
          notes: project.notes || '',
          installerPricingVersionId: project.pricingVersionId || null,
          productId: project.solarTechProductId || project.installerProductId || null,
          productPricingVersionId: project.pcPricingVersionId || null,
          prepaidSubType: project.prepaidSubType || null,
          leadSource: project.leadSource || null,
          blitzId: project.blitzId || null,
          subDealerId: project.subDealerId || null,
        }),
      }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }).then((created) => {
        // Update local state with the DB-assigned id
        const dbId = created.id && created.id !== project.id ? created.id : project.id;
        if (created.id && created.id !== project.id) {
          setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, id: created.id } : p));
        }
        // Log creation activity only after the project exists in the DB, using the real DB id
        logProjectActivity(dbId, 'created', 'Project created');
      }).catch((err) => {
        console.error('[addDeal] persist failed:', err);
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save new deal' }));
        }
      });
    };

    // Cash deals: server auto-resolves the financer via upsert, so pass empty string
    persistProject(financerId || '');
    return true;
  };

  // markForPayroll delegated to payrollActions (defined above)
  const { markForPayroll } = payrollActions;

  return (
    <AppContext.Provider
      value={{
        dbReady,
        dataError,
        currentRole,
        currentRepId,
        currentRepName,
        setRole,
        logout,
        projects,
        setProjects,
        payrollEntries,
        setPayrollEntries,
        reimbursements,
        setReimbursements,
        trainerAssignments,
        setTrainerAssignments,
        incentives,
        setIncentives,
        addDeal,
        markForPayroll,
        persistPayrollEntry,
        installers,
        financers,
        activeInstallers,
        activeFinancers,
        setInstallerActive,
        setFinancerActive,
        addInstaller,
        addFinancer,
        reps,
        addRep,
        removeRep,
        deactivateRep,
        reactivateRep,
        deleteRepPermanently,
        updateRepType,
        updateRepContact,
        updateProject,
        installerBaselines,
        updateInstallerBaseline,
        addInstallerBaseline,
        installerPricingVersions,
        addInstallerPricingVersion,
        updateInstallerPricingVersion,
        createNewInstallerVersion,
        solarTechProducts,
        updateSolarTechProduct,
        updateSolarTechTier,
        productCatalogInstallerConfigs,
        productCatalogProducts,
        addProductCatalogInstaller,
        updateProductCatalogInstallerConfig,
        addProductCatalogProduct,
        updateProductCatalogProduct,
        updateProductCatalogTier,
        removeProductCatalogProduct,
        productCatalogPricingVersions,
        addProductCatalogPricingVersion,
        updateProductCatalogPricingVersion,
        createNewProductCatalogVersion,
        deleteProductCatalogPricingVersions,
        deleteInstaller,
        deleteFinancer,
        installerPrepaidOptions,
        getInstallerPrepaidOptions,
        addInstallerPrepaidOption,
        updateInstallerPrepaidOption,
        removeInstallerPrepaidOption,
        installerPayConfigs,
        setInstallerPayConfigs,
        updateInstallerPayConfig,
        subDealers,
        addSubDealer,
        removeSubDealer,
        deactivateSubDealer,
        reactivateSubDealer,
        deleteSubDealerPermanently,
        updateSubDealerContact,
        unreadMentionCount,
        refreshMentionCount,
        viewAsUser,
        setViewAsUser,
        clearViewAs,
        isViewingAs,
        effectiveRole,
        effectiveRepId,
        effectiveRepName,
        pmPermissions,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
