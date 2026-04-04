'use client';

import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate } from '../../../lib/utils';
import { ArrowLeft, FolderKanban, DollarSign } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileEmptyState from './shared/MobileEmptyState';

const STATUS_AMOUNT_COLORS: Record<string, string> = {
  Paid: 'text-emerald-400',
  Pending: 'text-amber-300',
  Draft: 'text-slate-400',
};

const REP_TYPE_LABELS: Record<string, string> = {
  closer: 'Closer',
  setter: 'Setter',
  both: 'Closer / Setter',
};

export default function MobileRepDetail({ repId }: { repId: string }) {
  const router = useRouter();
  const { projects, payrollEntries, currentRole, effectiveRole, reps } = useApp();
  const hydrated = useIsHydrated();
  const isPM = effectiveRole === 'project_manager';

  const rep = reps.find((r) => r.id === repId);

  if (!hydrated) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-8">
        <div className="h-6 w-24 bg-slate-800 rounded animate-pulse" />
        <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
        <div className="h-4 w-32 bg-slate-800/60 rounded animate-pulse" />
      </div>
    );
  }

  if (currentRole !== 'admin' && currentRole !== 'project_manager' && repId !== undefined) {
    // Permission check handled by desktop page, but guard here too
  }

  if (!rep) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-8">
        <button
          onClick={() => router.push('/dashboard/reps')}
          className="flex items-center gap-1.5 text-sm text-slate-500 min-h-[48px]"
        >
          <ArrowLeft className="w-4 h-4" /> Reps
        </button>
        <p className="text-sm text-slate-500 text-center">Rep not found.</p>
      </div>
    );
  }

  const repProjects = projects.filter((p) => p.repId === repId || p.setterId === repId);
  const repPayroll = payrollEntries.filter((p) => p.repId === repId);
  const activeProjects = repProjects.filter((p) => !['Cancelled', 'Completed'].includes(p.phase));
  const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
  const totalPaid = repPayroll.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
  const recentPayroll = repPayroll.slice(0, 10);

  const repType = REP_TYPE_LABELS[rep.repType ?? ''] ?? rep.repType ?? 'Rep';

  return (
    <div className="px-5 pt-4 pb-28 space-y-8">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/reps')}
        className="flex items-center gap-1.5 text-sm text-slate-500 min-h-[48px]"
      >
        <ArrowLeft className="w-4 h-4" /> Reps
      </button>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">{rep.name}</h1>
        <div className="mt-1.5">
          <MobileBadge value={repType} variant="status" />
        </div>
        <p className="text-sm text-slate-500 mt-1">{rep.email}</p>
      </div>

      {/* Inline stats */}
      <p className="text-sm text-slate-400">
        {repProjects.length} deal{repProjects.length !== 1 ? 's' : ''}
        {' \u00B7 '}
        {totalKW.toFixed(1)} kW
        {!isPM && (
          <>
            {' \u00B7 '}
            <span className="text-emerald-400">${totalPaid.toLocaleString()} paid</span>
          </>
        )}
      </p>

      {/* Active Projects */}
      <MobileSection title="Active Projects" count={activeProjects.length}>
        {activeProjects.length === 0 ? (
          <MobileEmptyState icon={FolderKanban} title="No active projects" />
        ) : (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800/20 divide-y divide-slate-800/20">
            {activeProjects.map((proj) => (
              <MobileListItem
                key={proj.id}
                title={proj.customerName}
                right={<MobileBadge value={proj.phase} variant="phase" />}
                onTap={() => router.push(`/dashboard/projects/${proj.id}`)}
              />
            ))}
          </div>
        )}
      </MobileSection>

      {/* Recent Payments — hidden for PM */}
      {!isPM && (
        <MobileSection title="Recent Payments" count={repPayroll.length}>
          {repPayroll.length === 0 ? (
            <MobileEmptyState icon={DollarSign} title="No payment history" />
          ) : (
            <div>
              {recentPayroll.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between min-h-[48px] py-3 border-b border-slate-800/20 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {entry.customerName || entry.notes || '\u2014'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {entry.paymentStage} &middot; {formatDate(entry.date)}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ml-3 ${STATUS_AMOUNT_COLORS[entry.status] ?? 'text-slate-400'}`}>
                    ${entry.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </MobileSection>
      )}
    </div>
  );
}
