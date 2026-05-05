/**
 * Equipment Snapshot serializer.
 *
 * The deliberate firewall between project equipment data and pricing.
 * The Project's `Product` reference link to `ProductPricingVersion` /
 * `ProductPricingTier` rows that contain `closerPerW`, `kiloPerW`,
 * `setterPerW`, `subDealerPerW` — fields that absolutely should never
 * appear in the response of `GET /api/projects/[id]/equipment`.
 *
 * The `EquipmentSnapshotResponse` type below is the only shape that
 * leaves this module. Pricing fields are NOT in the type, so even an
 * accidental `...spread` of a Product or Tier object would TypeScript-
 * error rather than silently leak.
 *
 * Defense in depth: the visible property is also locked down by the
 * unit test in `tests/unit/equipment-snapshot.test.ts` which asserts
 * the response keys never include closerPerW/kiloPerW/etc.
 */

export interface EquipmentSnapshotResponse {
  productId: string | null;
  productName: string | null;
  family: string | null;
  /** Installer display name (always available — non-sensitive). */
  installerName: string;
  /** Financer display name (always available — non-sensitive). */
  financerName: string;
  /** Net metering type from the BVI intake when present (BVI-only). */
  exportType: string | null;
}

interface ProductLite {
  id: string;
  name: string;
  family: string | null;
}

/**
 * Whitelist serializer. Argument types accept Prisma rows (so the call
 * site can pass them directly) but the return shape is locked to the
 * EquipmentSnapshotResponse fields above. New fields added to Prisma
 * Product / ProductPricingVersion never auto-flow into this output.
 */
export function serializeEquipmentForProjectPage(input: {
  product: ProductLite | null;
  installerName: string;
  financerName: string;
  exportType: string | null;
}): EquipmentSnapshotResponse {
  return {
    productId: input.product?.id ?? null,
    productName: input.product?.name ?? null,
    family: input.product?.family ?? null,
    installerName: input.installerName,
    financerName: input.financerName,
    exportType: input.exportType,
  };
}
