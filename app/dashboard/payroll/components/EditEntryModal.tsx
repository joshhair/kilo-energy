'use client';

// EditEntryModal — row-level edit of amount/date/notes (status changes
// happen via the row buttons; Paid entries are blocked at the open step).
// Moved verbatim from payroll/page.tsx (T4.1, 2026-06-11). The
// sign-preserving min/max flip on the amount input (negative entries stay
// negative) is behavior — keep verbatim. editingEntry gate stays in the
// page (this component receives the non-null entry); editEntryPanelRef +
// useFocusTrap stay page-owned (threaded).

import { X } from 'lucide-react';
import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { inputCls, labelCls } from './form-styles';
import type { PayrollEntry } from '../../../../lib/data';

export interface EditEntryModalProps {
  editingEntry: PayrollEntry;
  setEditingEntry: (e: PayrollEntry | null) => void;
  editEntryForm: { amount: string; date: string; notes: string };
  setEditEntryForm: Dispatch<SetStateAction<{ amount: string; date: string; notes: string }>>;
  handleSaveEditEntry: (e: FormEvent) => void;
  editEntryPanelRef: RefObject<HTMLDivElement | null>;
}

export function EditEntryModal({
  editingEntry, setEditingEntry, editEntryForm, setEditEntryForm,
  handleSaveEditEntry, editEntryPanelRef,
}: EditEntryModalProps) {
  return (
    <>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50">
          <div ref={editEntryPanelRef} className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[var(--text-primary)] font-semibold text-lg">Edit {editingEntry.type} Entry</h2>
              <button onClick={() => setEditingEntry(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[var(--text-muted)] text-xs mb-4">{editingEntry.repName} — {editingEntry.paymentStage}{editingEntry.customerName ? ` · ${editingEntry.customerName}` : ''}</p>
            <form onSubmit={handleSaveEditEntry} className="space-y-4">
              <div>
                <label className={labelCls}>Amount ($)</label>
                <input required type="number" min={editingEntry.amount < 0 ? undefined : "0.01"} max={editingEntry.amount < 0 ? "-0.01" : undefined} step="0.01"
                  value={editEntryForm.amount}
                  onChange={(e) => setEditEntryForm((f) => ({ ...f, amount: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" value={editEntryForm.date} required
                  onChange={(e) => setEditEntryForm((f) => ({ ...f, date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input type="text"
                  value={editEntryForm.notes}
                  onChange={(e) => setEditEntryForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls + ' placeholder-slate-500'} />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit"
                  className="btn-primary flex-1 text-black font-semibold py-2.5 rounded-xl text-sm active:scale-[0.97]"
                  style={{ backgroundColor: 'var(--brand)' }}>
                  Save Changes
                </button>
                <button type="button" onClick={() => setEditingEntry(null)}
                  className="btn-secondary flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-[var(--text-primary)] font-medium py-2.5 rounded-xl text-sm active:scale-[0.97]">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
    </>
  );
}
