'use client';

/**
 * Commission playground — admin-only sandbox for exercising the
 * splitCloserSetterPay math live. Useful for answering "what SHOULD
 * Timothy's commission have been at netPPW X?" without touching DB
 * or needing to create a real deal.
 *
 * Pure client-side: no API, no persistence. Uses the same
 * splitCloserSetterPay exported from lib/commission.ts that the
 * server uses on every POST/PATCH, so what you see here matches what
 * prod computes for identical inputs.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../../../../lib/context';
import { splitCloserSetterPay } from '../../../../lib/commission';
import { fmt$ } from '../../../../lib/utils';
import { ArrowLeft, Calculator, Info } from 'lucide-react';

export default function CommissionPlaygroundPage() {
  const { effectiveRole } = useApp();

  const [soldPPW, setSoldPPW] = useState('3.85');
  const [closerPerW, setCloserPerW] = useState('1.50');
  const [setterPerW, setSetterPerW] = useState('0.50');
  const [trainerRate, setTrainerRate] = useState('0');
  const [kW, setKW] = useState('8.4');
  const [installPayPct, setInstallPayPct] = useState('80');
  const [dealType, setDealType] = useState<'paired' | 'self-gen'>('paired');

  const inputs = useMemo(() => ({
    soldPPW: Number(soldPPW) || 0,
    closerPerW: Number(closerPerW) || 0,
    setterPerW: dealType === 'self-gen' ? 0 : Number(setterPerW) || 0,
    trainerRate: Number(trainerRate) || 0,
    kW: Number(kW) || 0,
    installPayPct: Number(installPayPct) || 100,
  }), [soldPPW, closerPerW, setterPerW, trainerRate, kW, installPayPct, dealType]);

  const result = useMemo(() => {
    try {
      return splitCloserSetterPay(
        inputs.soldPPW,
        inputs.closerPerW,
        inputs.setterPerW,
        inputs.trainerRate,
        inputs.kW,
        inputs.installPayPct,
      );
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [inputs]);

  if (effectiveRole !== 'admin') {
    return (
      <div className="p-8 text-center">
        <p className="text-[var(--text-muted)] text-sm">Admin only.</p>
      </div>
    );
  }

  const grossRevenue = inputs.soldPPW * inputs.kW * 1000;
  const kiloMargin = grossRevenue
    - (inputs.closerPerW * inputs.kW * 1000)
    - (inputs.setterPerW * inputs.kW * 1000)
    - (inputs.trainerRate * inputs.kW * 1000);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5">
          <ArrowLeft className="w-3 h-3" /> Back to Admin
        </Link>
      </div>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-[var(--accent-cyan-solid)]/15">
            <Calculator className="w-5 h-5 text-[var(--accent-cyan-text)]" />
          </div>
          <h1 className="text-3xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Commission Playground
          </h1>
        </div>
        <p className="text-[var(--text-secondary)] text-sm max-w-2xl">
          Sandbox for exercising the commission split live. Uses the same
          <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--surface-card)] text-xs font-mono">splitCloserSetterPay</code>
          function that runs on every deal. Results here match what prod
          computes for identical inputs.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="card-surface rounded-2xl p-6 space-y-4">
          <h2 className="text-[var(--text-primary)] font-semibold">Inputs</h2>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider">Deal type</label>
            <div className="flex gap-1 p-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl w-fit">
              {(['paired', 'self-gen'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDealType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    dealType === t ? 'bg-[var(--accent-cyan-solid)]/15 text-[var(--accent-cyan-text)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t === 'paired' ? 'Paired (closer + setter)' : 'Self-gen (closer only)'}
                </button>
              ))}
            </div>
          </div>

          <Field label="Sold $/W" value={soldPPW} onChange={setSoldPPW} step="0.01" />
          <Field label="Closer baseline $/W" value={closerPerW} onChange={setCloserPerW} step="0.01" />
          <Field
            label="Setter baseline $/W"
            value={setterPerW}
            onChange={setSetterPerW}
            step="0.01"
            disabled={dealType === 'self-gen'}
            helper={dealType === 'self-gen' ? 'Ignored on self-gen deals' : undefined}
          />
          <Field label="Trainer override $/W" value={trainerRate} onChange={setTrainerRate} step="0.01" />
          <Field label="kW size" value={kW} onChange={setKW} step="0.1" />
          <Field label="Install-pay %" value={installPayPct} onChange={setInstallPayPct} step="1" helper="M2 share of M2+M3 remainder. 80 = typical flat install-pay." />
        </div>

        {/* Results */}
        <div className="space-y-4">
          {'error' in result ? (
            <div className="card-surface rounded-2xl p-6 border border-red-500/30 bg-red-500/5">
              <p className="text-red-400 text-sm font-semibold mb-1">Computation error</p>
              <p className="text-[var(--text-secondary)] text-xs font-mono">{result.error}</p>
            </div>
          ) : (
            <>
              <div className="card-surface rounded-2xl p-6">
                <h2 className="text-[var(--text-primary)] font-semibold mb-4">Output</h2>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <TotalCard label="Closer total" value={result.closerTotal} tint="emerald" />
                  <TotalCard label="Setter total" value={result.setterTotal} tint={dealType === 'self-gen' ? 'slate' : 'violet'} />
                </div>

                <div className="space-y-2">
                  <MilestoneRow label="M1" closer={result.closerM1} setter={result.setterM1} />
                  <MilestoneRow label="M2" closer={result.closerM2} setter={result.setterM2} />
                  <MilestoneRow label="M3" closer={result.closerM3} setter={result.setterM3} />
                </div>

                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  <span className="text-[var(--text-muted)]">Total paid out to reps</span>
                  <span className="text-[var(--text-primary)] font-bold tabular-nums">
                    {fmt$(result.closerTotal + result.setterTotal)}
                  </span>
                </div>
              </div>

              <div className="card-surface rounded-2xl p-5">
                <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-3">Revenue context</h3>
                <dl className="space-y-1.5 text-xs">
                  <Row label="Gross revenue" value={fmt$(grossRevenue)} />
                  <Row label="Closer payout" value={fmt$(result.closerTotal)} />
                  <Row label="Setter payout" value={fmt$(result.setterTotal)} />
                  <Row label="Trainer override" value={fmt$(inputs.trainerRate * inputs.kW * 1000)} />
                  <div className="flex items-center justify-between pt-2 mt-2 border-t border-[var(--border-subtle)]">
                    <span className="text-[var(--text-muted)]">Residual (gross − comms)</span>
                    <span className={`font-bold tabular-nums ${kiloMargin < 0 ? 'text-red-400' : 'text-[var(--accent-cyan-text)]'}`}>
                      {fmt$(kiloMargin)}
                    </span>
                  </div>
                </dl>
                <p className="text-[10px] text-[var(--text-dim)] mt-3 flex items-start gap-1.5">
                  <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  Residual excludes installer/product cost. Use the admin
                  project view for true Kilo margin on a real deal.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, step, disabled, helper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  disabled?: boolean;
  helper?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-cyan-solid)]/50 disabled:opacity-40 disabled:cursor-not-allowed font-mono tabular-nums"
      />
      {helper && <p className="text-[10px] text-[var(--text-dim)] mt-1">{helper}</p>}
    </div>
  );
}

function TotalCard({ label, value, tint }: { label: string; value: number; tint: 'emerald' | 'violet' | 'slate' }) {
  const colors = {
    emerald: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', text: 'var(--accent-emerald-solid)' },
    violet: { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.25)', text: '#c4b5fd' },
    slate: { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.25)', text: 'var(--text-muted)' },
  }[tint];
  return (
    <div className="rounded-xl p-4" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
      <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-black tabular-nums" style={{ color: colors.text }}>{fmt$(value)}</p>
    </div>
  );
}

function MilestoneRow({ label, closer, setter }: { label: string; closer: number; setter: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[var(--text-muted)] text-xs font-mono w-8">{label}</span>
      <div className="flex-1 grid grid-cols-2 gap-3">
        <span className="text-[var(--accent-emerald-text)] tabular-nums">{fmt$(closer)}</span>
        <span className="text-violet-300 tabular-nums">{fmt$(setter)}</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-secondary)] font-mono tabular-nums">{value}</span>
    </div>
  );
}
