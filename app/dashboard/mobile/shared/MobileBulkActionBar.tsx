'use client';

import { useState } from 'react';
import { EyeOff, Eye, X } from 'lucide-react';

interface MobileBulkActionBarProps {
  selectedCount: number;
  activeCount: number;
  archivedCount: number;
  onArchive: () => void;
  onRestore: () => void;
  onDismiss: () => void;
}

const BAB_KEYFRAMES = `
  @keyframes bab-enter { from { transform: translateX(-50%) translateY(22px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
  @keyframes bab-exit  { from { transform: translateX(-50%) translateY(0);   opacity: 1; } to { transform: translateX(-50%) translateY(22px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .bab-root { animation: none !important; } }
`;

export default function MobileBulkActionBar({
  selectedCount,
  activeCount,
  archivedCount,
  onArchive,
  onRestore,
  onDismiss,
}: MobileBulkActionBarProps) {
  const [leaving, setLeaving] = useState(false);

  function withExit(cb: () => void) {
    setLeaving(true);
    setTimeout(cb, 220);
  }

  return (
    <>
      <style>{BAB_KEYFRAMES}</style>
      <div
        className="bab-root fixed bottom-28 left-1/2 z-30 backdrop-blur-xl rounded-2xl px-5 py-3 shadow-2xl"
        style={{
          animation: leaving
            ? 'bab-exit 200ms cubic-bezier(0.55, 0, 1, 0.45) both'
            : 'bab-enter 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
          background: 'color-mix(in srgb, var(--surface-card) 90%, transparent)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm select-none"
            style={{
              background: 'var(--accent-emerald-soft)',
              border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)',
            }}
          >
            <span className="font-bold text-[var(--text-primary)] tabular-nums">{selectedCount}</span>
            <span className="font-medium" style={{ color: 'var(--accent-emerald-solid)' }}>selected</span>
          </span>
          <div className="w-px h-5 shrink-0" style={{ background: 'var(--border-subtle)' }} />
          {activeCount > 0 && (
            <button
              onClick={() => withExit(onArchive)}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-xl active:scale-[0.92] transition-transform duration-[280ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] whitespace-nowrap"
              style={{ background: 'var(--accent-amber-solid)', color: 'var(--text-on-accent)' }}
            >
              <EyeOff className="w-3.5 h-3.5" /> Archive
            </button>
          )}
          {archivedCount > 0 && (
            <button
              onClick={() => withExit(onRestore)}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-xl active:scale-[0.92] transition-transform duration-[280ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'black' }}
            >
              <Eye className="w-3.5 h-3.5" /> Restore
            </button>
          )}
          <button
            onClick={() => withExit(onDismiss)}
            className="p-1.5 rounded-lg active:scale-[0.82] transition-transform duration-[250ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
            style={{ background: 'var(--border-subtle)', color: 'var(--text-muted)' }}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
