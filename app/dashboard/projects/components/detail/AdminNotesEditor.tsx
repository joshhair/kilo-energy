'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield } from 'lucide-react';

/**
 * Admin-only notes editor for a project. Visible ONLY when rendered
 * inside an admin/PM gate — the component itself does not re-check
 * the role. Server-side, fieldVisibility.ts strips `adminNotes` from
 * rep/trainer/sub-dealer payloads so a mis-rendered component would
 * still see an empty / undefined initial value.
 *
 * Shape mirrors the rep-visible Notes editor: textarea with 1s
 * debounced autosave, blur-to-save, character counter.
 */
export function AdminNotesEditor({
  projectId: _projectId,
  initial,
  onPatch,
}: {
  projectId: string;
  initial: string;
  onPatch: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSynced = useRef(initial);

  // If the prop changes externally (e.g. another admin edited in the
  // Edit Project Modal), sync our textarea — but only if the local
  // admin isn't actively typing something different.
  useEffect(() => {
    if (initial !== lastSynced.current) {
      if (draft === lastSynced.current) setDraft(initial);
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      lastSynced.current = initial;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const flush = useCallback((value: string) => {
    if (value !== lastSynced.current) {
      onPatch(value);
      lastSynced.current = value;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [onPatch]);

  const onChange = (value: string) => {
    setDraft(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => flush(value), 1000);
  };

  const onBlur = () => {
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    flush(draft);
  };

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  return (
    <div className="card-surface rounded-2xl p-6 border border-amber-500/20"
         style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.04), rgba(245,158,11,0.02))' }}>
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-amber-400" />
        <h2 className="text-white font-semibold">Admin Notes</h2>
        <span className="text-[10px] text-amber-400/70 uppercase tracking-wider font-semibold ml-auto">Admin · PM only</span>
      </div>
      <p className="text-[var(--text-muted)] text-xs mb-3">
        Private reference notes. Never visible to reps, trainers, or sub-dealers.
      </p>
      <textarea
        rows={4}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="Admin-only context — handoff notes, customer quirks, commission exceptions, anything reps shouldn't see..."
        maxLength={2000}
        className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-500 resize-none"
      />
      <div className="flex items-center justify-between mt-1">
        <p className={`text-xs transition-colors duration-200 ${
          draft.length >= 1920 ? 'text-red-400' :
          draft.length >= 1600 ? 'text-amber-400' :
          'text-[var(--text-muted)]'
        }`}>{draft.length} / 2000</p>
        {saved && <span className="text-xs text-[var(--accent-green)] animate-fade-in-up">Saved</span>}
        {!saved && draft !== lastSynced.current && (
          <span className="text-xs text-[var(--text-muted)]">Auto-saving...</span>
        )}
      </div>
    </div>
  );
}
