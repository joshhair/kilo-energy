'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export function ConfirmDeleteDialog({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: { type: 'installer' | 'financer' | 'trainer'; id: string; name: string; message: string };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Installer deletes with cascade require typing the name to confirm.
  // The message contains "PERMANENTLY delete" when there's a non-trivial
  // cascade (products and/or pricing versions about to be wiped).
  // For no-cascade installer deletes and all other types (financer,
  // trainer), a simple click-to-confirm is still fine.
  const requiresTypeToConfirm = confirm.type === 'installer' && confirm.message.includes('PERMANENTLY delete');
  const isDeletionBlocked = confirm.message.includes('cannot be deleted');
  const [typed, setTyped] = useState('');
  const canConfirm = !isDeletionBlocked && (!requiresTypeToConfirm || typed === confirm.name);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <h3 className="text-[var(--text-primary)] font-bold">
            Delete {confirm.type === 'trainer' ? `Assignment: ${confirm.name}` : confirm.name}?
          </h3>
        </div>
        {/* whitespace-pre-line so embedded \n in the message survive rendering */}
        <p className="text-[var(--text-secondary)] text-sm mb-5 whitespace-pre-line">{confirm.message}</p>
        {requiresTypeToConfirm && (
          <div className="mb-5">
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
              Type <span className="text-[var(--text-primary)] font-bold">{confirm.name}</span> to confirm:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              className="w-full rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-red-500/50"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
              placeholder={confirm.name}
            />
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--text-dim)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
