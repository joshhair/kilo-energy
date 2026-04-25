'use client';

import { formatDate } from '../../../../../lib/utils';

export interface RepCommissionEntry {
  id: string;
  paymentStage: string;
  status: string;
  amount: number;
  date: string;
  notes?: string | null;
}

export interface RepCommissionExpected {
  label: string;
  amount: number;
}

export function RepCommissionCard({
  name,
  role,
  totalExpected,
  expectedAmounts,
  entries,
}: {
  name: string;
  role: string;
  totalExpected: number;
  expectedAmounts: RepCommissionExpected[];
  entries: RepCommissionEntry[];
}) {
  return (
    <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-white text-sm font-semibold">{name}</p>
          <p className="text-[var(--text-muted)] text-xs">{role}</p>
          <p className="text-[var(--accent-emerald-solid)] text-xs font-semibold mt-0.5">
            Total expected: ${totalExpected.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          {expectedAmounts.map((e, i) => (
            <div key={i} className={i < expectedAmounts.length - 1 ? 'mb-1' : undefined}>
              <p className="text-[var(--text-secondary)] text-xs">{e.label}</p>
              <p className="text-[var(--accent-emerald-solid)] font-bold text-sm">
                ${e.amount.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
              <div>
                <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-emerald-solid)]' :
                  entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-[var(--border)] text-[var(--text-secondary)]'
                }`}>{entry.status}</span>
                <span className="text-[var(--accent-emerald-solid)] font-bold text-sm">
                  ${entry.amount.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[var(--text-dim)] text-xs italic">No payroll entries yet.</p>
      )}
    </div>
  );
}
