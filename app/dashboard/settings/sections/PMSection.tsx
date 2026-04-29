'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckSquare, Square, ClipboardList } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import { validateName, validateEmail } from '../../../../lib/validation';
import ConfirmDialog from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { PrimaryButton, IconButton, TextInput, FormField } from '@/components/ui';

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

  const firstNameCheck = newFirstName.trim().length > 0 ? validateName(newFirstName) : null;
  const emailCheck = newEmail.trim().length > 0
    ? validateEmail(newEmail, { siblings: pms.map((pm) => ({ id: pm.id, email: pm.email })) })
    : null;
  const canSubmit = firstNameCheck?.ok === true && emailCheck?.ok === true;

  const handleAdd = async () => {
    if (!canSubmit || !firstNameCheck?.ok || !emailCheck?.ok) return;
    const res = await fetch('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: firstNameCheck.value,
        lastName: newLastName.trim(),
        email: emailCheck.value,
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

      <div className="space-y-2">
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
          <PrimaryButton onClick={handleAdd} disabled={!canSubmit} aria-label="Add project manager">
            <Plus className="w-4 h-4" />
          </PrimaryButton>
        </div>
        <FormField label="Installer scope (optional)" className="flex-1">
          <select
            value={newScopedInstallerId}
            onChange={(e) => setNewScopedInstallerId(e.target.value)}
            className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-colors"
          >
            <option value="">— Full access (internal PM) —</option>
            {installers.map((i) => (
              <option key={i.id} value={i.id}>{i.name} (vendor PM — ops-only)</option>
            ))}
          </select>
        </FormField>
      </div>

      {pms.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No project managers yet"
          description="Project managers can view all projects and reps but cannot access payroll, pricing, or settings."
          variant="inline"
        />
      ) : (
        <div className="space-y-2">
          {pms.map((pm) => (
            <div key={pm.id} className="card-surface rounded-xl px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[var(--text-primary)] font-medium text-sm">{pm.firstName} {pm.lastName}</p>
                  <p className="text-[var(--text-muted)] text-xs">{pm.email}</p>
                </div>
                <IconButton
                  variant="danger"
                  aria-label={`Remove ${pm.firstName} ${pm.lastName}`}
                  onClick={() => setConfirmDeletePmId(pm.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </IconButton>
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
                        ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)] border-[var(--accent-emerald-solid)]/30'
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
                  className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                >
                  <option value="">— Full access (internal PM) —</option>
                  {installers.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
                {pm.scopedInstallerId && (
                  <span className="text-[10px] text-[var(--accent-amber-text)] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
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
