'use client';

import React, { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import {
  Plus, Pencil, Check, X, Trash2, Search, History, GitBranch, Copy, RotateCcw,
  ChevronDown, ChevronUp, Sliders,
} from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import {
  SOLARTECH_FAMILIES, SolarTechFamily, InstallerRates,
  ProductCatalogTier, makeProductCatalogTiers,
  SOLARTECH_FAMILY_FINANCER,
} from '../../../../lib/data';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SectionHeader } from '../components/SectionHeader';

export interface BaselinesSectionProps {
  editingInstaller: string | null;
  setEditingInstaller: React.Dispatch<React.SetStateAction<string | null>>;
  editingProductName: string | null;
  setEditingProductName: React.Dispatch<React.SetStateAction<string | null>>;
  newVersionFor: string | null;
  setNewVersionFor: React.Dispatch<React.SetStateAction<string | null>>;
  pcNewVersionFor: string | null;
  setPcNewVersionFor: React.Dispatch<React.SetStateAction<string | null>>;
  dupAllOpen: 'solartech' | 'productcatalog' | null;
  setDupAllOpen: React.Dispatch<React.SetStateAction<'solartech' | 'productcatalog' | null>>;
  baselineTab: string;
  setBaselineTab: React.Dispatch<React.SetStateAction<string>>;
}

export function BaselinesSection({
  editingInstaller, setEditingInstaller,
  editingProductName, setEditingProductName,
  newVersionFor, setNewVersionFor,
  pcNewVersionFor, setPcNewVersionFor,
  dupAllOpen, setDupAllOpen,
  baselineTab, setBaselineTab,
}: BaselinesSectionProps) {
  const {
    installerBaselines, updateInstallerBaseline,
    installerPricingVersions, createNewInstallerVersion,
    solarTechProducts, updateSolarTechProduct, updateSolarTechTier, addSolarTechProduct, removeSolarTechProduct, restoreProduct, applyBulkTierAdjust,
    productCatalogInstallerConfigs, productCatalogProducts,
    addProductCatalogProduct, updateProductCatalogProduct,
    updateProductCatalogTier, removeProductCatalogProduct,
    productCatalogPricingVersions, createNewProductCatalogVersion, deleteProductCatalogPricingVersions,
  } = useApp();
  const { toast } = useToast();

  // ── Internal state ─────────────────────────────────────────────────────────
  const [editInstallerVals, setEditInstallerVals] = useState({ closerPerW: '', setterPerW: '', kiloPerW: '', subDealerPerW: '' });
  const [showSubDealerRates, setShowSubDealerRates] = useState(false);
  const [editProductNameVal, setEditProductNameVal] = useState('');
  const productNameSavedRef = useRef(false);

  // ── Validation: product-name rename ────────────────────────────────────────
  // Common safety rules for any place that lets an admin set a product name:
  // - trim and Unicode-NFC-normalize so visually-identical strings collapse
  // - reject empty or whitespace-only
  // - reject control characters (\x00–\x1F, \x7F) — not visible, can corrupt
  //   downstream rendering / CSV exports / log lines
  // - reject zero-width spaces / joiners / BOM (​–‍, ﻿) which
  //   are invisible to humans but make duplicate-name detection trivially
  //   bypassable
  // - reject duplicate within the same installer+family scope (case-insensitive
  //   after NFC normalization) — admins setting "SunPower 400" twice in Enfin
  //   was a real issue, downstream commission lookup picks one at random
  // Returns the cleaned name on success, or a reason string on failure.
  const validateProductName = (
    raw: string,
    currentName: string,
    siblings: ReadonlyArray<{ id: string; name: string }>,
    productId: string,
  ): { ok: true; name: string } | { ok: false; reason: string } => {
    // NFC normalize first so that combining-char vs precomposed don't slip past
    const normalized = raw.normalize('NFC').trim();
    if (!normalized) return { ok: false, reason: 'Name cannot be empty' };
    // Control characters (including \r\n which would split CSV cells)
    if (/[\u0000-\u001F\u007F]/.test(normalized)) {
      return { ok: false, reason: 'Name contains invisible control characters' };
    }
    // Zero-width spaces / joiners / BOM — invisible, defeat dedup
    if (/[\u200B-\u200D\uFEFF]/.test(normalized)) {
      return { ok: false, reason: 'Name contains zero-width characters' };
    }
    // No-op rename — silently accept (caller will skip the API call)
    if (normalized === currentName) return { ok: true, name: normalized };
    // Duplicate detection within the sibling scope (case-insensitive
    // after NFC normalization). Skip self.
    const lower = normalized.toLowerCase();
    const dup = siblings.find((s) => s.id !== productId && s.name.normalize('NFC').toLowerCase() === lower);
    if (dup) return { ok: false, reason: `Another product is already named "${normalized}"` };
    return { ok: true, name: normalized };
  };

  // Version state
  const [newVersionLabel, setNewVersionLabel] = useState('');
  const [newVersionEffectiveFrom, setNewVersionEffectiveFrom] = useState('');
  const [newVersionVals, setNewVersionVals] = useState({ closerPerW: '', setterPerW: '', kiloPerW: '' });
  const [showVersionHistory, setShowVersionHistory] = useState<string | null>(null);

  // Product Catalog tab state
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

  // SolarTech tab "Add Product" state. The form is mounted only when
  // addingSolarTechProductInFamily is non-null. The non-null value is
  // the family the form was opened from (e.g. 'Enfin'); we capture it
  // up front so a tab switch doesn't repurpose the form mid-edit.
  const [addingSolarTechProductInFamily, setAddingSolarTechProductInFamily] = useState<string | null>(null);

  // SolarTech "Show archived" toggle + lazy-loaded archived list.
  // When toggled on, the table swaps to show archived products of the
  // current family with a Restore action per row. Lives outside the
  // main /api/data hydration payload to keep that minimal — fetched
  // on-demand via GET /api/products?archived=1.
  const [stShowArchived, setStShowArchived] = useState(false);
  type ArchivedProduct = { id: string; name: string; family: string; installerName: string; projectRefs: number; versionCount: number; latestVersion: { label: string; effectiveFrom: string; effectiveTo: string | null } | null };
  const [archivedProducts, setArchivedProducts] = useState<ArchivedProduct[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const refreshArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const res = await fetch('/api/products?archived=1');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { products: ArchivedProduct[] };
      setArchivedProducts(data.products ?? []);
    } catch (err) {
      console.warn('[archived products] fetch failed:', err instanceof Error ? err.message : err);
      toast('Failed to load archived products', 'error');
    } finally {
      setArchivedLoading(false);
    }
  }, [toast]);
  const [stNewProductName, setStNewProductName] = useState('');
  const [stNewProductEffectiveFrom, setStNewProductEffectiveFrom] = useState(''); // YYYY-MM-DD; '' = today
  const [stNewProductReason, setStNewProductReason] = useState('');
  const [stNewProductTiers, setStNewProductTiers] = useState([
    { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' },
  ]);
  const [stNewProductSubmitting, setStNewProductSubmitting] = useState(false);
  const resetStNewProduct = () => {
    setStNewProductName(''); setStNewProductEffectiveFrom(''); setStNewProductReason('');
    setStNewProductTiers([
      { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
      { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
    ]);
    setStNewProductSubmitting(false);
    setAddingSolarTechProductInFamily(null);
  };

  // PC pricing version state
  const [pcNewVersionLabel, setPcNewVersionLabel] = useState('');
  const [pcNewVersionEffectiveFrom, setPcNewVersionEffectiveFrom] = useState('');
  const [pcNewVersionTiers, setPcNewVersionTiers] = useState<{ closerPerW: string; kiloPerW: string }[]>([
    { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
    { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' },
  ]);

  // Table-level version view state
  const [stVersionView, setStVersionView] = useState<Record<string, string>>({});
  const [pcVersionView, setPcVersionView] = useState<Record<string, string>>({});

  // Duplicate All modal
  const [dupAllLabel, setDupAllLabel] = useState('');
  const [dupAllEffectiveFrom, setDupAllEffectiveFrom] = useState('');

  // Helper: generate a suggested version label like "Q2 2026 Pricing"
  const suggestVersionLabel = () => {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `Q${q} ${now.getFullYear()} Pricing`;
  };

  // Bulk Adjust panel state
  const [bulkAdjustOpen, setBulkAdjustOpen] = useState<'solartech' | 'productcatalog' | null>(null);
  const [bulkRateAdj, setBulkRateAdj] = useState('');
  const [bulkSpreadInputs, setBulkSpreadInputs] = useState<[string, string, string, string]>(['', '', '', '']);

  // Product search state
  const [stProductSearch, setStProductSearch] = useState('');
  const [pcProductSearch, setPcProductSearch] = useState('');

  // Tier input refs
  const tierInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const setTierInputRef = (key: string, el: HTMLInputElement | null) => {
    if (el) tierInputRefs.current.set(key, el);
    else tierInputRefs.current.delete(key);
  };

  // Delta badge snapshot
  const originalTierValues = useRef<Map<string, number>>(new Map());
  const hasSnapshotted = useRef<string>('');

  // Baseline sort state
  type BaselineSortKey = 'installer' | 'closer' | 'kilo';
  const [baselineSortKey, setBaselineSortKey] = useState<BaselineSortKey>('installer');
  const [baselineSortDir, setBaselineSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleBaselineSort = (key: BaselineSortKey) => {
    if (baselineSortKey === key) setBaselineSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setBaselineSortKey(key); setBaselineSortDir('asc'); }
  };

  // SolarTech family sub-tab
  const [stFamily, setStFamily] = useState<SolarTechFamily>('Goodleap');
  const stFamilyRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [stFamilyIndicator, setStFamilyIndicator] = useState<{ left: number; width: number } | null>(null);

  // PC family sub-tab
  const pcFamilyTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pcFamilyIndicator, setPcFamilyIndicator] = useState<{ left: number; width: number } | null>(null);

  // Baseline tab indicator
  const baselineTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [baselineIndicator, setBaselineIndicator] = useState<{ left: number; width: number } | null>(null);

  // Confirm action dialog
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // ── Effects ─────────────────────────────────────────────────────────────────
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

  // Snapshot original tier values for delta badges
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

  // Clear product search on family tab change
  useEffect(() => { setStProductSearch(''); }, [stFamily]);
  useEffect(() => { setPcProductSearch(''); }, [baselineTab, pcFamily]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
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

  const renderDeltaBadge = (productId: string, tierIndex: number, field: 'closer' | 'kilo', currentValue: number) => {
    const key = `${productId}-${tierIndex}-${field}`;
    const original = originalTierValues.current.get(key);
    if (original === undefined) return null;
    const delta = Math.round((currentValue - original) * 100) / 100;
    if (delta === 0) return null;
    const isPositive = delta > 0;
    return (
      <span className={`text-[9px] font-medium leading-none ${isPositive ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}`}>
        {isPositive ? '+' : ''}{delta.toFixed(2)}
      </span>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div key="baselines" className="animate-tab-enter">
      <SectionHeader title="Baselines" subtitle="Standard installer rates and SolarTech product pricing" />

      {/* Sub-tabs */}
      {(() => {
        const pcInstallerNames = Object.keys(productCatalogInstallerConfigs).filter((n) => n !== 'SolarTech');
        const allTabs = ['standard', 'solartech', ...pcInstallerNames];
        return (
          <div className="flex gap-1 mb-5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container flex-wrap">
            {baselineIndicator && <div className="tab-indicator" style={baselineIndicator} />}
            {allTabs.map((t, i) => (
              <button
                key={t}
                ref={(el) => { baselineTabRefs.current[i] = el; }}
                onClick={() => setBaselineTab(t)}
                className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.97] ${
                  baselineTab === t ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
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
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <div>
              <h2 className="text-[var(--text-primary)] font-semibold">Standard Installer Baselines</h2>
              <p className="text-[var(--text-muted)] text-xs mt-0.5">Click the pencil to edit · Setter defaults to Closer + $0.10/W (leave blank) · Kilo = company margin floor</p>
            </div>
            <button
              onClick={() => setShowSubDealerRates((v) => !v)}
              className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            >
              <span>Sub-Dealer Rates</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showSubDealerRates ? 'bg-amber-500' : 'bg-[var(--border)]'}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${showSubDealerRates ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-header-frost">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th
                    className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => toggleBaselineSort('installer')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Installer
                      {baselineSortKey === 'installer' && (
                        baselineSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 text-[var(--text-secondary)] font-medium">Structure</th>
                  <th
                    className="text-right px-4 py-3 text-[var(--text-secondary)] font-medium cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors"
                    onClick={() => toggleBaselineSort('closer')}
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      Closer $/W
                      {baselineSortKey === 'closer' && (
                        baselineSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 text-[var(--text-secondary)] font-medium">Setter $/W</th>
                  <th
                    className="text-right px-4 py-3 text-[var(--text-secondary)] font-medium cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors"
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
                    <th className="text-right px-4 py-3 text-[var(--accent-amber-text)]/80 font-medium text-xs">SD Rate</th>
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
                  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
                      <tr className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-card)]/30 transition-colors group">
                        <td className="px-5 py-3 text-[var(--text-primary)] font-medium">
                          {installer}
                          {historyCount > 0 && (
                            <button
                              onClick={() => setShowVersionHistory(isShowingHistory ? null : installer)}
                              className="ml-2 text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors inline-flex items-center gap-0.5"
                              title="View version history"
                            >
                              <History className="w-3 h-3" />
                              <span className="text-[10px]">{historyCount}</span>
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--text-secondary)]">
                            Standard
                          </span>
                        </td>
                        {isEditing ? (
                          <>
                            <td className="px-4 py-2 text-right">
                              <input type="number" step="0.01" min="0"
                                value={editInstallerVals.closerPerW}
                                onChange={(e) => setEditInstallerVals((v) => ({ ...v, closerPerW: e.target.value }))}
                                className="w-20 bg-[var(--border)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
                              />
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input type="number" step="0.01" min="0"
                                value={editInstallerVals.setterPerW}
                                placeholder={editInstallerVals.closerPerW ? String(Math.round((parseFloat(editInstallerVals.closerPerW) + 0.10) * 100) / 100) : '\u2014'}
                                onChange={(e) => setEditInstallerVals((v) => ({ ...v, setterPerW: e.target.value }))}
                                className="w-20 bg-[var(--border)] border border-[var(--border)] text-[var(--accent-purple-text)] rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
                              />
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input type="number" step="0.01" min="0"
                                value={editInstallerVals.kiloPerW}
                                onChange={(e) => setEditInstallerVals((v) => ({ ...v, kiloPerW: e.target.value }))}
                                className="w-20 bg-[var(--border)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
                              />
                            </td>
                            {showSubDealerRates && (
                              <td className="px-4 py-2 text-right">
                                <input type="number" step="0.01" min="0"
                                  value={editInstallerVals.subDealerPerW}
                                  placeholder="\u2014"
                                  onChange={(e) => setEditInstallerVals((v) => ({ ...v, subDealerPerW: e.target.value }))}
                                  className="w-20 bg-[var(--border)] border border-[var(--border)] text-[var(--accent-amber-text)] rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"
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
                                }} className="text-[var(--accent-emerald-text)] hover:text-[var(--accent-cyan-text)] transition-colors">
                                  <Check className="w-4 h-4" />
                                </button>
                                <button onClick={() => setEditingInstaller(null)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-[var(--accent-emerald-text)] font-medium text-right">${rates.closerPerW.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-medium text-xs ${hasCustomSetter ? 'text-[var(--accent-purple-text)]' : 'text-[var(--accent-purple-text)]/60'}`}>
                                ${displaySetter.toFixed(2)}
                                {!hasCustomSetter && <span className="text-[var(--text-dim)] ml-1 text-[10px]">auto</span>}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[var(--accent-emerald-text)] font-medium text-right">${rates.kiloPerW.toFixed(2)}</td>
                            {showSubDealerRates && (
                              <td className="px-4 py-3 text-right">
                                {rates.subDealerPerW != null
                                  ? <span className="text-[var(--accent-amber-text)] font-medium">${rates.subDealerPerW.toFixed(2)}</span>
                                  : <span className="text-[var(--text-dim)]">&mdash;</span>}
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
                                  className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setNewVersionFor(installer);
                                    setNewVersionLabel(suggestVersionLabel());
                                    setNewVersionEffectiveFrom('');
                                    const avRates = activeVersion?.rates;
                                    const avFlat = avRates?.type === 'flat' ? avRates : null;
                                    setNewVersionVals(avFlat
                                      ? { closerPerW: String(avFlat.closerPerW), setterPerW: avFlat.setterPerW != null ? String(avFlat.setterPerW) : '', kiloPerW: String(avFlat.kiloPerW) }
                                      : { closerPerW: '2.90', setterPerW: '', kiloPerW: '2.35' });
                                  }}
                                  title="Create new pricing version"
                                  className="text-[var(--text-dim)] hover:text-[var(--accent-emerald-text)] transition-colors"
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
                        <tr key={v.id} className="border-b border-[var(--border-subtle)]/30 bg-[var(--surface-card)]/20">
                          <td className="px-5 py-2 pl-10 text-[var(--text-muted)] text-xs">{v.label}</td>
                          <td className="px-4 py-2 text-right">
                            <span className="text-[10px] text-[var(--text-dim)]">Standard</span>
                          </td>
                          <td colSpan={2} className="px-4 py-2 text-[var(--text-dim)] text-xs text-right">
                            {v.effectiveFrom} &rarr; {v.effectiveTo}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-dim)] text-right text-xs">
                            {v.rates.type === 'flat' ? `$${v.rates.closerPerW.toFixed(2)} / $${v.rates.kiloPerW.toFixed(2)}` : 'Tiered'}
                          </td>
                          {showSubDealerRates && (
                            <td className="px-4 py-2 text-[var(--text-dim)] text-right text-xs">
                              {v.rates.type === 'flat' && v.rates.subDealerPerW != null ? `$${v.rates.subDealerPerW.toFixed(2)}` : '\u2014'}
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

      {/* New Version Modal */}
      {newVersionFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'var(--surface-overlay)' }}>
          <div className="bg-[var(--surface)] border border-[var(--border)]/80 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-black/40 animate-modal-panel">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[var(--text-primary)] font-bold">New Pricing Version</h3>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">{newVersionFor} &mdash; closes current version on the day before effective date</p>
              </div>
              <button onClick={() => setNewVersionFor(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">Version label</label>
                  <input type="text" placeholder="e.g. v2 — March 2025"
                    value={newVersionLabel} onChange={(e) => setNewVersionLabel(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">Effective from</label>
                  <input type="date"
                    value={newVersionEffectiveFrom} onChange={(e) => setNewVersionEffectiveFrom(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">Closer $/W</label>
                  <input type="number" step="0.01" min="0"
                    value={newVersionVals.closerPerW} onChange={(e) => setNewVersionVals((v) => ({ ...v, closerPerW: e.target.value }))}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">Setter $/W</label>
                  <input type="number" step="0.01" min="0"
                    value={newVersionVals.setterPerW}
                    placeholder={newVersionVals.closerPerW ? String(Math.round((parseFloat(newVersionVals.closerPerW) + 0.10) * 100) / 100) : 'auto'}
                    onChange={(e) => setNewVersionVals((v) => ({ ...v, setterPerW: e.target.value }))}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-purple-text)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">Kilo $/W</label>
                  <input type="number" step="0.01" min="0"
                    value={newVersionVals.kiloPerW} onChange={(e) => setNewVersionVals((v) => ({ ...v, kiloPerW: e.target.value }))}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setNewVersionFor(null)}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors"
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
                className="flex-1 py-2 rounded-xl text-sm font-medium text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Create Version
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTE: The remainder of BaselinesSection (Product Catalog tables, SolarTech tables,
         PC New Version Modal, Duplicate All Modal, Bulk Adjust panels) continues below.
         Due to the massive size (~1700 lines), only the standard baseline table and
         version modal are shown inline above. The full Product Catalog and SolarTech
         sections follow the exact same pattern from the original page.tsx lines 3107-4327.
         They are included in full below. */}

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
              <div className="flex gap-1 mb-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container">
                {pcFamilyIndicator && <div className="tab-indicator" style={pcFamilyIndicator} />}
                {config.families.map((fam, i) => {
                  const pcFamCount = productCatalogProducts.filter((p) => p.installer === installerName && p.family === fam).length;
                  return (
                  <button
                    key={fam}
                    ref={(el) => { pcFamilyTabRefs.current[i] = el; }}
                    onClick={() => setPcFamily((prev) => ({ ...prev, [installerName]: fam }))}
                    className={`relative z-10 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.97] ${
                      currentFamily === fam ? 'text-[var(--text-primary)]' : pcFamCount === 0 ? 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {fam} <span className={`ml-0.5 ${currentFamily === fam ? 'text-[var(--text-secondary)]' : 'text-[var(--text-dim)]'}`}>({pcFamCount})</span>
                  </button>
                  );
                })}
              </div>
            )}

            {/* Action bar */}
            {(() => {
              const versionKey = `${installerName}::${currentFamily}`;
              const currentView = pcVersionView[versionKey] ?? 'current';
              const familyProductIds = new Set(filteredProducts.map((p) => p.id));
              const familyVersions = productCatalogPricingVersions.filter((v) => familyProductIds.has(v.productId) && v.effectiveTo !== null);
              const versionGroups = new Map<string, { label: string; effectiveFrom: string; effectiveTo: string }>();
              familyVersions.forEach((v) => {
                const key = `${v.label}|${v.effectiveFrom}`;
                if (!versionGroups.has(key)) versionGroups.set(key, { label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo ?? '' });
              });
              const sortedGroups = [...versionGroups.entries()].sort((a, b) => b[1].effectiveFrom.localeCompare(a[1].effectiveFrom));
              const isViewingArchive = currentView !== 'current';
              return (
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <select
                    value={currentView}
                    onChange={(e) => setPcVersionView((prev) => ({ ...prev, [versionKey]: e.target.value }))}
                    className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
                  >
                    <option value="current">Current (editable)</option>
                    {sortedGroups.map(([key, g]) => (
                      <option key={key} value={key}>{g.label} &mdash; {g.effectiveFrom}</option>
                    ))}
                  </select>
                  {isViewingArchive && (
                    <>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[var(--accent-amber-text)] text-[10px] font-medium">
                        <History className="w-3 h-3" />
                        Viewing archived version
                        {(() => { const g = versionGroups.get(currentView); return g ? ` \u00b7 ${g.effectiveFrom} \u2192 ${g.effectiveTo}` : ''; })()}
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 border border-red-500/30 text-[var(--accent-red-text)] hover:bg-red-500/20 hover:text-[var(--accent-red-text)] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete Version
                      </button>
                    </>
                  )}
                  {!isViewingArchive && (
                    <>
                      <button
                        onClick={() => { setDupAllOpen('productcatalog'); setDupAllLabel(suggestVersionLabel()); setDupAllEffectiveFrom(''); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)] transition-colors"
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
                          ? 'bg-[var(--accent-emerald-solid)]/15 border-[var(--accent-emerald-solid)]/30 text-[var(--accent-emerald-text)]'
                          : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)]'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" /> Bulk Adjust
                      {bulkAdjustOpen === 'productcatalog' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Bulk Adjust Panel — Product Catalog.
                Backed by POST /api/baselines/bulk-tier-adjust (single
                transaction). Search filter respected. */}
            {bulkAdjustOpen === 'productcatalog' && (() => {
              const searchActive = pcProductSearch.trim().length > 0;
              const targetProducts = searchActive
                ? filteredProducts.filter((p) => p.name.toLowerCase().includes(pcProductSearch.toLowerCase().trim()))
                : filteredProducts;
              const adjVal = parseFloat(bulkRateAdj) || 0;
              const spreadVals = bulkSpreadInputs.map((v) => parseFloat(v));
              const anySpreadSet = spreadVals.some((v) => !isNaN(v) && v !== 0);

              const applyAdjust = async () => {
                const selections = targetProducts.flatMap((p) => p.tiers.map((_t, ti) => ({ productId: p.id, tierIndex: ti, isSolarTech: false })));
                try {
                  const result = await applyBulkTierAdjust({ operation: 'adjust', adjustment: adjVal }, selections);
                  if (result.skipped.length > 0) console.warn('[bulk-adjust] skipped:', result.skipped);
                  toast(`Closer adjusted by $${adjVal >= 0 ? '+' : ''}${adjVal.toFixed(2)}/W on ${result.affected} tier${result.affected === 1 ? '' : 's'}${searchActive ? ` matching "${pcProductSearch.trim()}"` : ''}`, 'success');
                  setBulkRateAdj('');
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Bulk adjust failed';
                  toast(msg.includes('step_up_required') ? 'Re-authentication required for large adjustments. Sign out and back in, then retry.' : msg, 'error');
                }
              };

              const applySpreads = async () => {
                const spreadByTierIndex: Record<string, number> = {};
                spreadVals.forEach((v, i) => { if (!isNaN(v) && v !== 0) spreadByTierIndex[String(i)] = v; });
                const selections = targetProducts.flatMap((p) => p.tiers.map((_t, ti) => ({ productId: p.id, tierIndex: ti, isSolarTech: false })))
                  .filter((s) => spreadByTierIndex[String(s.tierIndex)] !== undefined);
                try {
                  const result = await applyBulkTierAdjust({ operation: 'spread', spreadByTierIndex }, selections);
                  if (result.skipped.length > 0) console.warn('[bulk-spread] skipped:', result.skipped);
                  toast(`Closer spreads applied to ${result.affected} tier${result.affected === 1 ? '' : 's'}${searchActive ? ` matching "${pcProductSearch.trim()}"` : ''}`, 'success');
                  setBulkSpreadInputs(['', '', '', '']);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Bulk spreads failed', 'error');
                }
              };

              return (
                <div className="card-surface rounded-xl p-4 mb-3 space-y-4 max-w-3xl motion-safe:animate-[fadeUpIn_220ms_cubic-bezier(0.16,1,0.3,1)_both]">
                  <div>
                    <p className="text-[var(--text-primary)] text-xs font-semibold mb-2">Bulk Rate Adjustment</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-[var(--text-secondary)] text-xs whitespace-nowrap">Adjust closer baselines by</label>
                      <div className="flex items-center gap-1">
                        <span className="text-[var(--text-muted)] text-xs">$</span>
                        <input type="number" step="0.01" value={bulkRateAdj} onChange={(e) => setBulkRateAdj(e.target.value)} placeholder="+/- 0.00"
                          className="w-24 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                        <span className="text-[var(--text-muted)] text-xs">/W</span>
                      </div>
                      {adjVal !== 0 && (
                        <span className="text-[var(--text-muted)] text-[10px]">
                          {targetProducts.length} {searchActive ? 'matching' : ''} product{targetProducts.length === 1 ? '' : 's'} × 4 tiers affected
                          {searchActive && <span className="text-[var(--accent-amber-text)]"> (filtered)</span>}
                        </span>
                      )}
                      <button disabled={adjVal === 0 || targetProducts.length === 0} onClick={applyAdjust} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-transform active:scale-[0.985]" style={{ backgroundColor: 'var(--brand)', color: 'var(--text-on-accent)' }}>Apply</button>
                    </div>
                  </div>
                  <div className="border-t border-[var(--border-subtle)] pt-4">
                    <p className="text-[var(--text-primary)] text-xs font-semibold mb-2">Kilo Spread Minimums</p>
                    <p className="text-[var(--text-muted)] text-[10px] mb-2">Sets closerPerW = kiloPerW + spread for each tier (Kilo rate is the anchor)</p>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {['Under 5kW', '5-10kW', '10-13kW', '13+ kW'].map((label, i) => (
                        <div key={label}>
                          <p className="text-[10px] text-[var(--text-muted)] mb-1 text-center">{label} spread</p>
                          <div className="flex items-center gap-1 justify-center">
                            <span className="text-[var(--text-muted)] text-xs">$</span>
                            <input type="number" step="0.01" min="0" value={bulkSpreadInputs[i]} onChange={(e) => setBulkSpreadInputs((prev) => { const next = [...prev] as [string, string, string, string]; next[i] = e.target.value; return next; })} placeholder="0.00"
                              className="w-16 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                          </div>
                        </div>
                      ))}
                    </div>
                    {anySpreadSet && (
                      <p className="text-[var(--text-muted)] text-[10px] mb-2">
                        Preview: {targetProducts.length} {searchActive ? 'matching' : ''} product{targetProducts.length === 1 ? '' : 's'} will have closer baselines recalculated per tier
                        {searchActive && <span className="text-[var(--accent-amber-text)]"> (filtered)</span>}
                      </p>
                    )}
                    <button disabled={!anySpreadSet || targetProducts.length === 0} onClick={applySpreads} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-transform active:scale-[0.985]" style={{ backgroundColor: 'var(--brand)', color: 'var(--text-on-accent)' }}>Apply Spreads</button>
                  </div>
                </div>
              );
            })()}

            {/* Product table */}
            {(() => {
              const pcVKey = `${installerName}::${currentFamily}`;
              const pcCurrentView = pcVersionView[pcVKey] ?? 'current';
              const pcIsArchive = pcCurrentView !== 'current';
              const [pcArchiveLabel, pcArchiveFrom] = pcIsArchive ? pcCurrentView.split('|') : ['', ''];
              const pcDisplayProducts = pcProductSearch.trim() ? filteredProducts.filter((p) => p.name.toLowerCase().includes(pcProductSearch.toLowerCase().trim())) : filteredProducts;
              const pcDisplayProductIds = pcDisplayProducts.map((p) => p.id);
              const pcSummaryCount = filteredProducts.length;
              const pcAllClosers = filteredProducts.flatMap((p) => p.tiers.map((t) => t.closerPerW));
              const pcSpreadMin = pcAllClosers.length > 0 ? Math.min(...pcAllClosers) : 0;
              const pcSpreadMax = pcAllClosers.length > 0 ? Math.max(...pcAllClosers) : 0;
              return (
                <div className="card-surface rounded-xl overflow-hidden max-w-3xl">
                  <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-[var(--text-primary)] font-semibold">{installerName} &mdash; {currentFamily}</h2>
                        <p className="text-[var(--text-muted)] text-xs mt-0.5">{pcIsArchive ? 'Viewing archived version (read-only)' : 'Click any value to edit \u00b7 Setter = Closer + $0.10/W auto-calculated'}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setShowSubDealerRates((v) => !v)} className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0">
                          <span>SD Rate</span>
                          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showSubDealerRates ? 'bg-amber-500' : 'bg-[var(--border)]'}`}>
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${showSubDealerRates ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                          </span>
                        </button>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                          <input type="text" placeholder="Search products..." value={pcProductSearch} onChange={(e) => setPcProductSearch(e.target.value)}
                            className="w-48 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="table-header-frost">
                        <tr className="border-b border-[var(--border-subtle)]">
                          <th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Product</th>
                          {['1\u20135 kW', '5\u201310 kW', '10\u201313 kW', '13+ kW'].map((label) => (
                            <th key={label} className="text-center px-4 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">{label}</th>
                          ))}
                          <th className="px-4 py-3 w-10" />
                        </tr>
                        {showSubDealerRates && <tr><td colSpan={6} className="px-4 py-1 text-[var(--accent-amber-text)]/60 text-[10px] text-right">Amber values = Sub-Dealer Rate</td></tr>}
                      </thead>
                      <tbody>
                        {filteredProducts.length > 0 && (
                          <tr className="bg-[var(--surface-card)]/60 border-b border-[var(--border-subtle)]">
                            <td className="px-5 py-2 text-[var(--text-secondary)] text-xs font-medium">{pcSummaryCount} product{pcSummaryCount !== 1 ? 's' : ''}</td>
                            {[0, 1, 2, 3].map((ti) => {
                              const profits = filteredProducts.map((p) => (p.tiers[ti]?.closerPerW ?? 0) - (p.tiers[ti]?.kiloPerW ?? 0));
                              const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
                              return <td key={ti} className="px-2 py-2 text-center"><span className={`text-[10px] font-semibold ${avgProfit > 0 ? 'text-[var(--accent-emerald-text)]/70' : 'text-[var(--accent-red-text)]/70'}`}>${avgProfit.toFixed(2)} profit</span></td>;
                            })}
                            {showSubDealerRates && <td />}
                            <td className="px-4 py-2 text-center"><span className="text-[var(--text-muted)] text-[10px]">{`$${pcSpreadMin.toFixed(2)}\u2013$${pcSpreadMax.toFixed(2)}`}</span></td>
                          </tr>
                        )}
                        {pcDisplayProducts.map((product) => {
                          const pcAllVersions = productCatalogPricingVersions.filter((v) => v.productId === product.id);
                          const archiveVersion = pcIsArchive ? pcAllVersions.find((v) => v.label === pcArchiveLabel && v.effectiveFrom === pcArchiveFrom) : null;
                          return (
                            <tr key={product.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-card)]/30 transition-colors group">
                              <td className="px-5 py-3 text-[var(--text-primary)] text-xs max-w-[200px]">
                                {editingProductName === product.id ? (
                                  <input autoFocus type="text" value={editProductNameVal} onChange={(e) => setEditProductNameVal(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        const result = validateProductName(editProductNameVal, product.name, filteredProducts, product.id);
                                        if (!result.ok) { toast(result.reason, 'error'); return; }
                                        if (result.name !== product.name) { updateProductCatalogProduct(product.id, { name: result.name }); toast(`Renamed to "${result.name}"`, 'success'); }
                                        productNameSavedRef.current = true; setEditingProductName(null);
                                      } else if (e.key === 'Escape') { productNameSavedRef.current = true; setEditingProductName(null); }
                                    }}
                                    onBlur={() => {
                                      if (productNameSavedRef.current) { productNameSavedRef.current = false; return; }
                                      const result = validateProductName(editProductNameVal, product.name, filteredProducts, product.id);
                                      if (!result.ok) { toast(result.reason, 'error'); setEditingProductName(null); return; }
                                      if (result.name !== product.name) { updateProductCatalogProduct(product.id, { name: result.name }); toast(`Renamed to "${result.name}"`, 'success'); }
                                      setEditingProductName(null);
                                    }}
                                    className="w-full bg-[var(--surface-card)] border border-[var(--accent-emerald-solid)] text-[var(--text-primary)] rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />
                                ) : (
                                  <span className="cursor-pointer hover:text-[var(--accent-cyan-text)] transition-colors inline-flex items-center gap-1.5 group/name" onClick={() => { if (!pcIsArchive) { setEditingProductName(product.id); setEditProductNameVal(product.name); } }}>
                                    {product.name}
                                    {!pcIsArchive && <Pencil className="w-3 h-3 text-[var(--text-dim)] opacity-0 group-hover/name:opacity-100 transition-opacity" />}
                                  </span>
                                )}
                                {pcIsArchive && !archiveVersion && <span className="ml-2 text-[var(--text-dim)] text-[10px]">(no data for this version)</span>}
                              </td>
                              {pcIsArchive ? (
                                archiveVersion ? archiveVersion.tiers.map((tier, ti) => (
                                  <td key={ti} className="px-2 py-2 text-center"><div className="flex flex-col gap-1 items-center"><span className="text-[var(--accent-emerald-text)]/60 font-medium text-xs">${tier.closerPerW.toFixed(2)}</span><span className="text-[var(--accent-emerald-text)]/50 text-xs">${tier.kiloPerW.toFixed(2)}</span></div></td>
                                )) : <td colSpan={4} className="px-4 py-3 text-center text-[var(--text-dim)] text-xs">No version data</td>
                              ) : (
                                product.tiers.map((tier, ti) => (
                                  <td key={ti} className="px-2 py-2 text-center">
                                    <div className="flex flex-col gap-0.5 items-center">
                                      <input ref={(el) => setTierInputRef(`${product.id}-${ti}-closer`, el)} type="number" step="0.01" min="0" value={tier.closerPerW} onFocus={(e) => e.target.select()} onChange={(e) => updateProductCatalogTier(product.id, ti, { closerPerW: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleTierKeyDown(e, pcDisplayProductIds, product.id, ti, 'closer')}
                                        className="w-16 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)] font-medium rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />
                                      {renderDeltaBadge(product.id, ti, 'closer', tier.closerPerW)}
                                      <input ref={(el) => setTierInputRef(`${product.id}-${ti}-kilo`, el)} type="number" step="0.01" min="0" value={tier.kiloPerW} onFocus={(e) => e.target.select()} onChange={(e) => updateProductCatalogTier(product.id, ti, { kiloPerW: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleTierKeyDown(e, pcDisplayProductIds, product.id, ti, 'kilo')}
                                        className="w-16 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)]/80 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />
                                      {renderDeltaBadge(product.id, ti, 'kilo', tier.kiloPerW)}
                                      {showSubDealerRates && <input type="number" step="0.01" min="0" value={tier.subDealerPerW ?? ''} placeholder="\u2014" onFocus={(e) => e.target.select()} onChange={(e) => { const val = e.target.value === '' ? undefined : parseFloat(e.target.value) || 0; updateProductCatalogTier(product.id, ti, { subDealerPerW: val }); }} className="w-16 bg-[var(--surface-card)] border border-amber-700/50 text-[var(--accent-amber-text)] rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-500" />}
                                    </div>
                                  </td>
                                ))
                              )}
                              <td className="px-4 py-3 text-center">
                                {!pcIsArchive && (
                                  <div className="flex items-center gap-2 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setPcNewVersionFor(product.id); setPcNewVersionLabel(suggestVersionLabel()); setPcNewVersionEffectiveFrom(''); setPcNewVersionTiers(product.tiers.map((t) => ({ closerPerW: String(t.closerPerW), kiloPerW: String(t.kiloPerW) }))); }} title="Create new pricing version" className="text-[var(--text-dim)] hover:text-[var(--accent-emerald-text)] transition-colors"><GitBranch className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => { setConfirmAction({ title: `Delete ${product.name}?`, message: 'Existing deals are unaffected.', onConfirm: async () => { try { await removeProductCatalogProduct(product.id); toast('Product removed', 'info'); } catch { toast('Failed to delete product', 'error'); } setConfirmAction(null); } }); }} className="text-[var(--text-dim)] hover:text-[var(--accent-red-text)] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {pcDisplayProducts.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[var(--text-dim)]">{pcProductSearch.trim() ? 'No products match your search.' : 'No products for this family.'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-3 border-t border-[var(--border-subtle)]/50 bg-[var(--surface-card)]/20">
                    <p className="text-xs text-[var(--text-dim)]">Green = Closer $/W · Blue = Kilo $/W · Setter = Closer + $0.10/W (auto)</p>
                  </div>
                </div>
              );
            })()}

            {/* Add product */}
            <div className="mt-4 max-w-3xl">
              {addingProductFor === installerName ? (
                <div className="card-surface rounded-xl p-4">
                  <p className="text-[var(--text-primary)] text-sm font-medium mb-3">Add Product to {installerName}</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div><label className="block text-xs text-[var(--text-secondary)] mb-1">Product name</label><input type="text" placeholder="e.g. SunPower 400W" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" /></div>
                    <div><label className="block text-xs text-[var(--text-secondary)] mb-1">Family</label><select value={newProductFamily || currentFamily} onChange={(e) => setNewProductFamily(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]">{config.families.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
                  </div>
                  <div className="mb-3">
                    <p className="text-xs text-[var(--text-secondary)] mb-2">Tier Pricing ($/W)</p>
                    <div className="space-y-2">
                      {[{ label: '1\u20135 kW', idx: 0, cPlaceholder: '2.90', kPlaceholder: '2.35' }, { label: '5\u201310 kW', idx: 1, cPlaceholder: '2.85', kPlaceholder: '2.30' }, { label: '10\u201313 kW', idx: 2, cPlaceholder: '2.80', kPlaceholder: '2.25' }, { label: '13+ kW', idx: 3, cPlaceholder: '2.75', kPlaceholder: '2.20' }].map(({ label, idx, cPlaceholder, kPlaceholder }) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-muted)] w-16 flex-shrink-0">{label}</span>
                          <div className="flex items-center gap-1 flex-1"><span className="text-[10px] text-[var(--text-dim)]">Closer</span><input type="number" step="0.01" min="0" placeholder={cPlaceholder} value={newProductTiers[idx].closerPerW} onChange={(e) => setNewProductTiers((prev) => prev.map((t, i) => i === idx ? { ...t, closerPerW: e.target.value } : t))} className="w-20 bg-[var(--border)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" /></div>
                          <div className="flex items-center gap-1 flex-1"><span className="text-[10px] text-[var(--text-dim)]">Kilo</span><input type="number" step="0.01" min="0" placeholder={kPlaceholder} value={newProductTiers[idx].kiloPerW} onChange={(e) => setNewProductTiers((prev) => prev.map((t, i) => i === idx ? { ...t, kiloPerW: e.target.value } : t))} className="w-20 bg-[var(--border)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => { const name = newProductName.trim(); if (!name) return; const family = newProductFamily || currentFamily; const defaultCloser = [2.90, 2.85, 2.80, 2.75]; const defaultKilo = [2.35, 2.30, 2.25, 2.20]; const closerArr = newProductTiers.map((t, i) => t.closerPerW ? parseFloat(t.closerPerW) : defaultCloser[i]); const kiloArr = newProductTiers.map((t, i) => t.kiloPerW ? parseFloat(t.kiloPerW) : defaultKilo[i]); addProductCatalogProduct({ id: `pc_${installerName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`, installer: installerName, family, name, tiers: makeProductCatalogTiers(closerArr, kiloArr) }); toast('Product added', 'success'); setNewProductName(''); setNewProductFamily(''); setNewProductTiers([{ closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }]); setAddingProductFor(null); setPcFamily((prev) => ({ ...prev, [installerName]: family })); }} className="flex-1 py-2 rounded-xl text-sm font-medium text-[var(--text-primary)] transition-colors" style={{ backgroundColor: 'var(--brand)' }}>Add Product</button>
                    <button onClick={() => { setAddingProductFor(null); setNewProductName(''); setNewProductFamily(''); setNewProductTiers([{ closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }]); }} className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setAddingProductFor(installerName); setNewProductFamily(currentFamily); setNewProductTiers([{ closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }, { closerPerW: '', kiloPerW: '' }]); }} className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors"><Plus className="w-4 h-4" /> Add product to {installerName}</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* PC New Version Modal */}
      {pcNewVersionFor && (() => {
        const pcProduct = productCatalogProducts.find((p) => p.id === pcNewVersionFor) || solarTechProducts.find((p) => p.id === pcNewVersionFor);
        return pcProduct ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'var(--surface-overlay)' }}>
            <div className="bg-[var(--surface)] border border-[var(--border)]/80 rounded-2xl p-6 w-full max-w-lg shadow-2xl shadow-black/40 animate-modal-panel">
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="text-[var(--text-primary)] font-bold">New Pricing Version</h3><p className="text-[var(--text-muted)] text-xs mt-0.5">{pcProduct.name} &mdash; closes current version on the day before effective date</p></div>
                <button onClick={() => setPcNewVersionFor(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs text-[var(--text-secondary)] mb-1">Version label</label><input type="text" placeholder="e.g. v2 — March 2026" value={pcNewVersionLabel} onChange={(e) => setPcNewVersionLabel(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" /></div>
                  <div><label className="block text-xs text-[var(--text-secondary)] mb-1">Effective from</label><input type="date" value={pcNewVersionEffectiveFrom} onChange={(e) => setPcNewVersionEffectiveFrom(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]" /></div>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-2">Tier pricing (Closer $/W · Kilo $/W)</p>
                  <div className="grid grid-cols-4 gap-2">
                    {['1\u20135 kW', '5\u201310 kW', '10\u201313 kW', '13+ kW'].map((bracket, i) => (
                      <div key={bracket} className="space-y-1">
                        <p className="text-[10px] text-[var(--text-muted)] text-center">{bracket}</p>
                        <input type="number" step="0.01" min="0" value={pcNewVersionTiers[i]?.closerPerW ?? ''} onChange={(e) => setPcNewVersionTiers((prev) => prev.map((t, idx) => idx === i ? { ...t, closerPerW: e.target.value } : t))} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)] rounded-xl px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" placeholder="Closer" />
                        <input type="number" step="0.01" min="0" value={pcNewVersionTiers[i]?.kiloPerW ?? ''} onChange={(e) => setPcNewVersionTiers((prev) => prev.map((t, idx) => idx === i ? { ...t, kiloPerW: e.target.value } : t))} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)] rounded-xl px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" placeholder="Kilo" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setPcNewVersionFor(null)} className="flex-1 py-2 rounded-xl text-sm font-medium bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors">Cancel</button>
                <button onClick={() => { if (!pcNewVersionLabel.trim() || !pcNewVersionEffectiveFrom) return; const hasNonZeroRate = pcNewVersionTiers.some((t) => parseFloat(t.closerPerW) > 0); if (!hasNonZeroRate) { toast('At least one tier must have a closer rate greater than $0.00/W', 'error'); return; } const tiers: ProductCatalogTier[] = pcNewVersionTiers.map((t, i) => { const breaks = [1, 5, 10, 13]; const maxBreaks = [5, 10, 13, null]; return { minKW: breaks[i], maxKW: maxBreaks[i], closerPerW: parseFloat(t.closerPerW) || 0, setterPerW: Math.round(((parseFloat(t.closerPerW) || 0) + 0.10) * 100) / 100, kiloPerW: parseFloat(t.kiloPerW) || 0 }; }); createNewProductCatalogVersion(pcNewVersionFor!, pcNewVersionLabel.trim(), pcNewVersionEffectiveFrom, tiers); setPcNewVersionFor(null); toast('Pricing version created', 'success'); }} disabled={!pcNewVersionLabel.trim() || !pcNewVersionEffectiveFrom} className="flex-1 py-2 rounded-xl text-sm font-medium text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" style={{ backgroundColor: 'var(--brand)' }}>Create Version</button>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {/* Duplicate All as New Version Modal */}
      {dupAllOpen && (() => {
        const isSt = dupAllOpen === 'solartech';
        const targetProducts = isSt ? solarTechProducts.filter((p) => p.family === stFamily) : (() => { const installerName = baselineTab; const config = productCatalogInstallerConfigs[installerName]; if (!config) return []; const currentFamily = pcFamily[installerName] ?? config.families[0] ?? ''; return productCatalogProducts.filter((p) => p.installer === installerName && p.family === currentFamily); })();
        const familyLabel = isSt ? stFamily : (() => { const config = productCatalogInstallerConfigs[baselineTab]; return config ? `${baselineTab} \u2014 ${pcFamily[baselineTab] ?? config.families[0] ?? ''}` : baselineTab; })();
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'var(--surface-overlay)' }}>
            <div className="bg-[var(--surface)] border border-[var(--border)]/80 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-black/40 animate-modal-panel">
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="text-[var(--text-primary)] font-bold">Duplicate All as New Version</h3><p className="text-[var(--text-muted)] text-xs mt-0.5">Snapshot current pricing for {targetProducts.length} product{targetProducts.length !== 1 ? 's' : ''} in {familyLabel}</p></div>
                <button onClick={() => setDupAllOpen(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-3">
                <div><label className="block text-xs text-[var(--text-secondary)] mb-1">Version label</label><input type="text" placeholder="e.g. Q2 2026 Pricing" value={dupAllLabel} onChange={(e) => setDupAllLabel(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" /></div>
                <div><label className="block text-xs text-[var(--text-secondary)] mb-1">Effective from</label><input type="date" value={dupAllEffectiveFrom} onChange={(e) => setDupAllEffectiveFrom(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]" /></div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setDupAllOpen(null)} className="flex-1 py-2 rounded-xl text-sm font-medium bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors">Cancel</button>
                <button onClick={() => { if (!dupAllLabel.trim() || !dupAllEffectiveFrom) return; const breaks = [1, 5, 10, 13]; const maxBreaks: (number | null)[] = [5, 10, 13, null]; targetProducts.forEach((product) => { const tiers: ProductCatalogTier[] = product.tiers.map((t, i) => ({ minKW: breaks[i], maxKW: maxBreaks[i], closerPerW: t.closerPerW, setterPerW: Math.round((t.closerPerW + 0.10) * 100) / 100, kiloPerW: t.kiloPerW })); createNewProductCatalogVersion(product.id, dupAllLabel.trim(), dupAllEffectiveFrom, tiers); }); toast(`New version created for ${targetProducts.length} product${targetProducts.length !== 1 ? 's' : ''}`, 'success'); setDupAllOpen(null); }} disabled={!dupAllLabel.trim() || !dupAllEffectiveFrom || targetProducts.length === 0} className="flex-1 py-2 rounded-xl text-sm font-medium text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors" style={{ backgroundColor: 'var(--brand)' }}>Duplicate {targetProducts.length} Product{targetProducts.length !== 1 ? 's' : ''}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SolarTech — product family sub-tabs + tier table */}
      {baselineTab === 'solartech' && (
        <div>
          <div className="flex gap-1 mb-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container">
            {stFamilyIndicator && <div className="tab-indicator" style={stFamilyIndicator} />}
            {SOLARTECH_FAMILIES.map((fam, i) => { const famCount = solarTechProducts.filter((p) => p.family === fam).length; return (<button key={fam} ref={(el) => { stFamilyRefs.current[i] = el; }} onClick={() => setStFamily(fam)} className={`relative z-10 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.97] ${stFamily === fam ? 'text-[var(--text-primary)]' : famCount === 0 ? 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{fam} <span className={`ml-0.5 ${stFamily === fam ? 'text-[var(--text-secondary)]' : 'text-[var(--text-dim)]'}`}>({famCount})</span></button>); })}
          </div>

          {/* SolarTech Action bar */}
          {(() => {
            const stCurrentView = stVersionView[stFamily] ?? 'current';
            const stFamilyProductIds = new Set(solarTechProducts.filter((p) => p.family === stFamily).map((p) => p.id));
            const stFamilyVersions = productCatalogPricingVersions.filter((v) => stFamilyProductIds.has(v.productId) && v.effectiveTo !== null);
            const stVersionGroups = new Map<string, { label: string; effectiveFrom: string; effectiveTo: string }>();
            stFamilyVersions.forEach((v) => { const key = `${v.label}|${v.effectiveFrom}`; if (!stVersionGroups.has(key)) stVersionGroups.set(key, { label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo ?? '' }); });
            const stSortedGroups = [...stVersionGroups.entries()].sort((a, b) => b[1].effectiveFrom.localeCompare(a[1].effectiveFrom));
            const stIsArchive = stCurrentView !== 'current';
            return (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <select value={stCurrentView} onChange={(e) => setStVersionView((prev) => ({ ...prev, [stFamily]: e.target.value }))} className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]">
                  <option value="current">Current (editable)</option>
                  {stSortedGroups.map(([key, g]) => (<option key={key} value={key}>{g.label} &mdash; {g.effectiveFrom}</option>))}
                </select>
                {stIsArchive && (<><span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[var(--accent-amber-text)] text-[10px] font-medium"><History className="w-3 h-3" />Viewing archived version{(() => { const g = stVersionGroups.get(stCurrentView); return g ? ` \u00b7 ${g.effectiveFrom} \u2192 ${g.effectiveTo}` : ''; })()}</span><button onClick={() => { const [label, effectiveFrom] = stCurrentView.split('|'); setConfirmAction({ title: 'Delete Pricing Version', message: 'Delete this pricing version? This cannot be undone.', onConfirm: () => { const idsToDelete = productCatalogPricingVersions.filter((v) => stFamilyProductIds.has(v.productId) && v.label === label && v.effectiveFrom === effectiveFrom).map((v) => v.id); deleteProductCatalogPricingVersions(idsToDelete); setStVersionView((prev) => ({ ...prev, [stFamily]: 'current' })); toast('Pricing version deleted', 'success'); setConfirmAction(null); } }); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 border border-red-500/30 text-[var(--accent-red-text)] hover:bg-red-500/20 hover:text-[var(--accent-red-text)] transition-colors"><Trash2 className="w-3.5 h-3.5" /> Delete Version</button></>)}
                {!stIsArchive && (<><button onClick={() => { setDupAllOpen('solartech'); setDupAllLabel(suggestVersionLabel()); setDupAllEffectiveFrom(''); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)] transition-colors"><Copy className="w-3.5 h-3.5" /> Duplicate All as New Version</button><button onClick={() => { setBulkAdjustOpen(bulkAdjustOpen === 'solartech' ? null : 'solartech'); setBulkRateAdj(''); setBulkSpreadInputs(['', '', '', '']); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${bulkAdjustOpen === 'solartech' ? 'bg-[var(--accent-emerald-solid)]/15 border-[var(--accent-emerald-solid)]/30 text-[var(--accent-emerald-text)]' : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)]'}`}><Sliders className="w-3.5 h-3.5" /> Bulk Adjust{bulkAdjustOpen === 'solartech' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</button></>)}
              </div>
            );
          })()}

          {/* Bulk Adjust Panel — SolarTech.
              Now backed by POST /api/baselines/bulk-tier-adjust (single
              transaction). Search filter is respected — bulk operations
              target only the products visible after search trims, not the
              full family. Magnitude guard kicks in server-side via
              requireFreshAdmin for >40 selections or >$1.00/W swing. */}
          {bulkAdjustOpen === 'solartech' && (() => {
            const searchActive = stProductSearch.trim().length > 0;
            const familyProducts = solarTechProducts.filter((p) => p.family === stFamily);
            const targetProducts = searchActive
              ? familyProducts.filter((p) => p.name.toLowerCase().includes(stProductSearch.toLowerCase().trim()))
              : familyProducts;
            const adjVal = parseFloat(bulkRateAdj) || 0;
            const spreadVals = bulkSpreadInputs.map((v) => parseFloat(v));
            const anySpreadSet = spreadVals.some((v) => !isNaN(v) && v !== 0);

            const applyBulkAdjust = async () => {
              const selections = targetProducts.flatMap((p) => p.tiers.map((_t, ti) => ({ productId: p.id, tierIndex: ti, isSolarTech: true })));
              try {
                const result = await applyBulkTierAdjust({ operation: 'adjust', adjustment: adjVal }, selections);
                const skippedNote = result.skipped.length > 0 ? ` (${result.skipped.length} skipped — see browser console)` : '';
                if (result.skipped.length > 0) console.warn('[bulk-adjust] skipped:', result.skipped);
                toast(`Closer adjusted by $${adjVal >= 0 ? '+' : ''}${adjVal.toFixed(2)}/W on ${result.affected} tier${result.affected === 1 ? '' : 's'}${searchActive ? ` matching "${stProductSearch.trim()}"` : ''}${skippedNote}`, 'success');
                setBulkRateAdj('');
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Bulk adjust failed';
                if (msg.includes('step_up_required')) {
                  toast('Re-authentication required for large adjustments. Sign out and back in, then retry.', 'error');
                } else {
                  toast(msg, 'error');
                }
              }
            };

            const applyBulkSpreads = async () => {
              const spreadByTierIndex: Record<string, number> = {};
              spreadVals.forEach((v, i) => { if (!isNaN(v) && v !== 0) spreadByTierIndex[String(i)] = v; });
              const selections = targetProducts.flatMap((p) => p.tiers.map((_t, ti) => ({ productId: p.id, tierIndex: ti, isSolarTech: true })))
                .filter((s) => spreadByTierIndex[String(s.tierIndex)] !== undefined);
              try {
                const result = await applyBulkTierAdjust({ operation: 'spread', spreadByTierIndex }, selections);
                if (result.skipped.length > 0) console.warn('[bulk-spread] skipped:', result.skipped);
                toast(`Closer spreads applied to ${result.affected} tier${result.affected === 1 ? '' : 's'}${searchActive ? ` matching "${stProductSearch.trim()}"` : ''}`, 'success');
                setBulkSpreadInputs(['', '', '', '']);
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Bulk spreads failed';
                toast(msg, 'error');
              }
            };

            return (
              <div className="card-surface rounded-xl p-4 mb-3 space-y-4 motion-safe:animate-[fadeUpIn_220ms_cubic-bezier(0.16,1,0.3,1)_both]">
                <div>
                  <p className="text-[var(--text-primary)] text-xs font-semibold mb-2">Bulk Rate Adjustment</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-[var(--text-secondary)] text-xs whitespace-nowrap">Adjust closer baselines by</label>
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--text-muted)] text-xs">$</span>
                      <input type="number" step="0.01" value={bulkRateAdj} onChange={(e) => setBulkRateAdj(e.target.value)} placeholder="+/- 0.00" className="w-24 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                      <span className="text-[var(--text-muted)] text-xs">/W</span>
                    </div>
                    {adjVal !== 0 && (
                      <span className="text-[var(--text-muted)] text-[10px]">
                        {targetProducts.length} {searchActive ? 'matching' : ''} product{targetProducts.length === 1 ? '' : 's'} × 4 tiers affected
                        {searchActive && <span className="text-[var(--accent-amber-text)]"> (filtered)</span>}
                      </span>
                    )}
                    <button disabled={adjVal === 0 || targetProducts.length === 0} onClick={applyBulkAdjust} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-transform active:scale-[0.985]" style={{ backgroundColor: 'var(--brand)', color: 'var(--text-on-accent)' }}>Apply</button>
                  </div>
                </div>
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <p className="text-[var(--text-primary)] text-xs font-semibold mb-2">Kilo Spread Minimums</p>
                  <p className="text-[var(--text-muted)] text-[10px] mb-2">Sets closerPerW = kiloPerW + spread for each tier (Kilo rate is the anchor)</p>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {['Under 5kW', '5-10kW', '10-13kW', '13+ kW'].map((label, i) => (
                      <div key={label}>
                        <p className="text-[10px] text-[var(--text-muted)] mb-1 text-center">{label} spread</p>
                        <div className="flex items-center gap-1 justify-center">
                          <span className="text-[var(--text-muted)] text-xs">$</span>
                          <input type="number" step="0.01" min="0" value={bulkSpreadInputs[i]} onChange={(e) => setBulkSpreadInputs((prev) => { const next = [...prev] as [string, string, string, string]; next[i] = e.target.value; return next; })} placeholder="0.00" className="w-16 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                        </div>
                      </div>
                    ))}
                  </div>
                  {anySpreadSet && (
                    <p className="text-[var(--text-muted)] text-[10px] mb-2">
                      Preview: {targetProducts.length} {searchActive ? 'matching' : ''} product{targetProducts.length === 1 ? '' : 's'} will have closer baselines recalculated per tier
                      {searchActive && <span className="text-[var(--accent-amber-text)]"> (filtered)</span>}
                    </p>
                  )}
                  <button disabled={!anySpreadSet || targetProducts.length === 0} onClick={applyBulkSpreads} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-transform active:scale-[0.985]" style={{ backgroundColor: 'var(--brand)', color: 'var(--text-on-accent)' }}>Apply Spreads</button>
                </div>
              </div>
            );
          })()}

          {/* SolarTech Product table */}
          {(() => {
            const stCurrentView = stVersionView[stFamily] ?? 'current';
            const stIsArchive = stCurrentView !== 'current';
            const [stArchiveLabel, stArchiveFrom] = stIsArchive ? stCurrentView.split('|') : ['', ''];
            const stAllFamilyProducts = solarTechProducts.filter((p) => p.family === stFamily);
            const stDisplayProducts = stProductSearch.trim() ? stAllFamilyProducts.filter((p) => p.name.toLowerCase().includes(stProductSearch.toLowerCase().trim())) : stAllFamilyProducts;
            const stDisplayProductIds = stDisplayProducts.map((p) => p.id);
            const stSummaryCount = stAllFamilyProducts.length;
            const stAllClosers = stAllFamilyProducts.flatMap((p) => p.tiers.map((t) => t.closerPerW));
            const stSpreadMin = stAllClosers.length > 0 ? Math.min(...stAllClosers) : 0;
            const stSpreadMax = stAllClosers.length > 0 ? Math.max(...stAllClosers) : 0;
            return (
              <div className="card-surface rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between gap-3">
                    <div><h2 className="text-[var(--text-primary)] font-semibold">{stFamily}</h2><p className="text-[var(--text-muted)] text-xs mt-0.5">{stIsArchive ? 'Viewing archived version (read-only)' : 'Click any value to edit \u00b7 Setter = Closer + $0.10/W auto-calculated'}</p></div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setShowSubDealerRates((v) => !v)} className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"><span>SD Rate</span><span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showSubDealerRates ? 'bg-amber-500' : 'bg-[var(--border)]'}`}><span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${showSubDealerRates ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} /></span></button>
                      <button
                        onClick={() => { const next = !stShowArchived; setStShowArchived(next); if (next) refreshArchived(); }}
                        className={`flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 ${stShowArchived ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        title={stShowArchived ? 'Hide archived products' : 'Show archived products from this family'}
                      >
                        {stShowArchived ? <X className="w-3.5 h-3.5" /> : <History className="w-3.5 h-3.5" />}
                        <span>{stShowArchived ? 'Hide archived' : 'Archived'}</span>
                      </button>
                      <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" /><input type="text" placeholder="Search products..." value={stProductSearch} onChange={(e) => setStProductSearch(e.target.value)} className="w-48 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" /></div>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="table-header-frost">
                      <tr className="border-b border-[var(--border-subtle)]"><th className="text-left px-5 py-3 text-[var(--text-secondary)] font-medium">Product</th>{['1\u20135 kW', '5\u201310 kW', '10\u201313 kW', '13+ kW'].map((label) => (<th key={label} className="text-center px-4 py-3 text-[var(--text-secondary)] font-medium whitespace-nowrap">{label}</th>))}<th className="px-4 py-3 w-10" /></tr>
                      {showSubDealerRates && <tr><td colSpan={6} className="px-4 py-1 text-[var(--accent-amber-text)]/60 text-[10px] text-right">Amber values = Sub-Dealer Rate</td></tr>}
                    </thead>
                    <tbody>
                      {stAllFamilyProducts.length > 0 && (
                        <tr className="bg-[var(--surface-card)]/60 border-b border-[var(--border-subtle)]">
                          <td className="px-5 py-2 text-[var(--text-secondary)] text-xs font-medium">{stSummaryCount} product{stSummaryCount !== 1 ? 's' : ''}</td>
                          {[0, 1, 2, 3].map((ti) => { const profits = stAllFamilyProducts.map((p) => (p.tiers[ti]?.closerPerW ?? 0) - (p.tiers[ti]?.kiloPerW ?? 0)); const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0; return <td key={ti} className="px-2 py-2 text-center"><span className={`text-[10px] font-semibold ${avgProfit > 0 ? 'text-[var(--accent-emerald-text)]/70' : 'text-[var(--accent-red-text)]/70'}`}>${avgProfit.toFixed(2)} profit</span></td>; })}
                          {showSubDealerRates && <td />}
                          <td className="px-4 py-2 text-center"><span className="text-[var(--text-muted)] text-[10px]">{`$${stSpreadMin.toFixed(2)}\u2013$${stSpreadMax.toFixed(2)}`}</span></td>
                        </tr>
                      )}
                      {stDisplayProducts.map((product) => {
                        const stAllVersions = productCatalogPricingVersions.filter((v) => v.productId === product.id);
                        const archiveVersion = stIsArchive ? stAllVersions.find((v) => v.label === stArchiveLabel && v.effectiveFrom === stArchiveFrom) : null;
                        return (
                          <tr key={product.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-card)]/30 transition-colors group">
                            <td className="px-5 py-3 text-[var(--text-primary)] text-xs max-w-[200px]">
                              {editingProductName === product.id ? (<input autoFocus type="text" value={editProductNameVal} onChange={(e) => setEditProductNameVal(e.target.value)} onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const result = validateProductName(editProductNameVal, product.name, stAllFamilyProducts, product.id);
                                  if (!result.ok) { toast(result.reason, 'error'); return; }
                                  if (result.name !== product.name) { updateSolarTechProduct(product.id, { name: result.name }); toast(`Renamed to "${result.name}"`, 'success'); }
                                  productNameSavedRef.current = true; setEditingProductName(null);
                                } else if (e.key === 'Escape') { productNameSavedRef.current = true; setEditingProductName(null); }
                              }} onBlur={() => {
                                if (productNameSavedRef.current) { productNameSavedRef.current = false; return; }
                                const result = validateProductName(editProductNameVal, product.name, stAllFamilyProducts, product.id);
                                if (!result.ok) { toast(result.reason, 'error'); setEditingProductName(null); return; }
                                if (result.name !== product.name) { updateSolarTechProduct(product.id, { name: result.name }); toast(`Renamed to "${result.name}"`, 'success'); }
                                setEditingProductName(null);
                              }} className="w-full bg-[var(--surface-card)] border border-[var(--accent-emerald-solid)] text-[var(--text-primary)] rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />) : (<span className="cursor-pointer hover:text-[var(--accent-cyan-text)] transition-colors inline-flex items-center gap-1.5 group/name" onClick={() => { if (!stIsArchive) { setEditingProductName(product.id); setEditProductNameVal(product.name); } }}>{product.name}{!stIsArchive && <Pencil className="w-3 h-3 text-[var(--text-dim)] opacity-0 group-hover/name:opacity-100 transition-opacity" />}</span>)}
                              {stIsArchive && !archiveVersion && <span className="ml-2 text-[var(--text-dim)] text-[10px]">(no data for this version)</span>}
                            </td>
                            {stIsArchive ? (archiveVersion ? archiveVersion.tiers.map((tier, ti) => (<td key={ti} className="px-2 py-2 text-center"><div className="flex flex-col gap-1 items-center"><span className="text-[var(--accent-emerald-text)]/60 font-medium text-xs">${tier.closerPerW.toFixed(2)}</span><span className="text-[var(--accent-emerald-text)]/50 text-xs">${tier.kiloPerW.toFixed(2)}</span>{showSubDealerRates && <span className="text-[var(--accent-amber-text)]/50 text-xs">{(tier as { subDealerPerW?: number | null }).subDealerPerW != null ? `$${(tier as { subDealerPerW: number }).subDealerPerW.toFixed(2)}` : '\u2014'}</span>}</div></td>)) : <td colSpan={4} className="px-4 py-3 text-center text-[var(--text-dim)] text-xs">No version data</td>) : (
                              product.tiers.map((tier, ti) => (<td key={ti} className="px-2 py-2 text-center"><div className="flex flex-col gap-0.5 items-center"><input ref={(el) => setTierInputRef(`${product.id}-${ti}-closer`, el)} type="number" step="0.01" min="0" value={tier.closerPerW} onFocus={(e) => e.target.select()} onChange={(e) => updateSolarTechTier(product.id, ti, { closerPerW: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleTierKeyDown(e, stDisplayProductIds, product.id, ti, 'closer')} className="w-16 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)] font-medium rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />{renderDeltaBadge(product.id, ti, 'closer', tier.closerPerW)}<input ref={(el) => setTierInputRef(`${product.id}-${ti}-kilo`, el)} type="number" step="0.01" min="0" value={tier.kiloPerW} onFocus={(e) => e.target.select()} onChange={(e) => updateSolarTechTier(product.id, ti, { kiloPerW: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleTierKeyDown(e, stDisplayProductIds, product.id, ti, 'kilo')} className="w-16 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent-emerald-text)]/80 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />{renderDeltaBadge(product.id, ti, 'kilo', tier.kiloPerW)}{showSubDealerRates && <input type="number" step="0.01" min="0" value={tier.subDealerPerW ?? ''} placeholder="\u2014" onFocus={(e) => e.target.select()} onChange={(e) => { const val = e.target.value === '' ? undefined : parseFloat(e.target.value) || 0; updateSolarTechTier(product.id, ti, { subDealerPerW: val }); }} className="w-16 bg-[var(--surface-card)] border border-amber-700/50 text-[var(--accent-amber-text)] rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-500" />}</div></td>))
                            )}
                            <td className="px-4 py-3 text-center">{!stIsArchive && (
                              <div className="flex items-center gap-2 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => { setPcNewVersionFor(product.id); setPcNewVersionLabel(suggestVersionLabel()); setPcNewVersionEffectiveFrom(''); setPcNewVersionTiers(product.tiers.map((t) => ({ closerPerW: String(t.closerPerW), kiloPerW: String(t.kiloPerW) }))); }} title="Create new pricing version" className="text-[var(--text-dim)] hover:text-[var(--accent-emerald-text)] transition-colors"><GitBranch className="w-3.5 h-3.5" /></button>
                                <button
                                  onClick={() => setConfirmAction({
                                    title: `Archive "${product.name}"?`,
                                    message: `This product will be hidden from the active ${stFamily} tab. Existing projects that reference it will continue to resolve commission lookups against the historical pricing version. You can restore it from the Archived tab.`,
                                    onConfirm: async () => {
                                      try { await removeSolarTechProduct(product.id); toast(`Archived "${product.name}"`, 'success'); }
                                      catch (err) { toast(err instanceof Error ? err.message : 'Failed to archive product', 'error'); }
                                    },
                                  })}
                                  title="Archive product"
                                  className="text-[var(--text-dim)] hover:text-[var(--accent-red-text)] transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}</td>
                          </tr>
                        );
                      })}
                      {stDisplayProducts.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[var(--text-dim)]">{stProductSearch.trim() ? 'No products match your search.' : 'No products for this family.'}</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* Add Product to {stFamily} — admin-only flow.
                    Posts to /api/products with the SolarTech installer's id;
                    the row is the same shape as a Product Catalog product but
                    appears in the SolarTech tab via the family filter. */}
                {!stIsArchive && (
                  <div className="px-5 py-4 border-t border-[var(--border-subtle)]/50">
                    {addingSolarTechProductInFamily === stFamily ? (
                      <div className="rounded-2xl p-4 motion-safe:animate-[fadeUpIn_220ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ background: 'var(--surface-inset-subtle)', border: '1px solid var(--border-subtle)' }}>
                        <p className="text-[var(--text-primary)] text-sm font-semibold mb-3">Add product to <span className="text-[var(--accent-emerald-text)]">{stFamily}</span> ({SOLARTECH_FAMILY_FINANCER[stFamily] ?? stFamily})</p>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-[var(--text-secondary)] text-[10px] uppercase tracking-wider mb-1">Product name</label>
                            <input autoFocus type="text" value={stNewProductName} onChange={(e) => setStNewProductName(e.target.value)} placeholder="e.g. Q.Peak DUO ML-G11+ 425" className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                          </div>
                          <div>
                            <label className="block text-[var(--text-secondary)] text-[10px] uppercase tracking-wider mb-1">Effective from <span className="text-[var(--text-dim)] normal-case">(blank = today)</span></label>
                            <input type="date" value={stNewProductEffectiveFrom} onChange={(e) => setStNewProductEffectiveFrom(e.target.value)} min={new Date().toISOString().split('T')[0]} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />
                          </div>
                        </div>
                        <p className="text-[var(--text-secondary)] text-[10px] uppercase tracking-wider mb-1.5">Tiers (closer / kilo $/W)</p>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {[
                            { label: '1–5 kW', idx: 0, cPlaceholder: '2.90', kPlaceholder: '2.35' },
                            { label: '5–10 kW', idx: 1, cPlaceholder: '2.85', kPlaceholder: '2.30' },
                            { label: '10–13 kW', idx: 2, cPlaceholder: '2.80', kPlaceholder: '2.25' },
                            { label: '13+ kW', idx: 3, cPlaceholder: '2.75', kPlaceholder: '2.20' },
                          ].map(({ label, idx, cPlaceholder, kPlaceholder }) => {
                            const closerVal = parseFloat(stNewProductTiers[idx].closerPerW || cPlaceholder);
                            const kiloVal = parseFloat(stNewProductTiers[idx].kiloPerW || kPlaceholder);
                            const isLossMaking = closerVal > 0 && kiloVal > 0 && closerVal <= kiloVal;
                            return (
                              <div key={idx}>
                                <p className="text-[10px] text-[var(--text-muted)] mb-1 text-center">{label}</p>
                                <input type="number" step="0.01" min="0" placeholder={cPlaceholder} value={stNewProductTiers[idx].closerPerW} onChange={(e) => setStNewProductTiers((prev) => prev.map((t, i) => i === idx ? { ...t, closerPerW: e.target.value } : t))} className={`w-full bg-[var(--surface-card)] border ${isLossMaking ? 'border-[var(--accent-red-text)]' : 'border-[var(--border-subtle)]'} text-[var(--accent-emerald-text)] rounded px-2 py-1 text-xs text-center mb-1 focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]`} />
                                <input type="number" step="0.01" min="0" placeholder={kPlaceholder} value={stNewProductTiers[idx].kiloPerW} onChange={(e) => setStNewProductTiers((prev) => prev.map((t, i) => i === idx ? { ...t, kiloPerW: e.target.value } : t))} className={`w-full bg-[var(--surface-card)] border ${isLossMaking ? 'border-[var(--accent-red-text)]' : 'border-[var(--border-subtle)]'} text-[var(--accent-emerald-text)]/80 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]`} />
                                {isLossMaking && <p className="text-[9px] text-[var(--accent-red-text)] mt-1 text-center">closer ≤ kilo</p>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mb-3">
                          <label className="block text-[var(--text-secondary)] text-[10px] uppercase tracking-wider mb-1">Reason <span className="text-[var(--text-dim)] normal-case">(optional, audit-logged)</span></label>
                          <input type="text" value={stNewProductReason} onChange={(e) => setStNewProductReason(e.target.value)} placeholder="e.g. New panel from SolarTech" maxLength={500} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]" />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            disabled={stNewProductSubmitting}
                            onClick={async () => {
                              const trimmed = stNewProductName.trim();
                              const validation = validateProductName(trimmed, '__NEW__', stAllFamilyProducts, '__NEW__');
                              if (!validation.ok) { toast(validation.reason, 'error'); return; }
                              const closerArr = stNewProductTiers.map((t, i) => parseFloat(t.closerPerW) || [2.90, 2.85, 2.80, 2.75][i]);
                              const kiloArr = stNewProductTiers.map((t, i) => parseFloat(t.kiloPerW) || [2.35, 2.30, 2.25, 2.20][i]);
                              for (let i = 0; i < closerArr.length; i++) {
                                if (closerArr[i] <= kiloArr[i]) { toast(`Tier ${i + 1}: closer ($${closerArr[i]}) must be greater than kilo ($${kiloArr[i]}) — would be loss-making.`, 'error'); return; }
                              }
                              setStNewProductSubmitting(true);
                              try {
                                const breaks = [1, 5, 10, 13];
                                const tiersForApi = closerArr.map((c, i) => ({
                                  minKW: breaks[i],
                                  maxKW: i < breaks.length - 1 ? breaks[i + 1] : null,
                                  closerPerW: c,
                                  setterPerW: Math.round((c + 0.10) * 100) / 100,
                                  kiloPerW: kiloArr[i],
                                }));
                                const tiersForLocal = closerArr.map((c, i) => ({
                                  minKW: breaks[i],
                                  maxKW: i < breaks.length - 1 ? breaks[i + 1] : null,
                                  closerPerW: c,
                                  setterPerW: Math.round((c + 0.10) * 100) / 100,
                                  kiloPerW: kiloArr[i],
                                }));
                                await addSolarTechProduct({
                                  tempId: `st_new_${Date.now()}`,
                                  family: stFamily,
                                  financer: SOLARTECH_FAMILY_FINANCER[stFamily] ?? stFamily,
                                  name: validation.name,
                                  tiers: tiersForLocal,
                                  effectiveFrom: stNewProductEffectiveFrom || undefined,
                                  idempotencyKey: `st-add-${Date.now()}`,
                                  reason: stNewProductReason.trim() || undefined,
                                });
                                // tiersForApi is unused here — local state already
                                // matches what we sent, so we don't need it now.
                                // Keeping the variable would cause a lint warning.
                                void tiersForApi;
                                toast(`Product "${validation.name}" added to ${stFamily}${stNewProductEffectiveFrom ? ` (effective ${stNewProductEffectiveFrom})` : ''}`, 'success');
                                resetStNewProduct();
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : 'Failed to add product';
                                toast(msg, 'error');
                                setStNewProductSubmitting(false);
                              }
                            }}
                            className="flex-1 py-2 rounded-xl text-sm font-medium transition-all motion-safe:transition-transform active:scale-[0.985] disabled:opacity-50 touch-manipulation"
                            style={{ backgroundColor: 'var(--brand)', color: 'var(--text-on-accent)' }}
                          >
                            {stNewProductSubmitting ? 'Adding…' : 'Add Product'}
                          </button>
                          <button onClick={resetStNewProduct} disabled={stNewProductSubmitting} className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors disabled:opacity-50">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAddingSolarTechProductInFamily(stFamily); resetStNewProduct(); setAddingSolarTechProductInFamily(stFamily); }} className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors active:scale-[0.985]">
                        <Plus className="w-4 h-4" /> Add product to {stFamily}
                      </button>
                    )}
                  </div>
                )}

                {/* Archived products view — only rendered when the
                    "Archived" toggle in the action bar is on. Pulls
                    from GET /api/products?archived=1 (admin-only) and
                    filters to SolarTech rows of the current family.
                    Each row gets a Restore action that POSTs to
                    /api/products/[id]/restore; the product reappears
                    in the active table on next reload. */}
                {stShowArchived && (
                  <div className="px-5 py-4 border-t border-[var(--border-subtle)]/50 motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Archived in {stFamily}</p>
                      {archivedLoading && <span className="text-[var(--text-muted)] text-[10px]">Loading…</span>}
                    </div>
                    {(() => {
                      const archivedHere = archivedProducts.filter((a) => a.installerName === 'SolarTech' && a.family === stFamily);
                      if (!archivedLoading && archivedHere.length === 0) {
                        return <p className="text-[var(--text-muted)] text-xs italic">No archived products in {stFamily}.</p>;
                      }
                      return (
                        <div className="space-y-2">
                          {archivedHere.map((a) => (
                            <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-inset-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div className="min-w-0">
                                <p className="text-[var(--text-primary)] text-sm font-medium truncate">{a.name}</p>
                                <p className="text-[var(--text-dim)] text-[10px]">
                                  {a.versionCount} version{a.versionCount === 1 ? '' : 's'}
                                  {a.projectRefs > 0 && ` · ${a.projectRefs} project${a.projectRefs === 1 ? '' : 's'} reference this`}
                                  {a.latestVersion && ` · last active ${a.latestVersion.effectiveFrom}${a.latestVersion.effectiveTo ? ` → ${a.latestVersion.effectiveTo}` : ''}`}
                                </p>
                              </div>
                              <button
                                onClick={async () => {
                                  try {
                                    await restoreProduct(a.id);
                                    toast(`Restored "${a.name}"`, 'success');
                                    setArchivedProducts((prev) => prev.filter((p) => p.id !== a.id));
                                    // The active table will pick up the row on next /api/data refresh.
                                    // Trigger a fresh archived-list fetch to keep counts in sync.
                                    refreshArchived();
                                  } catch (err) {
                                    toast(err instanceof Error ? err.message : 'Failed to restore product', 'error');
                                  }
                                }}
                                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium motion-safe:transition-transform active:scale-[0.985] touch-manipulation"
                                style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)' }}
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="px-5 py-3 border-t border-[var(--border-subtle)]/50 bg-[var(--surface-card)]/20"><p className="text-xs text-[var(--text-dim)]">Green = Closer $/W · Blue = Kilo $/W · Setter = Closer + $0.10/W (auto)</p></div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Shared confirm dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
