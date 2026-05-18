'use client';

/**
 * Mobile blitz-detail tab strip. Sticky, glass-blurred container with
 * the shared SegmentedPills inside. Surfaces a pending-request badge on
 * the participant tab so leaders can see waiting joins without opening
 * that tab.
 */

import { SegmentedPills } from '../../../../components/ui';

export type BlitzTabKey = 'overview' | 'participants' | 'deals' | 'costs' | 'profitability';

export interface BlitzTab {
  key: BlitzTabKey;
  label: string;
  /** Optional pending count surfaced as a badge next to the label. */
  pendingBadge?: number;
}

interface Props {
  tabs: BlitzTab[];
  active: BlitzTabKey;
  onChange: (key: BlitzTabKey) => void;
}

export default function BlitzTabs({ tabs, active, onChange }: Props) {
  return (
    <div
      className="sticky z-20 -mx-5 px-5 pt-2"
      style={{
        top: 0,
        background: 'color-mix(in srgb, var(--surface-page) 88%, transparent)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '8px',
      }}
    >
      <SegmentedPills<BlitzTabKey>
        options={tabs.map((t) => ({
          value: t.key,
          label: t.label,
          badge: t.pendingBadge !== undefined && t.pendingBadge > 0 ? t.pendingBadge : undefined,
        }))}
        value={active}
        onChange={onChange}
        scrollable
        ariaLabel="Blitz detail tabs"
      />
    </div>
  );
}
