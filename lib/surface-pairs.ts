/**
 * surface-pairs.ts — Mobile ↔ Desktop feature pair manifest.
 *
 * Each entry binds two files that render the same feature on different
 * surfaces. Used by:
 *   - Testers: when scanning one side, also read the paired side and
 *     flag divergence in derived values, field definitions, or
 *     scrubbing rules as a single "paired-divergence" finding.
 *   - Corrector: when a bug is fixed on one side, verify whether the
 *     same symptom exists on the paired side before touching it.
 *
 * Pairs are deliberately narrow: only surfaces that genuinely render
 * the same feature with the same expected behavior. Not "both pages
 * touch payroll" — "both pages render the same screen on different
 * form factors."
 *
 * Bidirectional by construction — lookups work from either side.
 */

export interface SurfacePair {
  /** Short human label used in findings and sweep logs. */
  label: string;
  /** Canonical paths relative to repo root. */
  desktop: string;
  mobile: string;
  /** Notes that reflect intentional divergence agents should respect. */
  notes?: string;
}

export const SURFACE_PAIRS: SurfacePair[] = [
  {
    label: 'Blitz list',
    desktop: 'app/dashboard/blitz/page.tsx',
    mobile: 'app/dashboard/mobile/MobileBlitz.tsx',
  },
  {
    label: 'Blitz detail',
    desktop: 'app/dashboard/blitz/[id]/page.tsx',
    mobile: 'app/dashboard/mobile/MobileBlitzDetail.tsx',
    notes: 'Mobile splits into blitz-detail/ subcomponents; desktop is a single file. Features should match, visual treatment may differ.',
  },
  {
    label: 'Dashboard (rep + admin)',
    desktop: 'app/dashboard/page.tsx',
    mobile: 'app/dashboard/mobile/MobileDashboard.tsx',
    notes: 'MobileAdminDashboard.tsx is the admin-side mobile view.',
  },
  {
    label: 'Admin dashboard',
    desktop: 'app/dashboard/components/AdminDashboard.tsx',
    mobile: 'app/dashboard/mobile/MobileAdminDashboard.tsx',
  },
  {
    label: 'Projects list',
    desktop: 'app/dashboard/projects/page.tsx',
    mobile: 'app/dashboard/mobile/MobileProjects.tsx',
  },
  {
    label: 'Project detail',
    desktop: 'app/dashboard/projects/[id]/page.tsx',
    mobile: 'app/dashboard/mobile/MobileProjectDetail.tsx',
  },
  {
    label: 'New deal form',
    desktop: 'app/dashboard/new-deal/page.tsx',
    mobile: 'app/dashboard/mobile/MobileNewDeal.tsx',
  },
  {
    label: 'Calculator',
    desktop: 'app/dashboard/calculator/page.tsx',
    mobile: 'app/dashboard/mobile/MobileCalculator.tsx',
  },
  {
    label: 'My Pay',
    desktop: 'app/dashboard/my-pay/page.tsx',
    mobile: 'app/dashboard/mobile/MobileMyPay.tsx',
  },
  {
    label: 'Earnings',
    desktop: 'app/dashboard/earnings/page.tsx',
    mobile: 'app/dashboard/mobile/MobileEarnings.tsx',
  },
  {
    label: 'Payroll',
    desktop: 'app/dashboard/payroll/page.tsx',
    mobile: 'app/dashboard/mobile/MobilePayroll.tsx',
  },
  {
    label: 'Incentives',
    desktop: 'app/dashboard/incentives/page.tsx',
    mobile: 'app/dashboard/mobile/MobileIncentives.tsx',
  },
  {
    label: 'Training (Trainer Hub)',
    desktop: 'app/dashboard/training/page.tsx',
    mobile: 'app/dashboard/mobile/MobileTraining.tsx',
  },
  {
    label: 'Users list',
    desktop: 'app/dashboard/users/page.tsx',
    mobile: 'app/dashboard/mobile/MobileReps.tsx',
  },
  {
    label: 'User detail',
    desktop: 'app/dashboard/users/[id]/page.tsx',
    mobile: 'app/dashboard/mobile/MobileRepDetail.tsx',
  },
  {
    label: 'Settings',
    desktop: 'app/dashboard/settings/page.tsx',
    mobile: 'app/dashboard/mobile/MobileSettings.tsx',
  },
];

/**
 * Returns the paired file for a given path, or null if the file isn't
 * in the manifest. Normalizes forward/back slashes.
 */
export function getPairedFile(filePath: string): { pair: SurfacePair; side: 'desktop' | 'mobile'; siblingPath: string } | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pair of SURFACE_PAIRS) {
    if (normalized.endsWith(pair.desktop)) {
      return { pair, side: 'desktop', siblingPath: pair.mobile };
    }
    if (normalized.endsWith(pair.mobile)) {
      return { pair, side: 'mobile', siblingPath: pair.desktop };
    }
  }
  return null;
}

/**
 * Flattened list of every file in the manifest — useful for agents
 * that want to enumerate all paired surfaces at once.
 */
export function allPairedFiles(): string[] {
  const out: string[] = [];
  for (const p of SURFACE_PAIRS) { out.push(p.desktop); out.push(p.mobile); }
  return out;
}
