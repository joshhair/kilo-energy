/**
 * Installer, financer, pricing, and product catalog actions — extracted from
 * context.tsx for file organization.
 */

import type {
  InstallerBaseline,
  InstallerPricingVersion,
  InstallerRates,
  InstallerPayConfig,
  SolarTechProduct,
  ProductCatalogInstallerConfig,
  ProductCatalogProduct,
  ProductCatalogPricingVersion,
  ProductCatalogTier,
} from '../data';
import type { ManagedItem } from '../context';
import { persistFetch, emitPersistError } from '../persist';
import { localDateString } from '../utils';

interface InstallerDeps {
  installers: ManagedItem[];
  setInstallers: React.Dispatch<React.SetStateAction<ManagedItem[]>>;
  setFinancers: React.Dispatch<React.SetStateAction<ManagedItem[]>>;
  setInstallerPricingVersions: React.Dispatch<React.SetStateAction<InstallerPricingVersion[]>>;
  setSolarTechProducts: React.Dispatch<React.SetStateAction<SolarTechProduct[]>>;
  setProductCatalogInstallerConfigs: React.Dispatch<React.SetStateAction<Record<string, ProductCatalogInstallerConfig>>>;
  setProductCatalogProducts: React.Dispatch<React.SetStateAction<ProductCatalogProduct[]>>;
  getProductCatalogProducts: () => ProductCatalogProduct[];
  setProductCatalogPricingVersions: React.Dispatch<React.SetStateAction<ProductCatalogPricingVersion[]>>;
  setInstallerPrepaidOptions: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setInstallerPayConfigs: React.Dispatch<React.SetStateAction<Record<string, InstallerPayConfig>>>;
  getIdMaps: () => { installerNameToId: Record<string, string>; financerNameToId: Record<string, string> };
  setIdMaps: React.Dispatch<React.SetStateAction<{ installerNameToId: Record<string, string>; financerNameToId: Record<string, string> }>>;
  pendingInstallerIdRef: React.MutableRefObject<Map<string, Promise<string>>>;
}

export function createInstallerActions(deps: InstallerDeps) {
  const {
    setInstallers, setFinancers, setInstallerPricingVersions,
    setSolarTechProducts, setProductCatalogInstallerConfigs,
    setProductCatalogProducts, getProductCatalogProducts,
    setProductCatalogPricingVersions, setInstallerPrepaidOptions,
    setInstallerPayConfigs, getIdMaps, setIdMaps, pendingInstallerIdRef,
  } = deps;

  const setInstallerActive = (name: string, active: boolean) => {
    let prevActive: boolean | undefined;
    setInstallers((prev) => {
      prevActive = prev.find((i) => i.name === name)?.active;
      return prev.map((i) => i.name === name ? { ...i, active } : i);
    });
    const rollback = () => {
      if (prevActive !== undefined) {
        setInstallers((prev) => prev.map((i) => i.name === name ? { ...i, active: prevActive! } : i));
      }
    };
    const instId = getIdMaps().installerNameToId[name];
    const doPatch = (id: string) => persistFetch(`/api/installers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    }, 'Failed to update installer status').catch(rollback);
    if (instId) {
      doPatch(instId);
    } else {
      fetch(`/api/installers?name=${encodeURIComponent(name)}`)
        .then((r) => r.ok ? r.json() as Promise<{ id: string }> : null)
        .then((data) => {
          if (!data?.id) return;
          setIdMaps((prev) => ({ ...prev, installerNameToId: { ...prev.installerNameToId, [name]: data.id } }));
          doPatch(data.id);
        })
        .catch(rollback);
    }
  };

  const setFinancerActive = (name: string, active: boolean) => {
    let prevActive: boolean | undefined;
    setFinancers((prev) => {
      prevActive = prev.find((f) => f.name === name)?.active;
      return prev.map((f) => f.name === name ? { ...f, active } : f);
    });
    const rollback = () => {
      if (prevActive !== undefined) {
        setFinancers((prev) => prev.map((f) => f.name === name ? { ...f, active: prevActive! } : f));
      }
    };
    const finId = getIdMaps().financerNameToId[name];
    const doPatch = (id: string) => persistFetch(`/api/financers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    }, 'Failed to update financer status').catch(rollback);
    if (finId) {
      doPatch(finId);
    } else {
      fetch(`/api/financers?name=${encodeURIComponent(name)}`)
        .then((r) => r.ok ? r.json() as Promise<{ id: string }> : null)
        .then((data) => {
          if (!data?.id) return;
          setIdMaps((prev) => ({ ...prev, financerNameToId: { ...prev.financerNameToId, [name]: data.id } }));
          doPatch(data.id);
        })
        .catch(rollback);
    }
  };

  const addInstaller = (name: string, initialRates?: { closerPerW: number; kiloPerW: number }) => {
    setInstallers((prev) => prev.find((i) => i.name === name) ? prev : [...prev, { name, active: true }]);
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
    let resolveInstallerId!: (id: string) => void;
    let rejectInstallerId!: (reason?: unknown) => void;
    const installerIdPromise = new Promise<string>((resolve, reject) => { resolveInstallerId = resolve; rejectInstallerId = reject; });
    pendingInstallerIdRef.current.set(name, installerIdPromise);
    fetch('/api/installers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...(initialRates ? { closerPerW: initialRates.closerPerW, kiloPerW: initialRates.kiloPerW } : {}) }),
    }).then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }).then((created) => {
      if (created.id) {
        resolveInstallerId(created.id as string);
        setIdMaps((prev) => ({
          ...prev,
          installerNameToId: { ...prev.installerNameToId, [name]: created.id as string },
        }));
        pendingInstallerIdRef.current.delete(name);
      }
      if (created.pricingVersionId) {
        setInstallerPricingVersions((prev) =>
          prev.map((v) => v.installer === name && v.id.startsWith('ipv_')
            ? { ...v, id: created.pricingVersionId as string }
            : v,
          ),
        );
      }
    }).catch((err) => {
      console.error('[addInstaller] Failed to create installer:', err);
      rejectInstallerId(err);
      pendingInstallerIdRef.current.delete(name);
      setInstallers((prev) => prev.filter((i) => i.name !== name));
      setInstallerPricingVersions((prev) => prev.filter((v) => !(v.installer === name && v.id.startsWith('ipv_'))));
      emitPersistError('Failed to add installer — please try again');
    });
  };

  const addFinancer = (name: string) => {
    setFinancers((prev) => prev.find((f) => f.name === name) ? prev : [...prev, { name, active: true }]);
    fetch('/api/financers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }).then((created) => {
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

  const updateInstallerBaseline = (installer: string, baseline: InstallerBaseline) => {
    const today = localDateString(new Date());
    const idMaps = getIdMaps();
    setInstallerPricingVersions((prev) => {
      const activeIdx = prev.reduce<number>((best, v, i) => {
        if (v.installer !== installer) return best;
        if (v.effectiveFrom > today || (v.effectiveTo !== null && v.effectiveTo < today)) return best;
        if (best === -1 || v.effectiveFrom >= prev[best].effectiveFrom) return i;
        return best;
      }, -1);
      if (activeIdx === -1) {
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
          const tempId = newVersion.id;
          fetch('/api/installer-pricing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installerId: instId, label: 'v1', effectiveFrom: '2020-01-01', rateType: 'flat', tiers: [{ minKW: 0, closerPerW: baseline.closerPerW, setterPerW: baseline.setterPerW, kiloPerW: baseline.kiloPerW, subDealerPerW: baseline.subDealerPerW ?? null }] }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data?.id) {
                setInstallerPricingVersions((prev) => prev.map((v) => (v.id === tempId ? { ...v, id: data.id } : v)));
              }
            })
            .catch(console.error);
        }
        return [...prev, newVersion];
      }
      const existing = prev[activeIdx];
      if (!existing) return prev;
      let updatedRates: InstallerRates;
      let patchTiers: { minKW: number; maxKW?: number | null; closerPerW: number; setterPerW: number | null; kiloPerW: number; subDealerPerW: number | null }[];
      if (existing.rates.type === 'tiered') {
        const updatedBands = existing.rates.bands.map((band) =>
          ({ ...band, closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}), ...(baseline.subDealerPerW != null ? { subDealerPerW: baseline.subDealerPerW } : {}) }),
        );
        updatedRates = { type: 'tiered', bands: updatedBands };
        patchTiers = updatedBands.map((b) => ({ minKW: b.minKW, maxKW: b.maxKW ?? null, closerPerW: b.closerPerW, setterPerW: b.setterPerW ?? null, kiloPerW: b.kiloPerW, subDealerPerW: b.subDealerPerW ?? null }));
      } else {
        updatedRates = { type: 'flat' as const, closerPerW: baseline.closerPerW, kiloPerW: baseline.kiloPerW, ...(baseline.setterPerW != null ? { setterPerW: baseline.setterPerW } : {}), ...(baseline.subDealerPerW != null ? { subDealerPerW: baseline.subDealerPerW } : {}) };
        patchTiers = [{ minKW: 0, closerPerW: baseline.closerPerW, setterPerW: baseline.setterPerW ?? null, kiloPerW: baseline.kiloPerW, subDealerPerW: baseline.subDealerPerW ?? null }];
      }
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
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const effectiveTo = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}-${String(prevDate.getUTCDate()).padStart(2, '0')}`;

    const tempId = `ipv_${installer.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

    setInstallerPricingVersions((prev) => [
      ...prev.map((v) =>
        v.installer === installer && v.effectiveTo === null
          ? { ...v, effectiveTo }
          : v,
      ),
      { id: tempId, installer, label, effectiveFrom, effectiveTo: null, rates },
    ]);

    const instId = getIdMaps().installerNameToId[installer];
    if (!instId) {
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
      .catch((err) => {
        console.error(err);
        setInstallerPricingVersions((prev) =>
          prev.filter((v) => v.id !== tempId).map((v) =>
            v.installer === installer && v.effectiveTo === effectiveTo
              ? { ...v, effectiveTo: null }
              : v,
          ),
        );
        emitPersistError('Failed to save new pricing version — please try again');
      });
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
    let resolveInstallerId!: (id: string) => void;
    let rejectInstallerId!: (reason?: unknown) => void;
    const installerIdPromise = new Promise<string>((resolve, reject) => { resolveInstallerId = resolve; rejectInstallerId = reject; });
    pendingInstallerIdRef.current.set(name, installerIdPromise);
    fetch('/api/installers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, usesProductCatalog: true, families: config.families, familyFinancerMap: config.familyFinancerMap ?? {}, prepaidFamily: config.prepaidFamily ?? null }),
    }).then((res) => res.json()).then((created) => {
      if (created.id) {
        resolveInstallerId(created.id as string);
        setIdMaps((prev) => ({
          ...prev,
          installerNameToId: { ...prev.installerNameToId, [name]: created.id as string },
        }));
        pendingInstallerIdRef.current.delete(name);
      } else {
        const err = new Error('Installer POST returned no id');
        console.error(err);
        rejectInstallerId(err);
        pendingInstallerIdRef.current.delete(name);
        setInstallers((prev) => prev.filter((i) => i.name !== name));
        setProductCatalogInstallerConfigs((prev) => { const next = { ...prev }; delete next[name]; return next; });
        emitPersistError('Failed to add installer — please try again');
      }
    }).catch((err) => {
      console.error(err);
      rejectInstallerId(err);
      pendingInstallerIdRef.current.delete(name);
      setInstallers((prev) => prev.filter((i) => i.name !== name));
      setProductCatalogInstallerConfigs((prev) => { const next = { ...prev }; delete next[name]; return next; });
      emitPersistError('Failed to add installer — please try again');
    });
  };

  const updateProductCatalogInstallerConfig = (name: string, config: Partial<ProductCatalogInstallerConfig>) => {
    setProductCatalogInstallerConfigs((prev) => ({ ...prev, [name]: { ...prev[name], ...config } }));
    const installerId = getIdMaps().installerNameToId[name];
    if (installerId) {
      const body: Record<string, unknown> = {};
      if (config.families !== undefined) body.families = config.families;
      if (config.familyFinancerMap !== undefined) body.familyFinancerMap = config.familyFinancerMap;
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
    const doPost = (installerId: string) => {
      fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installerId, family: product.family, name: product.name, tiers: product.tiers }),
      }).then((res) => res.json()).then((data: { id?: string }) => {
        if (data?.id && data.id !== product.id) {
          setProductCatalogProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, id: data.id as string } : p));
        }
      }).catch((err) => {
        console.warn('[addProductCatalogProduct] persist failed:', err instanceof Error ? err.message : err);
      });
    };
    const installerId = getIdMaps().installerNameToId[product.installer];
    if (installerId) {
      doPost(installerId);
    } else {
      const pending = pendingInstallerIdRef.current.get(product.installer);
      if (pending) {
        pending.then(doPost).catch((err) => {
          console.warn('[addProductCatalogProduct] installer-id resolve failed:', err instanceof Error ? err.message : err);
        });
      }
    }
  };

  /**
   * Create a new SolarTech-family product (Goodleap, Enfin, Lightreach,
   * Cash/HDM/PE). Same DB endpoint as Product Catalog (POST /api/products);
   * different local state (`solarTechProducts`) because the UI partitions
   * the two views.
   *
   * Optionally accepts an `effectiveFrom` date — passed through to the
   * server, used as the initial pricing version's effectiveFrom. Default
   * (omitted) = today.
   *
   * Returns a Promise resolving to the new server-issued ID, or rejecting
   * with the API error. Caller responsible for surfacing toasts.
   */
  const addSolarTechProduct = async (input: {
    tempId: string;
    family: string;
    financer: string;
    name: string;
    tiers: SolarTechProduct['tiers'];
    effectiveFrom?: string;
    versionLabel?: string;
    idempotencyKey?: string;
    reason?: string;
  }): Promise<string> => {
    // Optimistic local insert
    const optimistic: SolarTechProduct = {
      id: input.tempId,
      family: input.family,
      financer: input.financer,
      name: input.name,
      tiers: input.tiers,
    };
    setSolarTechProducts((prev) => [...prev, optimistic]);

    const doPost = async (installerId: string): Promise<string> => {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installerId,
          family: input.family,
          name: input.name,
          tiers: input.tiers,
          effectiveFrom: input.effectiveFrom,
          versionLabel: input.versionLabel,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        }),
      });
      if (!res.ok) {
        // Roll back optimistic insert on server reject
        setSolarTechProducts((prev) => prev.filter((p) => p.id !== input.tempId));
        const errText = await res.text().catch(() => '');
        throw new Error(`Product create failed: ${res.status} ${errText}`);
      }
      const data = await res.json() as { id?: string };
      if (data?.id && data.id !== input.tempId) {
        setSolarTechProducts((prev) => prev.map((p) => p.id === input.tempId ? { ...p, id: data.id as string } : p));
        return data.id;
      }
      return input.tempId;
    };

    const installerId = getIdMaps().installerNameToId['SolarTech'];
    if (installerId) return doPost(installerId);
    const pending = pendingInstallerIdRef.current.get('SolarTech');
    if (pending) {
      const resolvedId = await pending;
      return doPost(resolvedId);
    }
    throw new Error('SolarTech installer not found');
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

  const updateProductCatalogTier = async (productId: string, tierIndex: number, updates: Partial<{ closerPerW: number; kiloPerW: number; subDealerPerW: number | undefined }>) => {
    let updatedTiers: ProductCatalogTier[] | undefined;
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
      updatedTiers = newProducts.find((p) => p.id === productId)?.tiers;
      return newProducts;
    });
    if (updatedTiers) {
      try {
        const res = await fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tiers: updatedTiers }),
        });
        const data = await res.json();
        if (data.newVersion) {
          const today = new Date().toISOString().slice(0, 10);
          setProductCatalogPricingVersions((prev) => [
            ...prev.map((v) => v.productId === productId && v.effectiveTo === null ? { ...v, effectiveTo: today } : v),
            data.newVersion,
          ]);
        }
      } catch (e) { console.error(e); }
    }
  };

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
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const effectiveTo = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}-${String(prevDate.getUTCDate()).padStart(2, '0')}`;
    const tempId = `pcpv_${productId}_${Date.now()}`;

    setProductCatalogPricingVersions((prev) => [
      ...prev.map((v) =>
        v.productId === productId && v.effectiveTo === null
          ? { ...v, effectiveTo }
          : v,
      ),
      { id: tempId, productId, label, effectiveFrom, effectiveTo: null, tiers },
    ]);

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
      .catch((err) => {
        console.error(err);
        setProductCatalogPricingVersions((prev) =>
          prev.filter((v) => v.id !== tempId).map((v) =>
            v.productId === productId && v.effectiveTo === effectiveTo
              ? { ...v, effectiveTo: null }
              : v,
          ),
        );
        emitPersistError('Failed to save new pricing version — please try again');
      });
  };

  const deleteProductCatalogPricingVersions = (versionIds: string[]) => {
    setProductCatalogPricingVersions((prev) => prev.filter((v) => !versionIds.includes(v.id)));
    versionIds.forEach((id) => {
      fetch(`/api/product-pricing/${id}`, { method: 'DELETE' }).catch(console.error);
    });
  };

  const getInstallerPrepaidOptions = (installer: string) => {
    // This is a read-only getter — we can't close over state, so caller passes installerPrepaidOptions.
    // Actually, we need the caller to pass the current state. We'll handle this differently.
    // The getter is so simple it's almost not worth extracting, but for consistency:
    return installer; // placeholder — handled via wrapper in context.tsx
  };
  // The getInstallerPrepaidOptions function needs live state access, so we return a factory instead
  void getInstallerPrepaidOptions; // suppress unused warning — we don't export this

  const addInstallerPrepaidOption = (installer: string, option: string) => {
    setInstallerPrepaidOptions((prev) => {
      const current = prev[installer] ?? [];
      if (current.includes(option.trim())) return prev;
      return { ...prev, [installer]: [...current, option.trim()] };
    });
    const doPost = (instId: string) => fetch('/api/prepaid-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installerId: instId, name: option.trim() }),
    }).catch(console.error);
    const instId = getIdMaps().installerNameToId[installer];
    if (instId) {
      doPost(instId);
    } else {
      const pending = pendingInstallerIdRef.current.get(installer);
      if (pending) {
        pending.then(doPost).catch(console.error);
      }
    }
  };

  const updateInstallerPrepaidOption = (installer: string, oldName: string, newName: string) => {
    setInstallerPrepaidOptions((prev) => {
      const current = prev[installer] ?? [];
      return { ...prev, [installer]: current.map((o) => o === oldName ? newName.trim() : o) };
    });
    const instId = getIdMaps().installerNameToId[installer];
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
    const instId = getIdMaps().installerNameToId[installer];
    if (instId) {
      fetch(`/api/prepaid-options/by-name?installerId=${instId}&name=${encodeURIComponent(option)}`, { method: 'DELETE' }).catch(console.error);
    }
  };

  const updateInstallerPayConfig = (installer: string, pct: number) => {
    const clampedPct = Math.max(0, Math.min(100, pct));
    setInstallerPayConfigs((prev) => ({
      ...prev,
      [installer]: { installPayPct: clampedPct },
    }));
    const doPatch = (instId: string) => fetch(`/api/installers/${instId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installPayPct: clampedPct }),
    }).catch(console.error);
    const instId = getIdMaps().installerNameToId[installer];
    if (instId) {
      doPatch(instId);
    } else {
      const pending = pendingInstallerIdRef.current.get(installer);
      if (pending) {
        pending.then(doPatch).catch(console.error);
      }
    }
  };

  const deleteInstaller = async (name: string) => {
    const instId = getIdMaps().installerNameToId[name];
    if (instId) {
      const res = await fetch(`/api/installers/${instId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete installer: ${res.status}`);
    } else {
      // idMap not yet populated (e.g. POST response still in-flight) — look up by name
      const lookupRes = await fetch(`/api/installers?name=${encodeURIComponent(name)}`);
      if (!lookupRes.ok) throw new Error(`Failed to look up installer: ${lookupRes.status}`);
      const { id } = await lookupRes.json();
      if (!id) throw new Error(`Installer not found: ${name}`);
      const delRes = await fetch(`/api/installers/${id}`, { method: 'DELETE' });
      if (!delRes.ok) throw new Error(`Failed to delete installer: ${delRes.status}`);
    }

    setInstallers((prev) => prev.filter((i) => i.name !== name));
    setInstallerPricingVersions((prev) => prev.filter((v) => v.installer !== name));
    setProductCatalogInstallerConfigs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    const removedIds = getProductCatalogProducts().filter((p) => p.installer === name).map((p) => p.id);
    setProductCatalogProducts((prev) => prev.filter((p) => p.installer !== name));
    if (removedIds.length > 0) {
      setProductCatalogPricingVersions((prev) => prev.filter((v) => !removedIds.includes(v.productId)));
    }
    setInstallerPayConfigs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setInstallerPrepaidOptions((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setIdMaps((prev) => {
      const next = { ...prev, installerNameToId: { ...prev.installerNameToId } };
      delete next.installerNameToId[name];
      return next;
    });
  };

  const deleteFinancer = async (name: string) => {
    let finId = getIdMaps().financerNameToId[name];
    if (!finId) {
      // idMap not yet populated (e.g. POST response still in-flight) — look up by name
      const lookupRes = await fetch(`/api/financers?name=${encodeURIComponent(name)}`);
      if (lookupRes.ok) {
        const { id } = await lookupRes.json();
        finId = id;
      }
    }
    if (!finId) throw new Error(`Financer ID not found for: ${name}`);
    const res = await fetch(`/api/financers/${finId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete financer: ${res.status}`);
    setFinancers((prev) => prev.filter((f) => f.name !== name));
    setIdMaps((prev) => {
      const next = { ...prev, financerNameToId: { ...prev.financerNameToId } };
      delete next.financerNameToId[name];
      return next;
    });
  };

  return {
    setInstallerActive,
    setFinancerActive,
    addInstaller,
    addFinancer,
    updateInstallerBaseline,
    addInstallerBaseline,
    addInstallerPricingVersion,
    updateInstallerPricingVersion,
    createNewInstallerVersion,
    updateSolarTechProduct,
    updateSolarTechTier,
    addProductCatalogInstaller,
    updateProductCatalogInstallerConfig,
    addProductCatalogProduct,
    addSolarTechProduct,
    updateProductCatalogProduct,
    updateProductCatalogTier,
    removeProductCatalogProduct,
    addProductCatalogPricingVersion,
    updateProductCatalogPricingVersion,
    createNewProductCatalogVersion,
    deleteProductCatalogPricingVersions,
    addInstallerPrepaidOption,
    updateInstallerPrepaidOption,
    removeInstallerPrepaidOption,
    updateInstallerPayConfig,
    deleteInstaller,
    deleteFinancer,
  };
}
