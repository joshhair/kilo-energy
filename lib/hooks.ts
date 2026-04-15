import { useRef, useState, useEffect, useSyncExternalStore, type RefObject } from 'react';

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
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setIsVisible(true);
      return;
    }

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
/**
 * Traps keyboard focus within a container element while active.
 *
 * When the user presses Tab on the last focusable element it wraps to the first,
 * and Shift+Tab on the first wraps to the last. On activation the first focusable
 * element inside the container receives focus automatically.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    // Focus first focusable element
    const first = container.querySelector(focusableSelector) as HTMLElement;
    if (first) requestAnimationFrame(() => first.focus());
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [active, containerRef]);
}

/**
 * Adds Up/Down arrow-key navigation to table rows within a tbody element.
 *
 * Attach the returned ref to the `<tbody>`. Rows should have `tabIndex={0}`.
 * Up/Down arrows move focus between rows; Enter clicks the focused row.
 */
export function useTableKeyNav(tbodyRef: RefObject<HTMLTableSectionElement | null>) {
  useEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest('tr');
      if (!row || row.parentElement !== tbody) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = row.nextElementSibling as HTMLElement | null;
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = row.previousElementSibling as HTMLElement | null;
        if (prev) prev.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        row.click();
      }
    };

    tbody.addEventListener('keydown', handleKeyDown);
    return () => tbody.removeEventListener('keydown', handleKeyDown);
  }, [tbodyRef]);
}

/**
 * Syncs a tab state variable with a URL search param on browser navigation.
 *
 * Pass the raw `tab` param value (from `searchParams.get('tab')`), the list of
 * valid tab values, and the default tab. Returns `[tab, setTabState]` — the
 * controlled state is initialised from the URL and re-synced whenever the URL
 * param changes (e.g. browser back/forward).
 *
 * @example
 * const rawTab = searchParams.get('tab');
 * const [tab, setTabState] = useSearchParamTab(rawTab, ['a', 'b'] as const, 'a');
 */
export function useSearchParamTab<T extends string>(
  rawTab: string | null,
  validTabs: readonly T[],
  defaultTab: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const resolve = (raw: string | null): T =>
    validTabs.includes(raw as T) ? (raw as T) : defaultTab;
  const [tab, setTabState] = useState<T>(() => resolve(rawTab));
  useEffect(() => {
    setTabState(resolve(rawTab));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTab]);
  return [tab, setTabState];
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
