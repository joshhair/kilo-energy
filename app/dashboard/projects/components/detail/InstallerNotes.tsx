'use client';

/**
 * InstallerNotes — per-project notes scoped to the installer-handoff
 * audience (admin / internal PM / vendor PM scoped to project's installer).
 *
 * Distinct from ProjectNotes (rep-visible) and ProjectAdminNote (admin-
 * only). This is where BVI's vendor PM leaves "scheduled site survey
 * for Tuesday" status updates that the rep doesn't need to see.
 *
 * Authorship rule (server-enforced):
 *   - admin / internal PM: edit/delete any note
 *   - vendor PM: edit/delete only own notes
 *
 * Render-gating (whether the section appears at all) is the parent's
 * responsibility — this component assumes the audience is correct.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, MessageSquare, Send, Trash2, Pencil, Check, X } from 'lucide-react';
import { useToast } from '@/lib/toast';
import { useApp } from '@/lib/context';
import { IconButton, PrimaryButton, SecondaryButton } from '@/components/ui';

interface InstallerNote {
  id: string;
  projectId: string;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  projectId: string;
  /** True if the viewer can manage at all (admin/PM/vendor-PM-of-installer). */
  canManage: boolean;
}

export function InstallerNotes({ projectId, canManage }: Props) {
  const { toast } = useToast();
  const { effectiveRepId, effectiveRole } = useApp();
  const [notes, setNotes] = useState<InstallerNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const refresh = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/installer-notes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes((await res.json()) as InstallerNote[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const onAdd = async () => {
    if (!body.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/installer-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as InstallerNote & { error?: string };
      if (!res.ok) {
        toast(data.error || `Failed (${res.status})`, 'error');
        return;
      }
      setBody('');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add note', 'error');
    } finally {
      setAdding(false);
    }
  };

  const onSaveEdit = async (id: string) => {
    if (!editBody.trim()) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/installer-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editBody.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as InstallerNote & { error?: string };
      if (!res.ok) {
        toast(data.error || `Failed (${res.status})`, 'error');
        return;
      }
      setEditingId(null);
      setEditBody('');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Edit failed', 'error');
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this note?')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/installer-notes/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(data.error || `Failed (${res.status})`, 'error');
        return;
      }
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  // Per-row mutation rule: admin / internal PM (no scope) can mutate any.
  // Vendor PM (scope set) can only mutate own. Mirrors the server-side
  // canMutate() in installer-notes route.
  const canMutateRow = (authorId: string): boolean => {
    if (!canManage) return false;
    if (effectiveRole === 'admin') return true;
    // For client purposes, internal-PM detection isn't reliable (allowlist
    // is server-side). Treat all PMs the same client-side: own-row mutate
    // only. Server still allows internal PM to mutate any — the UI just
    // hides the buttons for them when the authorId differs. Conservative.
    return authorId === effectiveRepId;
  };

  return (
    <div className="card-surface rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Installer Notes</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading notes…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-[var(--accent-red-text)] py-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : (
        <>
          {notes.length > 0 ? (
            <div className="space-y-2 mb-3">
              {notes.map((n) => {
                const editing = editingId === n.id;
                const mutable = canMutateRow(n.authorId);
                return (
                  <div key={n.id} className="bg-[var(--surface-card)]/50 rounded-lg px-3 py-2 group/note">
                    {editing ? (
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
                          autoFocus
                        />
                        <div className="flex items-center gap-1 justify-end">
                          <IconButton
                            aria-label="Cancel edit"
                            onClick={() => { setEditingId(null); setEditBody(''); }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </IconButton>
                          <IconButton
                            aria-label="Save edit"
                            variant="success"
                            onClick={() => void onSaveEdit(n.id)}
                            disabled={!editBody.trim()}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </IconButton>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{n.body}</p>
                          <p className="text-[10px] text-[var(--text-muted)] mt-1">
                            {new Date(n.createdAt).toLocaleString()}
                            {n.updatedAt !== n.createdAt && ' · edited'}
                          </p>
                        </div>
                        {mutable && (
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/note:opacity-100 transition-opacity">
                            <IconButton
                              aria-label="Edit note"
                              onClick={() => { setEditingId(n.id); setEditBody(n.body); }}
                            >
                              <Pencil className="w-3 h-3" />
                            </IconButton>
                            <IconButton
                              aria-label="Delete note"
                              variant="danger"
                              onClick={() => void onDelete(n.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </IconButton>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-dim)] py-2 mb-3">No notes yet.</p>
          )}

          {canManage && (
            <div className="border-t border-[var(--border-subtle)]/50 pt-3">
              <textarea
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add an installer note (visible to admin + scoped PMs only)"
                className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)] transition-colors mb-2"
              />
              <div className="flex justify-end gap-2">
                {body.trim() !== '' && (
                  <SecondaryButton size="sm" onClick={() => setBody('')}>Clear</SecondaryButton>
                )}
                <PrimaryButton
                  size="sm"
                  disabled={!body.trim() || adding}
                  loading={adding}
                  onClick={onAdd}
                >
                  <Send className="w-3 h-3" /> Add Note
                </PrimaryButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
