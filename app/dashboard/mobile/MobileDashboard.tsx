'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, fmtCompact$, formatCompactKW } from '../../../lib/utils';
import { ACTIVE_PHASES } from '../../../lib/data';
import { CheckCircle } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileBadge, { PHASE_COLORS } from './shared/MobileBadge';
import MobileAdminDashboard from './MobileAdminDashboard';

type Period = 'all' | 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-year';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'this-year', label: 'This Year' },
  { value: 'last-year', label: 'Last Year' },
];

function isInPeriod(dateStr: string, period: Period): boolean {
  if (period === 'all') return true;
  const now = new Date();
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (period === 'this-month') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (period === 'last-month') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return date.getMonth() === lm.getMonth() && date.getFullYear() === lm.getFullYear();
  }
  if (period === 'this-quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const dq = Math.floor((m - 1) / 3);
    return dq === q && y === now.getFullYear();
  }
  if (period === 'this-year') return date.getFullYear() === now.getFullYear();
  if (period === 'last-year') return date.getFullYear() === now.getFullYear() - 1;
  return true;
}

function getGreeting(name: string): string {
  const h = new Date().getHours();
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.split(' ')[0] || '';
  return firstName ? `${prefix}, ${firstName}` : prefix;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--m-accent, var(--accent-emerald))';
const ACCENT2 = 'var(--m-accent2, var(--accent-cyan2))';
const MUTED = 'var(--m-text-muted, var(--text-mobile-muted))';
const DIM = 'var(--m-text-dim, #445577)';
const DANGER = 'var(--m-danger, var(--accent-danger))';

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

function stalledDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

function useCountUp(target: number, duration = 350): number {
  const [displayed, setDisplayed] = useState(target);
  const prev = useRef(target);
  const raf = useRef<number | null>(null);
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (prefersReduced || prev.current === target) { setDisplayed(target); prev.current = target; return; }
    const start = prev.current;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      // cubic-bezier(0.16, 1, 0.3, 1) approximated as ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(start + (target - start) * ease));
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else { prev.current = target; }
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration, prefersReduced]);

  return displayed;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileDashboard() {
  const {
    projects,
    payrollEntries,
    effectiveRole,
    effectiveRepId,
    effectiveRepName,
  } = useApp();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('all');
  const [_statVersion, setStatVersion] = useState(0);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });
  const [pillReady, setPillReady] = useState(false);

  useEffect(() => {
    const idx = PERIODS.findIndex(p => p.value === period);
    const el = pillRefs.current[idx];
    if (!el) return;
    const parent = el.parentElement!;
    const parentRect = parent.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setPillStyle({ left: rect.left - parentRect.left + parent.scrollLeft, width: rect.width });
    setPillReady(true);
  }, [period]);

  useEffect(() => { setStatVersion(v => v + 1); }, [period]);

  // NOTE: admin dispatch is handled at the end of the component (after
  // hooks) to satisfy rules-of-hooks. Keeping it here as a guard would
  // cause useMemo/useCountUp below to be called conditionally.

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

  // PM dispatch is rendered at the end, after all hooks — see rules-of-hooks.

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

  // Parity with desktop dashboard: currently-owed chargebacks = Draft +
  // Pending negatives. Paid negatives have already been deducted from a
  // past paycheck and are not owed anymore; including them would double-
  // count the claw-back. Shown as an extra stat card only when > 0 so
  // reps without chargebacks don't see a "0.00" clutter tile.
  const outstandingChargebacks = useMemo(
    () => myPayroll.filter((p) => p.amount < 0 && (p.status === 'Draft' || p.status === 'Pending')),
    [myPayroll],
  );
  const totalChargebacks = useMemo(
    () => Math.abs(outstandingChargebacks.reduce((s, p) => s + p.amount, 0)),
    [outstandingChargebacks],
  );

  const totalKW = useMemo(
    () => myProjects.reduce((s, p) => s + p.kWSize, 0),
    [myProjects],
  );

  // Next payout calculation
  const nextFridayDate = useMemo(() => {
    const today = new Date();
    const d = (5 - today.getDay() + 7) % 7;
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

  // Sub-dealer dispatch is rendered at the end (after all hooks) — rules-of-hooks.

  // ── Period-filtered data ──────────────────────────────────────────────────

  const periodProjects = useMemo(
    () => myProjects.filter((p) => isInPeriod(p.soldDate, period)),
    [myProjects, period],
  );

  const periodPayroll = useMemo(
    () => myPayroll.filter((p) => isInPeriod(p.date, period)),
    [myPayroll, period],
  );

  const periodPaid = useMemo(
    () => periodPayroll.filter((p) => p.status === 'Paid' && p.amount > 0).reduce((s, p) => s + p.amount, 0),
    [periodPayroll],
  );

  const periodKW = useMemo(
    () => periodProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0),
    [periodProjects],
  );

  const periodActive = useMemo(
    () => periodProjects.filter((p) => ACTIVE_PHASES.includes(p.phase)),
    [periodProjects],
  );

  // Pipeline: sum of unpaid M1 + M2 + M3 on active projects
  const pipelineValue = useMemo(
    () => activeProjects.reduce((s, p) => {
      let v = 0;
      if (!p.m1Paid) v += p.m1Amount || 0;
      if (!p.m2Paid) v += p.m2Amount || 0;
      v += p.m3Amount || 0;
      return s + v;
    }, 0),
    [activeProjects],
  );

  // On Pace: annual projection — matches desktop My Pay calculation exactly
  const { onPaceAnnual, dealsPerMonth: paceDPM } = useMemo(() => {
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const allMyProjects = myProjects.filter((p) => p.phase !== 'Cancelled');
    const totalDeals = allMyProjects.length;
    if (totalDeals === 0) return { onPaceAnnual: 0, dealsPerMonth: 0 };

    // Average commission per deal (M1 + M2)
    const avgCommissionPerDeal = allMyProjects.reduce((s, p) => s + (p.m1Amount ?? 0) + (p.m2Amount ?? 0), 0) / totalDeals;

    // Deal closing pace
    const sorted = [...allMyProjects].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const firstDealDate = new Date(sorted[0].soldDate + 'T12:00:00');
    const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / 86400000, 1);
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;
    const paceBasedAnnual = dealsPerMonth * avgCommissionPerDeal * 12;

    // Actual paid history
    const totalPaidPositive = myPayroll
      .filter((p) => p.status === 'Paid' && p.amount > 0 && p.date <= todayISO)
      .reduce((s, p) => s + p.amount, 0);

    let annual: number;
    if (daysSinceFirst >= 60 && totalPaidPositive > 0) {
      // Blended: 60% pace-based + 40% actual paid rate
      const paidMonthlyRate = (totalPaidPositive / daysSinceFirst) * 30.44;
      const monthlyAvg = Math.round(paceBasedAnnual / 12 * 0.6 + paidMonthlyRate * 0.4);
      annual = monthlyAvg * 12;
    } else {
      // Pure pace-based
      annual = Math.round(paceBasedAnnual);
    }

    // Pipeline boost: 15% of projected M1 + M2 (same as desktop My Pay)
    const preAcceptance = ['New'];
    const preInstalled = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install'];
    const projM1 = allMyProjects.filter((p) => preAcceptance.includes(p.phase)).reduce((s, p) => s + (p.m1Amount ?? 0), 0);
    const projM2 = allMyProjects.filter((p) => preInstalled.includes(p.phase)).reduce((s, p) => s + (p.m2Amount ?? 0), 0);
    annual += Math.round((projM1 + projM2) * 0.15);

    return { onPaceAnnual: annual, dealsPerMonth };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeProjects reports as unnecessary but it's a reference the memo must invalidate on
  }, [myProjects, myPayroll, activeProjects]);

  // ── Animated counters (rep layout) ───────────────────────────────────────

  const animatedOnPace = useCountUp(onPaceAnnual, 350);
  const animatedPayout = useCountUp(pendingPayrollTotal, 300);
  const animatedPaid = useCountUp(periodPaid, 300);
  const animatedPipeline = useCountUp(pipelineValue, 300);

  // ── Admin dispatch (after all hooks — rules-of-hooks) ─────────────────────
  if (effectiveRole === 'admin') return <MobileAdminDashboard />;

  // ── Sub-dealer dispatch (after all hooks) ─────────────────────────────────
  if (effectiveRole === 'sub-dealer') {
    return (
      <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="Dashboard" />

        {/* Hero — next payout */}
        <MobileCard hero>
          <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
          <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: ACCENT, lineHeight: 1.1 }}>{fmt$(pendingPayrollTotal)}</p>
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem', marginTop: '0.5rem' }}>{nextFridayLabel} &middot; {daysUntilPayday} days</p>
          <div className="mt-3 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, ((7 - daysUntilPayday) / 7) * 100))}%`, background: ACCENT }} />
          </div>
        </MobileCard>

        {/* Stat grid — 2x2, +1 conditional chargeback tile when owed */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Paid" value={fmt$(totalPaid)} color={ACCENT} />
          <MobileStatCard label="kW Sold" value={formatCompactKW(totalKW)} color={ACCENT2} />
          <MobileStatCard label="Active Deals" value={activeProjects.length} color="#fff" />
          <MobileStatCard label="Flagged" value={flaggedProjects.length} color={flaggedProjects.length > 0 ? DANGER : '#fff'} />
          {outstandingChargebacks.length > 0 && (
            <MobileStatCard
              label="Chargebacks"
              value={fmt$(totalChargebacks)}
              color={DANGER}
            />
          )}
        </div>

        {/* Recent */}
        <MobileSection title="Recent">
          {recentProjects.length === 0 ? (
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem' }}>No projects yet.</p>
          ) : (
            <div className="space-y-2">
              {recentProjects.map((p) => {
                const accent = PHASE_COLORS[p.phase]?.text ?? 'var(--text-mobile-muted)';
                return (
                  <button
                    key={p.id}
                    onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                    className="w-full flex items-stretch rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform duration-150"
                    style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid #2a3858', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="shrink-0" style={{ width: 4, background: accent }} />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-white font-semibold truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.05rem' }}>{p.customerName}</span>
                        <MobileBadge value={p.phase} />
                      </div>
                      <span className="shrink-0" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{relativeTime(p.soldDate)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </MobileSection>
      </div>
    );
  }

  // ── PM dispatch (after all hooks) ─────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    const totalKWPm = activeProjects.reduce((s, p) => s + p.kWSize, 0);
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
          <MobileStatCard label="Total kW" value={formatCompactKW(totalKWPm)} color={ACCENT2} />
          <MobileStatCard label="Flagged" value={flaggedProjects.length} color={flaggedProjects.length > 0 ? DANGER : '#fff'} />
        </div>

        {/* Pipeline phase bars */}
        <MobileSection title="Pipeline">
          <MobileCard>
            <div className="space-y-1">
              {ACTIVE_PHASES.map((phase) => {
                const count = phaseCounts[phase] || 0;
                const pct = myProjects.length > 0 ? (count / myProjects.length) * 100 : 0;
                return (
                  <div key={phase} className="flex items-center gap-3 py-2">
                    <span className="w-28 shrink-0" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{phase}</span>
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
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
                  className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:scale-[0.97] active:opacity-80 transition-[transform,opacity] duration-150 ${i < flaggedProjects.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--m-border, var(--border-mobile))', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle className="w-4 h-4 shrink-0" style={{ color: ACCENT }} />
                    <p className="font-semibold text-white truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</p>
                    <MobileBadge value={p.phase} />
                  </div>
                  <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{stalledDays(p.soldDate) !== null ? `Stalled ${stalledDays(p.soldDate)}d` : '—'}</span>
                </button>
              ))}
            </MobileCard>
          </MobileSection>
        )}

        {/* Recent */}
        <MobileSection title="Recent">
          {myProjects.length === 0 ? (
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem' }}>No projects yet.</p>
          ) : (
            <MobileCard>
              {[...myProjects]
                .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
                .slice(0, 5)
                .map((p, i, arr) => (
                  <button
                    key={p.id}
                    onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                    className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:scale-[0.97] active:opacity-80 transition-[transform,opacity] duration-150 ${i < arr.length - 1 ? 'border-b' : ''}`}
                    style={{ borderColor: 'var(--m-border, var(--border-mobile))', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-white" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</span>
                      <MobileBadge value={p.phase} />
                    </div>
                    <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{relativeTime(p.soldDate)}</span>
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
      {/* Greeting */}
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: '1.5rem', color: '#fff', lineHeight: 1.2 }}>{getGreeting(effectiveRepName ?? '')}</h1>

      {/* Period filter */}
      <div className="-mx-5" style={{ WebkitMaskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)', maskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)' }}>
        <div className="relative flex gap-2 overflow-x-auto no-scrollbar px-5">
          {pillReady && (
            <span
              className="absolute top-0 h-full rounded-full pointer-events-none"
              style={{
                left: pillStyle.left,
                width: pillStyle.width,
                background: ACCENT,
                transition: 'left 200ms cubic-bezier(0.34, 1.56, 0.64, 1), width 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          )}
          {PERIODS.map((p, idx) => (
            <button
              key={p.value}
              ref={(el) => { pillRefs.current[idx] = el; }}
              onClick={() => { setPeriod(p.value); requestAnimationFrame(() => { pillRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }); }}
              className="shrink-0 rounded-full px-4 py-2 text-base font-medium transition-all transition-colors duration-200 min-h-[44px] touch-manipulation"
              style={{
                fontFamily: FONT_BODY,
                color: period === p.value ? '#000' : MUTED,
                fontWeight: period === p.value ? 700 : undefined,
                border: period === p.value ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                position: 'relative',
                zIndex: 1,
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hero card — On Pace is the headline, Next Payout secondary.
          The inner divs previously had key={period} which forced an
          unmount/remount cycle on every period change so the
          hero-stat-enter CSS fade could re-play. On mobile this caused
          a visual glitch where multiple ghost copies of the hero card
          appeared to stack below the live one after a period switch —
          almost certainly a React key + CSS animation + iOS Safari
          interaction. Removing key={period} keeps the same DOM node
          mounted; the numeric count-up animations (useCountUp) already
          provide smooth value transitions on period change, so the
          fade is redundant anyway. */}
      <MobileCard hero>
        {onPaceAnnual > 0 ? (
          <div>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.25rem' }}>On Pace For {new Date().getFullYear()}</p>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: ACCENT2, lineHeight: 1.1 }}>{fmt$(animatedOnPace)}</p>
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem', marginTop: '0.35rem' }}>
              {period === 'this-year' ? 'This Year' : `Based on ${paceDPM.toFixed(1)} deals/mo`}
            </p>
            {/* Next Payout — secondary */}
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
              <div className="flex items-baseline justify-between">
                <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 600 }}>Next Payout</p>
                <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem' }}>{nextFridayLabel} &middot; <span style={{ color: '#fff' }}>{daysUntilPayday}d</span></p>
              </div>
              <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.75rem, 8vw, 2.25rem)', color: ACCENT, lineHeight: 1.3 }}>{fmt$(animatedPayout)}</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: ACCENT, lineHeight: 1.1 }}>{fmt$(animatedPayout)}</p>
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem', marginTop: '0.5rem' }}>{nextFridayLabel} &middot; <span style={{ color: '#fff' }}>{daysUntilPayday} days</span></p>
          </div>
        )}

        {/* Stats inside hero card */}
        <div key={period} className="grid grid-cols-2 gap-x-6 gap-y-3 mt-5 pt-4" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 0ms both' }}>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: ACCENT, lineHeight: 1.15 }}>{fmtCompact$(animatedPaid)}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Paid</p>
          </div>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both' }}>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: ACCENT2, lineHeight: 1.15 }}>{fmtCompact$(animatedPipeline)}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Pipeline</p>
          </div>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both' }}>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: '#fff', lineHeight: 1.15 }}>{formatCompactKW(periodKW)}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Sold</p>
          </div>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 180ms both' }}>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: '#fff', lineHeight: 1.15 }}>{periodActive.length}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Active Deals</p>
          </div>
        </div>
      </MobileCard>

      {/* Needs Attention — hidden if 0 */}
      {flaggedProjects.length > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5" style={{ color: ACCENT }} />
            <p className="font-semibold text-white" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>Needs Attention</p>
            <span className="ml-auto font-bold" style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>{flaggedProjects.length}</span>
          </div>
          {flaggedProjects.map((p, i) => (
            <button
              key={p.id}
              onClick={() => router.push(`/dashboard/projects/${p.id}`)}
              className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:scale-[0.97] active:opacity-80 transition-[transform,opacity] duration-150 mobile-list-item ${i < flaggedProjects.length - 1 ? 'border-b' : ''}`}
              style={{ borderColor: 'var(--m-border, var(--border-mobile))', animationDelay: `${i * 45}ms`, transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <p className="font-semibold text-white truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</p>
                <MobileBadge value={p.phase} />
              </div>
              <span className="shrink-0 ml-2" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>{stalledDays(p.soldDate) !== null ? `Stalled ${stalledDays(p.soldDate)}d` : '—'}</span>
            </button>
          ))}
        </MobileCard>
      )}

      {/* Recent */}
      {recentProjects.length > 0 && (
        <MobileSection title="Recent">
          <div className="space-y-2">
            {recentProjects.map((p, i) => {
              const accent = PHASE_COLORS[p.phase]?.text ?? 'var(--text-mobile-muted)';
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className="w-full flex items-stretch rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform duration-150 mobile-list-item"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid #2a3858',
                    animationDelay: `${i * 45}ms`,
                    transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  {/* Phase-colored accent strip — scan by color. */}
                  <div className="shrink-0" style={{ width: 4, background: accent }} />
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-white font-semibold truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.05rem' }}>{p.customerName}</span>
                      <MobileBadge value={p.phase} />
                    </div>
                    <span className="shrink-0" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{relativeTime(p.soldDate)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </MobileSection>
      )}
    </div>
  );
}
