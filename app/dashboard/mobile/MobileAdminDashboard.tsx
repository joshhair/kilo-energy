'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, formatDate, formatCompactKW } from '../../../lib/utils';
import {
  ACTIVE_PHASES,
  getSolarTechBaseline,
  getProductCatalogBaseline,
  getInstallerRatesForDeal,
} from '../../../lib/data';
import { AlertTriangle, TrendingUp, Users, Zap, CreditCard, FolderKanban, ChevronRight, Flag, Clock } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBadge from './shared/MobileBadge';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';

// ── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--m-accent, #00e5a0)';
const ACCENT2 = 'var(--m-accent2, #00b4d8)';
const MUTED = 'var(--m-text-muted, #8899aa)';
const DIM = 'var(--m-text-dim, #445577)';
const DANGER = 'var(--m-danger, #ff6b6b)';
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

type Period = 'all' | 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-year';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'this-year', label: 'This Year' },
  { value: 'last-year', label: 'Last Year' },
];

function isInPeriod(dateStr: string | null, period: Period): boolean {
  if (period === 'all') return true;
  if (!dateStr) return false;
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

export default function MobileAdminDashboard() {
  const {
    projects,
    payrollEntries,
    reps,
    installerPricingVersions,
    productCatalogProducts,
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
    if (p.installer === 'SolarTech' && p.solarTechProductId) return getSolarTechBaseline(p.solarTechProductId, p.kWSize);
    if (p.installerProductId) return getProductCatalogBaseline(productCatalogProducts, p.installerProductId, p.kWSize);
    return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
  }

  // ── Computations (period-filtered) ───────────────────────────────────────
  const active = useMemo(() => periodProjects.filter((p) => ACTIVE_PHASES.includes(p.phase)), [periodProjects]);

  const { totalPaid, totalRevenue, totalProfit } = useMemo(() => {
    let paid = 0, rev = 0, prof = 0;
    for (const e of periodPayroll) { if (e.status === 'Paid') paid += e.amount; }
    for (const p of periodProjects) {
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
      const { closerPerW, kiloPerW } = getBaselines(p);
      const w = p.kWSize * 1000;
      rev += (p.netPPW ?? 0) * w;
      prof += (closerPerW - kiloPerW) * w;
    }
    return { totalPaid: paid, totalRevenue: rev, totalProfit: prof };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodProjects, periodPayroll, installerPricingVersions, productCatalogProducts]);

  const totalKW = useMemo(() => active.reduce((s, p) => s + p.kWSize, 0), [active]);
  const flaggedCount = useMemo(() => periodProjects.filter((p) => p.flagged).length, [periodProjects]);

  // Stalled projects (in same phase > 14 days)
  const stalledProjects = useMemo(() => {
    const now = Date.now();
    return active.filter((p) => {
      const sold = new Date(p.soldDate).getTime();
      const days = Math.floor((now - sold) / 86400000);
      return days > 14 && p.phase !== 'Completed';
    }).slice(0, 5);
  }, [active]);

  const flaggedProjects = useMemo(() => projects.filter((p) => p.flagged).slice(0, 5), [projects]);

  // Payroll
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
  const recentDeals = useMemo(() => [...projects].sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? '')).slice(0, 5), [projects]);

  // Top reps by deal count
  const topReps = useMemo(() => {
    const repDeals: Record<string, number> = {};
    for (const p of active) { repDeals[p.repId] = (repDeals[p.repId] || 0) + 1; }
    return Object.entries(repDeals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => {
        const rep = reps.find((r) => r.id === id);
        return { name: rep?.name ?? 'Unknown', count };
      });
  }, [active, reps]);

  // ── Animated counters ────────────────────────────────────────────────────
  const animatedRevenue = useCountUp(Math.round(totalRevenue), 350);
  const animatedProfit = useCountUp(Math.round(totalProfit), 300);
  const animatedPaid = useCountUp(Math.round(totalPaid), 300);

  const needsAttention = flaggedCount + draftCount + pendingCount + stalledProjects.length;

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
        <div className="rounded-2xl p-5 bg-[#0d1525] border border-[#1a2840] space-y-3">
          <div className="h-4 w-20 rounded bg-[#1a2235] animate-skeleton" />
          <div className="h-10 w-40 rounded-lg bg-[#1a2235] animate-skeleton" style={{ animationDelay: '80ms' }} />
          <div className="flex gap-4 mt-2">
            <div className="h-6 w-24 rounded bg-[#1a2235] animate-skeleton" style={{ animationDelay: '140ms' }} />
            <div className="h-6 w-24 rounded bg-[#1a2235] animate-skeleton" style={{ animationDelay: '200ms' }} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl p-4 bg-[#0d1525] border border-[#1a2840]">
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
                border: period === p.value ? 'none' : '1px solid var(--m-border, #1a2840)',
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
          <div className="h-8" style={{ width: '1px', background: 'var(--m-border, #1a2840)' }} />
          <div>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '1.25rem', color: '#fff' }}>{fmtCompact(animatedPaid)}</p>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem' }}>Paid to Reps</p>
          </div>
        </div>
      </MobileCard>

      {/* ── Quick stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        <MobileStatCard label="Active" value={active.length} color={ACCENT} />
        <MobileStatCard label="Reps" value={reps.length} color={ACCENT2} />
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
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity border-b"
              style={{ borderColor: 'var(--m-border, #1a2840)' }}
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
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity border-b"
              style={{ borderColor: 'var(--m-border, #1a2840)' }}
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
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity border-b"
              style={{ borderColor: 'var(--m-border, #1a2840)' }}
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
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:opacity-70 transition-opacity"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4" style={{ color: MUTED }} />
                <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>{stalledProjects.length} stalled projects</span>
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
                  style={{ borderColor: 'var(--m-border, #1a2840)' }}
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
