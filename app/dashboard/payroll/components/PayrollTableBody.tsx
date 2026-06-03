'use client';

import Link from 'next/link';
import { Trash2, ChevronDown } from 'lucide-react';
import { PaymentTypeBadge } from '../../../../components/ui/PaymentTypeBadge';
import { RelativeDate } from '../../components/RelativeDate';
import { fmt$ } from '../../../../lib/utils';
import { PayrollEntry } from '../../../../lib/data';

type StatusTab = 'Draft' | 'Pending' | 'Paid';

function entryTypeTab(entry: { type?: string; paymentStage?: string; chargeCategory?: string | null }): 'Deal' | 'Bonus' | 'Trainer' | 'Charge' {
  if (entry.chargeCategory != null) return 'Charge';
  if (entry.paymentStage === 'Trainer') return 'Trainer';
  if (entry.type === 'Bonus') return 'Bonus';
  return 'Deal';
}

type RepGroup = { repId: string; repName: string; entries: PayrollEntry[]; total: number };

interface PayrollTableBodyProps {
  groupedByRep: RepGroup[];
  statusTab: StatusTab;
  expandedRepIds: Set<string>;
  collapsingRepIds: Set<string>;
  toggleRepExpanded: (repId: string) => void;
  hoveredGroupId: string | null;
  setHoveredGroupId: (id: string | null) => void;
  hoveredEntryId: string | null;
  setHoveredEntryId: (id: string | null) => void;
  selectedIds: Set<string>;
  allPageSelected: boolean;
  selectAll: () => void;
  toggleEntry: (id: string) => void;
  toggleGroupSelection: (entries: PayrollEntry[]) => void;
  allGroupEntrySelected: (entries: PayrollEntry[]) => boolean;
  processingEntryIds: Set<string>;
  openEditEntry: (entry: PayrollEntry) => void;
  handleReverseEntry: (entry: PayrollEntry) => void;
  handleDeleteEntry: (entry: PayrollEntry) => void;
}

export function PayrollTableBody({
  groupedByRep,
  statusTab,
  expandedRepIds,
  collapsingRepIds,
  toggleRepExpanded,
  hoveredGroupId,
  setHoveredGroupId,
  hoveredEntryId,
  setHoveredEntryId,
  selectedIds,
  allPageSelected,
  selectAll,
  toggleEntry,
  toggleGroupSelection,
  allGroupEntrySelected,
  processingEntryIds,
  openEditEntry,
  handleReverseEntry,
  handleDeleteEntry,
}: PayrollTableBodyProps) {
  return (
    <>
      <thead>
        <tr>
          {statusTab === 'Draft' && (
            <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, width: 40, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>
              <input type="checkbox" checked={allPageSelected} onChange={selectAll} style={{ accentColor: 'var(--accent-emerald-solid)', cursor: 'pointer' }} />
            </th>
          )}
          <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Rep</th>
          <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Type</th>
          <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Detail</th>
          <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Amount</th>
          <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Date</th>
          <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Status</th>
          <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, width: 1, position: 'sticky' as const, top: 0, zIndex: 10, backdropFilter: 'blur(6px)' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {groupedByRep.flatMap((group, groupIdx) => {
          const expanded = expandedRepIds.has(group.repId);
          const groupAllSelected = allGroupEntrySelected(group.entries);
          const summaryRow = (
            <tr
              key={`rep-${group.repId}`}
              onMouseEnter={() => setHoveredGroupId(group.repId)}
              onMouseLeave={() => setHoveredGroupId(null)}
              style={{
                background: hoveredGroupId === group.repId
                  ? 'color-mix(in srgb, var(--accent-emerald-solid) 6%, var(--surface-card))'
                  : groupIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-pressed)',
                borderBottom: '1px solid var(--border)',
                borderLeft: hoveredGroupId === group.repId
                  ? '3px solid color-mix(in srgb, var(--accent-emerald-solid) 65%, transparent)'
                  : '3px solid transparent',
                cursor: 'pointer',
                transition: 'background-color 140ms ease, border-left-color 140ms ease',
              }}
              onClick={() => toggleRepExpanded(group.repId)}
            >
              {statusTab === 'Draft' && (
                <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={groupAllSelected}
                    onChange={() => toggleGroupSelection(group.entries)}
                    style={{ accentColor: 'var(--accent-emerald-solid)', cursor: 'pointer' }}
                    title={groupAllSelected ? 'Deselect all of this rep\'s entries' : 'Select all of this rep\'s entries'}
                  />
                </td>
              )}
              <td style={{ padding: '12px 14px', fontSize: 15, fontFamily: "'DM Sans',sans-serif" }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ChevronDown
                    className="w-3.5 h-3.5"
                    style={{
                      color: hoveredGroupId === group.repId ? 'var(--accent-emerald-solid)' : 'var(--text-muted)',
                      transition: 'transform 200ms, color 140ms ease',
                      transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: hoveredGroupId === group.repId ? 'var(--accent-emerald-text)' : 'var(--text-primary)', fontWeight: 700, transition: 'color 140ms ease' }}>{group.repName}</span>
                </div>
              </td>
              <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: 'var(--text-muted)' }}>
                {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
              </td>
              <td style={{ padding: '12px 14px' }}></td>
              <td style={{ padding: '12px 14px', fontSize: 18, fontFamily: "'DM Sans',sans-serif", textAlign: 'right' }}>
                <span style={{ color: group.total < 0 ? 'var(--accent-red-display)' : 'var(--accent-emerald-display)', fontWeight: 700, fontFamily: "'DM Serif Display',serif" }}>
                  {fmt$(group.total)}
                </span>
              </td>
              <td style={{ padding: '12px 14px' }}></td>
              <td style={{ padding: '12px 14px' }}></td>
              <td style={{ padding: '12px 14px' }}></td>
            </tr>
          );
          const isCollapsing = collapsingRepIds.has(group.repId);
          if (!expanded && !isCollapsing) return [summaryRow];
          const detailRows = group.entries.map((entry, i) => (
          <tr
            key={entry.id}
            className={isCollapsing ? 'animate-row-exit' : `table-row-enter row-stagger-${Math.min(i, 24)}`}
            onMouseEnter={() => setHoveredEntryId(entry.id)}
            onMouseLeave={() => setHoveredEntryId(null)}
            style={{
              background: selectedIds.has(entry.id)
                ? 'var(--accent-emerald-soft)'
                : hoveredEntryId === entry.id
                ? 'color-mix(in srgb, var(--accent-emerald-solid) 4%, var(--surface-card))'
                : i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-pressed)',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'background-color 140ms ease',
            }}
            onClick={() => statusTab === 'Draft' && toggleEntry(entry.id)}
          >
            {statusTab === 'Draft' && (
              <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                <input type="checkbox" checked={selectedIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: 'var(--accent-emerald-solid)', cursor: 'pointer' }} />
              </td>
            )}
            <td style={{ padding: '12px 14px 12px 40px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-muted)' }}>↳</span></td>
            <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>
              {(() => {
                const kind = entryTypeTab(entry);
                const stageSuffix = kind === 'Deal' ? entry.paymentStage : null;
                return <PaymentTypeBadge kind={kind} stage={stageSuffix} />;
              })()}
            </td>
            <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }} onClick={(e) => e.stopPropagation()}>
              {entry.customerName && entry.projectId ? (
                <Link
                  href={`/dashboard/projects/${entry.projectId}`}
                  className="hover:underline"
                  style={{ color: 'var(--accent-cyan-text)' }}
                  title="Open project"
                >
                  {entry.customerName}
                </Link>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>{entry.notes || '—'}</span>
              )}
            </td>
            <td style={{ padding: '12px 14px', fontSize: 18, fontFamily: "'DM Sans',sans-serif", textAlign: 'right' }}><span style={{ color: entry.amount < 0 ? 'var(--accent-red-display)' : 'var(--accent-emerald-display)', fontWeight: 700, fontFamily: "'DM Serif Display',serif" }}>{fmt$(entry.amount)}</span></td>
            <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: 'var(--text-muted)' }}><RelativeDate date={entry.date} /></span></td>
            <td style={{ padding: '12px 14px', fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>
              <span style={
                entry.status === 'Paid'
                  ? { background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-display)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                  : entry.status === 'Pending'
                  ? { background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-display)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
                  : { background: 'var(--accent-blue-soft)', color: 'var(--accent-blue-display)', padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }
              }>{entry.status}</span>
            </td>
            <td style={{ padding: '12px 14px', fontSize: 12, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' as const, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-1 justify-end">
                {entry.status !== 'Paid' && (
                  <button
                    disabled={processingEntryIds.has(entry.id)}
                    onClick={() => openEditEntry(entry)}
                    className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                    title="Edit amount / date / notes"
                  >
                    Edit
                  </button>
                )}
                {entry.status === 'Paid' && (
                  <button
                    disabled={processingEntryIds.has(entry.id)}
                    onClick={() => openEditEntry(entry)}
                    className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--accent-amber-text)' }}
                    title="Correct paid amount or initiate chargeback"
                  >
                    Correct
                  </button>
                )}
                {entry.status === 'Pending' && (
                  <button
                    disabled={processingEntryIds.has(entry.id)}
                    onClick={() => handleReverseEntry(entry)}
                    className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--accent-amber-text)' }}
                    title="Move back to Draft"
                  >
                    Reverse
                  </button>
                )}
                {entry.status !== 'Paid' && (
                  <button
                    disabled={processingEntryIds.has(entry.id)}
                    onClick={() => handleDeleteEntry(entry)}
                    className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-40 hover:text-[var(--accent-red-text)] hover:bg-red-500/10"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-dim)' }}
                    title="Delete entry"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ));
          return [summaryRow, ...detailRows];
        })}
      </tbody>
    </>
  );
}
