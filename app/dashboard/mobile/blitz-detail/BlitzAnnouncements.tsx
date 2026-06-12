'use client';

/**
 * BlitzAnnouncements — the durable history of blitz broadcasts (Josh's
 * 2026-06-12 feedback: "I've sent two broadcasts but you can't see them
 * anywhere"). Design per the Codex consultation: an Overview-top preview
 * card (the default landing tab — reps see news without digging; a 6th
 * tab would bury it, an above-tabs section would tax every tab), latest
 * two messages as one-sided announcement rows (NOT chat bubbles — this is
 * one-to-many, reps can't reply), "View all" opening a MobileBottomSheet
 * with the paginated history.
 *
 * "New" pill is LOCAL-ONLY (localStorage latest-seen timestamp per
 * user+blitz) — deliberately not read-tracking, not acknowledgement.
 * Visibility is enforced server-side (roster-only field gate); this
 * component just renders what the API returned.
 */

import { useEffect, useState } from 'react';
import { Megaphone, Loader2 } from 'lucide-react';
import MobileBottomSheet from '../shared/MobileBottomSheet';
import { relativeTime } from '../../projects/components/shared';

export interface BlitzAnnouncementRow {
  id: string;
  senderName: string;
  senderRole: string;
  message: string;
  recipientTotal: number;
  recipientsOk: number;
  createdAt: string;
}

const seenKey = (blitzId: string) => `kilo-blitz-ann-seen:${blitzId}`;

function AnnouncementRow({ a, canManage }: { a: BlitzAnnouncementRow; canManage: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="w-full text-left rounded-xl p-3"
      style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{a.senderName}</span>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>{a.senderRole === 'admin' ? 'Admin' : 'Leader'}</span>
        <span className="text-[10px] ml-auto shrink-0" style={{ color: 'var(--text-dim)' }}>{relativeTime(a.createdAt)}</span>
      </div>
      <p
        className={`text-sm whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-4'}`}
        style={{ color: 'var(--text-secondary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        {a.message}
      </p>
      {/* Delivery counts are a manager concern; reps just see the post. */}
      {canManage && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
          Emailed to {a.recipientsOk}/{a.recipientTotal} participants
        </p>
      )}
    </button>
  );
}

export default function BlitzAnnouncements({ blitzId, announcements, total, canManage, canBroadcast, onBroadcast }: {
  blitzId: string;
  announcements: BlitzAnnouncementRow[];
  total: number;
  canManage: boolean;
  /** canManage AND the blitz is upcoming/active (matches the composer gate). */
  canBroadcast: boolean;
  onBroadcast: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [allRows, setAllRows] = useState<BlitzAnnouncementRow[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allError, setAllError] = useState('');
  const [hasNew, setHasNew] = useState(false);

  const latest = announcements[0]?.createdAt ?? null;

  // Local-only "New" affordance: compare the newest announcement against
  // the last timestamp this device saw, then mark seen.
  useEffect(() => {
    if (!latest) return;
    try {
      const seen = localStorage.getItem(seenKey(blitzId));
      if (!seen || new Date(latest) > new Date(seen)) setHasNew(true);
      localStorage.setItem(seenKey(blitzId), latest);
    } catch { /* storage unavailable — skip the affordance */ }
  }, [blitzId, latest]);

  const openAll = async () => {
    setShowAll(true);
    if (allRows || loadingAll) return;
    setLoadingAll(true);
    setAllError('');
    try {
      const res = await fetch(`/api/blitzes/${blitzId}/announcements?limit=50`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.announcements)) {
        setAllRows(data.announcements);
      } else {
        // Surface the failure instead of a misleading "Nothing here yet"
        // (a 403/500 is not an empty history — Codex).
        setAllError(data?.error || `Couldn't load announcements (${res.status})`);
      }
    } catch {
      setAllError("Couldn't load announcements — check your connection.");
    } finally {
      setLoadingAll(false);
    }
  };

  if (total === 0 && !canBroadcast) return null;

  return (
    <div className="card-surface rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Megaphone className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald-text)' }} aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Announcements</p>
        {hasNew && (
          <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-emerald-text)', background: 'var(--accent-emerald-soft)' }}>New</span>
        )}
        {total > 2 && (
          <button
            type="button"
            onClick={openAll}
            className="text-xs ml-auto min-h-[44px] -my-2.5 underline underline-offset-2"
            style={{ color: 'var(--accent-emerald-text)' }}
          >
            View all ({total})
          </button>
        )}
      </div>
      {total === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
          No announcements yet —{' '}
          <button type="button" onClick={onBroadcast} className="underline underline-offset-2" style={{ color: 'var(--accent-emerald-text)' }}>
            broadcast one
          </button>{' '}
          to the team.
        </p>
      ) : (
        <div className="space-y-2">
          {announcements.slice(0, 2).map((a) => (
            <AnnouncementRow key={a.id} a={a} canManage={canManage} />
          ))}
        </div>
      )}

      <MobileBottomSheet open={showAll} onClose={() => setShowAll(false)} title="Announcements">
        <div className="px-5 pb-[env(safe-area-inset-bottom)] space-y-2 max-h-[70vh] overflow-y-auto">
          {loadingAll && (
            <p className="flex items-center gap-2 text-sm py-3" style={{ color: 'var(--text-dim)' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          )}
          {allError && (
            <p className="text-sm py-3" style={{ color: 'var(--accent-red-text)' }}>{allError}</p>
          )}
          {(allRows ?? []).map((a) => (
            <AnnouncementRow key={a.id} a={a} canManage={canManage} />
          ))}
          {allRows && allRows.length === 0 && !loadingAll && !allError && (
            <p className="text-sm py-3" style={{ color: 'var(--text-dim)' }}>Nothing here yet.</p>
          )}
          <div className="h-4" />
        </div>
      </MobileBottomSheet>
    </div>
  );
}
