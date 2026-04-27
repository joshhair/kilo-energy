'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { fmt$, formatDate, localDateString } from '../../../lib/utils';
import { sumPaid, sumPendingChargebacks, countPendingChargebacks } from '../../../lib/aggregators';
import { PayrollEntry } from '../../../lib/data';
import { resolveTrainerRate } from '../../../lib/commission';
import { Banknote, Receipt, ChevronRight, Search, X, TrendingUp, Calendar } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

// ── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--accent-emerald-solid)';          // for accent strips / icons / labels
const ACCENT_DISP = 'var(--accent-emerald-display)';   // ≥18pt secondary stat values
const ACCENT2_DISP = 'var(--accent-cyan-display)';
const MUTED = 'var(--text-muted)';
const DIM = 'var(--text-dim)';
const WARNING = 'var(--accent-amber-solid)';
const WARNING_DISP = 'var(--accent-amber-display)';
const HERO_NUM = 'var(--text-primary)';                // BIG hero numbers — near-black for max readability

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNextFriday(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = (5 - day + 7) % 7;
  const nf = new Date(d);
  nf.setDate(d.getDate() + diff);
  return nf;
}

function getFridayForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = ((5 - day + 7) % 7) || 7;
  if (day === 5) return dateStr;
  const nf = new Date(d);
  nf.setDate(d.getDate() + diff);
  return localDateString(nf);
}

function formatFridayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function statusColor(status: string): string {
  if (status === 'Paid') return ACCENT;
  if (status === 'Pending') return WARNING;
  return MUTED;
}

// ── Count-up animation hook ──────────────────────────────────────────────────

const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useCountUp(target: number, duration = 900, deps: unknown[] = []) {
  const [display, setDisplay] = useState(target);
  useEffect(() => {
    if (prefersReduced || target === 0) { setDisplay(target); return; }
    let start: number | null = null;
    let raf: number;
    const ease = (t: number) => 1 - Math.pow(1 - t, 4); // quartic-out, ~spring
    const tick = (ts: number) => {
      if (!start) start = ts;
      const elapsed = Math.min((ts - start) / duration, 1);
      setDisplay(Math.round(ease(elapsed) * target));
      if (elapsed < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, ...deps]);
  return display;
}

// ── Pay Period Group ─────────────────────────────────────────────────────────

interface PayPeriod {
  friday: string;
  entries: PayrollEntry[];
  total: number;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MobileMyPay() {
  const { effectiveRole, effectiveRepId, effectiveRepName, currentUserRepType, payrollEntries, projects, reimbursements, setReimbursements, trainerAssignments } = useApp();
  const { toast } = useToast();
  const [showReimbSheet, setShowReimbSheet] = useState(false);
  const [reimbForm, setReimbForm] = useState({ amount: '', description: '', date: '' });
  const [reimbFile, setReimbFile] = useState<File | undefined>(undefined);
  // Per-row expand state for long reimbursement descriptions. Long notes
  // (admin-facing context like "as discussed with Josh, here are…") used
  // to dominate the card. Now collapsed to 2 lines with tap-to-expand.
  const [expandedReimbId, setExpandedReimbId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'M1' | 'M2' | 'M3' | 'Bonus' | 'Trainer'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Draft' | 'Pending' | 'Paid'>('all');
  const [payFilterFrom, setPayFilterFrom] = useState('');
  const [payFilterTo, setPayFilterTo] = useState('');

  const todayStr = localDateString(new Date());
  const nextFriday = useMemo(() => getNextFriday(), []);
  const nextFridayStr = useMemo(() => localDateString(nextFriday), [nextFriday]);

  // ── Filter entries to this rep + active filters ──
  const myEntries = useMemo(() => {
    let entries = payrollEntries.filter((p) => p.repId === effectiveRepId);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter((e) =>
        (e.customerName ?? '').toLowerCase().includes(q) ||
        (e.notes ?? '').toLowerCase().includes(q) ||
        (e.repName ?? '').toLowerCase().includes(q)
      );
    }
    if (filterType !== 'all') {
      entries = entries.filter((e) => e.paymentStage === filterType);
    }
    if (filterStatus !== 'all') {
      entries = entries.filter((e) => e.status === filterStatus);
    }
    return entries;
  }, [payrollEntries, effectiveRepId, searchQuery, filterType, filterStatus]);

  // ── Overview stats ──
  // Net cumulative paid-out (incl. chargebacks already applied).
  const lifetimeEarned = useMemo(
    () => sumPaid(payrollEntries, { asOf: todayStr, repId: effectiveRepId ?? undefined }),
    [payrollEntries, effectiveRepId, todayStr],
  );

  const pendingTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.status === 'Pending' && p.date <= todayStr)
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, todayStr],
  );

  const _draftTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.status === 'Draft')
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId],
  );

  const pendingChargebackTotal = useMemo(
    () => Math.abs(sumPendingChargebacks(payrollEntries, { repId: effectiveRepId ?? undefined })),
    [payrollEntries, effectiveRepId],
  );
  const pendingChargebackCount = useMemo(
    () => countPendingChargebacks(payrollEntries, { repId: effectiveRepId ?? undefined }),
    [payrollEntries, effectiveRepId],
  );

  const nextPayoutTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.date === nextFridayStr && p.status === 'Pending')
        .reduce((s, p) => s + p.amount, 0),
    [payrollEntries, effectiveRepId, nextFridayStr],
  );

  // ── Pipeline projection ──
  const myProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          (p.repId === effectiveRepId || p.setterId === effectiveRepId) &&
          p.phase !== 'Cancelled' &&
          p.phase !== 'On Hold',
      ),
    [projects, effectiveRepId],
  );

  const projectedM1 = useMemo(() => {
    const preAcceptance = ['New'];
    return myProjects
      .filter((p) => preAcceptance.includes(p.phase))
      .reduce((s, p) => {
        const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
        const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
        let m1 = 0;
        if (p.repId === effectiveRepId) m1 = p.m1Amount ?? 0;
        else if (p.setterId === effectiveRepId) m1 = p.setterM1Amount ?? 0;
        else if (coCloserParty) m1 = coCloserParty.m1Amount;
        else if (coSetterParty) m1 = coSetterParty.m1Amount;
        return s + m1;
      }, 0);
  }, [myProjects, effectiveRepId]);

  const projectedM2 = useMemo(() => {
    const preInstalled = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install'];
    return myProjects
      .filter((p) => preInstalled.includes(p.phase))
      .reduce((s, p) => {
        const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
        const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
        let m2 = 0;
        if (p.repId === effectiveRepId) m2 = p.m2Amount ?? 0;
        else if (p.setterId === effectiveRepId) m2 = p.setterM2Amount ?? 0;
        else if (coCloserParty) m2 = coCloserParty.m2Amount;
        else if (coSetterParty) m2 = coSetterParty.m2Amount;
        return s + m2;
      }, 0);
  }, [myProjects, effectiveRepId]);

  const projectedM3 = useMemo(() => {
    const prePTO = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed'];
    return myProjects
      .filter((p) => prePTO.includes(p.phase))
      .reduce((s, p) => {
        const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
        const coSetterParty = p.additionalSetters?.find((c) => c.userId === effectiveRepId);
        let m3 = 0;
        if (p.repId === effectiveRepId) m3 = p.m3Amount ?? 0;
        else if (p.setterId === effectiveRepId) m3 = p.setterM3Amount ?? 0;
        else if (coCloserParty) m3 = coCloserParty.m3Amount ?? 0;
        else if (coSetterParty) m3 = coSetterParty.m3Amount ?? 0;
        return s + m3;
      }, 0);
  }, [myProjects, effectiveRepId]);

  // Forward-looking trainer pipeline. Trainer entries fire alongside M2
  // milestones, so we count un-paid trainer totals on deals still in
  // pre-Install phases. Uses the canonical resolveTrainerRate so both
  // per-project overrides and rep-level assignment-chain trainers are
  // included — same source of truth as the payroll math.
  const projectedTrainer = useMemo(() => {
    const preInstalled = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install'];
    return projects.reduce((s, p) => {
      if (!preInstalled.includes(p.phase)) return s;
      const res = resolveTrainerRate(p, p.repId, trainerAssignments, payrollEntries);
      if (res.trainerId !== effectiveRepId) return s;
      return s + res.rate * (p.kWSize ?? 0) * 1000;
    }, 0);
  }, [projects, trainerAssignments, payrollEntries, effectiveRepId]);

  const pipelineTotal = projectedM1 + projectedM2 + projectedM3 + projectedTrainer;

  // ── Annual Projection ──
  const annualProjection = useMemo(() => {
    const now = new Date();
    const allMyProjects = projects.filter((p) =>
      (p.repId === effectiveRepId || p.setterId === effectiveRepId) && p.phase !== 'Cancelled'
    );
    const sortedByDate = [...allMyProjects].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const totalDeals = sortedByDate.length;
    if (totalDeals === 0) return { annual: 0, monthlyAvg: 0, basis: 'none' as const, details: '' };
    const avgCommissionPerDeal = allMyProjects.reduce((s, p) => {
      const isSetterRole = p.setterId === effectiveRepId;
      const m1 = isSetterRole ? (p.setterM1Amount ?? 0) : (p.m1Amount ?? 0);
      const m2 = isSetterRole ? (p.setterM2Amount ?? 0) : (p.m2Amount ?? 0);
      // Add trainer override when this rep resolves as the trainer
      // for the deal. resolveTrainerRate handles both the per-project
      // override path and the rep-level assignment-chain path, so a
      // rep who's both closer and trainer (or both setter and trainer)
      // gets credited for both income streams on the same deal.
      const trainerRes = resolveTrainerRate(p, p.repId, trainerAssignments, payrollEntries);
      const trainerEarn = trainerRes.trainerId === effectiveRepId
        ? trainerRes.rate * (p.kWSize ?? 0) * 1000
        : 0;
      return s + m1 + m2 + trainerEarn;
    }, 0) / totalDeals;
    const firstDealDate = new Date(sortedByDate[0].soldDate + 'T12:00:00');
    const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / (1000 * 60 * 60 * 24), 1);
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;
    const totalPaidPositive = payrollEntries
      .filter((p) => p.repId === effectiveRepId && p.status === 'Paid' && p.amount > 0 && p.date <= todayStr)
      .reduce((s, p) => s + p.amount, 0);
    const paceBasedAnnual = dealsPerMonth * avgCommissionPerDeal * 12;
    let annual: number;
    let monthlyAvg: number;
    let basis: 'pace' | 'blended' | 'none';
    let details: string;
    if (daysSinceFirst >= 60 && totalPaidPositive > 0) {
      const paidMonthlyRate = (totalPaidPositive / daysSinceFirst) * 30.44;
      monthlyAvg = Math.round(paceBasedAnnual / 12 * 0.6 + paidMonthlyRate * 0.4);
      annual = Math.round(monthlyAvg * 12);
      basis = 'blended';
      details = `${dealsPerMonth.toFixed(1)} deals/mo × ${fmt$(Math.round(avgCommissionPerDeal))} avg`;
    } else {
      monthlyAvg = Math.round(paceBasedAnnual / 12);
      annual = Math.round(paceBasedAnnual);
      basis = 'pace';
      details = `${dealsPerMonth.toFixed(1)} deals/mo × ${fmt$(Math.round(avgCommissionPerDeal))} avg`;
    }
    const pipelineBoost = Math.round((projectedM1 + projectedM2 + projectedTrainer) * 0.15);
    annual += pipelineBoost;
    return { annual, monthlyAvg, basis, details };
  }, [projects, payrollEntries, effectiveRepId, todayStr, projectedM1, projectedM2, projectedTrainer, trainerAssignments]);

  const daysUntilFriday = (() => {
    const today = new Date();
    const ms = nextFriday.getTime() - today.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  })();

  const daysLabel =
    daysUntilFriday === 0 ? 'Today' : daysUntilFriday === 1 ? '1 day' : `${daysUntilFriday} days`;

  // ── Group entries into pay periods ──
  const payPeriods = useMemo((): PayPeriod[] => {
    const groups = new Map<string, PayrollEntry[]>();
    for (const entry of myEntries) {
      const friday = getFridayForDate(entry.date);
      if (!groups.has(friday)) groups.set(friday, []);
      groups.get(friday)!.push(entry);
    }
    return [...groups.entries()]
      .filter(([friday]) => {
        if (payFilterFrom && friday < payFilterFrom) return false;
        if (payFilterTo && friday > payFilterTo) return false;
        return true;
      })
      .map(([friday, entries]) => ({
        friday,
        entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
        total: entries.reduce((s, e) => s + e.amount, 0),
      }))
      .sort((a, b) => b.friday.localeCompare(a.friday));
  }, [myEntries, payFilterFrom, payFilterTo]);

  // ── Reimbursements — only show active ones ──
  // Show all non-archived reimbursements (including Denied) so reps see
  // rejection feedback, not just their in-flight requests. Archived rows
  // are still hidden since admin explicitly hid them.
  const activeReimbs = useMemo(
    () => reimbursements.filter((r) => r.repId === effectiveRepId && !r.archivedAt),
    [reimbursements, effectiveRepId],
  );

  const handleSubmitReimb = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reimbForm.amount || !reimbForm.description) { toast('Amount and description required', 'error'); return; }
    const amt = parseFloat(reimbForm.amount);
    const descr = reimbForm.description.trim();
    const dt = reimbForm.date || new Date().toISOString().split('T')[0];

    const res = await fetch('/api/reimbursements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repId: effectiveRepId,
        amount: amt,
        description: descr,
        date: dt,
        receiptName: reimbFile?.name,
      }),
    });
    if (!res.ok) {
      toast('Failed to submit request', 'error');
      return;
    }
    const newReimb = await res.json();
    setReimbursements((prev) => [...prev, { id: newReimb.id, repId: effectiveRepId!, repName: effectiveRepName ?? '', amount: amt, description: descr, date: dt, status: 'Pending', receiptName: reimbFile?.name, receiptUrl: newReimb.receiptUrl }]);

    // Chain-upload the receipt if attached (desktop-parity).
    if (reimbFile) {
      const form = new FormData();
      form.append('file', reimbFile);
      const upRes = await fetch(`/api/reimbursements/${newReimb.id}/receipt`, { method: 'POST', body: form });
      if (upRes.ok) {
        const withReceipt = await upRes.json();
        setReimbursements((prev) => prev.map((r) => r.id === newReimb.id ? { ...r, receiptUrl: withReceipt.receiptUrl, receiptName: withReceipt.receiptName } : r));
        toast('Reimbursement submitted with receipt');
      } else {
        // Surface the server's specific error (e.g., "receipt upload not
        // configured yet") so reps know whether to retry vs ping admin.
        let msg = 'Submitted — receipt upload failed, try re-uploading';
        try {
          const body = await upRes.json() as { error?: string };
          if (body.error) msg = `Submitted — ${body.error}`;
        } catch {}
        toast(msg, 'error');
      }
    } else {
      toast('Reimbursement request submitted');
    }

    setShowReimbSheet(false);
    setReimbForm({ amount: '', description: '', date: '' });
    setReimbFile(undefined);
  }, [reimbForm, reimbFile, effectiveRepId, effectiveRepName, setReimbursements, toast]);

  // ── Count-up display values ──
  const displayNext = useCountUp(nextPayoutTotal, 900);
  const displayPending = useCountUp(pendingTotal, 750);
  const displayPipeline = useCountUp(pipelineTotal, 800);
  const displayLifetime = useCountUp(lifetimeEarned, 1100);

  // ── PM guard ──
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-28" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Selling-admin guard (mirrors desktop page.tsx) ──
  const adminMaySellCheck = effectiveRole === 'admin' && !!currentUserRepType;
  if (effectiveRole !== 'rep' && effectiveRole !== 'sub-dealer' && !adminMaySellCheck) {
    return (
      <div className="px-5 pt-4 pb-28" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>My Pay is only available in the rep view.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-5" style={{ fontFamily: FONT_BODY }}>
      <MobilePageHeader title="My Pay" />

      {/* ── Consolidated hero — Next Payout (primary) + Pending/Pipeline
           (secondary) + Lifetime (footnote). Tells the story future → past
           in one dominant card so the rep sees the whole money picture at
           a glance without scattered sibling cards.
           Hero numbers use --text-primary (near-black) for max readability
           on white in light mode. Brand color lives in the small uppercase
           label above the number — gives the card its emerald identity
           without forcing the digits to do the contrast work. ── */}
      <MobileCard hero>
        {/* ─ Primary: Next Payout ─ */}
        <p className="tracking-widest uppercase" style={{ color: ACCENT_DISP, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', letterSpacing: '0.12em' }}>Next Payout</p>
        <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: HERO_NUM, lineHeight: 1.05 }}>{fmt$(displayNext)}</p>
        <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem', marginTop: '0.4rem' }}>
          {formatFridayLabel(nextFridayStr)} &middot; {daysLabel}
        </p>

        {/* ─ Secondary: Pending + Pipeline (money in motion) ─
             These are smaller (~1.5rem) so the colored display token still
             has decent visual weight. Keeps amber/cyan identity for the
             status semantics (in-flight vs locked-in). */}
        <div className="mt-5 pt-4 space-y-2.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tracking-widest uppercase shrink-0" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 500 }}>Pending</span>
            <span className="tabular-nums break-words text-right" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.5rem, 7vw, 1.875rem)', color: WARNING_DISP, lineHeight: 1.1 }}>{fmt$(displayPending)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tracking-widest uppercase shrink-0" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 500 }}>Pipeline</span>
            <span className="tabular-nums break-words text-right" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.5rem, 7vw, 1.875rem)', color: ACCENT2_DISP, lineHeight: 1.1 }}>{fmt$(displayPipeline)}</span>
          </div>
        </div>

        {/* ─ Footnote: Lifetime earned (cumulative context) ─ */}
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tracking-widest uppercase shrink-0" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.65rem', fontWeight: 500 }}>Lifetime Earned</span>
            <span className="tabular-nums break-words text-right" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.15rem, 5.5vw, 1.5rem)', color: 'var(--text-secondary)', lineHeight: 1.1 }}>{fmt$(displayLifetime)}</span>
          </div>
        </div>
      </MobileCard>

      {/* ── Annual Projection ── */}
      {annualProjection.annual > 0 && (
        <MobileCard>
          <div className="flex items-center justify-between mb-1">
            <p className="tracking-widest uppercase" style={{ color: WARNING_DISP, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.12em' }}>On Pace For {new Date().getFullYear()}</p>
            <TrendingUp size={14} color={WARNING_DISP} />
          </div>
          <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.5rem, 7vw, 1.875rem)', color: HERO_NUM, lineHeight: 1.1 }}>{fmt$(annualProjection.annual)}</p>
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {annualProjection.basis === 'blended'
              ? `${new Date().getFullYear()} · ${fmt$(annualProjection.monthlyAvg)}/mo avg`
              : annualProjection.basis === 'pace'
              ? `${new Date().getFullYear()} · ${annualProjection.details}`
              : 'Close deals to see projection'}
          </p>
        </MobileCard>
      )}

      {/* ── Projected Pipeline ── */}
      {(projectedM1 > 0 || projectedM2 > 0 || projectedM3 > 0) && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={14} color={ACCENT} />
            <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 500 }}>Projected Pipeline</p>
          </div>
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.75rem', marginBottom: '0.75rem' }}>Expected if deals progress through milestones</p>
          <div className="space-y-2">
            {projectedM1 > 0 && (
              <div className="flex items-center justify-between py-2 px-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)' }}>
                    <span style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 700 }}>M1</span>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '0.9rem', fontWeight: 600 }}>Pending M1</p>
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>Awaiting Acceptance</p>
                  </div>
                </div>
                <p className="tabular-nums font-bold" style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.05rem' }}>{fmt$(projectedM1)}</p>
              </div>
            )}
            {projectedM2 > 0 && (
              <div className="flex items-center justify-between py-2 px-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-purple-solid) 12%, transparent)' }}>
                    <span style={{ color: 'var(--accent-purple-text)', fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 700 }}>M2</span>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '0.9rem', fontWeight: 600 }}>Pending M2</p>
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>Awaiting Installation</p>
                  </div>
                </div>
                <p className="tabular-nums font-bold" style={{ color: 'var(--accent-purple-text)', fontFamily: FONT_DISPLAY, fontSize: '1.05rem' }}>{fmt$(projectedM2)}</p>
              </div>
            )}
            {projectedM3 > 0 && (
              <div className="flex items-center justify-between py-2 px-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-teal-solid) 12%, transparent)' }}>
                    <span style={{ color: 'var(--accent-teal-text)', fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 700 }}>M3</span>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '0.9rem', fontWeight: 600 }}>Pending M3</p>
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.7rem' }}>Awaiting PTO</p>
                  </div>
                </div>
                <p className="tabular-nums font-bold" style={{ color: 'var(--accent-teal-text)', fontFamily: FONT_DISPLAY, fontSize: '1.05rem' }}>{fmt$(projectedM3)}</p>
              </div>
            )}
          </div>
        </MobileCard>
      )}

      {/* ── Active reimbursements (only if any) ── */}
      {/*
       * Card hierarchy: amount + status are the headline (what the rep
       * scans for). Description is secondary — clamped to 2 lines with a
       * tap-to-expand affordance because rep-authored notes can run
       * paragraphs long ("as discussed with Josh, here are the travel
       * expenses incurred by my brother and me for the…"). Without the
       * clamp those notes used to push the amount/status off-screen.
       * Date + receipt sit at the bottom in muted small. Admin reviews
       * full descriptions on the desktop earnings table; the rep doesn't
       * need to read their own note prominently here.
       */}
      {activeReimbs.length > 0 && (
        <MobileSection title="Reimbursements" count={activeReimbs.length} collapsible defaultOpen={false}>
          <MobileCard>
            {activeReimbs.map((r, i) => {
              const desc = r.description ?? '';
              const isLong = desc.length > 80 || desc.split('\n').length > 2;
              const isExpanded = expandedReimbId === r.id;
              return (
                <div
                  key={r.id}
                  className={`py-3 ${i < activeReimbs.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {/* Headline row: amount + status */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.25rem', fontWeight: 700 }}>{fmt$(r.amount)}</span>
                    <MobileBadge value={r.status} variant="status" />
                  </div>
                  {/* Description: clamped by default */}
                  {desc && (
                    <>
                      <p
                        className={isExpanded ? '' : 'line-clamp-2'}
                        style={{
                          color: 'var(--text-primary)',
                          fontFamily: FONT_BODY,
                          fontSize: '0.9375rem',
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {desc}
                      </p>
                      {isLong && (
                        <button
                          onClick={() => setExpandedReimbId(isExpanded ? null : r.id)}
                          style={{
                            color: ACCENT,
                            fontFamily: FONT_BODY,
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            marginTop: '4px',
                            minHeight: '24px',
                          }}
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </>
                  )}
                  {/* Footer: date + receipt name */}
                  <p
                    style={{
                      color: MUTED,
                      fontFamily: FONT_BODY,
                      fontSize: '0.8125rem',
                      marginTop: '6px',
                    }}
                  >
                    {formatDate(r.date)}
                    {r.receiptName ? ` · ${r.receiptName}` : ''}
                  </p>
                </div>
              );
            })}
          </MobileCard>
        </MobileSection>
      )}

      {/* ── Pending Chargebacks ── */}
      {pendingChargebackCount > 0 && (() => {
        const pendingEntries = payrollEntries
          .filter((p) => p.repId === effectiveRepId && p.amount < 0 && (p.status === 'Draft' || p.status === 'Pending'))
          .sort((a, b) => a.date.localeCompare(b.date));
        return (
          <MobileSection title="Pending Chargebacks" count={pendingChargebackCount}>
            <MobileCard>
              <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                Amounts to be clawed back from a future paycheck.
              </p>
              <div className="flex items-center justify-between mb-3 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="tracking-widest uppercase" style={{ color: WARNING, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 600 }}>Total</span>
                <span className="tabular-nums font-bold" style={{ color: 'var(--accent-red, #ef4444)', fontFamily: FONT_DISPLAY, fontSize: '1.3rem' }}>-{fmt$(pendingChargebackTotal)}</span>
              </div>
              {pendingEntries.map((e, i) => (
                <div
                  key={e.id}
                  className={`flex items-center justify-between py-3 ${i < pendingEntries.length - 1 ? 'border-b' : ''}`}
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div>
                    <p style={{ color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '1rem' }}>{e.customerName || '(no project)'}</p>
                    <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{e.paymentStage} · {e.status} · {e.date}</p>
                  </div>
                  <p className="font-bold tabular-nums" style={{ color: 'var(--accent-red, #ef4444)', fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>{fmt$(e.amount)}</p>
                </div>
              ))}
            </MobileCard>
          </MobileSection>
        );
      })()}

      {/* ── Reimbursement link ── */}
      <button
        onClick={() => setShowReimbSheet(true)}
        className="w-full flex items-center justify-between gap-3 active:scale-[0.97]"
        style={{
          minHeight: '52px',
          padding: '14px 18px',
          borderRadius: '16px',
          background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
          border: '0.5px solid color-mix(in srgb, var(--text-primary) 8%, transparent)',
          transition: 'transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          fontFamily: FONT_BODY,
        }}
      >
        <div className="flex items-center gap-3">
          <Receipt size={18} color={ACCENT} />
          <span style={{ color: ACCENT, fontSize: '1rem', fontWeight: 500 }}>Request Reimbursement</span>
        </div>
        <ChevronRight size={16} color={DIM} />
      </button>

      {/* ── Pay History Filters ── */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={15} color={DIM} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search payments…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full outline-none"
            style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '12px 36px 12px 40px', color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '0.95rem', minHeight: '44px' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
              <X size={14} color={MUTED} />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="flex-1 outline-none"
            style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '10px 12px', color: filterType !== 'all' ? 'var(--text-primary)' : MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem', minHeight: '44px' }}
          >
            <option value="all">All Types</option>
            {effectiveRole !== 'sub-dealer' && <option value="M1">M1</option>}
            <option value="M2">M2</option>
            <option value="M3">M3</option>
            {effectiveRole !== 'sub-dealer' && <option value="Bonus">Bonus</option>}
            {effectiveRole !== 'sub-dealer' && <option value="Trainer">Trainer</option>}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            className="flex-1 outline-none"
            style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '10px 12px', color: filterStatus !== 'all' ? 'var(--text-primary)' : MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem', minHeight: '44px' }}
          >
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Pending">Pending</option>
            <option value="Paid">Paid</option>
          </select>
        </div>
        <div className="flex gap-2">
          <label className="flex-1 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider px-1" style={{ color: MUTED, fontFamily: FONT_BODY, letterSpacing: '0.1em' }}>From</span>
            <input
              type="date"
              value={payFilterFrom}
              onChange={(e) => setPayFilterFrom(e.target.value)}
              style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '10px 12px', color: payFilterFrom ? 'var(--text-primary)' : MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem', minHeight: '44px', outline: 'none' }}
            />
          </label>
          <label className="flex-1 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider px-1" style={{ color: MUTED, fontFamily: FONT_BODY, letterSpacing: '0.1em' }}>To</span>
            <input
              type="date"
              value={payFilterTo}
              onChange={(e) => setPayFilterTo(e.target.value)}
              style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '10px 12px', color: payFilterTo ? 'var(--text-primary)' : MUTED, fontFamily: FONT_BODY, fontSize: '0.9rem', minHeight: '44px', outline: 'none' }}
            />
          </label>
        </div>
        {(searchQuery || filterType !== 'all' || filterStatus !== 'all' || payFilterFrom || payFilterTo) && (
          <button
            onClick={() => { setSearchQuery(''); setFilterType('all'); setFilterStatus('all'); setPayFilterFrom(''); setPayFilterTo(''); }}
            style={{ color: ACCENT, fontFamily: FONT_BODY, fontSize: '0.85rem', fontWeight: 500 }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Pay History ── */}
      <MobileSection title="Pay History" count={myEntries.length} collapsible defaultOpen>
        {payPeriods.length === 0 ? (
          <MobileEmptyState
            icon={Banknote}
            title="No payments yet"
            subtitle="Payroll entries will appear here as your deals hit milestones."
          />
        ) : (
          <div className="space-y-4">
            {payPeriods.map((period) => (
              <MobileCard key={period.friday}>
                {/* Friday group header */}
                <div className="flex items-center justify-between mb-3 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <p className="font-bold text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '0.9rem' }}>
                    {formatFridayLabel(period.friday)}
                  </p>
                  <p className="tabular-nums" style={{ color: 'var(--text-primary)', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{fmt$(period.total)}</p>
                </div>

                {/* Entries */}
                <div>
                  {period.entries.map((entry, i) => {
                    const label = entry.customerName || (entry.type === 'Bonus' ? 'Bonus' : '--');
                    // Link the customer name to the project when we have
                    // one — mirrors the desktop my-pay table. Bonus rows
                    // (no projectId) stay static text.
                    const labelEl = entry.projectId ? (
                      <Link
                        href={`/dashboard/projects/${entry.projectId}`}
                        className="font-semibold text-[var(--text-primary)] active:opacity-70 transition-opacity"
                        style={{ fontFamily: FONT_BODY, fontSize: '1rem', textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--text-primary) 15%, transparent)', textUnderlineOffset: '3px' }}
                      >
                        {label}
                      </Link>
                    ) : (
                      <p className="font-semibold text-[var(--text-primary)]" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>
                        {label}
                      </p>
                    );
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between py-3 ${i < period.entries.length - 1 ? 'border-b' : ''}`}
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div>
                          {labelEl}
                          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>
                            {entry.paymentStage} &middot; {entry.date}
                          </p>
                        </div>
                        <p className="font-bold tabular-nums" style={{ color: entry.amount < 0 ? 'var(--accent-red, #ef4444)' : statusColor(entry.status), fontFamily: FONT_DISPLAY, fontSize: '1.1rem' }}>
                          {fmt$(entry.amount)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </MobileCard>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Reimbursement bottom sheet ── */}
      <MobileBottomSheet open={showReimbSheet} onClose={() => setShowReimbSheet(false)} title="Request Reimbursement">
        <form onSubmit={handleSubmitReimb} className="px-5 space-y-5 pb-2">
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Amount</label>
            <input
              type="number"
              step="0.01"
              required
              value={reimbForm.amount}
              onChange={(e) => setReimbForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '16px 18px', color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '1rem' }}
            />
          </div>
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Description</label>
            <input
              type="text"
              required
              value={reimbForm.description}
              onChange={(e) => setReimbForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Gas mileage — site visits"
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '16px 18px', color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '1rem' }}
            />
          </div>
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Date</label>
            <input
              type="date"
              value={reimbForm.date}
              onChange={(e) => setReimbForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-primary) 10%, transparent)', borderRadius: '14px', padding: '16px 18px', color: 'var(--text-primary)', fontFamily: FONT_BODY, fontSize: '1rem' }}
            />
          </div>
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Receipt <span className="normal-case" style={{ color: 'var(--text-dim)' }}>(optional)</span></label>
            {/* Native file picker triggers the camera on iOS when `accept="image/*"` is honored.
                Accept images + PDF to mirror the desktop modal + server whitelist. */}
            <label
              className="flex items-center gap-2 w-full min-h-[48px] cursor-pointer"
              style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', border: '0.5px dashed color-mix(in srgb, var(--text-primary) 15%, transparent)', borderRadius: '14px', padding: '16px 18px', color: reimbFile ? '#fff' : 'var(--text-muted)', fontFamily: FONT_BODY, fontSize: '0.95rem' }}
            >
              <span className="truncate">{reimbFile ? reimbFile.name : 'Attach photo or PDF…'}</span>
              <input
                type="file"
                accept="image/*,.pdf,.heic,.heif"
                className="hidden"
                onChange={(e) => setReimbFile(e.target.files?.[0])}
              />
            </label>
          </div>
          <button
            type="submit"
            className="w-full active:opacity-80 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #1de9b6, #00b894)', borderRadius: '16px', padding: '18px', fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)', fontFamily: FONT_BODY }}
          >
            Submit Request
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
