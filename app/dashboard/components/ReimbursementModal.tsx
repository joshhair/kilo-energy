'use client';

import { useState, useRef, useEffect } from 'react';
import { useFocusTrap } from '../../../lib/hooks';
import { localDateString } from '../../../lib/utils';
import { Receipt, Upload, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReimbursementSubmitData {
  repId: string;
  repName: string;
  amount: number;
  description: string;
  date: string;
  receiptName?: string;
}

export interface ReimbursementModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ReimbursementSubmitData) => void;
  repId: string;
  repName: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateField(field: string, value: string): string {
  switch (field) {
    case 'amount':
      if (!value) return 'Amount is required';
      if (parseFloat(value) <= 0) return 'Must be greater than 0';
      return '';
    case 'date':
      return value ? '' : 'Date is required';
    case 'description':
      return value.trim() ? '' : 'Description is required';
    default:
      return '';
  }
}

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? (
    <p id={`${field}-error`} className="text-red-400 text-xs mt-1" role="alert">
      {errors[field]}
    </p>
  ) : null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelCls = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider';

// ── Component ─────────────────────────────────────────────────────────────────

export function ReimbursementModal({ open, onClose, onSubmit, repId, repName }: ReimbursementModalProps) {
  const [form, setForm] = useState({ amount: '', description: '', date: localDateString(new Date()), fileName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useFocusTrap(panelRef, open);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      setForm({ amount: '', description: '', date: localDateString(new Date()), fileName: '' });
      setErrors({});
      requestAnimationFrame(() => amountRef.current?.focus());
    }
  }, [open]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const updateForm = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleBlur = (field: string) => {
    setErrors((prev) => ({ ...prev, [field]: validateField(field, form[field as keyof typeof form]) }));
  };

  const inputCls = (field: string) =>
    `w-full bg-[var(--surface-card)] border ${errors[field] ? 'border-red-500' : 'border-[var(--border)]'} text-white rounded-xl px-4 py-2.5 focus:outline-none transition-all duration-200 input-focus-glow placeholder-slate-500 text-sm`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldsToValidate = ['amount', 'date', 'description'] as const;
    const newErrors: Record<string, string> = {};
    let hasErrors = false;
    for (const field of fieldsToValidate) {
      const error = validateField(field, form[field]);
      newErrors[field] = error;
      if (error) hasErrors = true;
    }
    setErrors(newErrors);
    if (hasErrors) return;

    onSubmit({
      repId,
      repName,
      amount: parseFloat(form.amount),
      description: form.description.trim(),
      date: form.date || localDateString(new Date()),
      receiptName: form.fileName || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panelRef} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl animate-slide-in-scale">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-violet-400" />
            <h2 className="text-white font-bold text-base">Request Reimbursement</h2>
          </div>
          <button onClick={onClose} aria-label="Close reimbursement modal" className="text-[var(--text-secondary)] hover:text-white transition-colors rounded-lg p-1 hover:bg-[var(--surface-card)]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="reimb-amount" className={labelCls}>Amount ($)</label>
              <input ref={amountRef} id="reimb-amount" type="number" step="0.01" min="0.01" placeholder="0.00"
                value={form.amount} onChange={(e) => updateForm('amount', e.target.value)}
                onBlur={() => handleBlur('amount')} aria-invalid={!!errors.amount}
                className={inputCls('amount')} />
              <FieldError field="amount" errors={errors} />
            </div>
            <div>
              <label htmlFor="reimb-date" className={labelCls}>Date</label>
              <input id="reimb-date" type="date" value={form.date}
                onChange={(e) => updateForm('date', e.target.value)} onBlur={() => handleBlur('date')}
                aria-invalid={!!errors.date} className={inputCls('date')} />
              <FieldError field="date" errors={errors} />
            </div>
          </div>
          <div>
            <label htmlFor="reimb-description" className={labelCls}>Description</label>
            <input id="reimb-description" type="text" placeholder="e.g. Gas mileage, office supplies…"
              value={form.description} onChange={(e) => updateForm('description', e.target.value)}
              onBlur={() => handleBlur('description')} aria-invalid={!!errors.description}
              className={inputCls('description')} />
            <FieldError field="description" errors={errors} />
          </div>
          <div>
            <label className={labelCls}>Receipt <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span></label>
            <label className="flex items-center gap-2 bg-[var(--surface-card)] border border-[var(--border)] border-dashed rounded-xl px-4 py-2.5 cursor-pointer hover:border-[var(--border)] transition-colors overflow-hidden">
              <Upload className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
              <span className="text-[var(--text-muted)] text-sm truncate">{form.fileName || 'Attach file…'}</span>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={(e) => updateForm('fileName', e.target.files?.[0]?.name ?? '')} />
            </label>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 bg-[var(--surface-card)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)] font-medium px-5 py-2.5 rounded-xl text-sm transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 btn-primary text-black font-semibold px-5 py-2.5 rounded-xl text-sm active:scale-[0.97]"
              style={{ backgroundColor: 'var(--brand)' }}>
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
