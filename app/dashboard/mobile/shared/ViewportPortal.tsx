'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into `document.body` so that `position: fixed`
 * descendants resolve to the VIEWPORT, not to an ancestor that happens to
 * create a containing block (any ancestor with a non-`none` transform/filter/
 * perspective/`will-change: transform`/`contain`). The dashboard's page- and
 * section-enter animations use exactly such wrappers, which is why an in-page
 * fixed bottom bar/pill/FAB lands footer-style with dead space instead of
 * pinning to the bottom of the screen (T1.8).
 *
 * Portaling the fixed control OUT of the animated subtree pins it perfectly
 * AND keeps the page's slide-in animation — the visible motion belongs to the
 * page content; the chrome moves only by its own bottom-stack animation.
 *
 * SSR/hydration: render nothing on the server and on the first client paint,
 * then portal after mount (Codex's guidance — never render inline first and
 * move later, which would cause a layout jump). The element appears one tick
 * after mount and plays its own entrance animation. Keep the page's bottom
 * PADDING in the page itself so scroll content still clears the control.
 *
 * React context (useApp, handlers, the `--kilo-*` stack vars on `:root`) is
 * preserved through the portal — only the DOM position changes.
 */
export default function ViewportPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
