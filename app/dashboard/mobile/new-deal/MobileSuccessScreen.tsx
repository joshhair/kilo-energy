'use client';

/**
 * MobileSuccessScreen — the post-submit confirmation card. Extracted
 * verbatim from MobileNewDeal.tsx (T4.1, 2026-06-11). The "View Projects"
 * button here is the origin of the check:button-contrast gate — its
 * styling rules (no white-hex literals, no text-tokens as backgrounds) apply
 * file-wide. Success animations (success-icon-spring, success-up-1..4)
 * live in app/globals.css. onReset (blankForm + clear submitted) stays
 * owned by MobileNewDeal.
 */

import { useRouter } from 'next/navigation';
import { CheckCircle2, ArrowRight, RotateCcw } from 'lucide-react';
import MobileCard from '../shared/MobileCard';

// ── Success screen ───────────────────────────────────────────────────────────

export interface SubmittedDeal {
  projectId: string;
  customerName: string;
  installer: string;
  financer: string;
  productType: string;
  kW: number;
  soldPPW: number;
  closerTotal: number;
  closerM1: number;
  closerM2: number;
  closerM3: number;
  setterTotal: number;
  setterM1: number;
  setterM2: number;
  setterM3: number;
  setterName: string;
  repName: string;
}

export function MobileSuccessScreen({ deal, onReset }: { deal: SubmittedDeal; onReset: () => void }) {
  const router = useRouter();
  return (
    <div className="px-4 pt-3 pb-24 space-y-4">
      <div className="flex flex-col items-center text-center pt-4 mb-4">
        <div className="success-icon-spring w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: 'var(--accent-emerald-soft)', border: '1px solid var(--accent-emerald-glow)' }}>
          <CheckCircle2 className="w-7 h-7 text-[var(--accent-emerald-text)]" strokeWidth={1.5} />
        </div>
        <div className="success-up-1">
          <h2 className="text-xl font-black text-[var(--text-primary)] mb-1" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>Deal Submitted!</h2>
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>
            <span className="text-[var(--text-primary)] font-semibold">{deal.customerName}</span> has been added to your pipeline.
          </p>
        </div>
      </div>

      <MobileCard className="success-up-2">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Deal Summary</p>
        <div className="space-y-2 text-base">
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--text-muted)' }}>Installer</span>
            <span className="text-[var(--text-primary)] font-medium">{deal.installer}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--text-muted)' }}>Financer</span>
            <span className="text-[var(--text-primary)] font-medium">{deal.financer || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--text-muted)' }}>Product Type</span>
            <span className="text-[var(--text-primary)] font-medium">{deal.productType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--text-muted)' }}>System</span>
            <span className="text-[var(--text-primary)] font-medium">{deal.kW.toFixed(1)} kW @ ${deal.soldPPW.toFixed(2)}/W</span>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="success-up-3">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Commission</p>
        {deal.closerTotal > 0 ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-medium" style={{ color: 'var(--text-muted)' }}>{deal.repName} (Closer)</p>
              <p className="text-base" style={{ color: 'var(--text-muted)' }}>
                M1: ${deal.closerM1.toLocaleString()} · M2: ${deal.closerM2.toLocaleString()}
                {deal.closerM3 > 0 && ` · M3: $${deal.closerM3.toLocaleString()}`}
              </p>
            </div>
            <p className="text-xl font-black" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${deal.closerTotal.toLocaleString()}</p>
          </div>
        ) : (
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>Commission will be calculated once pricing is confirmed.</p>
        )}
        {deal.setterTotal > 0 && (
          <div className="flex items-center justify-between pt-2 mt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <p className="text-base font-medium" style={{ color: 'var(--text-muted)' }}>{deal.setterName} (Setter)</p>
            <p className="text-lg font-bold text-[var(--accent-blue-text)]">${deal.setterTotal.toLocaleString()}</p>
          </div>
        )}
      </MobileCard>

      <div className="success-up-4 space-y-2 pt-2">
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 font-semibold rounded-xl text-base active:scale-[0.97]"
          style={{
            background: 'var(--accent-emerald-solid)',
            color: 'var(--text-on-accent)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          View Projects <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReset}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 font-medium rounded-xl text-base active:scale-[0.97]"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          <RotateCcw className="w-4 h-4" /> Submit Another
        </button>
      </div>
    </div>
  );
}

