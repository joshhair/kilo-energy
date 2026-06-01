'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, fmtCompact$, formatCompactKWParts, localDateString } from '../../../lib/utils';
import { ACTIVE_PHASES, computeIncentiveProgress, formatIncentiveMetric } from '../../../lib/data';
import { getPhaseStuckThresholds, PERIODS, isInPeriod, isOverdue, type Period } from '../components/dashboard-utils';
import { isHistoricalPeriod, getPeriodLabel, getPeriodDaysRemaining } from '../../../lib/period';
import { sumPaid, sumPendingChargebacks, sumAddedToPipeline } from '../../../lib/aggregators';
import { computeOnPace, viewerFullCommission as viewerFullCommissionPure, computeCashForecast, viewerMilestones, viewerPipelineRemaining, computeTrainerOverridePipeline } from '../../../lib/period-projection';
import { CheckCircle, Target, Info } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBottomSheet from './shared/MobileBottomSheet';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileBadge, { PHASE_COLORS } from './shared/MobileBadge';
import MobileAdminDashboard from './MobileAdminDashboard';
import { UpcomingBlitzBanner } from '../components/UpcomingBlitzBanner';
import { SegmentedPills } from '../../../components/ui';

type MentionItem = {
  id: string;
  projectId: string;
  projectCustomerName: string;
  messageId: string;
  messageSnippet: string;
  authorName: string;
  checkItems: Array<{ id: string; text: string; completed: boolean; dueDate?: string | null }>;
  createdAt: string;
  read: boolean;
};
function getGreeting(name: string): string {
  const h = new Date().getHours();
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.split(' ')[0] || '';
  return firstName ? `${prefix}, ${firstName}` : prefix;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--accent-emerald-solid)';
const ACCENT2 = 'var(--accent-cyan-solid)';
const _ACCENT_DISP = 'var(--accent-emerald-display)';
const ACCENT2_DISP = 'var(--accent-cyan-display)';
const MUTED = 'var(--text-muted)';
const DIM = 'var(--text-dim)';
// BIG hero numbers — near-black for max readability on white in light mode.
// Brand color frames the number via the small uppercase label, not the digit.
const HERO_NUM = 'var(--text-primary)';
const DANGER = 'var(--accent-red-solid)';

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
    trainerAssignments,
    installerPayConfigs,
    incentives,
    effectiveRole,
    effectiveRepId,
    effectiveRepName,
  } = useApp();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('all');
  const [heroHelpOpen, setHeroHelpOpen] = useState(false);
  const [statVersion, setStatVersion] = useState(0);

  // Sliding indicator + scroll-into-view now live inside the shared
  // SegmentedPills primitive — no per-page refs/measure code needed.

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
            (p) =>
              p.repId === effectiveRepId ||
              p.setterId === effectiveRepId ||
              p.trainerId === effectiveRepId ||
              p.additionalClosers?.some((c) => c.userId === effectiveRepId) ||
              p.additionalSetters?.some((s) => s.userId === effectiveRepId),
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

  const attentionProjects = useMemo(
    () => myProjects.filter((p) => (ACTIVE_PHASES.includes(p.phase) && p.phase !== 'Completed') || p.phase === 'On Hold'),
    [myProjects],
  );

  const attentionItems = useMemo(() => {
    const PHASE_STUCK_THRESHOLDS = getPhaseStuckThresholds();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    type AttentionItem = { id: string; customerName: string; phase: string; soldDate: string; suffix: string };
    const items: AttentionItem[] = [];
    for (const proj of attentionProjects) {
      if (proj.flagged) {
        items.push({ id: proj.id, customerName: proj.customerName, phase: proj.phase, soldDate: proj.soldDate, suffix: 'Flagged for review' });
      }
    }
    for (const proj of attentionProjects) {
      if (proj.flagged) continue;
      const threshold = PHASE_STUCK_THRESHOLDS[proj.phase];
      if (threshold == null) continue;
      const phaseSince = proj.phaseChangedAt ? new Date(proj.phaseChangedAt) : (() => {
        if (!proj.soldDate) return null;
        const [sy, sm, sd] = proj.soldDate.split('-').map(Number);
        return new Date(sy, sm - 1, sd);
      })();
      if (!phaseSince) continue;
      const diffDays = Math.floor((today.getTime() - phaseSince.getTime()) / 86_400_000);
      if (diffDays > threshold) {
        items.push({ id: proj.id, customerName: proj.customerName, phase: proj.phase, soldDate: proj.soldDate, suffix: `${diffDays}d in ${proj.phase}` });
      }
    }
    for (const proj of attentionProjects) {
      if (proj.flagged) continue;
      if (proj.phase === 'On Hold') {
        const holdSince = proj.phaseChangedAt ? new Date(proj.phaseChangedAt) : (() => {
          if (!proj.soldDate) return today;
          const [y, m, d] = proj.soldDate.split('-').map(Number);
          return new Date(y, m - 1, d);
        })();
        const holdDays = Math.floor((today.getTime() - holdSince.getTime()) / 86_400_000);
        items.push({ id: proj.id, customerName: proj.customerName, phase: proj.phase, soldDate: proj.soldDate, suffix: `${holdDays}d on hold` });
      }
    }
    return items;
  }, [attentionProjects]);

  // PM dispatch is rendered at the end, after all hooks — see rules-of-hooks.

  // ── Rep / Sub-dealer shared data ──────────────────────────────────────────

  const todayStr = localDateString(new Date());

  const myPayroll = useMemo(
    () => payrollEntries.filter((p) => p.repId === effectiveRepId),
    [payrollEntries, effectiveRepId],
  );

  const totalPaid = useMemo(
    () => sumPaid(myPayroll, { asOf: todayStr }),
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
    () => Math.abs(sumPendingChargebacks(myPayroll)),
    [myPayroll],
  );

  const totalKW = useMemo(
    () => myProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0),
    [myProjects],
  );

  const totalKWInstalled = useMemo(
    () => myProjects.filter((p) => ['Installed', 'PTO', 'Completed'].includes(p.phase)).reduce((s, p) => s + p.kWSize, 0),
    [myProjects],
  );

  // Next payout calculation
  const nextFridayDate = useMemo(() => {
    const today = new Date();
    const d = (5 - today.getDay() + 7) % 7;
    const nf = new Date(today);
    nf.setDate(today.getDate() + d);
    return localDateString(nf);
  }, []);

  const pendingPayrollTotal = useMemo(
    () =>
      payrollEntries
        .filter(
          (p) =>
            p.repId === effectiveRepId &&
            p.date === nextFridayDate &&
            p.status === 'Pending',
        )
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, nextFridayDate],
  );

  const daysUntilPayday = useMemo(() => {
    const today = new Date();
    return (5 - today.getDay() + 7) % 7;
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

  const myIncentives = useMemo(
    () => incentives.filter(
      (i) => i.active && (i.type === 'company' || (i.type === 'personal' && i.targetRepId === effectiveRepId))
    ),
    [incentives, effectiveRepId],
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

  // Net paid-out (includes chargebacks). Matches the payroll tab's combined
  // total + the desktop dashboard, so the two views agree.
  const periodPaid = useMemo(
    () => sumPaid(periodPayroll),
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

  // Historical-period metrics — meaningful only when looking back at a
  // closed period. "Added to pipeline" answers *"what did I produce in
  // that window?"* (different question than periodPaid which is *"what
  // did I get paid in that window?"*). "Deals closed" is the count of
  // non-cancelled deals SUBMITTED in the period — same shape, useful
  // for "I had a strong month" framing.
  //
  // These are computed unconditionally so the count-up animations can
  // smoothly transition when the rep switches periods. Render gates
  // below decide whether to display them.
  const periodAddedToPipeline = useMemo(
    () => sumAddedToPipeline(myProjects, effectiveRepId, (d) => isInPeriod(d, period)),
    [myProjects, effectiveRepId, period],
  );
  const periodDealsClosed = useMemo(
    () => periodProjects.filter((p) => p.phase !== 'Cancelled').length,
    [periodProjects],
  );

  // Pipeline: base (unpaid M1+M2+M3 on active projects, role-aware) plus
  // trainer-override pipeline. Both come from shared helpers in
  // lib/period-projection so Dashboard and My Pay surfaces stay in lockstep.
  // The breakdown rows (M1/M2/M3) shown on My Pay sum to `base` only — the
  // override sits on the headline as a single fold-in (per-trainee detail
  // lives on the dedicated Trainer tab).
  const pipelineValue = useMemo(
    () => {
      const base = viewerPipelineRemaining(activeProjects, effectiveRepId, myPayroll, todayStr).total;
      const trainerOverride = computeTrainerOverridePipeline({
        trainerAssignments,
        projects,
        payroll: myPayroll,
        installerPayConfigs,
        repId: effectiveRepId,
        today: todayStr,
      });
      return base + trainerOverride;
    },
    [activeProjects, effectiveRepId, trainerAssignments, projects, installerPayConfigs, myPayroll, todayStr],
  );

  // On Pace ingredients — dealsPerMonth, the rep's full-deal earning
  // rate (M1+M2+M3 per deal × deals/mo), and a viewer-aware commission
  // resolver. The projection formula uses these to compute:
  //
  //   OnPace(P) = commissionEarnedFromInPeriodDeals + paceRate × monthsRemainingInP
  //
  // where "commissionEarnedFromInPeriodDeals" sums full M1+M2+M3
  // commission for deals sold inside the period (credited at face
  // value the moment the deal is sold, regardless of when each
  // milestone actually fires) and paceRate × monthsRemainingInP is
  // the forward-looking selling contribution.
  const viewerFullCommission = useCallback(
    (p: typeof myProjects[number]) => viewerFullCommissionPure(p, effectiveRepId),
    [effectiveRepId],
  );

  const { dealsPerMonth: paceDPM, paceRate } = useMemo(() => {
    const now = new Date();
    const allMyProjects = myProjects.filter((p) => p.phase !== 'Cancelled');
    const totalDeals = allMyProjects.length;
    if (totalDeals === 0) return { dealsPerMonth: 0, paceRate: 0 };

    // Average full commission per deal (M1 + M2 + M3), role-aware.
    const avgFullCommissionPerDeal = allMyProjects.reduce(
      (s, p) => s + viewerFullCommission(p),
      0,
    ) / totalDeals;

    // Deal closing pace. effectiveDays floor of 30 prevents a brand-new
    // rep's "1 deal in 3 days" from extrapolating to 10 deals/mo.
    const sorted = [...allMyProjects].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const firstDealDate = new Date(sorted[0].soldDate + 'T12:00:00');
    const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / 86400000, 1);
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;

    // paceRate = full commission earned per month at current cadence.
    // Pure pace — no blending with actual-paid (milestone lag would
    // systematically under-project new reps). Used directly in
    // OnPace(P) = commissionEarnedFromInPeriodDeals + paceRate × monthsLeft.
    const paceRate = dealsPerMonth * avgFullCommissionPerDeal;

    return { dealsPerMonth, paceRate };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeProjects reports as unnecessary but it's a reference the memo must invalidate on
  }, [myProjects, viewerFullCommission, activeProjects]);

  // ── Animated counters (rep layout) ───────────────────────────────────────

  // Period-scoped on-pace projection. Consistent formula for this-month,
  // this-quarter, AND this-year:
  //   projection = paidInPeriod + rate × (daysRemaining/30.44) + phaseBoost
  // where phaseBoost is the phase-weighted pipeline contribution scaled
  // to the horizon (computePhaseWeightedBoost handles the weighting).
  //
  // Hero on-pace value — single formula for every forward-looking period:
  //   OnPace = commissionEarnedFromInPeriodDeals + paceRate × monthsRemainingInP
  // - commissionEarnedFromInPeriodDeals: deals SOLD inside the period
  //   credited at full M1+M2+M3 value (the deal's earning the moment
  //   it's sold, regardless of when milestones pay out).
  // - paceRate × monthsRemainingInP: forward-looking selling at current
  //   cadence. Calendar-aware: an October starter sees ~2 months of
  //   forward credit for "This Year" rather than the full 12.
  // All Time uses the same calendar-bounded year horizon as This Year so
  // toggling between them produces an identical hero number.
  const inPeriodCommissionEarned = useMemo(() => {
    const horizonPeriod = period === 'all' ? 'this-year' : period;
    return myProjects
      .filter((p) => p.phase !== 'Cancelled' && isInPeriod(p.soldDate, horizonPeriod))
      .reduce((s, p) => s + viewerFullCommission(p), 0);
  }, [myProjects, viewerFullCommission, period]);

  const daysRemainingInPeriod = useMemo(() => {
    const horizonPeriod = period === 'all' ? 'this-year' : period;
    return getPeriodDaysRemaining(horizonPeriod) ?? 0;
  }, [period]);

  const monthsRemainingInPeriod = daysRemainingInPeriod / 30.44;

  const onPacePeriod = useMemo(
    () => computeOnPace({ inPeriodCommissionEarned, paceRate, daysRemainingInPeriod }),
    [inPeriodCommissionEarned, paceRate, daysRemainingInPeriod],
  );

  // 2026 Cash Forecast — rendered when `period === 'all'`. Dates each
  // pending milestone by phase ETA + lag, sums those landing by Dec 31,
  // plus future-sales milestones at current pace, plus paidYTD.
  const yearToDatePaid = useMemo(
    () => sumPaid(myPayroll.filter((p) => isInPeriod(p.date, 'this-year'))),
    [myPayroll],
  );
  const avgMilestones = useMemo(() => {
    const allMy = myProjects.filter((p) => p.phase !== 'Cancelled');
    if (allMy.length === 0) return { avgM1: 0, avgM2: 0, avgM3: 0 };
    let m1Sum = 0, m2Sum = 0, m3Sum = 0;
    for (const p of allMy) {
      const m = viewerMilestones(p, effectiveRepId);
      m1Sum += m.m1; m2Sum += m.m2; m3Sum += m.m3;
    }
    return { avgM1: m1Sum / allMy.length, avgM2: m2Sum / allMy.length, avgM3: m3Sum / allMy.length };
  }, [myProjects, effectiveRepId]);

  const dealsPerMonth = paceRate && avgMilestones.avgM1 + avgMilestones.avgM2 + avgMilestones.avgM3 > 0
    ? paceRate / (avgMilestones.avgM1 + avgMilestones.avgM2 + avgMilestones.avgM3)
    : 0;

  const cashForecast = useMemo(
    () => computeCashForecast({
      projects: myProjects,
      repId: effectiveRepId,
      dealsPerMonth,
      avgM1: avgMilestones.avgM1,
      avgM2: avgMilestones.avgM2,
      avgM3: avgMilestones.avgM3,
      paidYTD: yearToDatePaid,
    }),
    [myProjects, effectiveRepId, dealsPerMonth, avgMilestones, yearToDatePaid],
  );

  // Period category decides which hero variant + which stats render.
  // Historical = backward-looking ("what did I earn / produce?");
  // current/all = forward-looking ("on pace for?"). This is the user-
  // visible fix for the "on pace number doesn't change when I switch
  // periods" wart — the cards are now period-aware.
  const isHistorical = isHistoricalPeriod(period);

  // Single source of truth for the on-pace big-number. onPacePeriod now
  // handles every forward-looking period including 'all' (which maps to
  // the same year-end horizon as 'this-year' so the two reconcile under
  // their shared "On Pace For YYYY" label). 0 in historical.
  const heroOnPaceValue = isHistorical ? 0 : onPacePeriod;

  const animatedOnPace = useCountUp(heroOnPaceValue, 350);
  const animatedPayout = useCountUp(pendingPayrollTotal, 300);
  const animatedPaid = useCountUp(periodPaid, 300);
  const animatedYearToDatePaid = useCountUp(yearToDatePaid, 300);
  const animatedPipeline = useCountUp(pipelineValue, 300);
  const animatedAddedToPipeline = useCountUp(periodAddedToPipeline, 300);
  const animatedDealsClosed = useCountUp(periodDealsClosed, 300);

  // Hero label + subtitle + breakdown for the forward-looking variant.
  // Pulled into one shape so the JSX stays readable. The breakdown line
  // exposes the three components of the projection (paid + pace +
  // pipeline boost) so reps can mentally verify the math — addresses the
  // "why is this number what it is?" question proactively.
  const heroOnPaceCopy = useMemo(() => {
    const isYearLike = period === 'all' || period === 'this-year';
    const paceComponent = Math.round(paceRate * monthsRemainingInPeriod);
    return {
      label: isYearLike ? `On Pace For ${new Date().getFullYear()}` : `On Pace · ${getPeriodLabel(period)}`,
      dealsPerMonth: paceDPM.toFixed(1),
      breakdown: {
        paid: Math.round(inPeriodCommissionEarned),
        pace: paceComponent,
      },
    };
  }, [period, paceDPM, paceRate, inPeriodCommissionEarned, monthsRemainingInPeriod]);

  // ── @mentions / My Tasks (fetched for rep + sub-dealer) ──────────────────
  const [dashMentions, setDashMentions] = useState<MentionItem[]>([]);
  const fetchMentions = useCallback(() => {
    if (!effectiveRepId) return;
    fetch(`/api/mentions?userId=${encodeURIComponent(effectiveRepId)}`)
      .then((res) => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((rawMentions: unknown[]) => {
        const items: MentionItem[] = (rawMentions ?? []).map((raw) => {
          const m = raw as {
            id: string; messageId?: string;
            message?: { id?: string; projectId?: string; project?: { customerName?: string }; text?: string; authorName?: string; checkItems?: Array<{ id: string; text: string; completed: boolean }> };
          };
          return {
            id: m.id,
            projectId: m.message?.projectId ?? '',
            projectCustomerName: m.message?.project?.customerName ?? 'Unknown',
            messageId: m.messageId ?? m.message?.id ?? '',
            messageSnippet: (m.message?.text ?? '').slice(0, 120),
            authorName: m.message?.authorName ?? 'Unknown',
            checkItems: (m.message?.checkItems ?? []).map((ci) => ({
              id: ci.id, text: ci.text, completed: ci.completed,
              dueDate: (ci as { dueDate?: string | null }).dueDate ?? null,
            })),
            createdAt: (m.message as { createdAt?: string } | undefined)?.createdAt ?? new Date().toISOString(),
            read: (raw as { readAt?: string | null }).readAt != null,
          };
        });
        setDashMentions(items);
      })
      .catch(() => setDashMentions([]));
  }, [effectiveRepId]);
  useEffect(() => { fetchMentions(); }, [fetchMentions]);

  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());

  const mobileTasks = useMemo(() => {
    const tasks: Array<{ checkItemId: string; text: string; projectId: string; projectName: string; messageId: string; authorName: string; createdAt: string; dueDate?: string | null }> = [];
    for (const mention of dashMentions) {
      for (const ci of mention.checkItems) {
        if (!ci.completed && !checkedTaskIds.has(ci.id)) {
          tasks.push({ checkItemId: ci.id, text: ci.text, projectId: mention.projectId, projectName: mention.projectCustomerName, messageId: mention.messageId, authorName: mention.authorName, createdAt: mention.createdAt, dueDate: ci.dueDate });
        }
      }
    }
    tasks.sort((a, b) => {
      const aHasDue = !!a.dueDate;
      const bHasDue = !!b.dueDate;
      if (aHasDue && !bHasDue) return -1;
      if (!aHasDue && bHasDue) return 1;
      if (aHasDue && bHasDue) {
        const aOverdue = isOverdue(a.dueDate!);
        const bOverdue = isOverdue(b.dueDate!);
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        return new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return tasks;
  }, [dashMentions, checkedTaskIds]);
  const handleToggleTask = useCallback(async (projectId: string, messageId: string, checkItemId: string, wasChecked: boolean) => {
    setCheckedTaskIds((prev) => { const next = new Set(prev); if (wasChecked) { next.delete(checkItemId); } else { next.add(checkItemId); } return next; });
    try {
      await fetch(`/api/projects/${projectId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkItemId, completed: !wasChecked, completedBy: effectiveRepId }),
      });
    } catch {
      setCheckedTaskIds((prev) => { const next = new Set(prev); if (wasChecked) { next.add(checkItemId); } else { next.delete(checkItemId); } return next; });
    }
  }, [effectiveRepId]);

  // ── Admin dispatch (after all hooks — rules-of-hooks) ─────────────────────
  if (effectiveRole === 'admin') return <MobileAdminDashboard />;

  // ── Sub-dealer dispatch (after all hooks) ─────────────────────────────────
  if (effectiveRole === 'sub-dealer') {
    return (
      <div className="px-5 pt-4 pb-28 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="Dashboard" />

        {/* Hero — next payout */}
        <MobileCard hero>
          <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
          <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: ACCENT, lineHeight: 1.1 }}>{fmt$(pendingPayrollTotal)}</p>
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem', marginTop: '0.5rem' }}>{daysUntilPayday === 0 ? 'Today' : `${nextFridayLabel} \u00b7 ${daysUntilPayday} days`}</p>
          <div className="mt-3 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, ((7 - daysUntilPayday) / 7) * 100))}%`, background: ACCENT }} />
          </div>
        </MobileCard>

        {/* Stat grid — 2x2, +1 conditional chargeback tile when owed.
            When period === 'all' the page is the 2026 Cash Forecast view —
            the Paid tile shows YTD (matches the forecast's framing). For
            historical periods the period-Earned hero already shows
            period-paid, so this tile stays on lifetime as supplementary
            context. */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard
            label={period === 'all' ? `Paid in ${new Date().getFullYear()}` : 'Paid'}
            value={fmt$(period === 'all' ? yearToDatePaid : totalPaid)}
            color={ACCENT}
          />
          <MobileStatCard label="In Pipeline" value={fmt$(pipelineValue)} color={ACCENT2} />
          {(() => {
            const sold = formatCompactKWParts(totalKW);
            const installed = formatCompactKWParts(totalKWInstalled);
            return (
              <>
                <MobileStatCard label={`${sold.unit} Sold`} value={sold.value} color="var(--text-primary)" />
                <MobileStatCard label={`${installed.unit} Installed`} value={installed.value} color="var(--text-primary)" />
              </>
            );
          })()}
          {outstandingChargebacks.length > 0 && (
            <MobileStatCard
              label="Chargebacks"
              value={fmt$(totalChargebacks)}
              color={DANGER}
            />
          )}
        </div>

        {/* My Tasks */}
        {mobileTasks.length > 0 && (
          <MobileSection title="My Tasks" collapsible count={mobileTasks.length}>
            <MobileCard>
              {mobileTasks.map((task, i, arr) => (
                <div key={task.checkItemId} className={`flex items-start gap-3 py-3 ${i < arr.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--border-subtle)' }}>
                  <input type="checkbox" checked={checkedTaskIds.has(task.checkItemId)} onChange={() => handleToggleTask(task.projectId, task.messageId, task.checkItemId, checkedTaskIds.has(task.checkItemId))} className="mt-1 w-5 h-5 rounded cursor-pointer flex-shrink-0" style={{ accentColor: ACCENT }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1rem', fontWeight: 500 }}>{task.text}</p>
                    <button onClick={() => router.push(`/dashboard/projects/${task.projectId}`)} className="text-left" style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{task.projectName}</button>
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>from {task.authorName}</p>
                  </div>
                </div>
              ))}
            </MobileCard>
          </MobileSection>
        )}

        {/* Recent */}
        <MobileSection title="Recent">
          {recentProjects.length === 0 ? (
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem' }}>No projects yet.</p>
          ) : (
            <div className="space-y-2">
              {recentProjects.map((p) => {
                const accent = PHASE_COLORS[p.phase]?.text ?? 'var(--text-muted)';
                return (
                  <button
                    key={p.id}
                    onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                    className="w-full flex items-stretch rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform duration-150"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="shrink-0" style={{ width: 4, background: accent }} />
                    <div className="flex-1 min-w-0 px-4 py-3">
                      <p className="text-[var(--text-primary)] font-semibold line-clamp-2 break-words" style={{ fontFamily: FONT_BODY, fontSize: '1.05rem' }}>{p.customerName}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <MobileBadge value={p.phase} size="sm" />
                        <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{relativeTime(p.soldDate)}</span>
                      </div>
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
      <div className="px-5 pt-4 pb-28 space-y-5" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="Dashboard" />

        {/* Stat grid — 2x2 */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Active Projects" value={activeProjects.length} color={ACCENT} />
          <MobileStatCard label="Total Projects" value={myProjects.length} color="var(--text-primary)" />
          {(() => { const t = formatCompactKWParts(totalKWPm); return (<MobileStatCard label={`Total ${t.unit}`} value={t.value} color={ACCENT2} />); })()}
          <MobileStatCard label="Flagged" value={flaggedProjects.length} color={flaggedProjects.length > 0 ? DANGER : 'var(--text-primary)'} />
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
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
                    </div>
                    <span className="w-8 text-right tabular-nums" style={{ color: 'var(--text-primary)', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{count}</span>
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
                  className={`w-full min-h-[48px] py-3 text-left active:scale-[0.97] active:opacity-80 transition-[transform,opacity] duration-150 ${i < flaggedProjects.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--border-subtle)', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 shrink-0" style={{ color: ACCENT }} />
                    <p className="font-semibold text-[var(--text-primary)] line-clamp-2 break-words flex-1 min-w-0" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-6">
                    <MobileBadge value={p.phase} size="sm" />
                    <span className="truncate" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem' }}>{stalledDays(p.phaseChangedAt ?? p.soldDate) !== null ? `Stalled ${stalledDays(p.phaseChangedAt ?? p.soldDate)}d` : '—'}</span>
                  </div>
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
                    className={`w-full min-h-[48px] py-3 text-left active:scale-[0.97] active:opacity-80 transition-[transform,opacity] duration-150 ${i < arr.length - 1 ? 'border-b' : ''}`}
                    style={{ borderColor: 'var(--border-subtle)', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <p className="text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <MobileBadge value={p.phase} size="sm" />
                      <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem' }}>{relativeTime(p.soldDate)}</span>
                    </div>
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
    <div className="px-5 pt-4 pb-28 space-y-5" style={{ fontFamily: FONT_BODY }}>
      {/* Greeting */}
      <h1 className="truncate" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.15rem, 4.8vw, 1.5rem)', color: 'var(--text-primary)', lineHeight: 1.2 }}>{getGreeting(effectiveRepName ?? '')}</h1>

      {/* Upcoming blitz banner — surfaces the soonest upcoming blitz the
          rep can see (within 7 days). Auto-hides when nothing qualifies.
          Visual weight scales with proximity. */}
      <UpcomingBlitzBanner variant="mobile" />

      {/* Period filter — shared SegmentedPills primitive */}
      <div className="-mx-5 px-5">
        <SegmentedPills
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          value={period}
          onChange={setPeriod}
          scrollable
          ariaLabel="Filter dashboard by period"
        />
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
        <div key={period} className="hero-content-enter">
        {period === 'all' && cashForecast.total > 0 ? (
          // ─── 2026 Cash Forecast variant ───────────────────────────────
          // Default landing view. Sums milestones that will actually fire
          // by Dec 31 (M1=+14d, M2=+45d, M3=+80d from sold) across:
          //   - existing in-flight deals
          //   - projected new sales at current pace
          //   - cash already paid YTD
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="tracking-widest uppercase" style={{ color: ACCENT2_DISP, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.12em' }}>
                {new Date().getFullYear()} Cash Forecast
              </p>
              <button
                type="button"
                onClick={() => setHeroHelpOpen(true)}
                aria-label="How is this number calculated?"
                className="active:opacity-60 transition-opacity"
                style={{ color: 'var(--text-dim)', lineHeight: 0 }}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.1 }}>
              {fmt$(cashForecast.total)}
            </p>
            <p className="tabular-nums truncate" style={{ color: 'var(--text-dim)', fontFamily: FONT_BODY, fontSize: '0.72rem', letterSpacing: '0.01em', marginTop: '0.45rem' }}>
              {fmtCompact$(cashForecast.pipeline)} pipe + {fmtCompact$(cashForecast.futureSales)} new{cashForecast.paid > 0 ? ` + ${fmtCompact$(cashForecast.paid)} paid` : ''}
            </p>
            {/* Next Payout — secondary. Hidden when nothing pending. */}
            {pendingPayrollTotal > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex items-baseline justify-between">
                  <p className="tracking-widest uppercase" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.22em' }}>Next Payout</p>
                  <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem' }}>{daysUntilPayday === 0 ? <span style={{ color: 'var(--text-primary)' }}>Today</span> : <>{nextFridayLabel} &middot; <span style={{ color: 'var(--text-primary)' }}>{daysUntilPayday}d</span></>}</p>
                </div>
                <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.75rem, 8vw, 2.25rem)', color: HERO_NUM, lineHeight: 1.3 }}>{fmt$(animatedPayout)}</p>
              </div>
            )}
          </div>
        ) : isHistorical ? (
          // ─── Historical period variant ────────────────────────────────
          // Backward-looking: "what did I earn in that window?" rather than
          // "what am I on pace for?". Subtitle adds the production context
          // (deals closed + value added to pipeline) but is SUPPRESSED for
          // empty periods (new reps looking back at a window before they
          // joined) — showing "0 deals · added $0 to pipeline" reads as
          // demoralizing system noise, not data.
          <div>
            <p className="tracking-widest uppercase" style={{ color: ACCENT2_DISP, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', letterSpacing: '0.12em' }}>
              Earned · {getPeriodLabel(period)}
            </p>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.1 }}>
              {fmt$(animatedPaid)}
            </p>
            {(periodDealsClosed > 0 || periodAddedToPipeline > 0) && (
              <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem', marginTop: '0.35rem' }}>
                {periodDealsClosed} deal{periodDealsClosed === 1 ? '' : 's'} · added {fmtCompact$(animatedAddedToPipeline)} to pipeline
              </p>
            )}
            {/* Next Payout — secondary. Hidden when nothing pending. */}
            {pendingPayrollTotal > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex items-baseline justify-between">
                  <p className="tracking-widest uppercase" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.22em' }}>Next Payout</p>
                  <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem' }}>{daysUntilPayday === 0 ? <span style={{ color: 'var(--text-primary)' }}>Today</span> : <>{nextFridayLabel} &middot; <span style={{ color: 'var(--text-primary)' }}>{daysUntilPayday}d</span></>}</p>
                </div>
                <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.75rem, 8vw, 2.25rem)', color: HERO_NUM, lineHeight: 1.3 }}>{fmt$(animatedPayout)}</p>
              </div>
            )}
          </div>
        ) : heroOnPaceValue > 0 ? (
          // ─── Current / all-time variant (forward-looking) ─────────────
          // Label + subtitle adapt by period (see heroOnPaceCopy memo):
          //   all / this-year     → "On Pace For 2026" + "Based on X deals/mo"
          //   this-month/quarter  → "On Pace · This Month" + "X days left · ..."
          // The big number adapts too (heroOnPaceValue): annual for the
          // long horizons, period-scoped for this-month / this-quarter.
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="tracking-widest uppercase" style={{ color: ACCENT2_DISP, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.12em' }}>{heroOnPaceCopy.label}</p>
              <button
                type="button"
                onClick={() => setHeroHelpOpen(true)}
                aria-label="How is this number calculated?"
                className="active:opacity-60 transition-opacity"
                style={{ color: 'var(--text-dim)', lineHeight: 0 }}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.1 }}>{fmt$(animatedOnPace)}</p>
            {/* Two-line breakdown — formula on top, rate context below */}
            {heroOnPaceCopy.breakdown && (
              <div style={{ marginTop: '0.45rem' }}>
                <p className="tabular-nums whitespace-nowrap" style={{ color: 'var(--text-dim)', fontFamily: FONT_BODY, fontSize: '0.78rem', letterSpacing: '0.01em' }}>
                  {fmtCompact$(heroOnPaceCopy.breakdown.paid)} earned + {fmtCompact$(heroOnPaceCopy.breakdown.pace)} pace
                </p>
                <p className="tabular-nums whitespace-nowrap" style={{ color: 'var(--text-dim)', fontFamily: FONT_BODY, fontSize: '0.72rem', letterSpacing: '0.01em', marginTop: '0.15rem', opacity: 0.75 }}>
                  {heroOnPaceCopy.dealsPerMonth} deals/mo pace
                </p>
              </div>
            )}
            {/* Next Payout — secondary. Hidden when nothing pending. */}
            {pendingPayrollTotal > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex items-baseline justify-between">
                  <p className="tracking-widest uppercase" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.22em' }}>Next Payout</p>
                  <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem' }}>{daysUntilPayday === 0 ? <span style={{ color: 'var(--text-primary)' }}>Today</span> : <>{nextFridayLabel} &middot; <span style={{ color: 'var(--text-primary)' }}>{daysUntilPayday}d</span></>}</p>
                </div>
                <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.75rem, 8vw, 2.25rem)', color: HERO_NUM, lineHeight: 1.3 }}>{fmt$(animatedPayout)}</p>
              </div>
            )}
          </div>
        ) : pendingPayrollTotal > 0 ? (
          <div>
            <p className="tracking-widest uppercase" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', letterSpacing: '0.22em' }}>Next Payout</p>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.1 }}>{fmt$(animatedPayout)}</p>
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem', marginTop: '0.5rem' }}>{daysUntilPayday === 0 ? <span style={{ color: 'var(--text-primary)' }}>Today</span> : <>{nextFridayLabel} &middot; <span style={{ color: 'var(--text-primary)' }}>{daysUntilPayday} days</span></>}</p>
          </div>
        ) : (
          <div>
            <p className="tracking-widest uppercase" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', letterSpacing: '0.22em' }}>Welcome</p>
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem', lineHeight: 1.4 }}>Sell your first deal to see your earning projection here.</p>
          </div>
        )}
        </div>

        {/* Stats inside hero card. Paid cell semantics:
            - period === 'all' (2026 Cash Forecast hero): YTD paid only, label
              clarifies the year so the digit reads as cash received in this
              forecast window — not lifetime, which mismatches the hero's framing.
            - Other periods: periodPaid (already period-filtered by animatedPaid).
            Bug history: this used `animatedPaid` (= periodPaid, which collapses
            to lifetime when period='all') for the 'all' case, causing Hunter's
            tile to read $275K and Josh's to read $394K while the hero's
            'paid' breakdown correctly showed YTD. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div key={`paid-${statVersion}`} className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 0ms both', willChange: 'transform, opacity' }}>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: 'var(--accent-emerald-text)', lineHeight: 1.15 }}>{fmtCompact$(period === 'all' ? animatedYearToDatePaid : animatedPaid)}</p>
            <p className="tracking-wide uppercase whitespace-nowrap" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>{period === 'all' ? `Paid in ${new Date().getFullYear()}` : 'Paid'}</p>
          </div>
          {/* Pipeline cell — period-adaptive. Refined cyan-text accent
              differentiates "in-flight" pipeline value from the locked-
              in "paid" emerald, while staying within the muted-text
              vocabulary (no neon). */}
          <div key={`pipe-${statVersion}`} className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both', willChange: 'transform, opacity' }}>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: 'var(--accent-cyan-text)', lineHeight: 1.15 }}>
              {fmtCompact$(isHistorical ? animatedAddedToPipeline : animatedPipeline)}
            </p>
            <p className="tracking-wide uppercase whitespace-nowrap" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>
              {isHistorical ? 'Pipeline Added' : 'Pipeline'}
            </p>
          </div>
          {(() => { const t = formatCompactKWParts(periodKW); return (
            <div key={`kw-${statVersion}`} className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both', willChange: 'transform, opacity' }}>
              <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: 'var(--text-primary)', lineHeight: 1.15 }}>{t.value}</p>
              <p className="tracking-wide uppercase whitespace-nowrap" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>{t.unit} Sold</p>
            </div>
          ); })()}
          {/* Active / Deals Closed cell — current shows pipeline activity
              right now; historical shows total non-cancelled deals
              submitted in the period (matches the hero subtitle). */}
          <div key={`active-${statVersion}`} className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 180ms both', willChange: 'transform, opacity' }}>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: 'var(--text-primary)', lineHeight: 1.15 }}>
              {isHistorical ? animatedDealsClosed : periodActive.length}
            </p>
            <p className="tracking-wide uppercase whitespace-nowrap" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>
              {isHistorical ? 'Deals' : 'Active'}
            </p>
          </div>
        </div>
      </MobileCard>

      {/* Needs Attention — hidden if 0 */}
      {attentionItems.length > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5" style={{ color: ACCENT }} />
            <p className="font-semibold text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>Needs Attention</p>
            <span className="ml-auto font-bold px-2 py-0.5 rounded-full text-xs" style={{ background: 'transparent', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)', color: 'var(--accent-emerald-text)', fontFamily: FONT_DISPLAY }}>{attentionItems.length}</span>
          </div>
          {attentionItems.map((item, i) => (
            <button
              key={item.id}
              onClick={() => router.push(`/dashboard/projects/${item.id}`)}
              className={`w-full min-h-[48px] py-3 text-left active:scale-[0.97] active:opacity-80 transition-[transform,opacity] duration-150 mobile-list-item ${i < attentionItems.length - 1 ? 'border-b' : ''}`}
              style={{ borderColor: 'var(--border-subtle)', animationDelay: `${i * 45}ms`, transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            >
              {/* Stacked layout — badge + duration-in-phase stayed in the
                  same horizontal band as the customer name before, which
                  caused visual collisions on narrow screens (badge pill
                  sitting under the grey "Xd in Phase" text). 2026-04-23. */}
              <p className="font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{item.customerName}</p>
              <div className="flex items-center gap-2 mt-1">
                <MobileBadge value={item.phase} size="sm" />
                <span className="truncate" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem' }}>{item.suffix}</span>
              </div>
            </button>
          ))}
        </MobileCard>
      )}

      {/* My Tasks */}
      {mobileTasks.length > 0 && (
        <MobileSection title="My Tasks" collapsible count={mobileTasks.length}>
          <MobileCard>
            {mobileTasks.map((task, i, arr) => (
              <div key={task.checkItemId} className={`flex items-start gap-3 py-3 ${i < arr.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--border-subtle)' }}>
                <input type="checkbox" checked={checkedTaskIds.has(task.checkItemId)} onChange={() => handleToggleTask(task.projectId, task.messageId, task.checkItemId, checkedTaskIds.has(task.checkItemId))} className="mt-1 w-5 h-5 rounded cursor-pointer flex-shrink-0" style={{ accentColor: ACCENT }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1rem', fontWeight: 500 }}>{task.text}</p>
                  <button onClick={() => router.push(`/dashboard/projects/${task.projectId}`)} className="text-left" style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{task.projectName}</button>
                  <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>from {task.authorName}</p>
                </div>
              </div>
            ))}
          </MobileCard>
        </MobileSection>
      )}

      {/* Incentives */}
      {myIncentives.length > 0 && (
        <MobileSection title="Active Incentives" collapsible count={myIncentives.length}>
          <div className="space-y-2">
            {myIncentives.map((incentive) => {
              const progress = computeIncentiveProgress(incentive, projects, payrollEntries);
              const topMilestone = [...incentive.milestones].sort((a, b) => b.threshold - a.threshold)[0];
              const pct = topMilestone ? Math.min(100, (progress / topMilestone.threshold) * 100) : 0;
              const nextMilestone = incentive.milestones
                .filter((m) => !m.achieved && m.threshold > progress)
                .sort((a, b) => a.threshold - b.threshold)[0];
              return (
                <MobileCard key={incentive.id}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="p-1.5 rounded-lg shrink-0" style={{ background: 'transparent', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)' }}>
                        <Target className="w-4 h-4" style={{ color: 'var(--accent-emerald-solid)' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium line-clamp-1" style={{ color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '1rem' }}>{incentive.title}</p>
                        {incentive.type === 'personal' && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'transparent', border: '1px solid color-mix(in srgb, var(--accent-purple-solid) 35%, transparent)', color: 'var(--accent-purple-text)' }}>Personal</span>
                        )}
                      </div>
                    </div>
                    <p className="font-medium shrink-0 ml-2 tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: FONT_BODY, fontSize: '0.9rem' }}>{formatIncentiveMetric(incentive.metric, progress)}</p>
                  </div>
                  <div className="w-full rounded-full h-1.5 mb-1.5" style={{ background: 'color-mix(in srgb, var(--text-primary) 10%, transparent)' }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? 'var(--accent-amber-solid)' : 'var(--accent-emerald-solid)',
                      }}
                    />
                  </div>
                  {nextMilestone && (
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>
                      Next: {nextMilestone.reward} at {formatIncentiveMetric(incentive.metric, nextMilestone.threshold)}
                    </p>
                  )}
                </MobileCard>
              );
            })}
          </div>
        </MobileSection>
      )}

      {/* Recent */}
      {recentProjects.length > 0 && (
        <MobileSection title="Recent">
          <div className="space-y-2">
            {recentProjects.map((p, i) => {
              const accent = PHASE_COLORS[p.phase]?.text ?? 'var(--text-muted)';
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className="w-full flex items-stretch rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform duration-150 mobile-list-item"
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-default)',
                    animationDelay: `${i * 45}ms`,
                    transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  {/* Phase-colored accent strip — scan by color. */}
                  <div className="shrink-0" style={{ width: 4, background: accent }} />
                  {/* Stacked layout — name on line 1 (full width, truncates
                      gracefully), badge + time on line 2. Previously the
                      single-row layout forced customer names like "Trevor
                      Schauwecker" to clip to 4 chars whenever the badge
                      was wide ("Pending Install"). 2026-04-23. */}
                  <div className="flex-1 min-w-0 px-4 py-3">
                    <p className="text-[var(--text-primary)] font-semibold line-clamp-2 break-words" style={{ fontFamily: FONT_BODY, fontSize: '1.05rem' }}>{p.customerName}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <MobileBadge value={p.phase} size="sm" />
                      <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{relativeTime(p.soldDate)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </MobileSection>
      )}

      {/* Hero help — tap-to-explain bottom sheet for the on-pace / cash forecast math. */}
      <MobileBottomSheet open={heroHelpOpen} onClose={() => setHeroHelpOpen(false)} title="How this number is calculated">
        <div className="px-5 pb-6 space-y-4" style={{ fontFamily: FONT_BODY, color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.55 }}>
          {period === 'all' ? (
            <>
              <p><strong style={{ color: 'var(--text-primary)' }}>{new Date().getFullYear()} Cash Forecast</strong> estimates the actual cash that will hit your bank account between today and Dec 31.</p>
              <p>It adds three buckets:</p>
              <ul className="space-y-2" style={{ paddingLeft: '1.2rem', listStyleType: 'disc' }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Pipeline</strong> — milestones (M1/M2/M3) on deals already sold that will fire within the year, using typical timing (M1 ~14d, M2 ~45d, M3 ~80d from sold).</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>New</strong> — milestones from deals you&apos;ll sell over the rest of the year at your current pace. Late-year sales contribute less because some milestones slip to next year.</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Paid</strong> — payroll entries marked Paid with a milestone date in {new Date().getFullYear()}. Reflects what&apos;s landed on your milestone calendar this year; the exact cash-arrival date may differ slightly for legacy entries.</li>
              </ul>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>For your earning rate or production credit (not tied to cash arrival timing), tap the <strong>This Year</strong> tab.</p>
            </>
          ) : (
            <>
              <p><strong style={{ color: 'var(--text-primary)' }}>{heroOnPaceCopy.label}</strong> estimates the commission value you&apos;ll earn (regardless of when it pays out) over this period at your current pace.</p>
              <p>It adds two parts:</p>
              <ul className="space-y-2" style={{ paddingLeft: '1.2rem', listStyleType: 'disc' }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Earned</strong> — full M1+M2+M3 commission of deals you&apos;ve already sold within this period, credited at face value.</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Pace</strong> — projected new sales at your current deals/month rate × commission per deal × months remaining.</li>
              </ul>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>For actual cash hitting your bank by Dec 31 (which discounts late-year sales whose milestones slip), tap the <strong>{new Date().getFullYear()} Cash</strong> tab.</p>
            </>
          )}
        </div>
      </MobileBottomSheet>
    </div>
  );
}
