'use client';

import { useEffect, useRef, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';

function SheetItem({
  label,
  icon: Icon,
  onTap,
  danger,
  active,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onTap: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 min-h-[52px] px-5 py-3 text-left active:opacity-70 transition-opacity"
      style={{
        color: active ? 'var(--accent-emerald-solid)' : danger ? 'var(--accent-red-solid)' : 'var(--text-primary)',
        background: active ? 'var(--accent-emerald-soft)' : undefined,
      }}
    >
      {Icon && <Icon className="w-5 h-5 shrink-0 opacity-60" aria-hidden="true" />}
      <span className="text-base flex-1" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</span>
      {active && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-emerald-text)' }} aria-hidden="true" />}
    </button>
  );
}

export default function MobileBottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Render via portal to document.body so position:fixed anchors to the
  // viewport regardless of any ancestor's transform/filter/perspective.
  // (Without the portal, a parent with transform creates a new containing
  // block and the sheet appears at the bottom of that parent — making it
  // look like it opened "at the bottom of the page" instead of the screen.)
  //
  // Accessibility upgrade (a11y sweep): role=dialog + aria-modal on the
  // panel, basic focus trap on Tab keys, restore-focus on close,
  // auto-focus first interactive element on open.
  useEffect(() => {
    if (!open) return;

    // Remember the element that was focused before the sheet opened so
    // we can hand focus back to it on close. Fall back to document.body
    // if nothing was focused.
    previouslyFocusedRef.current = (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    // Auto-focus the first interactive element inside the panel on open.
    // Runs in a microtask so the DOM is committed before we try to focus.
    const autoFocus = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    };
    const t = setTimeout(autoFocus, 0);

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        // Cheap focus trap: collect focusable nodes inside the panel and
        // wrap Tab / Shift+Tab. Doesn't handle radio-group quirks — good
        // enough for this app's forms.
        const nodes = panelRef.current.querySelectorAll<HTMLElement>(
          'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
      // Restore focus to the element that triggered the sheet opening.
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const titleId = title ? `mobile-sheet-${title.replace(/\s+/g, '-').toLowerCase()}` : undefined;

  const sheet = (
    <>
      <div className="fixed inset-0 z-[60] animate-modal-backdrop" style={{ background: 'var(--surface-overlay)' }} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-2xl animate-modal-panel flex flex-col"
        style={{
          background: 'var(--surface-card)',
          borderTop: '1px solid var(--border-subtle)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          // Cap height so tall sheets (edit forms with many fields) don't push
          // their own chrome up under the status bar. Header + scroll body.
          maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 12px)',
        }}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-subtle)' }} aria-hidden="true" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 py-2 shrink-0">
            <p id={titleId} className="text-base font-semibold" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{title}</p>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 active:opacity-50"
              style={{ color: 'var(--text-dim)' }}
            ><X className="w-5 h-5" aria-hidden="true" /></button>
          </div>
        )}
        <div className="pb-4 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </>
  );

  return createPortal(sheet, document.body);
}

MobileBottomSheet.Item = SheetItem;
