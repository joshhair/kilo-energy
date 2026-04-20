import { describe, it, expect } from 'vitest';
import { relationshipToProject } from '@/lib/api-auth';
import { applyProjectVisibility } from '@/lib/fieldVisibility';

/**
 * Trainer-visibility fix (Paul Tupou bug):
 *
 * Two pathways for a rep-role user to be recognized as "trainer" on a
 * project:
 *   1. project.trainerId === viewer.id  (per-project override)
 *   2. viewer.id trains project.closerId via an active rep-chain
 *      TrainerAssignment. Callers pre-compute this as chainTrainees
 *      (Set of closer IDs) and pass it into relationshipToProject.
 *
 * These tests pin both pathways AND confirm the privacy invariant:
 * trainer sees their own override context but not closer/setter
 * commission, kiloMargin, or per-party breakdowns.
 */

const baseProject = {
  closerId: 'closer-1',
  setterId: 'setter-1',
  subDealerId: null,
  trainerId: null,
};

describe('relationshipToProject — trainer pathways', () => {
  it('per-project trainer override: viewer matches project.trainerId', () => {
    const project = { ...baseProject, trainerId: 'trainer-1' };
    const rel = relationshipToProject(
      { id: 'trainer-1', role: 'rep' },
      project,
    );
    expect(rel).toBe('trainer');
  });

  it('rep-chain trainer: viewer trains project.closerId via chainTrainees', () => {
    const project = { ...baseProject };
    const chainTrainees = new Set(['closer-1']);
    const rel = relationshipToProject(
      { id: 'trainer-7', role: 'rep' },
      project,
      chainTrainees,
    );
    expect(rel).toBe('trainer');
  });

  it('rep-chain takes precedence over closer/setter matches', () => {
    // Edge case: viewer is a trainer of closer-1, but is ALSO the setter.
    // Precedence comment says: admin > pm > trainer > closer > setter > ...
    // So relationship should resolve to 'trainer'.
    const project = { ...baseProject, setterId: 'trainer-7' };
    const chainTrainees = new Set(['closer-1']);
    const rel = relationshipToProject(
      { id: 'trainer-7', role: 'rep' },
      project,
      chainTrainees,
    );
    expect(rel).toBe('trainer');
  });

  it('without chainTrainees, rep-chain trainer falls through to none', () => {
    // Pre-fix behavior: no chainTrainees passed, rep-chain trainer gets
    // the 'none' relationship. This test documents that a caller who
    // forgets to pass chainTrainees will over-restrict (safe side).
    const project = { ...baseProject };
    const rel = relationshipToProject(
      { id: 'trainer-7', role: 'rep' },
      project,
    );
    expect(rel).toBe('none');
  });

  it('empty chainTrainees set does not grant trainer relationship', () => {
    const project = { ...baseProject };
    const rel = relationshipToProject(
      { id: 'trainer-7', role: 'rep' },
      project,
      new Set<string>(),
    );
    expect(rel).toBe('none');
  });

  it('admin retains full visibility even if also listed as trainer', () => {
    const project = { ...baseProject, trainerId: 'admin-1' };
    const rel = relationshipToProject(
      { id: 'admin-1', role: 'admin' },
      project,
    );
    expect(rel).toBe('admin');
  });
});

describe('trainer relationship — field visibility (privacy invariant)', () => {
  // Representative DTO with every field a trainer must be shielded from.
  const dto = {
    netPPW: 3.75,
    m1Amount: 1890.01,
    m2Amount: 1890.02,
    m3Amount: 472.51,
    setterM1Amount: 500,
    setterM2Amount: 250,
    setterM3Amount: 100,
    trainerId: 'trainer-7',
    trainerName: 'Paul Tupou',
    trainerRate: 0.1,
    customerName: 'ACME Solar',
    phase: 'Installed',
    kWSize: 9.2,
    additionalClosers: [{ userId: 'cc-1', m1Amount: 100, m2Amount: 100, m3Amount: 50 }],
    additionalSetters: [{ userId: 'cs-1', m1Amount: 50, m2Amount: 50, m3Amount: 25 }],
    baselineOverride: { closerPerW: 1.5, kiloPerW: 0.8, setterPerW: 0.5 },
  };

  it('zeroes closer M1/M2 and nulls M3 for trainer', () => {
    const scrubbed = applyProjectVisibility(dto, 'trainer');
    expect(scrubbed.m1Amount).toBe(0);
    expect(scrubbed.m2Amount).toBe(0);
    expect(scrubbed.m3Amount).toBe(null);
  });

  it('zeroes setter M1/M2 and nulls M3 for trainer', () => {
    const scrubbed = applyProjectVisibility(dto, 'trainer');
    expect(scrubbed.setterM1Amount).toBe(0);
    expect(scrubbed.setterM2Amount).toBe(0);
    expect(scrubbed.setterM3Amount).toBe(null);
  });

  it('strips trainer identity fields for trainer', () => {
    // Counter-intuitive but intentional: the trainer derives their own
    // payout from rate + kW in the UI; they don't need trainerId/Name/Rate
    // echoed back from the DTO. See fieldVisibility.ts comment.
    const scrubbed = applyProjectVisibility(dto, 'trainer');
    expect(scrubbed.trainerId).toBeUndefined();
    expect(scrubbed.trainerName).toBeUndefined();
    expect(scrubbed.trainerRate).toBeUndefined();
  });

  it('hides additional closers + setters from trainer (both empty-array)', () => {
    const scrubbed = applyProjectVisibility(dto, 'trainer');
    expect(scrubbed.additionalClosers).toEqual([]);
    expect(scrubbed.additionalSetters).toEqual([]);
  });

  it('strips baselineOverride.kiloPerW for trainer (margin invariant)', () => {
    const scrubbed = applyProjectVisibility(dto, 'trainer');
    const bo = scrubbed.baselineOverride as Record<string, unknown> | null | undefined;
    // Kilo wholesale cost must never reach a rep/trainer payload — it
    // lets them back-solve kiloMargin.
    expect(bo).toBeDefined();
    expect(bo).not.toBeNull();
    expect((bo as Record<string, unknown>).kiloPerW).toBeUndefined();
    // But the non-sensitive baseline fields are fine.
    expect((bo as Record<string, unknown>).closerPerW).toBe(1.5);
  });

  it('passes through project context (customerName, phase, kWSize)', () => {
    const scrubbed = applyProjectVisibility(dto, 'trainer');
    expect(scrubbed.customerName).toBe('ACME Solar');
    expect(scrubbed.phase).toBe('Installed');
    expect(scrubbed.kWSize).toBe(9.2);
  });
});
