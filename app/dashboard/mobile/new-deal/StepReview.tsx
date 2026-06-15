'use client';

/**
 * StepReview — Step 3 ("Review & Notes") of the mobile New Deal wizard:
 * deal summary (tap-to-edit via jumpToStep), commission breakdown, BVI
 * intake plumbing, notes, lead source + blitz attribution, and the
 * portaled Back/Submit CTA. Extracted VERBATIM from MobileNewDeal.tsx
 * (T4.1, 2026-06-11) as a strict pure move — all state and handlers stay
 * in MobileNewDeal and arrive through bundled props destructured to the
 * original names, so the JSX is byte-identical.
 *
 * MONEY SURFACE + GUARD: this file is in check-no-silent-rep-clears
 * PROTECTED_FILES. It contains the allowlisted lead-source blitzId clear
 * (anchor c4b9e373db9b) — its two preceding comment lines are part of the
 * content-anchor hash; never separate them from the statement. Never
 * reactively blank setterId/repId/blitzId here.
 *
 * LOAD-BEARING: the portaled submit button pairs with MobileNewDeal's
 * <form id="mobile-new-deal-form"> via its form attribute — the portal
 * removes it from the form's DOM subtree, so renaming either id silently
 * breaks deal submission. The step gate + animated wrapper stay in the
 * host; the Kilo-margin display formula here intentionally duplicates
 * Step 2's preview — keep both verbatim.
 */

import React from 'react';
import { Pencil, Loader2, Check, ChevronLeft } from 'lucide-react';
import MobileCard from '../shared/MobileCard';
import ViewportPortal from '../shared/ViewportPortal';
import { BviIntakePanel } from '../../new-deal/components/BviIntakePanel';
import { FieldError, NAV_CLEAR_BOTTOM, type MobileDealForm } from './shared';
import type { Rep } from '@/lib/data';
import type { BviIntake, BviIntakeErrors } from '@/lib/installer-intakes/bvi';
import type { Role } from '@/lib/notifications/types';

export interface StepReviewProps {
  flow: { jumpToStep: (n: number) => void; handlePrev: () => void; submitting: boolean };
  formCtl: {
    form: MobileDealForm;
    errors: Record<string, string>;
    update: (field: string, value: string) => void;
    handleBlur: (field: string) => void;
    fieldWrapperRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  };
  money: {
    showPreview: boolean; isSubDealer: boolean; subDealerCommission: number; commFlash: boolean;
    closerTotal: number; closerM1: number; closerM2: number; closerM3: number; hasM3: boolean;
    setterTotal: number; setterM1: number; setterM2: number; setterM3: number;
    trainerRep: Rep | null | undefined; trainerTotal: number; trainerOverrideRate: number;
    kiloTotal: number; closerTrainerTotal: number; kW: number; soldPPW: number;
  };
  bvi: {
    isBviInstaller: boolean;
    bviIntake: BviIntake;
    setBviIntake: React.Dispatch<React.SetStateAction<BviIntake>>;
    utilityBill: File | null;
    setUtilityBill: React.Dispatch<React.SetStateAction<File | null>>;
    bviSendOnSubmit: boolean;
    setBviSendOnSubmit: React.Dispatch<React.SetStateAction<boolean>>;
    bviErrors: BviIntakeErrors;
  };
  identity: { effectiveRole: Role | null; reps: Rep[] };
  availableBlitzes: Array<{ id: string; name: string; status: string; startDate?: string; endDate?: string }>;
  styles: {
    labelCls: string;
    labelStyle: React.CSSProperties;
    inputCls: (field: string) => string;
    selectCls: (field: string) => string;
    v0InputStyle: (field: string) => React.CSSProperties;
  };
}

export function StepReview({ flow, formCtl, money, bvi, identity, availableBlitzes, styles }: StepReviewProps) {
  const { jumpToStep, handlePrev, submitting } = flow;
  const { form, errors, update, handleBlur, fieldWrapperRefs } = formCtl;
  const {
    showPreview, isSubDealer, subDealerCommission, commFlash,
    closerTotal, closerM1, closerM2, closerM3, hasM3,
    setterTotal, setterM1, setterM2, setterM3,
    trainerRep, trainerTotal, trainerOverrideRate, kiloTotal, closerTrainerTotal, kW, soldPPW,
  } = money;
  const {
    isBviInstaller, bviIntake, setBviIntake, utilityBill, setUtilityBill,
    bviSendOnSubmit, setBviSendOnSubmit, bviErrors,
  } = bvi;
  const { effectiveRole, reps } = identity;
  const { labelCls, labelStyle, inputCls, selectCls, v0InputStyle } = styles;
  return (
    <>
            {/* Summary card */}
            <MobileCard>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Deal Summary</p>
              {/* People section — tap to jump back to Step 1 */}
              <button
                type="button"
                onClick={() => jumpToStep(0)}
                className="w-full text-left pb-2 rounded-xl active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-all duration-150 active:scale-[0.985] group"
                style={{ borderLeft: '2px solid color-mix(in srgb, var(--accent-emerald-solid) 18%, transparent)', paddingLeft: '10px' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>People</span>
                  <span className="flex items-center gap-1 opacity-50 group-active:opacity-100 transition-opacity duration-150" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}><Pencil className="w-3 h-3" />Edit</span>
                </div>
                <div className="space-y-2 text-base">
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--text-muted)' }}>Customer</span>
                    <span className="text-[var(--text-primary)] font-medium text-right line-clamp-2 break-words ml-4">{form.customerName || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--text-muted)' }}>Sold Date</span>
                    <span className="text-[var(--text-primary)] font-medium">{form.soldDate || '---'}</span>
                  </div>
                  {effectiveRole === 'admin' && (
                    <div className="flex justify-between">
                      <span className="text-base" style={{ color: 'var(--text-muted)' }}>Closer</span>
                      <span className="text-[var(--text-primary)] font-medium text-right line-clamp-2 break-words ml-4">{reps.find((r) => r.id === form.repId)?.name || '---'}</span>
                    </div>
                  )}
                  {form.setterId && (
                    <div className="flex justify-between">
                      <span className="text-base" style={{ color: 'var(--text-muted)' }}>Setter</span>
                      <span className="text-[var(--text-primary)] font-medium text-right line-clamp-2 break-words ml-4">{reps.find((r) => r.id === form.setterId)?.name || '---'}</span>
                    </div>
                  )}
                </div>
              </button>
              {/* Deal Details section — tap to jump back to Step 2 */}
              <button
                type="button"
                onClick={() => jumpToStep(1)}
                className="w-full text-left pt-2 mt-2 rounded-xl active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-all duration-150 active:scale-[0.985] group"
                style={{ borderTop: '1px solid var(--border-default)', borderLeft: '2px solid color-mix(in srgb, var(--accent-emerald-solid) 18%, transparent)', paddingLeft: '10px', paddingTop: '8px', marginTop: '8px' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Deal Details</span>
                  <span className="flex items-center gap-1 opacity-50 group-active:opacity-100 transition-opacity duration-150" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}><Pencil className="w-3 h-3" />Edit</span>
                </div>
                <div className="space-y-2 text-base">
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--text-muted)' }}>Installer</span>
                    <span className="text-[var(--text-primary)] font-medium">{form.installer || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--text-muted)' }}>Financer</span>
                    <span className="text-[var(--text-primary)] font-medium">{form.financer || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--text-muted)' }}>Product Type</span>
                    <span className="text-[var(--text-primary)] font-medium">{form.productType || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--text-muted)' }}>System</span>
                    <span className="text-[var(--text-primary)] font-medium">
                      {kW > 0 ? `${kW.toFixed(1)} kW` : '---'}
                      {kW > 0 && soldPPW > 0 && ` @ $${soldPPW.toFixed(2)}/W`}
                    </span>
                  </div>
                  {form.prepaidSubType && (
                    <div className="flex justify-between">
                      <span className="text-base" style={{ color: 'var(--text-muted)' }}>Prepaid Type</span>
                      <span className="text-[var(--text-primary)] font-medium">{form.prepaidSubType}</span>
                    </div>
                  )}
                </div>
              </button>
            </MobileCard>

            {/* Commission breakdown */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <MobileCard className="field-slide-in" key={closerTotal + '-' + setterTotal}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Commission Breakdown</p>
                {isSubDealer ? (
                  <div className="space-y-1.5 text-base">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>M2 commission</span>
                      <span
                        key={commFlash ? 'flash' : 'idle'}
                        className={`font-black text-lg${commFlash ? ' commission-val-flash' : ''}`}
                        style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
                      >${subDealerCommission.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-base">
                    <div className="flex justify-between items-center">
                      <span style={{ color: 'var(--text-muted)' }}>Closer total</span>
                      <span
                        key={commFlash ? 'flash' : 'idle'}
                        className={`font-black text-lg${commFlash ? ' commission-val-flash' : ''}`}
                        style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
                      >${closerTotal.toLocaleString()}</span>
                    </div>
                    <div className="text-base" style={{ color: 'var(--text-muted)' }}>
                      M1: ${closerM1.toLocaleString()} · M2: ${closerM2.toLocaleString()}{hasM3 ? ` · M3: $${closerM3.toLocaleString()}` : ''}
                    </div>
                    {form.setterId && setterTotal > 0 && (
                      <>
                        <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid var(--border-default)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Setter total</span>
                          <span className="text-[var(--accent-blue-text)] font-semibold">${setterTotal.toLocaleString()}</span>
                        </div>
                        <div className="text-base" style={{ color: 'var(--text-muted)' }}>
                          M1: ${setterM1.toLocaleString()} · M2: ${setterM2.toLocaleString()}{hasM3 ? ` · M3: $${setterM3.toLocaleString()}` : ''}
                        </div>
                      </>
                    )}
                    {trainerRep && trainerTotal > 0 && (
                      <div className="flex justify-between pt-1.5 text-base" style={{ borderTop: '1px solid var(--border-default)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Trainer ({trainerRep.name})</span>
                        <span className="text-[var(--accent-amber-text)]">${trainerTotal.toLocaleString()} (${trainerOverrideRate.toFixed(2)}/W)</span>
                      </div>
                    )}
                    {effectiveRole === 'admin' && (
                      <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid var(--border-default)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Kilo margin</span>
                        <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>${Math.max(0, kiloTotal - closerTotal - setterTotal - trainerTotal - closerTrainerTotal).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </MobileCard>
            )}

            {/* Divider */}
            <div className="h-px" style={{ background: 'linear-gradient(to right, transparent, var(--border-default), transparent)' }} />

            {/* BVI conditional intake — appears when installer = BVI on mobile too */}
            {isBviInstaller && (
              <BviIntakePanel
                value={bviIntake}
                onChange={setBviIntake}
                utilityBill={utilityBill}
                onUtilityBillChange={setUtilityBill}
                sendOnSubmit={bviSendOnSubmit}
                onSendOnSubmitChange={setBviSendOnSubmit}
                errors={bviErrors}
              />
            )}

            {/* Notes */}
            <div>
              <label className={labelCls} style={labelStyle}>Notes <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--text-primary) 14%, transparent)', borderRadius: 6, padding: '2px 7px', marginLeft: 4 }}>optional</span></label>
              <textarea
                placeholder="Add any notes about this deal..."
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                maxLength={500}
                className={`${inputCls('')} min-h-[80px] max-h-[160px] resize-none py-2.5`} style={v0InputStyle('')}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-base italic" style={{ color: 'var(--text-muted)' }}>Internal notes only</p>
                <p className="text-base" style={{ color: form.notes.length >= 500 ? 'var(--accent-red-text)' : form.notes.length >= 400 ? 'var(--accent-amber-text)' : 'var(--text-muted)' }}>
                  {form.notes.length}/500
                </p>
              </div>
            </div>

            {/* Lead Source */}
            <div>
              <label className={labelCls} style={labelStyle}>Lead Source <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--text-primary) 14%, transparent)', borderRadius: 6, padding: '2px 7px', marginLeft: 4 }}>optional</span></label>
              <select
                value={form.leadSource}
                onChange={(e) => {
                  const val = e.target.value;
                  update('leadSource', val);
                  // DO NOT clear setterId — setter is independent of leadSource
                  // and blitz. See project_kilo_setter_regression (Tyson, Melissa,
                  // Hunter, Patrick — four prod incidents from silent clears).
                  if (val !== 'blitz') { update('blitzId', ''); }
                }}
                className={selectCls('')} style={v0InputStyle('')}
              >
                <option value="">-- Select --</option>
                <option value="organic">Organic</option>
                <option value="referral">Referral</option>
                <option value="blitz">Blitz</option>
                <option value="door_knock">Door Knock</option>
                <option value="web">Web Lead</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Blitz selector */}
            {form.leadSource === 'blitz' && (
              <div key={'blitz-sel'} ref={(el) => { fieldWrapperRefs.current['blitzId'] = el; }} className="field-slide-in">
                <label className={labelCls} style={labelStyle}>Blitz</label>
                <select
                  value={form.blitzId}
                  onChange={(e) => {
                    const blitzId = e.target.value;
                    update('blitzId', blitzId);
                    // Sold date is intentionally NOT snapped to the blitz window
                    // (removed 2026-06-05) — deals attach to the blitz they originated
                    // on even when they close outside the blitz dates. Per Josh.
                  }}
                  onBlur={() => handleBlur('blitzId')}
                  className={selectCls('blitzId')} style={v0InputStyle('blitzId')}
                >
                  <option value="">-- Select Blitz --</option>
                  {availableBlitzes.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <FieldError errors={errors} field="blitzId" />
              </div>
            )}

            {/* Portaled to <body> so it pins to the viewport, not the
                transformed step wrapper (T1.8). The submit button is no longer
                a DOM descendant of the form, so it links back via form="...". */}
            <ViewportPortal>
            <div
              key="cta-2"
              className="cta-bar-enter fixed left-0 right-0 z-40 px-6"
              style={{
                bottom: NAV_CLEAR_BOTTOM,
                paddingBottom: '12px',
                paddingTop: '12px',
                background: 'linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--surface-page) 92%, transparent) 28%, var(--surface-page) 100%)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="flex gap-3">
                <button type="button" onClick={handlePrev} disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1 font-medium active:scale-[0.97] disabled:opacity-60"
                  style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: 16, padding: 18, fontSize: 16, color: 'var(--text-secondary)' }}
                ><ChevronLeft className="w-4 h-4" /> Back</button>
                <button type="submit" form="mobile-new-deal-form" disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 font-medium active:scale-[0.97] disabled:opacity-60"
                  style={{ background: 'var(--accent-emerald-solid)', borderRadius: 16, padding: 18, fontSize: 16, color: 'var(--text-on-accent)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                >{submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : <><Check className="w-4 h-4" /> Submit Deal</>}</button>
              </div>
            </div>
            </ViewportPortal>
    </>
  );
}
