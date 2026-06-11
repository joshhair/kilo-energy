'use client';

/**
 * ProjectDetailsGrid — the Project Details card (rep/installer/financer/
 * size/PPW/dates grid) + the admin/PM Change Phase select. Extracted
 * verbatim from projects/[id]/page.tsx (T4.1 split, 2026-06-11).
 * The Net PPW row is spliced out for PMs — that is a privacy rule, not
 * styling; canChangePhase (admin OR PM) gates the select.
 */

import { PHASES } from '@/lib/data';
import type { Phase, Project } from '@/lib/data';
import { formatDate } from '@/lib/utils';

export function ProjectDetailsGrid({ project, isPM, canChangePhase, onPhaseChange }: {
  project: Project;
  isPM: boolean;
  canChangePhase: boolean;
  onPhaseChange: (phase: Phase) => void;
}) {
  return (
      <div className="card-surface rounded-2xl p-6 mb-5">
        <h2 className="text-[var(--text-primary)] font-semibold mb-4">Project Details</h2>
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
              <p className="text-[var(--text-primary)]">{value}</p>
            </div>
          ))}
          {project.setterId && (
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Setter</p>
              <p className="text-[var(--text-primary)]">{project.setterName}</p>
            </div>
          )}
          {project.leadSource && (
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Lead Source</p>
              <p className="text-[var(--text-primary)] capitalize">{project.leadSource === 'door_knock' ? 'Door Knock' : project.leadSource}</p>
            </div>
          )}
        </div>

        {canChangePhase && (
          <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-2">Change Phase</p>
            <select
              value={project.phase}
              onChange={(e) => onPhaseChange(e.target.value as Phase)}
              className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
            >
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>{ph}</option>
              ))}
            </select>
          </div>
        )}
      </div>
  );
}
