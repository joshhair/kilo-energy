'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Download, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  const dismiss = useCallback(() => {
    setShow(false);
    try {
      localStorage.setItem('kilo-install-dismissed', '1');
    } catch {}
  }, []);

  useEffect(() => {
    // Don't show if already dismissed
    try {
      if (localStorage.getItem('kilo-install-dismissed')) return;
    } catch {}

    // Don't show if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((navigator as unknown as Record<string, unknown>).standalone === true) return;

    // Only show on mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.innerWidth < 768;
    if (!isMobile) return;

    // Detect iOS
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (ios) {
      // On iOS, check if in Safari (not in-app browser)
      const isSafari = /Safari/i.test(navigator.userAgent) &&
        !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(navigator.userAgent);
      if (isSafari) {
        setIsIOS(true);
        setShow(true);
      }
      return;
    }

    // Android / Chrome — listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Auto-dismiss on successful install
    const installedHandler = () => {
      setShow(false);
      deferredPrompt.current = null;
    };
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === 'accepted') {
      dismiss();
    }
    deferredPrompt.current = null;
  };

  if (!show) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up safe-area-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-3 mb-3 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl shadow-black/50 p-4">
        <div className="flex items-start gap-3">
          {/* App icon */}
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
            <span className="text-white font-black text-xl tracking-tighter">K</span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">
              Add Kilo Energy to your home screen
            </p>
            {isIOS ? (
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                Tap <Share className="inline w-3.5 h-3.5 -mt-0.5 text-blue-400" /> then{' '}
                <span className="text-white font-medium">&quot;Add to Home Screen&quot;</span>
              </p>
            ) : (
              <p className="text-slate-400 text-xs mt-1">
                Install for quick access and a full-screen experience
              </p>
            )}
          </div>

          {/* Dismiss */}
          <button
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="flex-shrink-0 text-slate-500 hover:text-white transition-colors p-1 -mt-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Install button (Android/Chrome only) */}
        {!isIOS && (
          <button
            onClick={handleInstall}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            Install
          </button>
        )}
      </div>
    </div>
  );
}
