'use client';

/**
 * EquipmentSnapshot — non-sensitive product overview on the project page.
 *
 * Visible to all roles: shows the catalog selection (product family +
 * variant) plus the installer name. Pricing is intentionally NOT in the
 * response shape — see lib/serializers/equipment.ts for the firewall.
 *
 * Read-only display. The data shifts only when a project's catalog
 * selection changes, which is rare; we don't bother with realtime
 * updates beyond the initial fetch on mount.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Package } from 'lucide-react';
import type { EquipmentSnapshotResponse } from '@/lib/serializers/equipment';

interface Props {
  projectId: string;
}

export function EquipmentSnapshot({ projectId }: Props) {
  const [data, setData] = useState<EquipmentSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/equipment`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as EquipmentSnapshotResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load equipment');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="card-surface rounded-2xl p-5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading equipment…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-surface rounded-2xl p-5 flex items-center gap-2 text-xs text-[var(--accent-red-text)]">
        <AlertCircle className="w-3.5 h-3.5" /> {error}
      </div>
    );
  }

  if (!data) return null;

  const rows: Array<[string, string]> = [
    ['Installer', data.installerName],
    ['Financer', data.financerName],
    ...(data.family ? [['Product family', data.family] as [string, string]] : []),
    ...(data.productName ? [['Product', data.productName] as [string, string]] : []),
    ...(data.exportType ? [['Export type', data.exportType] as [string, string]] : []),
  ];

  return (
    <div className="card-surface rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Equipment</p>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between sm:block">
            <dt className="text-[var(--text-muted)] text-xs sm:mb-0.5">{label}</dt>
            <dd className="text-[var(--text-primary)] font-medium truncate">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
