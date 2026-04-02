'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success', action?: ToastAction) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type, action }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Listen for persist-error events dispatched from context-level code
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail || 'Failed to save — please try again';
      toast(msg, 'error');
    };
    window.addEventListener('kilo-persist-error', handler);
    return () => window.removeEventListener('kilo-persist-error', handler);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Total visible duration before the exit animation begins (ms). */
const VISIBLE_DURATION = 3500;
/** Duration of the slide-out exit animation (ms) — must match `toastOut` keyframe. */
const EXIT_DURATION = 250;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false);

  // Refs used to pause/resume the countdown on hover without losing elapsed time.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(VISIBLE_DURATION);
  const startTimeRef = useRef<number>(0);

  /** Kick off the exit sequence: animate out, then remove from state. */
  const startExit = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), EXIT_DURATION);
  }, [onDismiss, toast.id]);

  // Start the auto-dismiss timer on mount.
  useEffect(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(startExit, VISIBLE_DURATION);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startExit]);

  /** On hover: pause the timer and record how much time has elapsed. */
  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startTimeRef.current),
    );
  }, []);

  /** On leave: restart the timer for whatever time was remaining. */
  const handleMouseLeave = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(startExit, remainingRef.current);
  }, [startExit]);

  const config = {
    success: {
      icon: <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
      border: 'border-emerald-500/30',
      progress: 'bg-emerald-500',
    },
    error: {
      icon: <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />,
      border: 'border-red-500/30',
      progress: 'bg-red-500',
    },
    info: {
      icon: <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />,
      border: 'border-blue-500/30',
      progress: 'bg-blue-500',
    },
  }[toast.type];

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={[
        'toast-item',
        'pointer-events-auto relative flex items-center gap-3 px-4 py-3',
        'rounded-xl border bg-slate-900',
        config.border,
        'min-w-[280px] max-w-[400px] shadow-2xl overflow-hidden',
        leaving ? 'animate-toast-out' : 'animate-toast-in',
      ].join(' ')}
    >
      {config.icon}
      <span className="text-white text-sm flex-1 leading-snug">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            onDismiss(toast.id);
          }}
          className="text-blue-400 hover:text-blue-300 font-medium text-sm transition-colors flex-shrink-0 ml-1"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-slate-500 hover:text-white transition-colors ml-1 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Auto-dismiss progress bar — shrinks from 100 → 0% over VISIBLE_DURATION */}
      <div
        className={`toast-progress absolute bottom-0 left-0 h-[2px] w-full ${config.progress}`}
      />
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
