import { describe, it, expect } from 'vitest';
import {
  PHASES,
  ACTIVE_PHASES,
  INSTALLERS,
  FINANCERS,
  PRODUCT_TYPES,
  PREPAID_OPTIONS,
  REPS,
  SUB_DEALERS,
  PROJECTS,
  PAYROLL_ENTRIES,
  TRAINER_ASSIGNMENTS,
  SOLARTECH_PRODUCTS,
  SOLARTECH_FAMILIES,
  SOLARTECH_FAMILY_FINANCER,
  INSTALLER_PRICING_VERSIONS,
  NON_SOLARTECH_BASELINES,
  INSTALLER_PAY_CONFIGS,
} from '@/lib/data';

// ─── Phase Definitions ──────────────────────────────────────────────────────

describe('Phases', () => {
  it('contains all required phases in order', () => {
    expect(PHASES).toEqual([
      'New', 'Acceptance', 'Site Survey', 'Design', 'Permitting',
      'Pending Install', 'Installed', 'PTO', 'Completed', 'Cancelled', 'On Hold',
    ]);
  });

  it('ACTIVE_PHASES excludes Cancelled and On Hold', () => {
    expect(ACTIVE_PHASES).not.toContain('Cancelled');
    expect(ACTIVE_PHASES).not.toContain('On Hold');
  });

  it('ACTIVE_PHASES is a subset of PHASES', () => {
    for (const phase of ACTIVE_PHASES) {
      expect(PHASES).toContain(phase);
    }
  });
});

// ─── Reference Data ─────────────────────────────────────────────────────────

describe('Reference data lists', () => {
  it('INSTALLERS contains expected companies', () => {
    expect(INSTALLERS).toContain('ESP');
    expect(INSTALLERS).toContain('SolarTech');
    expect(INSTALLERS).toContain('EXO');
    expect(INSTALLERS.length).toBeGreaterThanOrEqual(12);
  });

  it('FINANCERS does not contain Cash (Cash is a product type)', () => {
    expect(FINANCERS).not.toContain('Cash');
  });

  it('FINANCERS contains expected companies', () => {
    expect(FINANCERS).toContain('Goodleap');
    expect(FINANCERS).toContain('Enfin');
    expect(FINANCERS).toContain('Mosaic');
    expect(FINANCERS.length).toBeGreaterThanOrEqual(13);
  });

  it('PRODUCT_TYPES has 4 types', () => {
    expect(PRODUCT_TYPES).toEqual(['PPA', 'Lease', 'Loan', 'Cash']);
  });

  it('PREPAID_OPTIONS includes HDM and PE', () => {
    expect(PREPAID_OPTIONS).toContain('HDM');
    expect(PREPAID_OPTIONS).toContain('PE');
  });
});

// ─── Rep Data ───────────────────────────────────────────────────────────────

describe('Reps', () => {
  it('all reps have required fields', () => {
    for (const rep of REPS) {
      expect(rep.id).toBeTruthy();
      expect(rep.firstName).toBeTruthy();
      expect(rep.lastName).toBeTruthy();
      expect(rep.name).toBe(`${rep.firstName} ${rep.lastName}`);
      expect(rep.email).toContain('@');
      expect(rep.role).toBe('rep');
      expect(['closer', 'setter', 'both']).toContain(rep.repType);
    }
  });

  it('all rep IDs are unique', () => {
    const ids = REPS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Sub-dealers', () => {
  it('all sub-dealers have role sub-dealer', () => {
    for (const sd of SUB_DEALERS) {
      expect(sd.role).toBe('sub-dealer');
    }
  });

  it('sub-dealer IDs don\'t collide with rep IDs', () => {
    const repIds = new Set(REPS.map((r) => r.id));
    for (const sd of SUB_DEALERS) {
      expect(repIds.has(sd.id)).toBe(false);
    }
  });
});

// ─── Project Data ───────────────────────────────────────────────────────────

describe('Projects', () => {
  it('all projects have required fields', () => {
    for (const p of PROJECTS) {
      expect(p.id).toBeTruthy();
      expect(p.customerName).toBeTruthy();
      expect(p.repId).toBeTruthy();
      expect(p.soldDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.installer).toBeTruthy();
      expect(PHASES).toContain(p.phase);
      expect(p.kWSize).toBeGreaterThan(0);
      expect(p.netPPW).toBeGreaterThan(0);
    }
  });

  it('all project IDs are unique', () => {
    const ids = PROJECTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all repIds reference valid reps', () => {
    const repIds = new Set(REPS.map((r) => r.id));
    for (const p of PROJECTS) {
      expect(repIds.has(p.repId)).toBe(true);
    }
  });

  it('cancelled projects have zero M1/M2 amounts', () => {
    const cancelled = PROJECTS.filter((p) => p.phase === 'Cancelled');
    for (const p of cancelled) {
      expect(p.m1Amount).toBe(0);
      expect(p.m2Amount).toBe(0);
    }
  });

  it('PTO projects have both m1 and m2 paid', () => {
    const ptoProjects = PROJECTS.filter((p) => p.phase === 'PTO');
    for (const p of ptoProjects) {
      expect(p.m1Paid).toBe(true);
      expect(p.m2Paid).toBe(true);
    }
  });
});

// ─── Payroll Data ───────────────────────────────────────────────────────────

describe('Payroll entries', () => {
  it('all entries have valid payment stages', () => {
    for (const e of PAYROLL_ENTRIES) {
      expect(['M1', 'M2', 'M3', 'Bonus', 'Trainer']).toContain(e.paymentStage);
    }
  });

  it('all entries have valid statuses', () => {
    for (const e of PAYROLL_ENTRIES) {
      expect(['Draft', 'Pending', 'Paid']).toContain(e.status);
    }
  });

  it('Paid entries have positive amounts', () => {
    const paid = PAYROLL_ENTRIES.filter((e) => e.status === 'Paid');
    for (const e of paid) {
      expect(e.amount).toBeGreaterThan(0);
    }
  });

  it('all payroll entry IDs are unique', () => {
    const ids = PAYROLL_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Trainer Assignments ────────────────────────────────────────────────────

describe('Trainer assignments', () => {
  it('all assignments reference valid reps', () => {
    const repIds = new Set(REPS.map((r) => r.id));
    for (const ta of TRAINER_ASSIGNMENTS) {
      expect(repIds.has(ta.trainerId)).toBe(true);
      expect(repIds.has(ta.traineeId)).toBe(true);
    }
  });

  it('trainer and trainee are different people', () => {
    for (const ta of TRAINER_ASSIGNMENTS) {
      expect(ta.trainerId).not.toBe(ta.traineeId);
    }
  });

  it('tier rates decrease or stay flat as deal count increases', () => {
    for (const ta of TRAINER_ASSIGNMENTS) {
      for (let i = 0; i < ta.tiers.length - 1; i++) {
        expect(ta.tiers[i].ratePerW).toBeGreaterThanOrEqual(ta.tiers[i + 1].ratePerW);
      }
    }
  });

  it('last tier always has upToDeal: null (perpetual)', () => {
    for (const ta of TRAINER_ASSIGNMENTS) {
      expect(ta.tiers[ta.tiers.length - 1].upToDeal).toBeNull();
    }
  });
});

// ─── SolarTech Product Families ─────────────────────────────────────────────

describe('SolarTech families', () => {
  it('all 4 families are defined', () => {
    expect(SOLARTECH_FAMILIES).toHaveLength(4);
  });

  it('each family maps to a financer', () => {
    for (const fam of SOLARTECH_FAMILIES) {
      expect(SOLARTECH_FAMILY_FINANCER[fam]).toBeTruthy();
    }
  });

  it('all products belong to a valid family', () => {
    for (const p of SOLARTECH_PRODUCTS) {
      expect(SOLARTECH_FAMILIES as readonly string[]).toContain(p.family);
    }
  });

  it('product family distribution: all families have products', () => {
    const counts: Record<string, number> = {};
    for (const p of SOLARTECH_PRODUCTS) {
      counts[p.family] = (counts[p.family] || 0) + 1;
    }
    expect(counts['Goodleap']).toBeGreaterThanOrEqual(8);
    expect(counts['Enfin']).toBeGreaterThanOrEqual(3);
    expect(counts['Lightreach']).toBeGreaterThanOrEqual(9);
    expect(counts['Cash/HDM/PE']).toBeGreaterThanOrEqual(4);
  });
});

// ─── Cross-reference: Installer pricing ─────────────────────────────────────

describe('Installer pricing completeness', () => {
  it('every non-SolarTech installer has a pricing version', () => {
    const versionInstallers = new Set(INSTALLER_PRICING_VERSIONS.map((v) => v.installer));
    for (const name of Object.keys(NON_SOLARTECH_BASELINES)) {
      expect(versionInstallers.has(name)).toBe(true);
    }
  });

  it('every installer with a pay config exists in INSTALLERS list', () => {
    for (const name of Object.keys(INSTALLER_PAY_CONFIGS)) {
      expect(INSTALLERS).toContain(name);
    }
  });
});
