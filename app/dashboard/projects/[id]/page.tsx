'use client';

import { use, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { useIsHydrated, useMediaQuery } from '../../../../lib/hooks';
import MobileProjectDetail from '../../mobile/MobileProjectDetail';
import {
  PHASES, Phase, InstallerBaseline,
  getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal,
  calculateCommission,
  INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT,
} from '../../../../lib/data';
import { formatDate } from '../../../../lib/utils';
import { Flag, FlagOff, AlertTriangle, X, Check, Clock, ArrowRight, Pencil, ChevronLeft, ChevronRight, Copy, Plus, RefreshCw, MessageSquare, Zap, User, Trash2 } from 'lucide-react';
import { SearchableSelect } from '../../components/SearchableSelect';
import ConfirmDialog from '../../components/ConfirmDialog';
import ProjectChatter from '../../components/ProjectChatter';

// ─── Pipeline stepper ────────────────────────────────────────────────────────

/** Ordered phases that form the main pipeline (excludes off-track states) */
const PIPELINE_STEPS: Phase[] = [
  'New',
  'Acceptance',
  'Site Survey',
  'Design',
  'Permitting',
  'Pending Install',
  'Installed',
  'PTO',
  'Completed',
];

/** Typical timeline hint shown below the stepper for the *next* phase */
const NEXT_ACTION_HINTS: Partial<Record<Phase, string>> = {
  'New':             'Acceptance — typically takes 1-2 business days',
  'Acceptance':      'Site Survey — typically takes 3-5 business days',
  'Site Survey':     'Design — typically takes 5-7 business days',
  'Design':          'Permitting — typically takes 2-4 weeks',
  'Permitting':      'Pending Install — typically takes 1-2 weeks',
  'Pending Install': 'Installed — typically takes 1-2 business days',
  'Installed':       'PTO — typically takes 2-4 weeks',
  'PTO':             'Completed — mark as fully done once PTO is granted',
};

function PipelineStepper({ phase, soldDate }: { phase: Phase; soldDate: string }) {
  const currentIndex = PIPELINE_STEPS.indexOf(phase);
  const isOffTrack = currentIndex === -1; // Cancelled or On Hold

  // Days elapsed since sold date (NOTE: this is time since sale, not time in current phase)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [sy, sm, sd] = soldDate.split('-').map(Number);
  const sold  = new Date(sy, sm - 1, sd);
  const daysSinceSold = Math.max(0, Math.floor((today.getTime() - sold.getTime()) / (1000 * 60 * 60 * 24)));

  const nextHint   = NEXT_ACTION_HINTS[phase] ?? null;
  const isComplete = !isOffTrack && currentIndex === PIPELINE_STEPS.length - 1;

  return (
    <div className="bg-[var(--surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6">

      {/* ── Horizontal stepper ── */}
      <div className="flex items-start w-full overflow-x-auto pb-0.5 gap-0">
        {PIPELINE_STEPS.map((step, index) => {
          const isCompleted = !isOffTrack && currentIndex > index;
          const isCurrent   = !isOffTrack && currentIndex === index;

          return (
            <div key={step} className="flex items-start">
              {/* Step node */}
              <div className="flex flex-col items-center shrink-0 w-14">
                {/* Circle */}
                <div className="relative flex items-center justify-center w-8 h-8">
                  {/* Pulsing halo on current step */}
                  {isCurrent && (
                    <span className="absolute inset-0 stepper-pulse" />
                  )}
                  <div
                    className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold z-10 transition-all duration-500 ${
                      isCompleted
                        ? 'bg-[var(--accent-green)] text-black'
                        : isCurrent
                        ? 'bg-[var(--accent-green)] text-black ring-2 ring-[var(--accent-green)] ring-offset-[3px] ring-offset-slate-900'
                        : 'bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-muted)]'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    ) : (
                      index + 1
                    )}
                  </div>
                </div>

                {/* Label */}
                <span
                  className={`mt-1.5 text-[9px] leading-tight text-center font-medium w-full ${
                    isCurrent   ? 'text-[var(--accent-green)]'
                    : isCompleted ? 'text-[var(--accent-green)]'
                    : 'text-[var(--text-dim)]'
                  }`}
                >
                  {step}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {index < PIPELINE_STEPS.length - 1 && (
                <div
                  className={`flex-1 min-w-[6px] h-0.5 mt-4 shrink ${
                    isCompleted ? 'stepper-connector-complete' : 'bg-[var(--border)]'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Days-in-stage badge + next-action prompt ── */}
      <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-3">

        {/* Badge — days elapsed since sold date */}
        {!isOffTrack && !isComplete && (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
            daysSinceSold > 30
              ? daysSinceSold > 60
                ? 'bg-red-900/40 border border-red-500/20 text-red-300'
                : 'bg-amber-900/40 border border-amber-500/20 text-amber-300'
              : 'bg-blue-900/40 border border-[var(--accent-green)]/20 text-[var(--accent-cyan)]'
          }`}>
            <Clock className="w-3 h-3" />
            {daysSinceSold} day{daysSinceSold !== 1 ? 's' : ''} since sold
          </span>
        )}

        {/* Off-track badge */}
        {isOffTrack && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
              phase === 'Cancelled'
                ? 'bg-red-900/40 border border-red-500/20 text-red-300'
                : 'bg-yellow-900/40 border border-yellow-500/20 text-yellow-300'
            }`}
          >
            {phase === 'Cancelled' ? 'Project Cancelled' : 'Project On Hold'}
          </span>
        )}

        {/* Next-action prompt */}
        {nextHint && (
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 min-w-0">
            <ArrowRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
            <span className="text-[var(--text-muted)] shrink-0">Next:</span>
            <span className="text-[var(--text-secondary)] truncate">{nextHint}</span>
          </p>
        )}

        {/* Completion message */}
        {isComplete && (
          <p className="text-xs text-[var(--accent-green)] font-medium">
            Project complete!
          </p>
        )}
      </div>

      {/* ── Current phase info line ── */}
      {!isOffTrack && !isComplete && (
        <div className={`mt-3 px-3 py-2.5 rounded-xl border flex items-center gap-2 ${
          daysSinceSold > 30
            ? daysSinceSold > 60
              ? 'bg-red-900/20 border-red-500/20'
              : 'bg-amber-900/20 border-amber-500/20'
            : 'bg-[var(--surface-card)]/40 border-[var(--border)]/40'
        }`}>
          <span className={`text-sm font-semibold ${
            daysSinceSold > 30
              ? daysSinceSold > 60
                ? 'text-red-300'
                : 'text-amber-300'
              : 'text-white'
          }`}>
            Currently in: {phase}
          </span>
          {nextHint && (
            <span className={`text-xs ${
              daysSinceSold > 30 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
            }`}>
              — {nextHint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const cancelled = phase === 'Cancelled';
  const pto = phase === 'PTO';
  const completed = phase === 'Completed';
  const onHold = phase === 'On Hold';
  const cls = cancelled
    ? 'bg-red-900/50 text-red-400'
    : completed
    ? 'bg-green-900/50 text-green-400 ring-1 ring-green-500/30'
    : pto
    ? 'bg-emerald-900/50 text-[var(--accent-green)]'
    : onHold
    ? 'bg-yellow-900/50 text-yellow-400'
    : 'bg-blue-900/50 text-[var(--accent-green)]';
  return <span className={`px-2.5 py-1 rounded-md text-sm font-medium ${cls}`}>{phase}{completed && ' ✓'}</span>;
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────

/**
 * Mirrors the project detail page layout with animated placeholder blocks.
 * Shown during the server→client hydration window to eliminate the
 * blank→content flash when navigating to a project from the Kanban board or
 * dashboard attention items.
 */
function ProjectDetailSkeleton() {
  return (
    <div className="px-3 pt-2 pb-4 md:p-8 max-w-3xl">

      {/* Breadcrumb placeholder */}
      <div
        className="h-9 w-56 bg-[var(--surface-card)] rounded-xl animate-skeleton mb-6"
        style={{ animationDelay: '0ms' }}
      />

      {/* ── Pipeline stepper placeholder ── */}
      <div className="bg-[var(--surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6">

        {/* 9 circles connected by connector lines */}
        <div className="flex items-start w-full overflow-x-auto pb-0.5 gap-0">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="flex items-start">

              {/* Step node */}
              <div className="flex flex-col items-center shrink-0 w-14">
                {/* Circle */}
                <div
                  className="w-7 h-7 rounded-full bg-[var(--surface-card)] animate-skeleton"
                  style={{ animationDelay: `${i * 75}ms` }}
                />
                {/* Label text */}
                <div
                  className="mt-1.5 h-2 w-10 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                  style={{ animationDelay: `${i * 75}ms` }}
                />
              </div>

              {/* Connector line — not rendered after the last step */}
              {i < 8 && (
                <div className="flex-1 min-w-[6px] h-0.5 mt-4 shrink bg-[var(--border)]/60" />
              )}
            </div>
          ))}
        </div>

        {/* Days badge + next-action hint row */}
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-3">
          <div
            className="h-6 w-32 bg-[var(--surface-card)] rounded-full animate-skeleton"
            style={{ animationDelay: '675ms' }}
          />
          <div
            className="h-4 w-52 bg-[var(--surface-card)]/60 rounded animate-skeleton"
            style={{ animationDelay: '750ms' }}
          />
        </div>
      </div>

      {/* ── Header placeholder ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-3">
          {/* Blue accent bar */}
          <div
            className="h-[3px] w-12 bg-[var(--surface-card)] rounded-full animate-skeleton"
            style={{ animationDelay: '75ms' }}
          />
          {/* Customer name */}
          <div
            className="h-9 w-56 bg-[var(--surface-card)] rounded animate-skeleton"
            style={{ animationDelay: '150ms' }}
          />
          {/* Phase badge + sold date */}
          <div className="flex items-center gap-3">
            <div
              className="h-6 w-20 bg-[var(--surface-card)] rounded-md animate-skeleton"
              style={{ animationDelay: '225ms' }}
            />
            <div
              className="h-4 w-28 bg-[var(--surface-card)]/60 rounded animate-skeleton"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        </div>

        {/* Action button area */}
        <div
          className="h-8 w-20 bg-[var(--surface-card)] rounded-xl animate-skeleton"
          style={{ animationDelay: '375ms' }}
        />
      </div>

      {/* ── Details grid placeholder (two-column, 6 label+value rows) ── */}
      <div className="card-surface rounded-2xl p-6 mb-5">
        {/* Section heading */}
        <div
          className="h-5 w-32 bg-[var(--surface-card)] rounded animate-skeleton mb-4"
          style={{ animationDelay: '75ms' }}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              {/* Label */}
              <div
                className="h-2.5 w-14 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                style={{ animationDelay: `${(i + 2) * 75}ms` }}
              />
              {/* Value */}
              <div
                className="h-4 bg-[var(--surface-card)] rounded animate-skeleton"
                style={{
                  width: i % 3 === 0 ? '72%' : i % 3 === 1 ? '58%' : '65%',
                  animationDelay: `${(i + 2) * 75}ms`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Notes section placeholder ── */}
      <div className="card-surface rounded-2xl p-6">
        {/* Section heading */}
        <div
          className="h-5 w-16 bg-[var(--surface-card)] rounded animate-skeleton mb-3"
          style={{ animationDelay: '600ms' }}
        />

        {/* Three lines of faux note text */}
        <div className="space-y-2">
          <div
            className="h-4 w-full bg-[var(--surface-card)]/80 rounded animate-skeleton"
            style={{ animationDelay: '675ms' }}
          />
          <div
            className="h-4 w-4/5 bg-[var(--surface-card)]/70 rounded animate-skeleton"
            style={{ animationDelay: '750ms' }}
          />
          <div
            className="h-4 w-3/5 bg-[var(--surface-card)]/60 rounded animate-skeleton"
            style={{ animationDelay: '825ms' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Inline Notes Editor (rep view) ──────────────────────────────────────────

function InlineNotesEditor({ notes, onSave }: { notes: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync external changes
  useEffect(() => { setText(notes); }, [notes]);

  const doSave = useCallback((value: string) => {
    if (value !== notes) {
      onSave(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [notes, onSave]);

  const handleChange = (value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(value), 1000);
  };

  const handleBlur = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    doSave(text);
    setEditing(false);
  };

  if (editing) {
    return (
      <div>
        <textarea
          ref={textareaRef}
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          maxLength={1000}
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-slate-500 resize-none"
          placeholder="Add notes about this project..."
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-[var(--text-muted)]">{text.length} / 1000</p>
          {saved && <span className="text-xs text-[var(--accent-green)] animate-fade-in-up">Saved</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/notes cursor-pointer rounded-lg px-3 py-2 -mx-3 -my-2 hover:bg-[var(--surface-card)]/40 transition-colors"
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true); } }}
    >
      <div className="flex items-start gap-2">
        {notes ? (
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed flex-1">{notes}</p>
        ) : (
          <p className="text-[var(--text-dim)] text-sm italic flex-1">Click to add notes...</p>
        )}
        <Pencil className="w-3.5 h-3.5 text-[var(--text-dim)] opacity-0 group-hover/notes:opacity-100 transition-opacity shrink-0 mt-0.5" />
      </div>
      {saved && <span className="text-xs text-[var(--accent-green)] mt-1 block">Saved</span>}
    </div>
  );
}

// ─── Relative time helper ────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

// ─── Activity type styling ───────────────────────────────────────────────────

const ACTIVITY_STYLES: Record<string, { color: string; icon: typeof Clock }> = {
  phase_change:    { color: 'bg-[var(--accent-green)]',    icon: ArrowRight },
  flagged:         { color: 'bg-red-500',     icon: Flag },
  unflagged:       { color: 'bg-red-400',     icon: FlagOff },
  m1_paid:         { color: 'bg-[var(--accent-green)]', icon: Check },
  m2_paid:         { color: 'bg-[var(--accent-green)]', icon: Check },
  note_edit:       { color: 'bg-amber-500',   icon: MessageSquare },
  field_edit:      { color: 'bg-[var(--text-muted)]',   icon: Pencil },
  created:         { color: 'bg-purple-500',  icon: Plus },
  setter_assigned: { color: 'bg-cyan-500',    icon: User },
};

// ─── Activity Timeline component ─────────────────────────────────────────────

interface ActivityEntry {
  id: string;
  type: string;
  detail: string;
  meta: string | null;
  createdAt: string;
}

function ActivityTimeline({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  const fetchActivities = useCallback((skip: number, append: boolean) => {
    setLoading(true);
    if (!append) setActivities([]);
    fetch(`/api/projects/${projectId}/activity?limit=${LIMIT}&offset=${skip}`)
      .then((res) => res.json())
      .then((data) => {
        setActivities((prev) => append ? [...prev, ...data.activities] : data.activities);
        setTotal(data.total);
        setOffset(skip + data.activities.length);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchActivities(0, false);
  }, [fetchActivities]);

  const hasMore = offset < total;

  return (
    <div className="card-surface rounded-2xl p-6 mt-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-[var(--text-secondary)]" />
        <h2 className="text-white font-semibold">Activity</h2>
        <span className="text-[var(--text-muted)] text-xs">({total})</span>
      </div>

      {loading && activities.length === 0 ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading activity...
        </div>
      ) : activities.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No activity recorded yet</p>
      ) : (
        <div className="relative pl-8">
          {/* Vertical line */}
          <div className="absolute left-3 top-0 bottom-0 w-px bg-[var(--surface-card)]" />

          {activities.map((entry) => {
            const style = ACTIVITY_STYLES[entry.type] ?? { color: 'bg-[var(--text-dim)]', icon: Zap };
            const Icon = style.icon;
            return (
              <div key={entry.id} className="relative mb-4 last:mb-0">
                {/* Dot on the line */}
                <div className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full ${style.color} ring-4 ring-slate-900`} />
                {/* Content */}
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">{entry.detail}</p>
                  <p className="text-xs text-[var(--text-muted)]">{relativeTime(entry.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => fetchActivities(offset, true)}
          disabled={loading}
          className="mt-3 text-xs text-[var(--accent-green)] hover:text-[var(--accent-cyan)] transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentRole, effectiveRole, projects, setProjects, payrollEntries, currentRepId, reps, activeInstallers, activeFinancers, installerBaselines, updateProject: ctxUpdateProject, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions, installerPayConfigs, solarTechProducts } = useApp();
  const isPM = effectiveRole === 'project_manager';
  const { toast } = useToast();
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const project = projects.find((p) => p.id === id);
  useEffect(() => { document.title = project ? `${project.customerName} | Kilo Energy` : 'Project Detail | Kilo Energy'; }, [project?.customerName]);
  const [adminNotes, setAdminNotes] = useState(project?.notes ?? '');
  const [adminNotesSaved, setAdminNotesSaved] = useState(false);
  const adminNotesDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the last project.notes value we synced from so we can detect external
  // changes (e.g. the Edit modal saving new notes) without clobbering unsaved
  // local edits the admin is actively typing.
  const lastSyncedNotes = useRef(project?.notes ?? '');
  useEffect(() => {
    const incoming = project?.notes ?? '';
    if (incoming !== lastSyncedNotes.current) {
      // project.notes changed externally — only overwrite local textarea if the
      // admin hasn't started typing something new (i.e. textarea still matches
      // the previous synced value).
      if (adminNotes === lastSyncedNotes.current) {
        setAdminNotes(incoming);
      }
      lastSyncedNotes.current = incoming;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.notes]);

  // Auto-save admin notes with 1s debounce
  const doSaveAdminNotes = useCallback((value: string) => {
    if (project && value !== (project.notes ?? '')) {
      ctxUpdateProject(id, { notes: value });
      lastSyncedNotes.current = value;
      setAdminNotesSaved(true);
      setTimeout(() => setAdminNotesSaved(false), 2000);
    }
  }, [project, id, ctxUpdateProject]);

  const handleAdminNotesChange = (value: string) => {
    setAdminNotes(value);
    if (adminNotesDebounce.current) clearTimeout(adminNotesDebounce.current);
    adminNotesDebounce.current = setTimeout(() => doSaveAdminNotes(value), 1000);
  };

  // Save on blur immediately (cancel pending debounce)
  const handleAdminNotesBlur = () => {
    if (adminNotesDebounce.current) { clearTimeout(adminNotesDebounce.current); adminNotesDebounce.current = null; }
    doSaveAdminNotes(adminNotes);
  };

  // Cancel debounce timer on unmount
  useEffect(() => {
    return () => { if (adminNotesDebounce.current) clearTimeout(adminNotesDebounce.current); };
  }, []);

  // Warn on navigation if notes are dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (project && adminNotes !== (project.notes ?? '')) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [adminNotes, project]);
  const [editM1, setEditM1] = useState(false);
  const [editM2, setEditM2] = useState(false);
  const [m1Val, setM1Val] = useState('');
  const [m2Val, setM2Val] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');
  const [phaseConfirm, setPhaseConfirm] = useState<Phase | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editVals, setEditVals] = useState({
    installer: '',
    financer: '',
    productType: '',
    kWSize: '',
    netPPW: '',
    setterId: '',
    soldDate: '',
    notes: '',
    useBaselineOverride: false,
    overrideCloserPerW: '',
    overrideSetterPerW: '',
    overrideKiloPerW: '',
  });

  // ── Prev/Next project navigation ─────────────────────────────────────────
  const [navIds, setNavIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('kilo-project-nav');
      if (raw) setNavIds(JSON.parse(raw));
    } catch { /* SSR / quota guard */ }
  }, []);
  const navIndex = navIds.indexOf(id);
  const prevProjectId = navIndex > 0 ? navIds[navIndex - 1] : null;
  const nextProjectId = navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null;

  // ArrowLeft / ArrowRight keyboard shortcuts (only when no input is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showEditModal || showCancelConfirm || showDeleteConfirm || showCancelReasonModal || phaseConfirm) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'ArrowLeft' && prevProjectId) {
        e.preventDefault();
        router.push(`/dashboard/projects/${prevProjectId}`);
      } else if (e.key === 'ArrowRight' && nextProjectId) {
        e.preventDefault();
        router.push(`/dashboard/projects/${nextProjectId}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevProjectId, nextProjectId, showEditModal, showCancelConfirm, showDeleteConfirm, showCancelReasonModal, phaseConfirm]);

  // Escape to close Edit Project modal
  useEffect(() => {
    if (!showEditModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowEditModal(false); setEditErrors({}); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showEditModal]);

  // (Cancel Confirm Escape handler removed — ConfirmDialog handles it internally)

  // Mobile layout
  if (isMobile) return <MobileProjectDetail projectId={id} />;

  // Return the skeleton loader during the server→client hydration window so
  // the page never flashes raw blank content when navigating to a project.
  if (!isHydrated) return <ProjectDetailSkeleton />;

  if (!project) {
    return (
      <div className="p-4 md:p-8 text-center text-[var(--text-muted)]">
        Project not found.{' '}
        <Link href="/dashboard/projects" className="text-[var(--accent-green)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  // Reps can only view their own projects
  if (currentRole === 'rep' && project.repId !== currentRepId && project.setterId !== currentRepId) {
    return (
      <div className="p-4 md:p-8 text-center text-[var(--text-muted)] text-sm">
        You don&apos;t have permission to view this project.{' '}
        <Link href="/dashboard/projects" className="text-[var(--accent-green)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  // Sub-dealers can only view projects assigned to them
  if (currentRole === 'sub-dealer' && project.subDealerId !== currentRepId && project.repId !== currentRepId) {
    return (
      <div className="p-4 md:p-8 text-center text-[var(--text-muted)] text-sm">
        You don&apos;t have permission to view this project.{' '}
        <Link href="/dashboard/projects" className="text-[var(--accent-green)] hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  const updateProject = (updates: Partial<typeof project>) => {
    ctxUpdateProject(id, updates);
  };

  const handleCancel = () => {
    setShowCancelConfirm(false);
    setCancelReason('');
    setCancelNotes('');
    setShowCancelReasonModal(true);
  };

  const confirmCancelWithReason = () => {
    if (!cancelReason) {
      toast('Please select a cancellation reason', 'error');
      return;
    }
    updateProject({
      phase: 'Cancelled',
      cancellationReason: cancelReason || undefined,
      cancellationNotes: cancelNotes || undefined,
    } as Partial<typeof project>);
    setShowCancelReasonModal(false);
    toast('Project cancelled', 'info');
    router.push('/dashboard/projects');
  };

  const handleDeleteProject = async () => {
    setShowDeleteConfirm(false);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== project.id));
        toast('Project deleted permanently');
        router.push('/dashboard/projects');
      } else {
        toast('Failed to delete project', 'error');
      }
    } catch {
      toast('Failed to delete project', 'error');
    }
  };

  const doPhaseChange = (phase: Phase) => {
    if (phase === 'Cancelled') {
      setCancelReason('');
      setCancelNotes('');
      setShowCancelReasonModal(true);
      return;
    }
    const previousPhase = project.phase;
    updateProject({ phase });
    toast(`Phase updated to ${phase}`, 'success', {
      label: 'Undo',
      onClick: () => {
        if (previousPhase === 'Cancelled') {
          setCancelReason('');
          setCancelNotes('');
          setShowCancelReasonModal(true);
        } else {
          updateProject({ phase: previousPhase });
        }
      },
    });
  };

  const handlePhaseChange = (phase: Phase) => {
    if (phase === 'On Hold') {
      setPhaseConfirm(phase);
      return;
    }
    if (phase === 'Cancelled') {
      setCancelReason('');
      setCancelNotes('');
      setShowCancelReasonModal(true);
      return;
    }
    doPhaseChange(phase);
  };

  const handleFlag = () => {
    const newFlagged = !project.flagged;
    updateProject({ flagged: newFlagged });
    toast(newFlagged ? 'Project flagged' : 'Flag removed', newFlagged ? 'info' : 'success');
  };

  const handleToggleM1 = () => {
    const previousM1Paid = project.m1Paid;
    const next = !previousM1Paid;
    updateProject({ m1Paid: next });
    toast(
      `M1 marked as ${next ? 'Paid' : 'Unpaid'}`,
      'success',
      { label: 'Undo', onClick: () => { updateProject({ m1Paid: previousM1Paid }); } },
    );
  };

  const handleToggleM2 = () => {
    const previousM2Paid = project.m2Paid;
    const next = !previousM2Paid;
    updateProject({ m2Paid: next });
    toast(
      `M2 marked as ${next ? 'Paid' : 'Unpaid'}`,
      'success',
      { label: 'Undo', onClick: () => { updateProject({ m2Paid: previousM2Paid }); } },
    );
  };

  const saveM1 = () => {
    const val = parseFloat(m1Val);
    if (!isNaN(val)) { updateProject({ m1Amount: val }); toast('M1 amount updated', 'success'); setEditM1(false); }
    else { toast('Invalid amount', 'error'); }
  };

  const saveM2 = () => {
    const val = parseFloat(m2Val);
    if (!isNaN(val)) {
      const installPayPct = installerPayConfigs[project.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      const newM3 = installPayPct < 100 && !project.subDealerId
        ? Math.round(val * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      const originalM2 = project.m2Amount ?? 0;
      const scale = originalM2 > 0 ? val / originalM2 : 1;
      const newSetterM2 = Math.round((project.setterM2Amount ?? 0) * scale * 100) / 100;
      const newSetterM3 = installPayPct < 100 && !project.subDealerId && project.setterId
        ? Math.round(newSetterM2 * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
      updateProject({ m2Amount: val, m3Amount: newM3, setterM2Amount: newSetterM2, setterM3Amount: newSetterM3 });
      if (originalM2 === 0 && project.setterId) {
        toast('M2 updated — setter M2 was $0 and could not be auto-adjusted. Use Edit Deal to recalculate setter amounts.', 'error');
      } else {
        toast('M2 amount updated', 'success');
      }
      setEditM2(false);
    } else { toast('Invalid amount', 'error'); }
  };

  const openEditModal = () => {
    setEditVals({
      installer: project.installer,
      financer: project.financer,
      productType: project.productType,
      kWSize: String(project.kWSize),
      netPPW: String(project.netPPW),
      setterId: project.setterId ?? '',
      soldDate: project.soldDate,
      notes: project.notes ?? '',
      useBaselineOverride: !!project.baselineOverride,
      overrideCloserPerW: project.baselineOverride ? String(project.baselineOverride.closerPerW) : '',
      overrideSetterPerW: project.baselineOverride?.setterPerW != null ? String(project.baselineOverride.setterPerW) : '',
      overrideKiloPerW: project.baselineOverride ? String(project.baselineOverride.kiloPerW) : '',
    });
    setEditErrors({});
    setShowEditModal(true);
  };

  const saveEditModal = () => {
    const kw = parseFloat(editVals.kWSize);
    const ppw = parseFloat(editVals.netPPW);

    // Validate required fields before saving
    const errs: Record<string, string> = {};
    if (!editVals.installer) errs.installer = 'Installer is required';
    if (!editVals.soldDate) errs.soldDate = 'Sold date is required';
    if (!editVals.kWSize || isNaN(kw) || kw <= 0) errs.kWSize = 'Must be a number greater than 0';
    if (!editVals.netPPW || isNaN(ppw) || ppw <= 0) errs.netPPW = 'Must be a number greater than 0';
    if (editVals.useBaselineOverride) {
      const oc = parseFloat(editVals.overrideCloserPerW);
      const ok = parseFloat(editVals.overrideKiloPerW);
      if (!editVals.overrideCloserPerW || isNaN(oc) || oc <= 0) errs.overrideCloserPerW = 'Must be a number greater than 0';
      if (!editVals.overrideKiloPerW || isNaN(ok) || ok <= 0) errs.overrideKiloPerW = 'Must be a number greater than 0';
    }
    setEditErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    const setterRep = reps.find((r) => r.id === editVals.setterId);
    const parsedSetterPerW = parseFloat(editVals.overrideSetterPerW);
    const baselineOverride: InstallerBaseline | undefined = editVals.useBaselineOverride
      ? {
          closerPerW: parseFloat(editVals.overrideCloserPerW) || 0,
          kiloPerW: parseFloat(editVals.overrideKiloPerW) || 0,
          ...(editVals.overrideSetterPerW !== '' && !isNaN(parsedSetterPerW) ? { setterPerW: parsedSetterPerW } : {}),
        }
      : undefined;
    let editBaseline: InstallerBaseline;
    if (editVals.useBaselineOverride) {
      editBaseline = { closerPerW: parseFloat(editVals.overrideCloserPerW) || 0, kiloPerW: parseFloat(editVals.overrideKiloPerW) || 0, ...(editVals.overrideSetterPerW !== '' && !isNaN(parsedSetterPerW) ? { setterPerW: parsedSetterPerW } : {}) };
    } else if (editVals.installer === 'SolarTech' && project.solarTechProductId) {
      editBaseline = getSolarTechBaseline(project.solarTechProductId, kw, solarTechProducts);
    } else if (project.installerProductId && editVals.installer === project.installer) {
      editBaseline = getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, kw, editVals.soldDate || project.soldDate, productCatalogPricingVersions);
    } else {
      editBaseline = getInstallerRatesForDeal(editVals.installer, editVals.soldDate || project.soldDate, kw, installerPricingVersions);
    }
    const editCloserTotal = calculateCommission(ppw, editBaseline.closerPerW, kw);
    const editM1Flat = kw >= 5 ? 1000 : 500;
    const editSetterPerW = 'setterPerW' in editBaseline && editBaseline.setterPerW != null
      ? editBaseline.setterPerW
      : Math.round((editBaseline.closerPerW + 0.10) * 100) / 100;
    const editSetterTotal = calculateCommission(ppw, editSetterPerW, kw);
    const editSetterM1Amount = editVals.setterId ? Math.min(editM1Flat, Math.max(0, editSetterTotal)) : 0;
    const editInstallPayPct = installerPayConfigs[editVals.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    const editHasM3 = editInstallPayPct < 100 && !project.subDealerId;
    const editCloserM1 = editVals.setterId ? 0 : Math.min(editM1Flat, Math.max(0, editCloserTotal));
    const editCloserM2Full = Math.max(0, editCloserTotal - editCloserM1);
    const editSetterM2Full = Math.max(0, editSetterTotal - editSetterM1Amount);
    const editM2Amount = Math.round(editCloserM2Full * (editInstallPayPct / 100) * 100) / 100;
    const editM3Amount = editHasM3 ? Math.round(editCloserM2Full * ((100 - editInstallPayPct) / 100) * 100) / 100 : 0;
    const editSetterM2Amount = editVals.setterId ? Math.round(editSetterM2Full * (editInstallPayPct / 100) * 100) / 100 : 0;
    const editSetterM3Amount = editVals.setterId && editHasM3 ? Math.round(editSetterM2Full * ((100 - editInstallPayPct) / 100) * 100) / 100 : 0;
    ctxUpdateProject(project.id, {
      installer: editVals.installer,
      financer: editVals.financer,
      productType: editVals.productType,
      kWSize: kw,
      netPPW: ppw,
      m1Amount: editVals.setterId ? 0 : Math.min(editM1Flat, Math.max(0, editCloserTotal)),
      m2Amount: editM2Amount,
      m3Amount: editM3Amount,
      setterId: editVals.setterId || undefined,
      setterName: setterRep?.name ?? (editVals.setterId ? project.setterName : undefined),
      soldDate: editVals.soldDate,
      notes: editVals.notes,
      baselineOverride,
      setterM1Amount: editSetterM1Amount,
      setterM2Amount: editSetterM2Amount,
      setterM3Amount: editSetterM3Amount,
      ...(editVals.installer !== project.installer ? { installerProductId: undefined, solarTechProductId: undefined } : {}),
    });
    setShowEditModal(false);
    setEditErrors({});
    toast('Project updated', 'success');
  };

  // Commission entries for this project (rep view)
  const myEntries = currentRole === 'rep'
    ? payrollEntries.filter((e) => e.projectId === project.id && e.repId === currentRepId)
    : [];

  // All payroll entries for this project (admin view)
  const projectEntries = payrollEntries.filter((e) => e.projectId === project.id);
  const closerEntries = projectEntries.filter((e) => e.repId === project.repId);
  const setterEntries = project.setterId ? projectEntries.filter((e) => e.repId === project.setterId) : [];
  const otherEntries  = projectEntries.filter((e) => !closerEntries.includes(e) && !setterEntries.includes(e));

  // Resolved baseline rates for this project
  const projectBaselines = (() => {
    if (project.baselineOverride) return project.baselineOverride;
    if (project.installer === 'SolarTech' && project.solarTechProductId) {
      return getSolarTechBaseline(project.solarTechProductId, project.kWSize, solarTechProducts);
    }
    if (project.installerProductId) {
      return getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, project.kWSize, project.soldDate, productCatalogPricingVersions);
    }
    return getInstallerRatesForDeal(project.installer, project.soldDate, project.kWSize, installerPricingVersions);
  })();

  const closerExpectedM2 = project.m2Amount ?? 0;
  const setterPerW = 'setterPerW' in projectBaselines && projectBaselines.setterPerW != null
    ? projectBaselines.setterPerW
    : Math.round((projectBaselines.closerPerW + 0.10) * 100) / 100;
  const m1Flat = project.kWSize >= 5 ? 1000 : 500;

  const inputCls =
    'bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]';

  return (
    <div className="px-3 pt-2 pb-4 md:p-8 max-w-3xl">
      {/* Breadcrumb + Prev/Next */}
      <div className="flex items-center justify-between mb-6">
        <nav className="animate-breadcrumb-enter inline-flex items-center gap-0.5 text-xs text-[var(--text-secondary)] bg-[var(--surface)]/60 backdrop-blur-md border border-[var(--border-subtle)]/60 rounded-xl px-4 py-2.5">
          <Link href="/dashboard" className="hover:bg-[var(--surface-card)]/50 hover:text-[var(--text-secondary)] transition-colors px-2 py-1 rounded-lg">Dashboard</Link>
          <span className="text-[var(--text-dim)] mx-1">/</span>
          <Link href="/dashboard/projects" className="hover:bg-[var(--surface-card)]/50 hover:text-[var(--text-secondary)] transition-colors px-2 py-1 rounded-lg">Projects</Link>
          <span className="text-[var(--text-dim)] mx-1">/</span>
          <span className="text-white font-medium bg-[var(--accent-green)]/10 px-2.5 py-1 rounded-lg">{project.customerName}</span>
        </nav>

        {/* Prev / Next project buttons */}
        {(prevProjectId || nextProjectId) && (
          <div className="flex items-center gap-1.5">
            {prevProjectId ? (
              <Link
                href={`/dashboard/projects/${prevProjectId}`}
                title="Previous project (←)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/60 border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-white hover:border-[var(--border)] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/30 border border-[var(--border-subtle)]/40 text-[var(--text-dim)] cursor-default">
                <ChevronLeft className="w-4 h-4" />
              </span>
            )}
            {nextProjectId ? (
              <Link
                href={`/dashboard/projects/${nextProjectId}`}
                title="Next project (→)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/60 border border-[var(--border)]/60 text-[var(--text-secondary)] hover:text-white hover:border-[var(--border)] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-card)]/30 border border-[var(--border-subtle)]/40 text-[var(--text-dim)] cursor-default">
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pipeline stage tracker */}
      <PipelineStepper phase={project.phase} soldDate={project.soldDate} />

      {/* Phase quick-advance strip — admin/PM only, hidden when off-track */}
      {(currentRole === 'admin' || isPM) && !['Cancelled', 'On Hold'].includes(project.phase) && (() => {
        const phaseIdx = PIPELINE_STEPS.indexOf(project.phase as typeof PIPELINE_STEPS[number]);
        const prevStep = phaseIdx > 0 ? PIPELINE_STEPS[phaseIdx - 1] : null;
        const nextStep = phaseIdx < PIPELINE_STEPS.length - 1 ? PIPELINE_STEPS[phaseIdx + 1] : null;
        return (
          <div className="flex items-center gap-2 mb-5 -mt-3">
            {prevStep ? (
              <button
                onClick={() => handlePhaseChange(prevStep)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-amber-500/50 transition-colors"
              >
                ← {prevStep}
              </button>
            ) : <span />}
            {nextStep && (
              <button
                onClick={() => handlePhaseChange(nextStep)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent-green)]/50 transition-colors ml-auto"
              >
                {nextStep} →
              </button>
            )}
          </div>
        );
      })()}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight">{project.customerName}</h1>
            {project.flagged && (
              <span className="flex items-center gap-1 bg-red-900/40 border border-red-500/30 text-red-400 text-xs px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                Flagged
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PhaseBadge phase={project.phase} />
            <span className="text-[var(--text-muted)] text-sm">Sold {formatDate(project.soldDate)}</span>
          </div>
        </div>

        {(currentRole === 'admin' || isPM) ? (
          <div className="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-2">
            {!isPM && (
              <button
                onClick={openEditModal}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--accent-green)]/30 text-[var(--accent-green)] hover:bg-blue-900/20 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button
              onClick={handleFlag}
              className={`flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border transition-colors ${
                project.flagged
                  ? 'border-red-500/40 text-red-400 hover:bg-red-900/20'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)]'
              }`}
            >
              {project.flagged ? <FlagOff className="w-3.5 h-3.5" /> : <Flag className="w-3.5 h-3.5" />}
              {project.flagged ? 'Unflag' : 'Flag'}
            </button>
            {!isPM && (
              <Link
                href={`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </Link>
            )}
            {project.phase !== 'Cancelled' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-red-500/30 text-red-400 hover:bg-red-900/20 transition-colors"
              >
                Cancel
              </button>
            )}
            {!isPM && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-red-500/30 text-red-400 hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
            {(currentRepId === project.repId) && (
              <Link
                href={`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-card)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </Link>
            )}
            {(currentRepId === project.repId) && project.phase !== 'Cancelled' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="bg-red-900/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 text-sm px-4 py-2 min-h-[44px] w-full md:w-auto rounded-xl transition-colors"
              >
                Cancel Project
              </button>
            )}
          </div>
        )}
      </div>

      {/* Details grid */}
      <div className="card-surface rounded-2xl p-6 mb-5">
        <h2 className="text-white font-semibold mb-4">Project Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">
          {[
            ['Rep', project.repName],
            ['Installer', project.installer],
            ['Financer', project.financer],
            ['Product Type', project.productType],
            ['System Size', `${project.kWSize} kW`],
            ...(!isPM ? [['Net PPW', `$${project.netPPW}`]] : []),
            ['Sold Date', formatDate(project.soldDate)],
            ['Phase', project.phase],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-white">{value}</p>
            </div>
          ))}
          {project.setterId && (
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Setter</p>
              <p className="text-white">{project.setterName}</p>
            </div>
          )}
          {project.leadSource && (
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Lead Source</p>
              <p className="text-white capitalize">{project.leadSource === 'door_knock' ? 'Door Knock' : project.leadSource}</p>
            </div>
          )}
        </div>

        {(currentRole === 'admin' || isPM) && (
          <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-2">Change Phase</p>
            <select
              value={project.phase}
              onChange={(e) => handlePhaseChange(e.target.value as Phase)}
              className="bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]"
            >
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>{ph}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Commission — rep view shows their own payroll entries */}
      {currentRole === 'rep' && !isPM && (
        <div className="card-surface rounded-2xl p-6 mb-5">
          <h2 className="text-white font-semibold mb-4">My Commission</h2>
          {myEntries.length > 0 ? (
            <div className="space-y-2">
              {myEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-[var(--text-secondary)] text-sm font-medium">
                      {entry.paymentStage}
                      {entry.notes ? <span className="text-[var(--text-muted)] font-normal ml-1.5 text-xs">({entry.notes})</span> : null}
                    </p>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5">{formatDate(entry.date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                      entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                      entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                      'bg-[var(--border)] text-[var(--text-secondary)]'
                    }`}>
                      {entry.status}
                    </span>
                    <span className="text-[var(--accent-green)] font-bold">${entry.amount.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M1</p>
                  <p className="text-[var(--accent-green)] font-bold">${(project.setterId === currentRepId ? (project.setterM1Amount ?? 0) : (project.m1Amount ?? 0)).toLocaleString()}</p>
                </div>
                <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M2</p>
                  <p className="text-[var(--accent-green)] font-bold">${(project.setterId === currentRepId ? (project.setterM2Amount ?? 0) : (project.m2Amount ?? 0)).toLocaleString()}</p>
                </div>
                {(project.setterId === currentRepId ? (project.setterM3Amount ?? 0) : (project.m3Amount ?? 0)) > 0 && (
                  <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                    <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M3</p>
                    <p className="text-teal-400 font-bold">${(project.setterId === currentRepId ? (project.setterM3Amount ?? 0) : (project.m3Amount ?? 0)).toLocaleString()}</p>
                  </div>
                )}
              </div>
              <p className="text-[var(--text-muted)] text-sm">
                No payments yet &mdash; commission will appear here as milestones are reached.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Commission breakdown (admin) */}
      {currentRole === 'admin' && !isPM && (
        <div className="card-surface rounded-2xl p-6 mb-5">
          <h2 className="text-white font-semibold mb-1">Commission Breakdown</h2>

          {/* Baseline rates summary */}
          <div className="flex flex-wrap gap-3 mb-4 mt-2">
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Closer baseline: <span className="text-[var(--accent-cyan)] font-semibold">${projectBaselines.closerPerW.toFixed(3)}/W</span>
            </span>
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Kilo cost: <span className="text-purple-300 font-semibold">${projectBaselines.kiloPerW.toFixed(3)}/W</span>
            </span>
            <span className="text-xs bg-[var(--surface-card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-secondary)]">
              Sold: <span className="text-white font-semibold">${project.netPPW.toFixed(3)}/W</span>
            </span>
          </div>

          <div className="space-y-4">
            {/* ── Closer ── */}
            <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-white text-sm font-semibold">{project.repName}</p>
                  <p className="text-[var(--text-muted)] text-xs">Closer</p>
                </div>
                <div className="text-right">
                  {!project.setterId && (
                    <>
                      <p className="text-[var(--text-secondary)] text-xs">Expected M1</p>
                      <p className="text-[var(--accent-green)] font-bold text-sm mb-1">${(project.m1Amount ?? 0).toLocaleString()}</p>
                    </>
                  )}
                  <p className="text-[var(--text-secondary)] text-xs">Expected M2</p>
                  <p className="text-[var(--accent-green)] font-bold text-sm">${closerExpectedM2.toLocaleString()}</p>
                </div>
              </div>
              {closerEntries.length > 0 ? (
                <div className="space-y-1.5">
                  {closerEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                        {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                        <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                          entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-[var(--border)] text-[var(--text-secondary)]'
                        }`}>{entry.status}</span>
                        <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--text-dim)] text-xs italic">No payroll entries yet.</p>
              )}
            </div>

            {/* ── Setter ── */}
            {project.setterId ? (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-white text-sm font-semibold">{project.setterName}</p>
                    <p className="text-[var(--text-muted)] text-xs">Setter</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--text-secondary)] text-xs">Expected M1</p>
                    <p className="text-[var(--accent-green)] font-bold text-sm mb-1">${(project.setterM1Amount ?? 0).toLocaleString()}</p>
                    <p className="text-[var(--text-secondary)] text-xs">Expected M2</p>
                    <p className="text-[var(--accent-green)] font-bold text-sm mb-1">${(project.setterM2Amount ?? 0).toLocaleString()}</p>
                    {(project.setterM3Amount ?? 0) > 0 && (
                      <>
                        <p className="text-[var(--text-secondary)] text-xs">Expected M3</p>
                        <p className="text-[var(--accent-green)] font-bold text-sm">${(project.setterM3Amount ?? 0).toLocaleString()}</p>
                      </>
                    )}
                  </div>
                </div>
                {setterEntries.length > 0 ? (
                  <div className="space-y-1.5">
                    {setterEntries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.paymentStage}</span>
                          {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                          <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                            entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                            'bg-[var(--border)] text-[var(--text-secondary)]'
                          }`}>{entry.status}</span>
                          <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[var(--text-dim)] text-xs italic">No payroll entries yet.</p>
                )}
              </div>
            ) : (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <p className="text-white text-sm font-semibold mb-0.5">{project.repName} <span className="text-[var(--text-muted)] font-normal text-xs">(self-gen)</span></p>
                <p className="text-[var(--text-muted)] text-xs">M1 flat goes to closer — no setter on this deal</p>
              </div>
            )}

            {/* ── Other entries (trainer overrides, bonuses, etc.) ── */}
            {otherEntries.length > 0 && (
              <div className="bg-[var(--surface-card)]/40 border border-[var(--border)]/50 rounded-xl p-4">
                <p className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider mb-2">Other Payouts</p>
                <div className="space-y-1.5">
                  {otherEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/70 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-[var(--text-secondary)] text-xs font-medium">{entry.repName}</span>
                        <span className="text-[var(--text-muted)] text-xs ml-1.5">{entry.paymentStage}</span>
                        {entry.notes ? <span className="text-[var(--text-muted)] text-xs ml-1.5">({entry.notes})</span> : null}
                        <p className="text-[var(--text-dim)] text-xs">{formatDate(entry.date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          entry.status === 'Paid' ? 'bg-emerald-900/50 text-[var(--accent-green)]' :
                          entry.status === 'Pending' ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-[var(--border)] text-[var(--text-secondary)]'
                        }`}>{entry.status}</span>
                        <span className="text-[var(--accent-green)] font-bold text-sm">${entry.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Milestone toggles ── */}
            <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider">Milestone Status</p>

              {/* M1 */}
              <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl p-4">
                <div>
                  <p className="text-[var(--text-secondary)] text-sm font-medium">Milestone 1 (M1)</p>
                  {editM1 ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={m1Val}
                        onChange={(e) => setM1Val(e.target.value)}
                        placeholder={String(project.m1Amount)}
                        className={inputCls + ' w-28'}
                      />
                      <button onClick={saveM1} className="text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-xs">Save</button>
                      <button onClick={() => setEditM1(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[var(--accent-green)] font-semibold">${project.m1Amount != null ? project.m1Amount.toLocaleString() : '—'}</p>
                      <button
                        onClick={() => { setM1Val(String(project.m1Amount ?? 0)); setEditM1(true); }}
                        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleToggleM1}
                    className="text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--border)] hover:bg-[var(--text-dim)] px-2 py-1 rounded-lg transition-colors"
                  >
                    {project.m1Paid ? 'Mark Unpaid' : 'Mark Paid'}
                  </button>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                    project.m1Paid ? 'bg-emerald-900/50 text-[var(--accent-green)]' : 'bg-yellow-900/50 text-yellow-400'
                  }`}>
                    {project.m1Paid ? 'Paid' : 'Pending'}
                  </span>
                </div>
              </div>

              {/* M2 */}
              <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl p-4">
                <div>
                  <p className="text-[var(--text-secondary)] text-sm font-medium">Milestone 2 (M2)</p>
                  {editM2 ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={m2Val}
                        onChange={(e) => setM2Val(e.target.value)}
                        placeholder={String(project.m2Amount)}
                        className={inputCls + ' w-28'}
                      />
                      <button onClick={saveM2} className="text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-xs">Save</button>
                      <button onClick={() => setEditM2(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[var(--accent-green)] font-semibold">${(project.m2Amount ?? 0).toLocaleString()}</p>
                      <button
                        onClick={() => { setM2Val(String(project.m2Amount ?? 0)); setEditM2(true); }}
                        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleToggleM2}
                    className="text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--border)] hover:bg-[var(--text-dim)] px-2 py-1 rounded-lg transition-colors"
                  >
                    {project.m2Paid ? 'Mark Unpaid' : 'Mark Paid'}
                  </button>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                    project.m2Paid ? 'bg-emerald-900/50 text-[var(--accent-green)]' : 'bg-yellow-900/50 text-yellow-400'
                  }`}>
                    {project.m2Paid ? 'Paid' : 'Pending'}
                  </span>
                </div>
              </div>

              {/* M3 (read-only, auto-calculated) */}
              {(project.m3Amount ?? 0) > 0 && (
                <div className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl p-4">
                  <div>
                    <p className="text-[var(--text-secondary)] text-sm font-medium">Milestone 3 (M3) — PTO</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-teal-400 font-semibold">${(project.m3Amount ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--border)]/50 text-[var(--text-secondary)]">
                    Auto at PTO
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-3">Notes</h2>

        {(currentRole === 'admin' || isPM) ? (
          <div>
            <textarea
              rows={4}
              value={adminNotes}
              onChange={(e) => handleAdminNotesChange(e.target.value)}
              onBlur={handleAdminNotesBlur}
              placeholder="Add notes about this project..."
              maxLength={1000}
              className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-slate-500 resize-none"
            />
            <div className="flex items-center justify-between mt-1">
              <p className={`text-xs transition-colors duration-200 ${
                adminNotes.length >= 960 ? 'text-red-400' :
                adminNotes.length >= 800 ? 'text-amber-400' :
                'text-[var(--text-muted)]'
              }`}>
                {adminNotes.length} / 1000
              </p>
              {adminNotesSaved && <span className="text-xs text-[var(--accent-green)] animate-fade-in-up">Saved</span>}
              {!adminNotesSaved && adminNotes !== (project.notes ?? '') && (
                <span className="text-xs text-[var(--text-muted)]">Auto-saving...</span>
              )}
            </div>
          </div>
        ) : (
          <InlineNotesEditor
            notes={project.notes ?? ''}
            onSave={(text) => { updateProject({ notes: text }); }}
          />
        )}
      </div>

      {/* Activity Timeline */}
      <ActivityTimeline projectId={id} />

      {/* Chatter */}
      <ProjectChatter projectId={id} />

      {/* Edit Project Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowEditModal(false); setEditErrors({}); } }}>
          <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-900/30">
                  <Pencil className="w-5 h-5 text-[var(--accent-green)]" />
                </div>
                <h2 className="text-white font-semibold">Edit Project</h2>
              </div>
              <button onClick={() => { setShowEditModal(false); setEditErrors({}); }} className="text-[var(--text-muted)] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Installer */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Installer</label>
                <SearchableSelect
                  value={editVals.installer}
                  onChange={(val) => { setEditVals((v) => ({ ...v, installer: val })); setEditErrors((prev) => ({ ...prev, installer: '' })); }}
                  options={(activeInstallers.includes(editVals.installer) || !editVals.installer ? activeInstallers : [editVals.installer, ...activeInstallers]).map((inst) => ({ value: inst, label: inst }))}
                  placeholder="Select installer…"
                  error={!!editErrors.installer}
                />
                {editErrors.installer && <p className="text-red-400 text-xs mt-1">{editErrors.installer}</p>}
              </div>

              {/* Financer */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Financer</label>
                <SearchableSelect
                  value={editVals.financer}
                  onChange={(val) => setEditVals((v) => ({ ...v, financer: val }))}
                  options={(activeFinancers.includes(editVals.financer) || !editVals.financer ? activeFinancers : [editVals.financer, ...activeFinancers]).map((fin) => ({ value: fin, label: fin }))}
                  placeholder="Select financer…"
                />
              </div>

              {/* Product Type */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Product Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['PPA', 'Lease', 'Loan', 'Cash'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setEditVals((v) => ({ ...v, productType: pt }))}
                      className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                        editVals.productType === pt
                          ? 'bg-[var(--accent-green)] border-[var(--accent-green)] text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]'
                          : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
                      }`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>

              {/* kW + PPW */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">System Size (kW)</label>
                  <input type="number" step="0.1" value={editVals.kWSize}
                    onChange={(e) => { setEditVals((v) => ({ ...v, kWSize: e.target.value })); setEditErrors((prev) => ({ ...prev, kWSize: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.kWSize ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                  {editErrors.kWSize && <p className="text-red-400 text-xs mt-1">{editErrors.kWSize}</p>}
                </div>
                <div>
                  <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Net PPW ($)</label>
                  <input type="number" step="0.01" value={editVals.netPPW}
                    onChange={(e) => { setEditVals((v) => ({ ...v, netPPW: e.target.value })); setEditErrors((prev) => ({ ...prev, netPPW: '' })); }}
                    className={`w-full bg-[var(--surface-card)] border ${editErrors.netPPW ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                  {editErrors.netPPW && <p className="text-red-400 text-xs mt-1">{editErrors.netPPW}</p>}
                </div>
              </div>

              {/* Setter */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Setter (optional)</label>
                <select value={editVals.setterId} onChange={(e) => setEditVals((v) => ({ ...v, setterId: e.target.value }))}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]">
                  <option value="">— None —</option>
                  {reps.filter((r) => (r.repType === 'setter' || r.repType === 'both') && (r.active || r.id === editVals.setterId) && r.id !== project.repId).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Sold Date */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Sold Date</label>
                <input type="date" value={editVals.soldDate}
                  onChange={(e) => { setEditVals((v) => ({ ...v, soldDate: e.target.value })); setEditErrors((prev) => ({ ...prev, soldDate: '' })); }}
                  className={`w-full bg-[var(--surface-card)] border ${editErrors.soldDate ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                {editErrors.soldDate && <p className="text-red-400 text-xs mt-1">{editErrors.soldDate}</p>}
              </div>

              {/* Notes */}
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Notes</label>
                <textarea rows={2} value={editVals.notes} onChange={(e) => setEditVals((v) => ({ ...v, notes: e.target.value }))}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] resize-none" />
              </div>

              {/* Baseline Override */}
              <div className="bg-[var(--surface-card)]/60 rounded-xl p-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={editVals.useBaselineOverride}
                    onChange={(e) => setEditVals((v) => ({ ...v, useBaselineOverride: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[var(--accent-green)]" />
                  <span className="text-[var(--text-secondary)] text-sm font-medium">Override baseline for this project</span>
                </label>
                {editVals.useBaselineOverride && (
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Closer $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideCloserPerW}
                        placeholder={String(installerBaselines[editVals.installer]?.closerPerW ?? 2.90)}
                        onChange={(e) => { setEditVals((v) => ({ ...v, overrideCloserPerW: e.target.value })); setEditErrors((prev) => ({ ...prev, overrideCloserPerW: '' })); }}
                        className={`w-full bg-[var(--border)] border ${editErrors.overrideCloserPerW ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                      {editErrors.overrideCloserPerW && <p className="text-red-400 text-xs mt-1">{editErrors.overrideCloserPerW}</p>}
                    </div>
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Setter $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideSetterPerW}
                        placeholder={editVals.overrideCloserPerW
                          ? String(Math.round((parseFloat(editVals.overrideCloserPerW) + 0.10) * 100) / 100)
                          : String(Math.round(((installerBaselines[editVals.installer]?.closerPerW ?? 2.90) + 0.10) * 100) / 100)}
                        onChange={(e) => setEditVals((v) => ({ ...v, overrideSetterPerW: e.target.value }))}
                        className="w-full bg-[var(--border)] border border-[var(--border)] text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]" />
                    </div>
                    <div>
                      <label className="text-[var(--text-muted)] text-xs block mb-1">Kilo $/W</label>
                      <input type="number" step="0.01" value={editVals.overrideKiloPerW}
                        placeholder={String(installerBaselines[editVals.installer]?.kiloPerW ?? 2.35)}
                        onChange={(e) => { setEditVals((v) => ({ ...v, overrideKiloPerW: e.target.value })); setEditErrors((prev) => ({ ...prev, overrideKiloPerW: '' })); }}
                        className={`w-full bg-[var(--border)] border ${editErrors.overrideKiloPerW ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]`} />
                      {editErrors.overrideKiloPerW && <p className="text-red-400 text-xs mt-1">{editErrors.overrideKiloPerW}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Live Commission Preview ────────────────────────────────── */}
            {(() => {
              const previewKW = parseFloat(editVals.kWSize);
              const previewPPW = parseFloat(editVals.netPPW);
              if (isNaN(previewKW) || isNaN(previewPPW) || previewKW <= 0 || previewPPW <= 0) return null;

              let previewBaseline: InstallerBaseline;
              if (editVals.useBaselineOverride) {
                const overrideCloser = parseFloat(editVals.overrideCloserPerW);
                const overrideKilo = parseFloat(editVals.overrideKiloPerW);
                if (isNaN(overrideCloser) || isNaN(overrideKilo)) {
                  return (
                    <div className="mt-4 rounded-xl p-4 bg-amber-900/20 border border-amber-500/30">
                      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                      <p className="text-amber-400 text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Enter valid Closer $/W and Kilo $/W values to see the commission preview.
                      </p>
                    </div>
                  );
                }
                const overrideSetter = parseFloat(editVals.overrideSetterPerW);
                previewBaseline = {
                  closerPerW: overrideCloser,
                  kiloPerW: overrideKilo,
                  ...(!isNaN(overrideSetter) ? { setterPerW: overrideSetter } : {}),
                };
              } else if (editVals.installer === 'SolarTech' && project.solarTechProductId) {
                previewBaseline = getSolarTechBaseline(project.solarTechProductId, previewKW, solarTechProducts);
              } else if (project.installerProductId && editVals.installer === project.installer) {
                previewBaseline = getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, previewKW, editVals.soldDate || project.soldDate, productCatalogPricingVersions);
              } else {
                previewBaseline = getInstallerRatesForDeal(editVals.installer, editVals.soldDate || project.soldDate, previewKW, installerPricingVersions);
              }

              const previewInstallPayPct = installerPayConfigs[editVals.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const closerTotal = calculateCommission(previewPPW, previewBaseline.closerPerW, previewKW);
              const editM1Flat = previewKW >= 5 ? 1000 : 500;
              const closerM1 = editVals.setterId ? 0 : Math.min(editM1Flat, Math.max(0, closerTotal));
              const closerM2 = Math.round(Math.max(0, closerTotal - closerM1) * (previewInstallPayPct / 100) * 100) / 100;
              const kiloMargin = Math.round((previewBaseline.closerPerW - previewBaseline.kiloPerW) * previewKW * 1000 * 100) / 100;
              const belowBaseline = previewPPW < previewBaseline.closerPerW;
              const previewSetterPerW = 'setterPerW' in previewBaseline && (previewBaseline as any).setterPerW != null
                ? (previewBaseline as any).setterPerW
                : Math.round((previewBaseline.closerPerW + 0.10) * 100) / 100;
              const setterTotal = editVals.setterId ? calculateCommission(previewPPW, previewSetterPerW, previewKW) : 0;
              const setterM1 = editVals.setterId ? Math.min(editM1Flat, Math.max(0, setterTotal)) : 0;
              const setterM2 = editVals.setterId ? Math.round(Math.max(0, setterTotal - setterM1) * (previewInstallPayPct / 100) * 100) / 100 : 0;
              const previewHasM3 = previewInstallPayPct < 100 && !project.subDealerId;
              const closerM3 = previewHasM3 ? Math.round(Math.max(0, closerTotal - closerM1) * ((100 - previewInstallPayPct) / 100) * 100) / 100 : 0;
              const setterM3 = editVals.setterId && previewHasM3 ? Math.round(Math.max(0, setterTotal - setterM1) * ((100 - previewInstallPayPct) / 100) * 100) / 100 : 0;

              return (
                <div className={`mt-4 rounded-xl p-4 ${belowBaseline ? 'bg-amber-900/20 border border-amber-500/30' : 'bg-[var(--surface-card)]/60 border border-[var(--border)]/40'}`}>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium mb-2">Commission Preview</p>
                  {editVals.setterId ? (
                    <div className={`grid ${previewHasM3 ? 'grid-cols-6' : 'grid-cols-4'} gap-3 text-center`}>
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M1</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${setterM1.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M2</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${setterM2.toLocaleString()}</p>
                      </div>
                      {previewHasM3 && (
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Setter M3</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${setterM3.toLocaleString()}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M2</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM2.toLocaleString()}</p>
                      </div>
                      {previewHasM3 && (
                        <div>
                          <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M3</p>
                          <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM3.toLocaleString()}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Kilo Margin</p>
                        <p className={`font-bold text-sm ${kiloMargin < 0 ? 'text-red-400' : 'text-[var(--accent-green)]'}`}>${kiloMargin.toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                  <div className={`grid ${previewHasM3 ? 'grid-cols-4' : 'grid-cols-3'} gap-3 text-center`}>
                    <div>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M1</p>
                      <p className="text-white font-bold text-sm">${closerM1.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M2</p>
                      <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM2.toLocaleString()}</p>
                    </div>
                    {previewHasM3 && (
                      <div>
                        <p className="text-[var(--text-muted)] text-[10px] uppercase">Closer M3</p>
                        <p className={`font-bold text-sm ${belowBaseline ? 'text-amber-400' : 'text-[var(--accent-green)]'}`}>${closerM3.toLocaleString()}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[var(--text-muted)] text-[10px] uppercase">Kilo Margin</p>
                      <p className={`font-bold text-sm ${kiloMargin < 0 ? 'text-red-400' : 'text-[var(--accent-green)]'}`}>${kiloMargin.toLocaleString()}</p>
                    </div>
                  </div>
                  )}
                  {belowBaseline && (
                    <p className="text-amber-400 text-xs mt-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> PPW is below the installer baseline (${previewBaseline.closerPerW}/W)
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-3 mt-6">
              <button onClick={saveEditModal}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                style={{ backgroundColor: 'var(--brand)' }}>
                Save Changes
              </button>
              <button onClick={() => { setShowEditModal(false); setEditErrors({}); }}
                className="flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-white font-medium py-2.5 rounded-xl transition-colors text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirm Modal */}
      <ConfirmDialog
        open={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleCancel}
        title="Cancel Project"
        message={`This will mark ${project.customerName} as Cancelled. This can be reversed by an admin.`}
        confirmLabel="Cancel Project"
        danger={true}
      />

      {/* Delete Confirm Modal — Admin only */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteProject}
        title="Permanently Delete Project"
        message={`This will permanently delete "${project.customerName}" and all associated payroll entries, activity, and messages. This cannot be undone.`}
        confirmLabel="Delete Forever"
        danger={true}
      />

      {/* Phase change confirmation for destructive transitions */}
      <ConfirmDialog
        open={!!phaseConfirm}
        onClose={() => setPhaseConfirm(null)}
        onConfirm={() => {
          if (phaseConfirm) {
            const previousPhase = project.phase;
            updateProject({ phase: phaseConfirm });
            toast(`Phase updated to ${phaseConfirm}`, 'success', {
              label: 'Undo',
              onClick: () => {
                if (previousPhase === 'Cancelled') {
                  setShowCancelReasonModal(true);
                } else {
                  updateProject({ phase: previousPhase });
                }
              },
            });
          }
          setPhaseConfirm(null);
        }}
        title={`Move to ${phaseConfirm ?? ''}?`}
        message={`Are you sure you want to move "${project.customerName}" to ${phaseConfirm ?? ''}? This will remove it from the active pipeline.`}
        confirmLabel="Put On Hold"
        danger={false}
      />

      {/* Cancellation Reason Modal */}
      {showCancelReasonModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCancelReasonModal(false); }}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="text-white font-bold text-base">Cancel Project</h2>
              </div>
              <button onClick={() => setShowCancelReasonModal(false)} className="text-[var(--text-secondary)] hover:text-white transition-colors rounded-lg p-1 hover:bg-[var(--surface-card)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[var(--text-secondary)] text-sm">Please provide a reason for cancelling <span className="text-white font-medium">{project.customerName}</span>.</p>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]"
                >
                  <option value="">Select a reason...</option>
                  <option value="Customer changed mind">Customer changed mind</option>
                  <option value="Credit denied">Credit denied</option>
                  <option value="Roof not suitable">Roof not suitable</option>
                  <option value="Competitor won">Competitor won</option>
                  <option value="Pricing issue">Pricing issue</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Notes <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span></label>
                <textarea
                  rows={3}
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] resize-none placeholder-slate-500"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowCancelReasonModal(false)}
                  className="flex-1 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  Go Back
                </button>
                <button
                  onClick={confirmCancelWithReason}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors active:scale-[0.97]"
                >
                  Cancel Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
