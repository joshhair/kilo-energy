'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '../../../lib/hooks';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  // Auto-focus confirm button on open
  useEffect(() => {
    if (open) {
      // Small delay so the animation can start before focus
      const timer = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div ref={panelRef} className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            danger
              ? 'bg-red-500/15 border border-red-500/30'
              : 'bg-[var(--accent-emerald-solid)]/15 border border-[var(--accent-emerald-solid)]/30'
          }`}>
            <AlertTriangle className={`w-4 h-4 ${danger ? 'text-[var(--accent-red-text)]' : 'text-[var(--accent-emerald-text)]'}`} />
          </div>
          <h3 className="text-[var(--text-primary)] font-bold">{title}</h3>
        </div>
        <p className="text-[var(--text-secondary)] text-sm mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--text-dim)] transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-[var(--text-primary)] transition-colors ${
              danger
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-[var(--accent-emerald-solid)] hover:bg-[var(--accent-emerald-solid)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
