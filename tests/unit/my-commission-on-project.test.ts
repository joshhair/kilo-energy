import { describe, it, expect } from 'vitest';
import { myCommissionOnProject } from '@/lib/commissionHelpers';
import type { Project, PayrollEntry } from '@/lib/data';

/**
 * Regression: on 2026-04-19 the mobile rep view was showing only the
 * M1 amount as the rep's "total commission on this deal" for deals
 * past M1 but not yet past M2 / M3. Cause: the helper's "prefer
 * payroll entries" strategy treated the drafted-so-far set as the
 * total, silently hiding future milestones.
 *
 * Fix: the projected total is always the rep's role-specific
 * projection from Project fields. Payroll entries only surface
 * paid/unpaid status per stage.
 */

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    customerName: 'Test Customer',
    repId: 'closer-1',
    repName: 'Closer One',
    setterId: 'setter-1',
    setterName: 'Setter One',
    subDealerId: null,
    trainerId: null,
    trainerRate: null,
    installer: 'Tesla',
    installerProductId: null,
    solarTechProductId: null,
    financer: 'Loan',
    productType: 'Loan',
    soldDate: '2026-04-01',
    kWSize: 10,
    netPPW: 3.75,
    phase: 'Acceptance',
    m1Paid: false,
    m1Amount: 1000,
    m2Paid: false,
    m2Amount: 2500,
    m3Amount: 500,
    setterM1Amount: 500,
    setterM2Amount: 1250,
    setterM3Amount: 250,
    notes: '',
    ...overrides,
  } as Project;
}

describe('myCommissionOnProject — closer view', () => {
  it('returns full projected total even when only M1 payroll entry exists', () => {
    const project = makeProject({ setterId: undefined, m1Amount: 1000, m2Amount: 2500, m3Amount: 500 });
    const payroll: PayrollEntry[] = [
      { id: 'p1', projectId: 'p1', repId: 'closer-1', paymentStage: 'M1', status: 'Draft', amount: 1000, date: '2026-04-01', type: 'Deal' } as PayrollEntry,
    ];
    const result = myCommissionOnProject(project, 'closer-1', 'rep', payroll);
    // Regression: was returning 1000 (just the drafted M1). Now must
    // return the full 1000 + 2500 + 500 = 4000 projected total.
    expect(result.total).toBe(4000);
  });

  it('marks the drafted M1 as NOT paid until it is actually Paid', () => {
    const project = makeProject({ setterId: undefined });
    const payroll: PayrollEntry[] = [
      { id: 'p1', projectId: 'p1', repId: 'closer-1', paymentStage: 'M1', status: 'Draft', amount: 1000, date: '2026-04-01', type: 'Deal' } as PayrollEntry,
    ];
    const result = myCommissionOnProject(project, 'closer-1', 'rep', payroll);
    expect(result.stages.m1.paid).toBe(false);
    expect(result.status).toBe('projected');
  });

  it('flips stage.paid=true when the payroll entry for that stage is Paid', () => {
    const project = makeProject({ setterId: undefined });
    const payroll: PayrollEntry[] = [
      { id: 'p1', projectId: 'p1', repId: 'closer-1', paymentStage: 'M1', status: 'Paid', amount: 1000, date: '2026-04-01', type: 'Deal' } as PayrollEntry,
    ];
    const result = myCommissionOnProject(project, 'closer-1', 'rep', payroll);
    expect(result.stages.m1.paid).toBe(true);
    expect(result.status).toBe('partial'); // M2 + M3 still unpaid
  });

  it('paired deal: closer M1 is 0 when setterId set; total excludes M1', () => {
    const project = makeProject({ m1Amount: 1000, m2Amount: 2500, m3Amount: 500 });
    const result = myCommissionOnProject(project, 'closer-1', 'rep', []);
    // setterId is set → closer's m1 slot becomes 0, total is just M2 + M3.
    expect(result.stages.m1.amount).toBe(0);
    expect(result.total).toBe(3000);
  });
});

describe('myCommissionOnProject — setter view', () => {
  it('uses setter amounts, not closer amounts', () => {
    const project = makeProject();
    const result = myCommissionOnProject(project, 'setter-1', 'rep', []);
    expect(result.stages.m1.amount).toBe(500);
    expect(result.stages.m2.amount).toBe(1250);
    expect(result.stages.m3.amount).toBe(250);
    expect(result.total).toBe(2000);
  });

  it('setter: stage.paid tracks Paid payroll entries', () => {
    const project = makeProject();
    const payroll: PayrollEntry[] = [
      { id: 'p1', projectId: 'p1', repId: 'setter-1', paymentStage: 'M1', status: 'Paid', amount: 500, date: '2026-04-01', type: 'Deal' } as PayrollEntry,
      { id: 'p2', projectId: 'p1', repId: 'setter-1', paymentStage: 'M2', status: 'Pending', amount: 1250, date: '2026-04-10', type: 'Deal' } as PayrollEntry,
    ];
    const result = myCommissionOnProject(project, 'setter-1', 'rep', payroll);
    expect(result.stages.m1.paid).toBe(true);
    expect(result.stages.m2.paid).toBe(false);
    expect(result.total).toBe(2000); // unchanged by payroll status
  });
});

describe('myCommissionOnProject — sub-dealer view', () => {
  it('M1 is N/A for sub-dealers; total = M2 + M3 only', () => {
    const project = makeProject({ subDealerId: 'sd-1', m1Amount: 1000, m2Amount: 2500, m3Amount: 500 });
    const result = myCommissionOnProject(project, 'sd-1', 'sub-dealer', []);
    expect(result.stages.m1.applicable).toBe(false);
    expect(result.stages.m1.amount).toBe(0);
    expect(result.total).toBe(3000);
  });
});

describe('myCommissionOnProject — trainer view', () => {
  it('trainer total = rate × kW × 1000 regardless of payroll entries', () => {
    const project = makeProject({ trainerId: 'trainer-1', trainerRate: 0.1, kWSize: 10 });
    const result = myCommissionOnProject(project, 'trainer-1', 'rep', []);
    expect(result.total).toBe(1000); // 0.1 × 10 × 1000
  });
});

describe('myCommissionOnProject — co-party view', () => {
  it('co-closer: uses their specific M1/M2/M3 amounts', () => {
    const project = makeProject({
      additionalClosers: [
        { userId: 'cc-1', userName: 'Co Closer', m1Amount: 200, m2Amount: 500, m3Amount: 100, position: 1 },
      ],
    });
    const result = myCommissionOnProject(project, 'cc-1', 'rep', []);
    expect(result.stages.m1.amount).toBe(200);
    expect(result.stages.m2.amount).toBe(500);
    expect(result.stages.m3.amount).toBe(100);
    expect(result.total).toBe(800);
  });
});

describe('myCommissionOnProject — stranger view', () => {
  it('returns 0 and projected status when viewer is not on the deal', () => {
    const project = makeProject();
    const result = myCommissionOnProject(project, 'random-rep', 'rep', []);
    expect(result.total).toBe(0);
    expect(result.status).toBe('projected');
  });
});
