'use client';

import { TickerAmount } from './shared';

export interface CommissionPreviewProps {
  showPreview: boolean;
  isSubDealer: boolean;
  subDealerCommission: number;
  kW: number;
  soldPPW: number;
  closerPerW: number;
  kiloPerW: number;
  closerTotal: number;
  closerM1: number;
  closerM2: number;
  closerM3: number;
  hasM3: boolean;
  setterTotal: number;
  setterM1: number;
  setterM2: number;
  setterM3: number;
  setterId: string;
  setterBaselinePerW: number;
  trainerRep: { name: string } | null | undefined;
  trainerTotal: number;
  trainerOverrideRate: number;
  closerTrainerRep: { name: string } | null | undefined;
  closerTrainerTotal: number;
  closerTrainerOverrideRate: number;
  kiloTotal: number;
  effectiveRole: string | null | undefined;
  subDealerRate: number;
}

export function CommissionPreview({
  showPreview,
  isSubDealer,
  subDealerCommission,
  kW,
  soldPPW,
  closerPerW,
  kiloPerW,
  closerTotal,
  closerM1,
  closerM2,
  closerM3,
  hasM3,
  setterTotal,
  setterM1,
  setterM2,
  setterM3,
  setterId,
  setterBaselinePerW,
  trainerRep,
  trainerTotal,
  trainerOverrideRate,
  closerTrainerRep,
  closerTrainerTotal,
  closerTrainerOverrideRate,
  kiloTotal,
  effectiveRole,
  subDealerRate,
}: CommissionPreviewProps) {
  return (
    <div style={{ maxHeight: showPreview || (isSubDealer && subDealerCommission > 0) ? '400px' : '0px', overflow: 'hidden', transition: 'max-height 0.4s ease-in-out' }}>
      <div className="rounded-xl p-4 text-sm space-y-2" style={{ background: 'linear-gradient(135deg, rgba(0,224,122,0.08), rgba(0,196,240,0.05))', border: '1px solid rgba(0,224,122,0.2)' }}>
        <p className="font-medium text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Commission Preview</p>
        {isSubDealer ? (
          <>
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1"><span>System value</span><span className="tabular-nums">${(kW * soldPPW * 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></div>
            {subDealerRate > 0 && (
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>Sub-dealer rate</span>
                <span>${subDealerRate.toFixed(2)}/W</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>M1</span>
              <span className="text-[var(--text-dim)]">N/A &mdash; paid at install</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">M2 commission</span>
              <span className="text-[var(--accent-emerald-solid)] font-semibold">
                <TickerAmount amount={subDealerCommission} />
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1"><span>System value</span><span className="tabular-nums">${(kW * soldPPW * 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></div>
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>Your redline</span>
              <span>${closerPerW.toFixed(2)}/W</span>
            </div>
            {effectiveRole === 'admin' && (
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>Kilo baseline</span>
                <span>${kiloPerW.toFixed(2)}/W</span>
              </div>
            )}
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Closer commission</span>
              <span className="font-semibold" style={{ color: 'var(--accent-emerald-solid)', fontFamily: "'DM Serif Display', serif", textShadow: '0 0 15px #00e07a40' }}>
                <TickerAmount amount={closerTotal} />
                <span className="text-[var(--text-muted)] font-normal">
                  {' '}(M1: <TickerAmount amount={closerM1} className="tabular-nums" /> · M2: <TickerAmount amount={closerM2} className="tabular-nums" />{hasM3 && <> · M3: <TickerAmount amount={closerM3} className="tabular-nums" /></>})
                </span>
              </span>
            </div>
            {setterId && setterBaselinePerW === 0 && (
              <div className="flex justify-between items-center rounded-lg px-3 py-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                <span className="text-amber-400 text-xs">Setter baseline unavailable — verify system size and product selection. Setter commission cannot be calculated.</span>
              </div>
            )}
            {setterId && setterTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Setter commission</span>
                <span className="text-[var(--accent-emerald-solid)] font-semibold">
                  <TickerAmount amount={setterTotal} />
                  <span className="text-[var(--text-muted)] font-normal">
                    {' '}(M1: <TickerAmount amount={setterM1} className="tabular-nums" /> · M2: <TickerAmount amount={setterM2} className="tabular-nums" />{hasM3 && <> · M3: <TickerAmount amount={setterM3} className="tabular-nums" /></>})
                  </span>
                </span>
              </div>
            )}
            {trainerRep && trainerTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Trainer override ({trainerRep.name})</span>
                <span className="text-amber-400 font-semibold">
                  <TickerAmount amount={trainerTotal} />
                  <span className="text-[var(--text-muted)] font-normal"> (${trainerOverrideRate.toFixed(2)}/W)</span>
                </span>
              </div>
            )}
            {closerTrainerRep && closerTrainerTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Trainer override ({closerTrainerRep.name})</span>
                <span className="text-amber-400 font-semibold">
                  <TickerAmount amount={closerTrainerTotal} />
                  <span className="text-[var(--text-muted)] font-normal"> (${closerTrainerOverrideRate.toFixed(2)}/W)</span>
                </span>
              </div>
            )}
            {effectiveRole === 'admin' && (
              <div className="flex justify-between border-t border-[var(--border)] pt-2">
                <span className="text-[var(--text-secondary)]">Kilo margin</span>
                <TickerAmount
                  amount={Math.max(0, kiloTotal - closerTotal - setterTotal - trainerTotal - closerTrainerTotal)}
                  className="text-[var(--text-secondary)] font-semibold"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
