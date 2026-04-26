'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';

// ── Relative time ──

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

// ── Activity type styling ──

const ACTIVITY_STYLES: Record<string, string> = {
  phase_change:    'var(--accent-cyan-solid)',
  flagged:         'var(--accent-red-solid)',
  unflagged:       'var(--accent-red-text)',
  m1_paid:         'var(--accent-emerald-solid)',
  m2_paid:         'var(--accent-emerald-solid)',
  note_edit:       'var(--accent-amber-solid)',
  field_edit:      'var(--text-muted)',
  created:         'var(--accent-purple-solid)',
  setter_assigned: 'var(--accent-teal-solid)',
};

// ── Activity Timeline ──

interface ActivityEntry {
  id: string;
  type: string;
  detail: string;
  meta: string | null;
  createdAt: string;
}

function ActivityTimelineSkeleton() {
  return (
    <div className="relative pl-6">
      <div
        className="absolute left-2 top-0 bottom-0 w-px"
        style={{ background: 'var(--border-subtle)' }}
      />
      {([0, 1, 2] as const).map((i) => (
        <div key={i} className="relative mb-3">
          <div
            className="absolute -left-4 top-1 w-2 h-2 rounded-full"
            style={{
              background: 'linear-gradient(90deg,color-mix(in srgb, var(--text-primary) 4%, transparent) 25%,color-mix(in srgb, var(--text-primary) 11%, transparent) 50%,color-mix(in srgb, var(--text-primary) 4%, transparent) 75%)',
              backgroundSize: '200% 100%',
              animation: `shimmerSweep 1400ms ease-in-out ${i * 80}ms infinite`,
            }}
          />
          <div
            className="h-4 rounded-md mb-1.5"
            style={{
              width: `${[72, 55, 63][i]}%`,
              background: 'linear-gradient(90deg,color-mix(in srgb, var(--text-primary) 4%, transparent) 25%,color-mix(in srgb, var(--text-primary) 11%, transparent) 50%,color-mix(in srgb, var(--text-primary) 4%, transparent) 75%)',
              backgroundSize: '200% 100%',
              animation: `shimmerSweep 1400ms ease-in-out ${i * 80}ms infinite`,
            }}
          />
          <div
            className="h-3 rounded-md"
            style={{
              width: '28%',
              background: 'linear-gradient(90deg,color-mix(in srgb, var(--text-primary) 4%, transparent) 25%,color-mix(in srgb, var(--text-primary) 11%, transparent) 50%,color-mix(in srgb, var(--text-primary) 4%, transparent) 75%)',
              backgroundSize: '200% 100%',
              animation: `shimmerSweep 1400ms ease-in-out ${i * 80}ms infinite`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default function MobileActivityTimeline({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 10;

  const fetchActivities = useCallback((skip: number, append: boolean) => {
    setLoading(true);
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

  useEffect(() => { fetchActivities(0, false); }, [fetchActivities]);

  const hasMore = offset < total;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-[var(--text-muted)]" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Activity</h2>
        <span className="text-base text-[var(--text-muted)]">({total})</span>
      </div>

      {loading && activities.length === 0 ? (
        <ActivityTimelineSkeleton />
      ) : activities.length === 0 ? (
        <p className="text-base text-[var(--text-muted)]">No activity yet</p>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-2 top-0 bottom-0 w-px" style={{ background: 'var(--border-subtle)' }} />
          {activities.map((entry) => {
            const dotColor = ACTIVITY_STYLES[entry.type] ?? 'var(--text-dim)';
            return (
              <div key={entry.id} className="relative mb-3 last:mb-0">
                <div className="absolute -left-4 top-1 w-2 h-2 rounded-full" style={{ background: dotColor }} />
                <p className="text-base text-[var(--text-secondary)]">{entry.detail}</p>
                <p className="text-base text-[var(--text-muted)]">{relativeTime(entry.createdAt)}</p>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => fetchActivities(offset, true)}
          disabled={loading}
          className="min-h-[48px] text-base text-[var(--accent-blue-text)] active:text-[var(--accent-blue-text)] disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
