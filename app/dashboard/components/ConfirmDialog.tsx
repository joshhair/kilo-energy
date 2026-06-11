'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

  if (!open || typeof document === 'undefined') return null;

  // Portaled to document.body at z-[60] (the Add Rep Modal precedent): inline,
  // the overlay shared z-50 with the fixed BottomNav, and when the nav rides up
  // the bottom stack (e.g. above the InstallPrompt) it painted OVER the dialog's
  // Cancel/Confirm buttons — a covered destructive control. The portal also
  // escapes any transformed/animated ancestor (T1.8 containing blocks).
  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-[60] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div ref={panelRef} className="card-surface border border-[var(--border-subtle)] shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: danger
                ? 'color-mix(in srgb, var(--accent-red-solid) 12%, transparent)'
                : 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)',
              border: `1px solid color-mix(in srgb, ${danger ? 'var(--accent-red-solid)' : 'var(--accent-emerald-solid)'} 30%, transparent)`,
            }}
          >
            <AlertTriangle className={`w-4 h-4 ${danger ? 'text-[var(--accent-red-text)]' : 'text-[var(--accent-emerald-text)]'}`} />
          </div>
          <h3 className="text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)", fontSize: '1.125rem' }}>{title}</h3>
        </div>
        <p className="text-[var(--text-secondary)] text-sm mb-5" style={{ whiteSpace: 'pre-line' }}>{message}</p>
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
    </div>,
    document.body,
  );
}
