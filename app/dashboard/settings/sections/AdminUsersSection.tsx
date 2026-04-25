'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';

export function AdminUsersSection() {
  const { toast } = useToast();
  const [admins, setAdmins] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadAdmins = () => {
    fetch('/api/reps?role=admin')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: Array<{ id: string; firstName: string; lastName: string; email: string }>) => {
        setAdmins(users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };
  useEffect(() => { loadAdmins(); }, []);

  const handleAdd = async () => {
    if (!newFirstName.trim() || !newEmail.trim()) return;
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: newFirstName.trim(), lastName: newLastName.trim(), email: newEmail.trim(), role: 'admin' }),
    });
    if (res.ok) {
      toast('Admin user invited');
      setNewFirstName(''); setNewLastName(''); setNewEmail('');
      loadAdmins();
    } else {
      toast('Failed to add admin user', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (res.ok) { toast('Admin removed'); loadAdmins(); }
    else toast('Failed to remove admin', 'error');
    setConfirmDeleteId(null);
  };

  if (loading) return <div className="text-sm text-[var(--text-muted)] py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">Admin users have full access to all settings, payroll, and data.</p>

      {/* Add form */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">First Name</label>
          <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-[var(--text-primary)]" placeholder="First" />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Last Name</label>
          <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-[var(--text-primary)]" placeholder="Last" />
        </div>
        <div className="flex-[2]">
          <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Email</label>
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 text-sm text-[var(--text-primary)]" placeholder="email@example.com" />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newFirstName.trim() || !newEmail.trim()}
          className="btn-primary px-3 py-2 rounded-xl active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--surface-page)' }}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* List */}
      {admins.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">No admin users found.</p>
      ) : (
        <div className="card-surface rounded-2xl overflow-hidden divide-y divide-[var(--border-subtle)]">
          {admins.map((admin) => (
            <div key={admin.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{admin.name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{admin.email}</p>
              </div>
              <button
                onClick={() => setConfirmDeleteId(admin.id)}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-[var(--accent-red-text)] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Remove Admin User"
        message="Are you sure you want to remove this admin user? This cannot be undone."
        confirmLabel="Remove"
        danger
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
