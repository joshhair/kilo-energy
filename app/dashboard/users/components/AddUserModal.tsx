'use client';

// AddUserModal — the Add User / invite modal (rep, sub-dealer, PM, admin
// with vendor-PM installer scoping). Moved verbatim from users/page.tsx
// (T4.1, 2026-06-11). The ENTIRE state+handler cluster (11 fields,
// resetAddModal, the Escape/focus-trap effects, handleAddRep with its
// Clerk invite + trainer assignment + adminUsers/pmUsers writes) stays
// PAGE-OWNED and arrives via the form bundle. Portaled to document.body
// so the modal escapes any transformed/filtered ancestor (which would
// otherwise become the containing block for position:fixed and offset
// the overlay from the viewport). newScopedInstallerId stays SINGULAR -
// it matches the privacy gate's scopedInstallerId schema.

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { RepSelector } from '../../components/RepSelector';
import type { Rep } from '../../../../lib/data';
import { ROLE_LABELS, ROLE_LABELS_BY_ROLE, ROLE_BADGE_CLS, ROLE_BADGE_STYLES } from './role-meta';
import type { Dispatch, RefObject, SetStateAction } from 'react';

type UserRole = 'rep' | 'admin' | 'sub-dealer' | 'project_manager';

export interface AddUserFormBundle {
  newUserRole: UserRole;
  setNewUserRole: Dispatch<SetStateAction<UserRole>>;
  sendInvite: boolean;
  setSendInvite: Dispatch<SetStateAction<boolean>>;
  newFirstName: string;
  setNewFirstName: Dispatch<SetStateAction<string>>;
  newLastName: string;
  setNewLastName: Dispatch<SetStateAction<string>>;
  newEmail: string;
  setNewEmail: Dispatch<SetStateAction<string>>;
  newPhone: string;
  setNewPhone: Dispatch<SetStateAction<string>>;
  newScopedInstallerId: string;
  setNewScopedInstallerId: Dispatch<SetStateAction<string>>;
  newRepType: 'closer' | 'setter' | 'both';
  setNewRepType: Dispatch<SetStateAction<'closer' | 'setter' | 'both'>>;
  newTrainerId: string;
  setNewTrainerId: Dispatch<SetStateAction<string>>;
  isAddingRep: boolean;
}

export function AddUserModal({ open, form, handleAddRep, resetAddModal, addRepPanelRef, installersForScope, reps }: {
  open: boolean;
  form: AddUserFormBundle;
  handleAddRep: (e: React.FormEvent) => void;
  resetAddModal: () => void;
  addRepPanelRef: RefObject<HTMLDivElement | null>;
  installersForScope: Array<{ id: string; name: string }>;
  reps: Rep[];
}) {
  const {
    newUserRole, setNewUserRole, sendInvite, setSendInvite,
    newFirstName, setNewFirstName, newLastName, setNewLastName,
    newEmail, setNewEmail, newPhone, setNewPhone,
    newScopedInstallerId, setNewScopedInstallerId,
    newRepType, setNewRepType, newTrainerId, setNewTrainerId, isAddingRep,
  } = form;
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-start sm:items-center justify-center z-[60] p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) resetAddModal(); }}
          role="dialog"
          aria-modal="true"
        >
          <div ref={addRepPanelRef} className="card-surface shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto my-auto" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[var(--text-primary)] font-bold text-lg">Add New User</h3>
              <button onClick={resetAddModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Account role selector */}
            <div className="mb-4">
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Account type</label>
              <div className="grid grid-cols-2 gap-2">
                {(['rep', 'sub-dealer', 'project_manager', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => { setNewUserRole(r); setSendInvite(false); }}
                    className={`py-2 rounded-xl text-xs font-semibold transition-all border ${
                      newUserRole === r
                        ? 'border-[var(--accent-emerald-solid)] text-[var(--accent-emerald-text)] bg-[var(--accent-emerald-solid)]/10'
                        : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-card)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {ROLE_LABELS_BY_ROLE[r]}
                  </button>
                ))}
              </div>
              {(newUserRole === 'admin' || newUserRole === 'project_manager') && (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  {ROLE_LABELS_BY_ROLE[newUserRole]} accounts are always invited by email — no dormant creation.
                </p>
              )}
            </div>

            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>First Name</label>
                <input
                  type="text"
                  placeholder="First name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]/50 focus:border-[var(--accent-emerald-solid)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Last Name</label>
                <input
                  type="text"
                  placeholder="Last name"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]/50 focus:border-[var(--accent-emerald-solid)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* Email */}
            <div className="mb-3">
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Email</label>
              <input
                type="email"
                placeholder="rep@kiloenergy.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]/50 focus:border-[var(--accent-emerald-solid)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>

            {/* Phone */}
            <div className="mb-4">
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Phone</label>
              <input
                type="tel"
                placeholder="(555) 000-0000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]/50 focus:border-[var(--accent-emerald-solid)] placeholder-slate-500" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>

            {/* PM-specific fields — only shown when role === 'project_manager'.
                Picking an installer here provisions them as a vendor PM
                immediately on creation, so the privacy gate scopes them
                from their first session — no brief unscoped state. */}
            {newUserRole === 'project_manager' && (
              <div className="mb-4">
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                  Installer scope <span className="text-[10px] opacity-70">(optional)</span>
                </label>
                <select
                  value={newScopedInstallerId}
                  onChange={(e) => setNewScopedInstallerId(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]/50 focus:border-[var(--accent-emerald-solid)]"
                  style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                >
                  <option value="">— Full access (internal PM) —</option>
                  {installersForScope.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} (vendor PM — ops-only)</option>
                  ))}
                </select>
                {newScopedInstallerId && (
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--accent-amber-text)' }}>
                    Vendor PM — only sees projects from this installer; no payroll, pricing, or rep directory.
                  </p>
                )}
              </div>
            )}

            {/* Rep-specific fields — only shown when role === 'rep' */}
            {newUserRole === 'rep' && (
              <>
                {/* Closer/Setter/Both selector */}
                <div className="mb-4">
                  <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Rep type</label>
                  <div className="flex gap-2">
                    {(['closer', 'setter', 'both'] as const).map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setNewRepType(rt)}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                          newRepType === rt
                            ? `${ROLE_BADGE_CLS[rt]} bg-opacity-100`
                            : 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-card)] hover:border-[var(--border)] hover:text-[var(--text-secondary)]'
                        }`}
                        style={newRepType === rt ? ROLE_BADGE_STYLES[rt] : undefined}
                      >
                        {ROLE_LABELS[rt]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Trainer Assignment */}
                <div className="mb-4">
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Trainer (optional)</label>
                  <RepSelector
                    value={newTrainerId}
                    onChange={setNewTrainerId}
                    // Trainer rule: keep historical, block new. Deactivated
                    // trainers cannot be assigned to new trainees, so they
                    // are filtered out of this picker.
                    reps={reps.filter((r) => r.active !== false)}
                    placeholder="-- Select trainer --"
                    clearLabel="None"
                  />
                </div>
              </>
            )}

            {/* Send Clerk invitation toggle */}
            <div className="mb-5">
              <label className={`flex items-center gap-3 select-none ${(newUserRole === 'admin' || newUserRole === 'project_manager') ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={sendInvite || newUserRole === 'admin' || newUserRole === 'project_manager'}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  disabled={newUserRole === 'admin' || newUserRole === 'project_manager'}
                  className="w-4 h-4 rounded border-[var(--border-subtle)] accent-[var(--accent-emerald-solid)] cursor-pointer disabled:cursor-not-allowed"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">Send invitation email</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {(newUserRole === 'admin' || newUserRole === 'project_manager')
                      ? 'Required for this role — admin and project manager accounts must receive an invite to access the app.'
                      : 'Emails the rep a sign-up link. Leave off to add them without giving app access yet.'}
                  </div>
                </div>
              </label>
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <button
                onClick={resetAddModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors hover:brightness-125"
                style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRep}
                disabled={!newFirstName.trim() || !newLastName.trim() || isAddingRep}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--text-on-accent)' }}
              >
                {isAddingRep ? 'Adding…' : (sendInvite || newUserRole === 'admin' || newUserRole === 'project_manager') ? `Send ${ROLE_LABELS_BY_ROLE[newUserRole]} Invite` : `Add ${ROLE_LABELS_BY_ROLE[newUserRole]}`}
              </button>
            </div>
          </div>
        </div>
    , document.body);
}
