'use client';

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, ReactNode } from 'react';
import { PROJECTS, PAYROLL_ENTRIES, REIMBURSEMENTS, TRAINER_ASSIGNMENTS, INCENTIVES, INSTALLERS, FINANCERS, Project, PayrollEntry, Reimbursement, TrainerAssignment, Incentive, getTrainerOverrideRate, REPS, Rep, NON_SOLARTECH_BASELINES, SOLARTECH_PRODUCTS, InstallerBaseline, SolarTechProduct, INSTALLER_PRICING_VERSIONS, InstallerPricingVersion, InstallerRates, PRODUCT_CATALOG_INSTALLER_CONFIGS, PRODUCT_CATALOG_PRODUCTS, ProductCatalogInstallerConfig, ProductCatalogProduct, PREPAID_OPTIONS, Phase, PRODUCT_CATALOG_PRICING_VERSIONS, ProductCatalogPricingVersion, ProductCatalogTier, INSTALLER_PAY_CONFIGS, InstallerPayConfig, DEFAULT_INSTALL_PAY_PCT } from './data';
import { getM1PayDate, getM2PayDate } from './utils';

type Role = 'rep' | 'admin' | null;

export interface ManagedItem { name: string; active: boolean; }

interface AppContextType {
  dbReady: boolean;
  currentRole: Role;
  currentRepId: string | null;
  currentRepName: string | null;
  setRole: (role: Role, repId?: string, repName?: string) => void;
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
  addRep: (firstName: string, lastName: string, email: string, phone: string, repType?: 'closer' | 'setter' | 'both', id?: string) => void;
  removeRep: (id: string) => void;
  updateRepType: (id: string, repType: 'closer' | 'setter' | 'both') => void;
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
  updateSolarTechTier: (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number }>) => void;
  // Product Catalog installer system
  productCatalogInstallerConfigs: Record<string, ProductCatalogInstallerConfig>;
  productCatalogProducts: ProductCatalogProduct[];
  addProductCatalogInstaller: (name: string, config: ProductCatalogInstallerConfig) => void;
  updateProductCatalogInstallerConfig: (name: string, config: Partial<ProductCatalogInstallerConfig>) => void;
  addProductCatalogProduct: (product: ProductCatalogProduct) => void;
  updateProductCatalogProduct: (id: string, updates: Partial<ProductCatalogProduct>) => void;
  updateProductCatalogTier: (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number }>) => void;
  removeProductCatalogProduct: (id: string) => void;
  // Product Catalog pricing versions
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  addProductCatalogPricingVersion: (version: ProductCatalogPricingVersion) => void;
  updateProductCatalogPricingVersion: (id: string, updates: Partial<ProductCatalogPricingVersion>) => void;
  createNewProductCatalogVersion: (productId: string, label: string, effectiveFrom: string, tiers: ProductCatalogTier[]) => void;
  deleteInstaller: (name: string) => void;
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
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentRole, setCurrentRole] = useState<Role>(null);
  const [currentRepId, setCurrentRepId] = useState<string | null>(null);
  const [currentRepName, setCurrentRepName] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>(PAYROLL_ENTRIES);
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>(REIMBURSEMENTS);
  const [trainerAssignments, setTrainerAssignments] = useState<TrainerAssignment[]>(TRAINER_ASSIGNMENTS);
  const [incentives, setIncentives] = useState<Incentive[]>(INCENTIVES);
  const [installers, setInstallers] = useState<ManagedItem[]>(INSTALLERS.map((name) => ({ name, active: true })));
  const [financers, setFinancers] = useState<ManagedItem[]>(FINANCERS.map((name) => ({ name, active: true })));
  const [reps, setReps] = useState<Rep[]>(REPS.map((r) => ({ ...r })));
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
        setInstallers((data.installers ?? []).map((name: string) => ({ name, active: true })));
        setFinancers((data.financers ?? []).map((name: string) => ({ name, active: true })));
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
        console.warn('Failed to load data from API, using seed data:', err);
        setDbReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Helper: persist a payroll entry to the DB (fire and forget)
  const persistPayrollEntry = useCallback((entry: PayrollEntry) => {
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
    }).catch(console.error);
  }, []);

  // Helper: delete payroll entries from DB by filter
  const deletePayrollEntriesFromDb = useCallback((ids: string[]) => {
    for (const id of ids) {
      fetch(`/api/payroll/${id}`, { method: 'DELETE' }).catch(console.error);
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
      result[name] = { closerPerW: flatRates.closerPerW, kiloPerW: flatRates.kiloPerW, ...(flatRates.setterPerW != null ? { setterPerW: flatRates.setterPerW } : {}) };
    }
    // Also include any NON_SOLARTECH_BASELINES entries without a pricing version
    for (const [name, baseline] of Object.entries(NON_SOLARTECH_BASELINES)) {
      if (!(name in result)) result[name] = baseline;
    }
    return result;
  }, [installerPricingVersions]);

  const activeInstallers = installers.filter((i) => i.active).map((i) => i.name);
  const activeFinancers = financers.filter((f) => f.active).map((f) => f.name);
  const setInstallerActive = (name: string, active: boolean) =>
    setInstallers((prev) => prev.map((i) => i.name === name ? { ...i, active } : i));
  const setFinancerActive = (name: string, active: boolean) =>
    setFinancers((prev) => prev.map((f) => f.name === name ? { ...f, active } : f));
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
    }).catch(console.error);
  };
  const addFinancer = (name: string) => {
    setFinancers((prev) => prev.find((f) => f.name === name) ? prev : [...prev, { name, active: true }]);
    fetch('/api/financers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(console.error);
  };
  const addRep = (firstName: string, lastName: string, email: string, phone: string, repType: 'closer' | 'setter' | 'both' = 'both', id?: string) => {
    const tempId = id ?? `rep_${Date.now()}`;
    setReps((prev) => [...prev, { id: tempId, firstName: firstName.trim(), lastName: lastName.trim(), name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), phone: phone.trim(), role: 'rep' as const, repType }]);
    // Persist and update with real DB id
    fetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone, repType }),
    }).then((res) => res.json()).then((rep) => {
      if (rep.id && rep.id !== tempId) {
        setReps((prev) => prev.map((r) => r.id === tempId ? { ...r, id: rep.id } : r));
      }
    }).catch(console.error);
  };
  const removeRep = (id: string) => {
    setReps((prev) => prev.filter((r) => r.id !== id));
    fetch(`/api/reps/${id}`, { method: 'DELETE' }).catch(console.error);
  };
  const updateRepType = (id: string, repType: 'closer' | 'setter' | 'both') => {
    setReps((prev) => prev.map((r) => r.id === id ? { ...r, repType } : r));
    fetch(`/api/reps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repType }),
    }).catch(console.error);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    // Persist to DB (fire and forget — local state is source of truth for UI)
    const dbUpdates: Record<string, unknown> = {};
    if (updates.phase !== undefined) dbUpdates.phase = updates.phase;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.flagged !== undefined) dbUpdates.flagged = updates.flagged;
    if (updates.m1Paid !== undefined) dbUpdates.m1Paid = updates.m1Paid;
    if (updates.m1Amount !== undefined) dbUpdates.m1Amount = updates.m1Amount;
    if (updates.m2Paid !== undefined) dbUpdates.m2Paid = updates.m2Paid;
    if (updates.m2Amount !== undefined) dbUpdates.m2Amount = updates.m2Amount;
    if (updates.m3Amount !== undefined) dbUpdates.m3Amount = updates.m3Amount;
    if (Object.keys(dbUpdates).length > 0) {
      fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdates),
      }).catch(console.error);
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

        // ── CHARGEBACK: When cancelled, create negative entries for any M1 already in payroll ──
        if (newPhase === 'Cancelled' && old.phase !== 'Cancelled') {
          setPayrollEntries((prevEntries) => {
            const m1Entries = prevEntries.filter(
              (e) => e.projectId === id && e.paymentStage === 'M1' && e.amount > 0
            );
            // Already has a chargeback? Don't double-charge
            const hasChargeback = prevEntries.some(
              (e) => e.projectId === id && e.type === 'Deal' && e.amount < 0
            );
            if (m1Entries.length === 0 || hasChargeback) return prevEntries;

            const ts = Date.now();
            const chargebacks: PayrollEntry[] = m1Entries.map((e, i) => ({
              id: `pay_${ts}_chargeback_${i}`,
              repId: e.repId,
              repName: e.repName,
              projectId: id,
              customerName: old.customerName,
              amount: -e.amount,
              type: 'Deal' as const,
              paymentStage: 'M1' as const,
              status: 'Draft' as const,
              date: getM1PayDate(),
              notes: 'Chargeback — project cancelled',
            }));
            // Persist chargebacks to DB
            chargebacks.forEach((cb) => persistPayrollEntry(cb));
            return [...prevEntries, ...chargebacks];
          });
        }

        const isAcceptance = newPhase === 'Acceptance' && old.phase !== 'Acceptance';
        const isInstalled = newPhase === 'Installed' && old.phase !== 'Installed';
        const isPTO = newPhase === 'PTO' && old.phase !== 'PTO';

        if (isAcceptance || isInstalled) {
          const stage: 'M1' | 'M2' = isAcceptance ? 'M1' : 'M2';
          const payDate = isAcceptance ? getM1PayDate() : getM2PayDate();
          const fullAmount = isAcceptance ? old.m1Amount : old.m2Amount;

          // For M2, apply installer pay percentage (e.g. 80% at install, 20% at PTO)
          const installPayPct = isInstalled
            ? (installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT)
            : 100;
          const amount = isInstalled
            ? Math.round(fullAmount * (installPayPct / 100) * 100) / 100
            : fullAmount;

          // If installer doesn't pay 100% at install, store M3 remainder on the project
          if (isInstalled && installPayPct < 100) {
            const m3 = Math.round(fullAmount * ((100 - installPayPct) / 100) * 100) / 100;
            updated = updated.map((p) => p.id === id ? { ...p, m3Amount: m3 } : p);
            // Persist m3Amount to DB
            fetch(`/api/projects/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ m3Amount: m3 }),
            }).catch(console.error);
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

            const validEntries = newEntries.filter((e) => e.amount > 0);
            // Persist M1/M2 entries to DB
            validEntries.forEach((entry) => persistPayrollEntry(entry));
            return [...prevEntries, ...validEntries];
          });
        }

        // ── M3: Auto-draft at PTO for installers that don't pay 100% at install ──
        if (isPTO) {
          const proj = updated.find((p) => p.id === id);
          const m3 = proj?.m3Amount ?? 0;
          if (m3 > 0) {
            const ts = Date.now();
            const payDate = getM2PayDate(); // M3 follows the same Saturday cutoff as M2
            setPayrollEntries((prevEntries) => {
              const alreadyExists = prevEntries.some(
                (e) => e.projectId === id && e.paymentStage === 'M3'
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

              const validM3 = newEntries.filter((e) => e.amount > 0);
              // Persist M3 entries to DB
              validM3.forEach((entry) => persistPayrollEntry(entry));
              return [...prevEntries, ...validM3];
            });
          }
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
          rates: { type: 'flat', closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}) },
        };
        const instId = idMaps.installerNameToId[installer];
        if (instId) {
          fetch('/api/installer-pricing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installerId: instId, label: 'v1', effectiveFrom: '2020-01-01', rateType: 'flat', tiers: [{ minKW: 0, closerPerW: baseline.closerPerW, setterPerW: baseline.setterPerW, kiloPerW: baseline.kiloPerW }] }),
          }).catch(console.error);
        }
        return [...prev, newVersion];
      }
      const existing = prev[activeIdx];
      if (!existing) return prev;
      // Persist tier update to DB
      fetch(`/api/installer-pricing/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers: [{ minKW: 0, closerPerW: baseline.closerPerW, setterPerW: baseline.setterPerW ?? null, kiloPerW: baseline.kiloPerW }] }),
      }).catch(console.error);
      return prev.map((v, i) =>
        i === activeIdx
          ? { ...v, rates: { type: 'flat' as const, closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}) } }
          : v,
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
  const updateSolarTechTier = (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number }>) =>
    setSolarTechProducts((prev) => prev.map((p) => p.id !== productId ? p : {
      ...p,
      tiers: p.tiers.map((t, i) => i !== tierIndex ? t : {
        ...t,
        ...(updates.closerPerW !== undefined ? { closerPerW: updates.closerPerW, setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {}),
        ...(updates.kiloPerW !== undefined ? { kiloPerW: updates.kiloPerW } : {}),
      }),
    }));

  const addProductCatalogInstaller = (name: string, config: ProductCatalogInstallerConfig) => {
    setInstallers((prev) => prev.find((i) => i.name === name) ? prev : [...prev, { name, active: true }]);
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: config }));
  };
  const updateProductCatalogInstallerConfig = (name: string, config: Partial<ProductCatalogInstallerConfig>) =>
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: { ...prev[name], ...config } }));
  const addProductCatalogProduct = (product: ProductCatalogProduct) =>
    setProductCatalogProducts((prev) => [...prev, product]);
  const updateProductCatalogProduct = (id: string, updates: Partial<ProductCatalogProduct>) =>
    setProductCatalogProducts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
  const updateProductCatalogTier = (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number }>) =>
    setProductCatalogProducts((prev) => prev.map((p) => p.id !== productId ? p : {
      ...p,
      tiers: p.tiers.map((t, i) => i !== tierIndex ? t : {
        ...t,
        ...(updates.closerPerW !== undefined ? { closerPerW: updates.closerPerW, setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {}),
        ...(updates.kiloPerW !== undefined ? { kiloPerW: updates.kiloPerW } : {}),
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
  };

  const setRole = (role: Role, repId?: string, repName?: string) => {
    setCurrentRole(role);
    setCurrentRepId(repId ?? null);
    setCurrentRepName(repName ?? null);
  };

  const logout = () => {
    setCurrentRole(null);
    setCurrentRepId(null);
    setCurrentRepName(null);
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
    // Only add the project. Payroll entries are now auto-drafted when
    // milestone phases are reached (Acceptance → M1, Installed → M2).
    setProjects((prev) => [...prev, project]);

    // Persist to DB
    const installerId = idMaps.installerNameToId[project.installer];
    const financerId = idMaps.financerNameToId[project.financer];
    if (!installerId || !financerId) {
      console.error('[addDeal] Cannot persist: missing ID mapping', { installer: project.installer, financer: project.financer, installerId, financerId });
    }
    if (installerId && financerId) {
      fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: project.customerName,
          closerId: project.repId,
          setterId: project.setterId || null,
          soldDate: project.soldDate,
          installerId,
          financerId,
          productType: project.productType,
          kWSize: project.kWSize,
          netPPW: project.netPPW,
          phase: project.phase || 'New',
          m1Amount: project.m1Amount || 0,
          m2Amount: project.m2Amount || 0,
          notes: project.notes || '',
          installerPricingVersionId: project.pricingVersionId || null,
          productId: project.solarTechProductId || project.installerProductId || null,
          productPricingVersionId: project.pcPricingVersionId || null,
          prepaidSubType: project.prepaidSubType || null,
          leadSource: project.leadSource || null,
          blitzId: project.blitzId || null,
        }),
      }).then((res) => res.json()).then((created) => {
        // Update local state with the DB-assigned id
        if (created.id && created.id !== project.id) {
          setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, id: created.id } : p));
        }
      }).catch(console.error);
    }
  };

  const markForPayroll = (entryIds: string[]) => {
    const idSet = new Set(entryIds);
    setPayrollEntries((prev) =>
      prev.map((e) => (idSet.has(e.id) && e.status === 'Draft' ? { ...e, status: 'Pending' } : e))
    );
    // Persist bulk status update
    fetch('/api/payroll', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: entryIds, status: 'Pending' }),
    }).catch(console.error);
  };

  return (
    <AppContext.Provider
      value={{
        dbReady,
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
        deleteInstaller,
        installerPrepaidOptions,
        getInstallerPrepaidOptions,
        addInstallerPrepaidOption,
        updateInstallerPrepaidOption,
        removeInstallerPrepaidOption,
        installerPayConfigs,
        setInstallerPayConfigs,
        updateInstallerPayConfig,
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
