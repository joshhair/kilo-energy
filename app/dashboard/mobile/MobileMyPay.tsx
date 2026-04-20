'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { fmt$, formatDate, localDateString } from '../../../lib/utils';
import { sumPaid } from '../../../lib/aggregators';
import { PayrollEntry } from '../../../lib/data';
import { Banknote, Receipt, ChevronRight } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

// ── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY = "var(--m-font-display, 'DM Serif Display', serif)";
const FONT_BODY = "var(--m-font-body, 'DM Sans', sans-serif)";
const ACCENT = 'var(--m-accent, var(--accent-emerald))';
const ACCENT2 = 'var(--m-accent2, var(--accent-cyan2))';
const MUTED = 'var(--m-text-muted, var(--text-mobile-muted))';
const DIM = 'var(--m-text-dim, #445577)';
const WARNING = 'var(--m-warning, #f5a623)';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNextFriday(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = ((5 - day + 7) % 7) || 7;
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
  const { effectiveRole, effectiveRepId, effectiveRepName, payrollEntries, projects, reimbursements, setReimbursements } = useApp();
  const { toast } = useToast();
  const [showReimbSheet, setShowReimbSheet] = useState(false);
  const [reimbForm, setReimbForm] = useState({ amount: '', description: '', date: '' });
  const [reimbFile, setReimbFile] = useState<File | undefined>(undefined);

  const todayStr = localDateString(new Date());
  const nextFriday = useMemo(() => getNextFriday(), []);
  const nextFridayStr = useMemo(() => localDateString(nextFriday), [nextFriday]);

  // ── Filter entries to this rep ──
  const myEntries = useMemo(
    () => payrollEntries.filter((p) => p.repId === effectiveRepId),
    [payrollEntries, effectiveRepId],
  );

  // ── Overview stats ──
  // Net cumulative paid-out (incl. chargebacks already applied).
  const lifetimeEarned = useMemo(
    () => sumPaid(payrollEntries, { asOf: todayStr, repId: effectiveRepId ?? undefined }),
    [payrollEntries, effectiveRepId, todayStr],
  );

  const pendingTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && (p.status === 'Pending' || (p.status === 'Paid' && p.date > todayStr)))
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

  const nextPayoutTotal = useMemo(
    () =>
      payrollEntries
        .filter((p) => p.repId === effectiveRepId && p.date === nextFridayStr && p.status !== 'Draft')
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
      .reduce((s, p) => s + (p.m1Amount ?? 0), 0);
  }, [myProjects]);

  const projectedM2 = useMemo(() => {
    const preInstalled = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install'];
    return myProjects
      .filter((p) => preInstalled.includes(p.phase))
      .reduce((s, p) => s + (p.m2Amount ?? 0), 0);
  }, [myProjects]);

  const pipelineTotal = projectedM1 + projectedM2;

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
      .map(([friday, entries]) => ({
        friday,
        entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
        total: entries.reduce((s, e) => s + e.amount, 0),
      }))
      .sort((a, b) => b.friday.localeCompare(a.friday));
  }, [myEntries]);

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
      <div className="px-5 pt-4 pb-24" style={{ fontFamily: FONT_BODY }}>
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '1rem' }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-5" style={{ fontFamily: FONT_BODY }}>
      <MobilePageHeader title="My Pay" />

      {/* ── Consolidated hero — Next Payout (primary) + Pending/Pipeline
           (secondary) + Lifetime (footnote). Tells the story future → past
           in one dominant card so the rep sees the whole money picture at
           a glance without scattered sibling cards. ── */}
      <MobileCard hero>
        {/* ─ Primary: Next Payout ─ */}
        <p className="tracking-widest uppercase" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem' }}>Next Payout</p>
        <p className="tabular-nums break-words" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(2.75rem, 14vw, 4rem)', color: ACCENT, lineHeight: 1.05 }}>{fmt$(displayNext)}</p>
        <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem', marginTop: '0.4rem' }}>
          {formatFridayLabel(nextFridayStr)} &middot; {daysLabel}
        </p>

        {/* ─ Secondary: Pending + Pipeline (money in motion) ─ */}
        <div className="mt-5 pt-4 space-y-2.5" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tracking-widest uppercase shrink-0" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 500 }}>Pending</span>
            <span className="tabular-nums break-words text-right" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.5rem, 7vw, 1.875rem)', color: WARNING, lineHeight: 1.1 }}>{fmt$(displayPending)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tracking-widest uppercase shrink-0" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.7rem', fontWeight: 500 }}>Pipeline</span>
            <span className="tabular-nums break-words text-right" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.5rem, 7vw, 1.875rem)', color: ACCENT2, lineHeight: 1.1 }}>{fmt$(displayPipeline)}</span>
          </div>
        </div>

        {/* ─ Footnote: Lifetime earned (cumulative context) ─ */}
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tracking-widest uppercase shrink-0" style={{ color: DIM, fontFamily: FONT_BODY, fontSize: '0.65rem', fontWeight: 500 }}>Lifetime Earned</span>
            <span className="tabular-nums break-words text-right" style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(1.15rem, 5.5vw, 1.5rem)', color: '#e5e7eb', lineHeight: 1.1 }}>{fmt$(displayLifetime)}</span>
          </div>
        </div>
      </MobileCard>

      {/* ── Active reimbursements (only if any) ── */}
      {activeReimbs.length > 0 && (
        <MobileSection title="Reimbursements" count={activeReimbs.length}>
          <MobileCard>
            {activeReimbs.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center justify-between py-3 ${i < activeReimbs.length - 1 ? 'border-b' : ''}`}
                style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}
              >
                <div>
                  <p style={{ color: '#fff', fontFamily: FONT_BODY, fontSize: '1rem' }}>{r.description}</p>
                  <p style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: '0.875rem' }}>{formatDate(r.date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: ACCENT, fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{fmt$(r.amount)}</span>
                  <MobileBadge value={r.status} variant="status" />
                </div>
              </div>
            ))}
          </MobileCard>
        </MobileSection>
      )}

      {/* ── Reimbursement link ── */}
      <button
        onClick={() => setShowReimbSheet(true)}
        className="w-full flex items-center justify-between gap-3 active:scale-[0.97]"
        style={{
          minHeight: '52px',
          padding: '14px 18px',
          borderRadius: '16px',
          background: 'rgba(255,255,255,0.04)',
          border: '0.5px solid rgba(255,255,255,0.08)',
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
                <div className="flex items-center justify-between mb-3 pb-2 border-b" style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}>
                  <p className="font-bold text-white" style={{ fontFamily: FONT_BODY, fontSize: '0.9rem' }}>
                    {formatFridayLabel(period.friday)}
                  </p>
                  <p className="tabular-nums" style={{ color: '#fff', fontFamily: FONT_DISPLAY, fontSize: '1.1rem', fontWeight: 700 }}>{fmt$(period.total)}</p>
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
                        className="font-semibold text-white active:opacity-70 transition-opacity"
                        style={{ fontFamily: FONT_BODY, fontSize: '1rem', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.15)', textUnderlineOffset: '3px' }}
                      >
                        {label}
                      </Link>
                    ) : (
                      <p className="font-semibold text-white" style={{ fontFamily: FONT_BODY, fontSize: '1rem' }}>
                        {label}
                      </p>
                    );
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between py-3 ${i < period.entries.length - 1 ? 'border-b' : ''}`}
                        style={{ borderColor: 'var(--m-border, var(--border-mobile))' }}
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
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Amount</label>
            <input
              type="number"
              step="0.01"
              required
              value={reimbForm.amount}
              onChange={(e) => setReimbForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '16px 18px', color: '#fff', fontFamily: FONT_BODY, fontSize: '1rem' }}
            />
          </div>
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Description</label>
            <input
              type="text"
              required
              value={reimbForm.description}
              onChange={(e) => setReimbForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Gas mileage — site visits"
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '16px 18px', color: '#fff', fontFamily: FONT_BODY, fontSize: '1rem' }}
            />
          </div>
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Date</label>
            <input
              type="date"
              value={reimbForm.date}
              onChange={(e) => setReimbForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full min-h-[48px] outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '16px 18px', color: '#fff', fontFamily: FONT_BODY, fontSize: '1rem' }}
            />
          </div>
          <div>
            <label className="block tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)', fontFamily: FONT_BODY, fontSize: '0.8rem', fontWeight: 500 }}>Receipt <span className="normal-case" style={{ color: 'rgba(255,255,255,0.3)' }}>(optional)</span></label>
            {/* Native file picker triggers the camera on iOS when `accept="image/*"` is honored.
                Accept images + PDF to mirror the desktop modal + server whitelist. */}
            <label
              className="flex items-center gap-2 w-full min-h-[48px] cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px dashed rgba(255,255,255,0.15)', borderRadius: '14px', padding: '16px 18px', color: reimbFile ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: FONT_BODY, fontSize: '0.95rem' }}
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
            style={{ background: 'linear-gradient(135deg, #1de9b6, #00b894)', borderRadius: '16px', padding: '18px', fontSize: '1rem', fontWeight: 500, color: '#fff', fontFamily: FONT_BODY }}
          >
            Submit Request
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
