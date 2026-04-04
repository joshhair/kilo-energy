'use client';

import { useEffect, type ComponentType } from 'react';
import { X } from 'lucide-react';

function SheetItem({
  label,
  icon: Icon,
  onTap,
  danger,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onTap: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      className={`w-full flex items-center gap-3 min-h-[52px] px-5 py-3 text-left active:bg-slate-800/50 transition-colors ${danger ? 'text-red-400' : 'text-white'}`}
    >
      {Icon && <Icon className="w-5 h-5 shrink-0" />}
      <span className="text-sm font-medium">{label}</span>
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
      <div className="fixed inset-0 bg-black/60 z-[60] animate-[fadeIn_150ms_ease]" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-2xl animate-[slideUp_200ms_ease]"
        style={{ background: 'rgba(15, 25, 45, 0.98)', backdropFilter: 'blur(20px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-2">
            <p className="text-sm font-semibold text-white">{title}</p>
            <button onClick={onClose} className="p-1 text-slate-500 active:text-white"><X className="w-5 h-5" /></button>
          </div>
        )}
        {/* Items */}
        <div className="pb-4">
          {children}
        </div>
      </div>
    </>
  );
}

MobileBottomSheet.Item = SheetItem;
