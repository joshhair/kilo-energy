'use client';

import { useApp } from '../../../../lib/context';
import { formatDate, fmt$, todayLocalDateStr } from '../../../../lib/utils';
import { DollarSign } from 'lucide-react';
import { PayrollStatusBadge } from './primitives';

export function SubDealerEarningsView() {
  const { effectiveRepId, payrollEntries } = useApp();

  // Sub-dealers only see M2 and M3 payroll entries
  const myPayroll = payrollEntries.filter(
    (p) => p.repId === effectiveRepId && (p.paymentStage === 'M2' || p.paymentStage === 'M3')
  );

  const todayStr = todayLocalDateStr();
  const totalEarned = myPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((s, p) => s + p.amount, 0);
  const totalPending = myPayroll.filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0);

  const sorted = [...myPayroll].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-3" />
        <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Earnings</h1>
        <p className="text-[var(--text-secondary)] text-sm font-medium mt-1">Your M2 and M3 commission payments</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="card-surface rounded-2xl p-5">
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-3" />
          <p className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-1">Total Earned</p>
          <p className="text-3xl font-black text-[var(--accent-emerald-solid)] tabular-nums">{fmt$(totalEarned)}</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">{myPayroll.filter((p) => p.status === 'Paid').length} paid entries</p>
        </div>
        <div className="card-surface rounded-2xl p-5">
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 mb-3" />
          <p className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-1">Pending</p>
          <p className="text-3xl font-black text-yellow-400 tabular-nums">{fmt$(totalPending)}</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">{myPayroll.filter((p) => p.status === 'Pending').length} pending entries</p>
        </div>
      </div>

      {/* Earnings table */}
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-white font-bold tracking-tight text-base">Payment History</h2>
        </div>
        {sorted.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <DollarSign className="w-8 h-8 text-[var(--text-dim)] mx-auto mb-3" />
            <p className="text-white font-bold text-sm mb-1">No earnings yet</p>
            <p className="text-[var(--text-muted)] text-xs">Earnings will appear once your deals reach the Installed phase.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-header-frost">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Customer</th>
                  <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Stage</th>
                  <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Amount</th>
                  <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Status</th>
                  <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Date</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/[0.15] hover:bg-[var(--accent-emerald-solid)]/[0.03] transition-colors">
                    <td className="px-6 py-3 text-white">{entry.customerName || '\u2014'}</td>
                    <td className="px-6 py-3">
                      <span className="bg-[var(--border)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded font-medium">{entry.paymentStage}</span>
                    </td>
                    <td className="px-6 py-3 text-[var(--accent-emerald-solid)] font-semibold">{fmt$(entry.amount)}</td>
                    <td className="px-6 py-3">
                      <PayrollStatusBadge status={entry.status} />
                    </td>
                    <td className="px-6 py-3 text-[var(--text-muted)] text-xs">{formatDate(entry.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
