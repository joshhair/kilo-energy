'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate, formatCompactKW } from '../../../lib/utils';
import { ArrowLeft, FolderKanban, DollarSign } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileEmptyState from './shared/MobileEmptyState';

const STATUS_AMOUNT_COLORS: Record<string, string> = {
  Paid: 'var(--accent-emerald)',
  Pending: '#f5a623',
  Draft: 'var(--text-mobile-muted)',
};

const REP_TYPE_LABELS: Record<string, string> = {
  closer: 'Closer',
  setter: 'Setter',
  both: 'Closer / Setter',
};

type MobileFetchedUser = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  repType: string;
  active: boolean;
  canCreateDeals?: boolean;
  canAccessBlitz?: boolean;
  canExport?: boolean;
};

export default function MobileRepDetail({ repId }: { repId: string }) {
  const router = useRouter();
  const { projects, payrollEntries, effectiveRole, reps, subDealers } = useApp();
  const hydrated = useIsHydrated();
  const isPM = effectiveRole === 'project_manager';

  let rep = reps.find((r) => r.id === repId);
  const subDealer = !rep ? subDealers.find((s) => s.id === repId) : null;
  const [fetchedUser, setFetchedUser] = useState<MobileFetchedUser | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  useEffect(() => {
    if (rep || subDealer) return;
    fetch(`/api/reps/${repId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MobileFetchedUser | null) => {
        if (data) setFetchedUser(data);
        else setLookupFailed(true);
      })
      .catch(() => setLookupFailed(true));
  }, [repId, rep, subDealer]);

  // Resolve to whichever source succeeded.
  const resolvedUser = rep
    ? { ...rep, role: 'rep' as string }
    : subDealer
    ? { ...subDealer, role: 'sub-dealer' as string, repType: 'both' as string }
    : fetchedUser;

  if (!hydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))', opacity: 0.6 }} />
      </div>
    );
  }

  if (effectiveRole !== 'admin' && effectiveRole !== 'project_manager' && repId !== undefined) {
    // Permission check handled by desktop page, but guard here too
  }

  // Still fetching — show skeleton
  if (!resolvedUser && !lookupFailed) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
      </div>
    );
  }

  if (!resolvedUser) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/users')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Users
        </button>
        <p className="text-base text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>User not found.</p>
      </div>
    );
  }

  // ─── Early branch: admin / project_manager → simple detail card ───
  if (resolvedUser.role === 'admin' || resolvedUser.role === 'project_manager') {
    const roleLabel = resolvedUser.role === 'admin' ? 'Admin' : 'Project Manager';
    const badgeColor = resolvedUser.role === 'admin' ? 'var(--accent-amber)' : 'var(--accent-cyan)';
    const badgeBg = resolvedUser.role === 'admin' ? 'rgba(255,176,32,0.12)' : 'rgba(0,196,240,0.12)';
    const initials = `${resolvedUser.firstName[0] ?? ''}${resolvedUser.lastName[0] ?? ''}`.toUpperCase();
    const fu = fetchedUser; // PM permission flags only available from fetched payload

    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/users')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Users
        </button>

        <div className="rounded-2xl p-5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderLeft: `3px solid ${badgeColor}` }}>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black shrink-0" style={{ background: badgeBg, color: badgeColor }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white truncate" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                {resolvedUser.firstName} {resolvedUser.lastName}
              </h1>
              <div className="mt-1.5">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: badgeBg, color: badgeColor }}>
                  {roleLabel}
                </span>
              </div>
              {resolvedUser.email && <p className="text-sm mt-2 truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{resolvedUser.email}</p>}
              {resolvedUser.phone && <p className="text-sm truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{resolvedUser.phone}</p>}
            </div>
          </div>
        </div>

        {resolvedUser.role === 'project_manager' && fu && effectiveRole === 'admin' && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--m-text-dim, #445577)' }}>Permissions</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Can create deals</span>
                <span className={fu.canCreateDeals ? 'text-[var(--accent-emerald)] font-bold' : 'text-[var(--text-dim)]'}>{fu.canCreateDeals ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Can access blitz</span>
                <span className={fu.canAccessBlitz ? 'text-[var(--accent-emerald)] font-bold' : 'text-[var(--text-dim)]'}>{fu.canAccessBlitz ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Can export</span>
                <span className={fu.canExport ? 'text-[var(--accent-emerald)] font-bold' : 'text-[var(--text-dim)]'}>{fu.canExport ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-center mt-2" style={{ color: 'var(--m-text-dim, #445577)' }}>
          Use desktop Settings for permission management.
        </p>
      </div>
    );
  }

  // Below this point, role is 'rep' or 'sub-dealer'. Reassign rep so the
  // existing rep-detail JSX (which reads rep.name + rep.email) works for
  // sub-dealers + freshly-fetched users too.
  if (!rep) {
    rep = resolvedUser as unknown as typeof rep;
  }
  if (!rep) return null;

  const repProjects = projects.filter((p) => p.repId === repId || p.setterId === repId);
  const repPayroll = payrollEntries.filter((p) => p.repId === repId);
  const activeProjects = repProjects.filter((p) => !['Cancelled', 'On Hold', 'Completed'].includes(p.phase));
  const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const totalPaid = repPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((s, p) => s + p.amount, 0);
  const recentPayroll = repPayroll.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);

  const repType = REP_TYPE_LABELS[rep.repType ?? ''] ?? rep.repType ?? 'Rep';

  return (
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/users')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Reps
      </button>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{rep.name}</h1>
        <div className="mt-1.5">
          <MobileBadge value={repType} variant="status" />
        </div>
        <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{rep.email}</p>
      </div>

      {/* Inline stats */}
      <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{repProjects.length}</span> deal{repProjects.length !== 1 ? 's' : ''}
        {' \u00B7 '}
        <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCompactKW(totalKW)}</span>
        {!isPM && (
          <>
            {' \u00B7 '}
            <span className="text-lg font-bold" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${totalPaid.toLocaleString()}</span> paid
          </>
        )}
      </p>

      {/* Active Projects */}
      <MobileSection title="Active Projects" count={activeProjects.length}>
        {activeProjects.length === 0 ? (
          <MobileEmptyState icon={FolderKanban} title="No active projects" />
        ) : (
          <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderColor: 'var(--m-border, var(--border-mobile))' }}>
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
                  style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.customerName || entry.notes || '\u2014'}
                    </p>
                    <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.paymentStage} &middot; {formatDate(entry.date)}
                    </p>
                  </div>
                  <span
                    className="text-lg font-bold tabular-nums ml-3"
                    style={{
                      color: STATUS_AMOUNT_COLORS[entry.status] ?? 'var(--m-text-muted, var(--text-mobile-muted))',
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
