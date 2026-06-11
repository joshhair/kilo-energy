'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

/**
 * T1.5/T1.6 — "⋯" overflow menu separating destructive actions from browsing.
 *
 * Destructive/manage actions (convert role, deactivate, cancel, delete) used
 * to render as always-visible buttons directly beside navigation targets and
 * benign actions — a mis-tap hazard. This menu separates browsing from
 * committing: one neutral kebab trigger; the actions live one deliberate
 * click deeper and still hand off to the caller's ConfirmDialog flows. Used
 * on the Users list rows (T1.5) and the Project Detail header (T1.6).
 *
 * The dropdown renders via createPortal to <body> with position:fixed, so it
 * can't be clipped by row overflow and isn't affected by any animated wrapper
 * (T1.8). It opens downward, flipping upward when the trigger sits within
 * ~150px of the viewport bottom. Closes on outside press, Escape, resize, or
 * a scroll that actually MOVES the trigger (scroll events arrive async — a
 * pre-open scroll-into-view lands a frame after mount, so closing on every
 * scroll event would instantly self-close the menu).
 *
 * `trigger` customizes the kebab (e.g. a labeled header button); the default
 * is the compact w-7 icon used on list rows.
 */
export default function RowActionsMenu({
  ariaLabel,
  actions,
  trigger,
}: {
  ariaLabel: string;
  actions: {
    label: string;
    icon?: ComponentType<{ className?: string }>;
    danger?: boolean;
    onSelect: () => void;
  }[];
  trigger?: { className: string; children: React.ReactNode };
}) {
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Trigger's viewport position at open time. Scroll events compare against
  // this instead of closing unconditionally: the browser fires scroll ASYNC,
  // so a scroll that happened just BEFORE opening (auto scroll-into-view,
  // momentum settling, scroll anchoring) lands one frame AFTER the menu mounts
  // and would instantly self-close it. Only a scroll that actually MOVES the
  // trigger (menu now desynced from its anchor) closes the menu.
  const openedAtRef = useRef<{ x: number; y: number } | null>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onPress = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => {
      const at = openedAtRef.current;
      const r = triggerRef.current?.getBoundingClientRect();
      if (!at || !r) return close();
      if (Math.abs(r.left - at.x) > 2 || Math.abs(r.top - at.y) > 2) close();
    };
    document.addEventListener('mousedown', onPress);
    document.addEventListener('touchstart', onPress);
    document.addEventListener('keydown', onKey);
    // capture-phase so scrolls inside nested scroll containers are seen too
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPress);
      document.removeEventListener('touchstart', onPress);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    // Rows are <Link>s — never let the kebab tap navigate.
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setPos(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 150;
    openedAtRef.current = { x: r.left, y: r.top };
    setPos({
      top: up ? r.top - 6 : r.bottom + 6,
      right: window.innerWidth - r.right,
      up,
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggle}
        title={ariaLabel}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={trigger?.className ?? 'hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] transition-colors'}
      >
        {trigger?.children ?? <MoreVertical className="w-3.5 h-3.5" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={ariaLabel}
            className="fixed z-50 min-w-[200px] py-1.5 rounded-xl shadow-2xl"
            style={{
              top: pos.up ? undefined : pos.top,
              bottom: pos.up ? window.innerHeight - pos.top : undefined,
              right: pos.right,
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPos(null);
                  a.onSelect();
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]"
                style={{ color: a.danger ? 'var(--accent-red-text)' : 'var(--text-secondary)' }}
              >
                {a.icon && <a.icon className="w-4 h-4 shrink-0 opacity-70" />}
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
