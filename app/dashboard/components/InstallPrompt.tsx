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
  const [bannerHeight, setBannerHeight] = useState(0);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

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

  // When banner is visible, add extra bottom padding to the main scroll
  // container so fixed banner does not overlap page content, and set a CSS
  // variable on :root so the fixed bottom nav can shift up by the same amount.
  // Both are cleaned up on dismiss/unmount.
  // ResizeObserver is used so the padding tracks the banner's full rendered
  // height (including env(safe-area-inset-bottom)) even after the browser
  // resolves the CSS environment variable post-mount.
  useEffect(() => {
    const main = document.querySelector('main');
    if (!show || !bannerRef.current) {
      if (main instanceof HTMLElement) main.style.removeProperty('padding-bottom');
      document.documentElement.style.removeProperty('--install-prompt-offset');
      setBannerHeight(0);
      return;
    }

    const applyOffset = (el: Element) => {
      const height = (el as HTMLElement).offsetHeight;
      setBannerHeight(height);
      if (main instanceof HTMLElement) main.style.setProperty('padding-bottom', `${height}px`);
      document.documentElement.style.setProperty('--install-prompt-offset', `${height}px`);
    };

    const observer = new ResizeObserver(([entry]) => {
      if (entry) applyOffset(entry.target);
    });
    observer.observe(bannerRef.current);
    applyOffset(bannerRef.current);

    return () => {
      observer.disconnect();
      if (main instanceof HTMLElement) main.style.removeProperty('padding-bottom');
      document.documentElement.style.removeProperty('--install-prompt-offset');
    };
  }, [show, isIOS]);

  if (!show) return null;

  return (
    <div
      ref={bannerRef}
      className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up safe-area-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-3 mb-3 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl shadow-black/50 p-4">
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
              <p className="text-[var(--text-secondary)] text-xs mt-1 leading-relaxed">
                Tap <Share className="inline w-3.5 h-3.5 -mt-0.5 text-[var(--accent-green)]" /> then{' '}
                <span className="text-white font-medium">&quot;Add to Home Screen&quot;</span>
              </p>
            ) : (
              <p className="text-[var(--text-secondary)] text-xs mt-1">
                Install for quick access and a full-screen experience
              </p>
            )}
          </div>

          {/* Dismiss */}
          <button
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="flex-shrink-0 text-[var(--text-muted)] hover:text-white transition-colors p-1 -mt-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Install button (Android/Chrome only) */}
        {!isIOS && (
          <button
            onClick={handleInstall}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-green)] hover:bg-[var(--accent-green)] text-black text-sm font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            Install
          </button>
        )}
      </div>
    </div>
  );
}
