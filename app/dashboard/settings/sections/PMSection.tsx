'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckSquare, Square } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';

export function PMSection() {
  const { toast } = useToast();
  const [pms, setPms] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; canExport: boolean; canCreateDeals: boolean; canAccessBlitz: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmDeletePmId, setConfirmDeletePmId] = useState<string | null>(null);

  const loadPMs = () => {
    fetch('/api/reps?role=project_manager').then((r) => r.ok ? r.json() : []).then((data) => {
      setPms(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { loadPMs(); }, []);

  const handleAdd = async () => {
    if (!newFirstName.trim() || !newEmail.trim()) return;
    const res = await fetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: newFirstName.trim(), lastName: newLastName.trim(), email: newEmail.trim(), role: 'project_manager' }),
    });
    if (res.ok) {
      toast('Project manager added');
      setNewFirstName(''); setNewLastName(''); setNewEmail('');
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

  const handleDelete = async (pmId: string) => {
    const res = await fetch(`/api/users/${pmId}`, { method: 'DELETE' });
    if (res.ok) { toast('Project manager removed'); loadPMs(); }
  };

  if (loading) return <div className="text-sm text-[var(--text-muted)] py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">Project managers can view all projects and reps but cannot access payroll, pricing, or settings.</p>

      {/* Add form */}
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
        <button onClick={handleAdd} disabled={!newFirstName.trim() || !newEmail.trim()} className="btn-primary px-3 py-2 rounded-xl active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#fff' }}>
          <Plus className="w-4 h-4" />
        </button>
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
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                      pm[field]
                        ? 'bg-emerald-900/30 text-emerald-300 border-[var(--accent-green)]/30'
                        : 'bg-[var(--surface-card)]/50 text-[var(--text-muted)] border-[var(--border)]/50'
                    }`}
                  >
                    {pm[field] ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                    {label}
                  </button>
                ))}
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
