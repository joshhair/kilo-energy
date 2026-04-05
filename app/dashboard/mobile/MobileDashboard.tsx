'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import { ACTIVE_PHASES } from '../../../lib/data';
import { CheckCircle } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileBadge from './shared/MobileBadge';
import MobileAdminDashboard from './MobileAdminDashboard';

// ── Helpers ──────────────────────────────────────────────────────────────────

const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--m-accent, #00e5a0)';
const ACCENT2 = 'var(--m-accent2, #00b4d8)';
const MUTED = 'var(--m-text-muted, #8899aa)';
const DIM = 'var(--m-text-dim, #445577)';
const DANGER = 'var(--m-danger, #ff6b6b)';

function relativeTime(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const diffMs = Date.now() - then.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function stalledDays(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileDashboard() {
  const {
    projects,
    payrollEntries,
    effectiveRole,
    effectiveRepId,
  } = useApp();
  const router = useRouter();

  if (effectiveRole === 'admin') return <MobileAdminDashboard />;

  // ── Shared data derivations ────────────────────────────────────────────────

  const myProjects = useMemo(
    () =>
      effectiveRole === 'project_manager'
        ? projects
        : projects.filter(
            (p) => p.repId === effectiveRepId || p.setterId === effectiveRepId,
          ),
    [projects, effectiveRole, effectiveRepId],
  );

  const activeProjects = useMemo(
    () => myProjects.filter((p) => ACTIVE_PHASES.includes(p.phase)),
    [myProjects],
  );

  const flaggedProjects = useMemo(
    () => myProjects.filter((p) => p.flagged),
    [myProjects],
  );

  // ── PM Dashboard ──────────────────────────────────────────────────────────

  if (effectiveRole === 'project_manager') {
    const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);
    const phaseCounts = ACTIVE_PHASES.reduce(
      (acc, phase) => {
        acc[phase] = myProjects.filter((p) => p.phase === phase).length;
        return acc;
      },
      {} as Record<string, number>,
    );

    return (
      <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="Dashboard" />

        {/* Stat grid — 2x2 */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Active Projects" value={activeProjects.length} color={ACCENT} />
          <MobileStatCard label="Total Projects" value={myProjects.length} color="#fff" />
          <MobileStatCard label="Total kW" value={totalKW.toFixed(1)} color={ACCENT2} />
          <MobileStatCard label="Flagged" value={flaggedProjects.length} color={flaggedProjects.length > 0 ? DANGER : '#fff'} />
        </div>

        {/* Pipeline phase bars */}
        <MobileSection title="Pipeline">
          <MobileCard>
            <div className="space-y-1">
              {ACTIVE_PHASES.map((phase) => {
                const count = phaseCounts[phase] || 0;
                const pct =
                  myProjects.length > 0
                    ? (count / myProjects.length) * 100
                    : 0;
                return (
                  <div key={phase} className="flex items-center gap-3 py-2">
                    <span className="w-28 shrink-0" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{phase}</span>
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: ACCENT }}
                      />
                    </div>
                    <span className="w-8 text-right tabular-nums" style={{ color: '#fff', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </MobileCard>
        </MobileSection>

        {/* Needs Attention — hidden if 0 */}
        {flaggedProjects.length > 0 && (
          <MobileSection title="Needs Attention" collapsible count={flaggedProjects.length}>
            <MobileCard>
              {flaggedProjects.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:opacity-70 transition-opacity ${
                    i < flaggedProjects.length - 1 ? 'border-b' : ''
                  }`}
                  style={{ borderColor: 'var(--m-border, #1a2840)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle className="w-4 h-4 shrink-0" style={{ color: ACCENT }} />
                    <p className="font-semibold text-white truncate" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}</p>
                    <MobileBadge value={p.phase} />
                  </div>
                  <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>Stalled {stalledDays(p.soldDate)}d</span>
                </button>
              ))}
            </MobileCard>
          </MobileSection>
        )}

        {/* Recent */}
        <MobileSection title="Recent">
          {myProjects.length === 0 ? (
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>No projects yet.</p>
          ) : (
            <MobileCard>
              {[...myProjects]
                .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
                .slice(0, 5)
                .map((p, i, arr) => (
                  <button
                    key={p.id}
                    onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                    className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:opacity-70 transition-opacity ${
                      i < arr.length - 1 ? 'border-b' : ''
                    }`}
                    style={{ borderColor: 'var(--m-border, #1a2840)' }}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}</span>
                      <MobileBadge value={p.phase} />
                    </div>
                    <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{relativeTime(p.soldDate)}</span>
                  </button>
                ))}
            </MobileCard>
          )}
        </MobileSection>
      </div>
    );
  }

  // ── Rep / Sub-dealer shared data ──────────────────────────────────────────

  const todayStr = new Date().toISOString().split('T')[0];

  const myPayroll = useMemo(
    () => payrollEntries.filter((p) => p.repId === effectiveRepId),
    [payrollEntries, effectiveRepId],
  );

  const totalPaid = useMemo(
    () =>
      myPayroll
        .filter((p) => p.status === 'Paid' && p.date <= todayStr && p.amount > 0)
        .reduce((s, p) => s + p.amount, 0),
    [myPayroll, todayStr],
  );

  const totalKW = useMemo(
    () => myProjects.reduce((s, p) => s + p.kWSize, 0),
    [myProjects],
  );

  // Next payout calculation
  const nextFridayDate = useMemo(() => {
    const today = new Date();
    const d = ((5 - today.getDay() + 7) % 7) || 7;
    const nf = new Date(today);
    nf.setDate(today.getDate() + d);
    return nf.toISOString().split('T')[0];
  }, []);

  const pendingPayrollTotal = useMemo(
    () =>
      payrollEntries
        .filter(
          (p) =>
            p.repId === effectiveRepId &&
            p.date === nextFridayDate &&
            (p.status === 'Pending' || p.status === 'Paid'),
        )
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, nextFridayDate],
  );

  const daysUntilPayday = useMemo(() => {
    const today = new Date();
    return ((5 - today.getDay() + 7) % 7) || 7;
  }, []);

  const nextFridayLabel = useMemo(() => {
    const today = new Date();
    const nf = new Date(today);
    nf.setDate(today.getDate() + daysUntilPayday);
    return nf.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [daysUntilPayday]);

  // Recent activity — last 5 by soldDate
  const recentProjects = useMemo(
    () =>
      [...myProjects]
        .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
        .slice(0, 5),
    [myProjects],
  );

  // ── Sub-dealer layout ─────────────────────────────────────────────────────

  if (effectiveRole === 'sub-dealer') {
    return (
      <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="Dashboard" />

        {/* Hero — next payout */}
        <MobileCard hero>
          <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
          <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '2.5rem', color: ACCENT, lineHeight: 1.1 }}>{fmt$(pendingPayrollTotal)}</p>
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem', marginTop: '0.5rem' }}>{nextFridayLabel} &middot; {daysUntilPayday} days</p>
          <div className="mt-3 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, ((7 - daysUntilPayday) / 7) * 100))}%`, background: ACCENT }}
            />
          </div>
        </MobileCard>

        {/* Stat grid — 2x2 */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Paid" value={fmt$(totalPaid)} color={ACCENT} />
          <MobileStatCard label="kW Sold" value={totalKW.toFixed(1)} color={ACCENT2} />
          <MobileStatCard label="Active Deals" value={activeProjects.length} color="#fff" />
          <MobileStatCard label="Flagged" value={flaggedProjects.length} color={flaggedProjects.length > 0 ? DANGER : '#fff'} />
        </div>

        {/* Recent */}
        <MobileSection title="Recent">
          {recentProjects.length === 0 ? (
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>No projects yet.</p>
          ) : (
            <MobileCard>
              {recentProjects.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:opacity-70 transition-opacity ${
                    i < recentProjects.length - 1 ? 'border-b' : ''
                  }`}
                  style={{ borderColor: 'var(--m-border, #1a2840)' }}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}</span>
                    <MobileBadge value={p.phase} />
                  </div>
                  <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{relativeTime(p.soldDate)}</span>
                </button>
              ))}
            </MobileCard>
          )}
        </MobileSection>
      </div>
    );
  }

  // ── Rep layout (full) ─────────────────────────────────────────────────────

  return (
    <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
      <MobilePageHeader title="Dashboard" />

      {/* Hero — next payout */}
      <MobileCard hero>
        <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
        <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '2.5rem', color: ACCENT, lineHeight: 1.1 }}>{fmt$(pendingPayrollTotal)}</p>
        <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem', marginTop: '0.5rem' }}>{nextFridayLabel} &middot; {daysUntilPayday} days</p>
        <div className="mt-3 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, ((7 - daysUntilPayday) / 7) * 100))}%`, background: ACCENT }}
          />
        </div>
      </MobileCard>

      {/* Stat grid — 2x2 */}
      <div className="grid grid-cols-2 gap-3">
        <MobileStatCard label="Paid" value={fmt$(totalPaid)} color={ACCENT} />
        <MobileStatCard label="kW Sold" value={totalKW.toFixed(1)} color={ACCENT2} />
        <MobileStatCard label="Active Deals" value={activeProjects.length} color="#fff" />
        <MobileStatCard label="Flagged" value={flaggedProjects.length} color={flaggedProjects.length > 0 ? DANGER : '#fff'} />
      </div>

      {/* Needs Attention — hidden if 0 */}
      {flaggedProjects.length > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5" style={{ color: ACCENT }} />
            <p className="font-semibold text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>Needs Attention</p>
            <span className="ml-auto font-bold" style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>{flaggedProjects.length}</span>
          </div>
          {flaggedProjects.map((p, i) => (
            <button
              key={p.id}
              onClick={() => router.push(`/dashboard/projects/${p.id}`)}
              className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:opacity-70 transition-opacity ${
                i < flaggedProjects.length - 1 ? 'border-b' : ''
              }`}
              style={{ borderColor: 'var(--m-border, #1a2840)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <p className="font-semibold text-white truncate" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}</p>
                <MobileBadge value={p.phase} />
              </div>
              <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>Stalled {stalledDays(p.soldDate)}d</span>
            </button>
          ))}
        </MobileCard>
      )}

      {/* Recent */}
      <MobileSection title="Recent">
        {recentProjects.length === 0 ? (
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>No projects yet.</p>
        ) : (
          <MobileCard>
            {recentProjects.map((p, i) => (
              <button
                key={p.id}
                onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:opacity-70 transition-opacity ${
                  i < recentProjects.length - 1 ? 'border-b' : ''
                }`}
                style={{ borderColor: 'var(--m-border, #1a2840)' }}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}</span>
                  <MobileBadge value={p.phase} />
                </div>
                <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{relativeTime(p.soldDate)}</span>
              </button>
            ))}
          </MobileCard>
        )}
      </MobileSection>
    </div>
  );
}
