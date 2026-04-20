'use client';

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { fmt$, localDateString } from '../../../lib/utils';
import { CheckCircle2, XCircle, Archive } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';

// ── Period helpers ──────────────────────────────────────────────────────────

type Period = 'all' | 'this_month' | 'last_month' | 'this_year';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
];

function matchesPeriod(dateStr: string, period: Period): boolean {
  if (period === 'all') return true;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const ym = dateStr.slice(0, 7); // "YYYY-MM"
  const dy = dateStr.slice(0, 4); // "YYYY"

  if (period === 'this_month') {
    return ym === `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  if (period === 'last_month') {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    return ym === `${ly}-${String(lm + 1).padStart(2, '0')}`;
  }
  if (period === 'this_year') {
    return dy === String(y);
  }
  return true;
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'Paid' ? 'var(--accent-emerald)' :
    status === 'Pending' ? '#f5a623' :
    status === 'Approved' ? 'var(--accent-emerald)' :
    status === 'Denied' ? 'var(--accent-danger)' :
    'var(--text-mobile-muted)';
  return (
    <span className="inline-flex items-center gap-1.5 text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      {status}
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileEarnings() {
  const {
    effectiveRole,
    effectiveRepId,
    payrollEntries,
    reimbursements,
    setReimbursements,
  } = useApp();
  const isHydrated = useIsHydrated();
  const { toast } = useToast();
  const isAdmin = effectiveRole === 'admin';

  useEffect(() => { document.title = 'My Pay | Kilo Energy'; }, []);

  const [period, setPeriod] = useState<Period>('all');
  const [adminShowArchived, setAdminShowArchived] = useState(false);

  // Admin mobile reimbursement review — parity with desktop earnings tab.
  // Previously admin on mobile couldn't approve/deny/archive/delete
  // reimbursements. Now has the same row actions and show-archived toggle.
  const adminReimbsForReview = useMemo(() => {
    if (!isAdmin) return [];
    return reimbursements
      .filter((r) => adminShowArchived ? true : !r.archivedAt)
      .sort((a, b) => {
        // Pending first, then Approved, then Denied — admins pull from the top.
        const rank = (s: string) => s === 'Pending' ? 0 : s === 'Approved' ? 1 : s === 'Denied' ? 2 : 3;
        const d = rank(a.status) - rank(b.status);
        if (d !== 0) return d;
        return b.date.localeCompare(a.date);
      });
  }, [isAdmin, reimbursements, adminShowArchived]);

  const setReimbStatus = (id: string, status: 'Approved' | 'Denied') => {
    const prev = reimbursements.find((r) => r.id === id)?.status ?? 'Pending';
    setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, status } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(`Reimbursement ${status.toLowerCase()}`, 'success'); })
      .catch(() => { setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, status: prev } : r)); toast(`Failed to ${status.toLowerCase()}`, 'error'); });
  };
  const archiveReimbAdmin = (id: string) => {
    const row = reimbursements.find((r) => r.id === id);
    if (!row) return;
    const already = !!row.archivedAt;
    const nowIso = new Date().toISOString();
    setReimbursements((rs) => rs.map((r) => r.id === id ? { ...r, archivedAt: already ? undefined : nowIso } : r));
    fetch(`/api/reimbursements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: !already }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(already ? 'Reimbursement restored' : 'Reimbursement archived', 'success'); })
      .catch(() => { setReimbursements((rs) => rs.map((r) => r.id === id ? row : r)); toast('Failed to update', 'error'); });
  };
  const deleteReimbAdmin = (id: string) => {
    const row = reimbursements.find((r) => r.id === id);
    if (!row) return;
    if (!window.confirm(`Permanently delete this reimbursement?\n\n${row.repName} — $${row.amount.toFixed(2)} — ${row.description}\n\nAlso deletes any attached receipt. Cannot be undone.`)) return;
    setReimbursements((rs) => rs.filter((r) => r.id !== id));
    fetch(`/api/reimbursements/${id}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Reimbursement deleted', 'success'); })
      .catch(() => { setReimbursements((rs) => [...rs, row]); toast('Failed to delete — rolled back', 'error'); });
  };

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24">
        <MobilePageHeader title="My Pay" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const myPayroll = payrollEntries.filter((p) => p.repId === effectiveRepId);
  const dealPayments = myPayroll.filter((p) => p.type === 'Deal' && matchesPeriod(p.date, period));
  const bonusPayments = myPayroll.filter((p) => p.type === 'Bonus' && matchesPeriod(p.date, period));
  const myReimbs = reimbursements.filter((r) => r.repId === effectiveRepId && matchesPeriod(r.date, period));

  const todayStr = localDateString(new Date());
  const totalEarned = myPayroll
    .filter((p) => p.status === 'Paid' && p.date <= todayStr && matchesPeriod(p.date, period))
    .reduce((s, p) => s + p.amount, 0);

  const sortedDeals = [...dealPayments].sort((a, b) => b.date.localeCompare(a.date));
  const sortedBonuses = [...bonusPayments].sort((a, b) => b.date.localeCompare(a.date));
  const sortedReimbs = [...myReimbs].sort((a, b) => b.date.localeCompare(a.date));

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="My Pay" />
        <div className="rounded-2xl p-5 h-24 animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }} />
        <div className="rounded-2xl p-5 h-48 animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }} />
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="My Pay" />

      {/* ── Hero total ──────────────────────────────────────────────────── */}
      <MobileCard hero>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Total Earned</p>
        <p className="text-4xl font-black tabular-nums" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
          {fmt$(totalEarned)}
        </p>
      </MobileCard>

      {/* ── Admin reimbursement review (mobile parity with desktop) ─────── */}
      {isAdmin && (
        <MobileSection
          title="Reimbursement Review"
          count={adminReimbsForReview.filter((r) => r.status === 'Pending').length}
          collapsible
          defaultOpen
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
              {adminReimbsForReview.filter((r) => r.status === 'Pending').length} pending · {adminReimbsForReview.length} total
            </span>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
              <input
                type="checkbox"
                checked={adminShowArchived}
                onChange={(e) => setAdminShowArchived(e.target.checked)}
                className="accent-[var(--accent-green)]"
              />
              Show archived
            </label>
          </div>
          {adminReimbsForReview.length === 0 ? (
            <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              {adminShowArchived ? 'No reimbursements' : 'All caught up — no pending reimbursements'}
            </p>
          ) : (
            <div className="space-y-2">
              {adminReimbsForReview.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl p-3"
                  style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', opacity: r.archivedAt ? 0.55 : 1 }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{r.repName}</p>
                      <p className="text-sm truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{r.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusDot status={r.status} />
                        <span className="text-xs" style={{ color: 'var(--m-text-dim, var(--text-mobile-dim))' }}>{r.date}</span>
                        {r.receiptName && <span className="text-xs" style={{ color: 'var(--m-text-dim, var(--text-mobile-dim))' }}>· 📎 receipt</span>}
                      </div>
                    </div>
                    <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                      {fmt$(r.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => setReimbStatus(r.id, 'Approved')}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                          style={{ background: 'rgba(0,229,160,0.15)', color: 'var(--accent-emerald)' }}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => setReimbStatus(r.id, 'Denied')}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                          style={{ background: 'rgba(239,68,68,0.15)', color: 'rgb(248,113,113)' }}
                        >
                          <XCircle className="w-3.5 h-3.5" /> Deny
                        </button>
                      </>
                    )}
                    {r.receiptUrl && (
                      <a
                        href={r.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: 'rgba(0,180,216,0.15)', color: 'var(--accent-cyan)' }}
                      >
                        View receipt
                      </a>
                    )}
                    <button
                      onClick={() => archiveReimbAdmin(r.id)}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--m-border, var(--border-mobile))', color: 'var(--m-text-secondary, var(--text-mobile-secondary))' }}
                    >
                      <Archive className="w-3.5 h-3.5" /> {r.archivedAt ? 'Restore' : 'Archive'}
                    </button>
                    <button
                      onClick={() => deleteReimbAdmin(r.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ background: 'rgba(239,68,68,0.08)', color: 'rgb(248,113,113)', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </MobileSection>
      )}

      {/* ── Period tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="min-h-[48px] px-4 rounded-xl text-base font-medium whitespace-nowrap transition-colors"
            style={{
              background: period === p.key ? 'var(--accent-emerald)' : 'transparent',
              color: period === p.key ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Deal Payments ───────────────────────────────────────────────── */}
      <MobileSection title="Deal Payments" count={sortedDeals.length} collapsible defaultOpen>
        {sortedDeals.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No deal payments for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
            {sortedDeals.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedDeals.length - 1 ? '1px solid var(--m-border, var(--border-mobile))' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.customerName || entry.notes || 'Deal'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    {entry.paymentStage && (
                      <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.paymentStage}</span>
                    )}
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Bonuses ─────────────────────────────────────────────────────── */}
      <MobileSection title="Bonuses" count={sortedBonuses.length} collapsible defaultOpen>
        {sortedBonuses.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No bonuses for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
            {sortedBonuses.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedBonuses.length - 1 ? '1px solid var(--m-border, var(--border-mobile))' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.notes || 'Bonus'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      {/* ── Reimbursements ──────────────────────────────────────────────── */}
      <MobileSection title="Reimbursements" count={sortedReimbs.length} collapsible defaultOpen>
        {sortedReimbs.length === 0 ? (
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No reimbursements for this period</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
            {sortedReimbs.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: idx < sortedReimbs.length - 1 ? '1px solid var(--m-border, var(--border-mobile))' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusDot status={entry.status} />
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</span>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
