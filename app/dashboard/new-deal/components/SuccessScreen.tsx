'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, ArrowRight, RotateCcw, PlusCircle } from 'lucide-react';
import { SubmittedDeal } from './shared';

export function SuccessScreen({ deal, onReset }: { deal: SubmittedDeal; onReset: () => void }) {
  const router = useRouter();

  return (
    <div className="p-4 md:p-8 max-w-2xl animate-slide-in-scale">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <PlusCircle className="w-5 h-5 text-[var(--accent-green)]" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>New Deal</h1>
        </div>
      </div>

      {/* Success card */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(0,224,122,0.08), rgba(0,196,240,0.04))', border: '1px solid rgba(0,224,122,0.25)', boxShadow: '0 0 40px rgba(0,224,122,0.08)' }}>
        {/* Green top bar */}
        <div className="h-1" style={{ background: 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))' }} />

        <div className="p-8">
          {/* Icon + message */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(0,224,122,0.1)', border: '1px solid rgba(0,224,122,0.3)' }}>
              <CheckCircle2 className="w-8 h-8" style={{ color: 'var(--accent-green)' }} strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>Deal Submitted!</h2>
            <p className="text-[var(--text-secondary)] text-sm">
              <span className="text-white font-semibold">{deal.customerName}</span> has been added to your pipeline.
            </p>
          </div>

          {/* Deal summary */}
          <div className="rounded-xl p-4 mb-4 space-y-2.5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Deal Summary</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <div>
                <p className="text-[var(--text-muted)] text-xs mb-0.5">Installer</p>
                <p className="text-white font-medium">{deal.installer}</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)] text-xs mb-0.5">Financer</p>
                <p className="text-white font-medium">{deal.financer || '\u2014'}</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)] text-xs mb-0.5">Product Type</p>
                <p className="text-white font-medium">{deal.productType}</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)] text-xs mb-0.5">System Size</p>
                <p className="text-white font-medium">{deal.kW.toFixed(1)} kW @ ${deal.soldPPW.toFixed(2)}/W</p>
              </div>
            </div>
          </div>

          {/* Commission summary */}
          <div className="rounded-xl p-4 mb-6 space-y-2.5" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Commission</p>
            {deal.closerTotal > 0 ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[var(--text-secondary)] text-sm font-medium">{deal.repName} (Closer)</p>
                  <p className="text-[var(--text-muted)] text-xs">M1: ${deal.closerM1.toLocaleString()} · M2: ${deal.closerM2.toLocaleString()}{deal.closerM3 > 0 && ` · M3: $${deal.closerM3.toLocaleString()}`}</p>
                </div>
                <p className="text-2xl font-black" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--accent-green)', textShadow: '0 0 20px #00e07a50' }}>${deal.closerTotal.toLocaleString()}</p>
              </div>
            ) : (
              <p className="text-[var(--text-muted)] text-sm">Commission will be calculated once pricing is confirmed.</p>
            )}
            {deal.setterTotal > 0 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                <div>
                  <p className="text-[var(--text-secondary)] text-sm font-medium">{deal.setterName} (Setter)</p>
                  <p className="text-[var(--text-muted)] text-xs">M1: ${deal.setterM1.toLocaleString()} · M2: ${deal.setterM2.toLocaleString()}{deal.setterM3 > 0 && ` · M3: $${deal.setterM3.toLocaleString()}`}</p>
                </div>
                <p className="text-lg font-bold text-[var(--accent-green)]">${deal.setterTotal.toLocaleString()}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/dashboard/projects')}
              className="flex-1 inline-flex items-center justify-center gap-2 font-bold px-5 py-2.5 rounded-xl text-sm transition-all hover:brightness-110 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#000' }}
            >
              View Projects <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onReset}
              className="flex-1 inline-flex items-center justify-center gap-2 font-medium px-5 py-2.5 rounded-xl text-sm transition-colors hover:brightness-125"
              style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <RotateCcw className="w-4 h-4" /> Submit Another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
