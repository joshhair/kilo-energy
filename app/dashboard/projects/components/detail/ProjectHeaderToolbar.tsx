'use client';

/**
 * ProjectHeaderToolbar — customer title block (flag badge, phase badge,
 * sold date) + the role-branched action toolbar (Edit / Flag / Duplicate /
 * More). Extracted verbatim from projects/[id]/page.tsx (T4.1 split,
 * 2026-06-11). The 'More project actions' menu structure is locked by the
 * T1.6 visual test — destructive actions stay behind the More menu with
 * their existing gates (Cancel → reason modal, Delete → ConfirmDialog),
 * both owned by the parent via callbacks.
 */

import Link from 'next/link';
import { Flag, FlagOff, AlertTriangle, Pencil, Copy, Trash2, MoreVertical } from 'lucide-react';
import RowActionsMenu from '../../../components/RowActionsMenu';
import { PhaseBadge } from './PipelineStepper';
import { formatDate } from '@/lib/utils';
import type { Project } from '@/lib/data';

export function ProjectHeaderToolbar({ project, isAdminOrPM, isPM, effectiveRepId, onEdit, onFlag, onCancel, onDelete }: {
  project: Project;
  isAdminOrPM: boolean;
  isPM: boolean;
  effectiveRepId: string | null;
  onEdit: () => void;
  onFlag: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl md:text-4xl font-black text-[var(--text-primary)] tracking-tight">{project.customerName}</h1>
            {project.flagged && (
              <span className="flex items-center gap-1 bg-[var(--accent-red-soft)] border border-red-500/30 text-[var(--accent-red-text)] text-xs px-2 py-0.5 rounded-full">
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

        {isAdminOrPM ? (
          <div className="md:sticky md:top-4 md:z-30 md:self-start flex flex-col md:flex-row md:flex-nowrap items-stretch md:items-center gap-2 md:whitespace-nowrap md:bg-[var(--surface-page)]/85 md:backdrop-blur md:rounded-xl md:p-2 md:-m-2 md:shadow-sm md:shadow-black/20">
            {!isPM && (
              <button
                onClick={onEdit}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--accent-emerald-solid)]/30 text-[var(--accent-emerald-text)] hover:bg-[var(--accent-blue-soft)] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button
              onClick={onFlag}
              className={`flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border transition-colors ${
                project.flagged
                  ? 'border-red-500/40 text-[var(--accent-red-text)] hover:bg-[var(--accent-red-soft)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)]'
              }`}
            >
              {project.flagged ? <FlagOff className="w-3.5 h-3.5" /> : <Flag className="w-3.5 h-3.5" />}
              {project.flagged ? 'Unflag' : 'Flag'}
            </button>
            {!isPM && (
              <Link
                href={`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </Link>
            )}
            {/* T1.6 — destructive actions live behind the "More" menu, visually
                separated from the benign Edit/Flag/Duplicate browse strip. The
                existing gates are unchanged (Cancel → reason modal, Delete →
                ConfirmDialog). */}
            {(project.phase !== 'Cancelled' || !isPM) && (
              <RowActionsMenu
                ariaLabel="More project actions"
                trigger={{
                  className: 'flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)] transition-colors',
                  children: <><MoreVertical className="w-3.5 h-3.5" /> More</>,
                }}
                actions={[
                  ...(project.phase !== 'Cancelled' ? [{
                    label: 'Cancel Project',
                    danger: true,
                    onSelect: onCancel,
                  }] : []),
                  ...(!isPM ? [{
                    label: 'Delete Project',
                    icon: Trash2,
                    danger: true,
                    onSelect: onDelete,
                  }] : []),
                ]}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
            {(effectiveRepId === project.repId) && (
              <Link
                href={`/dashboard/new-deal?duplicate=true&installer=${encodeURIComponent(project.installer)}&financer=${encodeURIComponent(project.financer)}&productType=${encodeURIComponent(project.productType)}&repId=${project.repId}${project.setterId ? `&setterId=${project.setterId}` : ''}&customerName=${encodeURIComponent(project.customerName)}`}
                className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </Link>
            )}
            {(effectiveRepId === project.repId) && project.phase !== 'Cancelled' && (
              <RowActionsMenu
                ariaLabel="More project actions"
                trigger={{
                  className: 'flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 min-h-[44px] w-full md:w-auto rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)] transition-colors',
                  children: <><MoreVertical className="w-3.5 h-3.5" /> More</>,
                }}
                actions={[{
                  label: 'Cancel Project',
                  danger: true,
                  onSelect: onCancel,
                }]}
              />
            )}
          </div>
        )}
      </div>
  );
}
