'use client';

/**
 * Thin wrapper around the shared SegmentedPills primitive — kept as a
 * named component so the payroll page can mount it at the existing
 * import path without restructuring. The 'All' option is the default
 * post-merge filter shape (2026-05-21) — eliminates the broken Trainer
 * tab + missing-publish-button regression where future-dated trainer
 * entries hid from the publish flow.
 */

import { SegmentedPills } from '../../../../components/ui';

export type PayrollTypeTab = 'All' | 'Deal' | 'Bonus' | 'Trainer' | 'Charge';
const TABS: PayrollTypeTab[] = ['All', 'Deal', 'Bonus', 'Trainer', 'Charge'];

export default function PayrollTypeTabs({
  value,
  onChange,
}: {
  value: PayrollTypeTab;
  onChange: (t: PayrollTypeTab) => void;
}) {
  return (
    <SegmentedPills<PayrollTypeTab>
      options={TABS.map((t) => ({ value: t, label: t }))}
      value={value}
      onChange={onChange}
      ariaLabel="Payroll type filter"
    />
  );
}
