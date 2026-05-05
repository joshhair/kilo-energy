'use client';

// Reusable "co-closer / co-setter" picker used by the project-detail
// admin edit modal and the new-deal form. Keeps its own lightweight
// controlled-row state and fires onChange when a row changes so the
// parent can hold the authoritative draft array.
//
// Admin-only surface — rendered inside forms that themselves gate on
// role, so no per-component auth check here.

import { Plus, Trash2 } from 'lucide-react';
import type { Rep } from '@/lib/types';

export interface CoPartyDraft {
  userId: string;
  m1Amount: string;
  m2Amount: string;
  m3Amount: string;
}

interface CoPartySectionProps {
  label: string;
  rows: CoPartyDraft[];
  /** ID of the primary closer/setter — excluded from each row's picker so
   *  the same person can't be added twice. */
  primaryUserId?: string;
  /** IDs already consumed by other rows — excluded so picker shows uniques. */
  excludeUserIds?: string[];
  /** Which reps show up in the picker (closer/setter/both). */
  repTypeFilter: (r: Rep) => boolean;
  reps: Rep[];
  onChange: (rows: CoPartyDraft[]) => void;
  /** Called on the transition from 0 → 1 rows. Parent can use this to
   *  re-split the primary's commission evenly across both parties. */
  onFirstAdd?: () => void;
  /** When true, disables "Add" + dims existing rows (e.g. no primary setter). */
  disabled?: boolean;
  /** Tooltip / inline message shown when disabled. */
  disabledReason?: string;
}

const emptyRow: CoPartyDraft = { userId: '', m1Amount: '0', m2Amount: '0', m3Amount: '' };

export function CoPartySection({
  label,
  rows,
  primaryUserId,
  excludeUserIds = [],
  repTypeFilter,
  reps,
  onChange,
  onFirstAdd,
  disabled = false,
  disabledReason,
}: CoPartySectionProps) {
  const addRow = () => {
    if (disabled) return;
    const wasEmpty = rows.length === 0;
    onChange([...rows, { ...emptyRow }]);
    if (wasEmpty && onFirstAdd) onFirstAdd();
  };

  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<CoPartyDraft>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
          {label} {rows.length > 0 && <span className="text-[var(--text-muted)] normal-case">({rows.length})</span>}
        </label>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
            disabled
              ? 'border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed'
              : 'border-[var(--accent-emerald-solid)]/50 text-[var(--accent-emerald-text)] hover:bg-[var(--accent-emerald-solid)]/10'
          }`}
        >
          <Plus className="w-3 h-3" /> Add {label.replace(/s$/, '').toLowerCase()}
        </button>
      </div>

      {disabled && disabledReason && (
        <p className="text-[var(--text-muted)] text-xs italic">{disabledReason}</p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2 mt-2">
          {rows.map((row, idx) => {
            // Filter available reps for this specific row: exclude primary
            // AND anyone else already picked in another row (but include
            // this row's own userId so the dropdown shows the current pick).
            const takenByOthers = new Set(
              excludeUserIds.filter((id) => id && id !== row.userId).concat(primaryUserId ? [primaryUserId] : []),
            );
            const available = reps.filter(
              (r) => repTypeFilter(r) && (r.active || r.id === row.userId) && !takenByOthers.has(r.id),
            );

            return (
              <div
                key={idx}
                className={`grid grid-cols-[1fr_repeat(3,72px)_auto] gap-2 items-center bg-[var(--surface-card)]/40 border border-[var(--border)]/40 rounded-lg p-2 ${
                  disabled ? 'opacity-50' : ''
                }`}
              >
                <select
                  value={row.userId}
                  onChange={(e) => updateRow(idx, { userId: e.target.value })}
                  className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                >
                  <option value="">— Select person —</option>
                  {available.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={row.m1Amount}
                  onChange={(e) => updateRow(idx, { m1Amount: e.target.value })}
                  placeholder="M1"
                  className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                />
                <input
                  type="number"
                  step="0.01"
                  value={row.m2Amount}
                  onChange={(e) => updateRow(idx, { m2Amount: e.target.value })}
                  placeholder="M2"
                  className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                />
                <input
                  type="number"
                  step="0.01"
                  value={row.m3Amount}
                  onChange={(e) => updateRow(idx, { m3Amount: e.target.value })}
                  placeholder="M3"
                  className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-xs text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  aria-label="Remove"
                  className="text-[var(--text-muted)] hover:text-[var(--accent-red-text)] p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
          <p className="text-[10px] text-[var(--text-muted)] ml-1">
            Each amount is this person&apos;s own cut of that milestone. Primary amounts above are separate — total commission at each milestone is the sum across primary + all {label.toLowerCase()}.
          </p>
        </div>
      )}
    </div>
  );
}
