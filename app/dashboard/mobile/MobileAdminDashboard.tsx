'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, formatDate, formatCompactKW } from '../../../lib/utils';
import {
  ACTIVE_PHASES,
  getSolarTechBaseline,
  getProductCatalogBaselineVersioned,
  getInstallerRatesForDeal,
} from '../../../lib/data';
import { type Period, PERIODS, isInPeriod, getPhaseStuckThresholds } from '../components/dashboard-utils';
import { AlertTriangle, TrendingUp, Users, Zap, CreditCard, FolderKanban, ChevronRight, Flag, Clock, PauseCircle } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBadge from './shared/MobileBadge';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';

// ── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--m-accent, var(--accent-emerald))';
const ACCENT2 = 'var(--m-accent2, var(--accent-cyan2))';
const MUTED = 'var(--m-text-muted, var(--text-mobile-muted))';
const DIM = 'var(--m-text-dim, #445577)';
const DANGER = 'var(--m-danger, var(--accent-danger))';
const WARNING = 'var(--m-warning, #f5a623)';

function getGreeting(name: string): string {
  const h = new Date().getHours();
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.split(' ')[0] || '';
  return firstName ? `${prefix}, ${firstName}` : prefix;
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmt$(n);
}

function useCountUp(target: number, duration = 350): number {
  const [displayed, setDisplayed] = useState(0);
  const prev = useRef(target);
  const raf = useRef<number | null>(null);
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (prefersReduced || prev.current === target) { setDisplayed(target); prev.current = target; return; }
    const start = prev.current;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
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

const PHASE_STUCK_THRESHOLDS = getPhaseStuckThresholds();

export default function MobileAdminDashboard() {
  const {
    projects,
    payrollEntries,
    reps,
    installerPricingVersions,
    productCatalogProducts,
    productCatalogPricingVersions,
    solarTechProducts,
    currentRepName,
    dbReady,
  } = useApp();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('all');
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

  // ── Period-filtered data ────────────────────────────────────────────────
  const periodProjects = useMemo(() => projects.filter((p) => isInPeriod(p.soldDate, period)), [projects, period]);
  const periodPayroll = useMemo(() => payrollEntries.filter((p) => isInPeriod(p.date, period)), [payrollEntries, period]);

  // ── Baseline helper ─────────────────────────────────────────────────────
  function getBaselines(p: (typeof projects)[number]) {
    if (p.baselineOverride) return p.baselineOverride;
    if (p.installer === 'SolarTech' && p.solarTechProductId) {
      try {
        return getSolarTechBaseline(p.solarTechProductId, p.kWSize, solarTechProducts);
      } catch {
        return { closerPerW: 0, kiloPerW: 0 };
      }
    }
    if (p.installerProductId) {
      try {
        return getProductCatalogBaselineVersioned(productCatalogProducts, p.installerProductId, p.kWSize, p.soldDate, productCatalogPricingVersions);
      } catch {
        return { closerPerW: 0, kiloPerW: 0 };
      }
    }
    return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
  }

  // ── Computations (period-filtered) ───────────────────────────────────────
  const active = useMemo(() => periodProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold' && p.phase !== 'Completed'), [periodProjects]);

  const todayStr = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();

  const { totalPaid, totalRevenue, totalProfit } = useMemo(() => {
    let paid = 0, rev = 0, prof = 0;
    for (const e of periodPayroll) { if (e.status === 'Paid' && e.date <= todayStr) paid += e.amount; }
    for (const p of periodProjects) {
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
      const { closerPerW, kiloPerW } = getBaselines(p);
      const w = p.kWSize * 1000;
      rev += (p.netPPW ?? 0) * w;
      prof += (closerPerW - kiloPerW) * w;
    }
    return { totalPaid: paid, totalRevenue: rev, totalProfit: prof };
  }, [periodProjects, periodPayroll, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions, solarTechProducts, todayStr]);

  const totalKW = useMemo(() => periodProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0), [periodProjects]);
  const flaggedCount = useMemo(() => projects.filter((p) => p.flagged && p.phase !== 'Cancelled' && p.phase !== 'Completed').length, [projects]);

  // Stalled projects — cumulative days-from-sold thresholds (intentional design: simpler than phase-entry age).
  // A project still in a given phase after this many total days from soldDate is "stuck".
  // Desktop stuck detection uses phaseChangedAt for accuracy; mobile uses soldDate for simplicity.
  // Uses full `projects` (not period-scoped) so Needs Attention matches desktop regardless of selected period.
  const stalledProjects = useMemo(() => {
    const now = Date.now();
    return projects.filter((p) => ACTIVE_PHASES.includes(p.phase) && !p.flagged).filter((p) => {
      const threshold = PHASE_STUCK_THRESHOLDS[p.phase];
      if (threshold == null) return false;
      if (!p.soldDate) return false;
      const [y, m, d] = p.soldDate.split('-').map(Number);
      const sold = new Date(y, m - 1, d).getTime();
      const days = Math.floor((now - sold) / 86400000);
      return days > threshold;
    });
  }, [projects]);

  // Payroll — draft/pending counts use unfiltered payrollEntries so the Needs Attention badge
  // stays consistent with flagged/stalled counts, which are also period-independent.
  // Unflagged On Hold projects — mirrors desktop AdminDashboard.tsx lines 249-252.
  const onHoldCount = useMemo(() => projects.filter((p) => p.phase === 'On Hold' && !p.flagged).length, [projects]);

  const draftCount = useMemo(() => payrollEntries.filter((e) => e.status === 'Draft').length, [payrollEntries]);
  const pendingCount = useMemo(() => payrollEntries.filter((e) => e.status === 'Pending').length, [payrollEntries]);
  const pendingTotal = useMemo(() => payrollEntries.filter((e) => e.status === 'Pending').reduce((s, e) => s + e.amount, 0), [payrollEntries]);

  // Pipeline counts
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const phase of ACTIVE_PHASES) counts[phase] = 0;
    for (const p of active) { if (counts[p.phase] !== undefined) counts[p.phase]++; }
    return counts;
  }, [active]);

  // Recent deals
  const recentDeals = useMemo(() => [...periodProjects].filter(p => p.phase !== 'Cancelled' && p.phase !== 'On Hold').sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? '')).slice(0, 5), [periodProjects]);

  // Top reps by deal count
  const topReps = useMemo(() => {
    const repDeals: Record<string, number> = {};
    for (const p of periodProjects) {
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
      repDeals[p.repId] = (repDeals[p.repId] || 0) + 1;
      if (p.setterId && p.setterId !== p.repId) {
        repDeals[p.setterId] = (repDeals[p.setterId] || 0) + 1;
      }
      for (const ac of p.additionalClosers ?? []) {
        repDeals[ac.userId] = (repDeals[ac.userId] || 0) + 1;
      }
      for (const as_ of p.additionalSetters ?? []) {
        repDeals[as_.userId] = (repDeals[as_.userId] || 0) + 1;
      }
    }
    return Object.entries(repDeals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => {
        const rep = reps.find((r) => r.id === id);
        return { name: rep?.name ?? 'Unknown', count };
      });
  }, [periodProjects, reps]);

  // ── Animated counters ────────────────────────────────────────────────────
  const animatedRevenue = useCountUp(Math.round(totalRevenue), 350);
  const animatedProfit = useCountUp(Math.round(totalProfit), 300);
  const animatedPaid = useCountUp(Math.round(totalPaid), 300);

  const needsAttention = flaggedCount + draftCount + pendingCount + stalledProjects.length + onHoldCount;

  // ── Skeleton while data hydrates (prevents stale-number flash) ──────────
  if (!dbReady) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <div className="h-7 w-48 rounded-lg bg-[#1a2235] animate-skeleton" />
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shrink-0 h-10 w-24 rounded-full bg-[#1a2235] animate-skeleton" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
        <div className="rounded-2xl p-5 bg-[var(--surface-mobile-card)] border border-[var(--border-mobile)] space-y-3">
          <div className="h-4 w-20 rounded bg-[#1a2235] animate-skeleton" />
          <div className="h-10 w-40 rounded-lg bg-[#1a2235] animate-skeleton" style={{ animationDelay: '80ms' }} />
          <div className="flex gap-4 mt-2">
            <div className="h-6 w-24 rounded bg-[#1a2235] animate-skeleton" style={{ animationDelay: '140ms' }} />
            <div className="h-6 w-24 rounded bg-[#1a2235] animate-skeleton" style={{ animationDelay: '200ms' }} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl p-4 bg-[var(--surface-mobile-card)] border border-[var(--border-mobile)]">
              <div className="h-3 w-12 rounded bg-[#1a2235] animate-skeleton mb-2" style={{ animationDelay: `${i * 60}ms` }} />
              <div className="h-7 w-10 rounded bg-[#1a2235] animate-skeleton" style={{ animationDelay: `${i * 60 + 30}ms` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: '1.5rem', color: '#fff', lineHeight: 1.2 }}>{getGreeting(currentRepName ?? '')}</h1>

      {/* Period filter — sliding pill (matches rep dashboard) */}
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
              className="shrink-0 rounded-full px-4 py-2 text-base font-medium transition-colors duration-200 min-h-[44px] touch-manipulation"
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

      {/* ── Hero: Revenue with Profit / Paid to Reps ── */}
      <MobileCard hero>
        <div className="flex items-center justify-between mb-2">
          <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500 }}>Revenue</p>
          <TrendingUp className="w-5 h-5" style={{ color: ACCENT }} />
        </div>
        <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '2.5rem', color: ACCENT, lineHeight: 1.1 }}>{fmtCompact(animatedRevenue)}</p>
        <div key={period} className="flex items-center gap-4 mt-4" style={{ animation: 'statCellFade 280ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
          <div>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '1.25rem', color: '#fff' }}>{fmtCompact(animatedProfit)}</p>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem' }}>Profit</p>
          </div>
          <div className="h-8" style={{ width: '1px', background: 'var(--m-border, var(--border-mobile))' }} />
          <div>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '1.25rem', color: '#fff' }}>{fmtCompact(animatedPaid)}</p>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem' }}>Paid to Reps</p>
          </div>
        </div>
      </MobileCard>

      {/* ── Quick stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        <MobileStatCard label="Active" value={active.length} color={ACCENT} />
        <MobileStatCard label="Reps" value={reps.filter(r => r.active !== false).length} color={ACCENT2} />
        <MobileStatCard label="kW" value={formatCompactKW(totalKW)} color={WARNING} />
      </div>

      {/* ── Needs Attention (action-oriented) ── */}
      {needsAttention > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5" style={{ color: WARNING }} />
            <p className="font-semibold text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>Needs Attention</p>
            <span className="ml-auto font-bold" style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>{needsAttention}</span>
          </div>

          {draftCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className={`w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity${pendingCount > 0 || flaggedCount > 0 || stalledProjects.length > 0 || onHoldCount > 0 ? ' border-b' : ''}`}
              style={pendingCount > 0 || flaggedCount > 0 || stalledProjects.length > 0 || onHoldCount > 0 ? { borderColor: 'var(--m-border, var(--border-mobile))' } : undefined}
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4" style={{ color: MUTED }} />
                <span style={{ color: '#fff', fontFamily: FONT_BODY, fontSize: '1rem' }}>{draftCount} payroll drafts</span>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
            </button>
          )}

          {pendingCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className={`w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity${flaggedCount > 0 || stalledProjects.length > 0 || onHoldCount > 0 ? ' border-b' : ''}`}
              style={flaggedCount > 0 || stalledProjects.length > 0 || onHoldCount > 0 ? { borderColor: 'var(--m-border, var(--border-mobile))' } : undefined}
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4" style={{ color: WARNING }} />
                <span style={{ color: WARNING, fontFamily: FONT_BODY, fontSize: '1rem' }}>{pendingCount} pending &middot; {fmtCompact(pendingTotal)}</span>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
            </button>
          )}

          {flaggedCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/projects')}
              className={`w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity${stalledProjects.length > 0 || onHoldCount > 0 ? ' border-b' : ''}`}
              style={stalledProjects.length > 0 || onHoldCount > 0 ? { borderColor: 'var(--m-border, var(--border-mobile))' } : undefined}
            >
              <div className="flex items-center gap-3">
                <Flag className="w-4 h-4" style={{ color: DANGER }} />
                <span style={{ color: DANGER, fontFamily: FONT_BODY, fontSize: '1rem' }}>{flaggedCount} flagged projects</span>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
            </button>
          )}

          {stalledProjects.length > 0 && (
            <button
              onClick={() => router.push('/dashboard/projects')}
              className={`w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity${onHoldCount > 0 ? ' border-b' : ''}`}
              style={onHoldCount > 0 ? { borderColor: 'var(--m-border, var(--border-mobile))' } : undefined}
            >
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4" style={{ color: MUTED }} />
                <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>{stalledProjects.length} stalled projects</span>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
            </button>
          )}

          {onHoldCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/projects')}
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity"
            >
              <div className="flex items-center gap-3">
                <PauseCircle className="w-4 h-4" style={{ color: MUTED }} />
                <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>{onHoldCount} on hold</span>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
            </button>
          )}
        </MobileCard>
      )}

      {/* ── Pipeline snapshot ── */}
      <MobileCard>
        <p className="tracking-widest uppercase mb-4" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500 }}>Pipeline</p>
        <div className="space-y-2">
          {ACTIVE_PHASES.filter((phase) => (phaseCounts[phase] || 0) > 0).map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct = active.length > 0 ? (count / active.length) * 100 : 0;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{phase}</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ACCENT }} />
                </div>
                <span className="w-8 text-right tabular-nums" style={{ color: '#fff', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{count}</span>
              </div>
            );
          })}
        </div>
      </MobileCard>

      {/* ── Top Reps ── */}
      {topReps.length > 0 && (
        <MobileCard onTap={() => router.push('/dashboard/users')}>
          <div className="flex items-center justify-between mb-4">
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500 }}>Top Reps</p>
            <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
          </div>
          <div className="space-y-3">
            {topReps.map((r, i) => (
              <div key={r.name} className="flex items-center gap-3">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    background: i === 0 ? 'rgba(0,229,160,0.15)' : i === 1 ? 'rgba(0,180,216,0.15)' : 'rgba(136,153,170,0.12)',
                    color: i === 0 ? ACCENT : i === 1 ? ACCENT2 : MUTED,
                    fontFamily: FONT_DISPLAY,
                  }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{r.name}</span>
                <span className="font-bold tabular-nums" style={{ color: MUTED, fontFamily: FONT_DISPLAY, fontSize: '1rem' }}>{r.count} deals</span>
              </div>
            ))}
          </div>
        </MobileCard>
      )}

      {/* ── Recent Deals ── */}
      <MobileCard>
        <div className="flex items-center justify-between mb-4">
          <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500 }}>Recent Deals</p>
          <button onClick={() => router.push('/dashboard/projects')} className="active:opacity-70 transition-opacity" style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>View all</button>
        </div>
        {recentDeals.length === 0 ? (
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>No deals yet.</p>
        ) : (
          <div>
            {recentDeals.map((p, i) => {
              const rep = reps.find((r) => r.id === p.repId);
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-2.5 text-left active:opacity-70 transition-opacity ${i < recentDeals.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-white truncate" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}</p>
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{rep?.name ?? 'Unknown'} &middot; {p.kWSize} kW</p>
                  </div>
                  <MobileBadge value={p.phase} />
                </button>
              );
            })}
          </div>
        )}
      </MobileCard>
    </div>
  );
}
