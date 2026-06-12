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

/**
 * Publishes a fixed element's live height to a CSS custom property on
 * <html>, so OTHER fixed elements (which aren't its DOM children) can stack
 * above it without hardcoding magic pixel offsets.
 *
 * Used for the mobile bottom-stack: the bottom nav publishes its height,
 * a sticky action/CTA bar publishes its own, and the floating feedback
 * button reads both to sit clear of every actionable control (T1.3).
 *
 * `enabled=false` (e.g. a CTA that isn't mounted) resets the var to 0px so
 * consumers collapse that slot. While unset (first paint), consumers should
 * supply their own fallback via `var(--name, <fallback>)`.
 */
export function usePublishHeightVar(
  ref: RefObject<HTMLElement | null>,
  varName: string,
  enabled = true,
): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.style.setProperty(varName, '0px');
      return () => root.style.setProperty(varName, '0px');
    }
    let ro: ResizeObserver | null = null;
    let raf = 0;
    // The observed element may mount a tick AFTER this effect runs — e.g. when
    // it's rendered through ViewportPortal, which returns null until its own
    // mount effect flips. Retry on animation frames until ref.current exists so
    // the var doesn't get stuck at 0px (T1.8 — caught by Codex review). Bounded
    // (~60 frames ≈ 1s) so a node that never mounts can't spin rAF forever
    // (Codex re-review).
    let tries = 0;
    const MAX_TRIES = 60;
    const attach = () => {
      const el = ref.current;
      if (!el) {
        if (tries++ < MAX_TRIES) raf = requestAnimationFrame(attach);
        return;
      }
      const update = () => root.style.setProperty(varName, `${el.offsetHeight}px`);
      update();
      ro = new ResizeObserver(update);
      ro.observe(el);
    };
    attach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      root.style.setProperty(varName, '0px');
    };
  }, [ref, varName, enabled]);
}

/**
 * Pins a fixed, top-anchored element to the VISUAL viewport. On iOS the
 * software keyboard overlays the layout viewport and WebKit pans it —
 * position:fixed elements ride that pan and slide off-screen. Sizing the
 * element to visualViewport.height and translating by its offsetTop keeps
 * it glued to what the user can actually see (the FeedbackButton keyboard
 * fix, 2026-06-11, extracted for reuse).
 *
 * Pass the ELEMENT (from a callback ref via useState), not a RefObject —
 * portal-mounted elements appear a tick late and a plain-ref effect would
 * see null forever (the FeedbackButton/ViewportPortal gotcha). The pinned
 * element must be top-anchored with an explicit height class (e.g.
 * `fixed inset-x-0 top-0 h-[100dvh]`) — an explicit bottom edge would
 * fight the height override.
 */
export function useVisualViewportPin(el: HTMLElement | null, active = true): void {
  useEffect(() => {
    if (!el || !active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      el.style.height = '';
      el.style.transform = '';
    };
  }, [el, active]);
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

export function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef<number>(target);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const start = prevRef.current;
    prevRef.current = target;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || start === target) {
      setDisplay(target);
      return;
    }
    const ease = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      setDisplay(Math.round(start + (target - start) * ease(t)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return display;
}
