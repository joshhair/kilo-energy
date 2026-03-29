'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useIsHydrated } from '../../../lib/hooks';
import { useApp } from '../../../lib/context';
import { Search, ChevronRight, Users, Plus, Trash2, Trophy, Award, X } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { RepSelector } from '../components/RepSelector';
import { useToast } from '../../../lib/toast';

const FILTER_TABS = [
  { value: 'all',    label: 'All' },
  { value: 'closer', label: 'Closers' },
  { value: 'setter', label: 'Setters' },
  { value: 'both',   label: 'Both' },
] as const;
type FilterTab = typeof FILTER_TABS[number]['value'];

const PIPELINE_EXCLUDED: ReadonlySet<string> = new Set(['Cancelled', 'On Hold', 'Completed']);

const ROLE_LABELS = { closer: 'Closer', setter: 'Setter', both: 'Both' } as const;
const ROLE_BADGE_CLS = {
  closer: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  setter: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  both:   'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
} as const;
const ROLE_BADGE_HOVER = {
  closer: 'hover:bg-blue-500/20',
  setter: 'hover:bg-violet-500/20',
  both:   'hover:bg-emerald-500/20',
} as const;
const ROLE_NEXT = { closer: 'setter', setter: 'both', both: 'closer' } as const;

// r=22 inside a 48×48 viewBox  →  circumference ≈ 138.23
const REP_RING_CIRCUMFERENCE = 2 * Math.PI * 22;

const RANK_GRADIENTS = [
  'from-yellow-400 to-amber-600', // gold  – #1
  'from-slate-300 to-slate-500',  // silver – #2
  'from-amber-600 to-amber-800',  // bronze – #3
];

// Breathing box-shadow pulse class for each podium rank
const PODIUM_BREATH_CLS: Record<number, string> = {
  1: 'animate-podium-breath-gold',
  2: 'animate-podium-breath-silver',
  3: 'animate-podium-breath-bronze',
};

export default function RepsPage() {
  const { currentRole, projects, payrollEntries, reps, addRep, removeRep, updateRepType, trainerAssignments, setTrainerAssignments } = useApp();
  const { toast } = useToast();
  useEffect(() => { document.title = 'Reps | Kilo Energy'; }, []);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const isHydrated = useIsHydrated();
  const isAdmin = currentRole === 'admin';
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // ── Add Rep modal state ────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRepType, setNewRepType] = useState<'closer' | 'setter' | 'both'>('both');
  const [newTrainerId, setNewTrainerId] = useState('');

  const resetAddModal = () => {
    setNewFirstName(''); setNewLastName(''); setNewEmail(''); setNewPhone('');
    setNewRepType('both'); setNewTrainerId(''); setShowAddModal(false);
  };

  // Escape key closes add-rep modal
  useEffect(() => {
    if (!showAddModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') resetAddModal(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddModal]);

  const handleAddRep = () => {
    if (!newFirstName.trim() || !newLastName.trim()) return;
    const ts = Date.now();
    const repId = `rep_${ts}`;
    addRep(newFirstName, newLastName, newEmail, newPhone, newRepType, repId);
    toast('Rep added', 'success');
    // If a trainer was selected, create a trainer assignment
    if (newTrainerId) {
      setTrainerAssignments((prev) => [
        ...prev,
        {
          id: `ta_${ts}`,
          trainerId: newTrainerId,
          traineeId: repId,
          tiers: [{ upToDeal: null, ratePerW: 0.05 }],
        },
      ]);
      toast('Trainer assigned', 'success');
    }
    resetAddModal();
  };

  // ── Filter tab indicator ─────────────────────────────────────────────────
  const filterTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [filterIndicator, setFilterIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = FILTER_TABS.findIndex((t) => t.value === filterTab);
    const el = filterTabRefs.current[idx];
    if (el) setFilterIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [filterTab]);

  // ── Active deals count per rep (pipeline = not Cancelled/On Hold/Completed) ──
  const activeDealsByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      if (PIPELINE_EXCLUDED.has(p.phase)) continue;
      // Count for closer (repId)
      map.set(p.repId, (map.get(p.repId) ?? 0) + 1);
      // Count for setter if present and different from closer
      if (p.setterId && p.setterId !== p.repId) {
        map.set(p.setterId, (map.get(p.setterId) ?? 0) + 1);
      }
    }
    return map;
  }, [projects]);

  // ── Keyboard shortcut: '/' focuses the search input ──────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Debounce search → debouncedSearch (200ms; 0ms when cleared) ──────────
  useEffect(() => {
    const delay = search === '' ? 0 : 200;
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, delay);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = reps.filter((r) => {
    // Search filter
    if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    // Role filter
    if (filterTab === 'all') return true;
    if (filterTab === 'both') return r.repType === 'both';
    // 'closer' tab shows closer + both; 'setter' tab shows setter + both
    return r.repType === filterTab || r.repType === 'both';
  });

  // ── Pre-compute paid totals & rank order across ALL reps ──────────────────
  const repPaidAmounts = new Map(
    reps.map((rep) => [
      rep.id,
      payrollEntries
        .filter((p) => p.repId === rep.id && p.status === 'Paid')
        .reduce((s, p) => s + p.amount, 0),
    ])
  );

  const rankMap = new Map(
    [...reps]
      .sort((a, b) => (repPaidAmounts.get(b.id) ?? 0) - (repPaidAmounts.get(a.id) ?? 0))
      .map((rep, idx) => [rep.id, idx + 1])
  );

  // ── Top 3 performers for podium section ─────────────────────────────────
  const topPerformers = [...reps]
    .map((rep) => ({ rep, paid: repPaidAmounts.get(rep.id) ?? 0 }))
    .filter(({ paid }) => paid > 0)
    .sort((a, b) => b.paid - a.paid)
    .slice(0, 3);

  // Visual layout: 2nd left (order-1), 1st centre (order-2), 3rd right (order-3)
  const podiumDisplay =
    topPerformers.length >= 3
      ? [
          { ...topPerformers[1], rank: 2, order: 1 },
          { ...topPerformers[0], rank: 1, order: 2 },
          { ...topPerformers[2], rank: 3, order: 3 },
        ]
      : [];

  if (!isHydrated) {
    return <RepsSkeleton />;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-gradient-brand tracking-tight">Reps</h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {filtered.length !== reps.length ? `${filtered.length} / ${reps.length}` : reps.length} reps
            </span>
          </div>
        </div>
        <p className="text-slate-400 text-sm font-medium ml-12 tracking-wide">{reps.length} sales representatives</p>
      </div>

      {/* Admin: add rep button */}
      {isAdmin && (
        <div className="mb-6">
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-xl"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            <Plus className="w-4 h-4" /> Add Rep
          </button>
        </div>
      )}

      {/* ── Top Performers Podium ─────────────────────────────────────────── */}
      {podiumDisplay.length === 3 && (
        <div className="card-surface rounded-2xl p-5 mb-8 animate-slide-in-scale" style={{ animationDelay: 'var(--podium-delay, 300ms)' }}>
          {/* Section header */}
          <div className="h-[3px] w-10 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 mb-3" />
          <div className="flex items-center gap-2 mb-5">
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(234,179,8,0.15)' }}>
              <Trophy className="w-4 h-4 text-yellow-400" />
            </div>
            <h2 className="text-white font-bold text-base tracking-tight">Top Performers</h2>
          </div>

          {/* Podium cards */}
          <div className="flex items-end justify-center gap-3">
            {podiumDisplay.map(({ rep, paid, rank, order }) => {
              const isFirst = rank === 1;
              const gradient = RANK_GRADIENTS[rank - 1];
              const initials = rep.name.split(' ').map((n) => n[0]).join('');
              return (
                <div
                  key={rep.id}
                  className={`relative flex flex-col items-center gap-2 card-surface rounded-2xl p-4 flex-1 max-w-[160px] overflow-hidden animate-slide-in-scale stagger-${order} ${PODIUM_BREATH_CLS[rank]}${isFirst ? ' scale-105' : ''}`}
                  style={{ order }}
                >
                  {/* Gradient top border */}
                  <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${gradient}${isFirst ? ' animate-podium-glow' : ''}`} />

                  {/* Award icon for #1 */}
                  {isFirst && <Award className="w-4 h-4 text-yellow-400" />}

                  {/* Initials circle with gradient border */}
                  <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} p-[2px] flex-shrink-0`}>
                    <div
                      className="w-full h-full rounded-full flex items-center justify-center text-white font-bold text-lg"
                      style={{ backgroundColor: 'var(--navy-card)' }}
                    >
                      {initials}
                    </div>
                  </div>

                  {/* Rank badge */}
                  <div className={`text-[10px] font-black text-white px-2 py-0.5 rounded-full bg-gradient-to-br ${gradient}`}>
                    #{rank}
                  </div>

                  {/* Name */}
                  <p className="font-bold text-white text-sm text-center leading-tight">{rep.name}</p>

                  {/* Paid amount */}
                  <p className="text-gradient-brand font-black text-sm">${paid.toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Summary Bar ──────────────────────────────────────────────────── */}
      <div className="card-surface card-surface-stat rounded-2xl p-4 mb-8 flex items-center justify-between gap-6 flex-wrap">
        {[
          { label: 'Total Reps', value: reps.length.toString(), color: 'text-blue-400', pillBg: 'bg-blue-500/10', pillBorder: 'border-blue-500/20' },
          { label: 'Active Deals', value: (() => { let count = 0; for (const p of projects) { if (!PIPELINE_EXCLUDED.has(p.phase)) count++; } return count; })().toString(), color: 'text-purple-400', pillBg: 'bg-purple-500/10', pillBorder: 'border-purple-500/20' },
          { label: 'kW Sold', value: `${projects.reduce((s, p) => s + p.kWSize, 0).toFixed(1)} kW`, color: 'text-yellow-400', pillBg: 'bg-yellow-500/10', pillBorder: 'border-yellow-500/20' },
          { label: 'Total Paid', value: `$${payrollEntries.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0).toLocaleString()}`, color: 'text-emerald-400', pillBg: 'bg-emerald-500/10', pillBorder: 'border-emerald-500/20' },
        ].map((stat) => (
          <div key={stat.label} className="flex items-center gap-2.5">
            <span className={`text-[11px] font-medium uppercase tracking-wider text-slate-500`}>{stat.label}</span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-bold border ${stat.color} ${stat.pillBg} ${stat.pillBorder}`}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Role filter tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit tab-bar-container">
        {filterIndicator && <div className="tab-indicator" style={filterIndicator} />}
        {FILTER_TABS.map((t, i) => (
          <button
            key={t.value}
            ref={(el) => { filterTabRefs.current[i] = el; }}
            onClick={() => setFilterTab(t.value)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${filterTab === t.value ? 'text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-xs mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search reps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none transition-all duration-200 input-focus-glow placeholder-slate-500"
        />
        {/* Clear button — shown when there is a search query */}
        {search ? (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
            aria-label="Clear search input"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          /* '/' shortcut hint — shown when input is empty and not focused */
          !searchFocused && (
            <kbd
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 px-1.5 rounded border border-slate-600 bg-slate-700/60 text-slate-400 font-mono text-[11px] leading-none select-none"
              aria-hidden="true"
            >
              /
            </kbd>
          )
        )}
      </div>

      <div className="space-y-3">
        {filtered.map((rep, i) => {
          const repProjects = projects.filter((p) => p.repId === rep.id || p.setterId === rep.id);
          const repPaid = repPaidAmounts.get(rep.id) ?? 0;
          const activeCount = repProjects.filter(
            (p) => !PIPELINE_EXCLUDED.has(p.phase)
          ).length;
          const totalKW = repProjects.reduce((s, p) => s + p.kWSize, 0);
          const initials = rep.name.split(' ').map((n) => n[0]).join('');
          const rank = rankMap.get(rep.id) ?? 999;

          // ── Progress ring ─────────────────────────────────────────────────
          const completionRate =
            repProjects.length > 0 ? activeCount / repProjects.length : 0;
          const dashOffset = REP_RING_CIRCUMFERENCE * (1 - completionRate);

          return (
            <Link key={rep.id} href={`/dashboard/reps/${rep.id}`}>
              <div className={`rep-card relative card-surface rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 transition-shadow duration-300 group cursor-pointer hover:bg-slate-800/50 md:flex-row md:items-center md:justify-between hover:translate-y-[-2px] hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-500/20 active:scale-[0.98] active:shadow-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-blue-500/30 after:to-transparent after:opacity-0 hover:after:opacity-100 after:transition-opacity backdrop-blur-sm animate-slide-in-scale stagger-${Math.min(i + 1, 6)}`}>
                <div className="flex items-center gap-4">

                  {/* ── Avatar with conic progress ring ───────────────────── */}
                  <div className="relative flex-shrink-0 w-12 h-12">

                    {/* SVG progress ring — rotated so 0 % starts at the top */}
                    <svg
                      className="absolute inset-0 w-full h-full -rotate-90 rep-ring-glow"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient
                          id={`repRingGrad-${rep.id}`}
                          x1="0%" y1="0%" x2="100%" y2="0%"
                        >
                          <stop offset="0%"   stopColor="#3b82f6" />
                          <stop offset="100%" stopColor="#60a5fa" />
                        </linearGradient>
                      </defs>

                      {/* Background track */}
                      <circle
                        cx="24" cy="24" r="22"
                        fill="none"
                        stroke="rgba(30,58,95,0.6)"
                        strokeWidth="2.5"
                      />

                      {/* Animated progress arc */}
                      <circle
                        cx="24" cy="24" r="22"
                        fill="none"
                        stroke={`url(#repRingGrad-${rep.id})`}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={REP_RING_CIRCUMFERENCE}
                        style={{ strokeDashoffset: dashOffset }}
                        className="animate-rep-ring-fill"
                      />
                    </svg>

                    {/* Avatar circle — inset so it sits inside the ring */}
                    <div className="absolute inset-[3px] rounded-full bg-gradient-to-br from-blue-500 to-blue-700 p-[2px]">
                      <div
                        className="w-full h-full rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: 'var(--brand-dark)' }}
                      >
                        {initials}
                      </div>
                    </div>

                    {/* Rank badge — top-3 only */}
                    {rank <= 3 && (
                      <div
                        className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white z-10 shadow-md bg-gradient-to-br overflow-hidden animate-rank-shimmer ${RANK_GRADIENTS[rank - 1]}`}
                      >
                        #{rank}
                      </div>
                    )}
                  </div>
                  {/* ── /Avatar ───────────────────────────────────────────── */}

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold group-hover:text-blue-400 transition-colors">
                        {rep.name}
                      </p>
                      {isAdmin ? (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); const nextRole = ROLE_NEXT[rep.repType]; updateRepType(rep.id, nextRole); toast(`${rep.name} role changed to ${ROLE_LABELS[nextRole]}`, 'success'); }}
                          title="Click to cycle role"
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors cursor-pointer ${ROLE_BADGE_CLS[rep.repType]} ${ROLE_BADGE_HOVER[rep.repType]}`}
                        >
                          {ROLE_LABELS[rep.repType]}
                        </button>
                      ) : (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${ROLE_BADGE_CLS[rep.repType]}`}>
                          {ROLE_LABELS[rep.repType]}
                        </span>
                      )}
                      {/* Active deals badge */}
                      {(activeDealsByRep.get(rep.id) ?? 0) > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {activeDealsByRep.get(rep.id)} active
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs">{rep.email}</p>
                  </div>
                </div>

                {/* ── Stats — hover-reveal with staggered blur-lift ─────────── */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:items-center md:gap-8">

                  {/* Deals */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '0ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-white bg-slate-500/10 rounded-lg px-2 py-0.5">{repProjects.length}</span>
                    </p>
                    <p className="text-slate-500 text-xs mt-1">Total Deals</p>
                  </div>

                  {/* Active */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '75ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-blue-400 bg-blue-500/10 rounded-lg px-2 py-0.5">{activeCount}</span>
                    </p>
                    <p className="text-slate-500 text-xs mt-1">Active</p>
                  </div>

                  {/* kW */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '150ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-yellow-400 bg-yellow-500/10 rounded-lg px-2 py-0.5">{totalKW.toFixed(1)}</span>
                    </p>
                    <p className="text-slate-500 text-xs mt-1">Total kW</p>
                  </div>

                  {/* Last Deal */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '190ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-slate-300 bg-slate-500/10 rounded-lg px-2 py-0.5 text-xs">
                        {(() => {
                          if (repProjects.length === 0) return 'No deals yet';
                          const latest = repProjects.reduce((a, b) => a.soldDate > b.soldDate ? a : b);
                          const [y, m, d] = latest.soldDate.split('-').map(Number);
                          const dt = new Date(y, m - 1, d);
                          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        })()}
                      </span>
                    </p>
                    <p className="text-slate-500 text-xs mt-1">Last Deal</p>
                  </div>

                  {/* Paid */}
                  <div
                    className="text-center md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0 transition-all duration-300"
                    style={{ transitionDelay: '225ms' }}
                  >
                    <p className="font-semibold">
                      <span className="text-emerald-400 bg-emerald-500/5 rounded-lg px-2 py-0.5">${repPaid.toLocaleString()}</span>
                    </p>
                    <p className="text-slate-500 text-xs mt-1">Paid Out</p>
                  </div>

                  <ChevronRight className="hidden md:block w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                  {isAdmin && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction({ title: `Remove ${rep.name}?`, message: 'Their existing deals will be unaffected.', onConfirm: () => { removeRep(rep.id); toast('Rep removed', 'info'); setConfirmAction(null); } }); }}
                      title="Remove rep"
                      className="hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </Link>
          );
        })}

        {filtered.length === 0 && (debouncedSearch || filterTab !== 'all') && (
          <div className="flex justify-center py-4">
            <div className="animate-fade-in w-60 border border-dashed border-slate-800 rounded-2xl px-6 py-8 flex flex-col items-center gap-3 text-center">
              {/* Illustration — magnifying glass with question mark */}
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" className="opacity-40">
                {/* Outer lens ring */}
                <circle cx="34" cy="34" r="20" stroke="#3b82f6" strokeWidth="2.5" fill="none" strokeOpacity="0.6"/>
                {/* Inner lens ring */}
                <circle cx="34" cy="34" r="13" stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeOpacity="0.3"/>
                {/* Handle */}
                <line x1="49" y1="49" x2="70" y2="70" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"/>
                {/* Question mark stem */}
                <path d="M31 38 Q31 35 34 35 Q37 35 37 32 Q37 29 34 29 Q31 29 31 32" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity="0.7"/>
                {/* Question mark dot */}
                <circle cx="34" cy="40" r="1.2" fill="#94a3b8" fillOpacity="0.7"/>
              </svg>
              <p className="text-slate-200 text-sm font-bold leading-snug">No reps match</p>
              <p className="text-slate-500 text-xs leading-relaxed">
                {debouncedSearch
                  ? <>No results for &ldquo;<span className="text-slate-400">{debouncedSearch}</span>&rdquo;. Try adjusting your query.</>
                  : <>No reps match the selected filter. Try a different role.</>}
              </p>
              <button
                onClick={() => { setSearch(''); setFilterTab('all'); }}
                className="mt-1 text-xs font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Clear filters
              </button>
            </div>
          </div>
        )}
      </div>
      {/* ── Add Rep Modal ────────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) resetAddModal(); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="card-surface border border-slate-700/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-lg">Add New Rep</h3>
              <button onClick={resetAddModal} className="text-slate-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-slate-400 text-xs font-medium mb-1 block">First Name</label>
                <input
                  type="text"
                  placeholder="First name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs font-medium mb-1 block">Last Name</label>
                <input
                  type="text"
                  placeholder="Last name"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
                />
              </div>
            </div>

            {/* Email */}
            <div className="mb-3">
              <label className="text-slate-400 text-xs font-medium mb-1 block">Email</label>
              <input
                type="email"
                placeholder="rep@kiloenergy.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
              />
            </div>

            {/* Phone */}
            <div className="mb-4">
              <label className="text-slate-400 text-xs font-medium mb-1 block">Phone</label>
              <input
                type="tel"
                placeholder="(555) 000-0000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
              />
            </div>

            {/* Role selector — pill buttons */}
            <div className="mb-4">
              <label className="text-slate-400 text-xs font-medium mb-2 block">Role</label>
              <div className="flex gap-2">
                {(['closer', 'setter', 'both'] as const).map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => setNewRepType(rt)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                      newRepType === rt
                        ? `${ROLE_BADGE_CLS[rt]} bg-opacity-100`
                        : 'border-slate-700 text-slate-500 bg-slate-800 hover:border-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {ROLE_LABELS[rt]}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional Trainer Assignment */}
            <div className="mb-5">
              <label className="text-slate-400 text-xs font-medium mb-1 block">Trainer (optional)</label>
              <RepSelector
                value={newTrainerId}
                onChange={setNewTrainerId}
                reps={reps}
                placeholder="-- Select trainer --"
                clearLabel="None"
              />
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <button
                onClick={resetAddModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRep}
                disabled={!newFirstName.trim() || !newLastName.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Add Rep
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function RepsSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-9 w-9 bg-slate-800 rounded-lg animate-skeleton" />
          <div className="h-8 w-20 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-3 w-44 bg-slate-800/70 rounded animate-skeleton ml-12 mt-1" style={{ animationDelay: '150ms' }} />
      </div>

      {/* Search bar placeholder */}
      <div className="relative max-w-xs mb-6">
        <div className="h-9 w-full bg-slate-800 rounded-xl animate-skeleton" style={{ animationDelay: '75ms' }} />
      </div>

      {/* 6 rep card skeletons */}
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => {
          const delay = i * 75;
          return (
            <div
              key={i}
              className="card-surface rounded-2xl p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
            >
              {/* Avatar + name/email */}
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-full bg-slate-800 flex-shrink-0 animate-skeleton"
                  style={{ animationDelay: `${delay}ms` }}
                />
                <div className="space-y-2">
                  <div
                    className="h-4 w-32 bg-slate-800 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  <div
                    className="h-3 w-44 bg-slate-800/70 rounded animate-skeleton"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                </div>
              </div>

              {/* 4 stat number placeholders */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:items-center md:gap-8">
                {[...Array(4)].map((_, si) => (
                  <div key={si} className="text-center space-y-1.5">
                    <div
                      className="h-4 w-10 bg-slate-800 rounded animate-skeleton mx-auto"
                      style={{ animationDelay: `${delay + si * 30}ms` }}
                    />
                    <div
                      className="h-3 w-14 bg-slate-800/70 rounded animate-skeleton mx-auto"
                      style={{ animationDelay: `${delay + si * 30}ms` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
