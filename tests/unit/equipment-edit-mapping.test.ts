/**
 * equipment-edit-mapping.test.ts — locks the admin equipment-edit wiring.
 *
 * Equipment editing was a no-op end-to-end until 2026-06-21: the client
 * tracks SolarTech vs installer-catalog product as two fields, but the DB
 * column is the unified `productId`. mapProjectUpdateToDb must translate
 * whichever is present so the PATCH actually persists the change, and the
 * patch schema must accept `productId`.
 */

import { describe, it, expect } from 'vitest';
import { mapProjectUpdateToDb } from '@/lib/context/project-transitions';
import { patchProjectSchema } from '@/lib/schemas/project';
import type { Project } from '@/lib/data';

const u = (over: Partial<Project>): Partial<Project> => over;

describe('mapProjectUpdateToDb — equipment (product) mapping', () => {
  it('maps a SolarTech product change to the unified productId', () => {
    const out = mapProjectUpdateToDb(u({ solarTechProductId: 'prod_st' }));
    expect(out.productId).toBe('prod_st');
  });

  it('maps an installer-catalog product change to the unified productId', () => {
    const out = mapProjectUpdateToDb(u({ installerProductId: 'prod_bvi' }));
    expect(out.productId).toBe('prod_bvi');
  });

  it('prefers the defined product field when the other is undefined (installer-product path)', () => {
    const out = mapProjectUpdateToDb(u({ solarTechProductId: undefined, installerProductId: 'prod_bvi' }));
    expect(out.productId).toBe('prod_bvi');
  });

  it('clears productId when both product fields are present but empty (installer changed away)', () => {
    const out = mapProjectUpdateToDb(u({ solarTechProductId: undefined, installerProductId: undefined }));
    expect('productId' in out).toBe(true);
    expect(out.productId).toBeNull();
  });

  it('does not touch productId when no product field is in the update', () => {
    const out = mapProjectUpdateToDb(u({ notes: 'just a note' }));
    expect('productId' in out).toBe(false);
  });
});

describe('patchProjectSchema accepts productId', () => {
  it('parses a productId in the PATCH body', () => {
    const parsed = patchProjectSchema.safeParse({ productId: 'prod_x' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.productId).toBe('prod_x');
  });
});
