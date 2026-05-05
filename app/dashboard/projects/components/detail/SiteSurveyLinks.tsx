'use client';

/**
 * SiteSurveyLinks — external links (Drive folders, Dropbox, OneDrive)
 * where installer PMs upload site-survey photos and supporting docs.
 *
 * Audience: admin / internal PM / vendor PM scoped to this project's
 * installer. Reps NEVER see this section. Render-gating is the parent
 * page's responsibility.
 *
 * URL validation is server-side (HTTPS-only); the client surfaces the
 * server's rejection reason in a toast.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Link as LinkIcon, Plus, Trash2, ExternalLink } from 'lucide-react';
import { useToast } from '@/lib/toast';
import { TextInput, FormField, IconButton, PrimaryButton } from '@/components/ui';

interface SurveyLink {
  id: string;
  projectId: string;
  url: string;
  label: string;
  addedById: string;
  createdAt: string;
}

interface Props {
  projectId: string;
  canManage: boolean;
}

export function SiteSurveyLinks({ projectId, canManage }: Props) {
  const { toast } = useToast();
  const [links, setLinks] = useState<SurveyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/survey-links`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLinks((await res.json()) as SurveyLink[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load links');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const onAdd = async () => {
    if (!newUrl.trim() || !newLabel.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/survey-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), label: newLabel.trim() }),
      });
      const body = await res.json().catch(() => ({})) as SurveyLink & { error?: string };
      if (!res.ok) {
        toast(body.error || `Failed (${res.status})`, 'error');
        return;
      }
      setNewUrl('');
      setNewLabel('');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Add failed', 'error');
    } finally {
      setAdding(false);
    }
  };

  const onDelete = async (id: string, label: string) => {
    if (!confirm(`Delete link "${label}"?`)) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/survey-links/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  return (
    <div className="card-surface rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <LinkIcon className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Site Survey Links</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading links…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-[var(--accent-red-text)] py-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : (
        <>
          {links.length > 0 ? (
            <div className="space-y-1.5 mb-3">
              {links.map((l) => (
                <div key={l.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-lg px-3 py-2 group/link">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 min-w-0 hover:text-[var(--accent-cyan-text)] transition-colors"
                  >
                    <ExternalLink className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate font-medium">{l.label}</p>
                      <p className="text-[10px] text-[var(--text-muted)] truncate font-mono">{l.url}</p>
                    </div>
                  </a>
                  {canManage && (
                    <IconButton
                      aria-label={`Delete ${l.label}`}
                      variant="danger"
                      onClick={() => onDelete(l.id, l.label)}
                      className="ml-2 shrink-0 opacity-0 group-hover/link:opacity-100"
                    >
                      <Trash2 className="w-3 h-3" />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-dim)] py-2 mb-3">No links added yet.</p>
          )}

          {canManage && (
            <div className="space-y-2 border-t border-[var(--border-subtle)]/50 pt-3">
              <FormField label="Add link" hint="HTTPS URLs only.">
                <TextInput
                  placeholder="Label (e.g. Site Survey Photos)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </FormField>
              <div className="flex gap-2">
                <TextInput
                  type="text"
                  placeholder="https://drive.google.com/..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <PrimaryButton
                  size="sm"
                  disabled={!newUrl.trim() || !newLabel.trim() || adding}
                  loading={adding}
                  onClick={onAdd}
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </PrimaryButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
