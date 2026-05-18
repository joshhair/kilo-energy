'use client';

/**
 * Thin wrapper around the shared SegmentedPills primitive — kept as a
 * named component so the payroll page can mount it at the existing
 * import path without restructuring. Type union here is the source of
 * truth for the three payroll-entry types.
 */

import { SegmentedPills } from '../../../../components/ui';

export type PayrollTypeTab = 'Deal' | 'Bonus' | 'Trainer';
const TABS: PayrollTypeTab[] = ['Deal', 'Bonus', 'Trainer'];

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
      ariaLabel="Payroll type"
    />
  );
}
