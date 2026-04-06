'use client';

import { useState, useRef, useEffect, Suspense, type CSSProperties } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useFocusTrap, useMediaQuery } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { PayrollEntry } from '../../../lib/data';
import { formatDate, downloadCSV, fmt$ } from '../../../lib/utils';
import { RelativeDate } from '../components/RelativeDate';
import { X, CreditCard, AlertTriangle, Receipt, Check, Filter, ArrowRight, Download, Printer } from 'lucide-react';
import { PaginationBar } from '../components/PaginationBar';
import { RepSelector } from '../components/RepSelector';
import { SearchableSelect } from '../components/SearchableSelect';
import { DateRangeFilter } from '../components/DateRangeFilter';
import Link from 'next/link';
import MobilePayroll from '../mobile/MobilePayroll';

type StatusTab = 'Draft' | 'Pending' | 'Paid';
type TypeTab = 'Deal' | 'Bonus';
type PageView = 'payroll' | 'reimbursements';

/** Maps accent-gradient strings to an RGBA radial glow colour for --card-accent */
const ACCENT_COLOR_MAP: Record<string, string> = {
  'from-blue-500 to-blue-400':       'rgba(59,130,246,0.08)',
  'from-emerald-500 to-emerald-400': 'rgba(16,185,129,0.08)',
  'from-yellow-500 to-yellow-400':   'rgba(234,179,8,0.08)',
};

/** Returns the Tailwind gradient string that matches the active status tab */
const STATUS_ACCENT: Record<StatusTab, string> = {
  Draft:   'from-blue-500 to-blue-400',
  Pending: 'from-yellow-500 to-yellow-400',
  Paid:    'from-emerald-500 to-emerald-400',
};

const PRINT_STYLES = `
@media print {
  aside, nav, .tab-bar-container, button, [role="dialog"], .toast-item,
  [aria-label="Back to top"], [aria-label="Open navigation menu"] { display: none !important; }
  body, main, div { background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card-surface, .card-surface-stat { background: white !important; border: 1px solid #ddd !important; box-shadow: none !important; backdrop-filter: none !important; }
  table { width: 100% !important; border-collapse: collapse !important; }
  th, td { border: 1px solid #ccc !important; padding: 6px 10px !important; color: black !important; background: white !important; font-size: 11px !important; }
  th { background: #f0f0f0 !important; font-weight: 600 !important; }
  .text-gradient-brand, .text-gradient-emerald, .text-gradient-gold { background: none !important; -webkit-background-clip: unset !important; -webkit-text-fill-color: black !important; background-clip: unset !important; }
  .stat-value, .stat-value-glow { text-shadow: none !important; color: black !important; }
  main { padding: 0 !important; overflow: visible !important; width: 100% !important; }
  main::before { content: 'Kilo Energy — Payroll Summary'; display: block; text-align: center; font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 2px solid #333; margin-bottom: 16px; }
  * { animation: none !important; transition: none !important; }
  @page { margin: 1cm; size: landscape; }
}`;

export default function PayrollPage() {
  return (
    <Suspense>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <PayrollPageInner />
    </Suspense>
  );
}

function PayrollPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentRole, effectiveRole, currentRepId, payrollEntries, setPayrollEntries, markForPayroll, reps, projects, reimbursements, setReimbursements } = useApp();
  const { toast } = useToast();
  const isHydrated = useIsHydrated();
  useEffect(() => { document.title = 'Payroll | Kilo Energy'; }, []);

  // URL-persisted state
  const initialStatus = (searchParams.get('status') ?? 'Draft') as StatusTab;
  const initialType = (searchParams.get('type') ?? 'Deal') as TypeTab;
  const initialRep = searchParams.get('rep') ?? '';

  const [pageView, setPageView] = useState<PageView>('payroll');
  const [statusTab, setStatusTab] = useState<StatusTab>(['Draft', 'Pending', 'Paid'].includes(initialStatus) ? initialStatus : 'Draft');
  const [typeTab, setTypeTab] = useState<TypeTab>(['Deal', 'Bonus'].includes(initialType) ? initialType : 'Deal');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [bonusForm, setBonusForm] = useState({ repId: '', amount: '', notes: '', date: '' });
  const [paymentForm, setPaymentForm] = useState({ repId: '', projectId: '', amount: '', stage: 'M1' as 'M1' | 'M2' | 'M3', date: '', notes: '' });
  const bonusPanelRef = useRef<HTMLDivElement>(null);
  const paymentPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(bonusPanelRef, showBonusModal);
  useFocusTrap(paymentPanelRef, showPaymentModal);

  // Reimbursements date filter
  const [reimFilterFrom, setReimFilterFrom] = useState('');
  const [reimFilterTo, setReimFilterTo] = useState('');

  // Payroll entries date filter
  const [payFilterFrom, setPayFilterFrom] = useState('');
  const [payFilterTo, setPayFilterTo] = useState('');

  // Pagination for admin payroll table
  const [adminPage, setAdminPage] = useState(1);
  const [adminRowsPerPage, setAdminRowsPerPage] = useState(25);

  // Rep filter (admin)
  const [filterRepId, setFilterRepId] = useState(initialRep);

  // Wrappers that sync tab/filter state to URL params
  const changeStatusTab = (v: StatusTab) => {
    setStatusTab(v);
    setSelectedIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const changeTypeTab = (v: TypeTab) => {
    setTypeTab(v);
    setSelectedIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const changeFilterRepId = (v: string) => {
    setFilterRepId(v);
    setSelectedIds(new Set());
    setAdminPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set('rep', v); else params.delete('rep');
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Page view tab indicators
  const pageViewRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pageViewIndicator, setPageViewIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = pageView === 'payroll' ? 0 : 1;
    const el = pageViewRefs.current[idx];
    if (el) setPageViewIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [pageView]);

  // Sliding tab indicators
  const statusTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [statusIndicator, setStatusIndicator] = useState<{ left: number; width: number } | null>(null);
  const typeTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [typeIndicator, setTypeIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const STATUS_TABS: StatusTab[] = ['Draft', 'Pending', 'Paid'];
    const idx = STATUS_TABS.indexOf(statusTab);
    const el = statusTabRefs.current[idx];
    if (el) setStatusIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [statusTab]);

  useEffect(() => {
    const TYPE_TABS: TypeTab[] = ['Deal', 'Bonus'];
    const idx = TYPE_TABS.indexOf(typeTab);
    const el = typeTabRefs.current[idx];
    if (el) setTypeIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [typeTab]);

  // Keyboard shortcuts: Escape → deselect, Enter → mark for payroll, Shift+A → select/deselect all
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip if an input element is focused
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        if (e.key === 'Escape') setSelectedIds(new Set());
        return;
      }

      if (e.key === 'Escape') {
        setSelectedIds(new Set());
        return;
      }

      // Enter → trigger "Mark for Payroll" when Draft entries are selected
      if (e.key === 'Enter' && statusTab === 'Draft' && selectedIds.size > 0) {
        e.preventDefault();
        handleMarkForPayroll();
        return;
      }

      // Shift+A → select/deselect all in current filtered view
      if (e.shiftKey && e.key.toUpperCase() === 'A') {
        e.preventDefault();
        selectAll();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab, selectedIds, payrollEntries, typeTab, payFilterFrom, payFilterTo]);

  const isMobile = useMediaQuery('(max-width: 767px)');
  if (isMobile) return <MobilePayroll />;

  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[#8891a8] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  const filtered = payrollEntries.filter((p) => {
    if (p.status !== statusTab || p.type !== typeTab) return false;
    if (payFilterFrom && p.date < payFilterFrom) return false;
    if (payFilterTo && p.date > payFilterTo) return false;
    if (filterRepId && p.repId !== filterRepId) return false;
    return true;
  });

  const filteredByDateRep = payrollEntries.filter((p) => {
    if (p.type !== typeTab) return false;
    if (payFilterFrom && p.date < payFilterFrom) return false;
    if (payFilterTo && p.date > payFilterTo) return false;
    if (filterRepId && p.repId !== filterRepId) return false;
    return true;
  });
  const totalDraft = filteredByDateRep.filter((p) => p.status === 'Draft').reduce((s, p) => s + p.amount, 0);
  const totalPending = filteredByDateRep.filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0);
  const totalPaid = filteredByDateRep.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);

  // Paginate the flat filtered list, then re-group by rep for display
  const adminTotalPages = Math.max(1, Math.ceil(filtered.length / adminRowsPerPage));
  const adminStartIdx = (adminPage - 1) * adminRowsPerPage;
  const adminEndIdx = Math.min(adminStartIdx + adminRowsPerPage, filtered.length);
  const paginatedFiltered = filtered.slice(adminStartIdx, adminEndIdx);

  // repGroups removed — flat table rendering uses paginatedFiltered directly

  // Derived selection state — used by the floating action bar
  const selectedTotal = filtered
    .filter((e) => selectedIds.has(e.id))
    .reduce((s, e) => s + e.amount, 0);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  // Floating toolbar is visible whenever one or more Draft entries are selected
  const showActionBar = pageView === 'payroll' && selectedIds.size > 0;

  const handlePublish = async () => {
    // Publish only Pending entries matching the active filters (same set the button's disabled state reflects)
    const pendingVisible = filteredByDateRep.filter((e) => e.status === 'Pending');
    const ids = pendingVisible.map((e) => e.id);
    const amount = pendingVisible.reduce((s, e) => s + e.amount, 0);
    // Save snapshot for rollback
    const snapshot = [...payrollEntries];
    setPayrollEntries((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, status: 'Paid' } : p))
    );
    setShowPublishConfirm(false);
    toast(`Payroll published — $${amount.toLocaleString()} marked as Paid`, 'success');
    // Persist to DB via bulk endpoint for atomicity
    const res = await fetch('/api/payroll', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status: 'Paid' }),
    });
    if (!res.ok) {
      console.error('[handlePublish] Bulk PATCH failed:', res.status);
      setPayrollEntries(snapshot);
      toast(`Payroll failed to save — rolled back`, 'error');
    }
  };

  const handleMarkForPayroll = () => {
    const amount = filtered
      .filter((e) => selectedIds.has(e.id))
      .reduce((s, e) => s + e.amount, 0);
    markForPayroll(Array.from(selectedIds));
    setSelectedIds(new Set());
    changeStatusTab('Pending');
    toast(`${selectedIds.size} entries moved to Pending — $${amount.toLocaleString()}`, 'success');
  };

  const toggleEntry = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleRepGroup = (entries: PayrollEntry[]) => {
    const ids = entries.map((e) => e.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectAll = () => {
    const allIds = filtered.map((e) => e.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const handleAddBonus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bonusForm.repId) { toast('Please select a rep', 'error'); return; }
    if (!bonusForm.amount || isNaN(parseFloat(bonusForm.amount))) { toast('Enter a valid amount', 'error'); return; }
    const rep = reps.find((r) => r.id === bonusForm.repId);
    const newEntry: PayrollEntry = {
      id: `pay_${Date.now()}`,
      repId: bonusForm.repId,
      repName: rep?.name ?? '',
      projectId: null,
      customerName: '',
      amount: parseFloat(bonusForm.amount),
      type: 'Bonus',
      paymentStage: 'Bonus',
      status: 'Draft',
      date: bonusForm.date || new Date().toISOString().split('T')[0],
      notes: bonusForm.notes,
    };
    setPayrollEntries((prev) => [...prev, newEntry]);
    setShowBonusModal(false);
    setBonusForm({ repId: '', amount: '', notes: '', date: '' });
    changeStatusTab('Draft');
    changeTypeTab('Bonus');
    toast(`Bonus added for ${rep?.name ?? 'rep'} — $${parseFloat(bonusForm.amount).toLocaleString()}`, 'success');
    // Persist to DB — rollback optimistic add on failure
    fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repId: newEntry.repId, amount: newEntry.amount, type: newEntry.type, paymentStage: newEntry.paymentStage, status: newEntry.status, date: newEntry.date, notes: newEntry.notes }),
    }).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = await res.json();
        if (saved?.id) {
          setPayrollEntries((prev) => prev.map((e) => e.id === newEntry.id ? { ...e, id: saved.id } : e));
        }
      })
      .catch((err) => {
        console.error(err);
        setPayrollEntries((prev) => prev.filter((e) => e.id !== newEntry.id));
        toast('Failed to save bonus — entry removed', 'error');
      });
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.repId) { toast('Please select a rep', 'error'); return; }
    if (!paymentForm.amount || isNaN(parseFloat(paymentForm.amount))) { toast('Enter a valid amount', 'error'); return; }
    const rep = reps.find((r) => r.id === paymentForm.repId);
    const project = projects.find((p) => p.id === paymentForm.projectId);
    const newEntry: PayrollEntry = {
      id: `pay_${Date.now()}_manual`,
      repId: paymentForm.repId,
      repName: rep?.name ?? '',
      projectId: paymentForm.projectId || null,
      customerName: project?.customerName ?? '',
      amount: parseFloat(paymentForm.amount),
      type: 'Deal',
      paymentStage: paymentForm.stage,
      status: 'Draft',
      date: paymentForm.date || new Date().toISOString().split('T')[0],
      notes: paymentForm.notes,
    };
    setPayrollEntries((prev) => [...prev, newEntry]);
    setShowPaymentModal(false);
    setPaymentForm({ repId: '', projectId: '', amount: '', stage: 'M1', date: '', notes: '' });
    changeStatusTab('Draft');
    changeTypeTab('Deal');
    toast(`Payment draft added for ${rep?.name ?? 'rep'} — $${parseFloat(paymentForm.amount).toLocaleString()}`, 'success');
    // Persist to DB — rollback optimistic add on failure
    fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repId: newEntry.repId, projectId: newEntry.projectId, amount: newEntry.amount, type: newEntry.type, paymentStage: newEntry.paymentStage, status: newEntry.status, date: newEntry.date, notes: newEntry.notes }),
    }).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = await res.json();
        if (saved?.id) {
          setPayrollEntries((prev) => prev.map((e) => e.id === newEntry.id ? { ...e, id: saved.id } : e));
        }
      })
      .catch((err) => {
        console.error(err);
        setPayrollEntries((prev) => prev.filter((e) => e.id !== newEntry.id));
        toast('Failed to save payment — entry removed', 'error');
      });
  };

  const inputCls = 'w-full bg-[#1d2028] border border-[#272b35] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-all duration-200 input-focus-glow';

  const labelCls = 'block text-xs font-medium text-[#c2c8d8] mb-1.5 uppercase tracking-wider';

  if (!isHydrated) {
    return <PayrollSkeleton />;
  }

  // ── Non-admin guard ──────────────────────────────────────────────────────────
  // Reps can view only their own entries in a read-only mode; no admin actions.
  const isAdmin = currentRole === 'admin';
  if (!isAdmin) {
    const myEntries = payrollEntries.filter((p) => p.repId === currentRepId);
    const myDraft = myEntries.filter((p) => p.status === 'Draft').reduce((s, p) => s + p.amount, 0);
    const myPending = myEntries.filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0);
    const myPaid = myEntries.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <CreditCard className="w-5 h-5 text-[#00e07a]" />
          </div>
          <div>
            <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>My Payroll</h1>
            <p className="text-[#c2c8d8] text-sm font-medium tracking-wide">Your commission and bonus payment history</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Draft" value={myDraft} color="text-[#c2c8d8]" accentGradient="from-blue-500 to-blue-400" className="animate-slide-in-scale stagger-1" />
          <StatCard label="Pending" value={myPending} color="text-yellow-400" accentGradient="from-yellow-500 to-yellow-400" className="animate-slide-in-scale stagger-2" />
          <StatCard label="Paid" value={myPaid} color="text-[#00e07a]" accentGradient="from-emerald-500 to-emerald-400" className="animate-slide-in-scale stagger-3" />
        </div>
        {myEntries.length === 0 ? (
          <div className="flex justify-center py-10">
            <div className="animate-fade-in w-60 border border-dashed border-[#333849] rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
              {/* Illustration — wallet with coins (no earnings yet) */}
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                {/* Wallet body */}
                <rect x="10" y="24" width="52" height="34" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
                <rect x="10" y="30" width="52" height="4" fill="#334155"/>
                {/* Coin pocket */}
                <rect x="44" y="34" width="18" height="16" rx="4" fill="#0f172a" stroke="#334155" strokeWidth="1.5"/>
                <circle cx="53" cy="42" r="4" fill="#1d2028" stroke="#00c4f0" strokeWidth="1.5" strokeOpacity="0.5"/>
                {/* Dashed lines — empty content indicator */}
                <line x1="17" y1="40" x2="36" y2="40" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                <line x1="17" y1="46" x2="30" y2="46" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2"/>
                {/* Dollar sign badge */}
                <circle cx="60" cy="22" r="9" fill="#1d2028" stroke="#00e07a" strokeWidth="1.5" strokeOpacity="0.5"/>
                <text x="60" y="26.5" textAnchor="middle" fill="#60a5fa" fontSize="11" fontWeight="bold" fontFamily="sans-serif">$</text>
              </svg>
              <p className="text-[#c2c8d8] text-sm font-semibold leading-snug text-center">No payroll entries yet</p>
              <p className="text-[#8891a8] text-xs leading-relaxed text-center">Your commissions and bonus payments will appear here once your admin processes them.</p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #272b35' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#1d2028', borderBottom: '1px solid #333849' }}>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8891a8' }}>Customer / Note</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8891a8' }}>Stage</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8891a8' }}>Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8891a8' }}>Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8891a8' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {myEntries.map((entry, i) => (
                  <tr key={entry.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150`} style={{ borderBottom: '1px solid #272b35', background: i % 2 === 0 ? '#161920' : '#191c24' }}>
                    <td className="px-5 py-3" style={{ color: '#c2c8d8' }}>
                      {entry.type === 'Deal' ? entry.customerName : (entry.notes || '—')}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: '#1d2028', color: '#c2c8d8' }}>
                        {entry.paymentStage}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold" style={{ color: '#00e07a', fontFamily: "'DM Serif Display', serif" }}>{fmt$(entry.amount)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded`} style={
                        entry.status === 'Paid'
                          ? { background: 'rgba(0,224,122,0.12)', color: '#00e07a' }
                          : entry.status === 'Pending'
                          ? { background: 'rgba(255,176,32,0.12)', color: '#ffb020' }
                          : { background: '#1d2028', color: '#4d9fff' }
                      }>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: '#525c72' }}><RelativeDate date={entry.date} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const pendingReimCount = reimbursements.filter((r) => r.status === 'Pending').length;

  const filteredReimbursements = reimbursements.filter((r) => {
    if (reimFilterFrom && r.date < reimFilterFrom) return false;
    if (reimFilterTo && r.date > reimFilterTo) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <CreditCard className="w-5 h-5 text-[#00e07a]" />
          </div>
          <div>
            <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>Financials</h1>
            <p className="text-[#c2c8d8] text-sm font-medium tracking-wide">Payroll and reimbursement management</p>
          </div>
        </div>
        {pageView === 'payroll' && (
          <div className="flex flex-col md:flex-row gap-2 md:gap-3 w-full md:w-auto">
            <button
              onClick={() => setShowPaymentModal(true)}
              className="font-medium px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm active:scale-[0.97] whitespace-nowrap transition-colors"
              style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}
            >
              + Add Payment
            </button>
            <button
              onClick={() => setShowBonusModal(true)}
              className="font-medium px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm active:scale-[0.97] whitespace-nowrap transition-colors"
              style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}
            >
              + Add Bonus
            </button>
            <button
              onClick={() => setShowPublishConfirm(true)}
              disabled={totalPending === 0}
              className="font-semibold px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm shadow-lg active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000' }}
            >
              Publish Payroll
            </button>
            <button
              onClick={() => {
                const headers = ['Rep', 'Customer', 'Type', 'Stage', 'Amount', 'Status', 'Date', 'Notes'];
                const rows = filtered.map((e) => [
                  e.repName,
                  e.customerName || '',
                  e.type,
                  e.paymentStage,
                  `$${e.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                  e.status,
                  formatDate(e.date),
                  e.notes ?? '',
                ]);
                downloadCSV(`payroll-${statusTab.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
              }}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ background: '#1d2028', border: '1px solid #333849', color: '#8891a8' }}
              title="Download filtered payroll as CSV"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={() => window.print()}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap print:hidden"
              style={{ background: '#1d2028', border: '1px solid #333849', color: '#8891a8' }}
              title="Print payroll summary"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        )}
      </div>

      {/* Top-level page view switcher */}
      <div className="flex gap-1 mb-8 rounded-xl p-1 w-fit tab-bar-container" style={{ background: '#1d2028', border: '1px solid #333849' }}>
        {pageViewIndicator && <div className="tab-indicator" style={pageViewIndicator} />}
        {(['payroll', 'reimbursements'] as PageView[]).map((v, i) => (
          <button
            key={v}
            ref={(el) => { pageViewRefs.current[i] = el; }}
            onClick={() => setPageView(v)}
            className="relative z-10 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={pageView === v
              ? { background: '#00e07a', color: '#000', fontWeight: 700 }
              : { color: '#c2c8d8' }
            }
          >
            {v === 'payroll' ? (
              <><CreditCard className="w-3.5 h-3.5" /> Payroll</>
            ) : (
              <><Receipt className="w-3.5 h-3.5" /> Reimbursements
                {pendingReimCount > 0 && (
                  <span className="ml-1 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">{pendingReimCount}</span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* ── Reimbursements view ──────────────────────────────────────────────── */}
      {pageView === 'reimbursements' && (
        <div key={pageView} className="animate-tab-enter">
          {/* Date filter */}
          <div className="flex items-center gap-3 mb-5">
            <Filter className="w-4 h-4 text-[#8891a8] flex-shrink-0" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#8891a8] whitespace-nowrap">From</label>
              <input
                type="date"
                value={reimFilterFrom}
                onChange={(e) => setReimFilterFrom(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#8891a8] whitespace-nowrap">To</label>
              <input
                type="date"
                value={reimFilterTo}
                onChange={(e) => setReimFilterTo(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#00e07a]"
                style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
              />
            </div>
            {(reimFilterFrom || reimFilterTo) && (
              <button
                onClick={() => { setReimFilterFrom(''); setReimFilterTo(''); }}
                className="text-xs text-[#8891a8] hover:text-white underline transition-colors"
              >
                Clear
              </button>
            )}
            <span className="text-[#525c72] text-xs ml-auto">{filteredReimbursements.length} request{filteredReimbursements.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #272b35' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#1d2028', borderBottom: '1px solid #333849' }}>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Rep</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Description</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Amount</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Date</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Receipt</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Status</th>
                  <th className="text-left px-5 py-3 font-medium text-xs uppercase tracking-wider" style={{ color: '#8891a8' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReimbursements.map((r, i) => (
                  <tr key={r.id} className={`table-row-enter row-stagger-${Math.min(i, 24)} relative transition-colors duration-150`} style={{ borderBottom: '1px solid #272b35', background: i % 2 === 0 ? '#161920' : '#191c24' }}>
                    <td className="px-5 py-3 font-medium" style={{ color: '#f0f2f7' }}>{r.repName}</td>
                    <td className="px-5 py-3" style={{ color: '#c2c8d8' }}>{r.description}</td>
                    <td className="px-5 py-3 font-semibold" style={{ color: '#00e07a', fontFamily: "'DM Serif Display', serif" }}>${r.amount.toFixed(2)}</td>
                    <td className="px-5 py-3 text-[#8891a8] text-xs">{formatDate(r.date)}</td>
                    <td className="px-5 py-3 text-[#c2c8d8] text-xs">{r.receiptName || '—'}</td>
                    <td className="px-5 py-3">
                      <ReimBadge status={r.status} />
                    </td>
                    <td className="px-5 py-3">
                      {r.status === 'Pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setReimbursements((prev) => prev.map((x) => x.id === r.id ? { ...x, status: 'Approved' } : x));
                              fetch(`/api/reimbursements/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Approved' }) })
                                .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); })
                                .catch((err) => { console.error(err); toast('Failed to persist approval', 'error'); });
                              toast(`Reimbursement approved for ${r.repName}`, 'success');
                            }}
                            className="flex items-center gap-1 text-xs bg-emerald-900/50 hover:bg-emerald-800/60 text-[#00e07a] px-2 py-1 rounded transition-colors"
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            onClick={() => {
                              setReimbursements((prev) => prev.map((x) => x.id === r.id ? { ...x, status: 'Denied' } : x));
                              fetch(`/api/reimbursements/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Denied' }) })
                                .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); })
                                .catch((err) => { console.error(err); toast('Failed to persist denial', 'error'); });
                              toast(`Reimbursement denied for ${r.repName}`, 'error');
                            }}
                            className="flex items-center gap-1 text-xs bg-red-900/50 hover:bg-red-800/60 text-red-400 px-2 py-1 rounded transition-colors"
                          >
                            <X className="w-3 h-3" /> Deny
                          </button>
                        </div>
                      ) : (
                        <span className="text-[#525c72] text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredReimbursements.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Receipt className="w-10 h-10 text-[#525c72]" />
                        <p className="text-sm font-semibold text-white">{reimbursements.length === 0 ? 'No reimbursement requests' : 'No requests match the selected date range'}</p>
                        <p className="text-xs text-[#8891a8]">{reimbursements.length === 0 ? 'Reps can submit reimbursement requests from their My Pay page' : 'Try adjusting the date filters to find what you need'}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pageView === 'payroll' && <div key={pageView} className="animate-tab-enter">

      {/* GradCards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {/* Draft */}
        <div style={{ background: 'linear-gradient(135deg, #040c1c, #060e22)', border: '1px solid rgba(77,159,255,0.19)', borderRadius: 14, padding: '18px 22px', flex: 1 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(77,159,255,0.73)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Draft</p>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: '#4d9fff', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(77,159,255,0.25)' }}>${totalDraft.toLocaleString()}</p>
          <p style={{ color: 'rgba(77,159,255,0.4)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{filteredByDateRep.filter((p) => p.status === 'Draft').length} entries</p>
        </div>
        {/* Pending */}
        <div style={{ background: 'linear-gradient(135deg, #120b00, #180e00)', border: '1px solid rgba(255,176,32,0.19)', borderRadius: 14, padding: '18px 22px', flex: 1 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,176,32,0.73)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Pending</p>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: '#ffb020', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(255,176,32,0.25)' }}>${totalPending.toLocaleString()}</p>
          <p style={{ color: 'rgba(255,176,32,0.4)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{filteredByDateRep.filter((p) => p.status === 'Pending').length} entries</p>
        </div>
        {/* Total */}
        <div style={{ background: 'linear-gradient(135deg, #00160d, #001c10)', border: '1px solid rgba(0,224,122,0.19)', borderRadius: 14, padding: '18px 22px', flex: 1 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,224,122,0.73)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Total Paid</p>
          <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: '#00e07a', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(0,224,122,0.25)' }}>${totalPaid.toLocaleString()}</p>
          <p style={{ color: 'rgba(0,224,122,0.4)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{filteredByDateRep.filter((p) => p.status === 'Paid').length} entries</p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 rounded-xl p-1 w-fit tab-bar-container" style={{ background: '#1d2028', border: '1px solid #333849' }}>
        {statusIndicator && <div className="tab-indicator" style={statusIndicator} />}
        {(['Draft', 'Pending', 'Paid'] as StatusTab[]).map((s, i) => (
          <button
            key={s}
            ref={(el) => { statusTabRefs.current[i] = el; }}
            onClick={() => changeStatusTab(s)}
            className="relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={statusTab === s
              ? { background: '#00e07a', color: '#000', fontWeight: 700 }
              : { color: '#c2c8d8' }
            }
          >
            {s}
            <span className="ml-1.5 text-xs opacity-70">
              ({payrollEntries.filter((p) => p.status === s && p.type === typeTab).length})
            </span>
          </button>
        ))}
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-6 rounded-xl p-1 w-fit tab-bar-container" style={{ background: '#1d2028', border: '1px solid #333849' }}>
        {typeIndicator && <div className="tab-indicator" style={typeIndicator} />}
        {(['Deal', 'Bonus'] as TypeTab[]).map((t, i) => (
          <button
            key={t}
            ref={(el) => { typeTabRefs.current[i] = el; }}
            onClick={() => changeTypeTab(t)}
            className="relative z-10 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={typeTab === t
              ? { background: '#00e07a', color: '#000', fontWeight: 700 }
              : { color: '#8891a8' }
            }
          >
            {t} Payments
          </button>
        ))}
      </div>

      {/* ── Filter bar — top of table card ── */}
      <div style={{ background: '#161920', border: '1px solid #272b35', borderRadius: '14px 14px 0 0', padding: '14px 18px', borderBottom: 'none' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Rep filter */}
          <div style={{ flex: '0 0 180px' }}>
            <RepSelector
              value={filterRepId}
              onChange={(id) => changeFilterRepId(id)}
              reps={reps}
              placeholder="All Reps"
              clearLabel="All Reps"
            />
          </div>
          {/* Date filter */}
          <DateRangeFilter
            from={payFilterFrom}
            to={payFilterTo}
            onFromChange={setPayFilterFrom}
            onToChange={setPayFilterTo}
            onClear={() => { setPayFilterFrom(''); setPayFilterTo(''); }}
          />
          {/* Bulk actions (when selected) */}
          {statusTab === 'Draft' && selectedIds.size > 0 && (
            <button
              onClick={selectAll}
              className="text-xs hover:text-white underline transition-colors"
              style={{ color: '#8891a8' }}
            >
              {allFilteredSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}
          {/* Entry count */}
          <span style={{ color: '#525c72', fontSize: 12, fontFamily: "'DM Sans',sans-serif", marginLeft: 'auto' }}>{filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}</span>
        </div>
        {/* Keyboard hints */}
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          {([['Enter','Mark for Payroll'],['Shift+A','Select All'],['Esc','Clear']] as [string,string][]).map(([k,d]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#1d2028', border: '1px solid #333849', borderRadius: 5, padding: '2px 6px', fontSize: 10, fontFamily: 'monospace', color: '#c2c8d8' }}>{k}</span>
              <span style={{ color: '#525c72', fontSize: 11, fontFamily: "'DM Sans',sans-serif" }}>{d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Data table ── */}
      <div key={statusTab} className="animate-tab-enter">
      {filtered.length === 0 ? (
        <div style={{ background: '#161920', border: '1px solid #272b35', borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#f0f2f7', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No {statusTab.toLowerCase()} {typeTab.toLowerCase()} payments</p>
            <p style={{ color: '#525c72', fontSize: 12 }}>
              {statusTab === 'Draft' ? (typeTab === 'Deal' ? 'Draft entries are auto-created when projects hit milestones' : 'Create a bonus entry for any rep') : statusTab === 'Pending' ? 'Select Draft entries and mark them for payroll' : 'Publish pending payroll to move entries here'}
            </p>
            {statusTab === 'Draft' && typeTab === 'Deal' && (
              <button onClick={() => setShowPaymentModal(true)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-lg transition-all hover:opacity-90 active:scale-[0.97]" style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000' }}>
                <ArrowRight className="w-3.5 h-3.5" /> Add Payment
              </button>
            )}
            {statusTab === 'Draft' && typeTab === 'Bonus' && (
              <button onClick={() => setShowBonusModal(true)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-lg transition-all hover:opacity-90 active:scale-[0.97]" style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000' }}>
                Add Bonus
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
        <div style={{ background: '#161920', border: '1px solid #272b35', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {statusTab === 'Draft' && (
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const, width: 40 }}>
                    <input type="checkbox" checked={allFilteredSelected} onChange={selectAll} style={{ accentColor: '#00e07a', cursor: 'pointer' }} />
                  </th>
                )}
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Rep</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Type</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Customer</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' as const, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Amount</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8891a8', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, background: '#1d2028', borderBottom: '1px solid #333849', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFiltered.map((entry, i) => (
                <tr key={entry.id} style={{
                  background: selectedIds.has(entry.id) ? 'rgba(0,224,122,0.05)' : i % 2 === 0 ? '#161920' : '#191c24',
                  borderBottom: '1px solid #272b35',
                  cursor: 'pointer',
                }} onClick={() => statusTab === 'Draft' && toggleEntry(entry.id)}>
                  {statusTab === 'Draft' && (
                    <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                      <input type="checkbox" checked={selectedIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} onClick={(e) => e.stopPropagation()} style={{ accentColor: '#00e07a', cursor: 'pointer' }} />
                    </td>
                  )}
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: '#f0f2f7', fontWeight: 600 }}>{entry.repName}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: '#c2c8d8' }}>{entry.paymentStage}{entry.notes && typeTab === 'Deal' && (entry.notes === 'Setter' || entry.notes === 'Trainer override') ? ` (${entry.notes})` : ''}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: '#8891a8' }}>{typeTab === 'Deal' ? entry.customerName : (entry.notes || '\u2014')}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", textAlign: 'right' }}><span style={{ color: '#00e07a', fontWeight: 700, fontFamily: "'DM Serif Display',serif" }}>{fmt$(entry.amount)}</span></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}><span style={{ color: '#8891a8' }}><RelativeDate date={entry.date} /></span></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                    <span style={
                      entry.status === 'Paid'
                        ? { background: 'rgba(0,224,122,0.12)', color: '#00e07a', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }
                        : entry.status === 'Pending'
                        ? { background: 'rgba(255,176,32,0.12)', color: '#ffb020', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }
                        : { background: 'rgba(77,159,255,0.12)', color: '#4d9fff', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }
                    }>{entry.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > adminRowsPerPage && (
          <div className="card-surface rounded-2xl overflow-hidden mt-4">
            <PaginationBar
              totalResults={filtered.length}
              startIdx={adminStartIdx}
              endIdx={adminEndIdx}
              currentPage={adminPage}
              totalPages={adminTotalPages}
              rowsPerPage={adminRowsPerPage}
              onPageChange={setAdminPage}
              onRowsPerPageChange={(n) => { setAdminRowsPerPage(n); setAdminPage(1); }}
            />
          </div>
        )}
        </>
      )}
      </div> {/* end key={statusTab} */}

      </div> /* end pageView === 'payroll' */}

      {/* Publish Confirm Modal */}
      {showPublishConfirm && (() => {
        const pendingEntries = payrollEntries.filter((p) => p.status === 'Pending');
        // Build a per-rep summary sorted descending by total payout
        const repSummary = Array.from(
          pendingEntries.reduce((map, e) => {
            if (!map.has(e.repId)) map.set(e.repId, { name: e.repName, total: 0, count: 0 });
            const rec = map.get(e.repId)!;
            rec.total += e.amount;
            rec.count += 1;
            return map;
          }, new Map<string, { name: string; total: number; count: number }>())
        )
          .map(([, v]) => v)
          .sort((a, b) => b.total - a.total);

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
            <div className="bg-[#161920] border border-[#272b35]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-yellow-900/30">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                </div>
                <h2 className="text-white font-semibold text-lg">Publish Payroll?</h2>
              </div>
              <p className="text-[#c2c8d8] text-sm mb-3">
                This will mark all <span className="text-yellow-400 font-semibold">{pendingEntries.length} pending {pendingEntries.length === 1 ? 'entry' : 'entries'}</span> as <span className="text-[#00e07a] font-semibold">Paid</span>. This action cannot be undone.
              </p>

              {/* Per-rep breakdown */}
              {repSummary.length > 0 && (
                <div className="bg-[#1d2028]/60 border border-[#272b35]/60 rounded-xl mb-5 overflow-hidden">
                  <div className="px-4 py-2 border-b border-[#272b35]/60 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#c2c8d8] uppercase tracking-wider">Payout Breakdown</span>
                    <span className="text-xs text-[#8891a8]">{repSummary.length} rep{repSummary.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-slate-800/60 max-h-48 overflow-y-auto">
                    {repSummary.map((rep) => (
                      <div key={rep.name} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-white text-sm font-medium">{rep.name}</p>
                          <p className="text-[#8891a8] text-xs">{rep.count} {rep.count === 1 ? 'entry' : 'entries'}</p>
                        </div>
                        <span className="text-[#00e07a] font-bold tabular-nums">${rep.total.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2.5 border-t border-[#272b35]/60 flex items-center justify-between bg-[#1d2028]/40">
                    <span className="text-[#c2c8d8] text-xs font-semibold uppercase tracking-wider">Total</span>
                    <span className="text-white font-black tabular-nums">${pendingEntries.reduce((s, e) => s + e.amount, 0).toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handlePublish}
                  className="btn-primary flex-1 text-black font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Publish Payroll
                </button>
                <button
                  onClick={() => setShowPublishConfirm(false)}
                  className="btn-secondary flex-1 bg-[#272b35] hover:bg-[#525c72] text-white font-medium py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bonus Modal */}
      {showBonusModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
          <div ref={bonusPanelRef} className="bg-[#161920] border border-[#272b35]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">Add Bonus Payment</h2>
              <button
                onClick={() => setShowBonusModal(false)}
                className="text-[#8891a8] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddBonus} className="space-y-4">
              <div>
                <label className={labelCls}>Rep</label>
                <RepSelector
                  value={bonusForm.repId}
                  onChange={(repId) => setBonusForm((p) => ({ ...p, repId }))}
                  reps={reps}
                  placeholder="— Select rep —"
                  clearLabel="— Select rep —"
                />
              </div>
              <div>
                <label className={labelCls}>Amount ($)</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={bonusForm.amount}
                  onChange={(e) => setBonusForm((p) => ({ ...p, amount: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input
                  type="date"
                  value={bonusForm.date}
                  onChange={(e) => setBonusForm((p) => ({ ...p, date: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly performance bonus"
                  value={bonusForm.notes}
                  onChange={(e) => setBonusForm((p) => ({ ...p, notes: e.target.value }))}
                  className={inputCls + ' placeholder-slate-500'}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  className="btn-primary flex-1 text-black font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Add Bonus
                </button>
                <button
                  type="button"
                  onClick={() => setShowBonusModal(false)}
                  className="btn-secondary flex-1 bg-[#272b35] hover:bg-[#525c72] text-white font-medium py-2.5 rounded-xl text-sm active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Spacer so content is never hidden behind the fixed action bar */}
      {showActionBar && <div className="h-20" />}

      {/* Manual Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
          <div ref={paymentPanelRef} className="bg-[#161920] border border-[#272b35]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">Add Deal Payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-[#8891a8] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddPayment} className="space-y-4">
              <div>
                <label className={labelCls}>Rep</label>
                <RepSelector
                  value={paymentForm.repId}
                  onChange={(repId) => setPaymentForm((p) => ({ ...p, repId }))}
                  reps={reps}
                  placeholder="— Select rep —"
                  clearLabel="— Select rep —"
                />
              </div>
              <div>
                <label className={labelCls}>Project</label>
                <SearchableSelect
                  value={paymentForm.projectId}
                  onChange={(val) => setPaymentForm((p) => ({ ...p, projectId: val }))}
                  options={projects
                    .filter((p) => !paymentForm.repId || p.repId === paymentForm.repId || p.setterId === paymentForm.repId)
                    .map((p) => ({ value: p.id, label: `${p.customerName} — ${p.installer} (${p.kWSize} kW)` }))}
                  placeholder="— Select project (optional) —"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Amount ($)</label>
                  <input required type="number" min="0" step="0.01"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Stage</label>
                  <SearchableSelect
                    value={paymentForm.stage}
                    onChange={(val) => setPaymentForm((p) => ({ ...p, stage: val as 'M1' | 'M2' | 'M3' }))}
                    options={[
                      { value: 'M1', label: 'M1' },
                      { value: 'M2', label: 'M2' },
                      { value: 'M3', label: 'M3' },
                    ]}
                    placeholder="Select stage"
                    searchable={false}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Pay Date</label>
                <input type="date" value={paymentForm.date}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input type="text" placeholder="e.g. Additional payment — special circumstance"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, notes: e.target.value }))}
                  className={inputCls + ' placeholder-slate-500'} />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit"
                  className="btn-primary flex-1 text-black font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97]"
                  style={{ backgroundColor: 'var(--brand)' }}>
                  Add Payment
                </button>
                <button type="button" onClick={() => setShowPaymentModal(false)}
                  className="btn-secondary flex-1 bg-[#272b35] hover:bg-[#525c72] text-white font-medium py-2.5 rounded-xl text-sm active:scale-[0.97]">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Floating batch-action toolbar ────────────────────────────────────
           Glass-morphism pill centred at the viewport bottom. Mounts with a
           spring-eased slide-up entrance whenever one or more Draft entries are
           selected. React unmounts it on deselection so the entrance animation
           fires fresh each time. Escape key and the × button both clear the
           selection.                                                            */}
      {showActionBar && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 backdrop-blur-xl bg-[#161920]/80 border border-[#272b35]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40 animate-float-toolbar-in"
          role="toolbar"
          aria-label="Batch actions for selected entries"
        >
          <div className="flex items-center gap-3">

            {/* Selection count badge — blue accent pill */}
            <span className="flex items-center gap-1.5 bg-[#00e07a]/15 border border-[#00e07a]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
              <span className="text-white font-bold tabular-nums">{selectedIds.size}</span>
              <span className="text-[#00e07a] font-medium">selected</span>
              {selectedTotal > 0 && (
                <>
                  <span className="text-[#525c72] mx-0.5">·</span>
                  <span className="text-[#00e07a] font-semibold tabular-nums">${selectedTotal.toLocaleString()}</span>
                </>
              )}
            </span>

            {/* Visual divider */}
            <div className="h-5 w-px bg-[#272b35]/80 flex-shrink-0" />

            {/* Mark for Payroll — primary action (always Draft context when bar is visible) */}
            {statusTab === 'Draft' && (
              <button
                onClick={handleMarkForPayroll}
                className="btn-primary text-black font-semibold px-4 py-1.5 rounded-xl text-sm shadow-lg shadow-blue-500/20 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#00e07a] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 whitespace-nowrap"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Mark for Payroll →
              </button>
            )}

            {/* Dismiss / deselect-all × button */}
            <button
              onClick={() => setSelectedIds(new Set())}
              aria-label="Deselect all and dismiss toolbar"
              className="btn-secondary p-1.5 rounded-lg bg-[#272b35]/60 hover:bg-[#525c72]/80 border border-[#272b35]/40 text-[#c2c8d8] hover:text-white transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>

          </div>
        </div>
      )}
    </div>
  );
}

function ReimBadge({ status }: { status: string }) {
  const st =
    status === 'Approved' ? { background: 'rgba(0,224,122,0.12)', color: '#00e07a' }
    : status === 'Pending'  ? { background: 'rgba(255,176,32,0.12)', color: '#ffb020' }
    : { background: 'rgba(255,82,82,0.12)', color: '#ff5252' };
  return <span className="px-2 py-0.5 rounded text-xs font-medium" style={st}>{status}</span>;
}

const STAT_CARD_STYLES: Record<string, { bg: string; border: string; accent: string; textColor: string }> = {
  'from-blue-500 to-blue-400':       { bg: 'linear-gradient(135deg, #040c1c, #060e22)', border: '#4d9fff30', accent: '#4d9fff', textColor: '#4d9fff' },
  'from-yellow-500 to-yellow-400':   { bg: 'linear-gradient(135deg, #120b00, #180e00)', border: '#ffb02030', accent: '#ffb020', textColor: '#ffb020' },
  'from-emerald-500 to-emerald-400': { bg: 'linear-gradient(135deg, #00160d, #001c10)', border: '#00e07a30', accent: '#00e07a', textColor: '#00e07a' },
};

function StatCard({ label, value, color, accentGradient, className, entryCount }: { label: string; value: number; color: string; border?: string; accentGradient?: string; className?: string; entryCount?: number }) {
  const accent = accentGradient ?? 'from-blue-500 to-blue-400';
  const s = STAT_CARD_STYLES[accent] ?? { bg: '#1d2028', border: '#272b35', accent: '#4d9fff', textColor: '#4d9fff' };
  return (
    <div
      className={`rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] ${className ?? ''}`}
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <div className="h-[2px] w-12 rounded-full mb-3" style={{ background: s.accent }} />
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8891a8' }}>{label}</p>
        {entryCount !== undefined && (
          <span className="text-xs font-medium tabular-nums" style={{ color: '#525c72' }}>{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
        )}
      </div>
      <p className="stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up" style={{ color: s.textColor, fontFamily: "'DM Serif Display', serif", textShadow: `0 0 20px ${s.accent}40` }}>${value.toLocaleString()}</p>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PayrollSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header block — mirrors the icon + title/subtitle + action-button layout */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {/* Icon placeholder */}
          <div className="h-9 w-9 bg-[#1d2028] rounded-lg animate-skeleton" />
          <div className="space-y-2">
            {/* Accent bar + title */}
            <div className="h-[3px] w-12 bg-[#272b35] rounded-full animate-skeleton" />
            <div
              className="h-8 w-36 bg-[#1d2028] rounded animate-skeleton"
              style={{ animationDelay: '75ms' }}
            />
            {/* Subtitle */}
            <div
              className="h-3 w-56 bg-[#1d2028]/70 rounded animate-skeleton"
              style={{ animationDelay: '100ms' }}
            />
          </div>
        </div>
        {/* Action buttons — Add Bonus + Publish Payroll */}
        <div className="flex gap-3">
          <div
            className="h-9 w-24 bg-[#1d2028] rounded-xl animate-skeleton"
            style={{ animationDelay: '50ms' }}
          />
          <div
            className="h-9 w-32 bg-[#1d2028] rounded-xl animate-skeleton"
            style={{ animationDelay: '100ms' }}
          />
        </div>
      </div>

      {/* Three stat-card skeletons — Draft / Pending / Paid summary row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card-surface rounded-2xl p-5 space-y-3">
            <div
              className="h-[2px] w-12 bg-[#272b35] rounded-full animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
            <div
              className="h-3 w-16 bg-[#1d2028] rounded animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
            <div
              className="h-8 w-28 bg-[#1d2028] rounded animate-skeleton"
              style={{ animationDelay: `${i * 75 + 40}ms` }}
            />
          </div>
        ))}
      </div>

      {/* Tab-bar skeleton — two pill placeholders matching the Payroll / Reimbursements switcher */}
      <div className="flex gap-1 mb-8 bg-[#161920] border border-[#333849] rounded-xl p-1 w-fit">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-9 w-32 bg-[#1d2028] rounded-lg animate-skeleton"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      {/* Six skeleton table rows with alternating opacity */}
      <div className="card-surface rounded-2xl overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-4 px-5 py-4 border-b border-[#333849]/50 ${i % 2 === 1 ? 'opacity-60' : ''}`}
          >
            {/* Customer / rep name placeholder */}
            <div
              className="h-4 w-40 bg-[#1d2028] rounded animate-skeleton"
              style={{ animationDelay: `${i * 60}ms` }}
            />
            {/* Stage badge placeholder */}
            <div
              className="h-5 w-20 bg-[#1d2028]/80 rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 30}ms` }}
            />
            {/* Amount placeholder */}
            <div
              className="ml-auto h-4 w-16 bg-[#1d2028] rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 50}ms` }}
            />
            {/* Status badge placeholder */}
            <div
              className="h-5 w-14 bg-[#1d2028]/70 rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 70}ms` }}
            />
            {/* Date placeholder */}
            <div
              className="h-3 w-20 bg-[#1d2028]/50 rounded animate-skeleton"
              style={{ animationDelay: `${i * 60 + 90}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
