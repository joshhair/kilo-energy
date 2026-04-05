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
  Paid: '#00e5a0',
  Pending: '#f5a623',
  Draft: '#8899aa',
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
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--m-card, #0d1525)' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--m-card, #0d1525)' }} />
        <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--m-card, #0d1525)', opacity: 0.6 }} />
      </div>
    );
  }

  if (currentRole !== 'admin' && currentRole !== 'project_manager' && repId !== undefined) {
    // Permission check handled by desktop page, but guard here too
  }

  if (!rep) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/reps')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Reps
        </button>
        <p className="text-base text-center" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Rep not found.</p>
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
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/reps')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Reps
      </button>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{rep.name}</h1>
        <div className="mt-1.5">
          <MobileBadge value={repType} variant="status" />
        </div>
        <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
      </div>

      {/* Inline stats */}
      <p className="text-base" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{repProjects.length}</span> deal{repProjects.length !== 1 ? 's' : ''}
        {' \u00B7 '}
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{totalKW.toFixed(1)}</span> kW
        {!isPM && (
          <>
            {' \u00B7 '}
            <span className="text-lg font-bold" style={{ color: 'var(--m-accent, #00e5a0)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${totalPaid.toLocaleString()}</span> paid
          </>
        )}
      </p>

      {/* Active Projects */}
      <MobileSection title="Active Projects" count={activeProjects.length}>
        {activeProjects.length === 0 ? (
          <MobileEmptyState icon={FolderKanban} title="No active projects" />
        ) : (
          <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)', borderColor: 'var(--m-border, #1a2840)' }}>
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
                  className="flex items-center justify-between min-h-[48px] py-3 last:border-b-0"
                  style={{ borderBottom: '1px solid var(--m-border, #1a2840)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.customerName || entry.notes || '\u2014'}
                    </p>
                    <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.paymentStage} &middot; {formatDate(entry.date)}
                    </p>
                  </div>
                  <span
                    className="text-lg font-bold tabular-nums ml-3"
                    style={{
                      color: STATUS_AMOUNT_COLORS[entry.status] ?? 'var(--m-text-muted, #8899aa)',
                      fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                    }}
                  >
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
