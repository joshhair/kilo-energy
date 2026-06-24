'use client';

/**
 * EditProjectModal — the admin Edit Deal modal: core deal fields, co-party
 * splits (cent-exact evenSplit), per-project trainer override, sold date,
 * lead-source/blitz attribution, baseline override, and the Live
 * Commission Preview. Extracted VERBATIM from projects/[id]/page.tsx
 * (T4.1 inc 2, 2026-06-11) as a STRICT PURE MOVE of the JSX only:
 * the form state (editVals/editErrors), openEditModal's imperative seed,
 * and the money-critical saveEditModal stay PAGE-OWNED and arrive through
 * the form bundle + onSave/onClose. Migrating state into this component
 * (the RecordTrainerPaymentModal shape) is deliberate T4.2 follow-up work.
 *
 * MONEY SURFACE: the preview IIFE mirrors the server's baseline-resolution
 * ladder and the closer-trainer deduction ordering (2026-05-12 chain bug).
 * This file is in scripts/check-no-silent-rep-clears.mjs PROTECTED_FILES —
 * never reactively blank setterId/repId/blitzId here.
 *
 * Portaled to document.body so fixed positioning is relative to the actual
 * viewport, not the <main> scroll container — without the portal, opening
 * from a deep scroll position can trap the modal below the fold.
 * Render-gating (open) is the parent's; the page's Escape + scroll-lock
 * effects key on the same showEditModal flag.
 */

import { createPortal } from 'react-dom';
import type { Dispatch, SetStateAction } from 'react';
import { Pencil, X, AlertTriangle } from 'lucide-react';
import { SearchableSelect } from '../../../components/SearchableSelect';
import { CoPartySection, type CoPartyDraft } from '../CoPartySection';
import { evenSplit } from '@/lib/commission-split';
import {
  getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal,
  splitCloserSetterPay, resolveTrainerRate,
  DEFAULT_INSTALL_PAY_PCT,
  SOLARTECH_FAMILIES,
} from '@/lib/data';
import { applyCloserTrainerDeduction } from '@/lib/closer-trainer-deduction';
import type {
  Project, Rep, PayrollEntry, TrainerAssignment, SolarTechProduct,
  InstallerPricingVersion, ProductCatalogProduct, ProductCatalogPricingVersion,
  InstallerBaseline, InstallerPayConfig,
} from '@/lib/data';
import type { Role } from '@/lib/notifications/types';

/** Mirror of the page's editVals useState initializer — keep in lockstep. */
export interface EditDraft {
  installer: string;
  financer: string;
  productType: string;
  kWSize: string;
  netPPW: string;
  repId: string;
  setterId: string;
  soldDate: string;
  notes: string;
  useBaselineOverride: boolean;
  overrideCloserPerW: string;
  overrideSetterPerW: string;
  overrideKiloPerW: string;
  additionalClosers: CoPartyDraft[];
  additionalSetters: CoPartyDraft[];
  trainerId: string;
  trainerRate: string;
  noChainTrainer: boolean;
  solarTechProductId: string;
  installerProductId: string;
  prepaidSubType: string;
  leadSource: string;
  blitzId: string;
}

export interface EditBlitzOption {
  id: string; name: string; status: string; startDate?: string; endDate?: string;
  participants?: Array<{ userId: string; joinStatus: string }>;
}

export interface EditProjectModalProps {
  open: boolean;
  project: Project;
  effectiveRole: Role | null;
  canSeeInternalOnlyUi: boolean;
  editAvailableBlitzes: EditBlitzOption[];
  /** Page-owned form state, destructured to the original local names. */
  form: {
    editVals: EditDraft;
    setEditVals: Dispatch<SetStateAction<EditDraft>>;
    editErrors: Record<string, string>;
    setEditErrors: Dispatch<SetStateAction<Record<string, string>>>;
  };
  /** Read-only context slices the modal renders from. */
  data: {
    reps: Rep[];
    activeInstallers: string[];
    activeFinancers: string[];
    solarTechProducts: SolarTechProduct[];
    installerBaselines: Record<string, InstallerBaseline>;
    installerPricingVersions: InstallerPricingVersion[];
    productCatalogProducts: ProductCatalogProduct[];
    productCatalogPricingVersions: ProductCatalogPricingVersion[];
    installerPayConfigs: Record<string, InstallerPayConfig>;
    trainerAssignments: TrainerAssignment[];
    payrollEntries: PayrollEntry[];
    getInstallerPrepaidOptions: (installer: string) => string[];
  };
  onSave: () => void;
  onClose: () => void;
}

export function EditProjectModal({ open, project, effectiveRole, canSeeInternalOnlyUi, editAvailableBlitzes, form, data, onSave, onClose }: EditProjectModalProps) {
  const { editVals, setEditVals, editErrors, setEditErrors } = form;
  const {
    reps, activeInstallers, activeFinancers, solarTechProducts, installerBaselines,
    installerPricingVersions, productCatalogProducts, productCatalogPricingVersions,
    installerPayConfigs, trainerAssignments, payrollEntries, getInstallerPrepaidOptions,
  } = data;
  // Paid-milestone guard for equipment edits: changing the equipment
  // recomputes the redline + realigns UNPAID payroll, but already-PAID
  // amounts are intentionally left untouched server-side. Warn the admin so
  // they reconcile the difference manually (Josh's "warn + manual reconcile").
  const equipmentChanged =
    (editVals.solarTechProductId || '') !== (project.solarTechProductId ?? '')
    || (editVals.installerProductId || '') !== (project.installerProductId ?? '');
  const hasPaidMilestone = payrollEntries.some(
    (e) => e.projectId === project.id && e.status === 'Paid' && !e.isChargeback,
  );
  const showPaidEquipmentWarning = equipmentChanged && hasPaidMilestone;
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
          <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-blue-soft)]">
                  <Pencil className="w-5 h-5 text-[var(--accent-emerald-text)]" />
                </div>
                <h2 className="text-[var(--text-primary)] font-semibold">Edit Project</h2>
              </div>
              <button onClick={() => { onClose(); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Installer */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Installer</label>
                <SearchableSelect
                  value={editVals.installer}
                  onChange={(val) => { setEditVals((v) => ({ ...v, installer: val, solarTechProductId: val === 'SolarTech' ? v.solarTechProductId : '', prepaidSubType: val === v.installer ? v.prepaidSubType : '' })); setEditErrors((prev) => ({ ...prev, installer: '' })); }}
                  options={(activeInstallers.includes(editVals.installer) || !editVals.installer ? activeInstallers : [editVals.installer, ...activeInstallers]).map((inst) => ({ value: inst, label: !activeInstallers.includes(inst) ? `${inst} (archived)` : inst }))}
                  placeholder="Select installer…"
                  error={!!editErrors.installer}
                />
                {editErrors.installer && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.installer}</p>}
              </div>

              {/* Equipment pickers — ADMIN-ONLY. Reps pick equipment at sale;
                  only an admin may correct a wrong pick afterward (it changes
                  the redline → commission). Hidden for PM/rep viewers. */}

              {/* SolarTech Product — shown only when installer is SolarTech */}
              {effectiveRole === 'admin' && editVals.installer === 'SolarTech' && (
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">SolarTech Product</label>
                  <select
                    value={editVals.solarTechProductId}
                    onChange={(e) => { setEditVals((v) => ({ ...v, solarTechProductId: e.target.value })); setEditErrors((prev) => ({ ...prev, installer: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.installer && !editVals.solarTechProductId ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`}
                  >
                    <option value="">— Select product —</option>
                    {/* Group by family so the same product name across
                        Goodleap / Enfin / Lightreach / Cash flows reads as
                        financer-scoped pricing rather than visual duplicates. */}
                    {SOLARTECH_FAMILIES.map((family) => {
                      const familyProducts = solarTechProducts.filter((p) => p.family === family);
                      if (familyProducts.length === 0) return null;
                      return (
                        <optgroup key={family} label={family}>
                          {familyProducts.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Installer-catalog Product (e.g. BVI's SEG-440 variants) —
                  shown when the installer carries a product catalog. This is
                  the equipment whose pick sets the redline; admins can fix a
                  wrong selection here. */}
              {effectiveRole === 'admin' && editVals.installer !== 'SolarTech'
                && productCatalogProducts.some((p) => p.installer === editVals.installer) && (
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Equipment / Product</label>
                  <select
                    value={editVals.installerProductId}
                    onChange={(e) => { setEditVals((v) => ({ ...v, installerProductId: e.target.value })); setEditErrors((prev) => ({ ...prev, installer: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.installer && !editVals.installerProductId ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`}
                  >
                    <option value="">— Select product —</option>
                    {[...new Set(productCatalogProducts.filter((p) => p.installer === editVals.installer).map((p) => p.family))].map((family) => {
                      const familyProducts = productCatalogProducts.filter((p) => p.installer === editVals.installer && p.family === family);
                      return (
                        <optgroup key={family} label={family}>
                          {familyProducts.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Financer */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Financer</label>
                <SearchableSelect
                  value={editVals.financer}
                  onChange={(val) => setEditVals((v) => ({ ...v, financer: val }))}
                  options={(activeFinancers.includes(editVals.financer) || !editVals.financer ? activeFinancers : [editVals.financer, ...activeFinancers]).filter((fin) => fin !== 'Cash' || editVals.productType === 'Cash').map((fin) => ({ value: fin, label: !activeFinancers.includes(fin) ? `${fin} (archived)` : fin }))}
                  placeholder="Select financer…"
                />
              </div>

              {/* Product Type */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Product Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['PPA', 'Lease', 'Loan', 'Cash'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setEditVals((v) => ({ ...v, productType: pt, financer: pt === 'Cash' ? 'Cash' : v.financer === 'Cash' ? '' : v.financer, prepaidSubType: pt === 'Cash' || pt === 'Loan' ? v.prepaidSubType : '' }))}
                      className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                        editVals.productType === pt
                          ? 'bg-[var(--accent-emerald-solid)] border-[var(--accent-emerald-solid)] text-black shadow-[0_0_10px_color-mix(in srgb, var(--accent-blue-solid) 30%, transparent)]'
                          : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prepaid sub-type — mirrors New Deal's standard-installer gate
                  (installer has admin-configured prepaid options + Cash/Loan).
                  Optional: tapping the selected option again clears it. */}
              {getInstallerPrepaidOptions(editVals.installer).length > 0 && (editVals.productType === 'Cash' || editVals.productType === 'Loan') && (
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Prepaid Type (optional)</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {getInstallerPrepaidOptions(editVals.installer).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setEditVals((v) => ({ ...v, prepaidSubType: v.prepaidSubType === opt ? '' : opt }))}
                        className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                          editVals.prepaidSubType === opt
                            ? 'bg-violet-600/20 border-violet-500/60 text-[var(--accent-purple-text)] shadow-[0_0_10px_color-mix(in srgb, var(--accent-purple-solid) 20%, transparent)]'
                            : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* kW + PPW */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">System Size (kW)</label>
                  <input type="number" step="any" value={editVals.kWSize}
                    onChange={(e) => { setEditVals((v) => ({ ...v, kWSize: e.target.value })); setEditErrors((prev) => ({ ...prev, kWSize: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.kWSize ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`} />
                  {editErrors.kWSize && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.kWSize}</p>}
                </div>
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Net PPW ($)</label>
                  <input type="number" step="0.01" value={editVals.netPPW}
                    onChange={(e) => { setEditVals((v) => ({ ...v, netPPW: e.target.value })); setEditErrors((prev) => ({ ...prev, netPPW: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.netPPW ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`} />
                  {editErrors.netPPW && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.netPPW}</p>}
                </div>
              </div>

              {/* Closer (primary rep) — required. closerId is a non-null FK
                  in the DB so we don't render an empty option here. */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Closer</label>
                <select value={editVals.repId} onChange={(e) => setEditVals((v) => ({ ...v, repId: e.target.value }))}
                  className={`w-full bg-[var(--surface-card)] border ${editErrors.repId ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`}>
                  {reps.filter((r) => (r.repType === 'closer' || r.repType === 'both') && (r.active || r.id === editVals.repId) && r.id !== editVals.setterId && !editVals.additionalClosers.some((c) => c.userId === r.id)).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                {editErrors.repId && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.repId}</p>}
              </div>

              {/* Setter */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Setter (optional)</label>
                <select value={editVals.setterId} onChange={(e) => { const s = e.target.value; setEditVals((v) => ({ ...v, setterId: s, repId: v.repId === s ? '' : v.repId })); }}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]">
                  <option value="">— None —</option>
                  {reps.filter((r) => (r.repType === 'setter' || r.repType === 'both') && (r.active || r.id === editVals.setterId) && r.id !== editVals.repId).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* ── Co-closers (tag-team) ─────────────────────────────────
                  Each row is one person + their M1/M2/M3 cut. The primary
                  closer's cut stays on m1Amount/m2Amount/m3Amount above;
                  these are ADDITIONAL people, not replacements. Adding the
                  2nd closer evenly re-splits the closer commission 50/50
                  using evenSplit (reuses lib/money's cent-exact allocator
                  so no cent is lost in the round-trip). */}
              <CoPartySection
                label="Co-closers"
                rows={editVals.additionalClosers}
                primaryUserId={editVals.repId}
                excludeUserIds={[editVals.setterId, ...editVals.additionalClosers.map((c) => c.userId), ...editVals.additionalSetters.map((s) => s.userId)].filter(Boolean)}
                repTypeFilter={(r) => r.repType === 'closer' || r.repType === 'both'}
                reps={reps}
                onChange={(rows) => setEditVals((v) => ({ ...v, additionalClosers: rows }))}
                onFirstAdd={() => {
                  // Re-split the current commission evenly across [primary + 1 new].
                  // Primary's m1/m2/m3 on editVals isn't directly editable here;
                  // we operate on parseFloat(editVals.netPPW/kWSize)-derived
                  // preview numbers instead. Simpler: default new row to 0
                  // and let admin enter amounts manually — safer than
                  // silently mutating the primary's cut on first add.
                }}
                onSplitEqually={() => {
                  // Compute the full closer commission as primary's stored
                  // amount + sum of co-closer cuts (the parts the form is
                  // currently showing). Split across N parties; primary's
                  // amount stays as-is on save and the API reduces it by
                  // the sum of co-cuts to preserve deal totals.
                  const n = 1 + editVals.additionalClosers.length;
                  const sumCo = (field: keyof CoPartyDraft) =>
                    editVals.additionalClosers.reduce(
                      (s, co) => s + (parseFloat(co[field] as string) || 0),
                      0,
                    );
                  const totalM1 = (project.m1Amount ?? 0) + sumCo('m1Amount');
                  const totalM2 = (project.m2Amount ?? 0) + sumCo('m2Amount');
                  const totalM3 = (project.m3Amount ?? 0) + sumCo('m3Amount');
                  const m1Shares = evenSplit(totalM1, n);
                  const m2Shares = evenSplit(totalM2, n);
                  const m3Shares = evenSplit(totalM3, n);
                  setEditVals((v) => ({
                    ...v,
                    additionalClosers: v.additionalClosers.map((co, i) => ({
                      ...co,
                      m1Amount: String(m1Shares[i + 1] ?? 0),
                      m2Amount: String(m2Shares[i + 1] ?? 0),
                      m3Amount: m3Shares[i + 1] ? String(m3Shares[i + 1]) : '',
                    })),
                  }));
                }}
                splitPreview={
                  editVals.additionalClosers.length > 0
                    ? `Even split: each closer earns ${(100 / (1 + editVals.additionalClosers.length)).toFixed(0)}% of the deal.`
                    : undefined
                }
              />

              {/* Co-setters — same shape. */}
              <CoPartySection
                label="Co-setters"
                rows={editVals.additionalSetters}
                primaryUserId={editVals.setterId}
                excludeUserIds={[editVals.repId, editVals.setterId, ...editVals.additionalSetters.map((s) => s.userId), ...editVals.additionalClosers.map((c) => c.userId)].filter(Boolean)}
                repTypeFilter={(r) => r.repType === 'setter' || r.repType === 'both'}
                reps={reps}
                onChange={(rows) => setEditVals((v) => ({ ...v, additionalSetters: rows }))}
                disabled={!editVals.setterId}
                disabledReason="Select a primary setter above to add co-setters."
                onSplitEqually={() => {
                  const n = 1 + editVals.additionalSetters.length;
                  const sumCo = (field: keyof CoPartyDraft) =>
                    editVals.additionalSetters.reduce(
                      (s, co) => s + (parseFloat(co[field] as string) || 0),
                      0,
                    );
                  const totalM1 = (project.setterM1Amount ?? 0) + sumCo('m1Amount');
                  const totalM2 = (project.setterM2Amount ?? 0) + sumCo('m2Amount');
                  const totalM3 = (project.setterM3Amount ?? 0) + sumCo('m3Amount');
                  const m1Shares = evenSplit(totalM1, n);
                  const m2Shares = evenSplit(totalM2, n);
                  const m3Shares = evenSplit(totalM3, n);
                  setEditVals((v) => ({
                    ...v,
                    additionalSetters: v.additionalSetters.map((co, i) => ({
                      ...co,
                      m1Amount: String(m1Shares[i + 1] ?? 0),
                      m2Amount: String(m2Shares[i + 1] ?? 0),
                      m3Amount: m3Shares[i + 1] ? String(m3Shares[i + 1]) : '',
                    })),
                  }));
                }}
                splitPreview={
                  editVals.additionalSetters.length > 0
                    ? `Even split: each setter earns ${(100 / (1 + editVals.additionalSetters.length)).toFixed(0)}% of the deal. Each setter's trainer override applies to their share.`
                    : undefined
                }
              />

              {/* Per-project trainer override — admin-only one-off attachment. */}
              <div className="bg-[var(--surface-card)]/60 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Per-project trainer override</label>
                  {(editVals.trainerId || !editVals.noChainTrainer) && (
                    <button
                      type="button"
                      onClick={() => setEditVals((v) => ({ ...v, trainerId: '', trainerRate: '', noChainTrainer: true }))}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-red-text)] transition-colors"
                      title="Remove all trainers from this deal — chain trainer will no longer see it or earn override"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[var(--text-muted)] text-xs mb-3">
                  Optional: attach a specific trainer + rate to this deal only. Bypasses the rep-level
                  TrainerAssignment chain. Use for historical deals or one-off mentors.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[var(--text-secondary)] text-[11px] block mb-1">Trainer</label>
                    <select
                      value={editVals.trainerId}
                      onChange={(e) => setEditVals((v) => ({
                        ...v,
                        trainerId: e.target.value,
                        // Picking any dropdown option (including "— none —") clears the
                        // explicit-removal flag — chain trainer can apply again.
                        noChainTrainer: false,
                      }))}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                    >
                      <option value="">— none —</option>
                      {reps
                        .filter((r) => r.active && r.id !== editVals.setterId)
                        .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-[11px] block mb-1">Rate ($/W)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="5"
                      placeholder="0.20"
                      value={editVals.trainerRate}
                      onChange={(e) => setEditVals((v) => ({ ...v, trainerRate: e.target.value }))}
                      disabled={!editVals.trainerId}
                      className={`w-full bg-[var(--surface-card)] border text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] disabled:opacity-50 ${
                        editVals.trainerId && editVals.trainerRate.trim() === ''
                          ? 'border-amber-500/60'
                          : 'border-[var(--border)]'
                      }`}
                    />
                  </div>
                </div>
                {editVals.trainerId && editVals.trainerRate.trim() === '' && (
                  <p className="text-[var(--accent-amber-text)] text-xs mt-2">
                    Rate is required — without a rate the trainer override calculates as $0.
                    Typical: $0.10–$0.20 per watt.
                  </p>
                )}
                {!editVals.trainerId && editVals.noChainTrainer && (
                  <p className="text-[var(--accent-red-text)] text-xs mt-2">
                    Trainer removed — chain trainer (if any) will not see this deal or earn override.
                    Pick a trainer above to restore.
                  </p>
                )}
                {editVals.trainerId === project.repId && editVals.setterId && (
                  <p className="text-[var(--accent-cyan-text)] text-xs mt-2">
                    The closer is also the trainer on this deal — the override pays the closer
                    for training the setter. Deducted from the setter&apos;s split, not the closer&apos;s.
                  </p>
                )}
              </div>


              {/* Sold Date */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Sold Date</label>
                <input type="date" value={editVals.soldDate}
                  onChange={(e) => { setEditVals((v) => ({ ...v, soldDate: e.target.value })); setEditErrors((prev) => ({ ...prev, soldDate: '' })); }}
                  className={`w-full bg-[var(--surface-card)] border ${editErrors.soldDate ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`} />
                {editErrors.soldDate && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.soldDate}</p>}
              </div>

              {/* Lead Source + Blitz attribution — admin / internal-PM only.
                  Reuses the new-deal form's pill picker UX so the experience
                  is consistent. The Blitz dropdown only appears when source
                  is 'blitz' and is filtered to blitzes the project's closer
                  is approved on (matches the API's blitz-participant gate). */}
              {canSeeInternalOnlyUi && (
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">
                    Lead Source <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'organic', label: 'Organic' },
                      { value: 'referral', label: 'Referral' },
                      { value: 'blitz', label: 'Blitz' },
                      { value: 'door_knock', label: 'Door Knock' },
                      { value: 'web', label: 'Web Lead' },
                      { value: 'other', label: 'Other' },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setEditVals((v) => {
                            const next = v.leadSource === value ? '' : value;
                            // Clear blitzId whenever leadSource is no longer
                            // 'blitz' — prevents orphan attribution.
                            return {
                              ...v,
                              leadSource: next,
                              blitzId: next === 'blitz' ? v.blitzId : '',
                            };
                          });
                        }}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                          editVals.leadSource === value
                            ? 'bg-[var(--accent-emerald-solid)] border-[var(--accent-emerald-solid)] text-black shadow-[0_0_10px_var(--accent-emerald-glow)]'
                            : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {editVals.leadSource === 'blitz' && (
                    <select
                      value={editVals.blitzId}
                      onChange={(e) => setEditVals((v) => ({ ...v, blitzId: e.target.value }))}
                      className="mt-2 w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                    >
                      <option value="">— Select Blitz —</option>
                      {editAvailableBlitzes.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  )}
                  {editVals.leadSource === 'blitz' && editAvailableBlitzes.length === 0 && (
                    <p className="text-[var(--text-muted)] text-xs mt-1.5">
                      No blitzes available for this closer. Add the closer as an approved participant first.
                    </p>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Notes</label>
                <textarea rows={2} value={editVals.notes} onChange={(e) => setEditVals((v) => ({ ...v, notes: e.target.value }))}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] resize-none" />
              </div>

              {/* Baseline Override */}
              <div className="bg-[var(--surface-card)]/60 rounded-xl p-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={editVals.useBaselineOverride}
                    onChange={(e) => setEditVals((v) => ({ ...v, useBaselineOverride: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[var(--accent-emerald-solid)]" />
                  <span className="text-[var(--text-secondary)] text-sm font-medium">Override baseline for this project</span>
                </label>
                {editVals.useBaselineOverride && (
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Closer $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideCloserPerW}
                        placeholder={String(installerBaselines[editVals.installer]?.closerPerW ?? 2.90)}
                        onChange={(e) => { setEditVals((v) => ({ ...v, overrideCloserPerW: e.target.value })); setEditErrors((prev) => ({ ...prev, overrideCloserPerW: '' })); }}
                        className={`w-full bg-[var(--border)] border ${editErrors.overrideCloserPerW ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`} />
                      {editErrors.overrideCloserPerW && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.overrideCloserPerW}</p>}
                    </div>
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Setter $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideSetterPerW}
                        placeholder={editVals.overrideCloserPerW
                          ? String(Math.round((parseFloat(editVals.overrideCloserPerW) + 0.10) * 100) / 100)
                          : String(Math.round(((installerBaselines[editVals.installer]?.closerPerW ?? 2.90) + 0.10) * 100) / 100)}
                        onChange={(e) => setEditVals((v) => ({ ...v, overrideSetterPerW: e.target.value }))}
                        className="w-full bg-[var(--border)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]" />
                    </div>
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Kilo $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideKiloPerW}
                        placeholder={String(installerBaselines[editVals.installer]?.kiloPerW ?? 2.35)}
                        onChange={(e) => { setEditVals((v) => ({ ...v, overrideKiloPerW: e.target.value })); setEditErrors((prev) => ({ ...prev, overrideKiloPerW: '' })); }}
                        className={`w-full bg-[var(--border)] border ${editErrors.overrideKiloPerW ? 'border-red-500' : 'border-[var(--border)]'} text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]`} />
                      {editErrors.overrideKiloPerW && <p className="text-[var(--accent-red-text)] text-xs mt-1">{editErrors.overrideKiloPerW}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Live Commission Preview ────────────────────────────────── */}
            {(() => {
              const previewKW = parseFloat(editVals.kWSize);
              const previewPPW = parseFloat(editVals.netPPW);
              if (isNaN(previewKW) || isNaN(previewPPW) || previewKW <= 0 || previewPPW <= 0) return null;

              let previewBaseline: InstallerBaseline;
              if (editVals.useBaselineOverride) {
                const overrideCloser = parseFloat(editVals.overrideCloserPerW);
                const overrideKilo = parseFloat(editVals.overrideKiloPerW);
                if (isNaN(overrideCloser) || isNaN(overrideKilo)) {
                  return (
                    <div className="mt-4 rounded-xl p-4 bg-[var(--accent-amber-soft)] border border-amber-500/30">
                      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                      <p className="text-[var(--accent-amber-text)] text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Enter valid Closer $/W and Kilo $/W values to see the commission preview.
                      </p>
                    </div>
                  );
                }
                const overrideSetter = parseFloat(editVals.overrideSetterPerW);
                previewBaseline = {
                  closerPerW: overrideCloser,
                  kiloPerW: overrideKilo,
                  ...(!isNaN(overrideSetter) ? { setterPerW: overrideSetter } : {}),
                };
              } else if (editVals.installer === 'SolarTech' && !editVals.solarTechProductId) {
                return (
                  <div className="mt-4 rounded-xl p-4 bg-[var(--accent-amber-soft)] border border-amber-500/30">
                    <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                    <p className="text-[var(--accent-amber-text)] text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> A SolarTech product selection is required to preview commission.
                    </p>
                  </div>
                );
              } else if (editVals.installer === 'SolarTech' && editVals.solarTechProductId) {
                try {
                  previewBaseline = getSolarTechBaseline(editVals.solarTechProductId, previewKW, solarTechProducts);
                } catch {
                  return (
                    <div className="mt-4 rounded-xl p-4 bg-[var(--accent-amber-soft)] border border-amber-500/30">
                      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                      <p className="text-[var(--accent-amber-text)] text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Sold with a product that&apos;s no longer in the active catalog. Stored commission amounts will be preserved on save.
                      </p>
                    </div>
                  );
                }
              } else if (productCatalogProducts.some((p) => p.installer === editVals.installer)) {
                // Product-catalog installer (e.g. BVI). Preview from the
                // admin's chosen product (the new pick if changed, else the
                // deal's current one) so the redline updates live on change.
                const pcProductId = editVals.installerProductId || project.installerProductId;
                if (!pcProductId) {
                  return (
                    <div className="mt-4 rounded-xl p-4 bg-[var(--accent-amber-soft)] border border-amber-500/30">
                      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                      <p className="text-[var(--accent-amber-text)] text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Select a product to preview commission.
                      </p>
                    </div>
                  );
                }
                previewBaseline = getProductCatalogBaselineVersioned(productCatalogProducts, pcProductId, previewKW, editVals.soldDate || project.soldDate, productCatalogPricingVersions);
              } else {
                previewBaseline = getInstallerRatesForDeal(editVals.installer, editVals.soldDate || project.soldDate, previewKW, installerPricingVersions);
              }

              const previewInstallPayPct = installerPayConfigs[editVals.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const previewSetterPerW = 'setterPerW' in previewBaseline && (previewBaseline as { setterPerW?: number | null }).setterPerW != null
                ? (previewBaseline as { setterPerW: number }).setterPerW
                : Math.round((previewBaseline.closerPerW + 0.10) * 100) / 100;
              const belowBaseline = previewPPW < previewBaseline.closerPerW;

              // Sub-dealer deals use a separate commission formula handled
              // server-side — skip the standard preview to avoid showing
              // misleading numbers.
              if (project.subDealerId) {
                return (
                  <div className="mt-4 rounded-xl p-4 bg-[var(--surface-card)]/60 border border-[var(--border)]/40">
                    <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                    <p className="text-[var(--text-muted)] text-xs">Sub-dealer commission preview is computed on save (separate from the standard rep formula).</p>
                  </div>
                );
              }

              // Use the canonical splitCloserSetterPay so the preview matches
              // the server compute exactly (closer-differential + half-split,
              // not independent above-baseline totals). Previously the preview
              // overstated both rep totals when a setter was present, and the
              // Kilo Margin downstream-clamped to $0 — see commission preview
              // bug fix 2026-05-11.
              //
              // Trainer resolution mirrors the server (lib/context/project-
              // transitions.ts). Two independent paths:
              //   - Closer side: project-level override (editVals.trainerId)
              //     wins if set; otherwise the closer's chain via
              //     resolveTrainerRate + trainerAssignments. Applied post-
              //     split via applyCloserTrainerDeduction.
              //   - Setter side: always chain-only (project-level trainer
              //     is closer-scoped per project-transitions.ts comment).
              //     Folded into splitCloserSetterPay's trainerRate param
              //     which shifts the setter's split point.
              //
              // Prior to 2026-05-12 this preview missed the closer-chain
              // deduction entirely, surfacing as a "breakdown vs overall
              // mismatch" on Charles Edward Lotts II (Hunter+Chris both
              // had 10¢ chain trainers — $1,066 unaccounted for).
              const projectOverrideRate = (() => {
                const r = parseFloat(editVals.trainerRate);
                return editVals.trainerId && Number.isFinite(r) ? r : 0;
              })();
              const closerChainResolved = resolveTrainerRate(
                { id: project.id, trainerId: editVals.trainerId || null, trainerRate: projectOverrideRate || null },
                project.repId,
                trainerAssignments,
                payrollEntries,
              );
              const closerTrainerRate = closerChainResolved.rate;
              const setterChainResolved = editVals.setterId
                ? resolveTrainerRate(
                    { id: project.id, trainerId: null, trainerRate: null },
                    editVals.setterId,
                    trainerAssignments,
                    payrollEntries,
                  )
                : { rate: 0, trainerId: null };
              const setterTrainerRate = setterChainResolved.rate;
              const previewSplit = splitCloserSetterPay(
                previewPPW,
                previewBaseline.closerPerW,
                editVals.setterId ? previewSetterPerW : 0,
                setterTrainerRate,
                previewKW,
                previewInstallPayPct,
              );
              const deductedSplit = applyCloserTrainerDeduction(
                previewSplit,
                closerTrainerRate,
                previewKW,
                previewInstallPayPct,
              );
              const closerTotal = deductedSplit.closerTotal;
              const setterTotal = deductedSplit.setterTotal;
              const closerM1 = deductedSplit.closerM1;
              const closerM2 = deductedSplit.closerM2;
              const closerM3 = deductedSplit.closerM3;
              const setterM1 = deductedSplit.setterM1;
              const setterM2 = deductedSplit.setterM2;
              const setterM3 = deductedSplit.setterM3;
              const previewHasM3 = previewInstallPayPct < 100 && !project.subDealerId;
              // Trainer payout = closer-side + setter-side per-watt rates.
              // Both come out of the gross-above-kiloPerW pool, so Kilo
              // Margin must subtract them to match the server compute.
              const closerTrainerPayout = closerTrainerRate * previewKW * 1000;
              const setterTrainerPayout = setterTrainerRate * previewKW * 1000;
              const trainerPayout = closerTrainerPayout + setterTrainerPayout;
              // Actual Kilo take on this deal: gross above wholesale, minus
              // all commission paid out (closer + setter + trainer override).
              const kiloMargin = Math.round(
                ((previewPPW - previewBaseline.kiloPerW) * previewKW * 1000 - closerTotal - setterTotal - trainerPayout) * 100,
              ) / 100;
              // Kilo Margin is admin-internal (sensitive). Render the cell
              // only for admin viewers and adjust grid-cols accordingly so
              // non-admin layout doesn't have an empty column.
              const showKiloMargin = effectiveRole === 'admin';

              return (
                <div className={`mt-4 rounded-xl p-4 ${belowBaseline ? 'bg-[var(--accent-amber-soft)] border border-amber-500/30' : 'bg-[var(--surface-card)]/60 border border-[var(--border)]/40'}`}>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                  {editVals.setterId ? (() => {
                    // Setter case columns vary: setter M1/M2 (+M3) + closer M2
                    // (+M3) + optional Kilo Margin (admin only). Use literal
                    // grid-cols-N strings so Tailwind JIT can detect them.
                    const setterColumns = previewHasM3 ? 3 : 2;
                    const closerColumns = previewHasM3 ? 2 : 1;
                    const marginColumns = showKiloMargin ? 1 : 0;
                    const totalCols = setterColumns + closerColumns + marginColumns;
                    const gridClass =
                      totalCols === 6 ? 'grid grid-cols-6 gap-3 text-center' :
                      totalCols === 5 ? 'grid grid-cols-5 gap-3 text-center' :
                      totalCols === 4 ? 'grid grid-cols-4 gap-3 text-center' :
                      'grid grid-cols-3 gap-3 text-center';
                    return (
                      <div className={gridClass}>
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M1</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${setterM1.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M2</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${setterM2.toLocaleString()}</p>
                        </div>
                        {previewHasM3 && (
                          <div>
                            <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M3</p>
                            <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${setterM3.toLocaleString()}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M2</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${closerM2.toLocaleString()}</p>
                        </div>
                        {previewHasM3 && (
                          <div>
                            <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M3</p>
                            <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${closerM3.toLocaleString()}</p>
                          </div>
                        )}
                        {showKiloMargin && (
                          <div>
                            <p className="text-[var(--text-muted)] text-[10px] uppercase">Kilo Margin</p>
                            <p className={`font-bold text-sm ${kiloMargin < 0 ? 'text-[var(--accent-red-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${kiloMargin.toLocaleString()}</p>
                          </div>
                        )}
                      </div>
                    );
                  })() : (() => {
                    // Self-gen case: closer M1/M2 (+M3) + optional Kilo Margin.
                    const closerColumns = previewHasM3 ? 3 : 2;
                    const marginColumns = showKiloMargin ? 1 : 0;
                    const totalCols = closerColumns + marginColumns;
                    const gridClass =
                      totalCols === 4 ? 'grid grid-cols-4 gap-3 text-center' :
                      totalCols === 3 ? 'grid grid-cols-3 gap-3 text-center' :
                      'grid grid-cols-2 gap-3 text-center';
                    return (
                      <div className={gridClass}>
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M1</p>
                          <p className="text-[var(--text-primary)] font-bold text-sm">${closerM1.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M2</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${closerM2.toLocaleString()}</p>
                        </div>
                        {previewHasM3 && (
                          <div>
                            <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M3</p>
                            <p className={`font-bold text-sm ${belowBaseline ? 'text-[var(--accent-amber-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${closerM3.toLocaleString()}</p>
                          </div>
                        )}
                        {showKiloMargin && (
                          <div>
                            <p className="text-[var(--text-muted)] text-[10px] uppercase">Kilo Margin</p>
                            <p className={`font-bold text-sm ${kiloMargin < 0 ? 'text-[var(--accent-red-text)]' : 'text-[var(--accent-emerald-text)]'}`}>${kiloMargin.toLocaleString()}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {belowBaseline && (
                    <p className="text-[var(--accent-amber-text)] text-xs mt-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> PPW is below the installer baseline (${previewBaseline.closerPerW}/W)
                    </p>
                  )}
                </div>
              );
            })()}

            {showPaidEquipmentWarning && (
              <div className="mt-4 rounded-xl p-4 bg-[var(--accent-amber-soft)] border border-amber-500/40">
                <p className="text-[var(--accent-amber-text)] text-xs font-semibold flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> This deal has a paid milestone
                </p>
                <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
                  Changing equipment recomputes the redline and re-aligns unpaid (Draft/Pending) amounts, but <strong className="text-[var(--text-primary)]">already-paid amounts are NOT adjusted</strong>. Reconcile any difference manually via the paid-entry edit / chargeback tools after saving.
                </p>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  // Confirm before a redline change on a deal with paid money.
                  if (showPaidEquipmentWarning && typeof window !== 'undefined'
                    && !window.confirm('This deal has a paid milestone. Changing equipment recomputes the redline but will NOT adjust already-paid amounts — you must reconcile manually. Continue?')) {
                    return;
                  }
                  onSave();
                }}
                className="flex-1 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                style={{ backgroundColor: 'var(--brand)', color: 'var(--text-on-accent)' }}>
                Save Changes
              </button>
              <button onClick={() => { onClose(); }}
                className="flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-[var(--text-primary)] font-medium py-2.5 rounded-xl transition-colors text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>,
    document.body);
}
