import { describe, it, expect } from 'vitest';
import {
  serializeEquipmentForProjectPage,
  type EquipmentSnapshotResponse,
} from '@/lib/serializers/equipment';

/**
 * Pricing-leak prevention guarantee for the Equipment Snapshot.
 *
 * The serializer's return TYPE excludes pricing fields (closerPerW,
 * kiloPerW, setterPerW, subDealerPerW, baselineOverrideJson) — adding
 * any of those to the type definition would TypeScript-error the
 * existing call site. This test is belt-and-suspenders: assert the
 * runtime keys never include pricing fields, even if someone in the
 * future accidentally widens the input shape.
 */

const FORBIDDEN_KEYS = [
  'closerPerW',
  'kiloPerW',
  'setterPerW',
  'subDealerPerW',
  'baselineOverrideJson',
  'closerCommissionAmount',
  'kiloMargin',
  'commission',
];

describe('serializeEquipmentForProjectPage', () => {
  it('returns the documented shape', () => {
    const out = serializeEquipmentForProjectPage({
      product: { id: 'prod_1', name: 'Q.TRON + 1x PW3', family: 'Goodleap' },
      installerName: 'BVI',
      financerName: 'Goodleap',
      exportType: 'NEM 3.0',
    });
    const expected: EquipmentSnapshotResponse = {
      productId: 'prod_1',
      productName: 'Q.TRON + 1x PW3',
      family: 'Goodleap',
      installerName: 'BVI',
      financerName: 'Goodleap',
      exportType: 'NEM 3.0',
    };
    expect(out).toEqual(expected);
  });

  it('handles a project with no product reference', () => {
    const out = serializeEquipmentForProjectPage({
      product: null,
      installerName: 'BVI',
      financerName: 'Cash',
      exportType: null,
    });
    expect(out).toEqual({
      productId: null,
      productName: null,
      family: null,
      installerName: 'BVI',
      financerName: 'Cash',
      exportType: null,
    });
  });

  it('output keys never include pricing fields', () => {
    const out = serializeEquipmentForProjectPage({
      product: { id: 'p', name: 'x', family: 'y' },
      installerName: 'I',
      financerName: 'F',
      exportType: null,
    });
    const keys = Object.keys(out);
    for (const banned of FORBIDDEN_KEYS) {
      expect(keys).not.toContain(banned);
    }
  });
});
