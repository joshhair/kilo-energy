'use client';

/**
 * CancelReasonModal — the cancellation-reason picker shown before a
 * project is cancelled. Extracted verbatim from projects/[id]/page.tsx
 * (T4.1 split, 2026-06-11). Portaled to document.body for the same
 * reason as the Edit modal: ancestor transform/filter contexts trap
 * fixed descendants relative to the ancestor, not the viewport.
 * The open flag stays page-owned (the page's arrow-key navigation
 * effect reads it to suppress shortcuts while the modal is up).
 */

import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

export function CancelReasonModal({ open, customerName, reason, notes, onReasonChange, onNotesChange, onConfirm, onClose }: {
  open: boolean;
  customerName: string;
  reason: string;
  notes: string;
  onReasonChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--accent-red-text)]" />
                <h2 className="text-[var(--text-primary)] font-bold text-base">Cancel Project</h2>
              </div>
              <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg p-1 hover:bg-[var(--surface-card)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[var(--text-secondary)] text-sm">Please provide a reason for cancelling <span className="text-[var(--text-primary)] font-medium">{customerName}</span>.</p>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                >
                  <option value="">Select a reason...</option>
                  <option value="Customer changed mind">Customer changed mind</option>
                  <option value="Credit denied">Credit denied</option>
                  <option value="Roof not suitable">Roof not suitable</option>
                  <option value="Competitor won">Competitor won</option>
                  <option value="Pricing issue">Pricing issue</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1.5">Notes <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span></label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="Additional details..."
                  className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] resize-none placeholder-slate-500"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  Go Back
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-[var(--text-primary)] font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors active:scale-[0.97]"
                >
                  Cancel Project
                </button>
              </div>
            </div>
          </div>
        </div>
  , document.body);
}
