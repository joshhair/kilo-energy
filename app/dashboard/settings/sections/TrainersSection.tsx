'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Layers, Plus, Pencil, Check, X, Trash2, Search, Users,
} from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { getTrainerOverrideRate, TrainerOverrideTier } from '../../../../lib/data';
import { PaginationBar } from '../../components/PaginationBar';
import { SearchableSelect } from '../../components/SearchableSelect';
import { SectionHeader } from '../components/SectionHeader';

export interface TrainersSectionProps {
  editingAssignmentId: string | null;
  setEditingAssignmentId: React.Dispatch<React.SetStateAction<string | null>>;
  editingTiers: TrainerOverrideTier[];
  setEditingTiers: React.Dispatch<React.SetStateAction<TrainerOverrideTier[]>>;
  deleteConfirm: { type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string } | null;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<{ type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string } | null>>;
}

export function TrainersSection({
  editingAssignmentId, setEditingAssignmentId,
  editingTiers, setEditingTiers,
  deleteConfirm, setDeleteConfirm,
}: TrainersSectionProps) {
  const { reps, projects, trainerAssignments, setTrainerAssignments } = useApp();
  const { toast } = useToast();

  const [newTraineeId, setNewTraineeId] = useState('');
  const [newTrainerId, setNewTrainerId] = useState('');
  const [trainerSearch, setTrainerSearch] = useState('');
  type TrainerSortKey = 'trainee' | 'trainer' | 'deals' | 'rate';
  const [trainerSortKey, setTrainerSortKey] = useState<TrainerSortKey>('trainee');
  const [trainerSortDir, setTrainerSortDir] = useState<'asc' | 'desc'>('asc');
  const [trainerPage, setTrainerPage] = useState(1);
  const [trainerRowsPerPage, setTrainerRowsPerPage] = useState(25);
  const trainerSearchRef = useRef<HTMLInputElement>(null);

  const toggleTrainerSort = (key: TrainerSortKey) => {
    if (trainerSortKey === key) {
      setTrainerSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTrainerSortKey(key);
      setTrainerSortDir('asc');
    }
    setTrainerPage(1);
  };

  // "/" shortcut to focus trainer search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) && trainerSearchRef.current) {
        e.preventDefault();
        trainerSearchRef.current.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build enriched rows once for stats + filtering + sorting + pagination
  const enrichedRows = trainerAssignments.map((a) => {
    const trainee = reps.find((r) => r.id === a.traineeId);
    const trainer = reps.find((r) => r.id === a.trainerId);
    const completedDeals = projects.filter((p) => (p.repId === a.traineeId || p.setterId === a.traineeId) && ['Installed', 'PTO', 'Completed'].includes(p.phase)).length;
    const currentRate = getTrainerOverrideRate(a, completedDeals);
    const activeTierIndex = a.tiers.findIndex((t) => t.upToDeal === null || completedDeals < t.upToDeal);
    const tierLabel = activeTierIndex >= 0 ? `Tier ${activeTierIndex + 1} of ${a.tiers.length}` : `Tier ${a.tiers.length}`;
    return { a, trainee, trainer, completedDeals, currentRate, activeTierIndex, tierLabel };
  });

  // Stats
  const uniqueTrainers = new Set(trainerAssignments.map((a) => a.trainerId)).size;
  const avgRate = enrichedRows.length > 0
    ? enrichedRows.reduce((sum, r) => sum + r.currentRate, 0) / enrichedRows.length
    : 0;

  // Filter
  const filtered = enrichedRows.filter(({ trainee, trainer }) => {
    if (!trainerSearch) return true;
    const q = trainerSearch.toLowerCase();
    return (trainee?.name ?? '').toLowerCase().includes(q) || (trainer?.name ?? '').toLowerCase().includes(q);
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const dir = trainerSortDir === 'asc' ? 1 : -1;
    if (trainerSortKey === 'trainee') return dir * (a.trainee?.name ?? '').localeCompare(b.trainee?.name ?? '');
    if (trainerSortKey === 'trainer') return dir * (a.trainer?.name ?? '').localeCompare(b.trainer?.name ?? '');
    if (trainerSortKey === 'rate') return dir * (a.currentRate - b.currentRate);
    return dir * (a.completedDeals - b.completedDeals);
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / trainerRowsPerPage));
  const safePage = Math.min(trainerPage, totalPages);
  const startIdx = (safePage - 1) * trainerRowsPerPage;
  const endIdx = Math.min(startIdx + trainerRowsPerPage, sorted.length);
  const pageRows = sorted.slice(startIdx, endIdx);

  // Initials helper
  const getInitials = (name: string) => name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div key="trainers" className="animate-tab-enter max-w-4xl space-y-4">
      <SectionHeader title="Trainer Overrides" subtitle="Assign trainers and configure tiered override rates" />

      {/* Create new assignment */}
      <div className="card-surface rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4">Assign Trainer to Rep</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">Trainee (Rep)</label>
            <SearchableSelect
              value={newTraineeId}
              onChange={(v) => setNewTraineeId(v)}
              placeholder="Select rep..."
              options={reps.filter((r) => r.active && !trainerAssignments.some((a) => a.traineeId === r.id)).map((r) => ({ value: r.id, label: r.name, sub: r.repType }))}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">Trainer</label>
            <SearchableSelect
              value={newTrainerId}
              onChange={(v) => setNewTrainerId(v)}
              placeholder="Select trainer..."
              options={reps.filter((r) => r.active && r.id !== newTraineeId).map((r) => ({ value: r.id, label: r.name, sub: r.repType }))}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={async () => {
                if (!newTraineeId || !newTrainerId) return;
                const tiers = [
                  { upToDeal: 10,   ratePerW: 0.20 },
                  { upToDeal: 25,   ratePerW: 0.10 },
                  { upToDeal: null, ratePerW: 0.05 },
                ];
                const tempId = `ta_${Date.now()}`;
                setTrainerAssignments((prev) => [...prev, { id: tempId, trainerId: newTrainerId, traineeId: newTraineeId, tiers }]);
                setNewTraineeId('');
                setNewTrainerId('');
                // Persist to DB
                try {
                  const res = await fetch('/api/trainer-assignments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trainerId: newTrainerId, traineeId: newTraineeId, tiers }),
                  });
                  if (res.ok) {
                    const saved = await res.json();
                    setTrainerAssignments((prev) => prev.map((a) => a.id === tempId ? { ...a, id: saved.id } : a));
                  } else {
                    setTrainerAssignments((prev) => prev.filter((a) => a.id !== tempId));
                    toast('Failed to create trainer assignment', 'error');
                  }
                } catch (e) {
                  console.error('Failed to persist trainer assignment:', e);
                  setTrainerAssignments((prev) => prev.filter((a) => a.id !== tempId));
                  toast('Failed to create trainer assignment', 'error');
                }
              }}
              className="btn-primary text-black px-3 py-2 rounded-xl active:scale-[0.97]"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2">Default tiers: $0.20/W (deals 1-10) &rarr; $0.10/W (11-25) &rarr; $0.05/W (26+)</p>
      </div>

      {trainerAssignments.length === 0 ? (
        <div className="card-surface rounded-2xl p-5 border border-[var(--border-subtle)]/60">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 flex-shrink-0">
              <Layers className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-white font-medium text-sm mb-1">What are trainer overrides?</p>
              <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
                When a rep is assigned a trainer, the trainer earns an override commission on every deal the trainee closes. Override rates are tiered and decrease as the trainee gains experience. Use the form above to create your first assignment.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="card-surface rounded-2xl p-4 flex items-center gap-6 mb-1 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Active Assignments</p>
                <p className="text-white font-bold text-lg leading-tight">{trainerAssignments.length}</p>
              </div>
            </div>
            <div className="w-px h-8 bg-[var(--surface-card)]" />
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[var(--accent-green)]/10">
                <Users className="w-3.5 h-3.5 text-[var(--accent-green)]" />
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Unique Trainers</p>
                <p className="text-white font-bold text-lg leading-tight">{uniqueTrainers}</p>
              </div>
            </div>
            <div className="w-px h-8 bg-[var(--surface-card)]" />
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Avg Override Rate</p>
              <p className="text-amber-400 font-bold text-lg leading-tight">${avgRate.toFixed(2)}/W</p>
            </div>
          </div>

          {/* Search + sort */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                ref={trainerSearchRef}
                type="text" placeholder='Search trainee or trainer...  press "/" to focus'
                value={trainerSearch}
                onChange={(e) => { setTrainerSearch(e.target.value); setTrainerPage(1); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setTrainerSearch(''); (e.target as HTMLInputElement).blur(); } }}
                className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-[var(--text-dim)]"
              />
              {trainerSearch && (
                <button onClick={() => { setTrainerSearch(''); setTrainerPage(1); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {trainerSearch && (
              <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full">{sorted.length} result{sorted.length !== 1 ? 's' : ''}</span>
            )}
            <select
              value={`${trainerSortKey}-${trainerSortDir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split('-') as [TrainerSortKey, 'asc' | 'desc'];
                setTrainerSortKey(key);
                setTrainerSortDir(dir);
              }}
              className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)]"
            >
              <option value="trainee-asc">Trainee A-Z</option>
              <option value="trainee-desc">Trainee Z-A</option>
              <option value="trainer-asc">Trainer A-Z</option>
              <option value="trainer-desc">Trainer Z-A</option>
              <option value="deals-desc">Most Deals</option>
              <option value="deals-asc">Fewest Deals</option>
              <option value="rate-desc">Highest Rate</option>
              <option value="rate-asc">Lowest Rate</option>
            </select>
          </div>

          {/* Compact table */}
          <div className="card-surface rounded-2xl overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_1fr_70px_90px_100px_72px] gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
              <span>Trainee</span>
              <span>Trainer</span>
              <span className="text-center">Deals</span>
              <span className="text-center">Rate</span>
              <span className="text-center">Tier</span>
              <span></span>
            </div>
            {pageRows.length === 0 && (
              <div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">
                No assignments match your search.
              </div>
            )}
            {pageRows.map(({ a, trainee, trainer, completedDeals, currentRate, tierLabel }) => {
              const isEditing = editingAssignmentId === a.id;
              return (
                <div key={a.id}>
                  {/* Compact row */}
                  <div className={`grid grid-cols-[1fr_1fr_70px_90px_100px_72px] gap-2 px-4 py-2.5 items-center text-sm border-b border-[var(--border-subtle)]/50 transition-colors ${isEditing ? 'bg-[var(--surface-card)]/40' : 'hover:bg-[var(--surface-card)]/30'}`}>
                    {/* Trainee */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-[var(--accent-green)]/20 text-[var(--accent-green)] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {getInitials(trainee?.name ?? '??')}
                      </div>
                      <Link href={`/dashboard/users/${a.traineeId}`} className="text-white truncate hover:text-[var(--accent-cyan)] transition-colors">{trainee?.name ?? 'Unknown'}</Link>
                    </div>
                    {/* Trainer */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {getInitials(trainer?.name ?? '??')}
                      </div>
                      <Link href={`/dashboard/users/${a.trainerId}`} className="text-[var(--text-secondary)] truncate hover:text-[var(--accent-cyan)] transition-colors">{trainer?.name ?? 'Unknown'}</Link>
                    </div>
                    {/* Deals */}
                    <span className="text-center text-[var(--text-secondary)]">{completedDeals}</span>
                    {/* Rate */}
                    <span className="text-center text-amber-400 font-medium">${currentRate.toFixed(2)}/W</span>
                    {/* Tier */}
                    <span className="text-center text-[var(--text-secondary)] text-xs">{tierLabel}</span>
                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1.5">
                      {!isEditing ? (
                        <>
                          <button
                            onClick={() => { setEditingAssignmentId(a.id); setEditingTiers([...a.tiers]); }}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--border)]/60 transition-colors"
                            title="Edit tiers"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              const traineeName = reps.find((r) => r.id === a.traineeId)?.name ?? 'this assignment';
                              setDeleteConfirm({
                                type: 'trainer',
                                id: a.id,
                                name: traineeName,
                                message: 'This will remove the trainer-trainee relationship. Both accounts remain active.',
                              });
                            }}
                            className="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete assignment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setTrainerAssignments((prev) =>
                                prev.map((x) => (x.id === a.id ? { ...x, tiers: editingTiers } : x))
                              );
                              setEditingAssignmentId(null);
                              // Persist tier edits to DB
                              fetch('/api/trainer-assignments', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: a.id, tiers: editingTiers }),
                              }).catch(console.error);
                            }}
                            className="p-1.5 rounded-lg text-[var(--accent-green)] hover:text-[var(--accent-cyan)] hover:bg-[var(--accent-green)]/10 transition-colors"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingAssignmentId(null)}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--border)]/60 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline tier editor (expands below row when editing) */}
                  {isEditing && (
                    <div className="px-4 py-3 bg-[var(--surface-card)]/30 border-b border-[var(--border-subtle)]/50 space-y-1.5">
                      {editingTiers.map((tier, i) => (
                        <div key={i} className="flex items-center gap-3 rounded px-3 py-2 text-sm bg-[var(--surface-card)]/50">
                          <span className="text-[var(--text-muted)] text-xs w-12">Tier {i + 1}</span>
                          <span className="text-[var(--text-muted)] text-xs">Up to deal</span>
                          <input
                            type="number" min="1" placeholder="Infinity"
                            value={tier.upToDeal ?? ''}
                            onChange={(e) =>
                              setEditingTiers((prev) =>
                                prev.map((t, idx) =>
                                  idx === i ? { ...t, upToDeal: e.target.value === '' ? null : parseInt(e.target.value) || null } : t
                                )
                              )
                            }
                            disabled={i === editingTiers.length - 1}
                            className="w-16 bg-[var(--border)] border border-[var(--border)] text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-40"
                          />
                          <span className="text-[var(--text-muted)] text-xs">$</span>
                          <input
                            type="number" step="0.01" min="0"
                            value={tier.ratePerW}
                            onChange={(e) =>
                              setEditingTiers((prev) =>
                                prev.map((t, idx) =>
                                  idx === i ? { ...t, ratePerW: parseFloat(e.target.value) || 0 } : t
                                )
                              )
                            }
                            className="w-16 bg-[var(--border)] border border-[var(--border)] text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <span className="text-[var(--text-muted)] text-xs">/W</span>
                          <button
                            onClick={() => {
                              if (editingTiers.length <= 1) return;
                              setEditingTiers((prev) => {
                                const next = prev.filter((_, idx) => idx !== i);
                                if (next[next.length - 1].upToDeal !== null) {
                                  next[next.length - 1] = { ...next[next.length - 1], upToDeal: null };
                                }
                                return next;
                              });
                            }}
                            disabled={editingTiers.length <= 1}
                            className="text-[var(--text-dim)] hover:text-red-400 transition-colors disabled:opacity-30"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          setEditingTiers((prev) => {
                            const updated = prev.map((t, i) =>
                              i === prev.length - 1 && t.upToDeal === null
                                ? { ...t, upToDeal: completedDeals + 10 }
                                : t
                            );
                            return [...updated, { upToDeal: null, ratePerW: 0.05 }];
                          });
                        }}
                        className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-white text-xs mt-1 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Add tier
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination */}
            {sorted.length > trainerRowsPerPage && (
              <PaginationBar
                totalResults={sorted.length}
                startIdx={startIdx}
                endIdx={endIdx}
                currentPage={safePage}
                totalPages={totalPages}
                rowsPerPage={trainerRowsPerPage}
                onPageChange={setTrainerPage}
                onRowsPerPageChange={setTrainerRowsPerPage}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
