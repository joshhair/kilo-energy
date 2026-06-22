/**
 * commission-by-role.test.ts — locks the rep commission-by-role classifier +
 * aggregator (lib/commission-by-role.ts), the single source of truth shared
 * by the mobile rep detail view and GET /api/reps/[id]/commission-by-role.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyEntryRole,
  commissionByRole,
  type ClassifiableProject,
  type RolePayrollEntry,
  type RoleProject,
} from '@/lib/commission-by-role';

const REP = 'rep_1';
const OTHER = 'rep_2';

function pm(projects: RoleProject[]): Map<string, ClassifiableProject> {
  return new Map(projects.map((p) => [p.id, p]));
}

describe('classifyEntryRole', () => {
  const projects: RoleProject[] = [
    { id: 'p_close', repId: REP, setterId: OTHER },
    { id: 'p_set', repId: OTHER, setterId: REP },
    { id: 'p_selfgen', repId: REP, setterId: REP },
    { id: 'p_coclose', repId: OTHER, setterId: OTHER, additionalClosers: [{ userId: REP }] },
    { id: 'p_coset', repId: OTHER, setterId: OTHER, additionalSetters: [{ userId: REP }] },
  ];
  const map = pm(projects);

  it('Trainer payment stage always wins (even before project lookup)', () => {
    expect(classifyEntryRole({ paymentStage: 'Trainer', type: 'Deal', projectId: 'p_close' }, map, REP)).toBe('Trainer');
    // Trainer classifies without needing the project in the map
    expect(classifyEntryRole({ paymentStage: 'Trainer', type: 'Deal', projectId: 'missing' }, map, REP)).toBe('Trainer');
  });

  it('non-Deal type → Bonus', () => {
    expect(classifyEntryRole({ paymentStage: 'Bonus', type: 'Bonus', projectId: null }, map, REP)).toBe('Bonus');
  });

  it('Deal with no projectId → Bonus', () => {
    expect(classifyEntryRole({ paymentStage: 'M1', type: 'Deal', projectId: null }, map, REP)).toBe('Bonus');
  });

  it('rep is closer → Closer', () => {
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_close' }, map, REP)).toBe('Closer');
  });

  it('rep is setter → Setter', () => {
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_set' }, map, REP)).toBe('Setter');
  });

  it('self-gen (rep is both) → Closer unless notes say Setter', () => {
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_selfgen' }, map, REP)).toBe('Closer');
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_selfgen', notes: 'Setter' }, map, REP)).toBe('Setter');
  });

  it('rep is additional closer → Co-closer; additional setter → Co-setter', () => {
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_coclose' }, map, REP)).toBe('Co-closer');
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_coset' }, map, REP)).toBe('Co-setter');
  });

  it('Deal whose project is not in the map → Closer (fallback, matches web)', () => {
    expect(classifyEntryRole({ type: 'Deal', projectId: 'missing' }, map, REP)).toBe('Closer');
  });

  it('Deal where rep is not a party → Closer (final fallback, matches web)', () => {
    const m = pm([{ id: 'p_x', repId: OTHER, setterId: OTHER }]);
    expect(classifyEntryRole({ type: 'Deal', projectId: 'p_x' }, m, REP)).toBe('Closer');
  });
});

describe('commissionByRole', () => {
  const projects: RoleProject[] = [
    { id: 'p_close', repId: REP, setterId: OTHER, phase: 'Installed' },
    { id: 'p_close2', repId: REP, setterId: null, phase: 'PTO' },
    { id: 'p_cancelled', repId: REP, setterId: null, phase: 'Cancelled' },
    { id: 'p_onhold', repId: REP, setterId: null, phase: 'On Hold' },
    { id: 'p_set', repId: OTHER, setterId: REP, phase: 'Installed' },
    { id: 'p_coset', repId: OTHER, setterId: OTHER, phase: 'Installed', additionalSetters: [{ userId: REP }] },
  ];

  it('splits paid vs pending per role; pending includes Draft + Pending', () => {
    const payroll: RolePayrollEntry[] = [
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_close', amountCents: 100_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'M2', projectId: 'p_close', amountCents: 50_00, status: 'Pending' },
      { type: 'Deal', paymentStage: 'M3', projectId: 'p_close', amountCents: 25_00, status: 'Draft' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    const closer = out.find((r) => r.role === 'Closer')!;
    expect(closer.paidCents).toBe(100_00);
    expect(closer.pendingCents).toBe(75_00); // 50 pending + 25 draft
  });

  it('folds Co-setter into Setter', () => {
    const payroll: RolePayrollEntry[] = [
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_set', amountCents: 30_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_coset', amountCents: 20_00, status: 'Paid' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    expect(out.find((r) => r.role === 'Setter')!.paidCents).toBe(50_00);
    // Co-setter is not its own display row
    expect(out.some((r) => (r.role as string) === 'Co-setter')).toBe(false);
  });

  it('chargebacks (negative cents) net into the total, matching the web', () => {
    const payroll: RolePayrollEntry[] = [
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_close', amountCents: 100_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_close', amountCents: -40_00, status: 'Paid' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    expect(out.find((r) => r.role === 'Closer')!.paidCents).toBe(60_00);
  });

  it('Closer dealCount = rep deals excluding Cancelled / On Hold (project-based)', () => {
    const out = commissionByRole([], projects, REP);
    // p_close, p_close2 count; p_cancelled, p_onhold excluded. Project-based:
    // a closer with no payroll yet still counts.
    expect(out.find((r) => r.role === 'Closer')!.dealCount).toBe(2);
  });

  it('Setter / Co-closer dealCount = distinct projects among that role\'s entries (web parity)', () => {
    const payroll: RolePayrollEntry[] = [
      // Setter on p_set across two milestones → 1 distinct deal
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_set', amountCents: 10_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'M2', projectId: 'p_set', amountCents: 10_00, status: 'Pending' },
      // Co-setter folds into Setter, on a different deal → Setter has 2 distinct
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_coset', amountCents: 5_00, status: 'Paid' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    expect(out.find((r) => r.role === 'Setter')!.dealCount).toBe(2); // p_set + p_coset
    // Co-closer with no entries → 0 (and the row is all-zero, iOS omits it)
    expect(out.find((r) => r.role === 'Co-closer')!.dealCount).toBe(0);
  });

  it('Co-closer dealCount counts distinct projects among Co-closer entries', () => {
    const coCloser: RoleProject = { id: 'p_cc', repId: OTHER, setterId: OTHER, phase: 'Installed', additionalClosers: [{ userId: REP }] };
    const payroll: RolePayrollEntry[] = [
      { type: 'Deal', paymentStage: 'M1', projectId: 'p_cc', amountCents: 8_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'M2', projectId: 'p_cc', amountCents: 8_00, status: 'Pending' },
    ];
    const out = commissionByRole(payroll, [...projects, coCloser], REP);
    const cc = out.find((r) => r.role === 'Co-closer')!;
    expect(cc.dealCount).toBe(1); // one distinct project despite two milestones
    expect(cc.paidCents).toBe(8_00);
  });

  it('Bonus dealCount is always 0 (web shows "—")', () => {
    const payroll: RolePayrollEntry[] = [
      { type: 'Bonus', paymentStage: 'Bonus', projectId: null, amountCents: 50_00, status: 'Paid' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    expect(out.find((r) => r.role === 'Bonus')!.dealCount).toBe(0);
  });

  it('Trainer dealCount = distinct projects with a Trainer entry', () => {
    const payroll: RolePayrollEntry[] = [
      { type: 'Deal', paymentStage: 'Trainer', projectId: 'p_a', amountCents: 10_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'Trainer', projectId: 'p_a', amountCents: 5_00, status: 'Pending' },
      { type: 'Deal', paymentStage: 'Trainer', projectId: 'p_b', amountCents: 7_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'Trainer', projectId: null, amountCents: 1_00, status: 'Paid' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    const trainer = out.find((r) => r.role === 'Trainer')!;
    expect(trainer.dealCount).toBe(2); // p_a, p_b distinct; null ignored for COUNT
    // ...but the null-projectId Trainer entry's amount still totals (10 + 7 + 1)
    expect(trainer.paidCents).toBe(18_00);
    expect(trainer.pendingCents).toBe(5_00);
  });

  it('returns every display role in a stable order', () => {
    const out = commissionByRole([], projects, REP);
    expect(out.map((r) => r.role)).toEqual(['Closer', 'Co-closer', 'Setter', 'Trainer', 'Bonus']);
  });

  it('Bonus entries (no project / non-Deal) aggregate under Bonus', () => {
    const payroll: RolePayrollEntry[] = [
      { type: 'Bonus', paymentStage: 'Bonus', projectId: null, amountCents: 200_00, status: 'Paid' },
      { type: 'Deal', paymentStage: 'M1', projectId: null, amountCents: 11_00, status: 'Pending' },
    ];
    const out = commissionByRole(payroll, projects, REP);
    const bonus = out.find((r) => r.role === 'Bonus')!;
    expect(bonus.paidCents).toBe(200_00);
    expect(bonus.pendingCents).toBe(11_00);
  });
});
