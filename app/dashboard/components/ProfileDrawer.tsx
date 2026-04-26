'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LogOut, Mail, Phone, Eye, XCircle, Search, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../../../lib/use-theme';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  rep: 'Sales Rep',
  'sub-dealer': 'Sub-Dealer',
  project_manager: 'Project Manager',
};

export type MoreSheetItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export default function ProfileDrawer({
  open,
  onClose,
  items,
  onLogout,
  userName,
  userRole,
  userEmail,
  userPhone,
  isAdmin,
  allReps,
  allSubDealers,
  onViewAs,
  isViewingAs,
  viewAsName,
  onClearViewAs,
}: {
  open: boolean;
  onClose: () => void;
  items: MoreSheetItem[];
  onLogout?: () => void;
  userName: string;
  userRole: string;
  userEmail: string;
  userPhone: string;
  isAdmin?: boolean;
  allReps?: Array<{ id: string; name: string; active?: boolean }>;
  allSubDealers?: Array<{ id: string; name: string; active?: boolean }>;
  onViewAs?: (user: { id: string; name: string; role: 'rep' | 'sub-dealer' }) => void;
  isViewingAs?: boolean;
  viewAsName?: string;
  onClearViewAs?: () => void;
}) {
  const { preference: themePref, setPreference: setThemePref } = useTheme();
  const [viewAsSearch, setViewAsSearch] = useState('');
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [shouldRenderViewAs, setShouldRenderViewAs] = useState(false);
  const [isExitingViewAs, setIsExitingViewAs] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [isDragDismissing, setIsDragDismissing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef(0);
  const dragStartTime = useRef(0);
  const lastDragY = useRef(0);

  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [shouldRender, setShouldRender] = useState(open);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsExiting(false);
      setIsDragDismissing(false);
      setDragY(0);
    } else {
      setIsExiting(true);
      const t = setTimeout(() => { setShouldRender(false); setIsExiting(false); }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  useEffect(() => {
    if (viewAsOpen) {
      setShouldRenderViewAs(true);
      setIsExitingViewAs(false);
    } else {
      setIsExitingViewAs(true);
      const t = setTimeout(() => { setShouldRenderViewAs(false); setIsExitingViewAs(false); }, 180);
      return () => clearTimeout(t);
    }
  }, [viewAsOpen]);

  if (!shouldRender) return null;

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] md:hidden"
        style={{
          background: `rgba(0,0,0,${Math.max(0, 0.6 * (1 - dragY / 180))})`,
          animation: dragY > 0 ? 'none' : (isExiting ? 'fadeOut 0.22s ease forwards' : 'fadeIn 0.2s ease'),
        }}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className="fixed left-0 right-0 bottom-0 z-[70] md:hidden"
        style={{
          background: 'var(--surface-mobile-card)',
          borderTop: '1px solid var(--border-mobile)',
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          animation: (dragY > 0 || isDragDismissing) ? 'none' : (isExiting ? 'slideDown 0.28s cubic-bezier(0.4, 0, 1, 1) forwards' : 'slideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1) both'),
          maxHeight: '80vh',
          overflowY: 'auto',
          transform: `translateY(${dragY}px)`,
          transition: dragging
            ? 'none'
            : isDragDismissing
            ? 'transform 260ms cubic-bezier(0.4, 0, 1, 1)'
            : 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onPointerDown={(e) => {
          setDragging(true);
          dragStartY.current = e.clientY;
          dragStartTime.current = performance.now();
          lastDragY.current = 0;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const delta = Math.max(0, e.clientY - dragStartY.current);
          lastDragY.current = delta;
          setDragY(delta);
        }}
        onPointerUp={() => {
          setDragging(false);
          const elapsed = Math.max(1, performance.now() - dragStartTime.current);
          const velocity = lastDragY.current / elapsed * 1000;
          if (lastDragY.current > 110 || velocity > 450) {
            setIsDragDismissing(true);
            setDragY(window.innerHeight);
            onClose();
          } else {
            setDragY(0);
          }
        }}
        onPointerCancel={() => { setDragging(false); setDragY(0); }}
      >
        {/* Handle bar */}
        <div
          className="flex justify-center py-4 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <div
            className={`h-1 rounded-full ${dragY > 20 ? 'w-12' : 'w-10'}`}
            style={{
              background: dragY > 20 ? '#2a3860' : 'var(--border-mobile)',
              transition: 'background 120ms ease, width 120ms ease',
            }}
          />
        </div>

        {/* Profile header */}
        <div className="px-6 pb-4" style={{ borderBottom: '1px solid var(--border-mobile)' }}>
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--accent-emerald-solid) 0%, var(--accent-cyan-solid) 100%)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '1.2rem',
                fontWeight: 700,
                color: '#000',
              }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-[var(--text-primary)] truncate" style={{ fontFamily: "'DM Sans', sans-serif" }}>{userName}</p>
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1"
                style={{
                  background: 'color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)',
                  color: 'var(--accent-emerald-text)',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {ROLE_LABELS[userRole] || userRole}
              </span>
            </div>
          </div>
          {/* Contact info */}
          {(userEmail || userPhone) && (
            <div className="mt-3 space-y-1.5">
              {userEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" style={{ color: 'var(--text-mobile-muted)' }} />
                  <span className="text-sm truncate" style={{ color: 'var(--text-mobile-muted)', fontFamily: "'DM Sans', sans-serif" }}>{userEmail}</span>
                </div>
              )}
              {userPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5" style={{ color: 'var(--text-mobile-muted)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-mobile-muted)', fontFamily: "'DM Sans', sans-serif" }}>{userPhone}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav items */}
        {items.length > 0 && (
          <div className="px-2 py-2">
            {items.map(({ href, label, icon: Icon }, index) => (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className="flex items-center gap-3 min-h-[48px] px-4 py-3 rounded-xl active:scale-[0.97] active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[transform,background-color] duration-[75ms]"
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '1rem',
                  WebkitTapHighlightColor: 'transparent',
                  animation: !isExiting && !reduceMotion
                    ? `itemFadeUp 220ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 45}ms both`
                    : 'none',
                }}
              >
                <span style={{ color: 'var(--text-mobile-muted)' }}><Icon className="w-5 h-5" /></span>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        )}

        {/* View As (admin only) */}
        {isAdmin && onViewAs && (
          <div className="px-2 py-2" style={{ borderTop: '1px solid var(--border-mobile)' }}>
            {isViewingAs && viewAsName && onClearViewAs ? (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4" style={{ color: 'var(--accent-amber-text)' }} />
                  <span className="text-sm" style={{ color: 'var(--accent-amber-text)', fontFamily: "'DM Sans', sans-serif" }}>
                    Viewing as <span className="text-[var(--text-primary)] font-semibold">{viewAsName}</span>
                  </span>
                </div>
                <button
                  onClick={() => { onClearViewAs(); onClose(); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-2.5 rounded-xl min-h-[44px] active:scale-[0.94] active:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] transition-[transform,background-color] duration-75"
                  style={{ color: 'var(--accent-amber-text)', WebkitTapHighlightColor: 'transparent' }}
                >
                  <XCircle className="w-4 h-4" /> Exit
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setViewAsOpen(!viewAsOpen)}
                  className="flex items-center gap-3 w-full min-h-[48px] px-4 py-3 rounded-xl active:scale-[0.97] active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[transform,background-color] duration-[75ms]"
                  style={{ color: 'var(--text-mobile-muted)', fontFamily: "'DM Sans', sans-serif", fontSize: '1rem', WebkitTapHighlightColor: 'transparent', animation: !isExiting && !reduceMotion ? `itemFadeUp 220ms cubic-bezier(0.16, 1, 0.3, 1) ${items.length * 45}ms both` : 'none' }}
                >
                  <Eye className="w-5 h-5" />
                  <span>View As Rep...</span>
                </button>
                {shouldRenderViewAs && (
                  <div className="mx-2 mb-2 rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border-mobile)', transformOrigin: 'top center', animation: reduceMotion ? 'none' : (isExitingViewAs ? 'viewAsCollapse 160ms cubic-bezier(0.4, 0, 1, 1) both' : 'viewAsExpand 220ms cubic-bezier(0.16, 1, 0.3, 1) both') }}>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-mobile-muted)' }} />
                      <input
                        autoFocus
                        value={viewAsSearch}
                        onChange={(e) => setViewAsSearch(e.target.value)}
                        placeholder="Search reps..."
                        className="w-full bg-transparent pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                        style={{ borderBottom: '1px solid var(--border-mobile)', fontFamily: "'DM Sans', sans-serif" }}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {[...(allReps || []).filter(r => r.active !== false).map(r => ({ ...r, role: 'rep' as const })), ...(allSubDealers || []).filter(sd => sd.active !== false).map(sd => ({ ...sd, role: 'sub-dealer' as const }))]
                        .filter(u => !viewAsSearch.trim() || u.name.toLowerCase().includes(viewAsSearch.toLowerCase()))
                        .map(u => (
                          <button
                            key={u.id}
                            onClick={() => { onViewAs(u); setViewAsOpen(false); setViewAsSearch(''); onClose(); }}
                            className="w-full text-left px-4 py-3 text-sm text-[var(--text-primary)] active:scale-[0.97] active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[transform,background-color] duration-[75ms] flex items-center justify-between"
                            style={{ borderBottom: '1px solid var(--border-mobile)', fontFamily: "'DM Sans', sans-serif", WebkitTapHighlightColor: 'transparent' }}
                          >
                            <span>{u.name}</span>
                            <span className="text-xs capitalize" style={{ color: 'var(--text-mobile-muted)' }}>{u.role}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Theme switcher — every role can flip System/Dark/Light from here.
            Reps don't have access to the Settings page, so this is their
            only entry point. Inline 3-button group so it's tap-once. */}
        <div className="px-4 pt-3 pb-1" style={{ borderTop: '1px solid var(--border-mobile)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>Appearance</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: 'system', label: 'System', icon: Monitor },
              { value: 'dark',   label: 'Dark',   icon: Moon },
              { value: 'light',  label: 'Light',  icon: Sun },
            ] as Array<{ value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }>).map(({ value, label, icon: Icon }) => {
              const active = themePref === value;
              return (
                <button
                  key={value}
                  onClick={() => setThemePref(value)}
                  aria-pressed={active}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-lg transition-colors min-h-[56px]"
                  style={{
                    background: active ? 'var(--accent-emerald-soft)' : 'var(--surface-pressed)',
                    border: active ? '1px solid var(--accent-emerald-solid)' : '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontFamily: "'DM Sans', sans-serif",
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color: active ? 'var(--accent-emerald-text)' : 'var(--text-muted)' }} />
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sign Out */}
        {onLogout && (
          <div className="px-2 pt-1" style={{ borderTop: '1px solid var(--border-mobile)' }}>
            <button
              onClick={() => { onClose(); onLogout(); }}
              className="flex items-center gap-3 w-full min-h-[48px] px-4 py-3 rounded-xl active:scale-[0.97] active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[transform,background-color] duration-[75ms]"
              style={{
                color: 'var(--accent-red-text)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '1rem',
                WebkitTapHighlightColor: 'transparent',
                animation: !isExiting && !reduceMotion ? `itemFadeUp 220ms cubic-bezier(0.16, 1, 0.3, 1) ${(items.length + 1) * 45}ms both` : 'none',
              }}
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
