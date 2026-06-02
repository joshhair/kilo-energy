'use client';

import { formatDate } from '../../../../lib/utils';
import { UserPlus, UserCheck, Loader2 } from 'lucide-react';
import MobileCard from './MobileCard';
import MobileBadge from './MobileBadge';
import type { BlitzData } from '../MobileBlitz';

type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';

const STATUS_BADGE_MAP: Record<BlitzStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function blitzDateLabel(status: BlitzStatus, startDate: string, endDate: string): string {
  if (status === 'completed' || status === 'cancelled') {
    return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (status === 'upcoming') {
    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const days = Math.round((start.getTime() - today.getTime()) / 86400000);
    if (days <= 0) return 'Starts today';
    if (days === 1) return 'Starts tomorrow';
    if (days <= 7) return `Starts in ${days} days`;
    return formatDate(startDate);
  }
  // active
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 'Ended today';
  if (days === 1) return 'Last day';
  if (days <= 3) return `${days} days left`;
  return formatDate(endDate);
}

interface BlitzCardProps {
  blitz: BlitzData;
  index: number;
  effectiveRepId: string | null;
  isAdmin: boolean;
  joiningBlitzId: string | null;
  onJoin: (id: string) => void;
  onNavigate: (id: string) => void;
}

export default function BlitzCard({ blitz, index, effectiveRepId, isAdmin, joiningBlitzId, onJoin, onNavigate }: BlitzCardProps) {
  const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
  const pendingJoinCount = blitz.participants.filter((p) => ['pending', 'invited', 'waitlist'].includes(p.joinStatus)).length;
  const dateLabel = blitzDateLabel(blitz.status, blitz.startDate, blitz.endDate);
  const endDay = new Date(blitz.endDate); endDay.setHours(0, 0, 0, 0);
  const nowDay = new Date(); nowDay.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((endDay.getTime() - nowDay.getTime()) / 86400000);
  const isUrgent = blitz.status === 'active' && daysLeft <= 3;
  const locationPart = blitz.location;
  const repsPart = `${approvedCount} rep${approvedCount !== 1 ? 's' : ''}`;
  const totalCosts = blitz.costs.reduce((s, c) => s + c.amount, 0);
  const approvedIds = new Set(blitz.participants.filter((p) => p.joinStatus === 'approved').map((p) => p.user.id));
  const activeProjects = blitz.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
  const isBlitzOwner = blitz.owner?.id === effectiveRepId;
  const blitzProjects = (isAdmin || isBlitzOwner)
    ? activeProjects.filter((p) =>
        approvedIds.has(p.closer?.id ?? '')
        || approvedIds.has(p.setter?.id ?? '')
        || p.additionalClosers?.some((ac) => approvedIds.has(ac.userId))
        || p.additionalSetters?.some((as) => approvedIds.has(as.userId))
      )
    : activeProjects.filter((p) =>
        p.closer?.id === effectiveRepId
        || p.setter?.id === effectiveRepId
        || p.additionalClosers?.some((ac) => ac.userId === effectiveRepId)
        || p.additionalSetters?.some((as) => as.userId === effectiveRepId)
      );
  const totalDeals = blitzProjects.length;
  const totalKW = blitzProjects.reduce((s, p) => {
    const closerApproved = p.closer?.id && approvedIds.has(p.closer.id);
    const anyAdditionalCloserApproved = p.additionalClosers?.some((ac) => approvedIds.has(ac.userId));
    return s + (closerApproved || anyAdditionalCloserApproved ? p.kWSize : 0);
  }, 0);
  const myParticipation = blitz.participants.find((p) => p.user.id === effectiveRepId);
  const canJoin = !isAdmin && !isBlitzOwner
    && (!myParticipation || myParticipation.joinStatus === 'declined')
    && (blitz.status === 'upcoming' || blitz.status === 'active');
  const participationLabel = myParticipation
    ? myParticipation.joinStatus === 'approved' ? 'Joined'
      : myParticipation.joinStatus === 'declined' ? 'Declined'
      : myParticipation.joinStatus === 'invited' ? 'Invited'
      : myParticipation.joinStatus === 'waitlist' ? 'Waitlisted'
      : 'Pending'
    : null;
  const joining = joiningBlitzId === blitz.id;

  return (
    <div
      style={{
        animation: 'blitzCardIn 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        animationDelay: `${index * 40}ms`,
        ...(isUrgent && {
          borderRadius: '16px',
          boxShadow: '0 0 0 1.5px color-mix(in srgb, var(--accent-amber-solid) 45%, transparent), 0 0 14px color-mix(in srgb, var(--accent-amber-solid) 10%, transparent)',
        }),
      }}
    >
      <MobileCard onTap={() => onNavigate(blitz.id)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p
              className="line-clamp-2 break-words leading-tight"
              style={{
                fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
                fontSize: '1.25rem',
                color: 'var(--text-primary)',
              }}
            >{blitz.name}</p>
            <p className="text-sm mt-1.5 flex flex-wrap items-baseline gap-x-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
              {locationPart && <><span>{locationPart}</span><span aria-hidden> · </span></>}
              {isUrgent
                ? <span className="blitz-urgent-label" style={{ color: 'var(--accent-amber-text)', fontWeight: 600, animation: 'blitzUrgentPulse 2000ms ease-in-out infinite' }}>{dateLabel}</span>
                : <span>{dateLabel}</span>}
              <span aria-hidden> · </span>
              <span>{repsPart}</span>
            </p>
            {isAdmin && totalCosts > 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                Cost/Deal: ${totalDeals > 0 ? (totalCosts / totalDeals).toFixed(0) : '--'}
                {' · '}
                Cost/kW: ${totalKW > 0 ? (totalCosts / totalKW).toFixed(2) : '--'}
              </p>
            )}
          </div>
          <MobileBadge value={STATUS_BADGE_MAP[blitz.status]} variant="status" />
        </div>
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-center">
            <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Reps</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{approvedCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Deals</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{totalDeals}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>kW</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{totalKW.toFixed(1)}</p>
          </div>
        </div>
        {(canJoin || participationLabel || isBlitzOwner) && (
          <div className="mt-3 flex items-center gap-2">
            {isBlitzOwner && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-emerald-text)', background: 'var(--accent-emerald-soft)' }}>Leader</span>
            )}
            {(isAdmin || isBlitzOwner) && pendingJoinCount > 0 && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-amber-text)', background: 'var(--accent-amber-soft)' }}>
                {pendingJoinCount} Pending
              </span>
            )}
            {canJoin && (
              /* role=button (not a real <button>) — MobileCard wraps each row in
                 a <button>, and HTML disallows nested buttons (hydration error). */
              <span
                role="button"
                tabIndex={0}
                aria-disabled={joining}
                onClick={(e) => { e.stopPropagation(); if (!joining) onJoin(blitz.id); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!joining) onJoin(blitz.id);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-xs font-semibold rounded-full transition-all active:scale-[0.93] touch-manipulation cursor-pointer"
                style={{
                  color: 'var(--accent-emerald-text)',
                  border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  opacity: joining ? 0.4 : 1,
                }}
              >
                {joining ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                {joining ? 'Joining…' : 'Join'}
              </span>
            )}
            {participationLabel && !canJoin && !isBlitzOwner && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded" style={{
                color: participationLabel === 'Joined' ? 'var(--accent-emerald-solid)' : participationLabel === 'Declined' ? 'var(--accent-red-solid)' : 'var(--accent-amber-text)',
                background: participationLabel === 'Joined' ? 'var(--accent-emerald-soft)' : participationLabel === 'Declined' ? 'var(--accent-red-soft)' : 'var(--accent-amber-soft)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}>
                <UserCheck className="w-3 h-3" /> {participationLabel}
              </span>
            )}
          </div>
        )}
      </MobileCard>
    </div>
  );
}
