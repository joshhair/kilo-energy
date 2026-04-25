'use client';

/**
 * InlineNotesEditor — click-to-edit textarea with debounced autosave.
 *
 * Behavior:
 *   - Idle: shows the notes as static text (or placeholder if empty).
 *   - Click / Enter / Space: enters edit mode with an auto-focused textarea.
 *   - Typing: autosave fires 1s after the last keystroke.
 *   - Blur: flushes pending debounced save + exits edit mode.
 *
 * Extracted from projects/[id]/page.tsx as part of A+ Phase 1.1.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil } from 'lucide-react';

export function InlineNotesEditor({ notes, onSave }: { notes: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync external changes
  useEffect(() => { setText(notes); }, [notes]);

  const doSave = useCallback((value: string) => {
    if (value !== notes) {
      onSave(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [notes, onSave]);

  const handleChange = (value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(value), 1000);
  };

  const handleBlur = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    doSave(text);
    setEditing(false);
  };

  if (editing) {
    return (
      <div>
        <textarea
          ref={textareaRef}
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          maxLength={1000}
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-slate-500 resize-none"
          placeholder="Add notes about this project..."
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-[var(--text-muted)]">{text.length} / 1000</p>
          {saved && <span className="text-xs text-[var(--accent-emerald-solid)] animate-fade-in-up">Saved</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/notes cursor-pointer rounded-lg px-3 py-2 -mx-3 -my-2 hover:bg-[var(--surface-card)]/40 transition-colors"
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true); } }}
    >
      <div className="flex items-start gap-2">
        {notes ? (
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed flex-1">{notes}</p>
        ) : (
          <p className="text-[var(--text-dim)] text-sm italic flex-1">Click to add notes...</p>
        )}
        <Pencil className="w-3.5 h-3.5 text-[var(--text-dim)] opacity-0 group-hover/notes:opacity-100 transition-opacity shrink-0 mt-0.5" />
      </div>
      {saved && <span className="text-xs text-[var(--accent-emerald-solid)] mt-1 block">Saved</span>}
    </div>
  );
}
