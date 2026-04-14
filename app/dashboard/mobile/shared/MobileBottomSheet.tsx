'use client';

import { useEffect, type ComponentType } from 'react';
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
        color: active ? 'var(--accent-emerald)' : danger ? 'var(--m-danger, var(--accent-danger))' : '#fff',
        background: active ? 'rgba(0,229,160,0.06)' : undefined,
      }}
    >
      {Icon && <Icon className="w-5 h-5 shrink-0 opacity-60" />}
      <span className="text-base flex-1" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</span>
      {active && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-emerald)' }} />}
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
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-2xl"
        style={{ background: 'var(--m-card, var(--surface-mobile-card))', borderTop: '1px solid var(--m-border, var(--border-mobile))', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))' }} />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 py-2">
            <p className="text-base font-semibold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{title}</p>
            <button onClick={onClose} className="p-2 active:opacity-50" style={{ color: 'var(--m-text-dim, #445577)' }}><X className="w-5 h-5" /></button>
          </div>
        )}
        <div className="pb-4">
          {children}
        </div>
      </div>
    </>
  );
}

MobileBottomSheet.Item = SheetItem;
