'use client';

/**
 * CommissionBreakdownAdmin — the admin-only Commission Breakdown card:
 * baseline-rate chips, the Total = Rep + Kilo Margin rollup, closer/setter/
 * co-party/trainer payout cards, Other Payouts, the cancelled-deal
 * chargeback banner, and the milestone Mark Paid/Unpaid strip with the
 * inline M1/M2 closer-amount editor. Extracted verbatim from
 * projects/[id]/page.tsx (T4.1 split, 2026-06-11).
 *
 * MONEY SURFACE. All derived values come from deriveProjectCommissionView
 * (one object prop, destructured below so the JSX is byte-identical to the
 * original). The milestone editor's state + the toggle/save handlers stay
 * owned by the page and arrive via the milestoneEditor props bundle —
 * this component never computes or mutates money on its own.
 * Render-gating (admin && !PM) is the parent's responsibility.
 */

import { Pencil, Plus } from 'lucide-react';
import { RepCommissionCard } from './RepCommissionCard';
import { findChargebackForEntry } from '@/lib/chargebacks';
import { formatDate } from '@/lib/utils';
import type { Project, Rep } from '@/lib/data';
import type { Role } from '@/lib/notifications/types';
import type { ProjectCommissionView } from './commission-derived';

export interface MilestoneEditorProps {
  editM1: boolean;
  editM2: boolean;
  m1Val: string;
  m2Val: string;
  editReason: string;
  setEditM1: (v: boolean) => void;
  setEditM2: (v: boolean) => void;
  setM1Val: (v: string) => void;
  setM2Val: (v: string) => void;
  setEditReason: (v: string) => void;
  saveM1: () => void;
  saveM2: () => void;
  onToggleM1: () => void;
  onToggleM2: () => void;
  onToggleM3: () => void;
}

export function CommissionBreakdownAdmin({ project, derived, reps, effectiveRole, isPM, onEditPaid, onRecordTrainerPayment, onRecordChargeback, milestoneEditor }: {
  project: Project;
  derived: ProjectCommissionView;
  reps: Rep[];
  effectiveRole: Role | null;
  isPM: boolean;
  onEditPaid: (entryId: string) => void;
  onRecordTrainerPayment: () => void;
  onRecordChargeback: () => void;
  milestoneEditor: MilestoneEditorProps;
}) {
  const {
    projectBaselines, setterPerW, closerExpectedM2, closerTotalExpected, setterTotalExpected,
    totalCommissionGross, repCommissionTotal, kiloMarginAmount, closerEntries, setterEntries,
    projectEntries, trainerEntries, otherEntries, projectedTrainerLegs, isMultiTrainer,
    trainerTotalExpected, effTrainerId, effectiveTrainerRate,
  } = derived;
  const {
    editM1, editM2, m1Val, m2Val, editReason, setEditM1, setEditM2, setM1Val, setM2Val,
    setEditReason, saveM1, saveM2, onToggleM1, onToggleM2, onToggleM3,
  } = milestoneEditor;
  return (
        <div className="card-surface rounded-2xl p-6 mb-5">
          <h2 className="text-[var(--text-primary)] font-semibold mb-1">Commission Breakdown</h2>

          {/* Baseline rates summary */}
          <div className="flex flex-wrap gap-3 mb-4 mt-2">
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Closer baseline: <span className="text-[var(--accent-cyan-text)] font-semibold">${projectBaselines.closerPerW.toFixed(3)}/W</span>
            </span>
            {project.setterId && (
              <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
                Setter baseline: <span className="text-[var(--accent-cyan-text)] font-semibold">${setterPerW.toFixed(3)}/W</span>
              </span>
            )}
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Kilo cost: <span className="text-[var(--accent-purple-text)] font-semibold">${projectBaselines.kiloPerW.toFixed(3)}/W</span>
            </span>
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Sold: <span className="text-[var(--text-primary)] font-semibold">${project.netPPW.toFixed(3)}/W</span>
            </span>
          </div>

          {/* ── Admin-only: commission rollup — Total = Rep + Kilo Margin ── */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 px-1">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Total Commission</span>
              <span className="text-[var(--text-primary)] text-sm font-bold tabular-nums">${totalCommissionGross.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Rep Commission</span>
              <span className="text-[var(--accent-emerald-text)] text-sm font-bold tabular-nums">${repCommissionTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Kilo Margin</span>
              <span className={`text-sm font-bold tabular-nums ${kiloMarginAmount < 0 ? 'text-[var(--accent-red-text)]' : 'text-[var(--accent-purple-text)]'}`}>${kiloMarginAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="space-y-4">
            {/* ── Closer ── */}
            <RepCommissionCard
              name={project.repName}
              role="Closer"
              totalExpected={closerTotalExpected}
              expectedAmounts={[
                ...(!project.setterId ? [{ label: 'Expected M1', amount: project.m1Amount ?? 0 }] : []),
                { label: 'Expected M2', amount: closerExpectedM2 },
                ...((project.m3Amount ?? 0) > 0 ? [{ label: 'Expected M3', amount: project.m3Amount ?? 0 }] : []),
              ]}
              entries={closerEntries}
              onEditPaid={effectiveRole === 'admin' ? onEditPaid : undefined}
            />

            {/* ── Setter ── */}
            {project.setterId ? (
              <RepCommissionCard
                name={project.setterName ?? ''}
                role="Setter"
                totalExpected={setterTotalExpected}
                expectedAmounts={[
                  { label: 'Expected M1', amount: project.setterM1Amount ?? 0 },
                  { label: 'Expected M2', amount: project.setterM2Amount ?? 0 },
                  ...((project.setterM3Amount ?? 0) > 0 ? [{ label: 'Expected M3', amount: project.setterM3Amount ?? 0 }] : []),
                ]}
                entries={setterEntries}
                onEditPaid={effectiveRole === 'admin' ? onEditPaid : undefined}
              />
            ) : (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <p className="text-[var(--text-primary)] text-sm font-semibold mb-0.5">{project.repName} <span className="text-[var(--text-muted)] font-normal text-xs">(self-gen)</span></p>
                <p className="text-[var(--text-muted)] text-xs">M1 flat goes to closer — no setter on this deal</p>
              </div>
            )}

            {/* ── Co-closers / Co-setters (tag-team attribution) ──
                Only renders if the deal actually has tag-team participants.
                Each card mirrors the primary closer/setter card so the
                payroll picture is consistent at a glance. */}
            {(project.additionalClosers ?? []).map((co) => {
              const coEntries = projectEntries.filter((e) => e.repId === co.userId && e.paymentStage !== 'Trainer');
              return (
                <div key={`cc-${co.userId}`} className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[var(--text-primary)] text-sm font-semibold">{co.userName}</p>
                      <p className="text-[var(--text-muted)] text-xs">Co-closer · #{co.position}</p>
                    </div>
                    <div className="text-right space-y-0.5">
                      {(co.m1Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-emerald-text)] font-bold text-sm">M1 · ${co.m1Amount.toLocaleString()}</p>
                      )}
                      {(co.m2Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-emerald-text)] font-bold text-sm">M2 · ${co.m2Amount.toLocaleString()}</p>
                      )}
                      {(co.m3Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-emerald-text)] font-bold text-sm">M3 · ${co.m3Amount!.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  {coEntries.length > 0 && (
                    <div className="space-y-1.5">
                      {coEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              entry.status === 'Paid' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)]' :
                              entry.status === 'Pending' ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)]' :
                              'bg-[var(--border)] text-[var(--text-secondary)]'
                            }`}>{entry.status}</span>
                            <span className="text-[var(--accent-emerald-text)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                            {effectiveRole === 'admin' && entry.status === 'Paid' && (
                              <button
                                type="button"
                                onClick={() => onEditPaid(entry.id)}
                                aria-label={`Edit ${entry.paymentStage} paid amount`}
                                title="Edit recorded amount (admin)"
                                className="ml-0.5 p-1 rounded transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)]"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {(project.additionalSetters ?? []).map((co) => {
              const coEntries = projectEntries.filter((e) => e.repId === co.userId && e.paymentStage !== 'Trainer');
              return (
                <div key={`cs-${co.userId}`} className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[var(--text-primary)] text-sm font-semibold">{co.userName}</p>
                      <p className="text-[var(--text-muted)] text-xs">Co-setter · #{co.position}</p>
                    </div>
                    <div className="text-right space-y-0.5">
                      {(co.m1Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-emerald-text)] font-bold text-sm">M1 · ${co.m1Amount.toLocaleString()}</p>
                      )}
                      {(co.m2Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-emerald-text)] font-bold text-sm">M2 · ${co.m2Amount.toLocaleString()}</p>
                      )}
                      {(co.m3Amount ?? 0) > 0 && (
                        <p className="text-[var(--accent-emerald-text)] font-bold text-sm">M3 · ${co.m3Amount!.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  {coEntries.length > 0 && (
                    <div className="space-y-1.5">
                      {coEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              entry.status === 'Paid' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)]' :
                              entry.status === 'Pending' ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)]' :
                              'bg-[var(--border)] text-[var(--text-secondary)]'
                            }`}>{entry.status}</span>
                            <span className="text-[var(--accent-emerald-text)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                            {effectiveRole === 'admin' && entry.status === 'Paid' && (
                              <button
                                type="button"
                                onClick={() => onEditPaid(entry.id)}
                                aria-label={`Edit ${entry.paymentStage} paid amount`}
                                title="Edit recorded amount (admin)"
                                className="ml-0.5 p-1 rounded transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)]"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Trainer ──
                Only renders if the project has a trainerId pinned (per-project
                override) OR if any Trainer-stage payroll rows exist. Trainer
                info is scrubbed server-side for non-admin/PM viewers, so
                project.trainerName / trainerRate will be undefined for reps. */}
            {(project.trainerId || trainerEntries.length > 0 || effTrainerId) && (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    {isMultiTrainer ? (
                      <>
                        <p className="text-[var(--text-primary)] text-sm font-semibold">{projectedTrainerLegs.length} trainers on this deal</p>
                        <p className="text-[var(--text-muted)] text-xs">Each trainer paid on their setter/closer&apos;s share</p>
                        {trainerTotalExpected > 0 && (
                          <p className="text-[var(--accent-emerald-text)] text-xs font-semibold mt-0.5">Combined total expected: ${trainerTotalExpected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                        )}
                        <div className="mt-2 space-y-1">
                          {projectedTrainerLegs.map((leg) => {
                            const trainerName = reps.find((r) => r.id === leg.trainerId)?.name ?? '(trainer)';
                            const traineeLabel = leg.trainees && leg.trainees.length > 0
                              ? leg.trainees.map((t) => t.name || reps.find((r) => r.id === t.userId)?.name || '?').join(' + ')
                              : '';
                            const sharePct = Math.round((leg.share ?? 1) * 100);
                            return (
                              <div key={`${leg.leg}-${leg.trainerId}`} className="flex items-center justify-between text-xs bg-[var(--surface-card)]/60 rounded-lg px-2.5 py-1.5">
                                <span className="text-[var(--text-primary)]">
                                  <span className="font-medium">{trainerName}</span>
                                  {traineeLabel && <span className="text-[var(--text-muted)]"> · via {traineeLabel}</span>}
                                  <span className="text-[var(--text-muted)]"> · ${leg.rate.toFixed(2)}/W × {sharePct}%</span>
                                </span>
                                <span className="text-[var(--accent-emerald-text)] font-semibold tabular-nums">${leg.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-[var(--text-primary)] text-sm font-semibold">{project.trainerName ?? reps.find((r) => r.id === effTrainerId)?.name ?? '(trainer)'}</p>
                        <p className="text-[var(--text-muted)] text-xs">Trainer{effectiveTrainerRate > 0 ? ` · $${effectiveTrainerRate.toFixed(2)}/W` : ''}</p>
                        {trainerTotalExpected > 0 && (
                          <p className="text-[var(--accent-emerald-text)] text-xs font-semibold mt-0.5">Total expected: ${trainerTotalExpected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                        )}
                      </>
                    )}
                  </div>
                  {/* Admin-only: record a backdated Trainer-stage entry. Used
                      for Glide-cleanup where the trainer is attached but the
                      Trainer payroll wasn't auto-generated. Blocked on
                      Cancelled / On-Hold deals (the modal won't open if the
                      project isn't active). */}
                  {effectiveRole === 'admin' && project.phase !== 'Cancelled' && project.phase !== 'On Hold' && (
                    <button
                      type="button"
                      onClick={onRecordTrainerPayment}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors text-[var(--accent-amber-text)] hover:bg-[var(--accent-amber-soft)]"
                      style={{ border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 35%, transparent)' }}
                      title="Record a backdated trainer-stage payroll entry (admin)"
                    >
                      <Plus className="w-3 h-3" /> Record Payment
                    </button>
                  )}
                </div>
                {trainerEntries.length > 0 ? (
                  <div className="space-y-1.5">
                    {trainerEntries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                          <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            entry.status === 'Paid' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)]' :
                            entry.status === 'Pending' ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)]' :
                            'bg-[var(--border)] text-[var(--text-secondary)]'
                          }`}>{entry.status}</span>
                          <span className="text-[var(--accent-emerald-text)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                          {effectiveRole === 'admin' && entry.status === 'Paid' && (
                            <button
                              type="button"
                              onClick={() => onEditPaid(entry.id)}
                              aria-label={`Edit ${entry.paymentStage} paid amount`}
                              title="Edit recorded amount (admin)"
                              className="ml-0.5 p-1 rounded transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)]"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[var(--text-dim)] text-xs italic">No payroll entries yet — generated on phase progression.</p>
                )}
              </div>
            )}

            {/* ── Other entries (trainer overrides, bonuses, etc.) ── */}
            {otherEntries.length > 0 && (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <p className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider mb-2">Other Payouts</p>
                <div className="space-y-1.5">
                  {otherEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.repName}</span>
                        <span className="text-[var(--text-muted)] text-xs ml-1.5">{entry.paymentStage}</span>
                        {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                        <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          entry.status === 'Paid' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)]' :
                          entry.status === 'Pending' ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)]' :
                          'bg-[var(--border)] text-[var(--text-secondary)]'
                        }`}>{entry.status}</span>
                        <span className="text-[var(--accent-emerald-text)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Cancelled banner + chargeback affordance ── */}
            {project.phase === 'Cancelled' && (() => {
              const eligiblePaidEntries = projectEntries
                .filter((e) => e.status === 'Paid' && !e.isChargeback && !findChargebackForEntry(e.id, projectEntries));
              if (eligiblePaidEntries.length === 0) return null;
              return (
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <div className="flex items-center justify-between gap-3 bg-[var(--accent-amber-soft)] border border-amber-500/30 rounded-xl p-4">
                    <div>
                      <p className="text-[var(--accent-amber-text)] text-sm font-semibold">Deal cancelled — chargeback(s) pending</p>
                      <p className="text-[var(--text-muted)] text-xs mt-0.5">
                        {eligiblePaidEntries.length} Paid milestone{eligiblePaidEntries.length !== 1 ? 's' : ''} without a linked chargeback. Record a clawback so payroll totals stay net-correct.
                      </p>
                    </div>
                    <button
                      onClick={onRecordChargeback}
                      className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-[var(--accent-amber-text)] border border-amber-500/40 transition-colors"
                    >
                      Record Chargeback
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Compact milestone Mark Paid/Unpaid strip. The full per-rep
                breakdown above already shows each milestone's status + amount
                inside each RepCommissionCard; this footer exists only so admin
                can flip the project-level m1Paid/m2Paid/m3Paid flags in one
                tap. Amount shown is the PROJECT total for that milestone
                (closer + setter + co-parties) so the number isn't misread
                as "$0 paid out at M1" when in fact the setter is owed $1,000.
                Inline editor only targets the closer's portion, so we hide
                it whenever a setter is present and route the admin to the
                Edit Deal modal instead.
                Dup Milestone Status block removed 2026-04-24 per Josh's ask. */}
            <div className="border-t border-[var(--border-subtle)] pt-4 flex flex-wrap gap-2">
              {(() => {
                const sumExtras = (key: 'm1Amount' | 'm2Amount' | 'm3Amount') =>
                  ((project.additionalClosers ?? []).reduce((s, c) => s + (c[key] ?? 0), 0)) +
                  ((project.additionalSetters ?? []).reduce((s, c) => s + (c[key] ?? 0), 0));
                const m1Total = (project.m1Amount ?? 0) + (project.setterM1Amount ?? 0) + sumExtras('m1Amount');
                const m2Total = (project.m2Amount ?? 0) + (project.setterM2Amount ?? 0) + sumExtras('m2Amount');
                const m3Total = (project.m3Amount ?? 0) + (project.setterM3Amount ?? 0) + sumExtras('m3Amount');
                return ([
                  { stage: 'M1' as const, paid: project.m1Paid, toggle: onToggleM1, amount: m1Total, closerAmount: project.m1Amount ?? 0 },
                  { stage: 'M2' as const, paid: project.m2Paid, toggle: onToggleM2, amount: m2Total, closerAmount: project.m2Amount ?? 0 },
                  ...(m3Total > 0 ? [{ stage: 'M3' as const, paid: project.m3Paid, toggle: onToggleM3, amount: m3Total, closerAmount: project.m3Amount ?? 0 }] : []),
                ]);
              })().map(({ stage, paid, toggle, amount, closerAmount }) => {
                const hasSetter = !!project.setterId;
                const isEditable = effectiveRole === 'admin' && !isPM && !hasSetter && (stage === 'M1' || stage === 'M2');
                const isEditing = stage === 'M1' ? editM1 : stage === 'M2' ? editM2 : false;
                return (
                  <div key={stage} className="flex flex-col gap-1">
                    <button
                      onClick={toggle}
                      className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
                        paid
                          ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)] border-[var(--accent-emerald-solid)]/30 hover:bg-[var(--accent-emerald-soft)]'
                          : 'bg-[var(--surface-card)]/60 text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--surface-card)]'
                      }`}
                      title={paid ? `Mark ${stage} unpaid` : `Mark ${stage} paid`}
                    >
                      <span>{stage}</span>
                      <span className={paid ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--accent-amber-text)]'}>
                        {paid ? 'Paid' : 'Pending'}
                      </span>
                    </button>
                    {isEditable ? (
                      isEditing ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <input
                            type="number"
                            value={stage === 'M1' ? m1Val : m2Val}
                            onChange={(e) => stage === 'M1' ? setM1Val(e.target.value) : setM2Val(e.target.value)}
                            className="w-24 text-xs rounded px-2 py-1 text-[var(--text-primary)] bg-[var(--surface-card)] border border-[var(--border)]"
                          />
                          <input
                            type="text"
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                            placeholder="Reason (optional)"
                            maxLength={200}
                            className="w-44 text-xs rounded px-2 py-1 text-[var(--text-primary)] bg-[var(--surface-card)] border border-[var(--border)]"
                          />
                          <button onClick={stage === 'M1' ? saveM1 : saveM2} className="text-xs text-[var(--accent-emerald-text)] font-medium">Save</button>
                          <button
                            onClick={() => {
                              if (stage === 'M1') setEditM1(false); else setEditM2(false);
                              setEditReason('');
                            }}
                            className="text-xs text-[var(--text-muted)]"
                          >Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            if (stage === 'M1') { setM1Val(String(closerAmount)); setEditM1(true); }
                            else { setM2Val(String(closerAmount)); setEditM2(true); }
                          }}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2 tabular-nums text-left"
                          title="Click to edit closer's milestone amount"
                        >
                          ${amount.toLocaleString()}
                        </button>
                      )
                    ) : (
                      effectiveRole === 'admin' && !isPM ? (
                        <span
                          className="text-xs text-[var(--text-muted)] tabular-nums"
                          title="Project total (closer + setter + co-parties). Edit via Edit Deal modal."
                        >
                          ${amount.toLocaleString()}
                        </span>
                      ) : null
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
  );
}
