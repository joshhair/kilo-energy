'use client';

/**
 * InstallerFiles — list of installer-handoff files attached to a project.
 *
 * Displayed only when the viewer is admin / internal PM / vendor PM
 * scoped to this project's installer. Reps NEVER see this section.
 * The parent page is responsible for gating the render — this component
 * assumes the audience is correct and lets the server's privacy gate
 * be the load-bearing enforcement.
 *
 * Display order: most recent first. Each row links to the gated
 * download proxy at /api/projects/[id]/files/[fileId]/download which
 * 302-redirects to the underlying blob (after audit-logging the access).
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, FileText, Download, Trash2, Upload } from 'lucide-react';
import { useToast } from '@/lib/toast';
import { IconButton, SecondaryButton } from '@/components/ui';

interface ProjectFile {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

interface Props {
  projectId: string;
  /** Whether the current viewer can mutate (admin/PM only — vendor PMs can also). */
  canManage: boolean;
}

const KIND_LABEL: Record<string, string> = {
  utility_bill: 'Utility bill',
  permit: 'Permit',
  plan: 'Plan',
  inspection: 'Inspection',
  as_built: 'As-built',
  other: 'Other',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function InstallerFiles({ projectId, canManage }: Props) {
  const { toast } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFiles((await res.json()) as ProjectFile[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'other');
      fd.append('label', file.name);
      const res = await fetch(`/api/projects/${projectId}/files`, { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      toast(`Uploaded ${file.name}`, 'success');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (fileId: string, label: string) => {
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('File deleted', 'success');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  return (
    <div className="card-surface rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Installer Files</p>
        </div>
        {canManage && (
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading files…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-[var(--accent-red-text)] py-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : files.length === 0 ? (
        <p className="text-xs text-[var(--text-dim)] py-2">No files uploaded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-lg px-3 py-2 group/file">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate font-medium">{f.label}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {KIND_LABEL[f.kind] ?? f.kind} · {formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2 shrink-0 opacity-0 group-hover/file:opacity-100 transition-opacity">
                <SecondaryButton
                  size="sm"
                  onClick={() => window.open(`/api/projects/${projectId}/files/${f.id}/download`, '_blank', 'noopener')}
                >
                  <Download className="w-3 h-3" /> Download
                </SecondaryButton>
                {canManage && (
                  <IconButton
                    aria-label={`Delete ${f.label}`}
                    variant="danger"
                    onClick={() => onDelete(f.id, f.label)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
