'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, fmtCompact$, formatCompactKWParts } from '../../../lib/utils';
import { sumPaid } from '../../../lib/aggregators';
import {
  ACTIVE_PHASES,
  getSolarTechBaseline,
  getProductCatalogBaselineVersioned,
  getInstallerRatesForDeal,
} from '../../../lib/data';
import { type Period, PERIODS, isInPeriod, getPhaseStuckThresholds } from '../components/dashboard-utils';
import { MyTasksSection, type MentionItem } from '../page';
import { AlertTriangle, TrendingUp, CreditCard, ChevronRight, Flag, Clock, PauseCircle, BarChart2, AlertCircle, CheckCircle } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import { SegmentedPills } from '../../../components/ui';

// ── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--accent-emerald-solid)';
const ACCENT2 = 'var(--accent-cyan-solid)';
// ACCENT_DISP removed — Revenue card uses var(--accent-emerald-text)/cyan-display inline.
const MUTED = 'var(--text-muted)';
const DIM = 'var(--text-dim)';
const DANGER = 'var(--accent-red-solid)';
const WARNING = 'var(--accent-amber-solid)';
// HERO_NUM removed — hero card now uses var(--accent-cyan-display) inline for the Revenue numeral.

function getGreeting(name: string): string {
  const h = new Date().getHours();
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.split(' ')[0] || '';
  return firstName ? `${prefix}, ${firstName}` : prefix;
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
    currentRepId,
    effectiveRepId,
    currentUserRepType,
    dbReady,
    setViewAsUser,
    updateProject,
  } = useApp();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('all');
  const [recentSearch, setRecentSearch] = useState('');
  const [recentPage, setRecentPage] = useState(1);
  const RECENT_PER_PAGE = 10;

  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const fetchMentions = useCallback((signal?: AbortSignal) => {
    if (!effectiveRepId) return;
    fetch(`/api/mentions?userId=${encodeURIComponent(effectiveRepId)}`, { signal })
      .then((res) => { if (!res.ok) throw new Error('Failed to fetch'); return res.json(); })
      .then((rawMentions: unknown[]) => {
        const items: MentionItem[] = (rawMentions ?? []).map((raw) => {
          const m = raw as {
            id: string;
            messageId?: string;
            message?: {
              id?: string;
              projectId?: string;
              project?: { customerName?: string };
              text?: string;
              authorName?: string;
              checkItems?: Array<{ id: string; text: string; completed: boolean }>;
            };
          };
          return {
            id: m.id,
            projectId: m.message?.projectId ?? '',
            projectCustomerName: m.message?.project?.customerName ?? 'Unknown',
            messageId: m.messageId ?? m.message?.id ?? '',
            messageSnippet: (m.message?.text ?? '').slice(0, 120),
            authorName: m.message?.authorName ?? 'Unknown',
            checkItems: (m.message?.checkItems ?? []).map((ci) => ({
              id: ci.id,
              text: ci.text,
              completed: ci.completed,
              dueDate: (ci as { dueDate?: string | null }).dueDate ?? null,
            })),
            createdAt: (m.message as { createdAt?: string } | undefined)?.createdAt ?? new Date().toISOString(),
            read: (raw as { readAt?: string | null }).readAt != null,
          };
        });
        setMentions(items);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setMentions([]);
      });
  }, [effectiveRepId]);
  useEffect(() => {
    const controller = new AbortController();
    fetchMentions(controller.signal);
    return () => { controller.abort(); };
  }, [fetchMentions]);

  // Sliding indicator + scroll-into-view are now owned by SegmentedPills.

  useEffect(() => { setRecentPage(1); setRecentSearch(''); }, [period]);

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
    try {
      return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
    } catch {
      return { closerPerW: 0, kiloPerW: 0 };
    }
  }

  // ── Computations (period-filtered) ───────────────────────────────────────
  const active = useMemo(() => periodProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold' && p.phase !== 'Completed'), [periodProjects]);

  const todayStr = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();

  const { totalPaid, totalRevenue, totalProfit } = useMemo(() => {
    const paid = sumPaid(periodPayroll, { asOf: todayStr });
    let rev = 0, prof = 0;
    for (const p of periodProjects) {
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
      const { closerPerW, kiloPerW } = getBaselines(p);
      const w = p.kWSize * 1000;
      rev += (p.netPPW ?? 0) * w;
      prof += (closerPerW - kiloPerW) * w;
    }
    return { totalPaid: paid, totalRevenue: rev, totalProfit: prof };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getBaselines closes over the declared deps; naming it separately would double-fire
  }, [periodProjects, periodPayroll, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions, solarTechProducts, todayStr]);

  const totalKW = useMemo(() => periodProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0), [periodProjects]);
  const totalKWInstalled = useMemo(() => periodProjects.filter((p) => p.phase === 'PTO' || p.phase === 'Installed' || p.phase === 'Completed').reduce((s, p) => s + p.kWSize, 0), [periodProjects]);
  const flaggedProjects = useMemo(() => projects.filter((p) => p.flagged && p.phase !== 'Cancelled' && p.phase !== 'Completed'), [projects]);

  // Stalled projects — uses phaseChangedAt with soldDate fallback, matching desktop AdminDashboard logic.
  // Uses full `projects` (not period-scoped) so Needs Attention matches desktop regardless of selected period.
  const stalledProjects = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return projects.filter((p) => ACTIVE_PHASES.includes(p.phase) && !p.flagged).filter((p) => {
      const threshold = PHASE_STUCK_THRESHOLDS[p.phase];
      if (threshold == null) return false;
      const phaseSince = p.phaseChangedAt ? new Date(p.phaseChangedAt) : (() => {
        if (!p.soldDate) return null;
        const [y, m, d] = p.soldDate.split('-').map(Number);
        return new Date(y, m - 1, d);
      })();
      if (!phaseSince) return false;
      const days = Math.floor((now.getTime() - phaseSince.getTime()) / 86400000);
      return days > threshold;
    });
  }, [projects]);

  // Payroll — draft/pending counts use unfiltered payrollEntries so the Needs Attention badge
  // stays consistent with flagged/stalled counts, which are also period-independent.
  // Unflagged On Hold projects — mirrors desktop AdminDashboard.tsx lines 249-252.
  const onHoldProjects = useMemo(() => projects.filter((p) => p.phase === 'On Hold' && !p.flagged), [projects]);

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
  const recentDeals = useMemo(() => [...periodProjects].filter(p => p.phase !== 'Cancelled' && p.phase !== 'On Hold').sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? '')), [periodProjects]);

  // Top reps by deal count. Uses standard competition rank so ties share
  // the same position (two reps tied at 5 deals both show "1", next rep
  // at 3 deals shows "3"). Expanded to top-5 so a 3-way tie at the top
  // doesn't hide the actual next rep off-screen.
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
    const sorted = Object.entries(repDeals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let lastCount = -1;
    let lastRank = 0;
    return sorted.map(([id, count], i) => {
      const rank = count === lastCount ? lastRank : i + 1;
      lastCount = count;
      lastRank = rank;
      const rep = reps.find((r) => r.id === id);
      return { id, name: rep?.name ?? 'Unknown', count, rank };
    });
  }, [periodProjects, reps]);

  // Installer ranking — uses period-filtered projects, matching desktop AdminDashboard
  const { installerRanking, maxInstallerDeals } = useMemo(() => {
    const map = new Map<string, { deals: number; kW: number; cancelled: number }>();
    for (const p of periodProjects) {
      const prev = map.get(p.installer) ?? { deals: 0, kW: 0, cancelled: 0 };
      prev.deals++;
      if (p.phase !== 'Cancelled' && p.phase !== 'On Hold') prev.kW += p.kWSize;
      if (p.phase === 'Cancelled') prev.cancelled++;
      map.set(p.installer, prev);
    }
    const ranking = [...map.entries()].map(([name, data]) => ({ name, ...data })).sort((a, b) => b.deals - a.deals);
    return { installerRanking: ranking, maxInstallerDeals: Math.max(1, ...ranking.map((i) => i.deals)) };
  }, [periodProjects]);

  // Cancellation reasons — all projects, all time (matching desktop)
  const { cancelledProjects, cancellationReasons } = useMemo(() => {
    const cancelled = projects.filter((p) => p.phase === 'Cancelled');
    const reasonCounts = new Map<string, number>();
    for (const p of cancelled) {
      const reason = (p as typeof p & { cancellationReason?: string }).cancellationReason || 'Not specified';
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    return {
      cancelledProjects: cancelled,
      cancellationReasons: [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [projects]);

  // ── Animated counters ────────────────────────────────────────────────────
  const animatedRevenue = useCountUp(Math.round(totalRevenue), 350);
  const animatedProfit = useCountUp(Math.round(totalProfit), 300);
  const animatedPaid = useCountUp(Math.round(totalPaid), 300);

  const needsAttention = flaggedProjects.length + draftCount + pendingCount + stalledProjects.length + onHoldProjects.length;

  // ── Skeleton while data hydrates (prevents stale-number flash) ──────────
  if (!dbReady) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <div className="h-7 w-48 rounded-lg bg-[var(--surface-pressed)] animate-skeleton" />
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shrink-0 h-10 w-24 rounded-full bg-[var(--surface-pressed)] animate-skeleton" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
        <div className="rounded-2xl p-5 bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-3">
          <div className="h-4 w-20 rounded bg-[var(--surface-pressed)] animate-skeleton" />
          <div className="h-10 w-40 rounded-lg bg-[var(--surface-pressed)] animate-skeleton" style={{ animationDelay: '80ms' }} />
          <div className="flex gap-4 mt-2">
            <div className="h-6 w-24 rounded bg-[var(--surface-pressed)] animate-skeleton" style={{ animationDelay: '140ms' }} />
            <div className="h-6 w-24 rounded bg-[var(--surface-pressed)] animate-skeleton" style={{ animationDelay: '200ms' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl p-4 bg-[var(--surface-card)] border border-[var(--border-subtle)]">
              <div className="h-3 w-12 rounded bg-[var(--surface-pressed)] animate-skeleton mb-2" style={{ animationDelay: `${i * 60}ms` }} />
              <div className="h-7 w-10 rounded bg-[var(--surface-pressed)] animate-skeleton" style={{ animationDelay: `${i * 60 + 30}ms` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-5" style={{ fontFamily: FONT_BODY }}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.15rem, 4.8vw, 1.5rem)', color: 'var(--text-primary)', lineHeight: 1.2 }}>{getGreeting(currentRepName ?? '')}</h1>
        {/* "My Rep View" toggle — only offered when the admin also sells
            (has repType). Flips into rep-view for themselves, replacing
            Glide's two-account hack. The layout's "Viewing as …" banner
            shows above and offers an Exit button back to admin view. */}
        {currentUserRepType && currentRepId && currentRepName && (
          <button
            onClick={() => setViewAsUser({ id: currentRepId, name: currentRepName, role: 'rep' })}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap"
            style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)', color: 'var(--accent-emerald-text)' }}
          >
            My Rep View
          </button>
        )}
      </div>

      {/* Period filter — shared SegmentedPills primitive. The shared
          PERIODS list labels 'all' as "<year> Cash" for rep dashboard
          (where it shows a cash-forecast hero). For admin we want lifetime
          aggregate semantics, so we override that pill's label back to
          "All Time" without forking the type. */}
      <div className="-mx-5 px-5">
        <SegmentedPills
          options={PERIODS.map((p) => ({ value: p.value, label: p.value === 'all' ? 'All Time' : p.label }))}
          value={period}
          onChange={setPeriod}
          scrollable
          ariaLabel="Filter admin dashboard by period"
        />
      </div>

      {/* ── Hero: Revenue with Profit / Paid Out ── */}
      <MobileCard hero style={{ border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)', boxShadow: 'none' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="tracking-widest uppercase" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.22em' }}>Revenue</p>
          <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent-emerald-text)' }} />
        </div>
        <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '2.5rem', color: 'var(--accent-cyan-display)', lineHeight: 1.1 }}>{fmtCompact$(animatedRevenue)}</p>
        <div key={period} className="flex items-center gap-4 mt-4" style={{ animation: 'statCellFade 280ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
          <div>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '1.25rem', color: 'var(--accent-emerald-text)' }}>{fmtCompact$(animatedProfit)}</p>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem' }}>Profit</p>
          </div>
          <div className="h-8" style={{ width: '1px', background: 'var(--border-subtle)' }} />
          <div>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: '1.25rem', color: 'var(--text-primary)' }}>{fmtCompact$(animatedPaid)}</p>
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem' }}>Paid Out</p>
          </div>
        </div>
      </MobileCard>

      {/* ── Quick stats row ──
          Premium-congruent vocabulary: every tile uses the Revenue hero
          card's eyebrow style (emerald-text 10px uppercase 0.22em) above
          a `var(--text-primary)` serif numeral. The label tells you which
          stat — no rainbow numerals. See premium-spec.md rule 4 (typography)
          and rule 6 (color palette: emerald-text accent, never a splash). */}
      <div className="grid grid-cols-2 gap-3">
        <MobileStatCard eyebrow label="Active" value={active.length} />
        <MobileStatCard eyebrow label="Reps" value={reps.filter(r => r.active !== false).length} />
        {(() => {
          const sold = formatCompactKWParts(totalKW);
          const installed = formatCompactKWParts(totalKWInstalled);
          return (
            <>
              <MobileStatCard eyebrow label={`${sold.unit} Sold`} value={sold.value} />
              <MobileStatCard eyebrow label={`${installed.unit} Installed`} value={installed.value} />
            </>
          );
        })()}
      </div>

      {/* ── Needs Attention (action-oriented) — refined card. Eyebrow
          label + serif headline + slim hairline count badge. Row text
          dropped to 13px with 14px icons for the premium scale. */}
      {needsAttention > 0 ? (
        <MobileCard>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: WARNING }} />
              <p
                className="leading-tight"
                style={{
                  fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                  fontSize: '1.05rem',
                  color: 'var(--text-primary)',
                }}
              >Needs Attention</p>
            </div>
            <span
              className="inline-flex items-center justify-center px-2 py-0.5 rounded-full tabular-nums"
              style={{
                fontFamily: FONT_BODY,
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--accent-emerald-text)',
                border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 32%, transparent)',
              }}
            >{needsAttention}</span>
          </div>

          {draftCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className={`w-full flex items-center justify-between min-h-[40px] py-1.5 text-left active:opacity-70 transition-opacity${pendingCount > 0 || flaggedProjects.length > 0 || stalledProjects.length > 0 || onHoldProjects.length > 0 ? ' border-b' : ''}`}
              style={pendingCount > 0 || flaggedProjects.length > 0 || stalledProjects.length > 0 || onHoldProjects.length > 0 ? { borderColor: 'var(--border-subtle)' } : undefined}
            >
              <div className="flex items-center gap-2.5">
                <CreditCard className="w-3.5 h-3.5" style={{ color: MUTED }} />
                <span style={{ color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '13px' }}>{draftCount} payroll drafts</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5" style={{ color: DIM }} />
            </button>
          )}

          {pendingCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className={`w-full flex items-center justify-between min-h-[40px] py-1.5 text-left active:opacity-70 transition-opacity${flaggedProjects.length > 0 || stalledProjects.length > 0 || onHoldProjects.length > 0 ? ' border-b' : ''}`}
              style={flaggedProjects.length > 0 || stalledProjects.length > 0 || onHoldProjects.length > 0 ? { borderColor: 'var(--border-subtle)' } : undefined}
            >
              <div className="flex items-center gap-2.5">
                <CreditCard className="w-3.5 h-3.5" style={{ color: 'var(--accent-amber-text)' }} />
                <span style={{ color: 'var(--accent-amber-text)', fontFamily: FONT_BODY, fontSize: '13px' }}>{pendingCount} pending &middot; {fmtCompact$(pendingTotal)}</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5" style={{ color: DIM }} />
            </button>
          )}

          {flaggedProjects.map((fp, idx) => {
            const isLastFlagged = idx === flaggedProjects.length - 1;
            const hasBorder = !isLastFlagged || stalledProjects.length > 0 || onHoldProjects.length > 0;
            return (
              <div
                key={fp.id}
                className={`w-full flex items-center gap-2 min-h-[40px] py-1.5${hasBorder ? ' border-b' : ''}`}
                style={hasBorder ? { borderColor: 'var(--border-subtle)' } : undefined}
              >
                <button
                  onClick={() => router.push(`/dashboard/projects/${fp.id}`)}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
                >
                  <Flag className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-red-text)' }} />
                  <span className="truncate" style={{ color: 'var(--accent-red-text)', fontFamily: FONT_BODY, fontSize: '13px' }}>{fp.customerName}{fp.repName ? ` · ${fp.repName}` : ''}</span>
                </button>
                <button
                  onClick={() => updateProject(fp.id, { flagged: false })}
                  className="shrink-0 px-2 py-0.5 rounded text-xs font-medium active:opacity-70 transition-opacity"
                  style={{ color: 'var(--accent-red-text)', background: 'color-mix(in srgb, var(--accent-red-solid) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 25%, transparent)' }}
                >
                  Unflag
                </button>
              </div>
            );
          })}

          {stalledProjects.map((sp, idx) => {
            const isLastStalled = idx === stalledProjects.length - 1;
            const hasBorder = !isLastStalled || onHoldProjects.length > 0;
            const phaseSince = sp.phaseChangedAt ? new Date(sp.phaseChangedAt) : (() => {
              if (!sp.soldDate) return null;
              const [y, m, d] = sp.soldDate.split('-').map(Number);
              return new Date(y, m - 1, d);
            })();
            const now = new Date(); now.setHours(0, 0, 0, 0);
            const staleDays = phaseSince ? Math.floor((now.getTime() - phaseSince.getTime()) / 86400000) : 0;
            return (
              <button
                key={sp.id}
                onClick={() => router.push(`/dashboard/projects/${sp.id}`)}
                className={`w-full flex items-center justify-between min-h-[40px] py-1.5 text-left active:opacity-70 transition-opacity${hasBorder ? ' border-b' : ''}`}
                style={hasBorder ? { borderColor: 'var(--border-subtle)' } : undefined}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: MUTED }} />
                  <span className="truncate" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '13px' }}>{sp.customerName}{sp.repName ? ` · ${sp.repName}` : ''}</span>
                </div>
                <span className="shrink-0 ml-2" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '11px' }}>{staleDays}d · {sp.phase}</span>
              </button>
            );
          })}

          {onHoldProjects.map((hp, idx) => {
            const isLastOnHold = idx === onHoldProjects.length - 1;
            const holdSince = hp.phaseChangedAt ? new Date(hp.phaseChangedAt) : (() => {
              if (!hp.soldDate) return new Date();
              const [y, m, d] = hp.soldDate.split('-').map(Number);
              return new Date(y, m - 1, d);
            })();
            const now = new Date(); now.setHours(0, 0, 0, 0);
            const holdDays = Math.floor((now.getTime() - holdSince.getTime()) / 86400000);
            return (
              <button
                key={hp.id}
                onClick={() => router.push(`/dashboard/projects/${hp.id}`)}
                className={`w-full flex items-center justify-between min-h-[40px] py-1.5 text-left active:opacity-70 transition-opacity${!isLastOnHold ? ' border-b' : ''}`}
                style={!isLastOnHold ? { borderColor: 'var(--border-subtle)' } : undefined}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <PauseCircle className="w-3.5 h-3.5 shrink-0" style={{ color: MUTED }} />
                  <span className="truncate" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '13px' }}>{hp.customerName}{hp.repName ? ` · ${hp.repName}` : ''}</span>
                </div>
                <span className="shrink-0 ml-2" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '11px' }}>{holdDays}d on hold</span>
              </button>
            );
          })}
        </MobileCard>
      ) : (
        <MobileCard>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' }}>
              <CheckCircle className="w-4 h-4" style={{ color: 'var(--accent-emerald-text)' }} />
            </div>
            <div>
              <p className="font-bold" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.9rem', margin: 0 }}>All Clear</p>
              <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.75rem', margin: 0 }}>No items need attention right now.</p>
            </div>
          </div>
        </MobileCard>
      )}

      {/* ── Pipeline snapshot ── */}
      <MobileCard>
        <p className="tracking-widest uppercase mb-4" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.22em' }}>Pipeline</p>
        <div className="space-y-2">
          {ACTIVE_PHASES.filter((phase) => (phaseCounts[phase] || 0) > 0).map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct = active.length > 0 ? (count / active.length) * 100 : 0;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{phase}</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ACCENT }} />
                </div>
                <span className="w-8 text-right tabular-nums" style={{ color: 'var(--text-primary)', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{count}</span>
              </div>
            );
          })}
        </div>
      </MobileCard>

      {/* ── Top Reps ── */}
      {topReps.length > 0 && (
        <MobileCard onTap={() => router.push('/dashboard/users')}>
          <div className="flex items-center justify-between mb-4">
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.22em' }}>Top Reps</p>
            <ChevronRight className="w-4 h-4" style={{ color: DIM }} />
          </div>
          <div className="space-y-3">
            {topReps.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    background: r.rank === 1 ? 'color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)' : r.rank === 2 ? 'color-mix(in srgb, var(--accent-cyan-solid) 14%, transparent)' : 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
                    color: r.rank === 1 ? ACCENT : r.rank === 2 ? ACCENT2 : MUTED,
                    fontFamily: FONT_DISPLAY,
                  }}
                >
                  {r.rank}
                </span>
                <span className="flex-1 text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{r.name}</span>
                <span className="font-bold tabular-nums" style={{ color: MUTED, fontFamily: FONT_DISPLAY, fontSize: '1rem' }}>{r.count} deals</span>
              </div>
            ))}
          </div>
        </MobileCard>
      )}

      {/* ── Installer Insights ── */}
      {installerRanking.length > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-4 h-4" style={{ color: WARNING }} />
            <p className="font-semibold text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>Installer Insights</p>
          </div>
          <div className="space-y-2">
            {installerRanking.map((inst) => (
              <div key={inst.name} className="flex items-center gap-2 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <span className="flex-1 text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '0.9375rem' }}>{inst.name}</span>
                <span className="tabular-nums text-sm whitespace-nowrap" style={{ color: MUTED }}>{inst.kW.toFixed(1)} kW</span>
                <div className="w-16 h-2 rounded-full mx-2" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(inst.deals / maxInstallerDeals) * 100}%`, background: WARNING }} />
                </div>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--text-primary)', fontFamily: FONT_DISPLAY, fontSize: '1rem' }}>{inst.deals}</span>
                {inst.cancelled > 0 && (
                  <span className="tabular-nums text-xs font-medium whitespace-nowrap" style={{ color: DANGER }}>({inst.cancelled} ✕)</span>
                )}
              </div>
            ))}
          </div>
        </MobileCard>
      )}

      {/* ── Cancellation Reasons ── */}
      {cancelledProjects.length > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4" style={{ color: DANGER }} />
            <p className="font-semibold text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>Cancellation Reasons</p>
            <span className="ml-auto text-xs" style={{ color: MUTED }}>{cancelledProjects.length} cancelled</span>
          </div>
          <div className="space-y-2">
            {cancellationReasons.map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{reason}</span>
                <span className="font-semibold tabular-nums text-sm" style={{ color: DANGER }}>{count}</span>
              </div>
            ))}
          </div>
        </MobileCard>
      )}

      {/* ── My Tasks (admin @mention check items) ── */}
      <MyTasksSection
        mentions={mentions}
        onToggleTask={(projectId, messageId, checkItemId, completed) =>
          fetch(`/api/projects/${projectId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkItemId, completed, completedBy: currentRepId }),
          }).then((res) => {
            if (!res.ok) throw new Error('Failed to update task');
            setMentions((prev) =>
              prev.map((m) =>
                m.messageId === messageId
                  ? { ...m, checkItems: m.checkItems.map((ci) => ci.id === checkItemId ? { ...ci, completed } : ci) }
                  : m
              )
            );
          })
        }
      />

      {/* ── Recent Deals ── */}
      <MobileCard>
        <div className="flex items-center justify-between mb-3">
          <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.22em' }}>Recent Deals</p>
          <button onClick={() => router.push('/dashboard/projects')} className="active:opacity-70 transition-opacity" style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>View all</button>
        </div>
        <input
          type="text"
          placeholder="Search customer or rep..."
          value={recentSearch}
          onChange={(e) => { setRecentSearch(e.target.value); setRecentPage(1); }}
          className="w-full mb-3 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
          style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)', border: '1px solid var(--border-subtle)' }}
        />
        {(() => {
          const searched = recentSearch.trim()
            ? recentDeals.filter((p) => {
                const q = recentSearch.trim().toLowerCase();
                return p.customerName.toLowerCase().includes(q) || (p.repName ?? '').toLowerCase().includes(q) || (p.subDealerName ?? '').toLowerCase().includes(q) || (p.setterName ?? '').toLowerCase().includes(q);
              })
            : recentDeals;
          const totalPages = Math.max(1, Math.ceil(searched.length / RECENT_PER_PAGE));
          const safePage = Math.min(recentPage, totalPages);
          const paginated = searched.slice((safePage - 1) * RECENT_PER_PAGE, safePage * RECENT_PER_PAGE);
          const showM3 = recentDeals.some((p) => (p.m3Amount ?? 0) > 0);
          return (
            <>
              {searched.length === 0 ? (
                <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>No deals found.</p>
              ) : (
                <div>
                  {paginated.map((p, i) => {
                    const coCloserPay = (p.additionalClosers ?? []).reduce((s, c) => s + c.m1Amount + c.m2Amount + (c.m3Amount ?? 0), 0);
                    const coSetterPay = (p.additionalSetters ?? []).reduce((s, c) => s + c.m1Amount + c.m2Amount + (c.m3Amount ?? 0), 0);
                    const closerPay = (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + coCloserPay;
                    const setterPay = (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) + coSetterPay;
                    const milestones = [
                      { label: 'M1', amount: p.m1Amount ?? 0, paid: p.m1Paid },
                      { label: 'M2', amount: p.m2Amount ?? 0, paid: p.m2Paid },
                      ...(showM3 ? [{ label: 'M3', amount: p.m3Amount ?? 0, paid: p.m3Paid ?? false }] : []),
                    ];
                    return (
                      <button
                        key={p.id}
                        onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                        className={`w-full text-left active:opacity-70 transition-opacity py-3 ${i < paginated.length - 1 ? 'border-b' : ''}`}
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-[var(--text-primary)] line-clamp-2 break-words flex-1" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>{p.customerName}{p.subDealerId && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-[var(--accent-amber-text)] border border-amber-500/20">Sub-Dealer</span>}</p>
                          <span className="font-semibold tabular-nums shrink-0" style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>
                            {fmt$(closerPay)}
                            {setterPay > 0 && <span style={{ color: MUTED, fontSize: '0.75rem' }}> +{fmt$(setterPay)}</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8125rem' }}>{p.repName ?? 'Unknown'} &middot; {p.kWSize} kW &middot; ${(p.netPPW ?? 0).toFixed(2)}/W</p>
                          <MobileBadge value={p.phase} size="sm" />
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {milestones.map(({ label, amount, paid }) =>
                            amount > 0 ? (
                              <span key={label} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: paid ? 'var(--accent-emerald-soft)' : 'var(--accent-amber-soft)', color: paid ? ACCENT : WARNING }}>
                                <span style={{ color: DIM }}>{label}</span>{paid ? ` ${fmt$(amount)}` : ' Unpaid'}
                              </span>
                            ) : null
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    onClick={() => setRecentPage((pg) => Math.max(1, pg - 1))}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium active:opacity-70 disabled:opacity-30 transition-opacity"
                    style={{ color: ACCENT, background: 'color-mix(in srgb, var(--accent-emerald-solid) 8%, transparent)' }}
                  >
                    ‹ Prev
                  </button>
                  <span className="text-xs" style={{ color: MUTED }}>
                    {(safePage - 1) * RECENT_PER_PAGE + 1}–{Math.min(safePage * RECENT_PER_PAGE, searched.length)} of {searched.length}
                  </span>
                  <button
                    onClick={() => setRecentPage((pg) => Math.min(totalPages, pg + 1))}
                    disabled={safePage >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium active:opacity-70 disabled:opacity-30 transition-opacity"
                    style={{ color: ACCENT, background: 'color-mix(in srgb, var(--accent-emerald-solid) 8%, transparent)' }}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </MobileCard>
    </div>
  );
}
