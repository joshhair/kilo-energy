'use client';

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef, ReactNode } from 'react';
import { PROJECTS, PAYROLL_ENTRIES, REIMBURSEMENTS, TRAINER_ASSIGNMENTS, INCENTIVES, INSTALLERS, FINANCERS, Project, PayrollEntry, Reimbursement, TrainerAssignment, Incentive, getTrainerOverrideRate, REPS, Rep, SubDealer, SUB_DEALERS, NON_SOLARTECH_BASELINES, SOLARTECH_PRODUCTS, InstallerBaseline, SolarTechProduct, INSTALLER_PRICING_VERSIONS, InstallerPricingVersion, InstallerRates, PRODUCT_CATALOG_INSTALLER_CONFIGS, PRODUCT_CATALOG_PRODUCTS, ProductCatalogInstallerConfig, ProductCatalogProduct, PREPAID_OPTIONS, Phase, PRODUCT_CATALOG_PRICING_VERSIONS, ProductCatalogPricingVersion, ProductCatalogTier, INSTALLER_PAY_CONFIGS, InstallerPayConfig, DEFAULT_INSTALL_PAY_PCT } from './data';
import { getM1PayDate, getM2PayDate, localDateString } from './utils';
import { persistFetch, emitPersistError } from './persist';

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
  addDeal: (project: Project, closerM1: number, closerM2: number, setterM1?: number, setterM2?: number, trainerM1?: number, trainerM2?: number, trainerId?: string, closerTrainerId?: string) => boolean;
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
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>(REIMBURSEMENTS);
  const [trainerAssignments, setTrainerAssignments] = useState<TrainerAssignment[]>(TRAINER_ASSIGNMENTS);
  const [incentives, setIncentives] = useState<Incentive[]>(INCENTIVES);
  const [installers, setInstallers] = useState<ManagedItem[]>(INSTALLERS.map((name) => ({ name, active: true })));
  const [financers, setFinancers] = useState<ManagedItem[]>(FINANCERS.map((name) => ({ name, active: true })));
  const [reps, setReps] = useState<Rep[]>(REPS.map((r) => ({ ...r })));
  const repsRef = useRef(reps);
  repsRef.current = reps;
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
  }, [dbReady, effectiveRepId, refreshMentionCount]);

  // Helper: persist a payroll entry to the DB and sync the DB-assigned id back to local state
  const persistPayrollEntry = useCallback((entry: PayrollEntry) => {
    const clientId = entry.id;
    const promise = fetch('/api/payroll', {
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
      .then((saved): string => {
        const realId: string = saved?.id ?? clientId;
        if (realId !== clientId) {
          setPayrollEntries((prev) =>
            prev.map((e) => (e.id === clientId ? { ...e, id: realId } : e))
          );
        }
        payrollIdResolutionMap.current.delete(clientId);
        return realId;
      })
      .catch((err) => {
        setPayrollEntries((prev) => prev.filter((e) => e.id !== clientId));
        window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save payroll entry' }));
        payrollIdResolutionMap.current.delete(clientId);
        throw err;
      });
    payrollIdResolutionMap.current.set(clientId, promise);
  }, [setPayrollEntries]);

  // Helper: delete payroll entries from DB by filter
  const deletePayrollEntriesFromDb = useCallback((ids: string[]) => {
    for (const id of ids) {
      const inflight = payrollIdResolutionMap.current.get(id);
      if (inflight) {
        // POST is still in-flight — wait for the real DB id, then delete it.
        // Without this, the DELETE fires with a temp id, hits 404, and the
        // resolved DB row becomes an orphaned Draft invisible to the UI.
        inflight
          .then((realId) => {
            persistFetch(`/api/payroll/${realId}`, { method: 'DELETE' }, 'Failed to delete payroll entry').catch(() => {});
          })
          .catch(() => {});
      } else {
        persistFetch(`/api/payroll/${id}`, { method: 'DELETE' }, 'Failed to delete payroll entry').catch(() => {});
      }
    }
  }, []);

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
  const addInstaller = (name: string, initialRates?: { closerPerW: number; kiloPerW: number }) => {
    setInstallers((prev) => prev.find((i) => i.name === name) ? prev : [...prev, { name, active: true }]);
    // Ensure a baseline pricing version exists for the new installer
    setInstallerPricingVersions((prev) => {
      if (prev.some((v) => v.installer === name)) return prev;
      const closerPerW = initialRates?.closerPerW ?? 2.90;
      const kiloPerW = initialRates?.kiloPerW ?? 2.35;
      return [...prev, {
        id: `ipv_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        installer: name,
        label: 'v1',
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
        rates: { type: 'flat' as const, closerPerW, kiloPerW },
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
        // Patch the auto-created pricing version with custom rates if provided
        if (initialRates) {
          fetch(`/api/installer-pricing/${created.pricingVersionId as string}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tiers: [{ minKW: 0, closerPerW: initialRates.closerPerW, setterPerW: null, kiloPerW: initialRates.kiloPerW, subDealerPerW: null }] }),
          }).catch(console.error);
        }
      }
    }).catch((err) => {
      console.error('[addInstaller] Failed to create installer:', err);
      setInstallers((prev) => prev.filter((i) => i.name !== name));
      setInstallerPricingVersions((prev) => prev.filter((v) => v.installer !== name));
      emitPersistError('Failed to add installer — please try again');
    });
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
    }).catch((err) => {
      console.error('[addFinancer] Failed to create financer:', err);
      setFinancers((prev) => prev.filter((f) => f.name !== name));
      setIdMaps((prev) => {
        const { [name]: _, ...rest } = prev.financerNameToId;
        return { ...prev, financerNameToId: rest };
      });
      emitPersistError('Failed to add financer — please try again');
    });
  };
  const addRep = (firstName: string, lastName: string, email: string, phone: string, repType: 'closer' | 'setter' | 'both' = 'both', id?: string, role: 'rep' | 'admin' | 'sub-dealer' = 'rep') => {
    const tempId = id ?? `rep_${Date.now()}`;
    setReps((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), phone: phone.trim(), role: role as Rep['role'], repType, active: true, hasClerkAccount: false }]);
    // If id was pre-supplied, the caller already persisted — skip the POST
    if (id) {
      return Promise.resolve({ id } as { id: string });
    }
    // Persist and update with real DB id
    return persistFetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, repType, role }),
    }, 'Failed to save new rep').then((res) => res.json()).then((rep) => {
      if (rep.id && rep.id !== tempId) {
        setReps((prev) => prev.map((r) => r.id === tempId ? { ...r, id: rep.id } : r));
      }
      return rep as { id: string };
    }).catch(() => {
      setReps((prev) => prev.filter((r) => r.id !== tempId));
      return undefined;
    });
  };
  // ── Rep deactivation / reactivation / hard delete ──
  // Three distinct operations:
  //   deactivateRep: soft, reversible. Marks active=false but keeps the
  //     entry in `reps` so historical contexts can render greyed-out names.
  //     Server-side: Clerk user is locked, any pending invitation revoked.
  //   reactivateRep: re-enable. Server-side unlocks the Clerk user.
  //   deleteRepPermanently: hard delete. Only succeeds if the user has zero
  //     FK relations (server returns 409 otherwise). Used for cleaning up
  //     typos or test accounts.
  const deactivateRep = async (id: string): Promise<void> => {
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: false } : r));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }, 'Failed to deactivate rep');
    } catch (err) {
      // Roll back the optimistic update on failure
      setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: true } : r));
      throw err;
    }
  };
  const reactivateRep = async (id: string): Promise<void> => {
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: true } : r));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      }, 'Failed to reactivate rep');
    } catch (err) {
      setReps((prev) => prev.map((r) => r.id === id ? { ...r, active: false } : r));
      throw err;
    }
  };
  const deleteRepPermanently = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const snapshotIndex = reps.findIndex((r) => r.id === id);
    const snapshot = reps[snapshotIndex];
    const nextRepId = reps[snapshotIndex + 1]?.id ?? null;
    setReps((prev) => prev.filter((r) => r.id !== id));
    try {
      await persistFetch(`/api/users/${id}`, { method: 'DELETE' }, 'Failed to delete rep');
      return { success: true };
    } catch (err: unknown) {
      // Roll back — the server probably rejected with 409 (has relations)
      if (snapshot) setReps((prev) => {
        const next = [...prev];
        const insertAt = nextRepId === null ? next.length : next.findIndex((r) => r.id === nextRepId);
        next.splice(insertAt === -1 ? next.length : insertAt, 0, snapshot);
        return next;
      });
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete rep' };
    }
  };
  // Legacy alias: existing call sites still call removeRep. Mid-migration
  // keep the old "remove from list immediately" UI behavior, but route to
  // the new deactivation endpoint server-side. Phase 4 migrates call sites.
  const removeRep = (id: string) => {
    setReps((prev) => prev.filter((r) => r.id !== id));
    persistFetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    }, 'Failed to remove rep').catch(() => {});
  };
  const updateRepType = async (id: string, repType: 'closer' | 'setter' | 'both'): Promise<void> => {
    const snapshot = reps.find((r) => r.id === id);
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, repType } : r));
    try {
      await persistFetch(`/api/reps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repType }),
      }, 'Failed to update rep type');
    } catch {
      // Roll back the optimistic update on failure
      if (snapshot) setReps((prev) => prev.map((r) => r.id === id ? { ...r, repType: snapshot.repType } : r));
    }
  };
  const updateRepContact = (id: string, updates: { firstName?: string; lastName?: string; email?: string; phone?: string }) => {
    const snapshot = reps.find((r) => r.id === id);
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, ...updates, name: `${updates.firstName ?? r.firstName} ${updates.lastName ?? r.lastName}` } : r));
    persistFetch(`/api/reps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }, 'Failed to update rep contact').catch(() => {
      if (snapshot) setReps((prev) => prev.map((r) => r.id === id ? snapshot : r));
    });
  };

  // ── Sub-dealer management ──
  const addSubDealer = (firstName: string, lastName: string, email: string, phone: string, id?: string) => {
    const tempId = id ?? `sd_${Date.now()}`;
    const name = `${firstName.trim()} ${lastName.trim()}`;
    setSubDealers((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name, email: email.trim(), phone: phone.trim(), role: 'sub-dealer' as const, active: true, hasClerkAccount: false }]);
    // If id was pre-supplied, the caller already persisted — skip the POST
    if (id) {
      return Promise.resolve({ id } as { id: string });
    }
    return persistFetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, role: 'sub-dealer' }),
    }, 'Failed to save new sub-dealer').then((res) => res.json()).then((sd) => {
      if (sd.id && sd.id !== tempId) {
        setSubDealers((prev) => prev.map((s) => s.id === tempId ? { ...s, id: sd.id } : s));
      }
      return sd as { id: string };
    }).catch(() => {
      setSubDealers((prev) => prev.filter((s) => s.id !== tempId));
      return undefined;
    });
  };
  const deactivateSubDealer = async (id: string): Promise<void> => {
    setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: false } : s));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }, 'Failed to deactivate sub-dealer');
    } catch {
      setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: true } : s));
    }
  };
  const reactivateSubDealer = async (id: string): Promise<void> => {
    setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: true } : s));
    try {
      await persistFetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      }, 'Failed to reactivate sub-dealer');
    } catch {
      setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, active: false } : s));
    }
  };
  const deleteSubDealerPermanently = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const snapshotIndex = subDealers.findIndex((s) => s.id === id);
    const snapshot = snapshotIndex !== -1 ? subDealers[snapshotIndex] : undefined;
    setSubDealers((prev) => prev.filter((s) => s.id !== id));
    try {
      await persistFetch(`/api/users/${id}`, { method: 'DELETE' }, 'Failed to delete sub-dealer');
      return { success: true };
    } catch (err: unknown) {
      if (snapshot) setSubDealers((prev) => {
        const next = prev.filter((s) => s.id !== id);
        next.splice(snapshotIndex, 0, snapshot);
        return next;
      });
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete sub-dealer' };
    }
  };
  const updateSubDealerContact = (id: string, updates: { firstName?: string; lastName?: string; email?: string; phone?: string }) => {
    const snapshot = subDealers.find((s) => s.id === id);
    setSubDealers((prev) => prev.map((s) => s.id === id ? { ...s, ...updates, name: `${updates.firstName ?? s.firstName} ${updates.lastName ?? s.lastName}` } : s));
    persistFetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }, 'Failed to update sub-dealer contact').catch(() => {
      if (snapshot) setSubDealers((prev) => prev.map((s) => s.id === id ? snapshot : s));
    });
  };
  // Legacy alias — same migration story as removeRep above.
  const removeSubDealer = (id: string) => {
    setSubDealers((prev) => prev.filter((sd) => sd.id !== id));
    persistFetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    }, 'Failed to remove sub-dealer').catch(() => {});
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
        // Purge the old setter's Draft/Pending payroll entries for this project so they
        // cannot be accidentally promoted and paid after the setter is removed or replaced.
        if (old.setterId) {
          const oldSetterName = reps.find((r) => r.id === old.setterId)?.name ?? '';
          const oldSetterTrainerAssignment = trainerAssignments.find((a) => a.traineeId === old.setterId);
          setPayrollEntries((prevEntries) => {
            const toRemove = prevEntries.filter((e) => {
              if (e.projectId !== id || (e.status !== 'Draft' && e.status !== 'Pending')) return false;
              // The setter's own entries
              if (e.repId === old.setterId) return true;
              // Trainer override entries for the old setter's trainer
              if (
                oldSetterTrainerAssignment &&
                e.repId === oldSetterTrainerAssignment.trainerId &&
                e.paymentStage === 'Trainer' &&
                (e.notes?.startsWith('Trainer override M2') || e.notes?.startsWith('Trainer override M3')) &&
                (oldSetterName ? e.notes?.includes(`— ${oldSetterName} (`) : true)
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

        // Create Draft payroll entries for the incoming setter for any milestones the
        // project has already crossed. Without this, the new setter would never get paid
        // unless milestones were manually cycled backward and forward again.
        if (updates.setterId) {
          const newSetterId = updates.setterId;
          const newSetterRep = repsRef.current.find((r) => r.id === newSetterId);
          const effectivePhase = (updates.phase ?? old.phase) as string;
          const PIPELINE = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];
          const effectiveIdx = PIPELINE.indexOf(effectivePhase);
          const pastAcceptance = effectiveIdx >= PIPELINE.indexOf('Acceptance');
          const pastInstalled = effectiveIdx >= PIPELINE.indexOf('Installed');
          const pastPTO = effectiveIdx >= PIPELINE.indexOf('PTO');

          setPayrollEntries((prevEntries) => {
            const ts = Date.now();
            const newEntries: PayrollEntry[] = [];

            const effectiveSetterM1 = updates.setterM1Amount ?? old.setterM1Amount;
            const effectiveSetterM2 = updates.setterM2Amount ?? old.setterM2Amount;
            const effectiveSetterM3 = updates.setterM3Amount ?? old.setterM3Amount;
            if (pastAcceptance && (effectiveSetterM1 ?? 0) > 0) {
              const hasM1 = prevEntries.some((e) => e.projectId === id && e.repId === newSetterId && e.paymentStage === 'M1');
              if (!hasM1) {
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

            if (pastInstalled && (effectiveSetterM2 ?? 0) > 0) {
              const hasM2 = prevEntries.some((e) => e.projectId === id && e.repId === newSetterId && e.paymentStage === 'M2');
              if (!hasM2) {
                newEntries.push({
                  id: `pay_${ts}_m2_s`,
                  repId: newSetterId,
                  repName: newSetterRep?.name ?? '',
                  projectId: id,
                  customerName: old.customerName,
                  amount: effectiveSetterM2 ?? 0,
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
              const setterM3 = (effectiveSetterM3 ?? 0) > 0
                ? (effectiveSetterM3 ?? 0)
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
                    amount: setterM3,
                    type: 'Deal',
                    paymentStage: 'M3',
                    status: 'Draft',
                    date: getM2PayDate(),
                    notes: 'Setter',
                  });
                }
              }
            }

            // ── Trainer override entries for the new setter's trainer ──
            const setterTrainerAssignment = trainerAssignments.find((a) => a.traineeId === newSetterId);
            if (setterTrainerAssignment) {
              const setterTrainerRep = repsRef.current.find((r) => r.id === setterTrainerAssignment.trainerId);
              const setterTraineeDeals = projects.filter((p) =>
                (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) &&
                ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)
              ).length;
              const setterOverrideRate = getTrainerOverrideRate(setterTrainerAssignment, setterTraineeDeals);
              const trainerInstallPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const setterName = newSetterRep?.name ?? '';

              if (pastInstalled) {
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
            return [...prevEntries, ...validEntries];
          });
        }
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
    if (updates.setterM1Amount !== undefined) dbUpdates.setterM1Amount = updates.setterM1Amount;
    if (updates.setterM2Amount !== undefined) dbUpdates.setterM2Amount = updates.setterM2Amount;
    if (updates.setterM3Amount !== undefined) dbUpdates.setterM3Amount = updates.setterM3Amount;
    if (updates.cancellationReason !== undefined) dbUpdates.cancellationReason = updates.cancellationReason;
    if (updates.cancellationNotes !== undefined) dbUpdates.cancellationNotes = updates.cancellationNotes;
    if (updates.installer !== undefined) dbUpdates.installer = updates.installer;
    if (updates.financer !== undefined) dbUpdates.financer = updates.financer;
    if (updates.productType !== undefined) dbUpdates.productType = updates.productType;
    if (updates.kWSize !== undefined) dbUpdates.kWSize = updates.kWSize;
    if (updates.netPPW !== undefined) dbUpdates.netPPW = updates.netPPW;
    if (updates.setterId !== undefined) dbUpdates.setterId = updates.setterId;
    if (updates.soldDate !== undefined) dbUpdates.soldDate = updates.soldDate;
    if (updates.baselineOverride !== undefined) dbUpdates.baselineOverrideJson = updates.baselineOverride ? JSON.stringify(updates.baselineOverride) : null;
    // Bundle m3Amount into the same PATCH as the Installed phase transition so both
    // land atomically — prevents phase=Installed / m3Amount=null DB inconsistency.
    let computedM3Amount: number | null = null;
    if (old && updates.phase === 'Installed' && old.phase !== 'Installed' && !old.subDealerId) {
      const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      if (installPayPct < 100) {
        const fullAmount = updates.m2Amount ?? old.m2Amount ?? 0;
        computedM3Amount = (old.m3Amount ?? 0) > 0
          ? old.m3Amount!
          : installPayPct > 0
            ? Math.round(fullAmount * ((100 - installPayPct) / installPayPct) * 100) / 100
            : 0;
        dbUpdates.m3Amount = computedM3Amount;
      }
    }
    // Repair m3Amount at PTO in the same PATCH as the phase change — if the Installed-time
    // persist failed and left m3Amount null in DB, this restores it atomically so the
    // DB record stays consistent with phase=PTO and the payroll entries that will be created.
    if (old && updates.phase === 'PTO' && old.phase !== 'PTO' && !old.subDealerId) {
      const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      if (installPayPct < 100) {
        const repairedM3 = (old.m3Amount ?? 0) > 0
          ? old.m3Amount!
          : installPayPct > 0
            ? Math.round((old.m2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
            : 0;
        if (repairedM3 > 0) dbUpdates.m3Amount = repairedM3;
      }
    }
    // When m2Amount is edited on a project that has already reached Installed, derive
    // m3Amount from the new m2Amount so PTO payroll entries and project state stay in sync.
    // Only applies when the caller didn't explicitly supply m3Amount and the installer
    // config calls for a split payment (installPayPct < 100).
    const PAST_INSTALLED_PHASES: Phase[] = ['Installed', 'PTO', 'Completed'];
    if (updates.m2Amount !== undefined && updates.m3Amount === undefined && old && !old.subDealerId && PAST_INSTALLED_PHASES.includes(old.phase as Phase)) {
      const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      if (installPayPct > 0 && installPayPct < 100) {
        const derivedM3 = Math.round(updates.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100;
        updates.m3Amount = derivedM3;
        dbUpdates.m3Amount = derivedM3;
      }
    }
    if (updates.setterM2Amount !== undefined && updates.setterM3Amount === undefined && old && !old.subDealerId && old.setterId && PAST_INSTALLED_PHASES.includes(old.phase as Phase)) {
      const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      if (installPayPct > 0 && installPayPct < 100) {
        const derivedSetterM3 = Math.round(updates.setterM2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100;
        updates.setterM3Amount = derivedSetterM3;
        dbUpdates.setterM3Amount = derivedSetterM3;
      }
    }
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
            const toRemove = prevEntries.filter((e) => e.projectId === id && e.amount < 0 && e.status !== 'Paid');
            if (toRemove.length > 0) deletePayrollEntriesFromDb(toRemove.map((e) => e.id));
            return prevEntries.filter((e) => !(e.projectId === id && e.amount < 0 && e.status !== 'Paid'));
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
            if (paidEntries.length === 0) return remaining;
            // Filter out paid entries that already have a matching negative counterpart
            // (matched by repId + paymentStage) to avoid double-charging on re-cancellation
            const paidEntriesToChargeback = paidEntries.filter(
              (pe) => !remaining.some(
                (e) => e.projectId === id && e.type === 'Deal' && e.amount < 0
                  && e.status !== 'Paid'
                  && e.repId === pe.repId && e.paymentStage === pe.paymentStage
              )
            );
            if (paidEntriesToChargeback.length === 0) return remaining;

            const ts = Date.now();
            const chargebacks: PayrollEntry[] = paidEntriesToChargeback.map((e, i) => ({
              id: `pay_${ts}_chargeback_${i}`,
              repId: e.repId,
              repName: e.repName,
              projectId: id,
              customerName: old.customerName,
              amount: -e.amount,
              type: 'Deal' as const,
              paymentStage: e.paymentStage,
              status: 'Draft' as const,
              date: localDateString(new Date()),
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
        // 'On Hold' is not in PIPELINE; treat it as beyond all milestones so rollback
        // checks still run when a project is moved from On Hold to an earlier phase.
        const effectiveOldIdx = oldIdx >= 0 ? oldIdx : (old.phase === 'On Hold' ? PIPELINE.length : -1);
        const newIdx = PIPELINE.indexOf(newPhase);
        if (effectiveOldIdx >= 0 && newIdx >= 0 && newIdx < effectiveOldIdx) {
          const rollBackM1 = effectiveOldIdx >= PIPELINE.indexOf('Acceptance') && newIdx < PIPELINE.indexOf('Acceptance');
          const rollBackM2 = effectiveOldIdx >= PIPELINE.indexOf('Installed') && newIdx < PIPELINE.indexOf('Installed');
          const rollBackM3 = effectiveOldIdx >= PIPELINE.indexOf('PTO') && newIdx < PIPELINE.indexOf('PTO');
          if (rollBackM1 || rollBackM2 || rollBackM3) {
            setPayrollEntries((prevEntries) => {
              const toDelete = prevEntries.filter((e) => {
                if (e.projectId !== id || (e.status !== 'Draft' && e.status !== 'Pending')) return false;
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
          const freshProject = updated.find((p) => p.id === id)!;
          const fullAmount = isAcceptance ? old.m1Amount : freshProject.m2Amount;

          // For M2, m2Amount is already stored as the post-split value
          // (closerM2Full * installPayPct/100) — use it directly, no re-apply needed
          const installPayPct = isInstalled
            ? (installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT)
            : 100;
          const amount = fullAmount;

          // If installer doesn't pay 100% at install, store M3 remainder on the project.
          // computedM3Amount was calculated outside setProjects and included in the same
          // PATCH as the phase update — no separate persist needed here.
          if (isInstalled && computedM3Amount !== null) {
            updated = updated.map((p) => p.id === id ? { ...p, m3Amount: computedM3Amount! } : p);
          }

          const ts = Date.now();

          // Check if entries already exist for this project + stage to avoid duplicates.
          // Use prevEntries (functional updater) so this correctly chains after any
          // same-cycle setPayrollEntries deletion (e.g. M2 rollback followed by re-entry).
          setPayrollEntries((prevEntries) => {
            // Suppress M1 if M2 entries already exist — project previously reached Installed,
            // so this Acceptance crossing is a re-entry, not a fresh milestone.
            if (stage === 'M1' && prevEntries.some((e) => e.projectId === id && e.paymentStage === 'M2')) {
              return prevEntries;
            }
            const alreadyExists = prevEntries.some(
              (e) => e.projectId === id && (e.paymentStage === stage || (stage === 'M2' && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2')))
            );
            if (alreadyExists) return prevEntries;

            const newEntries: PayrollEntry[] = [];
            const closerRep = reps.find((r) => r.id === old.repId);

            // Closer entry (skip M1 when a setter exists — M1 goes entirely to the setter)
            if (amount > 0 && !(isAcceptance && old.setterId)) {
              newEntries.push({
                id: `pay_${ts}_${stage.toLowerCase()}_c`,
                repId: old.repId,
                repName: closerRep?.name ?? old.repName,
                projectId: id,
                customerName: old.customerName,
                amount,
                type: 'Deal',
                paymentStage: stage,
                status: 'Draft',
                date: payDate,
                notes: '',
              });
            }

            // Setter entry (M1 goes to setter if one exists)
            if (old.setterId && isAcceptance && (old.setterM1Amount ?? 0) > 0) {
              const setterRep = reps.find((r) => r.id === old.setterId);
              newEntries.push({
                id: `pay_${ts}_${stage.toLowerCase()}_s`,
                repId: old.setterId,
                repName: setterRep?.name ?? old.setterName ?? '',
                projectId: id,
                customerName: old.customerName,
                amount: old.setterM1Amount!,
                type: 'Deal',
                paymentStage: stage,
                status: 'Draft',
                date: payDate,
                notes: 'Setter',
              });
            }

            // Setter entry (M2 at Installed — setterM2Amount is already post-installPayPct)
            if (old.setterId && isInstalled && (old.setterM2Amount ?? 0) > 0) {
              const setterRep = reps.find((r) => r.id === old.setterId);
              newEntries.push({
                id: `pay_${ts}_m2_s`,
                repId: old.setterId,
                repName: setterRep?.name ?? old.setterName ?? '',
                projectId: id,
                customerName: old.customerName,
                amount: old.setterM2Amount!,
                type: 'Deal',
                paymentStage: 'M2',
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
                const traineeDeals = updated.filter(p => (p.repId === closerTrainerAssignment.traineeId || p.setterId === closerTrainerAssignment.traineeId) && ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length;
                const overrideRate = getTrainerOverrideRate(closerTrainerAssignment, traineeDeals);
                const m2TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
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
                  const setterTraineeDeals = updated.filter(p => (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) && ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length;
                  const setterOverrideRate = getTrainerOverrideRate(setterTrainerAssignment, setterTraineeDeals);
                  const m2SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
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
          const m3 = (proj?.m3Amount ?? 0) > 0 && installPayPct < 100
            ? proj!.m3Amount!
            : installPayPct > 0 && installPayPct < 100 && !old.subDealerId
              ? Math.round((proj?.m2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
              : 0;
          const ts = Date.now();
          const payDate = getM2PayDate(); // M3 follows the same Saturday cutoff as M2
          setPayrollEntries((prevEntries) => {
              const alreadyExists = prevEntries.some(
                (e) => e.projectId === id && (e.paymentStage === 'M3' || (e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M3')))
              );
              if (alreadyExists) return prevEntries;

              // Guard: only draft M3 if M2 was previously created for this project.
              // Without this, a project moved directly to PTO (skipping Installed) would
              // produce an orphaned M3 entry with no corresponding M2.
              const hasM2Entry = prevEntries.some(
                (e) => e.projectId === id && e.paymentStage === 'M2'
              );
              if (!hasM2Entry) return prevEntries;

              const newEntries: PayrollEntry[] = [];
              const closerRep = reps.find((r) => r.id === old.repId);

              // Closer M3 entry — only when installPayPct < 100 produces a non-zero amount
              if (m3 > 0) {
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
              }

              // Setter M3 entry
              if (old.setterId) {
                const setterM3 = (old.setterM3Amount ?? 0) > 0
                  ? old.setterM3Amount!
                  : installPayPct > 0 && installPayPct < 100 && !old.subDealerId
                    ? Math.round((proj?.setterM2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
                    : 0;
                if (setterM3 > 0) {
                  const setterRep = reps.find((r) => r.id === old.setterId);
                  newEntries.push({
                    id: `pay_${ts}_m3_s`,
                    repId: old.setterId,
                    repName: setterRep?.name ?? old.setterName ?? '',
                    projectId: id,
                    customerName: old.customerName,
                    amount: setterM3,
                    type: 'Deal',
                    paymentStage: 'M3',
                    status: 'Draft',
                    date: payDate,
                    notes: 'Setter',
                  });
                }
              }

              // ── Trainer override M3 entries ((100 - installPayPct)% of override at PTO) ──
              // Closer's trainer — gated by m3 > 0, which is 0 for sub-dealer deals
              const closerTrainerAssignment = trainerAssignments.find(a => a.traineeId === old.repId);
              if (closerTrainerAssignment && m3 > 0) {
                const trainerRep = reps.find(r => r.id === closerTrainerAssignment.trainerId);
                // Lock to the M2 rate so M2+M3 use the same per-watt tier for this project
                const m2CloserTrainerEntry = prevEntries.find(e => e.projectId === id && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === closerTrainerAssignment.trainerId);
                const m2CloserRateMatch = m2CloserTrainerEntry?.notes?.match(/\(\$([0-9.]+)\/W\)/);
                const m2CloserParsed = m2CloserRateMatch ? parseFloat(m2CloserRateMatch[1]) : NaN;
                const overrideRate = !isNaN(m2CloserParsed)
                  ? m2CloserParsed
                  : getTrainerOverrideRate(closerTrainerAssignment, updated.filter(p => (p.repId === closerTrainerAssignment.traineeId || p.setterId === closerTrainerAssignment.traineeId) && ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length);
                const m3TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
                if (m3TrainerAmount > 0) {
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
                    notes: `Trainer override M3 — ${closerRep?.name ?? old.repName} ($${overrideRate.toFixed(2)}/W)`,
                  });
                }
              }

              // Setter's trainer — guarded by !old.subDealerId to match closer's trainer (m3 > 0 is 0 for sub-dealer deals)
              if (old.setterId && !old.subDealerId) {
                const setterTrainerAssignment = trainerAssignments.find(a => a.traineeId === old.setterId);
                if (setterTrainerAssignment) {
                  const setterTrainerRep = reps.find(r => r.id === setterTrainerAssignment.trainerId);
                  // Lock to the M2 rate so M2+M3 use the same per-watt tier for this project
                  const setterTraineeName = reps.find(r => r.id === old.setterId)?.name ?? old.setterName ?? '';
                  const m2SetterTrainerEntry = prevEntries.find(e => e.projectId === id && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === setterTrainerAssignment.trainerId && (setterTraineeName ? e.notes?.includes(`— ${setterTraineeName} (`) : true));
                  const m2SetterRateMatch = m2SetterTrainerEntry?.notes?.match(/\(\$([0-9.]+)\/W\)/);
                  const m2SetterParsed = m2SetterRateMatch ? parseFloat(m2SetterRateMatch[1]) : NaN;
                  const setterOverrideRate = !isNaN(m2SetterParsed)
                    ? m2SetterParsed
                    : getTrainerOverrideRate(setterTrainerAssignment, updated.filter(p => (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) && ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length);
                  const m3SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
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
                      notes: `Trainer override M3 — ${setterRep?.name ?? old.setterName ?? ''} ($${setterOverrideRate.toFixed(2)}/W)`,
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

    // ── AMOUNT SYNC: When amounts are edited, patch existing Draft payroll entries ──
    const stageAmountUpdates: Array<{ stage: 'M1' | 'M2' | 'M3'; setter: boolean; newAmount: number }> = [];
    if (updates.m1Amount !== undefined) stageAmountUpdates.push({ stage: 'M1', setter: false, newAmount: updates.m1Amount });
    if (updates.m2Amount !== undefined) stageAmountUpdates.push({ stage: 'M2', setter: false, newAmount: updates.m2Amount });
    if (updates.m3Amount !== undefined) stageAmountUpdates.push({ stage: 'M3', setter: false, newAmount: updates.m3Amount });
    if (updates.setterM1Amount !== undefined) stageAmountUpdates.push({ stage: 'M1', setter: true, newAmount: updates.setterM1Amount });
    if (updates.setterM2Amount !== undefined) stageAmountUpdates.push({ stage: 'M2', setter: true, newAmount: updates.setterM2Amount });
    if (updates.setterM3Amount !== undefined) stageAmountUpdates.push({ stage: 'M3', setter: true, newAmount: updates.setterM3Amount });
    if (stageAmountUpdates.length > 0) {
      setPayrollEntries((prev) =>
        prev.map((e) => {
          if (e.projectId !== id || (e.status !== 'Draft' && e.status !== 'Pending') || e.type !== 'Deal') return e;
          const match = stageAmountUpdates.find(
            (u) => u.stage === e.paymentStage && u.setter === (e.notes === 'Setter')
          );
          if (!match || match.newAmount === e.amount) return e;
          persistFetch(`/api/payroll/${e.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: match.newAmount }),
          }, 'Failed to update payroll entry amount').catch(() => {});
          return { ...e, amount: match.newAmount };
        })
      );
    }
  };

  // updateInstallerBaseline: writes through to the active version's flat rates.
  const updateInstallerBaseline = (installer: string, baseline: InstallerBaseline) => {
    const today = localDateString(new Date());
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

    const tempId = `ipv_${installer.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

    setInstallerPricingVersions((prev) => [
      ...prev.map((v) =>
        v.installer === installer && v.effectiveTo === null
          ? { ...v, effectiveTo }
          : v,
      ),
      { id: tempId, installer, label, effectiveFrom, effectiveTo: null, rates },
    ]);

    // Persist to DB and replace temp ID with the real DB-assigned ID
    const instId = idMaps.installerNameToId[installer];
    if (!instId) {
      // Installer not yet resolved — revert local state to avoid a dangling temp ID
      setInstallerPricingVersions((prev) =>
        prev.filter((v) => v.id !== tempId).map((v) =>
          v.installer === installer && v.effectiveTo === effectiveTo
            ? { ...v, effectiveTo: null }
            : v,
        ),
      );
      console.error(`createNewInstallerVersion: no DB id for installer "${installer}" — version not saved`);
      return;
    }
    const tiers = rates.type === 'tiered'
      ? rates.bands.map((b) => ({ minKW: b.minKW, maxKW: b.maxKW, closerPerW: b.closerPerW, setterPerW: b.setterPerW, kiloPerW: b.kiloPerW, subDealerPerW: b.subDealerPerW }))
      : [{ minKW: 0, closerPerW: rates.closerPerW, setterPerW: rates.setterPerW, kiloPerW: rates.kiloPerW, subDealerPerW: rates.subDealerPerW }];
    fetch('/api/installer-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installerId: instId, label, effectiveFrom, rateType: rates.type, tiers, closePreviousForInstaller: true, closePreviousEffectiveTo: effectiveTo }),
    })
      .then((res) => res.json())
      .then((data: { id?: string }) => {
        if (data?.id && data.id !== tempId) {
          setInstallerPricingVersions((prev) =>
            prev.map((v) => v.id === tempId ? { ...v, id: data.id as string } : v),
          );
        }
      })
      .catch(console.error);
  };
  const updateSolarTechProduct = (id: string, updates: Partial<SolarTechProduct>) => {
    setSolarTechProducts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
    const patchBody: Record<string, unknown> = {};
    if (updates.name !== undefined) patchBody.name = updates.name;
    if (updates.family !== undefined) patchBody.family = updates.family;
    if (Object.keys(patchBody).length > 0) {
      fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      }).catch(console.error);
    }
  };
  const updateSolarTechTier = (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) =>
    setSolarTechProducts((prev) => {
      const newProducts = prev.map((p) => p.id !== productId ? p : {
        ...p,
        tiers: p.tiers.map((t, i) => i !== tierIndex ? t : {
          ...t,
          ...(updates.closerPerW !== undefined ? { closerPerW: updates.closerPerW, setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {}),
          ...(updates.kiloPerW !== undefined ? { kiloPerW: updates.kiloPerW } : {}),
          ...('subDealerPerW' in updates ? { subDealerPerW: updates.subDealerPerW } : {}),
        }),
      });
      const updatedProduct = newProducts.find((p) => p.id === productId);
      if (updatedProduct) {
        fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tiers: updatedProduct.tiers }),
        }).catch(console.error);
      }
      return newProducts;
    });

  const addProductCatalogInstaller = (name: string, config: ProductCatalogInstallerConfig) => {
    setInstallers((prev) => prev.find((i) => i.name === name) ? prev : [...prev, { name, active: true }]);
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: config }));
    // Persist to DB
    fetch('/api/installers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, usesProductCatalog: true, families: config.families, familyFinancerMap: config.familyFinancerMap ?? {}, prepaidFamily: config.prepaidFamily ?? null }),
    }).then((res) => res.json()).then((created) => {
      if (created.id) {
        setIdMaps((prev) => ({
          ...prev,
          installerNameToId: { ...prev.installerNameToId, [name]: created.id as string },
        }));
      }
    }).catch(console.error);
  };
  const updateProductCatalogInstallerConfig = (name: string, config: Partial<ProductCatalogInstallerConfig>) => {
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: { ...prev[name], ...config } }));
    const installerId = idMaps.installerNameToId[name];
    if (installerId) {
      const body: Record<string, unknown> = {};
      if (config.families !== undefined) body.families = config.families;
      if (config.familyFinancerMap !== undefined) body.familyFinancerMap = JSON.stringify(config.familyFinancerMap);
      if (config.prepaidFamily !== undefined) body.prepaidFamily = config.prepaidFamily;
      fetch(`/api/installers/${installerId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(console.error);
    }
  };
  const addProductCatalogProduct = (product: ProductCatalogProduct) => {
    setProductCatalogProducts((prev) => [...prev, product]);
    const installerId = idMaps.installerNameToId[product.installer];
    if (installerId) {
      fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installerId, family: product.family, name: product.name, tiers: product.tiers }),
      }).then((res) => res.json()).then((data: { id?: string }) => {
        if (data?.id && data.id !== product.id) {
          setProductCatalogProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, id: data.id as string } : p));
        }
      }).catch(console.error);
    }
  };
  const updateProductCatalogProduct = (id: string, updates: Partial<ProductCatalogProduct>) => {
    setProductCatalogProducts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
    const patchBody: Record<string, unknown> = {};
    if (updates.name !== undefined) patchBody.name = updates.name;
    if (updates.family !== undefined) patchBody.family = updates.family;
    if (Object.keys(patchBody).length > 0) {
      fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      }).catch(console.error);
    }
  };
  const updateProductCatalogTier = (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) =>
    setProductCatalogProducts((prev) => {
      const newProducts = prev.map((p) => p.id !== productId ? p : {
        ...p,
        tiers: p.tiers.map((t, i) => i !== tierIndex ? t : {
          ...t,
          ...(updates.closerPerW !== undefined ? { closerPerW: updates.closerPerW, setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {}),
          ...(updates.kiloPerW !== undefined ? { kiloPerW: updates.kiloPerW } : {}),
          ...('subDealerPerW' in updates ? { subDealerPerW: updates.subDealerPerW } : {}),
        }),
      });
      const updatedProduct = newProducts.find((p) => p.id === productId);
      if (updatedProduct) {
        fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tiers: updatedProduct.tiers }),
        }).catch(console.error);
      }
      return newProducts;
    });
  const removeProductCatalogProduct = async (id: string) => {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete product: ${res.status}`);
    setProductCatalogPricingVersions((prev) => prev.filter((v) => v.productId !== id));
    setProductCatalogProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const addProductCatalogPricingVersion = (version: ProductCatalogPricingVersion) =>
    setProductCatalogPricingVersions((prev) => [...prev, version]);

  const updateProductCatalogPricingVersion = (id: string, updates: Partial<ProductCatalogPricingVersion>) =>
    setProductCatalogPricingVersions((prev) => prev.map((v) => v.id === id ? { ...v, ...updates } : v));

  const createNewProductCatalogVersion = (productId: string, label: string, effectiveFrom: string, tiers: ProductCatalogTier[]) => {
    const prevDate = new Date(effectiveFrom);
    prevDate.setDate(prevDate.getDate() - 1);
    const effectiveTo = prevDate.toISOString().split('T')[0];
    const tempId = `pcpv_${productId}_${Date.now()}`;

    setProductCatalogPricingVersions((prev) => [
      ...prev.map((v) =>
        v.productId === productId && v.effectiveTo === null
          ? { ...v, effectiveTo }
          : v,
      ),
      { id: tempId, productId, label, effectiveFrom, effectiveTo: null, tiers },
    ]);

    // Persist to DB and replace temp ID with the real DB-assigned ID
    fetch('/api/product-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, label, effectiveFrom, closePreviousEffectiveTo: effectiveTo, tiers }),
    })
      .then((res) => res.json())
      .then((data: { id?: string }) => {
        if (data?.id && data.id !== tempId) {
          setProductCatalogPricingVersions((prev) =>
            prev.map((v) => v.id === tempId ? { ...v, id: data.id as string } : v),
          );
        }
      })
      .catch(console.error);
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

  const deleteInstaller = async (name: string) => {
    // Persist deletion to DB first; only mutate local state on success
    const instId = idMaps.installerNameToId[name];
    if (instId) {
      const res = await fetch(`/api/installers/${instId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete installer: ${res.status}`);
    }

    setInstallers((prev) => prev.filter((i) => i.name !== name));
    setInstallerPricingVersions((prev) => prev.filter((v) => v.installer !== name));
    setProductCatalogInstallerConfigs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    const removedIds = productCatalogProducts.filter((p) => p.installer === name).map((p) => p.id);
    setProductCatalogProducts((prev) => prev.filter((p) => p.installer !== name));
    if (removedIds.length > 0) {
      setProductCatalogPricingVersions((prev) => prev.filter((v) => !removedIds.includes(v.productId)));
    }
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
    // Clean up stale ID from idMaps so undo/restore doesn't PATCH the deleted installer
    setIdMaps((prev) => {
      const next = { ...prev, installerNameToId: { ...prev.installerNameToId } };
      delete next.installerNameToId[name];
      return next;
    });
  };

  const deleteFinancer = async (name: string) => {
    const finId = idMaps.financerNameToId[name];
    if (finId) {
      const res = await fetch(`/api/financers/${finId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete financer: ${res.status}`);
    }
    setFinancers((prev) => prev.filter((f) => f.name !== name));
    // Clean up stale ID from idMaps so re-adding the same name doesn't resolve to the deleted record
    setIdMaps((prev) => {
      const next = { ...prev, financerNameToId: { ...prev.financerNameToId } };
      delete next.financerNameToId[name];
      return next;
    });
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
      return false;
    }

    // Validate financer mapping before mutating local state to avoid split-brain
    const financerId = idMaps.financerNameToId[project.financer];
    if (!financerId && project.productType !== 'Cash' && project.financer !== 'Cash') {
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
          setProjects((prev) => prev.filter((p) => p.id !== project.id));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('kilo-persist-error', { detail: 'Failed to save deal — financer creation error' }));
          }
        });
    }
    return true;
  };

  const markForPayroll = (entryIds: string[]) => {
    const idSet = new Set(entryIds);
    // Capture original statuses synchronously before the optimistic update so the rollback
    // can restore them without depending on the optimistic state having been flushed by React.
    const originalStatuses = new Map(
      payrollEntries.filter((e) => idSet.has(e.id)).map((e) => [e.id, e.status])
    );
    const rollback = () =>
      setPayrollEntries((prev) =>
        prev.map((e) => {
          const orig = originalStatuses.get(e.id);
          return orig !== undefined ? { ...e, status: orig } : e;
        })
      );
    setPayrollEntries((prev) =>
      prev.map((e) => (idSet.has(e.id) && e.status === 'Draft' ? { ...e, status: 'Pending' } : e))
    );
    // Resolve any temp IDs to real DB IDs before sending PATCH.
    // If a payroll POST is still in-flight, await it so we never send a temp ID to the DB
    // (the DB has no row for it yet, so updateMany would silently update 0 rows).
    const resolveIds = async (): Promise<{ resolved: string[]; failedOrigIds: string[] }> => {
      const results = await Promise.all(
        entryIds.map(async (id) => {
          const pending = payrollIdResolutionMap.current.get(id);
          if (pending) {
            try { return { origId: id, resolvedId: await pending }; } catch { return { origId: id, resolvedId: null }; }
          }
          return { origId: id, resolvedId: id };
        })
      );
      const resolved = results.filter((r): r is { origId: string; resolvedId: string } => r.resolvedId !== null).map((r) => r.resolvedId);
      const failedOrigIds = results.filter((r) => r.resolvedId === null).map((r) => r.origId);
      return { resolved, failedOrigIds };
    };
    return resolveIds().then(({ resolved: resolvedIds, failedOrigIds }) => {
      // Roll back any entries whose POST failed — they are still Draft in the DB
      if (failedOrigIds.length > 0) {
        const failedSet = new Set(failedOrigIds);
        setPayrollEntries((prev) =>
          prev.map((e) => {
            if (!failedSet.has(e.id)) return e;
            const orig = originalStatuses.get(e.id);
            return orig !== undefined ? { ...e, status: orig } : e;
          })
        );
      }
      if (resolvedIds.length === 0) {
        // All entries failed to persist — optimistic update already fully rolled back above
        return;
      }
      // Persist bulk status update — rollback on any failure
      return persistFetch('/api/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: resolvedIds, status: 'Pending' }),
      }, 'Failed to update payroll status').then((res) => {
        if (!res.ok) rollback();
      }).catch(() => {
        rollback();
      });
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
