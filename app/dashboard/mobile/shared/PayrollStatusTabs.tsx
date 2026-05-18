'use client';

/**
 * Thin wrapper around the shared SegmentedPills primitive (underline
 * variant) — kept as a named component so the payroll page can mount it
 * at the existing import path without restructuring.
 */

import { SegmentedPills } from '../../../../components/ui';

export type PayrollStatusTab = 'Draft' | 'Pending' | 'Paid';
const TABS: PayrollStatusTab[] = ['Draft', 'Pending', 'Paid'];

export default function PayrollStatusTabs({
  value,
  onChange,
}: {
  value: PayrollStatusTab;
  onChange: (t: PayrollStatusTab) => void;
}) {
  return (
    <SegmentedPills<PayrollStatusTab>
      options={TABS.map((t) => ({ value: t, label: t }))}
      value={value}
      onChange={onChange}
      variant="underline"
      ariaLabel="Payroll status"
    />
  );
}
