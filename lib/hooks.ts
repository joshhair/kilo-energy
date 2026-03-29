import { useRef, useState, useEffect, useSyncExternalStore } from 'react';

/**
 * Returns `false` on the server / first paint and `true` after client hydration.
 *
 * Uses `useSyncExternalStore` with a no-op subscribe so that React can
 * reconcile cleanly between the server snapshot (`false`) and the client
 * snapshot (`true`) without needing a `useEffect` + `setState` pair.
 */
function subscribe(_cb: () => void): () => void {
  return () => {};
}

export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,   // client snapshot
    () => false,  // server snapshot
  );
}

/**
 * Lightweight scroll-triggered reveal hook backed by IntersectionObserver.
 *
 * Returns a `[ref, isVisible]` tuple. Attach `ref` to the element you want
 * to watch. `isVisible` flips to `true` once the element crosses the 10 %
 * viewport threshold and **stays true** (triggerOnce behaviour) — preventing
 * the element from hiding again on scroll back.
 *
 * Pair with the `.scroll-reveal-hidden` / `.scroll-reveal-visible` CSS
 * classes defined in globals.css for the blur + translateY fade-in effect.
 *
 * @example
 * const [ref, isVisible] = useScrollReveal<HTMLDivElement>();
 * <div ref={ref} className={isVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}>
 *   …
 * </div>
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T | null>,
  boolean,
] {
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Skip the observer entirely if the element is already near the top of the
    // page (i.e. above the fold on first paint) so it renders immediately.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect(); // triggerOnce — never hide again
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, isVisible];
}

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 *
 * @example
 * const isDesktop = useMediaQuery('(min-width: 768px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
