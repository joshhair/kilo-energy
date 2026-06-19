'use client';

// Phase 3 A2 — MOBILE draft-then-publish pricing editor. Same tested reducer
// (./draftPricingReducer) as the desktop editor, but a card-based, touch-fluid
// view: one card per product, large decimal inputs, a fixed bottom action bar
// above the mobile nav, and a slide-up publish sheet. Mirrors the desktop
// invariants exactly — edits are draft-only, publish is future-dated only,
// nothing mutates live pricing in place.

import { useReducer, useState, useRef, useMemo, useEffect } from 'react';
import { RotateCcw, AlertTriangle, CalendarClock, X } from 'lucide-react';
import MobileCard from '@/app/dashboard/mobile/shared/MobileCard';
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

export interface MobileDraftPricingEditorProps {
  scope: { kind: 'solartech'; family: string } | { kind: 'productcatalog'; installer: string; family: string };
  products: ReadonlyArray<SeedProduct>;
  versions: ReadonlyArray<SeedVersion>;
  showSubDealerRates?: boolean;
  applyBulkVersionCreate: ApplyBulkVersionCreate;
  toast: Toast;
  /** Bubble dirty state to MobileSettings' unsaved-changes guard. */
  onUnsavedChange?: (dirty: boolean) => void;
}

const mFont = { fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" } as React.CSSProperties;
const tierLabel = (t: { minKW: number; maxKW: number | null }) => t.maxKW == null ? `${t.minKW}+ kW` : `${t.minKW}–${t.maxKW} kW`;

function businessTomorrow(): string {
  const d = new Date(`${businessToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function MobileDraftPricingEditor({ scope, products, versions, showSubDealerRates = false, applyBulkVersionCreate, toast, onUnsavedChange }: MobileDraftPricingEditorProps) {
  const familyKey = scope.kind === 'productcatalog' ? `${scope.installer}:${scope.family}` : scope.family;
  const seedFromProps = useMemo(() => seedDraftFromActive(products, versions, new Date()), [products, versions]);
  const [state, dispatch] = useReducer(draftReducer, seedFromProps, (s) => s);

  const [pendingReseed, setPendingReseed] = useState(false);
  useEffect(() => {
    if (pendingReseed) { dispatch({ type: 'RESEED', seed: seedFromProps }); setPendingReseed(false); }
  }, [pendingReseed, seedFromProps]);

  const dirty = isDraftDirty(state);
  useEffect(() => { onUnsavedChange?.(dirty); }, [dirty, onUnsavedChange]);

  const [showPublish, setShowPublish] = useState(false);
  const [sheetLeaving, setSheetLeaving] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const idemRef = useRef<string | null>(null);

  const publishable = canPublish(state);
  const stale = hasStaleSeed(state, versions, new Date()) && !pendingReseed && !submitting;
  const readyCount = validProductsForPublish(state).length;
  const invalidCount = state.productOrder.map((id) => state.byProductId[id]).filter((p) => isProductDirty(p) && !isProductValid(p)).length;
  const minDate = businessTomorrow();

  const closeSheet = () => { setSheetLeaving(true); setTimeout(() => { setShowPublish(false); setSheetLeaving(false); }, 240); };

  const handlePublish = async () => {
    setDateError(null);
    const payload = buildPublishPayload(state);
    if (!payload.length) { toast('Nothing changed to publish.', 'info'); return; }
    if (!label.trim()) return;
    if (!effectiveFrom || effectiveFrom <= businessToday()) { setDateError('Effective date must be after today.'); return; }
    if (!idemRef.current) idemRef.current = `pub_${scope.kind}_${familyKey}_${effectiveFrom}_${(crypto.randomUUID?.() ?? String(performance.now()))}`;
    setSubmitting(true);
    try {
      const res = await applyBulkVersionCreate({ effectiveFrom, label: label.trim(), reason: reason.trim() || undefined, idempotencyKey: idemRef.current, products: payload });
      toast(`Published “${label.trim()}” for ${res.created.length} product${res.created.length === 1 ? '' : 's'}`, 'success');
      idemRef.current = null;
      setLabel(''); setReason(''); setEffectiveFrom('');
      closeSheet();
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
        case 'retroactive_effective_date': setDateError('Effective date must be after today.'); return;
        case 'invalid_tiers': toast(`Pricing rejected: ${(e.messages ?? ['invalid tiers']).join('; ')}`, 'error'); return;
        case 'invalid_window': toast('Publish conflicts with this product’s version timeline — reload latest and retry.', 'error'); setPendingReseed(true); return;
        case 'unknown_products': toast('Some products no longer exist — reload latest.', 'error'); setPendingReseed(true); return;
        case 'duplicate_request': toast('This publish already went through.', 'info'); idemRef.current = null; closeSheet(); setPendingReseed(true); return;
      }
      if (e.status === 429) { toast('Too many publishes — wait a minute and retry.', 'error'); return; }
      if (e.message.includes('step_up_required')) { toast('Re-authentication required — sign out and back in, then retry.', 'error'); return; }
    }
    toast('Publish failed — try again.', 'error');
  };

  return (
    <div className="space-y-3" style={{ paddingBottom: dirty ? '6rem' : undefined }}>
      <p className="text-sm" style={{ ...mFont, color: 'var(--text-muted)' }}>
        Edit rates, then publish a future-dated version. Existing deals keep their current rates.
      </p>

      {stale && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[var(--accent-amber-text)] text-sm" style={mFont}><AlertTriangle className="w-4 h-4" /> Pricing changed since you started.</span>
          <button onClick={() => dispatch({ type: 'RESEED', seed: seedDraftFromActive(products, versions, new Date()) })} className="text-sm font-semibold text-[var(--accent-amber-text)] active:opacity-70">Reload</button>
        </div>
      )}

      {state.productOrder.length === 0 && (
        <p className="text-sm text-center py-8" style={{ ...mFont, color: 'var(--text-dim)' }}>No products in this family.</p>
      )}

      {state.productOrder.map((id) => {
        const p = state.byProductId[id];
        const pDirty = isProductDirty(p);
        const errs = pDirty && !isProductValid(p) ? productValidationErrors(p) : [];
        return (
          <MobileCard key={id}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-base font-semibold text-[var(--text-primary)]" style={mFont}>{p.name}</p>
              {pDirty && (
                <button onClick={() => dispatch({ type: 'RESET_PRODUCT', productId: id })} className="flex items-center gap-1 text-xs text-[var(--text-muted)] active:opacity-70 px-2 py-2 -mr-1 min-h-[44px]" aria-label={`Reset ${p.name}`}>
                  <RotateCcw className="w-3.5 h-3.5" /> Reset
                </button>
              )}
            </div>
            <div className="space-y-2">
              {p.tiers.map((t, ti) => (
                <div key={ti} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-sm" style={{ ...mFont, color: 'var(--text-muted)' }}>{tierLabel(t)}</span>
                  <MobileRate label="C" value={t.closerPerW} field="closer" onChange={(v) => dispatch({ type: 'SET_CELL', productId: id, tierIndex: ti, field: 'closer', raw: v })} />
                  <MobileRate label="K" value={t.kiloPerW} field="kilo" onChange={(v) => dispatch({ type: 'SET_CELL', productId: id, tierIndex: ti, field: 'kilo', raw: v })} />
                  {showSubDealerRates && (
                    <MobileRate label="SD" value={t.subDealerPerW} field="subDealer" placeholder="—" onChange={(v) => dispatch({ type: 'SET_CELL', productId: id, tierIndex: ti, field: 'subDealer', raw: v })} />
                  )}
                </div>
              ))}
            </div>
            {errs.length > 0 && (
              <p className="mt-2 text-xs text-[var(--accent-red-text)]" style={mFont}>{errs.join(' · ')}</p>
            )}
          </MobileCard>
        );
      })}

      {/* Fixed bottom action bar — above the mobile nav, safe-area aware. */}
      {dirty && (
        <div
          className="fixed left-0 right-0 z-30 flex items-center justify-between gap-3 border-t border-[var(--border-default)] bg-[var(--surface-elevated)]/95 backdrop-blur px-4 py-3"
          style={{ bottom: 'var(--kilo-bottom-nav-h, 0px)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <span className="text-sm text-[var(--text-secondary)]" style={mFont}>{readyCount} ready{invalidCount > 0 && <span className="text-[var(--accent-red-text)]"> · {invalidCount} with errors</span>}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => dispatch({ type: 'RESET_ALL' })} className="px-3 py-2 rounded-xl text-sm font-medium bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] active:opacity-70" style={mFont}>Discard all</button>
            <button onClick={() => { setShowPublish(true); if (!effectiveFrom) setEffectiveFrom(minDate); }} disabled={!publishable || stale}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ ...mFont, background: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)' }}>
              <CalendarClock className="w-4 h-4" /> Publish
            </button>
          </div>
        </div>
      )}

      {/* Publish bottom sheet */}
      {showPublish && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => !submitting && closeSheet()}>
          <div
            className={`w-full rounded-t-2xl border-t border-[var(--border-default)] bg-[var(--surface-card)] p-5 ${sheetLeaving ? 'animate-[slideDownOut_240ms_ease-in_both]' : 'motion-safe:animate-[slideUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]'}`}
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-[var(--text-primary)]" style={mFont}>Publish pricing</h3>
              <button onClick={closeSheet} className="p-2 -m-1 text-[var(--text-muted)] active:opacity-70" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3" style={mFont}>New version for {readyCount} product{readyCount === 1 ? '' : 's'}, effective on a future date. Existing deals keep current rates.</p>
            {(() => {
              const diff = buildPublishDiff(state);
              return diff.length > 0 ? (
                <div className="mb-4 max-h-44 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 space-y-2.5">
                  {diff.map((d) => (
                    <div key={d.productId}>
                      <div className="text-[var(--text-primary)] text-sm font-semibold mb-0.5" style={mFont}>{d.name}</div>
                      {d.changes.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-[var(--text-secondary)]" style={mFont}>
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
                <span className="block text-xs text-[var(--text-secondary)] mb-1" style={mFont}>Effective from</span>
                <input type="date" value={effectiveFrom} min={minDate} onChange={(e) => { setEffectiveFrom(e.target.value); setDateError(null); }}
                  className={`w-full rounded-xl px-3 py-2.5 text-base text-[var(--text-primary)] bg-[var(--surface-elevated)] border ${dateError ? 'border-[var(--accent-red-solid)]' : 'border-[var(--border-subtle)]'} focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]`} style={mFont} />
                {dateError && <span className="block text-[var(--accent-red-text)] text-xs mt-1" style={mFont}>{dateError}</span>}
              </label>
              <label className="block">
                <span className="block text-xs text-[var(--text-secondary)] mb-1" style={mFont}>Label</span>
                <input type="text" value={label} maxLength={50} placeholder="e.g. Q3 2026 Pricing" onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-base text-[var(--text-primary)] bg-[var(--surface-elevated)] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" style={mFont} />
              </label>
              <label className="block">
                <span className="block text-xs text-[var(--text-secondary)] mb-1" style={mFont}>Reason (optional)</span>
                <input type="text" value={reason} maxLength={500} placeholder="Why this change?" onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-base text-[var(--text-primary)] bg-[var(--surface-elevated)] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]" style={mFont} />
              </label>
            </div>
            <button onClick={handlePublish} disabled={submitting || !label.trim() || !effectiveFrom || !publishable || stale}
              className="mt-5 w-full py-3 rounded-xl text-base font-semibold disabled:opacity-40"
              style={{ ...mFont, background: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)' }}>
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact labeled rate input for mobile (touch-friendly, decimal keyboard).
function MobileRate({ value, field, label, placeholder, onChange }: {
  value: DraftCellValue;
  field: CellField;
  label: string;
  placeholder?: string;
  onChange: (raw: string) => void;
}) {
  const optional = field === 'subDealer';
  const parsed = parseRate(value.raw, { optional });
  const invalid = !parsed.ok;
  const dirty = isCellDirty(value, field);
  const delta = cellDelta(value, field);
  const border = invalid ? 'border-[var(--accent-red-solid)]' : dirty ? 'border-[var(--accent-amber-solid)]' : 'border-[var(--border-subtle)]';
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[var(--text-dim)]" style={mFont}>{label}</span>
        <input
          type="number" step="0.01" min="0" inputMode="decimal"
          value={value.raw} placeholder={placeholder}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full bg-[var(--surface-card)] border ${border} text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-base text-center focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]`}
          style={mFont}
        />
      </div>
      {delta != null && (
        <span className={`block text-center text-[10px] font-semibold ${delta > 0 ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-red-text)]'}`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(2)}
        </span>
      )}
    </div>
  );
}

export default MobileDraftPricingEditor;
