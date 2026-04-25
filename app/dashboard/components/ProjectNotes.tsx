'use client';

/**
 * ProjectNotes — list of standalone notes on a project.
 *
 * Replaced the earlier single-textarea InlineNotesEditor that debounce-
 * saved one big string field. Each note is now its own row with author,
 * timestamp, and a delete button (own notes for anyone, any note for
 * admin). Used on desktop + mobile project detail.
 *
 * Data contract: GET/POST /api/projects/[id]/notes + DELETE
 * /api/projects/[id]/notes/[noteId]. Access enforced server-side —
 * vendor PMs inherit the installer-scope check via userCanAccessProject.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { Trash2, Loader2 } from 'lucide-react';

interface ProjectNote {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

/**
 * `kind` selects which endpoint + which polarity of note.
 *   - 'public' (default): /api/projects/[id]/notes  — visible to everyone with project access.
 *   - 'admin':            /api/projects/[id]/admin-notes — admin + internal PM only.
 * Same UI shell either way — just different backend routes.
 */
export function ProjectNotes({ projectId, kind = 'public' }: { projectId: string; kind?: 'public' | 'admin' }) {
  const { currentRepId, currentRole } = useApp();
  const { toast } = useToast();
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const basePath = kind === 'admin'
    ? `/api/projects/${projectId}/admin-notes`
    : `/api/projects/${projectId}/notes`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(basePath);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setNotes(data);
      }
    } finally {
      setLoading(false);
    }
  }, [basePath]);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await fetch(basePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const note = await res.json();
        setNotes((prev) => [note, ...prev]);
        setDraft('');
      } else {
        toast('Failed to add note', 'error');
      }
    } catch {
      toast('Failed to add note', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    const snapshot = notes;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      const res = await fetch(`${basePath}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setNotes(snapshot);
        toast('Failed to delete note', 'error');
      }
    } catch {
      setNotes(snapshot);
      toast('Failed to delete note', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = (note: ProjectNote) => currentRole === 'admin' || note.authorId === currentRepId;

  return (
    <div className="space-y-3">
      {/* Add note form */}
      <div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="Add a note…"
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-slate-500 resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-[var(--text-muted)]">{draft.length} / 5000 — ⌘/Ctrl+Enter to post</p>
          <button
            onClick={handleAdd}
            disabled={!draft.trim() || adding}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--surface-page)' }}
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Post note'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-[var(--text-dim)] py-4 text-center italic">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => {
            const deleting = deletingId === note.id;
            return (
              <li
                key={note.id}
                className="rounded-xl px-3 py-2.5 group/note bg-[var(--surface-card)]/50 border border-[var(--border-subtle)] transition-opacity"
                style={{ opacity: deleting ? 0.5 : 1 }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--accent-cyan-solid)]/20 text-[var(--accent-cyan-solid)] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {getInitials(note.authorName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-white text-sm font-semibold">{note.authorName}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{relativeTime(note.createdAt)}</span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-sm leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
                      {note.text}
                    </p>
                  </div>
                  {canDelete(note) && (
                    <button
                      onClick={() => handleDelete(note.id)}
                      disabled={deleting}
                      className="opacity-0 group-hover/note:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Delete note"
                      title="Delete note"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
