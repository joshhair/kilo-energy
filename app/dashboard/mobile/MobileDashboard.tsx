'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, fmtCompact$, formatCompactKWValue, formatCompactKWParts, localDateString } from '../../../lib/utils';
import { ACTIVE_PHASES, getTrainerOverrideRate, INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT } from '../../../lib/data';
import { getPhaseStuckThresholds, PERIODS, isInPeriod, isOverdue, type Period } from '../components/dashboard-utils';
import { sumPaid, sumGrossPaid, sumPendingChargebacks } from '../../../lib/aggregators';
import { CheckCircle } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileBadge, { PHASE_COLORS } from './shared/MobileBadge';
import MobileAdminDashboard from './MobileAdminDashboard';

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
const ACCENT_DISP = 'var(--accent-emerald-display)';
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

  // useLayoutEffect (synchronous, pre-paint) instead of useEffect so the
  // active-pill highlight is positioned before the user sees the first
  // frame. With the post-paint useEffect, switching from admin → rep view
  // (the dashboard component swap in the parent layout) sometimes left
  // the highlight unset until the user re-tapped a pill — refs were
  // populated but the effect's measurement hadn't completed before paint.
  // Layout effect avoids that race. We also re-measure once via rAF in
  // case fonts/scroll-snap settle on the next frame.
  useLayoutEffect(() => {
    const measure = () => {
      const idx = PERIODS.findIndex(p => p.value === period);
      const el = pillRefs.current[idx];
      if (!el) return;
      const parent = el.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      setPillStyle({ left: rect.left - parentRect.left + parent.scrollLeft, width: rect.width });
      setPillReady(true);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
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

  // Pipeline: sum of unpaid M1 + M2 + M3 on active projects, role-aware
  const pipelineValue = useMemo(
    () => {
      const payrollNetByProjectStage = myPayroll.reduce((map, e) => {
        if (e.projectId && (e.paymentStage === 'M1' || e.paymentStage === 'M2' || e.paymentStage === 'M3')) {
          const key = `${e.projectId}:${e.paymentStage}`;
          map.set(key, (map.get(key) ?? 0) + e.amount);
        }
        return map;
      }, new Map<string, number>());
      const paidPayrollByProject = myPayroll.filter((e) => e.status === 'Paid' && e.date <= todayStr && e.paymentStage !== 'Trainer').reduce((map, e) => {
        if (e.projectId) map.set(e.projectId, (map.get(e.projectId) ?? 0) + e.amount);
        return map;
      }, new Map<string, number>());
      const base = activeProjects.reduce((s, p) => {
        const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
        const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
        const totalExpected = p.repId === effectiveRepId
          ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.m1Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.m2Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.m3Amount ?? 0))
          : p.setterId === effectiveRepId
            ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.setterM1Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.setterM2Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.setterM3Amount ?? 0))
            : coCloserParty
              ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coCloserParty.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coCloserParty.m2Amount) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (coCloserParty.m3Amount ?? 0))
              : coSetterParty
                ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coSetterParty.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coSetterParty.m2Amount) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (coSetterParty.m3Amount ?? 0))
                : 0;
        const alreadyPaid = paidPayrollByProject.get(p.id) ?? 0;
        return s + Math.max(0, totalExpected - alreadyPaid);
      }, 0);
      const paidTrainerPayrollByProject = myPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr && p.paymentStage === 'Trainer').reduce((map, p) => {
        if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
        return map;
      }, new Map<string, number>());
      const trainerOverride = trainerAssignments.filter(a => a.trainerId === effectiveRepId).reduce((sum, assignment) => {
        const isTraineeParty = (p: typeof projects[number]) =>
          p.repId === assignment.traineeId ||
          p.setterId === assignment.traineeId ||
          p.additionalClosers?.some(c => c.userId === assignment.traineeId) ||
          p.additionalSetters?.some(s => s.userId === assignment.traineeId);
        const completedDeals = projects.filter(p =>
          isTraineeParty(p) &&
          ((installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)
        ).length;
        const overrideRate = getTrainerOverrideRate(assignment, completedDeals);
        return sum + projects
          .filter(p => ACTIVE_PHASES.includes(p.phase) && isTraineeParty(p))
          .reduce((pSum, p) => {
            const expected = Math.round(overrideRate * p.kWSize * 1000 * 100) / 100;
            const alreadyPaid = paidTrainerPayrollByProject.get(p.id) ?? 0;
            return pSum + Math.max(0, expected - alreadyPaid);
          }, 0);
      }, 0);
      return base + trainerOverride;
    },
    [activeProjects, effectiveRepId, trainerAssignments, projects, installerPayConfigs, myPayroll, todayStr],
  );

  // On Pace: annual projection — matches desktop My Pay calculation exactly
  const { onPaceAnnual, dealsPerMonth: paceDPM } = useMemo(() => {
    const now = new Date();
    const todayISO = localDateString(now);
    const allMyProjects = myProjects.filter((p) => p.phase !== 'Cancelled');
    const totalDeals = allMyProjects.length;
    if (totalDeals === 0) return { onPaceAnnual: 0, dealsPerMonth: 0 };

    // Average commission per deal (M1 + M2), role-aware
    const avgCommissionPerDeal = allMyProjects.reduce((s, p) => {
      const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
      let commission = 0;
      if (p.repId === effectiveRepId) commission = (p.m1Amount ?? 0) + (p.m2Amount ?? 0);
      else if (p.setterId === effectiveRepId) commission = (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0);
      else if (coCloserParty) commission = (coCloserParty.m1Amount ?? 0) + (coCloserParty.m2Amount ?? 0);
      else if (coSetterParty) commission = (coSetterParty.m1Amount ?? 0) + (coSetterParty.m2Amount ?? 0);
      return s + commission;
    }, 0) / totalDeals;

    // Deal closing pace
    const sorted = [...allMyProjects].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const firstDealDate = new Date(sorted[0].soldDate + 'T12:00:00');
    const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / 86400000, 1);
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;
    const paceBasedAnnual = dealsPerMonth * avgCommissionPerDeal * 12;

    // Actual paid history. Uses GROSS paid (excludes chargebacks) because
    // this drives the monthly-rate averaging — we want how fast the rep is
    // earning, not net-of-claw-backs. For any cumulative "paid-out" total
    // shown to the user, use sumPaid (net) instead.
    const totalPaidPositive = sumGrossPaid(myPayroll, { asOf: todayISO });

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
    const projM1 = allMyProjects.filter((p) => preAcceptance.includes(p.phase)).reduce((s, p) => {
      const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
      let m1 = 0;
      if (p.repId === effectiveRepId) m1 = p.m1Amount ?? 0;
      else if (p.setterId === effectiveRepId) m1 = p.setterM1Amount ?? 0;
      else if (coCloserParty) m1 = coCloserParty.m1Amount;
      else if (coSetterParty) m1 = coSetterParty.m1Amount;
      return s + m1;
    }, 0);
    const projM2 = allMyProjects.filter((p) => preInstalled.includes(p.phase)).reduce((s, p) => {
      const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
      let m2 = 0;
      if (p.repId === effectiveRepId) m2 = p.m2Amount ?? 0;
      else if (p.setterId === effectiveRepId) m2 = p.setterM2Amount ?? 0;
      else if (coCloserParty) m2 = coCloserParty.m2Amount;
      else if (coSetterParty) m2 = coSetterParty.m2Amount;
      return s + m2;
    }, 0);
    annual += Math.round((projM1 + projM2) * 0.15);

    return { onPaceAnnual: annual, dealsPerMonth };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeProjects reports as unnecessary but it's a reference the memo must invalidate on
  }, [myProjects, myPayroll, activeProjects]);

  // ── Animated counters (rep layout) ───────────────────────────────────────

  const animatedOnPace = useCountUp(onPaceAnnual, 350);
  const animatedPayout = useCountUp(pendingPayrollTotal, 300);
  const animatedPaid = useCountUp(periodPaid, 300);
  const animatedPipeline = useCountUp(pipelineValue, 300);

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

        {/* Stat grid — 2x2, +1 conditional chargeback tile when owed */}
        <div className="grid grid-cols-2 gap-3">
          <MobileStatCard label="Paid" value={fmt$(totalPaid)} color={ACCENT} />
          <MobileStatCard label="In Pipeline" value={fmt$(pipelineValue)} color={ACCENT2} />
          {(() => {
            const sold = formatCompactKWParts(totalKW);
            const installed = formatCompactKWParts(totalKWInstalled);
            return (
              <>
                <MobileStatCard label={`${sold.unit} Sold`} value={sold.value} color="#fff" />
                <MobileStatCard label={`${installed.unit} Installed`} value={installed.value} color="#fff" />
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
                    style={{ background: 'var(--surface-card)', border: '1px solid #2a3858', transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="shrink-0" style={{ width: 4, background: accent }} />
                    <div className="flex-1 min-w-0 px-4 py-3">
                      <p className="text-[var(--text-primary)] font-semibold truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.05rem' }}>{p.customerName}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <MobileBadge value={p.phase} />
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
          <MobileStatCard label="Total Projects" value={myProjects.length} color="#fff" />
          {(() => { const t = formatCompactKWParts(totalKWPm); return (<MobileStatCard label={`Total ${t.unit}`} value={t.value} color={ACCENT2} />); })()}
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
                    <p className="font-semibold text-[var(--text-primary)] truncate flex-1 min-w-0" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-6">
                    <MobileBadge value={p.phase} />
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
                    <p className="text-[var(--text-primary)] truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{p.customerName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <MobileBadge value={p.phase} />
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
              className="shrink-0 rounded-full px-4 py-2 text-base font-medium transition-all transition-colors duration-200 min-h-[44px] touch-manipulation active:scale-[0.95]"
              style={{
                fontFamily: FONT_BODY,
                color: period === p.value ? '#000' : MUTED,
                fontWeight: period === p.value ? 700 : undefined,
                border: period === p.value ? 'none' : '1px solid var(--border-subtle)',
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
            <p className="tracking-widest uppercase" style={{ color: ACCENT2_DISP, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', letterSpacing: '0.12em' }}>On Pace For {new Date().getFullYear()}</p>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.1 }}>{fmt$(animatedOnPace)}</p>
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem', marginTop: '0.35rem' }}>
              {period === 'this-year' ? 'This Year' : `Based on ${paceDPM.toFixed(1)} deals/mo`}
            </p>
            {/* Next Payout — secondary */}
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <div className="flex items-baseline justify-between">
                <p className="tracking-widest uppercase" style={{ color: ACCENT_DISP, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.12em' }}>Next Payout</p>
                <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.95rem' }}>{daysUntilPayday === 0 ? <span style={{ color: 'var(--text-primary)' }}>Today</span> : <>{nextFridayLabel} &middot; <span style={{ color: 'var(--text-primary)' }}>{daysUntilPayday}d</span></>}</p>
              </div>
              <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.75rem, 8vw, 2.25rem)', color: HERO_NUM, lineHeight: 1.3 }}>{fmt$(animatedPayout)}</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="tracking-widest uppercase" style={{ color: ACCENT_DISP, fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', letterSpacing: '0.12em' }}>Next Payout</p>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.1 }}>{fmt$(animatedPayout)}</p>
            <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1.1rem', marginTop: '0.5rem' }}>{daysUntilPayday === 0 ? <span style={{ color: 'var(--text-primary)' }}>Today</span> : <>{nextFridayLabel} &middot; <span style={{ color: 'var(--text-primary)' }}>{daysUntilPayday} days</span></>}</p>
          </div>
        )}

        {/* Stats inside hero card */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 0ms both' }}>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: ACCENT, lineHeight: 1.15 }}>{fmtCompact$(animatedPaid)}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Paid</p>
          </div>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both' }}>
            <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: ACCENT2, lineHeight: 1.15 }}>{fmtCompact$(animatedPipeline)}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Pipeline</p>
          </div>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both' }}>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: 'var(--text-primary)', lineHeight: 1.15 }}>{formatCompactKWValue(periodKW)}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>kW Sold</p>
          </div>
          <div className="stat-cell-stagger min-w-0" style={{ animation: 'statCellEnter 220ms cubic-bezier(0.16, 1, 0.3, 1) 180ms both' }}>
            <p className="tabular-nums" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.6rem, 7vw, 1.875rem)', color: 'var(--text-primary)', lineHeight: 1.15 }}>{periodActive.length}</p>
            <p className="tracking-wide uppercase" style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem' }}>Active Deals</p>
          </div>
        </div>
      </MobileCard>

      {/* Needs Attention — hidden if 0 */}
      {attentionItems.length > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5" style={{ color: ACCENT }} />
            <p className="font-semibold text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>Needs Attention</p>
            <span className="ml-auto font-bold" style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>{attentionItems.length}</span>
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
              <p className="font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.1rem' }}>{item.customerName}</p>
              <div className="flex items-center gap-2 mt-1">
                <MobileBadge value={item.phase} />
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
                    <p className="text-[var(--text-primary)] font-semibold truncate" style={{ fontFamily: FONT_BODY, fontSize: '1.05rem' }}>{p.customerName}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <MobileBadge value={p.phase} />
                      <span style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.85rem' }}>{relativeTime(p.soldDate)}</span>
                    </div>
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
