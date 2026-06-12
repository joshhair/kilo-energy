'use client';

// ReimbursementsView — the reimbursements page-view of the payroll ledger:
// status/date/archive filter bar + request table with inline optimistic
// PATCH actions (approve/deny/reset/archive/delete). Moved verbatim from
// payroll/page.tsx (T4.1, 2026-06-11); the per-row patchReim closure moved
// with the JSX. The pageView gate + tab-animation wrapper stay in the page.
// PATCH body shape {status, archived} is locked by reimbursement-actions
// API tests.

import { Filter, Check, X, Trash2, Receipt } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Reimbursement } from '../../../../lib/data';
import { formatDate } from '../../../../lib/utils';
import { ReimBadge } from './StatCard';

export interface ReimbursementsViewProps {
  reimbursements: Reimbursement[];
  filteredReimbursements: Reimbursement[];
  reimFilterStatus: 'All' | 'Pending' | 'Approved' | 'Denied';
  setReimFilterStatus: Dispatch<SetStateAction<'All' | 'Pending' | 'Approved' | 'Denied'>>;
  reimFilterFrom: string;
  setReimFilterFrom: Dispatch<SetStateAction<string>>;
  reimFilterTo: string;
  setReimFilterTo: Dispatch<SetStateAction<string>>;
  showArchivedReim: false | true | 'only';
  setShowArchivedReim: Dispatch<SetStateAction<false | true | 'only'>>;
  processingReimIds: Set<string>;
  setProcessingReimIds: Dispatch<SetStateAction<Set<string>>>;
  setPendingDeleteReim: (r: Reimbursement | null) => void;
  setReimbursements: Dispatch<SetStateAction<Reimbursement[]>>;
  toast: (msg: string, type?: 'success' | 'error') => void;
}

export function ReimbursementsView({
  reimbursements,
  filteredReimbursements, reimFilterStatus, setReimFilterStatus,
  reimFilterFrom, setReimFilterFrom, reimFilterTo, setReimFilterTo,
  showArchivedReim, setShowArchivedReim, processingReimIds, setProcessingReimIds,
  setPendingDeleteReim, setReimbursements, toast,
}: ReimbursementsViewProps) {
  return (
    <>
          {/* Date + status filter */}
          <div className="flex items-center gap-3 mb-5">
            <Filter className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <select
              value={reimFilterStatus}
              onChange={(e) => setReimFilterStatus(e.target.value as 'All' | 'Pending' | 'Approved' | 'Denied')}
              className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Denied">Denied</option>
              <option value="All">All</option>
            </select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">From</label>
              <input
                type="date"
                value={reimFilterFrom}
                onChange={(e) => setReimFilterFrom(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">To</label>
              <input
                type="date"
                value={reimFilterTo}
                onChange={(e) => setReimFilterTo(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)]"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
            <select
              value={showArchivedReim === 'only' ? 'only' : showArchivedReim ? 'all' : 'active'}
              onChange={(e) => setShowArchivedReim(e.target.value === 'only' ? 'only' : e.target.value === 'all' ? true : false)}
              className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-emerald-solid)] ml-auto"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              title="Archive visibility"
            >
              <option value="active">Active only</option>
              <option value="all">Include archived</option>
              <option value="only">Archived only</option>
            </select>
            {(reimFilterFrom || reimFilterTo || reimFilterStatus !== 'Pending' || showArchivedReim !== false) && (
              <button
                onClick={() => { setReimFilterFrom(''); setReimFilterTo(''); setReimFilterStatus('Pending'); setShowArchivedReim(false); }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline transition-colors"
              >
                Clear
              </button>
            )}
            <span className="text-[var(--text-dim)] text-xs ml-auto">{filteredReimbursements.length} request{filteredReimbursements.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Rep</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Description</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Date</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Receipt</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReimbursements.map((r, i) => (
                  <tr key={r.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150`} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'color-mix(in srgb, var(--surface-card) 35%, var(--surface-page))' }}>
                    <td className="px-5 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.repName}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-secondary)' }}>{r.description}</td>
                    <td className="px-5 py-3 font-semibold" style={{ color: 'var(--accent-emerald-display)', fontFamily: "'DM Serif Display', serif" }}>${r.amount.toFixed(2)}</td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{formatDate(r.date)}</td>
                    <td className="px-5 py-3 text-[var(--text-secondary)] text-xs">
                      {r.receiptUrl ? (
                        <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-cyan-text)] hover:underline">
                          {r.receiptName || 'Receipt'}
                        </a>
                      ) : (
                        r.receiptName || '—'
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <ReimBadge status={r.status} />
                      {r.archivedAt && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">· archived</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {(() => {
                        // Inline handler — shared by all state-transition buttons.
                        const patchReim = (updates: Partial<{ status: Reimbursement['status']; archived: boolean }>, successMsg: string, rollback: Partial<Reimbursement>) => {
                          if (processingReimIds.has(r.id)) return;
                          setProcessingReimIds((prev) => new Set(prev).add(r.id));
                          const optimistic: Partial<Reimbursement> = {};
                          if (updates.status) optimistic.status = updates.status;
                          if (updates.archived !== undefined) optimistic.archivedAt = updates.archived ? new Date().toISOString() : undefined;
                          setReimbursements((prev) => prev.map((x) => x.id === r.id ? { ...x, ...optimistic } : x));
                          fetch(`/api/reimbursements/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
                            .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(successMsg, 'success'); })
                            .catch((err) => { console.error(err); toast('Failed to persist change', 'error'); setReimbursements((prev) => prev.map((x) => x.id === r.id ? { ...x, ...rollback } : x)); })
                            .finally(() => setProcessingReimIds((prev) => { const s = new Set(prev); s.delete(r.id); return s; }));
                        };
                        const deleteReim = () => { setPendingDeleteReim(r); };
                        const btnCls = 'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
                        return (
                          <div className="flex gap-2 flex-wrap">
                            {r.status === 'Pending' && (
                              <>
                                <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ status: 'Approved' }, `Reimbursement approved for ${r.repName}`, { status: 'Pending' })} className={`${btnCls} bg-[var(--accent-emerald-soft)] hover:bg-emerald-800/60 text-[var(--accent-emerald-text)]`}>
                                  <Check className="w-3 h-3" /> Approve
                                </button>
                                <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ status: 'Denied' }, `Reimbursement denied for ${r.repName}`, { status: 'Pending' })} className={`${btnCls} bg-[var(--accent-red-soft)] hover:bg-red-800/60 text-[var(--accent-red-text)]`}>
                                  <X className="w-3 h-3" /> Deny
                                </button>
                              </>
                            )}
                            {(r.status === 'Approved' || r.status === 'Denied') && (
                              <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ status: 'Pending' }, `Reset to Pending`, { status: r.status })} className={`${btnCls} bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-secondary)] border border-[var(--border-subtle)]`}>
                                Reset
                              </button>
                            )}
                            {!r.archivedAt && (
                              <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ archived: true }, `Reimbursement archived`, { archivedAt: undefined })} className={`${btnCls} bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-muted)] border border-[var(--border-subtle)]`}>
                                Archive
                              </button>
                            )}
                            {r.archivedAt && (
                              <button disabled={processingReimIds.has(r.id)} onClick={() => patchReim({ archived: false }, `Reimbursement unarchived`, { archivedAt: r.archivedAt })} className={`${btnCls} bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-secondary)] border border-[var(--border-subtle)]`}>
                                Unarchive
                              </button>
                            )}
                            <button disabled={processingReimIds.has(r.id)} onClick={deleteReim} className={`${btnCls} text-[var(--text-dim)] hover:text-[var(--accent-red-text)] hover:bg-red-500/10`} title="Delete permanently">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
                {filteredReimbursements.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Receipt className="w-10 h-10 text-[var(--text-dim)]" />
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{reimbursements.length === 0 ? 'No reimbursement requests' : 'No requests match the selected filters'}</p>
                        <p className="text-xs text-[var(--text-muted)]">{reimbursements.length === 0 ? 'Reps can submit reimbursement requests from their My Pay page' : 'Try adjusting the status or date filters to find what you need'}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
    </>
  );
}
