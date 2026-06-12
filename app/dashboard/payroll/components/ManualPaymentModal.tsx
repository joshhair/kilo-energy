'use client';

// ManualPaymentModal — the admin add-payment modal (Deal / Bonus /
// Chargeback / Charge). Moved verbatim from payroll/page.tsx (T4.1,
// 2026-06-11): the IIFE-local helpers (closeAndReset, typeAccent, titleFor)
// moved with the body. The MONEY RULES (negative-Draft storage for
// Chargeback/Charge, the M3 installPayPct guard) live in handleAddPayment,
// which stays page-owned — this modal only renders the form (incl. the
// Cancelled-only inverted project picker for chargebacks and the rep-match
// covering setterId/co-closers/co-setters). showPaymentModal gate stays in
// the page; paymentPanelRef + its useFocusTrap stay page-owned (threaded).

import { X } from 'lucide-react';
import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { inputCls, labelCls } from './form-styles';
import { SearchableSelect } from '../../components/SearchableSelect';
import { RepSelector } from '../../components/RepSelector';
import type { Project, Rep } from '../../../../lib/data';

/** Mirror of the page's paymentForm useState — keep in lockstep. */
export interface ManualPaymentForm {
  type: 'Deal' | 'Bonus' | 'Chargeback' | 'Charge';
  repId: string;
  projectId: string;
  amount: string;
  stage: 'M1' | 'M2' | 'M3';
  date: string;
  notes: string;
  chargeCategory: 'equipment_damage' | 'reimbursement_clawback' | 'customer_dispute' | 'misc';
}

export interface ManualPaymentModalProps {
  paymentForm: ManualPaymentForm;
  setPaymentForm: Dispatch<SetStateAction<ManualPaymentForm>>;
  setShowPaymentModal: Dispatch<SetStateAction<boolean>>;
  handleAddPayment: (e: FormEvent) => void;
  paymentPanelRef: RefObject<HTMLDivElement | null>;
  projects: Project[];
  reps: Rep[];
}

export function ManualPaymentModal({
  paymentForm, setPaymentForm, setShowPaymentModal, handleAddPayment,
  paymentPanelRef, projects, reps,
}: ManualPaymentModalProps) {
        const isBonus = paymentForm.type === 'Bonus';
        const isChargeback = paymentForm.type === 'Chargeback';
        const isCharge = paymentForm.type === 'Charge';
        const closeAndReset = () => {
          setShowPaymentModal(false);
          setPaymentForm({ type: 'Deal', repId: '', projectId: '', amount: '', stage: 'M1', date: '', notes: '', chargeCategory: 'misc' });
        };
        const titleFor = isCharge ? 'Charge' : isChargeback ? 'Chargeback' : isBonus ? 'Bonus' : 'Payment';
        // Type toggle colors mirror the PaymentTypeBadge palette so the
        // active mode previews how the resulting row will look in the list.
        const typeAccent = (t: typeof paymentForm.type) =>
          t === 'Chargeback' ? 'var(--accent-red-solid)'
          : t === 'Charge'   ? 'var(--accent-red-solid)'
          : t === 'Bonus'    ? 'var(--accent-amber-solid)'
          : 'var(--brand)';
        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
          <div ref={paymentPanelRef} className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[var(--text-primary)] font-semibold text-lg">Add {titleFor}</h2>
              <button onClick={closeAndReset} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddPayment} className="space-y-4">
              {/* Type toggle: Deal (project + stage) / Bonus (rep + amount only)
                  / Chargeback (clawback of a specific Paid entry, project-linked)
                  / Charge (standalone one-off deduction, no parent entry,
                  needs a category). Stored as negative Deal regardless. */}
              <div>
                <label className={labelCls}>Type</label>
                <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                  {(['Deal', 'Bonus', 'Chargeback', 'Charge'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPaymentForm((p) => ({ ...p, type: t }))}
                      className={`flex-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${paymentForm.type === t ? ((t === 'Chargeback' || t === 'Charge') ? 'text-[var(--text-primary)]' : 'text-black') : 'text-[var(--text-secondary)]'}`}
                      style={{ background: paymentForm.type === t ? typeAccent(t) : 'transparent' }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {isChargeback && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1.5">Clawback of a specific paid milestone. Enter positive dollars; stored as a negative Draft entry. Pick the cancelled deal below.</p>
                )}
                {isCharge && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1.5">One-off deduction (equipment damage, clawback, dispute). No project needed. Stored as a negative Draft entry — publish to apply.</p>
                )}
              </div>
              {isCharge && (
                <div>
                  <label className={labelCls}>Category</label>
                  <SearchableSelect
                    value={paymentForm.chargeCategory}
                    onChange={(val) => setPaymentForm((p) => ({ ...p, chargeCategory: val as typeof p.chargeCategory }))}
                    options={[
                      { value: 'equipment_damage', label: 'Equipment damage' },
                      { value: 'reimbursement_clawback', label: 'Reimbursement clawback' },
                      { value: 'customer_dispute', label: 'Customer dispute' },
                      { value: 'misc', label: 'Misc' },
                    ]}
                    placeholder="Select category"
                    searchable={false}
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>Rep</label>
                <RepSelector
                  value={paymentForm.repId}
                  onChange={(repId) => setPaymentForm((p) => ({ ...p, repId, projectId: '' }))}
                  reps={reps}
                  filterFn={(r) => r.active !== false}
                  placeholder="— Select rep —"
                  clearLabel="— Select rep —"
                />
              </div>
              {!isBonus && !isCharge && (
                <div>
                  <label className={labelCls}>Project</label>
                  <SearchableSelect
                    value={paymentForm.projectId}
                    onChange={(val) => setPaymentForm((p) => ({ ...p, projectId: val }))}
                    options={projects
                      // Deal/Bonus rows attach to live projects; Chargebacks
                      // attach specifically to CANCELLED projects (that's the
                      // whole use case). Invert the phase filter when the
                      // active type is Chargeback so admin can actually pick
                      // the deal they're clawing back. 2026-04-23.
                      .filter((p) => isChargeback
                        ? p.phase === 'Cancelled'
                        : p.phase !== 'Cancelled' && p.phase !== 'On Hold')
                      .filter((p) => !paymentForm.repId || p.repId === paymentForm.repId || p.setterId === paymentForm.repId || p.additionalClosers?.some((c) => c.userId === paymentForm.repId) || p.additionalSetters?.some((s) => s.userId === paymentForm.repId))
                      .map((p) => {
                        const installerName = typeof p.installer === 'string' ? p.installer : (p.installer as { name?: string })?.name ?? '—';
                        return { value: p.id, label: `${p.customerName} — ${installerName} (${p.kWSize} kW) [${p.phase}]` };
                      })}
                    placeholder={isChargeback ? '— Select cancelled project —' : '— Select project (optional) —'}
                  />
                </div>
              )}
              <div className={isBonus || isCharge ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className={labelCls}>Amount ($)</label>
                  <input required type="number" min="0.01" step="0.01"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))}
                    className={inputCls} />
                </div>
                {!isBonus && !isCharge && (
                  <div>
                    <label className={labelCls}>Stage</label>
                    <SearchableSelect
                      value={paymentForm.stage}
                      onChange={(val) => setPaymentForm((p) => ({ ...p, stage: val as 'M1' | 'M2' | 'M3' }))}
                      options={[
                        { value: 'M1', label: 'M1' },
                        { value: 'M2', label: 'M2' },
                        { value: 'M3', label: 'M3' },
                      ]}
                      placeholder="Select stage"
                      searchable={false}
                    />
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>{isBonus ? 'Date' : isChargeback ? 'Date' : isCharge ? 'Charge Date' : 'Pay Date'}</label>
                <input type="date" value={paymentForm.date}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{isCharge ? 'Reason' : 'Notes'}</label>
                <input type="text" placeholder={isBonus ? 'e.g. Monthly performance bonus' : isChargeback ? 'e.g. Deal cancelled by homeowner — M2 claw-back' : isCharge ? 'e.g. iPad screen damaged, replacement cost' : 'e.g. Additional payment — special circumstance'}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, notes: e.target.value }))}
                  className={inputCls + ' placeholder-slate-500'} />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit"
                  className={`flex-1 font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97] ${(isChargeback || isCharge) ? 'text-[var(--text-primary)]' : 'btn-primary text-black'}`}
                  style={{ backgroundColor: (isChargeback || isCharge) ? 'var(--accent-red-solid)' : 'var(--brand)' }}>
                  Add {titleFor}
                </button>
                <button type="button" onClick={closeAndReset}
                  className="btn-secondary flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-[var(--text-primary)] font-medium py-2.5 rounded-xl text-sm active:scale-[0.97]">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
        );
}
