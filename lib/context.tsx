'use client';

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, ReactNode } from 'react';
import { PROJECTS, PAYROLL_ENTRIES, REIMBURSEMENTS, TRAINER_ASSIGNMENTS, INCENTIVES, INSTALLERS, FINANCERS, Project, PayrollEntry, Reimbursement, TrainerAssignment, Incentive, getTrainerOverrideRate, REPS, Rep, SubDealer, SUB_DEALERS, NON_SOLARTECH_BASELINES, SOLARTECH_PRODUCTS, InstallerBaseline, SolarTechProduct, INSTALLER_PRICING_VERSIONS, InstallerPricingVersion, InstallerRates, PRODUCT_CATALOG_INSTALLER_CONFIGS, PRODUCT_CATALOG_PRODUCTS, ProductCatalogInstallerConfig, ProductCatalogProduct, PREPAID_OPTIONS, Phase, PRODUCT_CATALOG_PRICING_VERSIONS, ProductCatalogPricingVersion, ProductCatalogTier, INSTALLER_PAY_CONFIGS, InstallerPayConfig, DEFAULT_INSTALL_PAY_PCT } from './data';
import { getM1PayDate, getM2PayDate } from './utils';
import { persistFetch } from './persist';

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
  addDeal: (project: Project, closerM1: number, closerM2: number, setterM1?: number, setterM2?: number, trainerM1?: number, trainerM2?: number, trainerId?: string) => void;
  // Marks individual payroll entries as Pending
  markForPayroll: (entryIds: string[]) => void;
  // Installer / financer management
  installers: ManagedItem[];
  financers: ManagedItem[];
  activeInstallers: string[];
  activeFinancers: string[];
  setInstallerActive: (name: string, active: boolean) => void;
  setFinancerActive: (name: string, active: boolean) => void;
  addInstaller: (name: string) => void;
  addFinancer: (name: string) => void;
  // Rep management
  reps: Rep[];
  addRep: (firstName: string, lastName: string, email: string, phone: string, repType?: 'closer' | 'setter' | 'both', id?: string) => Promise<{ id: string } | undefined>;
  removeRep: (id: string) => void;
  updateRepType: (id: string, repType: 'closer' | 'setter' | 'both') => void;
  // Sub-dealer management
  subDealers: SubDealer[];
  addSubDealer: (firstName: string, lastName: string, email: string, phone: string, id?: string) => void;
  removeSubDealer: (id: string) => void;
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
  removeProductCatalogProduct: (id: string) => void;
  // Product Catalog pricing versions
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  addProductCatalogPricingVersion: (version: ProductCatalogPricingVersion) => void;
  updateProductCatalogPricingVersion: (id: string, updates: Partial<ProductCatalogPricingVersion>) => void;
  createNewProductCatalogVersion: (productId: string, label: string, effectiveFrom: string, tiers: ProductCatalogTier[]) => void;
  deleteProductCatalogPricingVersions: (versionIds: string[]) => void;
  deleteInstaller: (name: string) => void;
  deleteFinancer: (name: string) => void;
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
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>(REIMBURSEMENTS);
  const [trainerAssignments, setTrainerAssignments] = useState<TrainerAssignment[]>(TRAINER_ASSIGNMENTS);
  const [incentives, setIncentives] = useState<Incentive[]>(INCENTIVES);
  const [installers, setInstallers] = useState<ManagedItem[]>(INSTALLERS.map((name) => ({ name, active: true })));
  const [financers, setFinancers] = useState<ManagedItem[]>(FINANCERS.map((name) => ({ name, active: true })));
  const [reps, setReps] = useState<Rep[]>(REPS.map((r) => ({ ...r })));
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
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setReps(data.reps ?? []);
        setSubDealers(data.subDealers ?? []);
        setInstallers((data.installers ?? []).map((i: string) => ({ name: i, active: true })));
        setFinancers((data.financers ?? []).map((f: string) => ({ name: f, active: true })));
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
    if (!currentRepId) { setUnreadMentionCount(0); return; }
    fetch(`/api/mentions?userId=${encodeURIComponent(currentRepId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setUnreadMentionCount(data.length);
      })
      .catch(() => {});
  }, [currentRepId]);

  useEffect(() => {
    if (dbReady && currentRepId) refreshMentionCount();
  }, [dbReady, currentRepId, refreshMentionCount]);

  // Helper: persist a payroll entry to the DB and sync the DB-assigned id back to local state
  const persistPayrollEntry = useCallback((entry: PayrollEntry) => {
    const clientId = entry.id;
    fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repId: entry.repId,
        projectId: entry.projectId,
        amount: entry.amount,
        type: entry.type,
        paymentStage: entry.paymentStage,
        status: entry.status,
        date: entry.date,
        notes: entry.notes,
      }),
    })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((saved) => {
        if (saved?.id && saved.id !== clientId) {
          setPayrollEntries((prev) =>
            prev.map((e) => (e.id === clientId ? { ...e, id: saved.id } : e))
          );
        }
      })
      .catch(() => {
        window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save payroll entry' }));
      });
  }, [setPayrollEntries]);

  // Helper: delete payroll entries from DB by filter
  const deletePayrollEntriesFromDb = useCallback((ids: string[]) => {
    for (const id of ids) {
      persistFetch(`/api/payroll/${id}`, { method: 'DELETE' }, 'Failed to delete payroll entry').catch(() => {});
    }
  }, []);

  // installerBaselines is derived from the currently active pricing version per installer
  // (flat rate only — tiered installers show the first band for backward compat display)
  const installerBaselines = useMemo<Record<string, InstallerBaseline>>(() => {
    const today = new Date().toISOString().split('T')[0];
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
      // For tiered installers, use the first band for backward-compat display
      const flatRates = rates.type === 'tiered' ? rates.bands[0] : rates;
      if (!flatRates) continue;
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
  const setInstallerActive = (name: string, active: boolean) => {
    setInstallers((prev) => prev.map((i) => i.name === name ? { ...i, active } : i));
    const instId = idMaps.installerNameToId[name];
    if (instId) {
      persistFetch(`/api/installers/${instId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      }, 'Failed to update installer status').catch(() => {});
    }
  };
  const setFinancerActive = (name: string, active: boolean) => {
    setFinancers((prev) => prev.map((f) => f.name === name ? { ...f, active } : f));
    const finId = idMaps.financerNameToId[name];
    if (finId) {
      persistFetch(`/api/financers/${finId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      }, 'Failed to update financer status').catch(() => {});
    }
  };
  const addInstaller = (name: string) => {
    setInstallers((prev) => prev.find((i) => i.name === name) ? prev : [...prev, { name, active: true }]);
    // Ensure a baseline pricing version exists for the new installer
    setInstallerPricingVersions((prev) => {
      if (prev.some((v) => v.installer === name)) return prev;
      return [...prev, {
        id: `ipv_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        installer: name,
        label: 'v1',
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
        rates: { type: 'flat' as const, closerPerW: 2.90, kiloPerW: 2.35 },
      }];
    });
    // Persist to DB
    fetch('/api/installers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((res) => res.json()).then((created) => {
      if (created.id) {
        setIdMaps((prev) => ({
          ...prev,
          installerNameToId: { ...prev.installerNameToId, [name]: created.id as string },
        }));
      }
      if (created.pricingVersionId) {
        setInstallerPricingVersions((prev) =>
          prev.map((v) => v.installer === name && v.id.startsWith('ipv_')
            ? { ...v, id: created.pricingVersionId as string }
            : v,
          ),
        );
      }
    }).catch(console.error);
  };
  const addFinancer = (name: string) => {
    setFinancers((prev) => prev.find((f) => f.name === name) ? prev : [...prev, { name, active: true }]);
    fetch('/api/financers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((res) => res.json()).then((created) => {
      if (created.id) {
        setIdMaps((prev) => ({
          ...prev,
          financerNameToId: { ...prev.financerNameToId, [name]: created.id as string },
        }));
      }
    }).catch(console.error);
  };
  const addRep = (firstName: string, lastName: string, email: string, phone: string, repType: 'closer' | 'setter' | 'both' = 'both', id?: string) => {
    const tempId = id ?? `rep_${Date.now()}`;
    setReps((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), phone: phone.trim(), role: 'rep' as const, repType }]);
    // Persist and update with real DB id
    return persistFetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, repType }),
    }, 'Failed to save new rep').then((res) => res.json()).then((rep) => {
      if (rep.id && rep.id !== tempId) {
        setReps((prev) => prev.map((r) => r.id === tempId ? { ...r, id: rep.id } : r));
      }
      return rep as { id: string };
    }).catch(() => undefined);
  };
  const removeRep = (id: string) => {
    setReps((prev) => prev.filter((r) => r.id !== id));
    persistFetch(`/api/reps/${id}`, { method: 'DELETE' }, 'Failed to remove rep').catch(() => {});
  };
  const updateRepType = (id: string, repType: 'closer' | 'setter' | 'both') => {
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, repType } : r));
    persistFetch(`/api/reps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repType }),
    }, 'Failed to update rep type').catch(() => {});
  };

  // ── Sub-dealer management ──
  const addSubDealer = (firstName: string, lastName: string, email: string, phone: string, id?: string) => {
    const tempId = id ?? `sd_${Date.now()}`;
    const name = `${firstName.trim()} ${lastName.trim()}`;
    setSubDealers((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name, email: email.trim(), phone: phone.trim(), role: 'sub-dealer' as const }]);
    persistFetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, role: 'sub-dealer' }),
    }, 'Failed to save new sub-dealer').then((res) => res.json()).then((sd) => {
      if (sd.id && sd.id !== tempId) {
        setSubDealers((prev) => prev.map((s) => s.id === tempId ? { ...s, id: sd.id } : s));
      }
    }).catch(() => undefined);
  };
  const removeSubDealer = (id: string) => {
    setSubDealers((prev) => prev.filter((sd) => sd.id !== id));
    persistFetch(`/api/reps/${id}`, { method: 'DELETE' }, 'Failed to remove sub-dealer').catch(() => {});
  };

  // ── Activity logging helper (fire-and-forget) ──
  const logProjectActivity = (projectId: string, type: string, detail: string, meta?: string) => {
    fetch(`/api/projects/${projectId}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, detail, meta }),
    }).catch(console.error);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    // ── Log activity for significant changes ──
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
      // Field edits
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
      if (updates.setterId !== undefined && updates.setterId !== old.setterId) {
        const oldSetter = old.setterId ? reps.find((r) => r.id === old.setterId)?.name ?? old.setterId : 'none';
        const newSetter = updates.setterId ? reps.find((r) => r.id === updates.setterId)?.name ?? updates.setterId : 'none';
        logProjectActivity(id, 'setter_assigned', `Setter changed from ${oldSetter} to ${newSetter}`, JSON.stringify({ oldSetterId: old.setterId, newSetterId: updates.setterId }));
      }
    }

    // Persist to DB (fire and forget — local state is source of truth for UI)
    const dbUpdates: Record<string, unknown> = {};
    if (updates.phase !== undefined) dbUpdates.phase = updates.phase;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.flagged !== undefined) dbUpdates.flagged = updates.flagged;
    if (updates.m1Paid !== undefined) dbUpdates.m1Paid = updates.m1Paid;
    if (updates.m1Amount !== undefined) dbUpdates.m1Amount = updates.m1Amount;
    if (updates.m2Paid !== undefined) dbUpdates.m2Paid = updates.m2Paid;
    if (updates.m2Amount !== undefined) dbUpdates.m2Amount = updates.m2Amount;
    if (updates.m3Paid !== undefined) dbUpdates.m3Paid = updates.m3Paid;
    if (updates.m3Amount !== undefined) dbUpdates.m3Amount = updates.m3Amount;
    if (updates.installer !== undefined) dbUpdates.installer = updates.installer;
    if (updates.financer !== undefined) dbUpdates.financer = updates.financer;
    if (updates.productType !== undefined) dbUpdates.productType = updates.productType;
    if (updates.kWSize !== undefined) dbUpdates.kWSize = updates.kWSize;
    if (updates.netPPW !== undefined) dbUpdates.netPPW = updates.netPPW;
    if (updates.setterId !== undefined) dbUpdates.setterId = updates.setterId;
    if (updates.soldDate !== undefined) dbUpdates.soldDate = updates.soldDate;
    if (updates.baselineOverride !== undefined) dbUpdates.baselineOverrideJson = updates.baselineOverride ? JSON.stringify(updates.baselineOverride) : null;
    if (Object.keys(dbUpdates).length > 0) {
      persistFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdates),
      }, 'Failed to save project changes').catch(() => {});
    }

    setProjects((prev) => {
      const old = prev.find((p) => p.id === id);
      let updated = prev.map((p) => p.id === id ? { ...p, ...updates } : p);

      // Auto-draft payroll entries on milestone phase transitions
      if (old && updates.phase && updates.phase !== old.phase) {
        const newPhase = updates.phase as Phase;

        // ── ORPHANED CHARGEBACKS: When un-cancelling, remove chargeback (negative) entries ──
        if (old.phase === 'Cancelled' && newPhase !== 'Cancelled') {
          setPayrollEntries((prevEntries) => {
            const toRemove = prevEntries.filter((e) => e.projectId === id && e.amount < 0);
            if (toRemove.length > 0) deletePayrollEntriesFromDb(toRemove.map((e) => e.id));
            return prevEntries.filter((e) => !(e.projectId === id && e.amount < 0));
          });
        }

        // ── CHARGEBACK: When cancelled, create negative entries for any M1/M2/M3 already in payroll ──
        if (newPhase === 'Cancelled' && old.phase !== 'Cancelled') {
          setPayrollEntries((prevEntries) => {
            // Remove Draft/Pending entries immediately — they must never be published for a cancelled deal
            const draftOrPendingEntries = prevEntries.filter(
              (e) => e.projectId === id && e.amount > 0 && e.type === 'Deal' && (e.status === 'Draft' || e.status === 'Pending')
            );
            if (draftOrPendingEntries.length > 0) {
              deletePayrollEntriesFromDb(draftOrPendingEntries.map((e) => e.id));
            }
            const remaining = draftOrPendingEntries.length > 0
              ? prevEntries.filter((e) => !draftOrPendingEntries.includes(e))
              : prevEntries;

            const paidEntries = remaining.filter(
              (e) => e.projectId === id && e.amount > 0 && e.type === 'Deal' && e.status === 'Paid'
            );
            // Already has a chargeback? Don't double-charge
            const hasChargeback = remaining.some(
              (e) => e.projectId === id && e.type === 'Deal' && e.amount < 0
            );
            if (paidEntries.length === 0 || hasChargeback) return remaining;

            const ts = Date.now();
            const chargebacks: PayrollEntry[] = paidEntries.map((e, i) => ({
              id: `pay_${ts}_chargeback_${i}`,
              repId: e.repId,
              repName: e.repName,
              projectId: id,
              customerName: old.customerName,
              amount: -e.amount,
              type: 'Deal' as const,
              paymentStage: e.paymentStage,
              status: 'Draft' as const,
              date: e.date,
              notes: 'Chargeback — project cancelled',
            }));
            // Persist chargebacks to DB
            chargebacks.forEach((cb) => persistPayrollEntry(cb));
            return [...remaining, ...chargebacks];
          });
        }

        // ── ROLLBACK: When phase moves backward past a milestone, delete orphaned Draft entries ──
        const PIPELINE = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];
        const oldIdx = PIPELINE.indexOf(old.phase);
        const newIdx = PIPELINE.indexOf(newPhase);
        if (oldIdx >= 0 && newIdx >= 0 && newIdx < oldIdx) {
          const rollBackM1 = oldIdx >= PIPELINE.indexOf('Acceptance') && newIdx < PIPELINE.indexOf('Acceptance');
          const rollBackM2 = oldIdx >= PIPELINE.indexOf('Installed') && newIdx < PIPELINE.indexOf('Installed');
          const rollBackM3 = oldIdx >= PIPELINE.indexOf('PTO') && newIdx < PIPELINE.indexOf('PTO');
          if (rollBackM1 || rollBackM2 || rollBackM3) {
            setPayrollEntries((prevEntries) => {
              const toDelete = prevEntries.filter((e) => {
                if (e.projectId !== id || e.status !== 'Draft') return false;
                if (rollBackM1 && e.paymentStage === 'M1') return true;
                if (rollBackM2 && (e.paymentStage === 'M2' || (e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2')))) return true;
                if (rollBackM3 && (e.paymentStage === 'M3' || (e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M3')))) return true;
                return false;
              });
              if (toDelete.length > 0) {
                deletePayrollEntriesFromDb(toDelete.map((e) => e.id));
                return prevEntries.filter((e) => !toDelete.includes(e));
              }
              return prevEntries;
            });
          }
        }

        const isSubDealerDeal = !!old.subDealerId;
        const isAcceptance = newPhase === 'Acceptance' && old.phase !== 'Acceptance';
        const isInstalled = newPhase === 'Installed' && old.phase !== 'Installed';
        const isPTO = newPhase === 'PTO' && old.phase !== 'PTO';

        // Sub-dealer deals skip M1 payroll entirely — only M2 at Installed and M3 at PTO
        if ((isAcceptance && !isSubDealerDeal) || isInstalled) {
          const stage: 'M1' | 'M2' = isAcceptance ? 'M1' : 'M2';
          const payDate = isAcceptance ? getM1PayDate() : getM2PayDate();
          const fullAmount = isAcceptance ? old.m1Amount : old.m2Amount;

          // For M2, m2Amount is already stored as the post-split value
          // (closerM2Full * installPayPct/100) — use it directly, no re-apply needed
          const installPayPct = isInstalled
            ? (installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT)
            : 100;
          const amount = fullAmount;

          // If installer doesn't pay 100% at install, store M3 remainder on the project
          // m3 = closerM2Full * (100-pct)/100 = m2Amount * (100-pct)/pct
          if (isInstalled && installPayPct < 100) {
            const m3 = installPayPct > 0
              ? Math.round(fullAmount * ((100 - installPayPct) / installPayPct) * 100) / 100
              : 0;
            updated = updated.map((p) => p.id === id ? { ...p, m3Amount: m3 } : p);
            // Persist m3Amount to DB
            persistFetch(`/api/projects/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ m3Amount: m3 }),
            }, 'Failed to save M3 amount').catch(() => {});
          }

          const ts = Date.now();

          // Check if entries already exist for this project + stage to avoid duplicates
          setPayrollEntries((prevEntries) => {
            const alreadyExists = prevEntries.some(
              (e) => e.projectId === id && e.paymentStage === stage
            );
            if (alreadyExists) return prevEntries;

            const newEntries: PayrollEntry[] = [];
            const closerRep = reps.find((r) => r.id === old.repId);

            // Closer entry
            // NOTE: For M2, only the closer's m2Amount is stored on the project.
            // Setter M2 and Trainer M2 amounts are NOT stored — this is a data model
            // limitation. Setter/trainer M2 payroll entries cannot be auto-drafted
            // until the project schema carries those amounts (setterM2Amount, trainerM2Amount).
            if (amount > 0) {
              newEntries.push({
                id: `pay_${ts}_${stage.toLowerCase()}_c`,
                repId: old.repId,
                repName: closerRep?.name ?? old.repName,
                projectId: id,
                customerName: old.customerName,
                amount: isAcceptance
                  ? (old.setterId ? 0 : amount)  // M1 goes to setter if there is one, else closer
                  : amount,                        // M2 always to closer
                type: 'Deal',
                paymentStage: stage,
                status: 'Draft',
                date: payDate,
                notes: '',
              });
            }

            // Setter entry (M1 goes to setter if one exists)
            if (old.setterId && isAcceptance && amount > 0) {
              const setterRep = reps.find((r) => r.id === old.setterId);
              newEntries.push({
                id: `pay_${ts}_${stage.toLowerCase()}_s`,
                repId: old.setterId,
                repName: setterRep?.name ?? old.setterName ?? '',
                projectId: id,
                customerName: old.customerName,
                amount,
                type: 'Deal',
                paymentStage: stage,
                status: 'Draft',
                date: payDate,
                notes: 'Setter',
              });
            }

            // ── Trainer override M2 entries (installPayPct% of override at Installed) ──
            if (isInstalled) {
              // Closer's trainer
              const closerTrainerAssignment = trainerAssignments.find(a => a.traineeId === old.repId);
              if (closerTrainerAssignment) {
                const trainerRep = reps.find(r => r.id === closerTrainerAssignment.trainerId);
                const traineeDeals = updated.filter(p => p.id !== id && (p.repId === closerTrainerAssignment.traineeId || p.setterId === closerTrainerAssignment.traineeId) && (p.phase === 'Installed' || p.phase === 'PTO' || p.phase === 'Completed')).length;
                const overrideRate = getTrainerOverrideRate(closerTrainerAssignment, traineeDeals);
                const m2TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * (installPayPct / 100));
                if (m2TrainerAmount > 0) {
                  newEntries.push({
                    id: `pay_${ts}_m2_trainer_c`,
                    repId: closerTrainerAssignment.trainerId,
                    repName: trainerRep?.name ?? '',
                    projectId: id,
                    customerName: old.customerName,
                    amount: m2TrainerAmount,
                    type: 'Deal',
                    paymentStage: 'Trainer',
                    status: 'Draft',
                    date: payDate,
                    notes: `Trainer override M2 — ${closerRep?.name ?? old.repName} ($${overrideRate.toFixed(2)}/W)`,
                  });
                }
              }

              // Setter's trainer
              if (old.setterId) {
                const setterTrainerAssignment = trainerAssignments.find(a => a.traineeId === old.setterId);
                if (setterTrainerAssignment) {
                  const setterTrainerRep = reps.find(r => r.id === setterTrainerAssignment.trainerId);
                  const setterTraineeDeals = updated.filter(p => p.id !== id && (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) && (p.phase === 'Installed' || p.phase === 'PTO' || p.phase === 'Completed')).length;
                  const setterOverrideRate = getTrainerOverrideRate(setterTrainerAssignment, setterTraineeDeals);
                  const m2SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * (installPayPct / 100));
                  if (m2SetterTrainerAmount > 0) {
                    const setterRep = reps.find(r => r.id === old.setterId);
                    newEntries.push({
                      id: `pay_${ts}_m2_trainer_s`,
                      repId: setterTrainerAssignment.trainerId,
                      repName: setterTrainerRep?.name ?? '',
                      projectId: id,
                      customerName: old.customerName,
                      amount: m2SetterTrainerAmount,
                      type: 'Deal',
                      paymentStage: 'Trainer',
                      status: 'Draft',
                      date: payDate,
                      notes: `Trainer override M2 — ${setterRep?.name ?? old.setterName ?? ''} ($${setterOverrideRate.toFixed(2)}/W)`,
                    });
                  }
                }
              }
            }

            const validEntries = newEntries.filter((e) => e.amount > 0);
            // Persist M1/M2 entries to DB
            validEntries.forEach((entry) => persistPayrollEntry(entry));
            return [...prevEntries, ...validEntries];
          });
        }

        // ── M3: Auto-draft at PTO for installers that don't pay 100% at install ──
        if (isPTO) {
          const proj = updated.find((p) => p.id === id);
          // Guard against m3Amount being null in DB due to a failed persist at Installed time.
          // If missing, recalculate from the same formula used at the Installed transition.
          const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
          const m3 = (proj?.m3Amount ?? 0) > 0
            ? proj!.m3Amount!
            : installPayPct < 100
              ? Math.round(old.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100
              : 0;
          const ts = Date.now();
          const payDate = getM2PayDate(); // M3 follows the same Saturday cutoff as M2
          setPayrollEntries((prevEntries) => {
              const alreadyExists = prevEntries.some(
                (e) => e.projectId === id && (e.paymentStage === 'M3' || (e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M3')))
              );
              if (alreadyExists) return prevEntries;

              const newEntries: PayrollEntry[] = [];
              const closerRep = reps.find((r) => r.id === old.repId);

              // Closer M3 entry
              newEntries.push({
                id: `pay_${ts}_m3_c`,
                repId: old.repId,
                repName: closerRep?.name ?? old.repName,
                projectId: id,
                customerName: old.customerName,
                amount: m3,
                type: 'Deal',
                paymentStage: 'M3',
                status: 'Draft',
                date: payDate,
                notes: '',
              });

              // ── Trainer override M3 entries ((100 - installPayPct)% of override at PTO) ──
              // Closer's trainer
              const closerTrainerAssignment = trainerAssignments.find(a => a.traineeId === old.repId);
              if (closerTrainerAssignment && m3 > 0) {
                const trainerRep = reps.find(r => r.id === closerTrainerAssignment.trainerId);
                const traineeDeals = updated.filter(p => p.id !== id && (p.repId === closerTrainerAssignment.traineeId || p.setterId === closerTrainerAssignment.traineeId) && (p.phase === 'Installed' || p.phase === 'PTO' || p.phase === 'Completed')).length;
                const overrideRate = getTrainerOverrideRate(closerTrainerAssignment, traineeDeals);
                const m3TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100));
                if (m3TrainerAmount > 0) {
                  const closerRep = reps.find(r => r.id === old.repId);
                  newEntries.push({
                    id: `pay_${ts}_m3_trainer_c`,
                    repId: closerTrainerAssignment.trainerId,
                    repName: trainerRep?.name ?? '',
                    projectId: id,
                    customerName: old.customerName,
                    amount: m3TrainerAmount,
                    type: 'Deal',
                    paymentStage: 'Trainer',
                    status: 'Draft',
                    date: payDate,
                    notes: `Trainer override M3 — ${trainerRep?.name ?? ''}`,
                  });
                }
              }

              // Setter's trainer
              if (old.setterId) {
                const setterTrainerAssignment = trainerAssignments.find(a => a.traineeId === old.setterId);
                if (setterTrainerAssignment && m3 > 0) {
                  const setterTrainerRep = reps.find(r => r.id === setterTrainerAssignment.trainerId);
                  const setterTraineeDeals = updated.filter(p => p.id !== id && (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) && (p.phase === 'Installed' || p.phase === 'PTO' || p.phase === 'Completed')).length;
                  const setterOverrideRate = getTrainerOverrideRate(setterTrainerAssignment, setterTraineeDeals);
                  const m3SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100));
                  if (m3SetterTrainerAmount > 0) {
                    const setterRep = reps.find(r => r.id === old.setterId);
                    newEntries.push({
                      id: `pay_${ts}_m3_trainer_s`,
                      repId: setterTrainerAssignment.trainerId,
                      repName: setterTrainerRep?.name ?? '',
                      projectId: id,
                      customerName: old.customerName,
                      amount: m3SetterTrainerAmount,
                      type: 'Deal',
                      paymentStage: 'Trainer',
                      status: 'Draft',
                      date: payDate,
                      notes: `Trainer override M3 — ${setterTrainerRep?.name ?? ''}`,
                    });
                  }
                }
              }

              const validM3 = newEntries.filter((e) => e.amount > 0);
              // Persist M3 entries to DB
              validM3.forEach((entry) => persistPayrollEntry(entry));
              return [...prevEntries, ...validM3];
            });
        }
      }

      return updated;
    });
  };

  // updateInstallerBaseline: writes through to the active version's flat rates.
  const updateInstallerBaseline = (installer: string, baseline: InstallerBaseline) => {
    const today = new Date().toISOString().split('T')[0];
    setInstallerPricingVersions((prev) => {
      const activeIdx = prev.reduce<number>((best, v, i) => {
        if (v.installer !== installer) return best;
        if (v.effectiveFrom > today || (v.effectiveTo !== null && v.effectiveTo < today)) return best;
        if (best === -1 || v.effectiveFrom >= prev[best].effectiveFrom) return i;
        return best;
      }, -1);
      if (activeIdx === -1) {
        // No existing version — create one and persist
        const newVersion: InstallerPricingVersion = {
          id: `ipv_${installer.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
          installer,
          label: 'v1',
          effectiveFrom: '2020-01-01',
          effectiveTo: null,
          rates: { type: 'flat', closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}), ...(baseline.subDealerPerW != null ? { subDealerPerW: baseline.subDealerPerW } : {}) },
        };
        const instId = idMaps.installerNameToId[installer];
        if (instId) {
          fetch('/api/installer-pricing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installerId: instId, label: 'v1', effectiveFrom: '2020-01-01', rateType: 'flat', tiers: [{ minKW: 0, closerPerW: baseline.closerPerW, setterPerW: baseline.setterPerW, kiloPerW: baseline.kiloPerW, subDealerPerW: baseline.subDealerPerW ?? null }] }),
          }).catch(console.error);
        }
        return [...prev, newVersion];
      }
      const existing = prev[activeIdx];
      if (!existing) return prev;
      // Build updated rates, preserving tiered structure if the existing version is tiered.
      // The settings UI displays band[0] for tiered versions, so only band[0] is updated.
      let updatedRates: InstallerRates;
      let patchTiers: { minKW: number; maxKW?: number | null; closerPerW: number; setterPerW: number | null; kiloPerW: number; subDealerPerW: number | null }[];
      if (existing.rates.type === 'tiered') {
        const updatedBands = existing.rates.bands.map((band, idx) =>
          idx === 0
            ? { ...band, closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}), ...(baseline.subDealerPerW != null ? { subDealerPerW: baseline.subDealerPerW } : {}) }
            : band,
        );
        updatedRates = { type: 'tiered', bands: updatedBands };
        patchTiers = updatedBands.map((b) => ({ minKW: b.minKW, maxKW: b.maxKW ?? null, closerPerW: b.closerPerW, setterPerW: b.setterPerW ?? null, kiloPerW: b.kiloPerW, subDealerPerW: b.subDealerPerW ?? null }));
      } else {
        updatedRates = { type: 'flat' as const, closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}), ...(baseline.subDealerPerW != null ? { subDealerPerW: baseline.subDealerPerW } : {}) };
        patchTiers = [{ minKW: 0, closerPerW: baseline.closerPerW, setterPerW: baseline.setterPerW ?? null, kiloPerW: baseline.kiloPerW, subDealerPerW: baseline.subDealerPerW ?? null }];
      }
      // Persist update to DB
      fetch(`/api/installer-pricing/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers: patchTiers }),
      }).catch(console.error);
      return prev.map((v, i) =>
        i === activeIdx ? { ...v, rates: updatedRates } : v,
      );
    });
  };
  const addInstallerBaseline = (installer: string) => {
    setInstallerPricingVersions((prev) => {
      if (prev.some((v) => v.installer === installer)) return prev;
      return [...prev, {
        id: `ipv_${installer.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        installer,
        label: 'v1',
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
        rates: { type: 'flat' as const, closerPerW: 2.90, kiloPerW: 2.35 },
      }];
    });
  };

  const addInstallerPricingVersion = (version: InstallerPricingVersion) =>
    setInstallerPricingVersions((prev) => [...prev, version]);

  const updateInstallerPricingVersion = (id: string, updates: Partial<InstallerPricingVersion>) =>
    setInstallerPricingVersions((prev) => prev.map((v) => v.id === id ? { ...v, ...updates } : v));

  const createNewInstallerVersion = (installer: string, label: string, effectiveFrom: string, rates: InstallerRates) => {
    const prevDate = new Date(effectiveFrom);
    prevDate.setDate(prevDate.getDate() - 1);
    const effectiveTo = prevDate.toISOString().split('T')[0];

    // Persist to DB
    const instId = idMaps.installerNameToId[installer];
    if (instId) {
      const tiers = rates.type === 'tiered'
        ? rates.bands.map((b) => ({ minKW: b.minKW, maxKW: b.maxKW, closerPerW: b.closerPerW, setterPerW: b.setterPerW, kiloPerW: b.kiloPerW }))
        : [{ minKW: 0, closerPerW: rates.closerPerW, setterPerW: rates.setterPerW, kiloPerW: rates.kiloPerW }];
      fetch('/api/installer-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installerId: instId, label, effectiveFrom, rateType: rates.type, tiers, closePreviousForInstaller: true, closePreviousEffectiveTo: effectiveTo }),
      }).catch(console.error);
    }

    setInstallerPricingVersions((prev) => {
      const newId = `ipv_${installer.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
      return [
        ...prev.map((v) =>
          v.installer === installer && v.effectiveTo === null
            ? { ...v, effectiveTo }
            : v,
        ),
        { id: newId, installer, label, effectiveFrom, effectiveTo: null, rates },
      ];
    });
  };
  const updateSolarTechProduct = (id: string, updates: Partial<SolarTechProduct>) =>
    setSolarTechProducts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
  const updateSolarTechTier = (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) =>
    setSolarTechProducts((prev) => prev.map((p) => p.id !== productId ? p : {
      ...p,
      tiers: p.tiers.map((t, i) => i !== tierIndex ? t : {
        ...t,
        ...(updates.closerPerW !== undefined ? { closerPerW: updates.closerPerW, setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {}),
        ...(updates.kiloPerW !== undefined ? { kiloPerW: updates.kiloPerW } : {}),
        ...('subDealerPerW' in updates ? { subDealerPerW: updates.subDealerPerW } : {}),
      }),
    }));

  const addProductCatalogInstaller = (name: string, config: ProductCatalogInstallerConfig) => {
    setInstallers((prev) => prev.find((i) => i.name === name) ? prev : [...prev, { name, active: true }]);
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: config }));
    // Persist to DB
    fetch('/api/installers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, usesProductCatalog: true }),
    }).then((res) => res.json()).then((created) => {
      if (created.id) {
        setIdMaps((prev) => ({
          ...prev,
          installerNameToId: { ...prev.installerNameToId, [name]: created.id as string },
        }));
      }
    }).catch(console.error);
  };
  const updateProductCatalogInstallerConfig = (name: string, config: Partial<ProductCatalogInstallerConfig>) =>
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: { ...prev[name], ...config } }));
  const addProductCatalogProduct = (product: ProductCatalogProduct) =>
    setProductCatalogProducts((prev) => [...prev, product]);
  const updateProductCatalogProduct = (id: string, updates: Partial<ProductCatalogProduct>) =>
    setProductCatalogProducts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
  const updateProductCatalogTier = (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) =>
    setProductCatalogProducts((prev) => prev.map((p) => p.id !== productId ? p : {
      ...p,
      tiers: p.tiers.map((t, i) => i !== tierIndex ? t : {
        ...t,
        ...(updates.closerPerW !== undefined ? { closerPerW: updates.closerPerW, setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {}),
        ...(updates.kiloPerW !== undefined ? { kiloPerW: updates.kiloPerW } : {}),
        ...('subDealerPerW' in updates ? { subDealerPerW: updates.subDealerPerW } : {}),
      }),
    }));
  const removeProductCatalogProduct = (id: string) =>
    setProductCatalogProducts((prev) => prev.filter((p) => p.id !== id));

  const addProductCatalogPricingVersion = (version: ProductCatalogPricingVersion) =>
    setProductCatalogPricingVersions((prev) => [...prev, version]);

  const updateProductCatalogPricingVersion = (id: string, updates: Partial<ProductCatalogPricingVersion>) =>
    setProductCatalogPricingVersions((prev) => prev.map((v) => v.id === id ? { ...v, ...updates } : v));

  const createNewProductCatalogVersion = (productId: string, label: string, effectiveFrom: string, tiers: ProductCatalogTier[]) => {
    setProductCatalogPricingVersions((prev) => {
      // Close any currently active version for this product by setting effectiveTo to the day before effectiveFrom
      const prevDate = new Date(effectiveFrom);
      prevDate.setDate(prevDate.getDate() - 1);
      const effectiveTo = prevDate.toISOString().split('T')[0];
      const newId = `pcpv_${productId}_${Date.now()}`;
      return [
        ...prev.map((v) =>
          v.productId === productId && v.effectiveTo === null
            ? { ...v, effectiveTo }
            : v,
        ),
        { id: newId, productId, label, effectiveFrom, effectiveTo: null, tiers },
      ];
    });
  };

  const deleteProductCatalogPricingVersions = (versionIds: string[]) => {
    setProductCatalogPricingVersions((prev) => prev.filter((v) => !versionIds.includes(v.id)));
    // Persist each deletion to DB
    versionIds.forEach((id) => {
      fetch(`/api/product-pricing/${id}`, { method: 'DELETE' }).catch(console.error);
    });
  };

  const getInstallerPrepaidOptions = (installer: string) => installerPrepaidOptions[installer] ?? [];
  const addInstallerPrepaidOption = (installer: string, option: string) => {
    setInstallerPrepaidOptions((prev) => {
      const current = prev[installer] ?? [];
      if (current.includes(option.trim())) return prev;
      return { ...prev, [installer]: [...current, option.trim()] };
    });
    const instId = idMaps.installerNameToId[installer];
    if (instId) {
      fetch('/api/prepaid-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installerId: instId, name: option.trim() }),
      }).catch(console.error);
    }
  };
  const updateInstallerPrepaidOption = (installer: string, oldName: string, newName: string) => {
    setInstallerPrepaidOptions((prev) => {
      const current = prev[installer] ?? [];
      return { ...prev, [installer]: current.map((o) => o === oldName ? newName.trim() : o) };
    });
    // Find and update by installer+oldName (need to query DB for the ID)
    const instId = idMaps.installerNameToId[installer];
    if (instId) {
      fetch(`/api/prepaid-options/by-name?installerId=${instId}&name=${encodeURIComponent(oldName)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim() }) }).catch(console.error);
    }
  };
  const removeInstallerPrepaidOption = (installer: string, option: string) => {
    setInstallerPrepaidOptions((prev) => {
      const current = prev[installer] ?? [];
      const filtered = current.filter((o) => o !== option);
      if (filtered.length === 0) { const next = { ...prev }; delete next[installer]; return next; }
      return { ...prev, [installer]: filtered };
    });
    const instId = idMaps.installerNameToId[installer];
    if (instId) {
      fetch(`/api/prepaid-options/by-name?installerId=${instId}&name=${encodeURIComponent(option)}`, { method: 'DELETE' }).catch(console.error);
    }
  };

  const updateInstallerPayConfig = (installer: string, pct: number) => {
    setInstallerPayConfigs((prev) => ({
      ...prev,
      [installer]: { installPayPct: Math.max(0, Math.min(100, pct)) },
    }));
    // Persist to DB
    const instId = idMaps.installerNameToId[installer];
    if (instId) {
      fetch(`/api/installers/${instId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installPayPct: Math.max(0, Math.min(100, pct)) }),
      }).catch(console.error);
    }
  };

  const deleteInstaller = (name: string) => {
    // Persist deletion to DB (cascading deletes handle pricing/products)
    const instId = idMaps.installerNameToId[name];
    if (instId) {
      fetch(`/api/installers/${instId}`, { method: 'DELETE' }).catch(console.error);
    }

    setInstallers((prev) => prev.filter((i) => i.name !== name));
    setInstallerPricingVersions((prev) => prev.filter((v) => v.installer !== name));
    setProductCatalogInstallerConfigs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setProductCatalogProducts((prev) => {
      const removedIds = prev.filter((p) => p.installer === name).map((p) => p.id);
      // Also clean up pricing versions for removed products
      if (removedIds.length > 0) {
        setProductCatalogPricingVersions((pvPrev) => pvPrev.filter((v) => !removedIds.includes(v.productId)));
      }
      return prev.filter((p) => p.installer !== name);
    });
    // Clean up pay config for deleted installer
    setInstallerPayConfigs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    // Clean up prepaid options for deleted installer
    setInstallerPrepaidOptions((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const deleteFinancer = (name: string) => {
    const finId = idMaps.financerNameToId[name];
    if (finId) {
      fetch(`/api/financers/${finId}`, { method: 'DELETE' }).catch(console.error);
    }
    setFinancers((prev) => prev.filter((f) => f.name !== name));
  };

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
      return;
    }

    // Only add the project. Payroll entries are now auto-drafted when
    // milestone phases are reached (Acceptance → M1, Installed → M2).
    // Trainer override entries are auto-drafted at M2 (80%) and M3 (20%).
    setProjects((prev) => [...prev, project]);

    // Log creation activity (fire-and-forget, will use the local id first — updated when DB id arrives)
    logProjectActivity(project.id, 'created', 'Project created');

    // Persist to DB
    const financerId = idMaps.financerNameToId[project.financer];

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
        if (created.id && created.id !== project.id) {
          setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, id: created.id } : p));
        }
      }).catch((err) => {
        console.error('[addDeal] persist failed:', err);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save new deal' }));
        }
      });
    };

    if (financerId) {
      persistProject(financerId);
    } else if (project.productType === 'Cash' || project.financer === 'Cash') {
      // Cash deals: financer record may not exist yet — create it on the fly
      fetch('/api/financers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Cash' }),
      })
        .then((res) => res.json())
        .then((created) => {
          const newId = created.id as string;
          setIdMaps((prev) => ({
            ...prev,
            financerNameToId: { ...prev.financerNameToId, Cash: newId },
          }));
          persistProject(newId);
        })
        .catch((err) => {
          console.error('[addDeal] Cash financer creation failed:', err);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save deal — financer creation error' }));
          }
        });
    } else {
      console.error('[addDeal] Cannot persist: missing financer ID mapping', { financer: project.financer });
    }
  };

  const markForPayroll = (entryIds: string[]) => {
    const idSet = new Set(entryIds);
    // Snapshot before optimistic update so we can rollback on failure
    let snapshot: typeof payrollEntries | null = null;
    setPayrollEntries((prev) => {
      snapshot = prev;
      return prev.map((e) => (idSet.has(e.id) && e.status === 'Draft' ? { ...e, status: 'Pending' } : e));
    });
    // Persist bulk status update — rollback on any failure
    persistFetch('/api/payroll', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: entryIds, status: 'Pending' }),
    }, 'Failed to update payroll status').then((res) => {
      if (!res.ok && snapshot !== null) setPayrollEntries(snapshot);
    }).catch(() => {
      if (snapshot !== null) setPayrollEntries(snapshot);
    });
  };

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
        updateRepType,
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
