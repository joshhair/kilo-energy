'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, UserCog } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import { validateEmail, validateName } from '../../../../lib/validation';
import ConfirmDialog from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { PrimaryButton, IconButton, TextInput, FormField } from '@/components/ui';

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

  // Live validation: only show error after the field has user input, so
  // the inline error doesn't render on an empty initial form.
  const firstNameCheck = newFirstName.trim().length > 0
    ? validateName(newFirstName, { minLength: 1, maxLength: 100 })
    : null;
  const emailCheck = newEmail.trim().length > 0
    ? validateEmail(newEmail, { siblings: admins.map((a) => ({ id: a.id, email: a.email })) })
    : null;

  const canSubmit =
    firstNameCheck?.ok === true && emailCheck?.ok === true;

  const handleAdd = async () => {
    if (!canSubmit || !firstNameCheck?.ok || !emailCheck?.ok) return;
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: firstNameCheck.value,
        lastName: newLastName.trim(),
        email: emailCheck.value,
        role: 'admin',
      }),
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

      <div className="flex items-end gap-2">
        <FormField
          label="First Name"
          className="flex-1"
          error={firstNameCheck && !firstNameCheck.ok ? firstNameCheck.reason : undefined}
        >
          <TextInput
            value={newFirstName}
            onChange={(e) => setNewFirstName(e.target.value)}
            placeholder="First"
            invalid={firstNameCheck?.ok === false}
          />
        </FormField>
        <FormField label="Last Name" className="flex-1">
          <TextInput
            value={newLastName}
            onChange={(e) => setNewLastName(e.target.value)}
            placeholder="Last"
          />
        </FormField>
        <FormField
          label="Email"
          className="flex-[2]"
          error={emailCheck && !emailCheck.ok ? emailCheck.reason : undefined}
        >
          <TextInput
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="email@example.com"
            invalid={emailCheck?.ok === false}
          />
        </FormField>
        <PrimaryButton
          onClick={handleAdd}
          disabled={!canSubmit}
          aria-label="Add admin user"
        >
          <Plus className="w-4 h-4" />
        </PrimaryButton>
      </div>

      {admins.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No admin users yet"
          description="Add an admin above. Admin users have full access to all settings, payroll, and data."
          variant="inline"
        />
      ) : (
        <div className="card-surface rounded-2xl overflow-hidden divide-y divide-[var(--border-subtle)]">
          {admins.map((admin) => (
            <div key={admin.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{admin.name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{admin.email}</p>
              </div>
              <IconButton
                variant="danger"
                aria-label={`Remove ${admin.name}`}
                onClick={() => setConfirmDeleteId(admin.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </IconButton>
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
