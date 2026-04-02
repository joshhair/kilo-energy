'use client';

/**
 * CommandPalette — ⌘K / Ctrl+K quick-navigation overlay.
 *
 * Features
 * ─────────
 * • Opens on ⌘K (Mac) / Ctrl+K (Windows / Linux); same chord toggles closed.
 * • Backdrop: bg-black/60, backdrop-blur-sm, animate-modal-backdrop.
 * • Panel: animate-modal-panel, rounded-2xl, bg-slate-900.
 * • Auto-focused search input — text-lg, bg-transparent, no border.
 * • Results grouped by category when idle; flat + highlighted when filtering.
 * • Arrow-key navigation (wraps around), Enter navigates, Esc closes.
 * • Right-aligned keyboard hints per row.
 * • All role-appropriate nav pages + "New Deal" and "Search Projects" quick actions.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, PlusCircle, X, Keyboard } from 'lucide-react';
import { REP_NAV, ADMIN_NAV, SUB_DEALER_NAV } from './nav-items';
import type { AnyNavItem, NavItem } from './nav-items';

// ─── Internal types ───────────────────────────────────────────────────────────

type PaletteItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  category: string;
  hint?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Flatten nav groups to a plain NavItem array. */
function flattenNav(items: AnyNavItem[]): NavItem[] {
  return items.flatMap((item) =>
    'type' in item && item.type === 'group' ? item.children : [item as NavItem],
  );
}

/** Render text with query matches highlighted. */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <span key={i} className="bg-blue-500/30 text-white rounded-sm px-0.5">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Styled keyboard hint pill. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono text-[10px] text-slate-500 bg-slate-800 border border-slate-700/80 rounded px-1.5 py-0.5 leading-none">
      {children}
    </kbd>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS: PaletteItem[] = [
  {
    id: 'qa-new-deal',
    label: 'New Deal',
    icon: PlusCircle,
    href: '/dashboard/new-deal',
    category: 'Quick Actions',
    hint: '⌘N',
  },
  {
    id: 'qa-search-projects',
    label: 'Search Projects',
    icon: Search,
    href: '/dashboard/projects?tab=all',
    category: 'Quick Actions',
    hint: '⌘F',
  },
];

// Exact hrefs covered by quick actions without query strings — these get
// deduplicated from the Pages section so they don't appear twice.
const QA_EXACT_HREFS = new Set(
  QUICK_ACTIONS.filter((qa) => !qa.href.includes('?')).map((qa) => qa.href),
);

// ─── PaletteRow ───────────────────────────────────────────────────────────────

interface PaletteRowProps {
  item: PaletteItem;
  isActive: boolean;
  query: string;
  nodeRef?: React.RefCallback<HTMLButtonElement>;
  onMouseEnter: () => void;
  onClick: () => void;
}

function PaletteRow({ item, isActive, query, nodeRef, onMouseEnter, onClick }: PaletteRowProps) {
  const Icon = item.icon;
  return (
    <button
      ref={nodeRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={[
        'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
        isActive ? 'bg-blue-500/10 text-white' : 'text-slate-300 hover:text-white',
      ].join(' ')}
    >
      {/* Icon badge */}
      <div
        className={[
          'flex-shrink-0 p-1.5 rounded-lg transition-colors',
          isActive ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-400',
        ].join(' ')}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>

      {/* Label with optional highlight */}
      <span className="flex-1 text-sm font-medium truncate">
        <HighlightText text={item.label} query={query} />
      </span>

      {/* Right-aligned keyboard hints */}
      <span className="flex items-center gap-1 flex-shrink-0">
        {item.hint && <Kbd>{item.hint}</Kbd>}
        {isActive && <Kbd>↵</Kbd>}
      </span>
    </button>
  );
}

// ─── ShortcutsOverlay data ────────────────────────────────────────────────────

const SHORTCUT_GROUPS: Array<{
  label: string;
  shortcuts: Array<{ key: string; description: string }>;
}> = [
  {
    label: 'Global',
    shortcuts: [
      { key: 'N', description: 'New Deal' },
      { key: 'P', description: 'Projects' },
      { key: 'E', description: 'Earnings' },
      { key: 'D', description: 'Dashboard' },
      { key: '\u2318K', description: 'Command palette' },
      { key: '?', description: 'Keyboard shortcuts' },
    ],
  },
  {
    label: 'Tables',
    shortcuts: [
      { key: '\u2191\u2193', description: 'Navigate rows' },
      { key: '\u21B5', description: 'Open selected' },
      { key: 'Esc', description: 'Deselect' },
    ],
  },
  {
    label: 'Deal Form',
    shortcuts: [
      { key: '\u2318\u21B5', description: 'Submit form' },
    ],
  },
  {
    label: 'Payroll',
    shortcuts: [
      { key: 'Esc', description: 'Clear selection' },
      { key: '\u21B5', description: 'Mark for payroll' },
      { key: 'Shift+A', description: 'Select / deselect all' },
    ],
  },
];

// ─── CommandPalette ───────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  /** Whether the palette is currently visible. */
  open: boolean;
  /** Called when the ⌘K shortcut fires while the palette is closed. */
  onOpen: () => void;
  /** Called when the palette should close (Esc, backdrop click, item selection). */
  onClose: () => void;
  /** Current user role — determines which nav pages are shown. */
  role: 'rep' | 'admin' | 'sub-dealer' | null;
}

export function CommandPalette({ open, onOpen, onClose, role }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // ── Reset state when the palette transitions from closed → open ───────────
  // Using the "store previous prop" render-time pattern (React docs recommended
  // alternative to useEffect + setState for responding to prop changes).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }

  // ── Build full item list ──────────────────────────────────────────────────

  const allItems = useMemo((): PaletteItem[] => {
    const navSource = role === 'admin' ? ADMIN_NAV : role === 'sub-dealer' ? SUB_DEALER_NAV : REP_NAV;
    const pages: PaletteItem[] = flattenNav(navSource)
      .filter((item) => !QA_EXACT_HREFS.has(item.href)) // deduplicate
      .map((item) => ({
        id: `page-${item.href}`,
        label: item.label,
        icon: item.icon,
        href: item.href,
        category: 'Pages',
      }));

    return [...QUICK_ACTIONS, ...pages];
  }, [role]);

  // ── Filtered items ────────────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [allItems, query]);

  // ── Side-effects ──────────────────────────────────────────────────────────

  // Focus input when palette opens (pure DOM side-effect — no setState here)
  useEffect(() => {
    if (open) {
      const tid = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(tid);
    }
  }, [open]);

  // Scroll active row into view
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // ── Navigation helper ─────────────────────────────────────────────────────

  const navigate = useCallback(
    (item: PaletteItem) => {
      router.push(item.href);
      onClose();
    },
    [router, onClose],
  );

  // ── Keyboard handler (registered globally) ────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K — toggle palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        open ? onClose() : onOpen();
        return;
      }

      if (!open) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) =>
            filteredItems.length === 0 ? 0 : (i + 1) % filteredItems.length,
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) =>
            filteredItems.length === 0
              ? 0
              : (i - 1 + filteredItems.length) % filteredItems.length,
          );
          break;

        case 'Enter': {
          e.preventDefault();
          const item = filteredItems[activeIndex];
          if (item) navigate(item);
          break;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpen, onClose, filteredItems, activeIndex, navigate]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null;

  const showGrouped = !query.trim();
  const categories = showGrouped
    ? Array.from(new Set(filteredItems.map((i) => i.category)))
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-black/60 backdrop-blur-sm animate-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Panel */}
      <div className="w-full max-w-xl animate-modal-panel">
        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

          {/* Search input ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-700/60">
            <Search className="w-5 h-5 text-slate-400 flex-shrink-0" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
              placeholder="Jump to page…"
              className="flex-1 bg-transparent text-lg text-white placeholder:text-slate-500 outline-none border-none"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search pages"
            />
            <button
              onClick={onClose}
              className="flex-shrink-0 text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
              aria-label="Close command palette"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results ──────────────────────────────────────────────────────── */}
          <div className="max-h-[360px] overflow-y-auto py-1.5" role="listbox">
            {filteredItems.length === 0 ? (
              <p className="px-4 py-10 text-center text-slate-500 text-sm">
                No pages match &ldquo;{query}&rdquo;
              </p>
            ) : showGrouped ? (
              /* Grouped display when there is no active query */
              categories!.map((category) => {
                const categoryItems = filteredItems.filter((i) => i.category === category);
                return (
                  <div key={category}>
                    <div className="px-3 pt-3 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                        {category}
                      </span>
                    </div>
                    {categoryItems.map((item) => {
                      const globalIdx = filteredItems.indexOf(item);
                      return (
                        <PaletteRow
                          key={item.id}
                          item={item}
                          isActive={globalIdx === activeIndex}
                          query=""
                          nodeRef={(el) => { itemRefs.current[globalIdx] = el; }}
                          onMouseEnter={() => setActiveIndex(globalIdx)}
                          onClick={() => navigate(item)}
                        />
                      );
                    })}
                  </div>
                );
              })
            ) : (
              /* Flat list with highlighted matches while filtering */
              filteredItems.map((item, idx) => (
                <PaletteRow
                  key={item.id}
                  item={item}
                  isActive={idx === activeIndex}
                  query={query}
                  nodeRef={(el) => { itemRefs.current[idx] = el; }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => navigate(item)}
                />
              ))
            )}
          </div>

          {/* Footer legend ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-700/60 bg-slate-950/40">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <Kbd>↑↓</Kbd>navigate
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <Kbd>↵</Kbd>go
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <Kbd>esc</Kbd>close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ShortcutsOverlay ─────────────────────────────────────────────────────────

export interface ShortcutsOverlayProps {
  /** Whether the overlay is currently visible. */
  open: boolean;
  /** Called when the '?' shortcut fires while the overlay is closed. */
  onOpen: () => void;
  /** Called when the overlay should close (Esc, backdrop click, button). */
  onClose: () => void;
  /**
   * Pass true when another modal (e.g. command palette) is already open so
   * the '?' key handler stands down.
   */
  paletteOpen?: boolean;
}

export function ShortcutsOverlay({
  open,
  onOpen,
  onClose,
  paletteOpen = false,
}: ShortcutsOverlayProps) {

  // ── '?' keyboard trigger ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      // Ignore when palette (or any other modal) is already open.
      if (paletteOpen) return;
      // Ignore when an interactive element holds focus.
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;
      e.preventDefault();
      open ? onClose() : onOpen();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpen, onClose, paletteOpen]);

  // ── Esc to close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-black/60 backdrop-blur-sm animate-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="w-full max-w-md animate-modal-panel">
        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

          {/* Header ────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/60">
            <Keyboard className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden />
            <h2 className="flex-1 text-white text-sm font-semibold">Keyboard Shortcuts</h2>
            <button
              onClick={onClose}
              className="flex-shrink-0 text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
              aria-label="Close keyboard shortcuts"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Shortcut groups ────────────────────────────────────────────────── */}
          <div className="divide-y divide-slate-700/40">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.label} className="px-5 py-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2.5">
                  {group.label}
                </p>
                <ul className="space-y-2">
                  {group.shortcuts.map(({ key, description }) => (
                    <li key={key} className="flex items-center justify-between gap-4">
                      <span className="text-sm text-slate-300">{description}</span>
                      <Kbd>{key}</Kbd>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Footer ─────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 px-5 py-2.5 border-t border-slate-700/60 bg-slate-950/40">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <Kbd>esc</Kbd>close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
