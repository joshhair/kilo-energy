'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, Pencil, Check, X, EyeOff, Eye, Trash2, Search,
  ChevronRight, ChevronDown, CreditCard, DollarSign,
  ListChecks, CheckSquare, Square, Building2,
} from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { ProductCatalogInstallerConfig, DEFAULT_INSTALL_PAY_PCT } from '../../../../lib/data';
import { SectionHeader } from '../components/SectionHeader';

export interface InstallersSectionProps {
  editingPrepaid: string | null;
  setEditingPrepaid: React.Dispatch<React.SetStateAction<string | null>>;
  deleteConfirm: { type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string } | null;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<{ type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string } | null>>;
  setBaselineTab: React.Dispatch<React.SetStateAction<string>>;
  installerSelectMode: boolean;
  setInstallerSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedInstallers: Set<string>;
  setSelectedInstallers: React.Dispatch<React.SetStateAction<Set<string>>>;
  payScheduleExpanded: string | null;
  setPayScheduleExpanded: React.Dispatch<React.SetStateAction<string | null>>;
}

export function InstallersSection({
  editingPrepaid, setEditingPrepaid,
  deleteConfirm, setDeleteConfirm,
  setBaselineTab,
  installerSelectMode, setInstallerSelectMode,
  selectedInstallers, setSelectedInstallers,
  payScheduleExpanded, setPayScheduleExpanded,
}: InstallersSectionProps) {
  const {
    installers, setInstallerActive, addInstaller, deleteInstaller,
    projects,
    installerPricingVersions, solarTechProducts, productCatalogProducts,
    productCatalogInstallerConfigs,
    installerPrepaidOptions, getInstallerPrepaidOptions, addInstallerPrepaidOption, updateInstallerPrepaidOption, removeInstallerPrepaidOption,
    addProductCatalogInstaller,
    installerPayConfigs, updateInstallerPayConfig,
  } = useApp();
  const { toast } = useToast();

  const [newInstaller, setNewInstaller] = useState('');
  const [newInstallerStructure, setNewInstallerStructure] = useState<'standard' | 'product-catalog'>('standard');
  const [newInstallerCloser, setNewInstallerCloser] = useState('');
  const [newInstallerKilo, setNewInstallerKilo] = useState('');
  const [newPcFamilies, setNewPcFamilies] = useState<string[]>(['']);
  const [installerSearch, setInstallerSearch] = useState('');
  const [archivedInstallersOpen, setArchivedInstallersOpen] = useState(false);
  const [prepaidInstallerExpanded, setPrepaidInstallerExpanded] = useState<string | null>(null);
  const [newPrepaidOption, setNewPrepaidOption] = useState('');
  const [editPrepaidVal, setEditPrepaidVal] = useState('');
  const [editPayPct, setEditPayPct] = useState('');
  const payPctDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (payPctDebounceRef.current) clearTimeout(payPctDebounceRef.current); };
  }, []);

  return (
    <div key="installers" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Installers" subtitle="Manage active and archived installation companies" />
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-white font-semibold mb-3">Add Installer</h2>
        {(() => {
          const installerDup = newInstaller.trim().length > 0 && installers.some((i) => i.name.toLowerCase() === newInstaller.trim().toLowerCase());
          return (<>
        <input
          type="text" placeholder="Installer name"
          value={newInstaller}
          onChange={(e) => setNewInstaller(e.target.value)}
          className={`w-full ${installerDup ? 'mb-1' : 'mb-3'} bg-[var(--surface-card)] border ${installerDup ? 'border-red-500 focus:ring-red-500' : 'border-[var(--border)] focus:ring-[var(--accent-green)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 placeholder-[var(--text-dim)]`}
        />
        {installerDup && <p className="text-red-400 text-[10px] mb-2">Already exists</p>}
        {/* Pricing structure selector */}
        <div className="flex gap-2 mb-3">
          {(['standard', 'product-catalog'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setNewInstallerStructure(s)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                newInstallerStructure === s
                  ? 'bg-[var(--accent-green)]/20 border-[var(--accent-green)] text-[var(--accent-cyan)]'
                  : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              {s === 'standard' ? 'Standard (Flat Rate)' : 'Product Catalog'}
            </button>
          ))}
        </div>
        {newInstallerStructure === 'standard' ? (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Closer $/W</label>
              <input type="number" step="0.01" min="0" placeholder="2.90"
                value={newInstallerCloser} onChange={(e) => setNewInstallerCloser(e.target.value)}
                className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Kilo $/W</label>
              <input type="number" step="0.01" min="0" placeholder="2.35"
                value={newInstallerKilo} onChange={(e) => setNewInstallerKilo(e.target.value)}
                className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
              />
            </div>
          </div>
        ) : (
          <div className="mb-3 space-y-2">
            <p className="text-xs text-[var(--text-muted)] mb-2">Add product families (you can add products after creating the installer)</p>
            {newPcFamilies.map((fam, i) => (
              <div key={i} className="grid grid-cols-[1fr_28px] gap-2 items-center">
                <input type="text" placeholder="Family name (e.g. Goodleap)"
                  value={fam}
                  onChange={(e) => setNewPcFamilies((prev) => prev.map((f, j) => j === i ? e.target.value : f))}
                  className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
                />
                <button onClick={() => {
                  if (newPcFamilies.length <= 1) return;
                  setNewPcFamilies((prev) => prev.filter((_, j) => j !== i));
                }} disabled={newPcFamilies.length <= 1} className="text-[var(--text-dim)] hover:text-red-400 disabled:opacity-30 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setNewPcFamilies((prev) => [...prev, ''])}
              className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-white text-xs transition-colors"
            >
              <Plus className="w-3 h-3" /> Add family
            </button>
          </div>
        )}
        <button
          disabled={!newInstaller.trim() || installerDup || (newInstallerStructure === 'product-catalog' && newPcFamilies.filter((f) => f.trim()).length === 0)}
          onClick={() => {
            if (!newInstaller.trim() || installerDup) return;
            const name = newInstaller.trim();
            if (newInstallerStructure === 'standard') {
              const closerRate = parseFloat(newInstallerCloser) || 2.90;
              const kiloRate = parseFloat(newInstallerKilo) || 2.35;
              addInstaller(name, { closerPerW: closerRate, kiloPerW: kiloRate });
              const usedCustom = newInstallerCloser.trim() || newInstallerKilo.trim();
              toast(usedCustom ? `Added ${name} with rates $${closerRate.toFixed(2)}/$${kiloRate.toFixed(2)}` : `Added ${name} with default rates`, 'success');
            } else {
              const families = newPcFamilies.filter((f) => f.trim());
              const config: ProductCatalogInstallerConfig = { families };
              addProductCatalogInstaller(name, config);
              setBaselineTab(name);
            }
            setNewInstaller('');
            setNewInstallerCloser('');
            setNewInstallerKilo('');
            setNewInstallerStructure('standard');
            setNewPcFamilies(['']);
          }}
          className="w-full flex items-center justify-center gap-2 text-white text-sm font-medium py-2 rounded-xl active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          <Plus className="w-4 h-4" /> Add Installer
        </button>
        <p className="text-xs text-[var(--text-dim)] mt-2">Standard: flat rate · Product Catalog: SolarTech-style per-product pricing</p>
        </>); })()}
      </div>

      {installers.length === 0 && (
        <div className="card-surface rounded-2xl p-5 border border-[var(--border-subtle)]/60">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-green)]/10 flex-shrink-0">
              <Building2 className="w-4 h-4 text-[var(--accent-green)]" />
            </div>
            <div>
              <p className="text-white font-medium text-sm mb-1">No installers yet</p>
              <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
                Installers are the companies that handle solar panel installation. Add your first installer above to start configuring pricing baselines and creating deals.
              </p>
            </div>
          </div>
        </div>
      )}

      {installers.some((i) => i.active) && (() => {
        const activeInstallers = installers.filter((i) => i.active);
        const filteredActive = installerSearch
          ? activeInstallers.filter((i) => i.name.toLowerCase().includes(installerSearch.toLowerCase()))
          : activeInstallers;
        return (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-2 px-1">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Active</p>
            <span className="text-[10px] text-[var(--text-dim)] tabular-nums">{filteredActive.length} of {activeInstallers.length} installers</span>
            <button
              onClick={() => { setInstallerSelectMode((v) => !v); setSelectedInstallers(new Set()); }}
              className={`ml-auto flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg border transition-colors ${
                installerSelectMode
                  ? 'bg-[var(--accent-green)]/15 border-[var(--accent-green)]/30 text-[var(--accent-green)]'
                  : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-muted)] hover:text-white'
              }`}
            >
              <ListChecks className="w-3 h-3" /> {installerSelectMode ? 'Done' : 'Select'}
            </button>
          </div>
          {installerSelectMode && filteredActive.length > 0 && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <button
                onClick={() => {
                  if (filteredActive.every((i) => selectedInstallers.has(i.name))) setSelectedInstallers(new Set());
                  else setSelectedInstallers(new Set(filteredActive.map((i) => i.name)));
                }}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                {filteredActive.every((i) => selectedInstallers.has(i.name))
                  ? <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                  : <Square className="w-3.5 h-3.5" />}
                Select all
              </button>
            </div>
          )}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text" placeholder="Search installers..."
              value={installerSearch}
              onChange={(e) => setInstallerSearch(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
            />
          </div>
          <div className="space-y-2">
            {filteredActive.map((inst) => {
              const instPrepaid = getInstallerPrepaidOptions(inst.name);
              const isExpanded = prepaidInstallerExpanded === inst.name;
              return (
                <div key={inst.name} className={`card-surface rounded-xl overflow-hidden ${installerSelectMode && selectedInstallers.has(inst.name) ? 'ring-1 ring-[var(--accent-green)]/40' : ''}`}>
                  <div className="px-4 py-3 flex items-center justify-between group">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {installerSelectMode && (
                        <button
                          onClick={() => setSelectedInstallers((prev) => {
                            const next = new Set(prev);
                            next.has(inst.name) ? next.delete(inst.name) : next.add(inst.name);
                            return next;
                          })}
                          className="flex-shrink-0"
                        >
                          {selectedInstallers.has(inst.name)
                            ? <CheckSquare className="w-4 h-4 text-[var(--accent-green)]" />
                            : <Square className="w-4 h-4 text-[var(--text-dim)]" />}
                        </button>
                      )}
                      <div>
                        <p className="text-white text-sm font-medium">{inst.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {productCatalogInstallerConfigs[inst.name] && (
                            <span className="text-[10px] text-[var(--accent-green)]/70">Product Catalog</span>
                          )}
                          {instPrepaid.length > 0 && (
                            <span className="text-[10px] text-violet-400/70">Prepaid: {instPrepaid.join(', ')}</span>
                          )}
                        </div>
                        {(() => {
                          const usedFinancers = Array.from(new Set(projects.filter((p) => p.installer === inst.name).map((p) => p.financer))).filter(Boolean);
                          return usedFinancers.length > 0 ? (
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              <span className="text-[9px] text-[var(--text-dim)] mr-0.5">Used with:</span>
                              {usedFinancers.map((f) => (
                                <span key={f} className="text-[9px] text-[var(--text-muted)] bg-[var(--surface-card)]/80 border border-[var(--border)]/50 px-1.5 py-0.5 rounded-full">{f}</span>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          const opening = payScheduleExpanded !== inst.name;
                          setPayScheduleExpanded(opening ? inst.name : null);
                          if (opening) {
                            const pct = installerPayConfigs[inst.name]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
                            setEditPayPct(String(pct));
                            setPrepaidInstallerExpanded(null);
                          }
                        }}
                        title="Configure pay schedule"
                        className={`transition-colors ${payScheduleExpanded === inst.name ? 'text-[var(--accent-green)]' : 'text-[var(--text-dim)] hover:text-[var(--accent-green)] opacity-0 group-hover:opacity-100'}`}
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setPrepaidInstallerExpanded(isExpanded ? null : inst.name); setNewPrepaidOption(''); setEditingPrepaid(null); setPayScheduleExpanded(null); }}
                        title="Configure prepaid options"
                        className={`transition-colors ${isExpanded ? 'text-violet-400' : 'text-[var(--text-dim)] hover:text-violet-400 opacity-0 group-hover:opacity-100'}`}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setInstallerActive(inst.name, false)}
                        title="Archive installer"
                        className="text-[var(--text-dim)] hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          const isSolarTech = inst.name === 'SolarTech';
                          const productCount = isSolarTech
                            ? solarTechProducts.length
                            : productCatalogProducts.filter((p) => p.installer === inst.name).length;
                          const versionCount = installerPricingVersions.filter((v) => v.installer === inst.name).length;
                          const parts: string[] = [];
                          if (productCount > 0) parts.push(`${productCount} product${productCount === 1 ? '' : 's'}`);
                          if (versionCount > 0) parts.push(`${versionCount} pricing version${versionCount === 1 ? '' : 's'}`);
                          const cascadeDetail = parts.length > 0
                            ? `This will PERMANENTLY delete ${parts.join(' and ')} along with every baseline tier underneath them. This cannot be undone from the UI.\n\nExisting deals that reference this installer will remain but will no longer have a pricing source.`
                            : 'This installer has no products or pricing configured yet. Existing deals referencing it (if any) will remain, but you will not be able to create new deals with this installer.';
                          setDeleteConfirm({
                            type: 'installer',
                            id: inst.name,
                            name: inst.name,
                            message: cascadeDetail,
                          });
                        }}
                        title="Permanently delete installer"
                        className="text-[var(--text-dim)] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expandable prepaid options panel */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]/50">
                      <p className="text-xs font-semibold text-violet-400/80 uppercase tracking-wider mb-2">Prepaid Options</p>
                      {instPrepaid.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {instPrepaid.map((opt) => (
                            <div key={opt} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-lg px-3 py-2 group/item">
                              {editingPrepaid === `${inst.name}::${opt}` ? (
                                <div className="flex items-center gap-2 flex-1 mr-2">
                                  <input type="text" value={editPrepaidVal}
                                    onChange={(e) => setEditPrepaidVal(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && editPrepaidVal.trim()) { updateInstallerPrepaidOption(inst.name, opt, editPrepaidVal.trim()); setEditingPrepaid(null); }
                                      if (e.key === 'Escape') setEditingPrepaid(null);
                                    }}
                                    autoFocus
                                    className="flex-1 bg-[var(--border)] border border-[var(--border)] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                                  />
                                  <button onClick={() => { if (editPrepaidVal.trim()) { updateInstallerPrepaidOption(inst.name, opt, editPrepaidVal.trim()); setEditingPrepaid(null); } }}
                                    className="text-[var(--accent-green)] hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingPrepaid(null)}
                                    className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-white text-xs font-medium">{opt}</span>
                                  <div className="flex items-center gap-1.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                    <button onClick={() => { setEditingPrepaid(`${inst.name}::${opt}`); setEditPrepaidVal(opt); }}
                                      className="text-[var(--text-muted)] hover:text-[var(--accent-green)] transition-colors"><Pencil className="w-3 h-3" /></button>
                                    <button onClick={() => removeInstallerPrepaidOption(inst.name, opt)}
                                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input type="text" placeholder="New option (e.g. HDM)"
                          value={newPrepaidOption}
                          onChange={(e) => setNewPrepaidOption(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newPrepaidOption.trim()) { addInstallerPrepaidOption(inst.name, newPrepaidOption.trim()); setNewPrepaidOption(''); }
                          }}
                          className="flex-1 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
                        />
                        <button
                          onClick={() => { if (newPrepaidOption.trim()) { addInstallerPrepaidOption(inst.name, newPrepaidOption.trim()); setNewPrepaidOption(''); } }}
                          className="text-violet-400 hover:text-violet-300 transition-colors px-2"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {instPrepaid.length === 0 && (
                        <p className="text-[10px] text-[var(--text-dim)] mt-1.5">No prepaid options yet. Add one to enable prepaid tracking for this installer.</p>
                      )}
                    </div>
                  )}

                  {/* Expandable pay schedule panel */}
                  {payScheduleExpanded === inst.name && (() => {
                    const currentPct = installerPayConfigs[inst.name]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
                    const remainder = 100 - currentPct;
                    return (
                      <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]/50">
                        <p className="text-xs font-semibold text-[var(--accent-green)]/80 uppercase tracking-wider mb-2">Pay Schedule</p>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-[var(--text-secondary)] mb-1">Install payment %</label>
                            <input
                              type="number" min="0" max="100" step="1"
                              value={editPayPct}
                              onChange={(e) => {
                                setEditPayPct(e.target.value);
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val >= 0 && val <= 100) {
                                  if (payPctDebounceRef.current) clearTimeout(payPctDebounceRef.current);
                                  payPctDebounceRef.current = setTimeout(() => {
                                    updateInstallerPayConfig(inst.name, val);
                                  }, 500);
                                }
                              }}
                              className="w-24 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
                            />
                            <p className="text-[10px] text-[var(--text-dim)] mt-1">% paid at Installed. Remainder paid at PTO (M3).</p>
                          </div>
                          <div className="bg-[var(--surface-card)]/50 rounded-lg px-3 py-2">
                            <p className="text-xs text-[var(--text-secondary)] font-medium">
                              M2: <span className="text-[var(--accent-green)]">{currentPct}%</span> at Install
                              <span className="text-[var(--text-dim)] mx-1.5">&middot;</span>
                              M3: <span className="text-[var(--accent-green)]">{remainder}%</span> at PTO
                            </p>
                            {remainder === 0 && (
                              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Full payment at install — no M3 created.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {installers.some((i) => !i.active) && (() => {
        const archivedInstallers = installers.filter((i) => !i.active);
        return (
        <div>
          <button
            onClick={() => setArchivedInstallersOpen((v) => !v)}
            className="flex items-center gap-2 mb-2 px-1 w-full text-left group"
          >
            {archivedInstallersOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-dim)]" />
              : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
            <p className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wider">Archived</p>
            <span className="text-[10px] font-medium text-[var(--text-dim)] bg-[var(--surface-card)] border border-[var(--border-subtle)]/50 px-1.5 py-0.5 rounded-full">
              {archivedInstallers.length}
            </span>
            {installerSelectMode && archivedInstallers.length > 0 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  const archivedNames = archivedInstallers.map((i) => i.name);
                  const allSelected = archivedNames.every((n) => selectedInstallers.has(n));
                  setSelectedInstallers((prev) => {
                    const next = new Set(prev);
                    archivedNames.forEach((n) => allSelected ? next.delete(n) : next.add(n));
                    return next;
                  });
                }}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-white transition-colors ml-auto"
              >
                {archivedInstallers.every((i) => selectedInstallers.has(i.name))
                  ? <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                  : <Square className="w-3.5 h-3.5" />}
                Select all
              </span>
            )}
          </button>
          {archivedInstallersOpen && (
          <div className="grid grid-cols-2 gap-2">
            {archivedInstallers.map((inst) => (
              <div key={inst.name} className={`bg-[var(--surface)]/50 border border-[var(--border-subtle)]/50 rounded-xl px-4 py-3 flex items-center justify-between group ${installerSelectMode && selectedInstallers.has(inst.name) ? 'ring-1 ring-[var(--accent-green)]/40' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {installerSelectMode && (
                    <button
                      onClick={() => setSelectedInstallers((prev) => {
                        const next = new Set(prev);
                        next.has(inst.name) ? next.delete(inst.name) : next.add(inst.name);
                        return next;
                      })}
                      className="flex-shrink-0"
                    >
                      {selectedInstallers.has(inst.name)
                        ? <CheckSquare className="w-4 h-4 text-[var(--accent-green)]" />
                        : <Square className="w-4 h-4 text-[var(--text-dim)]" />}
                    </button>
                  )}
                  <p className="text-[var(--text-dim)] text-sm line-through">{inst.name}</p>
                </div>
                {!installerSelectMode && (
                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setInstallerActive(inst.name, true)}
                    title="Restore installer"
                    className="text-[var(--text-dim)] hover:text-[var(--accent-green)] transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({
                      type: 'installer',
                      id: inst.name,
                      name: inst.name,
                      message: productCatalogInstallerConfigs[inst.name]
                        ? 'This will also remove all associated product catalog products and pricing data. Existing deals are unaffected.'
                        : 'This will not affect existing projects but will prevent new deals with this installer.',
                    })}
                    title="Permanently delete installer"
                    className="text-[var(--text-dim)] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}
