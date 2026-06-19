'use client';

// Phase 3 A2 — draft-then-publish pricing editor (SolarTech + Product-Catalog).
//
// Replaces the old inline per-keystroke grid (which minted a version on every
// keypress and caused the pricing corruption). Here, edits mutate a local DRAFT
// only; nothing hits the server until you Publish, which creates ONE future-
// dated version per changed product in a single transaction. All draft math
// lives in ./draftPricingReducer (unit-tested); this file is the view + wiring.

import { useReducer, useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { RotateCcw, Sparkles, AlertTriangle, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Input';
import { businessToday } from '@/lib/pricing/validate-version';
import { BulkVersionPublishError } from '@/lib/context/installers';
import { useToast } from '@/lib/toast';
import {
  draftReducer, seedDraftFromActive,
  parseRate, isCellDirty, cellDelta, isProductDirty, isProductValid, isDraftDirty,
  productValidationErrors, validProductsForPublish, canPublish, hasStaleSeed, buildPublishPayload, buildPublishDiff,
  type SeedProduct, type SeedVersion, type DraftCellValue, type CellField, type DiffField,
} from './draftPricingReducer';

const FIELD_LABEL: Record<DiffField, string> = { closer: 'Closer', kilo: 'Kilo', subDealer: 'Sub-dealer' };
const fmt = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

type ApplyBulkVersionCreate = (input: {
  effectiveFrom: string; label: string; reason?: string; retroactive?: boolean; idempotencyKey?: string;
  products: ReadonlyArray<{ productId: string; tiers: ReadonlyArray<{ minKW: number; maxKW: number | null; closerPerW: number; setterPerW: number; kiloPerW: number; subDealerPerW?: number | null }> }>;
}) => Promise<{ created: Array<{ id: string; productId: string; label: string; effectiveFrom: string }> }>;

type Toast = ReturnType<typeof useToast>['toast'];

export interface DraftPricingEditorProps {
  scope: { kind: 'solartech'; family: string } | { kind: 'productcatalog'; installer: string; family: string };
  products: ReadonlyArray<SeedProduct>;
  versions: ReadonlyArray<SeedVersion>;
  showSubDealerRates: boolean;
  applyBulkVersionCreate: ApplyBulkVersionCreate;
  toast: Toast;
  /** Filter which rows are DISPLAYED (the draft still covers all products so a
   *  hidden dirty row still publishes). */
  searchQuery?: string;
  /** Rename — parent validates (uniqueness in family) + persists + toasts, and
   *  returns true on success so the editor exits edit mode. Omit to disable. */
  onRenameProduct?: (productId: string, rawNewName: string) => boolean;
  /** Archive a product — parent shows the confirm dialog + removes. Omit to disable. */
  onArchiveProduct?: (productId: string, productName: string) => void;
}

const tierLabel = (t: { minKW: number; maxKW: number | null }) =>
  t.maxKW == null ? `${t.minKW}+ kW` : `${t.minKW}–${t.maxKW} kW`;

/** Business-local (Pacific) tomorrow as YYYY-MM-DD — the earliest publishable
 *  effective date (the server rejects <= today without retroactive). */
function businessTomorrow(): string {
  const d = new Date(`${businessToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function DraftPricingEditor({ scope, products, versions, showSubDealerRates, applyBulkVersionCreate, toast, searchQuery = '', onRenameProduct, onArchiveProduct }: DraftPricingEditorProps) {
  const familyKey = scope.kind === 'productcatalog' ? `${scope.installer}:${scope.family}` : scope.family;
  const seedFromProps = useMemo(() => seedDraftFromActive(products, versions, new Date()), [products, versions]);
  const [state, dispatch] = useReducer(draftReducer, seedFromProps, (s) => s);

  // Re-seed after our OWN publish (the optimistic context update flows new
  // versions back through props → recompute seed → clear dirty/deltas).
  const [pendingReseed, setPendingReseed] = useState(false);
  useEffect(() => {
    if (pendingReseed) { dispatch({ type: 'RESEED', seed: seedFromProps }); setPendingReseed(false); }
  }, [pendingReseed, seedFromProps]);

  // Publish drawer state.
  const [showPublish, setShowPublish] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const idemRef = useRef<string | null>(null);

  // Bulk-adjust drawer state.
  const [showBulk, setShowBulk] = useState(false);
  const [bulkDelta, setBulkDelta] = useState('');

  // Inline product-rename state.
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameVal, setEditNameVal] = useState('');
  const nameSavedRef = useRef(false);

  const dirty = isDraftDirty(state);
  const publishable = canPublish(state);
  const stale = hasStaleSeed(state, versions, new Date()) && !pendingReseed && !submitting;
  const dirtyInvalid = state.productOrder
    .map((id) => state.byProductId[id])
    .filter((p) => isProductDirty(p) && !isProductValid(p));

  const columns = products[0]?.tiers ?? [];
  const minDate = businessTomorrow();

  const q = searchQuery.trim().toLowerCase();
  const visibleIds = q
    ? state.productOrder.filter((id) => state.byProductId[id].name.toLowerCase().includes(q))
    : state.productOrder;

  // Current numeric value of a cell (live edit if parseable, else seed) — for
  // the profit-summary row.
  const cellNum = (c: DraftCellValue): number | null => {
    const p = parseRate(c.raw, { optional: true });
    return p.ok ? p.value : c.seed;
  };
  const columnAvgProfit = (tierIndex: number): number => {
    const profits = state.productOrder
      .map((id) => state.byProductId[id].tiers[tierIndex])
      .filter(Boolean)
      .map((t) => (cellNum(t.closerPerW) ?? 0) - (cellNum(t.kiloPerW) ?? 0));
    return profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
  };

  const commitRename = (productId: string) => {
    if (nameSavedRef.current) { nameSavedRef.current = false; return; }
    nameSavedRef.current = true;
    const ok = onRenameProduct?.(productId, editNameVal) ?? true;
    if (ok) setEditingName(null);
    else nameSavedRef.current = false; // keep editing on validation failure
  };

  const setCell = useCallback((productId: string, tierIndex: number, field: CellField, raw: string) => {
    dispatch({ type: 'SET_CELL', productId, tierIndex, field, raw });
  }, []);

  const reloadLatest = () => dispatch({ type: 'RESEED', seed: seedDraftFromActive(products, versions, new Date()) });

  const handlePublish = async () => {
    setDateError(null);
    const payload = buildPublishPayload(state);
    if (!payload.length) { toast('Nothing changed to publish.', 'info'); return; }
    if (!label.trim()) { return; }
    if (!effectiveFrom || effectiveFrom <= businessToday()) { setDateError('Effective date must be after today.'); return; }
    if (!idemRef.current) idemRef.current = `pub_${scope.kind}_${familyKey}_${effectiveFrom}_${(crypto.randomUUID?.() ?? String(performance.now()))}`;
    setSubmitting(true);
    try {
      const res = await applyBulkVersionCreate({ effectiveFrom, label: label.trim(), reason: reason.trim() || undefined, idempotencyKey: idemRef.current, products: payload });
      toast(`Published “${label.trim()}” for ${res.created.length} product${res.created.length === 1 ? '' : 's'}, effective ${effectiveFrom}`, 'success');
      idemRef.current = null;
      setShowPublish(false); setLabel(''); setReason(''); setEffectiveFrom('');
      setPendingReseed(true);
    } catch (e) {
      handlePublishError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishError = (e: unknown) => {
    if (e instanceof BulkVersionPublishError) {
      switch (e.code) {
        case 'retroactive_effective_date':
          setDateError('Effective date must be after today.'); return;
        case 'invalid_tiers':
          toast(`Pricing rejected: ${(e.messages ?? ['invalid tiers']).join('; ')}`, 'error'); return;
        case 'invalid_window':
          toast('Publish conflicts with this product’s version timeline — reload latest and retry.', 'error');
          setPendingReseed(true); return;
        case 'unknown_products':
          toast('Some products no longer exist — reload latest.', 'error'); setPendingReseed(true); return;
        case 'duplicate_request':
          toast('This publish already went through.', 'info'); idemRef.current = null; setShowPublish(false); setPendingReseed(true); return;
      }
      if (e.status === 429) { toast('Too many publishes — wait a minute and retry.', 'error'); return; }
      if (e.message.includes('step_up_required')) { toast('Re-authentication required — sign out and back in, then retry.', 'error'); return; }
    }
    toast('Publish failed — try again.', 'error');
  };

  const applyBulkDelta = () => {
    const n = Number(bulkDelta);
    if (!bulkDelta.trim() || !Number.isFinite(n)) return;
    dispatch({ type: 'BULK_ADJUST_CLOSER', delta: n });
    setShowBulk(false); setBulkDelta('');
  };

  return (
    <div className="relative">
      {stale && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <span className="flex items-center gap-2 text-[var(--accent-amber-text)] text-xs font-medium">
            <AlertTriangle className="w-3.5 h-3.5" /> Pricing changed since you started editing.
          </span>
          <SecondaryButton size="sm" onClick={reloadLatest}>Reload latest</SecondaryButton>
        </div>
      )}

      <div className="mb-3 flex items-center justify-end">
        <SecondaryButton size="sm" onClick={() => setShowBulk((v) => !v)}>
          <Sparkles className="w-3.5 h-3.5" /> Bulk adjust
        </SecondaryButton>
      </div>
      {showBulk && (
        <div className="mb-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset-subtle)] p-3">
          <p className="text-[var(--text-secondary)] text-xs mb-2">Adjust every closer rate by an amount (kilo unchanged, setter re-derives). Applied to the draft — review, then Publish.</p>
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] text-xs">Δ closer $/W</span>
            <input type="number" step="0.01" value={bulkDelta} onChange={(e) => setBulkDelta(e.target.value)} placeholder="-0.10"
              className="w-24 bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />
            <PrimaryButton size="sm" onClick={applyBulkDelta} disabled={!bulkDelta.trim()}>Apply to draft</PrimaryButton>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header-frost">
              <th className="px-4 py-2.5 text-left text-[var(--text-secondary)] text-xs font-semibold">Product</th>
              {columns.map((t, i) => (
                <th key={i} className="px-2 py-2.5 text-center text-[var(--text-secondary)] text-xs font-semibold">{tierLabel(t)}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {state.productOrder.length > 0 && (
              <tr className="bg-[var(--surface-card)]/60 border-t border-[var(--border-subtle)]">
                <td className="px-4 py-2 text-[var(--text-secondary)] text-xs font-medium">
                  {state.productOrder.length} product{state.productOrder.length === 1 ? '' : 's'}
                </td>
                {columns.map((_, ti) => {
                  const avg = columnAvgProfit(ti);
                  return (
                    <td key={ti} className="px-2 py-2 text-center">
                      <span className={`text-[10px] font-semibold ${avg > 0 ? 'text-[var(--accent-emerald-text)]/70' : 'text-[var(--accent-red-text)]/70'}`}>${avg.toFixed(2)} profit</span>
                    </td>
                  );
                })}
                <td />
              </tr>
            )}
            {visibleIds.map((id) => {
              const p = state.byProductId[id];
              const pDirty = isProductDirty(p);
              const isEditing = editingName === id;
              return (
                <tr key={id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-card)]/30 transition-colors group">
                  <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium align-top max-w-[220px]">
                    {isEditing ? (
                      <input autoFocus type="text" value={editNameVal}
                        onChange={(e) => setEditNameVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(id); else if (e.key === 'Escape') { nameSavedRef.current = true; setEditingName(null); } }}
                        onBlur={() => commitRename(id)}
                        className="w-full bg-[var(--surface-card)] border border-[var(--accent-emerald-solid)] text-[var(--text-primary)] rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" />
                    ) : (
                      <span className={onRenameProduct ? 'cursor-pointer inline-flex items-center gap-1.5 group/name' : 'inline-flex items-center'}
                        onClick={() => { if (onRenameProduct) { setEditingName(id); setEditNameVal(p.name); } }}>
                        {p.name}
                        {onRenameProduct && <Pencil className="w-3 h-3 text-[var(--text-dim)] opacity-0 group-hover/name:opacity-100 transition-opacity" />}
                      </span>
                    )}
                  </td>
                  {p.tiers.map((t, ti) => (
                    <td key={ti} className="px-2 py-2 text-center align-top">
                      <div className="flex flex-col gap-0.5 items-center">
                        <RateCell value={t.closerPerW} field="closer" tone="emerald" onChange={(v) => setCell(id, ti, 'closer', v)} />
                        <RateCell value={t.kiloPerW} field="kilo" tone="emeraldDim" onChange={(v) => setCell(id, ti, 'kilo', v)} />
                        {showSubDealerRates && (
                          <RateCell value={t.subDealerPerW} field="subDealer" tone="amber" placeholder="—" onChange={(v) => setCell(id, ti, 'subDealer', v)} />
                        )}
                      </div>
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top text-center">
                    <div className="flex items-center gap-1 justify-center">
                      {pDirty && (
                        <IconButton variant="neutral" aria-label={`Reset ${p.name}`} onClick={() => dispatch({ type: 'RESET_PRODUCT', productId: id })}>
                          <RotateCcw className="w-3.5 h-3.5" />
                        </IconButton>
                      )}
                      {onArchiveProduct && (
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <IconButton variant="danger" aria-label={`Archive ${p.name}`} onClick={() => onArchiveProduct(id, p.name)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconButton>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleIds.length === 0 && (
              <tr><td colSpan={columns.length + 2} className="px-4 py-8 text-center text-[var(--text-dim)] text-xs">
                {q ? 'No products match your search.' : 'No products for this family.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {dirtyInvalid.length > 0 && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-1.5">
          {dirtyInvalid.map((p) => (
            <div key={p.productId} className="text-xs">
              <span className="text-[var(--accent-red-text)] font-semibold">{p.name}:</span>{' '}
              <span className="text-[var(--text-secondary)]">{productValidationErrors(p).join(' · ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sticky action bar — appears only when there are unsaved draft changes. */}
      {dirty && (
        <div className="sticky bottom-0 z-10 mt-4 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)]/95 backdrop-blur px-4 py-3 shadow-lg">
          <span className="text-[var(--text-secondary)] text-xs">
            {validProductsForPublish(state).length} product{validProductsForPublish(state).length === 1 ? '' : 's'} ready
            {dirtyInvalid.length > 0 && <span className="text-[var(--accent-red-text)]"> · {dirtyInvalid.length} with errors</span>}
          </span>
          <div className="flex items-center gap-2">
            <SecondaryButton size="sm" onClick={() => dispatch({ type: 'RESET_ALL' })}>Discard all</SecondaryButton>
            <PrimaryButton size="sm" disabled={!publishable || stale} onClick={() => { setShowPublish(true); if (!effectiveFrom) setEffectiveFrom(minDate); }}>
              <CalendarClock className="w-3.5 h-3.5" /> Publish…
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Publish drawer */}
      {showPublish && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 animate-modal-backdrop" onClick={() => !submitting && setShowPublish(false)}>
          <div className="card-surface animate-modal-panel w-full sm:max-w-md m-0 sm:m-4 rounded-t-2xl sm:rounded-2xl border border-[var(--border-default)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--text-primary)] font-semibold mb-1">Publish pricing</h3>
            <p className="text-[var(--text-muted)] text-xs mb-3">
              Creates a new version for {validProductsForPublish(state).length} product{validProductsForPublish(state).length === 1 ? '' : 's'}, effective on a future date. Existing deals keep their current rates.
            </p>
            {(() => {
              const diff = buildPublishDiff(state);
              return diff.length > 0 ? (
                <div className="mb-4 max-h-44 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset-subtle)] p-3 space-y-2.5">
                  {diff.map((d) => (
                    <div key={d.productId}>
                      <div className="text-[var(--text-primary)] text-xs font-semibold mb-0.5">{d.name}</div>
                      {d.changes.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                          <span>{c.tierLabel} · {FIELD_LABEL[c.field]}</span>
                          <span>{fmt(c.from)} → <span className="text-[var(--text-primary)] font-medium">{fmt(c.to)}</span>
                            {c.delta != null && <span className={c.delta > 0 ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}> ({c.delta > 0 ? '+' : ''}{c.delta.toFixed(2)})</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
            <div className="space-y-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Effective from</span>
                <TextInput type="date" value={effectiveFrom} min={minDate} invalid={!!dateError} onChange={(e) => { setEffectiveFrom(e.target.value); setDateError(null); }} />
                {dateError && <span className="block text-[var(--accent-red-text)] text-[10px] mt-1">{dateError}</span>}
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Label</span>
                <TextInput type="text" value={label} maxLength={50} placeholder="e.g. Q3 2026 Pricing" onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Reason (optional)</span>
                <TextInput type="text" value={reason} maxLength={500} placeholder="Why this change?" onChange={(e) => setReason(e.target.value)} />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <SecondaryButton size="sm" onClick={() => setShowPublish(false)} disabled={submitting}>Cancel</SecondaryButton>
              <PrimaryButton size="sm" loading={submitting} disabled={!label.trim() || !effectiveFrom || !publishable || stale} onClick={handlePublish}>Publish</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Single editable rate cell (compact numeric input + delta badge) ──────────
function RateCell({ value, field, tone, placeholder, onChange }: {
  value: DraftCellValue;
  field: CellField;
  tone: 'emerald' | 'emeraldDim' | 'amber';
  placeholder?: string;
  onChange: (raw: string) => void;
}) {
  const optional = field === 'subDealer';
  const parsed = parseRate(value.raw, { optional });
  const invalid = !parsed.ok;
  const dirty = isCellDirty(value, field);
  const delta = cellDelta(value, field);
  const textTone = tone === 'amber' ? 'text-[var(--accent-amber-text)]'
    : tone === 'emeraldDim' ? 'text-[var(--accent-emerald-text)]/80' : 'text-[var(--accent-emerald-text)]';
  const border = invalid ? 'border-[var(--accent-red-solid)] focus:ring-[var(--accent-red-solid)]'
    : dirty ? 'border-[var(--accent-amber-solid)] focus:ring-[var(--accent-amber-solid)]'
    : 'border-[var(--border-subtle)] focus:ring-[var(--accent-emerald-solid)]';
  return (
    <div className="flex flex-col items-center">
      <input
        type="number" step="0.01" min="0" inputMode="decimal"
        value={value.raw} placeholder={placeholder}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value)}
        className={`w-16 bg-[var(--surface-card)] border ${border} ${textTone} font-medium rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 transition-colors`}
      />
      {delta != null && (
        <span className={`text-[10px] font-semibold leading-tight ${delta > 0 ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(2)}
        </span>
      )}
    </div>
  );
}

export default DraftPricingEditor;
