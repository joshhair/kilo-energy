'use client';

import React, { useState } from 'react';
import {
  Plus, EyeOff, Eye, Trash2, Search, ChevronRight, ChevronDown,
  ListChecks, CheckSquare, Square, Landmark,
} from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { SectionHeader } from '../components/SectionHeader';

export interface FinancersSectionProps {
  hiddenFinancers: Set<string>;
  deleteConfirm: { type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string } | null;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<{ type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string } | null>>;
  financerSelectMode: boolean;
  setFinancerSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedFinancers: Set<string>;
  setSelectedFinancers: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function FinancersSection({ hiddenFinancers, deleteConfirm, setDeleteConfirm, financerSelectMode, setFinancerSelectMode, selectedFinancers, setSelectedFinancers }: FinancersSectionProps) {
  const ctx = useApp();
  const { setFinancerActive, addFinancer, projects } = ctx;
  // Hide the 'Cash' financer from this admin section. It's a system-managed
  // record used for productType=Cash auto-resolve in /api/projects POST and
  // should never be archived or deleted by an admin (doing so breaks Cash
  // deal saves). Removed from the listing entirely so it can't be touched.
  const financers = ctx.financers.filter((f) => f.name !== 'Cash');
  const { toast } = useToast();

  const [newFinancer, setNewFinancer] = useState('');
  const [financerSearch, setFinancerSearch] = useState('');
  const [archivedFinancersOpen, setArchivedFinancersOpen] = useState(
    () => financers.length > 0 && !financers.some((f) => f.active)
  );

  return (
    <div key="financers" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Financers" subtitle="Manage active and archived financing partners" />
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-white font-semibold mb-3">Add Financer</h2>
        {(() => {
          const financerDup = newFinancer.trim().length > 0 && (newFinancer.trim().toLowerCase() === 'cash' || financers.some((f) => f.name.toLowerCase() === newFinancer.trim().toLowerCase()));
          return (<>
        <div className="flex gap-3">
          <div className="flex-1">
            <input
              type="text" placeholder="Financer name"
              value={newFinancer}
              onChange={(e) => setNewFinancer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFinancer.trim() && !financerDup) { addFinancer(newFinancer.trim()); setNewFinancer(''); }
              }}
              className={`w-full bg-[var(--surface-card)] border ${financerDup ? 'border-red-500 focus:ring-red-500' : 'border-[var(--border)] focus:ring-[var(--accent-green)]'} text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 placeholder-[var(--text-dim)]`}
            />
            {financerDup && <p className="text-red-400 text-[10px] mt-1">Already exists</p>}
          </div>
          <button
            disabled={!newFinancer.trim() || financerDup}
            onClick={() => { if (newFinancer.trim() && !financerDup) { addFinancer(newFinancer.trim()); setNewFinancer(''); } }}
            className="btn-primary text-black px-3 py-2 rounded-xl active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        </>); })()}
      </div>

      {financers.filter((f) => !hiddenFinancers.has(f.name)).length === 0 && (
        <div className="card-surface rounded-2xl p-5 border border-[var(--border-subtle)]/60">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-green)]/10 flex-shrink-0">
              <Landmark className="w-4 h-4 text-[var(--accent-green)]" />
            </div>
            <div>
              <p className="text-white font-medium text-sm mb-1">No financers yet</p>
              <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
                Financers are the lending partners that fund solar installations. Add your first financer above to make it available in the deal form.
              </p>
            </div>
          </div>
        </div>
      )}

      {financers.some((f) => f.active && !hiddenFinancers.has(f.name)) && (() => {
        const activeFinancers = financers.filter((f) => f.active && !hiddenFinancers.has(f.name));
        const filteredActiveFinancers = financerSearch
          ? activeFinancers.filter((f) => f.name.toLowerCase().includes(financerSearch.toLowerCase()))
          : activeFinancers;
        return (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-2 px-1">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Active</p>
            <span className="text-[10px] text-[var(--text-dim)] tabular-nums">{filteredActiveFinancers.length} of {activeFinancers.length} financers</span>
            <button
              onClick={() => { setFinancerSelectMode((v) => !v); setSelectedFinancers(new Set()); }}
              className={`ml-auto flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg border transition-colors ${
                financerSelectMode
                  ? 'bg-[var(--accent-green)]/15 border-[var(--accent-green)]/30 text-[var(--accent-green)]'
                  : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-muted)] hover:text-white'
              }`}
            >
              <ListChecks className="w-3 h-3" /> {financerSelectMode ? 'Done' : 'Select'}
            </button>
          </div>
          {financerSelectMode && filteredActiveFinancers.length > 0 && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <button
                onClick={() => {
                  if (filteredActiveFinancers.every((f) => selectedFinancers.has(f.name))) setSelectedFinancers(prev => { const next = new Set(prev); filteredActiveFinancers.forEach(f => next.delete(f.name)); return next; });
                  else setSelectedFinancers(prev => { const next = new Set(prev); filteredActiveFinancers.forEach(f => next.add(f.name)); return next; });
                }}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-white transition-colors"
              >
                {filteredActiveFinancers.every((f) => selectedFinancers.has(f.name))
                  ? <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                  : <Square className="w-3.5 h-3.5" />}
                Select all
              </button>
            </div>
          )}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text" placeholder="Search financers..."
              value={financerSearch}
              onChange={(e) => setFinancerSearch(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {filteredActiveFinancers.map((fin) => (
              <div key={fin.name} className={`card-surface rounded-xl px-4 py-3 flex items-center justify-between group ${financerSelectMode && selectedFinancers.has(fin.name) ? 'ring-1 ring-[var(--accent-green)]/40' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {financerSelectMode && (
                    <button
                      onClick={() => setSelectedFinancers((prev) => {
                        const next = new Set(prev);
                        next.has(fin.name) ? next.delete(fin.name) : next.add(fin.name);
                        return next;
                      })}
                      className="flex-shrink-0"
                    >
                      {selectedFinancers.has(fin.name)
                        ? <CheckSquare className="w-4 h-4 text-[var(--accent-green)]" />
                        : <Square className="w-4 h-4 text-[var(--text-dim)]" />}
                    </button>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white text-sm font-medium">{fin.name}</p>
                      {(() => {
                        const dealCount = projects.filter((p) => p.financer === fin.name).length;
                        return (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            dealCount > 0
                              ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20'
                              : 'bg-[var(--surface-card)] text-[var(--text-dim)] border border-[var(--border)]/50'
                          }`}>
                            {dealCount} deal{dealCount !== 1 ? 's' : ''}
                          </span>
                        );
                      })()}
                    </div>
                    {(() => {
                      const usedInstallers = Array.from(new Set(projects.filter((p) => p.financer === fin.name).map((p) => p.installer))).filter(Boolean);
                      return usedInstallers.length > 0 ? (
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className="text-[9px] text-[var(--text-dim)] mr-0.5">Used with:</span>
                          {usedInstallers.map((inst) => (
                            <span key={inst} className="text-[9px] text-[var(--text-muted)] bg-[var(--surface-card)]/80 border border-[var(--border)]/50 px-1.5 py-0.5 rounded-full">{inst}</span>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
                {!financerSelectMode && (
                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setFinancerActive(fin.name, false)}
                    title="Archive financer"
                    className="text-[var(--text-dim)] hover:text-amber-400 transition-colors"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      const projectCount = projects.filter((p) => p.financer === fin.name).length;
                      setDeleteConfirm({
                        type: 'financer',
                        id: fin.name,
                        name: fin.name,
                        message: projectCount > 0
                          ? `This financer is used by ${projectCount} project${projectCount === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`
                          : 'This financer has no associated projects and will be permanently deleted.',
                      });
                    }}
                    title="Delete financer"
                    className="text-[var(--text-dim)] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                )}
              </div>
            ))}
          </div>
        </div>
        );
      })()}

      {financers.some((f) => !f.active && !hiddenFinancers.has(f.name)) && (() => {
        const archivedFinancers = financers.filter((f) => !f.active && !hiddenFinancers.has(f.name));
        return (
        <div>
          <button
            onClick={() => setArchivedFinancersOpen((v) => !v)}
            className="flex items-center gap-2 mb-2 px-1 w-full text-left group"
          >
            {archivedFinancersOpen
              ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-dim)]" />
              : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
            <p className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wider">Archived</p>
            <span className="text-[10px] font-medium text-[var(--text-dim)] bg-[var(--surface-card)] border border-[var(--border-subtle)]/50 px-1.5 py-0.5 rounded-full">
              {archivedFinancers.length}
            </span>
            {financerSelectMode && archivedFinancers.length > 0 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  const archivedNames = archivedFinancers.map((f) => f.name);
                  const allSelected = archivedNames.every((n) => selectedFinancers.has(n));
                  setSelectedFinancers((prev) => {
                    const next = new Set(prev);
                    archivedNames.forEach((n) => allSelected ? next.delete(n) : next.add(n));
                    return next;
                  });
                }}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-white transition-colors ml-auto"
              >
                {archivedFinancers.every((f) => selectedFinancers.has(f.name))
                  ? <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                  : <Square className="w-3.5 h-3.5" />}
                Select all
              </span>
            )}
          </button>
          {archivedFinancersOpen && (
          <div className="grid grid-cols-2 gap-2">
            {archivedFinancers.map((fin) => (
              <div key={fin.name} className={`bg-[var(--surface)]/50 border border-[var(--border-subtle)]/50 rounded-xl px-4 py-3 flex items-center justify-between group opacity-60 hover:opacity-90 transition-opacity ${financerSelectMode && selectedFinancers.has(fin.name) ? 'ring-1 ring-[var(--accent-green)]/40 opacity-90' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {financerSelectMode && (
                    <button
                      onClick={() => setSelectedFinancers((prev) => {
                        const next = new Set(prev);
                        next.has(fin.name) ? next.delete(fin.name) : next.add(fin.name);
                        return next;
                      })}
                      className="flex-shrink-0"
                    >
                      {selectedFinancers.has(fin.name)
                        ? <CheckSquare className="w-4 h-4 text-[var(--accent-green)]" />
                        : <Square className="w-4 h-4 text-[var(--text-dim)]" />}
                    </button>
                  )}
                  <p className="text-[var(--text-dim)] text-sm line-through">{fin.name}</p>
                </div>
                {!financerSelectMode && (
                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setFinancerActive(fin.name, true)}
                    title="Restore financer"
                    className="text-[var(--text-dim)] hover:text-[var(--accent-green)] transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      const projectCount = projects.filter((p) => p.financer === fin.name).length;
                      setDeleteConfirm({
                        type: 'financer',
                        id: fin.name,
                        name: fin.name,
                        message: projectCount > 0
                          ? `This financer is used by ${projectCount} project${projectCount === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`
                          : 'This financer has no associated projects and will be permanently deleted.',
                      });
                    }}
                    title="Delete financer"
                    className="text-[var(--text-dim)] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}
