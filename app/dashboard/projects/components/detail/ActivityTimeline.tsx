'use client';

/**
 * ActivityTimeline — fetches /api/projects/[id]/activity and renders a
 * vertical timeline of events (phase changes, flags, payroll paid,
 * note edits, etc.).
 *
 * Loads first 20 rows on mount; "Load More" appends next 20. Never
 * writes — purely a reader of the project_activity projection.
 *
 * Extracted from projects/[id]/page.tsx as part of A+ Phase 1.1.
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Flag, FlagOff, Check, MessageSquare, Pencil, Plus, User, Clock, RefreshCw, Zap } from 'lucide-react';

// ─── Relative time helper ─────────────────────────────────────────────
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

// ─── Activity type styling ────────────────────────────────────────────
const ACTIVITY_STYLES: Record<string, { color: string; icon: typeof Clock }> = {
  phase_change:    { color: 'bg-[var(--accent-emerald-solid)]',    icon: ArrowRight },
  flagged:         { color: 'bg-red-500',     icon: Flag },
  unflagged:       { color: 'bg-red-400',     icon: FlagOff },
  m1_paid:         { color: 'bg-[var(--accent-emerald-solid)]', icon: Check },
  m2_paid:         { color: 'bg-[var(--accent-emerald-solid)]', icon: Check },
  note_edit:       { color: 'bg-amber-500',   icon: MessageSquare },
  field_edit:      { color: 'bg-[var(--text-muted)]',   icon: Pencil },
  created:         { color: 'bg-purple-500',  icon: Plus },
  setter_assigned: { color: 'bg-cyan-500',    icon: User },
};

interface ActivityEntry {
  id: string;
  type: string;
  detail: string;
  meta: string | null;
  createdAt: string;
}

export function ActivityTimeline({ projectId }: { projectId: string }) {
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
          className="mt-3 text-xs text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
