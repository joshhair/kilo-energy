'use client';

import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'kilo-theme';

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'system';
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'dark' || pref === 'light') return pref;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('dark');

  useEffect(() => {
    const pref = readPreference();
    setPreferenceState(pref);
    setResolved(resolve(pref));
  }, []);

  // When preference is "system", react to OS-level theme changes live.
  useEffect(() => {
    if (preference !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      const next = mq.matches ? 'light' : 'dark';
      setResolved(next);
      apply(next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    const r = resolve(next);
    setResolved(r);
    apply(r);
  }, []);

  return { preference, resolved, setPreference };
}

/**
 * The blocking script written into <head>. Runs before any React hydration
 * and applies data-theme to <html> based on localStorage / prefers-color-scheme.
 * Without this the page flashes the wrong theme on first paint.
 *
 * This must stay tiny and dependency-free — it's inlined as a string.
 */
export const THEME_BOOT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var pref = (stored === 'dark' || stored === 'light' || stored === 'system') ? stored : 'system';
    var resolved = pref;
    if (pref === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (_e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`.trim();
