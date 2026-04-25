'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckSquare, Square } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';

interface Installer { id: string; name: string; active: boolean }

export function PMSection() {
  const { toast } = useToast();
  const [pms, setPms] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean; scopedInstallerId: string | null }>>([]);
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  // Optional scope at create time. Blank = full internal PM access;
  // picking an installer provisions them as a vendor PM immediately.
  const [newScopedInstallerId, setNewScopedInstallerId] = useState('');
  const [confirmDeletePmId, setConfirmDeletePmId] = useState<string | null>(null);

  const loadPMs = () => {
    fetch('/api/reps?role=project_manager').then((r) => r.ok ? r.json() : []).then((data) => {
      setPms(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => {
    loadPMs();
    // Load the installer list once for the scope dropdown. Falls back
    // to empty array on failure — the select just shows "Full access".
    fetch('/api/installers').then((r) => r.ok ? r.json() : []).then((data) => {
      if (Array.isArray(data)) setInstallers(data.filter((i: Installer) => i.active));
    }).catch(() => { /* non-fatal */ });
  }, []);

  const handleAdd = async () => {
    if (!newFirstName.trim() || !newEmail.trim()) return;
    const res = await fetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: newFirstName.trim(),
        lastName: newLastName.trim(),
        email: newEmail.trim(),
        role: 'project_manager',
        scopedInstallerId: newScopedInstallerId || undefined,
      }),
    });
    if (res.ok) {
      toast(newScopedInstallerId ? 'Vendor PM added (installer-scoped)' : 'Project manager added');
      setNewFirstName(''); setNewLastName(''); setNewEmail(''); setNewScopedInstallerId('');
      loadPMs();
    } else {
      toast('Failed to add project manager', 'error');
    }
  };

  const togglePerm = async (pmId: string, field: 'canExport' | 'canCreateDeals' | 'canAccessBlitz', current: boolean) => {
    const res = await fetch(`/api/users/${pmId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: !current }),
    });
    if (res.ok) {
      setPms((prev) => prev.map((pm) => pm.id === pmId ? { ...pm, [field]: !current } : pm));
    } else {
      toast('Failed to update permission', 'error');
    }
  };

  const setScope = async (pmId: string, scopedInstallerId: string | null) => {
    const prev = pms.find((p) => p.id === pmId)?.scopedInstallerId ?? null;
    setPms((ps) => ps.map((pm) => pm.id === pmId ? { ...pm, scopedInstallerId } : pm));
    const res = await fetch(`/api/users/${pmId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopedInstallerId: scopedInstallerId ?? '' }),
    });
    if (!res.ok) {
      setPms((ps) => ps.map((pm) => pm.id === pmId ? { ...pm, scopedInstallerId: prev } : pm));
      toast('Failed to update installer scope', 'error');
    } else {
      toast(scopedInstallerId ? 'Scoped to installer' : 'Full access restored', 'success');
    }
  };

  const handleDelete = async (pmId: string) => {
    const res = await fetch(`/api/users/${pmId}`, { method: 'DELETE' });
    if (res.ok) { toast('Project manager removed'); loadPMs(); }
  };

  if (loading) return <div className="text-sm text-[var(--text-muted)] py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">Project managers can view all projects and reps but cannot access payroll, pricing, or settings.</p>

      {/* Add form */}
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">First Name</label>
            <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-white" placeholder="First" />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Last Name</label>
            <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-white" placeholder="Last" />
          </div>
          <div className="flex-[2]">
            <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Email</label>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-white" placeholder="email@example.com" />
          </div>
          <button onClick={handleAdd} disabled={!newFirstName.trim() || !newEmail.trim()} className="btn-primary px-3 py-2 rounded-xl active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: '#050d18' }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Installer scope (optional)</label>
            <select
              value={newScopedInstallerId}
              onChange={(e) => setNewScopedInstallerId(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            >
              <option value="">— Full access (internal PM) —</option>
              {installers.map((i) => (
                <option key={i.id} value={i.id}>{i.name} (vendor PM — ops-only)</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* PM list with permission toggles */}
      {pms.length === 0 ? (
        <div className="card-surface rounded-2xl p-5 text-center">
          <p className="text-[var(--text-muted)] text-sm">No project managers yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pms.map((pm) => (
            <div key={pm.id} className="card-surface rounded-xl px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-white font-medium text-sm">{pm.firstName} {pm.lastName}</p>
                  <p className="text-[var(--text-muted)] text-xs">{pm.email}</p>
                </div>
                <button onClick={() => setConfirmDeletePmId(pm.id)} className="text-[var(--text-dim)] hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {([
                  { field: 'canCreateDeals' as const, label: 'Create Deals' },
                  { field: 'canAccessBlitz' as const, label: 'Blitz Access' },
                  { field: 'canExport' as const, label: 'Export Data' },
                ]).map(({ field, label }) => (
                  <button
                    key={field}
                    onClick={() => togglePerm(pm.id, field, pm[field])}
                    disabled={!!pm.scopedInstallerId}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      pm[field]
                        ? 'bg-emerald-900/30 text-emerald-300 border-[var(--accent-emerald-solid)]/30'
                        : 'bg-[var(--surface-card)]/50 text-[var(--text-muted)] border-[var(--border)]/50'
                    }`}
                    title={pm.scopedInstallerId ? 'Disabled while scoped to an installer' : undefined}
                  >
                    {pm[field] ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                    {label}
                  </button>
                ))}
              </div>
              {/* Vendor-PM installer scope. Selecting an installer flips
                  this PM into vendor mode — they lose access to payroll,
                  reimbursements, trainer assignments, the rep directory,
                  and only see projects matching this installer. */}
              <div className="mt-3 pt-3 border-t border-[var(--border)]/60 flex flex-wrap items-center gap-2">
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Installer scope</label>
                <select
                  value={pm.scopedInstallerId ?? ''}
                  onChange={(e) => setScope(pm.id, e.target.value || null)}
                  className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                >
                  <option value="">— Full access (internal PM) —</option>
                  {installers.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
                {pm.scopedInstallerId && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                    Vendor PM — ops-only
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeletePmId}
        onClose={() => setConfirmDeletePmId(null)}
        onConfirm={() => { if (confirmDeletePmId) handleDelete(confirmDeletePmId); setConfirmDeletePmId(null); }}
        title="Remove Project Manager"
        message="This will permanently delete their account. This action cannot be undone."
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}
