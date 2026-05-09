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

  // Equipment = the physical product sold (panels, inverter, batteries),
  // not the financer or installer (those live in Project Details). When
  // there's no product info on the deal — common for legacy SolarTech
  // deals where productId wasn't captured at sale time — show an
  // explicit empty state instead of a half-populated card that made it
  // look like "Cash" was the equipment.
  const hasProductInfo = !!(data.productName || data.family);

  return (
    <div className="card-surface rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Equipment</p>
      </div>
      {!hasProductInfo ? (
        <p className="text-xs text-[var(--text-muted)] italic">
          Product details weren&apos;t recorded for this deal. (Common for older deals.) Edit the project to set the product.
        </p>
      ) : (
        // Always stack label-above-value, on every viewport. The previous
        // `flex justify-between sm:block` flipped to side-by-side on mobile,
        // which crammed long product names ("Hyundai/SEG 440 DC + P…") into
        // the same row as the label and overlapped them. Vertical stacking
        // is the rest-of-the-app pattern (see Project Details fields) and
        // gives `truncate` actual room to clip cleanly. Each <div> uses
        // min-w-0 so the truncate works inside the grid column.
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {data.family && (
            <div className="min-w-0">
              <dt className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Product family</dt>
              <dd className="text-[var(--text-primary)] font-medium break-words">{data.family}</dd>
            </div>
          )}
          {data.productName && (
            <div className="min-w-0">
              <dt className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Product</dt>
              <dd className="text-[var(--text-primary)] font-medium break-words">{data.productName}</dd>
            </div>
          )}
          {data.exportType && (
            <div className="min-w-0">
              <dt className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Export type</dt>
              <dd className="text-[var(--text-primary)] font-medium break-words">{data.exportType}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
