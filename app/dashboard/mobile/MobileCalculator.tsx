'use client';

import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import {
  getSolarTechBaseline,
  calculateCommission,
  getInstallerRatesForDeal,
  getProductCatalogBaseline,
  getTrainerOverrideRate,
  SOLARTECH_FAMILIES,
  SOLARTECH_FAMILY_FINANCER,
  SOLARTECH_PRODUCTS,
  DEFAULT_INSTALL_PAY_PCT,
} from '../../../lib/data';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileCalculator() {
  const {
    currentRepId,
    currentRole,
    effectiveRole,
    trainerAssignments,
    projects,
    activeInstallers,
    reps,
    installerPricingVersions,
    productCatalogInstallerConfigs,
    productCatalogProducts,
    installerPayConfigs,
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

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24">
        <MobilePageHeader title="Calculator" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Derived installer flags ──────────────────────────────────────────────
  const isSolarTech = installer === 'SolarTech';
  const pcConfig = productCatalogInstallerConfigs[installer] ?? null;
  const isPcInstaller = pcConfig !== null;

  // SolarTech family products
  const solarTechFamilyProducts = solarTechFamily
    ? SOLARTECH_PRODUCTS.filter((p) => p.family === solarTechFamily)
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

  // ── Commission calculation ───────────────────────────────────────────────
  const { closerPerW, setterBaselinePerW, kiloPerW } = (() => {
    if (!hasInput) return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0 };
    if (isSolarTech) {
      const b = getSolarTechBaseline(solarTechProductId, kW);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
    }
    if (isPcInstaller) {
      const b = getProductCatalogBaseline(productCatalogProducts, pcProductId, kW);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
    }
    const today = new Date().toISOString().split('T')[0];
    const r = getInstallerRatesForDeal(installer, today, kW, installerPricingVersions);
    return { closerPerW: r.closerPerW, kiloPerW: r.kiloPerW, setterBaselinePerW: r.setterPerW };
  })();

  const kiloTotal = soldPPW > 0 ? calculateCommission(closerPerW, kiloPerW, kW) : 0;

  // No setter toggle on mobile — simplified: closer-only calc
  const closerTotal = soldPPW > 0 && hasInput ? calculateCommission(soldPPW, closerPerW, kW) : 0;
  const setterTotal = 0;

  const grandTotal = closerTotal + setterTotal;

  // ── Select styles ────────────────────────────────────────────────────────
  const selectStyle: React.CSSProperties = {
    background: 'var(--m-card, #0d1525)',
    border: '1px solid var(--m-border, #1a2840)',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };
  const inputStyle: React.CSSProperties = {
    background: 'var(--m-card, #0d1525)',
    border: '1px solid var(--m-border, #1a2840)',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };
  const selectCls = 'w-full min-h-[48px] text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-1 appearance-none';
  const inputCls = 'w-full min-h-[48px] text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-1';
  const labelStyle: React.CSSProperties = {
    color: 'var(--m-text-dim, #445577)',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  };

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Calculator" />
        <div className="rounded-2xl p-5 h-64 animate-pulse" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }} />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Calculator" />

      {/* ── Form inputs ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Installer */}
        <div>
          <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Installer</label>
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
            style={{ ...selectStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
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
            <div>
              <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Financing Family</label>
              <select
                value={solarTechFamily}
                onChange={(e) => { setSolarTechFamily(e.target.value); setSolarTechProductId(''); }}
                className={selectCls}
                style={{ ...selectStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
              >
                <option value="">-- Select family --</option>
                {SOLARTECH_FAMILIES.map((f) => (
                  <option key={f} value={f}>{f} ({SOLARTECH_FAMILY_FINANCER[f]})</option>
                ))}
              </select>
            </div>
            {solarTechFamily && solarTechFamilyProducts.length > 0 && (
              <div>
                <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Equipment Package</label>
                <select
                  value={solarTechProductId}
                  onChange={(e) => setSolarTechProductId(e.target.value)}
                  className={selectCls}
                  style={{ ...selectStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
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
            <div>
              <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Financing Family</label>
              <select
                value={pcSelectedFamily}
                onChange={(e) => { setPcSelectedFamily(e.target.value); setPcProductId(''); }}
                className={selectCls}
                style={{ ...selectStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
              >
                <option value="">-- Select family --</option>
                {pcConfig.families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            {pcSelectedFamily && pcFamilyProducts.length > 0 && (
              <div>
                <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Equipment Package</label>
                <select
                  value={pcProductId}
                  onChange={(e) => setPcProductId(e.target.value)}
                  className={selectCls}
                  style={{ ...selectStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
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

        {/* kW + PPW */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>System Size (kW)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 8.4"
              value={kWSize}
              onChange={(e) => setKWSize(e.target.value)}
              className={inputCls}
              style={{ ...inputStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-base font-semibold uppercase tracking-widest mb-1.5" style={labelStyle}>Net PPW ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 3.85"
              value={netPPW}
              onChange={(e) => setNetPPW(e.target.value)}
              className={inputCls}
              style={{ ...inputStyle, '--tw-ring-color': '#00e5a0' } as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      {/* ── Result card ─────────────────────────────────────────────────── */}
      {hasInput && soldPPW > 0 && (
        <MobileCard hero>
          <p className="text-base uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Commission</p>
          <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
            ${closerTotal.toLocaleString()}
          </p>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Closer</span>
              <span className="text-xl font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${closerTotal.toLocaleString()}</span>
            </div>
            {setterTotal > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Setter</span>
                <span className="text-xl font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${setterTotal.toLocaleString()}</span>
              </div>
            )}
            {currentRole === 'admin' && (
              <div className="flex items-center justify-between">
                <span className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Kilo</span>
                <span className="text-xl font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${kiloTotal.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Baseline info */}
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--m-border, #1a2840)' }}>
            <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              Baseline: ${closerPerW.toFixed(2)}/W &middot; Sold: ${soldPPW.toFixed(2)}/W &middot; {kW.toFixed(1)} kW
            </p>
          </div>
        </MobileCard>
      )}

      {/* Empty state */}
      {(!hasInput || soldPPW <= 0) && (
        <MobileCard>
          <div className="py-6 text-center">
            <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Fill in the fields above to calculate commission</p>
          </div>
        </MobileCard>
      )}
    </div>
  );
}
