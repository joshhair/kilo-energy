'use client';

import { use, useState, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { useApp } from '../../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileRepDetail from '../../mobile/MobileRepDetail';
import { getTrainerOverrideRate, TrainerOverrideTier } from '../../../../lib/data';
import { formatDate } from '../../../../lib/utils';
import { useToast } from '../../../../lib/toast';
import { PaginationBar } from '../../components/PaginationBar';
import { ChevronRight, ChevronLeft, Pencil, Check, X, Plus, Trash2, FolderKanban, UserCheck, UserPlus, TrendingUp, TrendingDown } from 'lucide-react';
import { RepSelector } from '../../components/RepSelector';
import { Sparkline } from '../../../../lib/sparkline';

export default function RepDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projects, payrollEntries, trainerAssignments, setTrainerAssignments, currentRole, effectiveRole, currentRepId, reps } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const hydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Pagination state — payment history
  const [payPage, setPayPage] = useState(1);
  const [payPageSize, setPayPageSize] = useState(10);
  // Pagination state — projects
  const [projPage, setProjPage] = useState(1);
  const [projPageSize, setProjPageSize] = useState(10);
  // Trainer assignment picker state
  const [showTrainerPicker, setShowTrainerPicker] = useState(false);

  const rep = reps.find((r) => r.id === id);
  useEffect(() => { document.title = rep ? `${rep.name} | Kilo Energy` : 'Rep Detail | Kilo Energy'; }, [rep?.name]);

  if (!hydrated) return <RepDetailSkeleton />;

  if (isMobile) return <MobileRepDetail repId={id} />;

  if (currentRole !== 'admin' && currentRole !== 'project_manager' && id !== currentRepId) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        You don&apos;t have permission to view this page.
      </div>
    );
  }

  if (!rep) {
    return (
      <div className="p-8 text-slate-500 text-center">
        Rep not found.{' '}
        <Link href="/dashboard/reps" className="text-blue-400 hover:underline">
          Back to Reps
        </Link>
      </div>
    );
  }

  const repProjects = projects.filter((p) => p.repId === id || p.setterId === id);
  const repPayroll = payrollEntries.filter((p) => p.repId === id);

  // Payment history pagination
  const payTotal = repPayroll.length;
  const payTotalPages = Math.max(1, Math.ceil(payTotal / payPageSize));
  const paySafePage = Math.min(payPage, payTotalPages);
  const payStart = (paySafePage - 1) * payPageSize;
  const payEnd = Math.min(payStart + payPageSize, payTotal);
  const pagedPayroll = repPayroll.slice(payStart, payEnd);

  // Projects pagination
  const projTotal = repProjects.length;
  const projTotalPages = Math.max(1, Math.ceil(projTotal / projPageSize));
  const projSafePage = Math.min(projPage, projTotalPages);
  const projStart = (projSafePage - 1) * projPageSize;
  const projEnd = Math.min(projStart + projPageSize, projTotal);
  const pagedProjects = repProjects.slice(projStart, projEnd);

  const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
  const totalEst = repProjects.reduce((s, p) => s + p.m1Amount + p.m2Amount, 0);
  const totalPaid = repPayroll.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = repPayroll.filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0);
  const activeProjects = repProjects.filter((p) => !['Cancelled', 'Completed'].includes(p.phase));

  // ── 6-month earnings sparkline data ───────────────────────────────────────
  const monthlyEarnings = (() => {
    const now = new Date();
    const months: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const total = repPayroll
        .filter((p) => p.date.startsWith(key))
        .reduce((s, p) => s + p.amount, 0);
      months.push(total);
    }
    return months;
  })();

  // ── Month-over-month trend for Total Deals and Total kW ───────────────────
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthDeals = repProjects.filter((p) => p.soldDate.startsWith(thisMonthKey)).length;
  const prevMonthDeals = repProjects.filter((p) => p.soldDate.startsWith(prevMonthKey)).length;
  const thisMonthKW = repProjects.filter((p) => p.soldDate.startsWith(thisMonthKey)).reduce((s, p) => s + p.kWSize, 0);
  const prevMonthKW = repProjects.filter((p) => p.soldDate.startsWith(prevMonthKey)).reduce((s, p) => s + p.kWSize, 0);
  const dealsTrend = thisMonthDeals - prevMonthDeals; // positive = up, negative = down
  const kwTrend = thisMonthKW - prevMonthKW;

  const assignment = trainerAssignments.find((a) => a.traineeId === id);
  const trainerRep = assignment ? reps.find((r) => r.id === assignment.trainerId) : null;
  const completedDeals = repProjects.length;
  const currentOverrideRate = assignment ? getTrainerOverrideRate(assignment, completedDeals) : 0;

  const initials = rep.name.split(' ').map((n) => n[0]).join('');

  return (
    <div className="p-4 md:p-8 max-w-4xl animate-fade-in-up">
      {/* Breadcrumb */}
      <nav className="animate-breadcrumb-enter flex items-center gap-1.5 text-xs text-slate-500 mb-6">
        <Link href="/dashboard" className="hover:text-slate-300 transition-colors">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href="/dashboard/reps" className="hover:text-slate-300 transition-colors">Reps</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-300">{rep.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
          style={{ backgroundColor: 'var(--brand-dark)' }}
        >
          {initials}
        </div>
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-blue-500/15">
              <UserCheck className="w-5 h-5 text-blue-400" />
            </span>
            <h1 className="text-3xl font-black tracking-tight text-gradient-brand">{rep.name}</h1>
          </div>
          <p className="text-slate-400 text-sm mt-1">{rep.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Deals',    value: repProjects.length,              color: 'text-blue-400',    accentColor: 'rgba(59,130,246,0.08)',  glowClass: 'stat-glow-blue',    accentGradient: 'from-blue-500 to-blue-400', trend: dealsTrend, sparkData: null as number[] | null, sparkStroke: '' },
          { label: 'Active Pipeline', value: activeProjects.length,          color: 'text-blue-400',    accentColor: 'rgba(59,130,246,0.08)',  glowClass: 'stat-glow-blue',    accentGradient: 'from-blue-500 to-blue-400', trend: null as number | null, sparkData: null as number[] | null, sparkStroke: '' },
          { label: 'Total kW',       value: `${totalKW.toFixed(1)} kW`,      color: 'text-yellow-400',  accentColor: 'rgba(234,179,8,0.08)',   glowClass: 'stat-glow-yellow',  accentGradient: 'from-yellow-500 to-yellow-400', trend: kwTrend, sparkData: null as number[] | null, sparkStroke: '' },
          ...(!isPM ? [{ label: 'Estimated Pay',  value: `$${totalEst.toLocaleString()}`, color: 'text-emerald-400', accentColor: 'rgba(16,185,129,0.08)', glowClass: 'stat-glow-emerald', accentGradient: 'from-emerald-500 to-emerald-400', trend: null as number | null, sparkData: monthlyEarnings, sparkStroke: '#10b981' }] : []),
        ].map((s) => (
          <div
            key={s.label}
            className="card-surface card-surface-stat rounded-2xl p-4 transition-all duration-200 hover:translate-y-[-2px]"
            style={{ '--card-accent': s.accentColor } as CSSProperties}
          >
            <div className={`h-[2px] w-8 rounded-full bg-gradient-to-r mb-2 ${s.accentGradient}`} />
            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <div className="flex items-center gap-2">
              <p className={`stat-value stat-value-glow ${s.glowClass} text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              {s.trend !== null && s.trend > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                  <TrendingUp className="w-2.5 h-2.5" /> +{s.label === 'Total kW' ? s.trend.toFixed(1) : s.trend}
                </span>
              )}
              {s.trend !== null && s.trend < 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">
                  <TrendingDown className="w-2.5 h-2.5" /> {s.label === 'Total kW' ? s.trend.toFixed(1) : s.trend}
                </span>
              )}
            </div>
            {s.sparkData && <Sparkline data={s.sparkData} stroke={s.sparkStroke} />}
          </div>
        ))}
      </div>

      {/* ── Assign / View Trainer (admin only) ──────────────────────────── */}
      {currentRole === 'admin' && (
        <div className="card-surface rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-400" />
              <h2 className="text-white font-semibold text-sm">Trainer Assignment</h2>
            </div>
            {!assignment && !showTrainerPicker && (
              <button
                onClick={() => setShowTrainerPicker(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Assign Trainer
              </button>
            )}
          </div>

          {/* Already assigned — show trainer name + remove */}
          {assignment && trainerRep && (
            <div className="flex items-center justify-between mt-3 bg-slate-800/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {trainerRep.name.split(' ').map((n: string) => n[0]).join('')}
                </span>
                <div>
                  <p className="text-white text-sm font-medium">{trainerRep.name}</p>
                  <p className="text-slate-500 text-xs">Trainer &middot; ${currentOverrideRate.toFixed(2)}/W</p>
                </div>
              </div>
              <button
                onClick={() => setTrainerAssignments((prev) => prev.filter((a) => a.id !== assignment.id))}
                className="text-slate-500 hover:text-red-400 transition-colors text-xs font-medium flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          )}

          {/* No assignment — show picker */}
          {!assignment && showTrainerPicker && (
            <div className="mt-3">
              <RepSelector
                value=""
                onChange={(trainerId) => {
                  if (!trainerId) { setShowTrainerPicker(false); return; }
                  setTrainerAssignments((prev) => [
                    ...prev,
                    {
                      id: `ta_${Date.now()}`,
                      trainerId,
                      traineeId: id,
                      tiers: [{ upToDeal: null, ratePerW: 0.05 }],
                    },
                  ]);
                  setShowTrainerPicker(false);
                }}
                reps={reps}
                placeholder="-- Select trainer --"
                clearLabel="Cancel"
                filterFn={(r) => r.id !== id}
              />
            </div>
          )}

          {/* No assignment and picker not shown — info message */}
          {!assignment && !showTrainerPicker && (
            <p className="text-slate-500 text-xs mt-2">No trainer assigned to this rep.</p>
          )}
        </div>
      )}

      {/* Trainer Override Card */}
      {assignment && trainerRep && (
        <TrainerOverrideCard
          assignment={assignment}
          trainerName={trainerRep.name}
          completedDeals={completedDeals}
          currentRate={currentOverrideRate}
          isAdmin={currentRole === 'admin'}
          onUpdate={(updatedTiers) => {
            setTrainerAssignments((prev) =>
              prev.map((a) =>
                a.id === assignment.id ? { ...a, tiers: updatedTiers } : a
              )
            );
          }}
        />
      )}

      {/* Commission roles table */}
      {!isPM && <div className="card-surface rounded-2xl p-5 mb-6">
        <h2 className="text-white font-semibold mb-4">Commission by Role</h2>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-slate-800">
              <th className="text-left py-2 text-slate-400 font-medium">Role</th>
              <th className="text-left py-2 text-slate-400 font-medium">Deals</th>
              <th className="text-left py-2 text-slate-400 font-medium">Total Earned</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const closerDeals = projects.filter((p) => p.repId === id);
              const setterDeals = projects.filter((p) => p.setterId === id);
              const trainerDeals = trainerAssignments.filter((a) => a.trainerId === id);
              const closerPay = repPayroll
                .filter((e) => e.type === 'Deal' && e.notes !== 'Setter' && e.notes !== 'Trainer override')
                .reduce((s, e) => s + e.amount, 0);
              const setterPay = repPayroll
                .filter((e) => e.notes === 'Setter')
                .reduce((s, e) => s + e.amount, 0);
              const trainerPay = repPayroll
                .filter((e) => e.notes === 'Trainer override')
                .reduce((s, e) => s + e.amount, 0);
              return (
                <>
                  <tr className="table-row-enter row-stagger-0 relative border-b border-slate-800/50 even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Closer</td>
                    <td className="py-2.5 text-slate-400">{closerDeals.length}</td>
                    <td className="py-2.5 text-emerald-400 font-semibold">${closerPay.toLocaleString()}</td>
                  </tr>
                  <tr className="table-row-enter row-stagger-1 relative border-b border-slate-800/50 even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Setter</td>
                    <td className="py-2.5 text-slate-400">{setterDeals.length}</td>
                    <td className="py-2.5 text-emerald-400 font-semibold">${setterPay.toLocaleString()}</td>
                  </tr>
                  <tr className="table-row-enter row-stagger-2 relative even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="py-2.5 text-white">Trainer</td>
                    <td className="py-2.5 text-slate-400">
                      {trainerDeals.length > 0 ? `${trainerDeals.length} trainee(s)` : '0'}
                    </td>
                    <td className="py-2.5 text-emerald-400 font-semibold">${trainerPay.toLocaleString()}</td>
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>
      </div>}

      {/* Payment history */}
      {!isPM && <div className="card-surface rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-white font-semibold">Payment History</h2>
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-400">Paid: ${totalPaid.toLocaleString()}</span>
            <span className="text-yellow-400">Pending: ${totalPending.toLocaleString()}</span>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-slate-800">
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Customer / Notes</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Type</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Stage</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Amount</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Status</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {pagedPayroll.map((entry, i) => (
              <tr key={entry.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-slate-800/50 even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                <td className="px-5 py-3 text-white">
                  {entry.customerName || entry.notes || '—'}
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    entry.type === 'Bonus' ? 'bg-blue-900/50 text-blue-400' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {entry.type}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded font-medium">
                    {entry.paymentStage}
                  </span>
                </td>
                <td className="px-5 py-3 text-emerald-400 font-semibold">
                  ${entry.amount.toLocaleString()}
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={entry.status} />
                </td>
                <td className="px-5 py-3 text-slate-500">{formatDate(entry.date)}</td>
              </tr>
            ))}
            {repPayroll.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  No payment history.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {repPayroll.length > 0 && (
          <PaginationBar totalResults={payTotal} startIdx={payStart} endIdx={payEnd}
            currentPage={paySafePage} totalPages={payTotalPages} rowsPerPage={payPageSize}
            onPageChange={setPayPage} onRowsPerPageChange={(n) => { setPayPageSize(n); setPayPage(1); }} />
        )}
      </div>}

      {/* Projects table */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">All Projects</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
            <tr className="border-b border-slate-800">
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Customer</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Role</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Phase</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">Installer</th>
              <th className="text-left px-5 py-3 text-slate-400 font-medium">kW</th>
              {!isPM && <th className="text-left px-5 py-3 text-slate-400 font-medium">Est. Pay</th>}
            </tr>
          </thead>
          <tbody>
            {pagedProjects.map((proj, i) => (
              <tr key={proj.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative border-b border-slate-800/50 even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center`}>
                <td className="px-5 py-3">
                  <Link href={`/dashboard/projects/${proj.id}`} className="text-white hover:text-blue-400 transition-colors">
                    {proj.customerName}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs text-slate-400">
                    {proj.repId === id ? 'Closer' : 'Setter'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <PhaseBadge phase={proj.phase} />
                </td>
                <td className="px-5 py-3 text-slate-400">{proj.installer}</td>
                <td className="px-5 py-3 text-slate-300">{proj.kWSize}</td>
                {!isPM && (
                  <td className="px-5 py-3 text-emerald-400 font-semibold">
                    ${(proj.m1Amount + proj.m2Amount).toLocaleString()}
                  </td>
                )}
              </tr>
            ))}
            {repProjects.length === 0 && (
              <tr>
                <td colSpan={isPM ? 5 : 6} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center">
                      <FolderKanban className="w-6 h-6 text-slate-600 animate-pulse" />
                    </div>
                    <p className="text-slate-400 text-sm font-medium">This rep has no deals yet</p>
                    <p className="text-slate-600 text-xs">Projects assigned to this rep will appear here.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {repProjects.length > 0 && (
          <PaginationBar totalResults={projTotal} startIdx={projStart} endIdx={projEnd}
            currentPage={projSafePage} totalPages={projTotalPages} rowsPerPage={projPageSize}
            onPageChange={setProjPage} onRowsPerPageChange={(n) => { setProjPageSize(n); setProjPage(1); }} />
        )}
      </div>
    </div>
  );
}

// --- Trainer Override Card ---

interface TrainerOverrideCardProps {
  assignment: { id: string; trainerId: string; traineeId: string; tiers: TrainerOverrideTier[] };
  trainerName: string;
  completedDeals: number;
  currentRate: number;
  isAdmin: boolean;
  onUpdate: (tiers: TrainerOverrideTier[]) => void;
}

function TrainerOverrideCard({
  assignment,
  trainerName,
  completedDeals,
  currentRate,
  isAdmin,
  onUpdate,
}: TrainerOverrideCardProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftTiers, setDraftTiers] = useState<TrainerOverrideTier[]>([...assignment.tiers]);

  const updateTier = (index: number, field: keyof TrainerOverrideTier, value: string) => {
    setDraftTiers((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        if (field === 'upToDeal') {
          return { ...t, upToDeal: value === '' ? null : parseInt(value) || null };
        }
        return { ...t, ratePerW: parseFloat(value) || 0 };
      })
    );
  };

  const addTier = () => {
    setDraftTiers((prev) => {
      const updated = prev.map((t, i) =>
        i === prev.length - 1 && t.upToDeal === null
          ? { ...t, upToDeal: completedDeals + 10 }
          : t
      );
      return [...updated, { upToDeal: null, ratePerW: 0.05 }];
    });
  };

  const removeTier = (index: number) => {
    if (draftTiers.length <= 1) return;
    setDraftTiers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next[next.length - 1].upToDeal !== null) {
        next[next.length - 1] = { ...next[next.length - 1], upToDeal: null };
      }
      return next;
    });
  };

  const save = () => { onUpdate(draftTiers); setEditing(false); toast('Trainer override updated', 'success'); };
  const cancel = () => { setDraftTiers([...assignment.tiers]); setEditing(false); };

  const activeTierIndex = assignment.tiers.findIndex(
    (t) => t.upToDeal === null || completedDeals < t.upToDeal
  );

  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-semibold">Trainer Override</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            Trainer: <span className="text-amber-400">{trainerName}</span>
            <span className="text-slate-600 mx-2">·</span>
            Current rate: <span className="text-amber-400 font-semibold">${currentRate.toFixed(2)}/W</span>
            <span className="text-slate-600 mx-2">·</span>
            {completedDeals} deal{completedDeals !== 1 ? 's' : ''} completed
          </p>
        </div>
        {isAdmin && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button onClick={save} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm transition-colors">
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
            <button onClick={cancel} className="flex items-center gap-1 text-slate-500 hover:text-slate-300 text-sm transition-colors">
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(editing ? draftTiers : assignment.tiers).map((tier, i) => {
          const isActive = i === activeTierIndex;
          const prevUpTo = i === 0 ? 0 : (assignment.tiers[i - 1].upToDeal ?? 0);
          const dealRange = editing
            ? null
            : tier.upToDeal === null
            ? `Deal ${prevUpTo + 1}+`
            : `Deals ${prevUpTo + 1}–${tier.upToDeal}`;

          return (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                isActive && !editing
                  ? 'bg-amber-500/10 border border-amber-500/30'
                  : 'bg-slate-800/50'
              }`}
            >
              {!editing ? (
                <>
                  <span className={`text-sm flex-1 ${isActive ? 'text-amber-300' : 'text-slate-400'}`}>
                    {dealRange}
                  </span>
                  <span className={`font-semibold text-sm ${isActive ? 'text-amber-400' : 'text-slate-300'}`}>
                    ${tier.ratePerW.toFixed(2)}/W
                  </span>
                  {isActive && (
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-lg">
                      Active
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-slate-500 text-xs w-16">Tier {i + 1}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-slate-500 text-xs">Up to deal</span>
                    <input
                      type="number"
                      min="1"
                      placeholder="∞"
                      value={tier.upToDeal ?? ''}
                      onChange={(e) => updateTier(i, 'upToDeal', e.target.value)}
                      disabled={i === draftTiers.length - 1}
                      className="w-20 bg-slate-700 border border-slate-600 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-40"
                    />
                    {i === draftTiers.length - 1 && (
                      <span className="text-slate-500 text-xs">(perpetual)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tier.ratePerW}
                      onChange={(e) => updateTier(i, 'ratePerW', e.target.value)}
                      className="w-20 bg-slate-700 border border-slate-600 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <span className="text-slate-500 text-xs">/W</span>
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    disabled={draftTiers.length <= 1}
                    className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}

        {editing && (
          <button
            onClick={addTier}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs mt-2 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add tier
          </button>
        )}
      </div>
    </div>
  );
}

// ── Rep Detail Skeleton ───────────────────────────────────────────────────────

function RepDetailSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-6">
        <div className="h-3 w-16 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '0ms' }} />
        <div className="h-3 w-3 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '25ms' }} />
        <div className="h-3 w-10 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '50ms' }} />
        <div className="h-3 w-3 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        <div className="h-3 w-24 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '100ms' }} />
      </div>

      {/* Header — avatar + name */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-slate-800 animate-skeleton flex-shrink-0" style={{ animationDelay: '100ms' }} />
        <div>
          <div className="h-[3px] w-12 rounded-full bg-slate-700 animate-skeleton mb-3" style={{ animationDelay: '150ms' }} />
          <div className="h-7 w-48 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '200ms' }} />
          <div className="h-4 w-56 bg-slate-800/60 rounded animate-skeleton mt-1.5" style={{ animationDelay: '250ms' }} />
        </div>
      </div>

      {/* Stat cards — 4-column grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map((cardIdx) => {
          const base = 300 + cardIdx * 50;
          return (
            <div key={cardIdx} className="card-surface rounded-2xl p-4">
              <div className="h-[2px] w-8 rounded-full bg-slate-700 animate-skeleton mb-2" style={{ animationDelay: `${base}ms` }} />
              <div className="h-3 w-20 bg-slate-800/80 rounded animate-skeleton mb-2" style={{ animationDelay: `${base + 30}ms` }} />
              <div className="h-6 w-24 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${base + 60}ms` }} />
            </div>
          );
        })}
      </div>

      {/* Table skeleton — Payment History */}
      <div className="card-surface rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="h-5 w-36 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '550ms' }} />
          <div className="flex gap-4">
            <div className="h-4 w-24 bg-slate-800/60 rounded animate-skeleton" style={{ animationDelay: '575ms' }} />
            <div className="h-4 w-28 bg-slate-800/60 rounded animate-skeleton" style={{ animationDelay: '600ms' }} />
          </div>
        </div>
        {/* Header row */}
        <div className="border-b border-slate-800 px-5 py-3 flex gap-4">
          {[96, 56, 56, 64, 56, 64].map((w, i) => (
            <div key={i} className="h-4 bg-slate-700/70 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${625 + i * 30}ms` }} />
          ))}
        </div>
        {/* 6 placeholder rows */}
        {[0, 1, 2, 3, 4, 5].map((rowIdx) => {
          const delay = 700 + rowIdx * 40;
          return (
            <div key={rowIdx} className={`border-b border-slate-800/50 px-5 py-3.5 flex gap-4 items-center ${rowIdx % 2 !== 0 ? 'bg-slate-800/20' : ''}`}>
              {[120, 48, 48, 56, 52, 56].map((w, colIdx) => (
                <div key={colIdx} className="h-4 bg-slate-800/60 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 20}ms` }} />
              ))}
            </div>
          );
        })}
      </div>

      {/* Table skeleton — All Projects */}
      <div className="card-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="h-5 w-28 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '950ms' }} />
        </div>
        {/* Header row */}
        <div className="border-b border-slate-800 px-5 py-3 flex gap-4">
          {[80, 48, 56, 72, 40, 64].map((w, i) => (
            <div key={i} className="h-4 bg-slate-700/70 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${975 + i * 30}ms` }} />
          ))}
        </div>
        {/* 6 placeholder rows */}
        {[0, 1, 2, 3, 4, 5].map((rowIdx) => {
          const delay = 1050 + rowIdx * 40;
          return (
            <div key={rowIdx} className={`border-b border-slate-800/50 px-5 py-3.5 flex gap-4 items-center ${rowIdx % 2 !== 0 ? 'bg-slate-800/20' : ''}`}>
              {[100, 44, 56, 64, 36, 56].map((w, colIdx) => (
                <div key={colIdx} className="h-4 bg-slate-800/60 rounded animate-skeleton" style={{ width: `${w}px`, animationDelay: `${delay + colIdx * 20}ms` }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PHASE_PILL: Record<string, { gradient: string; border: string; shadow: string; text: string; dot: string }> = {
  'New':             { gradient: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         border: 'border-sky-700/30',      shadow: 'shadow-[0_0_6px_rgba(14,165,233,0.15)]',  text: 'text-sky-300',     dot: 'bg-sky-400'     },
  'Acceptance':      { gradient: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    border: 'border-indigo-700/30',   shadow: 'shadow-[0_0_6px_rgba(99,102,241,0.15)]',  text: 'text-indigo-300',  dot: 'bg-indigo-400'  },
  'Site Survey':     { gradient: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    border: 'border-violet-700/30',   shadow: 'shadow-[0_0_6px_rgba(139,92,246,0.15)]',  text: 'text-violet-300',  dot: 'bg-violet-400'  },
  'Design':          { gradient: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  border: 'border-fuchsia-700/30',  shadow: 'shadow-[0_0_6px_rgba(217,70,239,0.15)]',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  'Permitting':      { gradient: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      border: 'border-amber-700/30',    shadow: 'shadow-[0_0_6px_rgba(245,158,11,0.15)]',  text: 'text-amber-300',   dot: 'bg-amber-400'   },
  'Pending Install': { gradient: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    border: 'border-orange-700/30',   shadow: 'shadow-[0_0_6px_rgba(249,115,22,0.15)]',  text: 'text-orange-300',  dot: 'bg-orange-400'  },
  'Installed':       { gradient: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        border: 'border-teal-700/30',     shadow: 'shadow-[0_0_6px_rgba(20,184,166,0.15)]',  text: 'text-teal-300',    dot: 'bg-teal-400'    },
  'PTO':             { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  border: 'border-emerald-700/30',  shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]',  text: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Completed':       { gradient: 'bg-gradient-to-r from-green-900/50 to-green-800/30',      border: 'border-green-600/40',    shadow: 'shadow-[0_0_8px_rgba(34,197,94,0.25)]',   text: 'text-green-300',   dot: 'bg-green-400'   },
  'Cancelled':       { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',          border: 'border-red-700/30',      shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.15)]',   text: 'text-red-300',     dot: 'bg-red-400'     },
  'On Hold':         { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',    border: 'border-yellow-700/30',   shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',   text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
};

function PhaseBadge({ phase }: { phase: string }) {
  const s = PHASE_PILL[phase] ?? { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-slate-600/30', shadow: '', text: 'text-slate-300', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {phase}
    </span>
  );
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Paid:    { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Pending: { bg: 'bg-yellow-500/10 border-yellow-500/20',   text: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  Draft:   { bg: 'bg-slate-500/10 border-slate-500/20',     text: 'text-slate-400',   dot: 'bg-slate-400'   },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}
