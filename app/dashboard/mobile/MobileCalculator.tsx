'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import {
  getSolarTechBaseline,
  calculateCommission,
  getInstallerRatesForDeal,
  getProductCatalogBaselineVersioned,
  getTrainerOverrideRate,
  SOLARTECH_FAMILIES,
  SOLARTECH_FAMILY_FINANCER,
  DEFAULT_INSTALL_PAY_PCT,
  INSTALLER_PAY_CONFIGS,
} from '../../../lib/data';
import { splitCloserSetterPay } from '../../../lib/commission';
import { todayLocalDateStr } from '../../../lib/utils';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a number as USD; safe against NaN / undefined / Infinity. */
function fmt$(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileCalculator() {
  const {
    currentRepId,
    effectiveRole,
    activeInstallers,
    installerPricingVersions,
    productCatalogInstallerConfigs,
    productCatalogProducts,
    productCatalogPricingVersions,
    installerPayConfigs,
    solarTechProducts,
    reps,
    trainerAssignments,
    payrollEntries,
  } = useApp();
  const isHydrated = useIsHydrated();

  useEffect(() => { document.title = 'Calculator | Kilo Energy'; }, []);

  // ── Form state ───────────────────────────────────────────────────────────
  const [installer, setInstaller] = useState('');
  const [solarTechFamily, setSolarTechFamily] = useState('');
  const [solarTechProductId, setSolarTechProductId] = useState('');
  const [pcProductId, setPcProductId] = useState('');
  const [pcSelectedFamily, setPcSelectedFamily] = useState('');
  const [kWSize, setKWSize] = useState('');
  const [netPPW, setNetPPW] = useState('');
  // Paired deal = closer + setter. Off = self-gen (all commission routes
  // to the closer side). Matches desktop calculator's role toggle.
  const [isPaired, setIsPaired] = useState(false);
  // Selected setter rep ID — when set, trainer rate is auto-derived from
  // the setter's trainer assignment, matching desktop calculator behavior.
  const [selectedSetterId, setSelectedSetterId] = useState('');
  // Optional sold date for historical pricing lookups (admin use case)
  const [pricingDate, setPricingDate] = useState('');

  // ── Derived installer flags ──────────────────────────────────────────────
  const isSolarTech = installer === 'SolarTech';
  const pcConfig = productCatalogInstallerConfigs[installer] ?? null;
  const isPcInstaller = pcConfig !== null;

  // SolarTech family products
  const solarTechFamilyProducts = solarTechFamily
    ? solarTechProducts.filter((p) => p.family === solarTechFamily)
    : [];

  // PC family products
  const pcFamilyProducts = isPcInstaller && pcSelectedFamily
    ? productCatalogProducts.filter((p) => p.installer === installer && p.family === pcSelectedFamily)
    : [];

  // ── Parsed values ────────────────────────────────────────────────────────
  const kW = parseFloat(kWSize) || 0;
  const soldPPW = parseFloat(netPPW) || 0;

  const hasInput = installer && kW > 0 && (
    isSolarTech ? (solarTechFamily && solarTechProductId) :
    isPcInstaller ? (pcSelectedFamily && pcProductId) :
    true
  );

  const effectivePricingDate = pricingDate || todayLocalDateStr();

  // ── Commission calculation ───────────────────────────────────────────────
  const { closerPerW, setterBaselinePerW, kiloPerW } = (() => {
    if (!hasInput) return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0 };
    if (isSolarTech) {
      try {
        const b = getSolarTechBaseline(solarTechProductId, kW, solarTechProducts);
        return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
      } catch { return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0 }; }
    }
    if (isPcInstaller) {
      try {
        const b = getProductCatalogBaselineVersioned(productCatalogProducts, pcProductId, kW, effectivePricingDate, productCatalogPricingVersions);
        return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
      } catch { return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0 }; }
    }
    try {
      const r = getInstallerRatesForDeal(installer, effectivePricingDate, kW, installerPricingVersions);
      return { closerPerW: r.closerPerW, kiloPerW: r.kiloPerW, setterBaselinePerW: r.setterPerW };
    } catch { return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0 }; }
  })();

  const kiloTotal = soldPPW > 0 ? calculateCommission(soldPPW, kiloPerW, kW) : 0;

  // Auto-derive trainer rate from the selected setter's trainer assignment,
  // matching desktop calculator logic exactly.
  const effectiveSetterId = isPaired && selectedSetterId ? selectedSetterId : null;
  const setterAssignment = effectiveSetterId
    ? trainerAssignments.find((a) => a.traineeId === effectiveSetterId) ?? null
    : null;
  const setterDealCount = setterAssignment
    ? new Set(payrollEntries.filter((e) => e.paymentStage === 'Trainer' && e.repId === setterAssignment.trainerId && e.projectId != null).map((e) => e.projectId)).size
    : 0;
  const trainerRate = setterAssignment ? getTrainerOverrideRate(setterAssignment, setterDealCount) : 0;
  const trainerRep = setterAssignment ? reps.find((r) => r.id === setterAssignment.trainerId) ?? null : null;

  // Closer trainer — mirrors desktop calculator logic
  const closerAssignment = currentRepId
    ? trainerAssignments.find((a) => a.traineeId === currentRepId)
    : null;
  const closerDealCount = closerAssignment
    ? new Set(payrollEntries.filter((e) => e.paymentStage === 'Trainer' && e.repId === closerAssignment.trainerId && e.projectId != null).map((e) => e.projectId)).size
    : 0;
  const closerTrainerRate = closerAssignment ? getTrainerOverrideRate(closerAssignment, closerDealCount) : 0;
  const closerTrainerRep = closerAssignment ? reps.find((r) => r.id === closerAssignment.trainerId) ?? null : null;
  const closerTrainerTotal = closerTrainerRate > 0 && kW > 0 && soldPPW > 0
    ? Math.round(closerTrainerRate * kW * 1000 * 100) / 100
    : 0;

  // Commission split via the same resolver the server uses on POST +
  // PATCH (Batch 2b.4), so the mobile preview matches what a deal in
  // these exact conditions would actually pay. Self-gen = paired=false,
  // which routes setterBaselinePerW=0 and sends all commission to the
  // closer side with M1 flat $1000 (if kW ≥ 5) or $500.
  const isSelfGen = !isPaired || !selectedSetterId || setterBaselinePerW === 0;
  const installPayPct = installerPayConfigs[installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const hasM3Split = installPayPct < 100;
  const split = hasInput && soldPPW > 0
    ? splitCloserSetterPay(
        soldPPW,
        closerPerW,
        isSelfGen ? 0 : setterBaselinePerW,
        trainerRate,
        kW,
        installPayPct,
      )
    : { closerTotal: 0, setterTotal: 0, closerM1: 0, closerM2: 0, closerM3: 0, setterM1: 0, setterM2: 0, setterM3: 0 };
  const closerTotal = split.closerTotal;
  const setterTotal = split.setterTotal;
  const trainerTotal = hasInput && soldPPW > 0 && trainerRate > 0 ? trainerRate * kW * 1000 : 0;

  // ── Animated commission counter ──────────────────────────────────────────
  const prevTotalRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [displayTotal, setDisplayTotal] = useState(0);

  useEffect(() => {
    const start = prevTotalRef.current;
    const end = closerTotal;
    prevTotalRef.current = end;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || start === end) { setDisplayTotal(end); return; }
    const DURATION = 600;
    const startTime = performance.now();
    const ease = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      setDisplayTotal(Math.round(start + (end - start) * ease(t)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [closerTotal]);

  // ── Result card mount/unmount with exit animation ────────────────────────
  const [resultMounted, setResultMounted] = useState(false);
  const [resultExiting, setResultExiting] = useState(false);

  useEffect(() => {
    if (hasInput && soldPPW > 0) {
      setResultMounted(true);
      setResultExiting(false);
    } else {
      setResultExiting(true);
      const t = setTimeout(() => setResultMounted(false), 220);
      return () => clearTimeout(t);
    }
  }, [hasInput, soldPPW]);

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24">
        <MobilePageHeader title="Calculator" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Select styles ────────────────────────────────────────────────────────
  const selectStyle: React.CSSProperties = {
    background: 'var(--m-card, var(--surface-mobile-card))',
    border: '1px solid var(--m-border, var(--border-mobile))',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };
  const inputStyle: React.CSSProperties = {
    background: 'var(--m-card, var(--surface-mobile-card))',
    border: '1px solid var(--m-border, var(--border-mobile))',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };
  const selectCls = 'w-full min-h-[48px] text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-1 appearance-none transition-transform duration-75 active:scale-[0.985]';
  const inputCls  = 'w-full min-h-[48px] text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-1 transition-transform duration-75 active:scale-[0.985]';
  const labelStyle: React.CSSProperties = {
    color: 'var(--m-text-dim, #445577)',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Calculator" />
        <div className="rounded-2xl p-5 h-64 animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }} />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Calculator" />

      {/* ── Form inputs ───────────────────────────────────────────────────── */}
      <div className="space-y-4" style={{ touchAction: 'manipulation' }}>
        {/* Installer */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Installer</label>
          <select
            value={installer}
            onChange={(e) => {
              setInstaller(e.target.value);
              setSolarTechFamily('');
              setSolarTechProductId('');
              setPcProductId('');
              setPcSelectedFamily('');
            }}
            className={selectCls}
            style={{ ...selectStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
          >
            <option value="">-- Select installer --</option>
            {activeInstallers.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>

        {/* SolarTech: Family + Product */}
        {isSolarTech && (
          <>
            <div key={installer + '-family'} className="field-appear">
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Financing Family</label>
              <select
                value={solarTechFamily}
                onChange={(e) => { setSolarTechFamily(e.target.value); setSolarTechProductId(''); }}
                className={selectCls}
                style={{ ...selectStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
              >
                <option value="">-- Select family --</option>
                {SOLARTECH_FAMILIES.map((f) => (
                  <option key={f} value={f}>{f} ({SOLARTECH_FAMILY_FINANCER[f]})</option>
                ))}
              </select>
            </div>
            {solarTechFamily && solarTechFamilyProducts.length > 0 && (
              <div key={solarTechFamily + '-product'} className="field-appear-delayed">
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Equipment Package</label>
                <select
                  value={solarTechProductId}
                  onChange={(e) => setSolarTechProductId(e.target.value)}
                  className={selectCls}
                  style={{ ...selectStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
                >
                  <option value="">-- Select package --</option>
                  {solarTechFamilyProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {/* ProductCatalog installer: Family + Product */}
        {isPcInstaller && pcConfig && (
          <>
            <div key={installer + '-family'} className="field-appear">
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Financing Family</label>
              <select
                value={pcSelectedFamily}
                onChange={(e) => { setPcSelectedFamily(e.target.value); setPcProductId(''); }}
                className={selectCls}
                style={{ ...selectStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
              >
                <option value="">-- Select family --</option>
                {pcConfig.families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            {pcSelectedFamily && pcFamilyProducts.length > 0 && (
              <div key={pcSelectedFamily + '-product'} className="field-appear-delayed">
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Equipment Package</label>
                <select
                  value={pcProductId}
                  onChange={(e) => setPcProductId(e.target.value)}
                  className={selectCls}
                  style={{ ...selectStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
                >
                  <option value="">-- Select package --</option>
                  {pcFamilyProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {/* Deal type toggle: Paired (closer + setter) vs Self-gen. Self-gen
            routes the full commission to the closer with M1 flat. */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Deal Type</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: true,  label: 'Paired' },
              { value: false, label: 'Self-gen' },
            ].map((opt) => {
              const active = isPaired === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => { setIsPaired(opt.value); if (!opt.value) setSelectedSetterId(''); }}
                  className="min-h-[44px] rounded-xl text-sm font-semibold transition-colors active:scale-[0.97]"
                  style={{
                    background: active ? 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))' : 'var(--m-card, var(--surface-mobile-card))',
                    color: active ? '#050d18' : 'var(--m-text-muted, var(--text-mobile-muted))',
                    border: active ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Setter rep selector — auto-derives trainer rate from assignment. */}
        {isPaired && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Setter</label>
            <select
              value={selectedSetterId}
              onChange={(e) => setSelectedSetterId(e.target.value)}
              className={selectCls}
              style={{ ...selectStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
            >
              <option value="">-- Select setter --</option>
              {reps
                .filter((r) => r.active && (r.repType === 'setter' || r.repType === 'both'))
                .map((r) => {
                  const ta = trainerAssignments.find((a) => a.traineeId === r.id);
                  const trainerName = ta ? reps.find((tr) => tr.id === ta.trainerId)?.name : null;
                  return (
                    <option key={r.id} value={r.id}>
                      {r.name}{trainerName ? ` (trainer: ${trainerName})` : ''}
                    </option>
                  );
                })}
            </select>
          </div>
        )}

        {/* Pricing date — for modeling past deals with historical rates */}
        {effectiveRole === 'admin' && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Pricing Date (optional)</label>
            <input
              type="date"
              value={pricingDate}
              onChange={(e) => setPricingDate(e.target.value)}
              className={inputCls}
              style={{ ...inputStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
            />
          </div>
        )}

        {/* kW + PPW */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>System Size (kW)</label>
            <input
              type="number"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              autoComplete="off"
              step="0.1"
              min="0"
              placeholder="e.g. 8.4"
              value={kWSize}
              onChange={(e) => setKWSize(e.target.value)}
              className={inputCls}
              style={{ ...inputStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Net PPW ($)</label>
            <input
              type="number"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              autoComplete="off"
              step="0.01"
              min="0"
              placeholder="e.g. 3.85"
              value={netPPW}
              onChange={(e) => setNetPPW(e.target.value)}
              className={inputCls}
              style={{ ...inputStyle, '--tw-ring-color': 'var(--accent-emerald)' } as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      {/* ── Result card ─────────────────────────────────────────────────── */}
      {resultMounted && (
        <MobileCard key="result" hero className={resultExiting ? 'result-exit' : 'result-enter'}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Commission</p>
          <p className="font-black tabular-nums break-words" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)", fontSize: 'clamp(2.25rem, 11vw, 3rem)', lineHeight: 1.05 }}>
            {fmt$(displayTotal)}
          </p>

          <div className="mt-5 space-y-2.5">
            {/* Closer row + M1/M2/M3 breakdown */}
            <div className="calc-row-1 flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Closer</span>
              <span className="text-lg font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(closerTotal)}</span>
            </div>
            <div className="flex gap-2 ml-2">
              <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--m-text-dim, #445577)' }}>M1</p>
                <p className="text-sm font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(split.closerM1)}</p>
              </div>
              <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--m-text-dim, #445577)' }}>M2</p>
                <p className="text-sm font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(split.closerM2)}</p>
              </div>
              {hasM3Split && (
                <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--m-text-dim, #445577)' }}>M3</p>
                  <p className="text-sm font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(split.closerM3)}</p>
                </div>
              )}
            </div>

            {/* Setter row + M1/M2/M3 breakdown */}
            {setterTotal > 0 && (
              <>
                <div className="calc-row-2 flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Setter</span>
                  <span className="text-lg font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(setterTotal)}</span>
                </div>
                <div className="flex gap-2 ml-2">
                  <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--m-text-dim, #445577)' }}>M1</p>
                    <p className="text-sm font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(split.setterM1)}</p>
                  </div>
                  <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--m-text-dim, #445577)' }}>M2</p>
                    <p className="text-sm font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(split.setterM2)}</p>
                  </div>
                  {hasM3Split && (
                    <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--m-text-dim, #445577)' }}>M3</p>
                      <p className="text-sm font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(split.setterM3)}</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Setter trainer override */}
            {trainerTotal > 0 && (
              <div className="calc-row-2 flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  Trainer{trainerRep ? `: ${trainerRep.name}` : ''}
                </span>
                <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-amber)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(trainerTotal)}</span>
              </div>
            )}

            {/* Closer trainer override */}
            {closerTrainerTotal > 0 && (
              <div className="calc-row-2 flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  Trainer{closerTrainerRep ? `: ${closerTrainerRep.name}` : ''}
                </span>
                <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-amber)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(closerTrainerTotal)}</span>
              </div>
            )}

            {effectiveRole === 'admin' && (
              <div className="calc-row-2 flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Kilo</span>
                <span className="text-lg font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(kiloTotal)}</span>
              </div>
            )}
          </div>

          {/* Baseline info */}
          <div className="calc-row-3 mt-4 pt-3" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
            <p className="text-xs" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Closer baseline: ${closerPerW.toFixed(2)}/W
              {!isSelfGen && setterBaselinePerW > 0 && ` · Setter: $${setterBaselinePerW.toFixed(2)}/W`}
              {trainerRate > 0 && ` · ${trainerRep ? trainerRep.name : 'Trainer'}: +$${trainerRate.toFixed(2)}/W`}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Sold: ${soldPPW.toFixed(2)}/W · {kW.toFixed(1)} kW
            </p>
          </div>
        </MobileCard>
      )}

      {/* Empty state */}
      {(!hasInput || soldPPW <= 0) && (
        <MobileCard key="empty">
          <div className="py-6 text-center">
            <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Fill in the fields above to calculate commission</p>
          </div>
        </MobileCard>
      )}
    </div>
  );
}
