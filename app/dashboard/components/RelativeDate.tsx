'use client';

import { formatDate } from '../../../lib/utils';

interface RelativeDateProps {
  date: string;
}

function getRelativeLabel(dateStr: string): string {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'in 1d';

  if (diffDays > 1 && diffDays <= 30) return `in ${diffDays}d`;
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)}d ago`;
  if (diffDays < -7 && diffDays >= -30) {
    const weeks = Math.round(Math.abs(diffDays) / 7);
    return `${weeks}w ago`;
  }

  // >30 days in either direction: show "Mon DD" format
  if (Math.abs(diffDays) > 30) {
    return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return formatDate(dateStr);
}

export function RelativeDate({ date }: RelativeDateProps) {
  if (!date) return <span>—</span>;
  const relLabel = getRelativeLabel(date);
  const absLabel = formatDate(date);

  return (
    <span title={absLabel}>
      {relLabel}
    </span>
  );
}
