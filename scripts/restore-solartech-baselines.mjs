// One-shot recovery: restore SolarTech Products + ProductPricingVersions +
// ProductPricingTiers on the Turso production database.
//
// The SolarTech installer row exists but all of its products (and therefore
// all baseline pricing) were deleted from production at some point. This
// script recreates every product and its pricing from the canonical seed
// data in prisma/seed.mts — same IDs, same pricing values, same kW tier
// breaks (1-4.99, 5-9.99, 10-12.99, 13+).
//
// IDEMPOTENT: skips any Product whose id already exists. Safe to re-run.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/restore-solartech-baselines.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

// ─── Canonical baseline table — verbatim from prisma/seed.mts lines 183-217.
// Keeping this in sync with seed.mts matters: if you edit one, edit both.
const solarTechProducts = [
  // Goodleap Family
  { id: 'gl-qpeak-enphase',  family: 'Goodleap',    name: 'Q.Peak DUO BLK ML-G10.C+ 410 + Enphase IQ8HC', closer: [3.45, 3.10, 2.90, 2.85], kilo: [2.90, 2.50, 2.35, 2.35] },
  { id: 'gl-qtron-1pw3',     family: 'Goodleap',    name: 'Q.TRON + 1x Powerwall 3',                       closer: [5.98, 4.57, 3.66, 3.61], kilo: [5.43, 3.97, 3.11, 3.11] },
  { id: 'gl-qtron-2pw3',     family: 'Goodleap',    name: 'Q.TRON + 2x Powerwall 3',                       closer: [8.28, 5.94, 4.47, 4.42], kilo: [7.73, 5.34, 3.92, 3.92] },
  { id: 'gl-qtron-3pw3',     family: 'Goodleap',    name: 'Q.TRON + 3x Powerwall 3',                       closer: [10.58, 7.30, 5.29, 5.24], kilo: [10.03, 6.70, 4.74, 4.74] },
  { id: 'gl-hyundai-dc-pw3', family: 'Goodleap',    name: 'Hyundai 440 DC + Powerwall 3',                  closer: [2.85, 2.60, 2.50, 2.45], kilo: [2.35, 1.95, 1.90, 1.90] },
  { id: 'gl-hyundai-enphase',family: 'Goodleap',    name: 'Hyundai 440 + Enphase',                         closer: [3.20, 2.90, 2.80, 2.75], kilo: [2.70, 2.25, 2.20, 2.20] },
  { id: 'gl-spr-dc-pw3',     family: 'Goodleap',    name: 'SPR-MAX3 DC + Powerwall 3',                     closer: [2.90, 2.65, 2.50, 2.45], kilo: [2.40, 2.00, 1.90, 1.90] },
  { id: 'gl-spr-enphase',    family: 'Goodleap',    name: 'SPR-MAX3 + Enphase',                            closer: [3.30, 3.05, 2.90, 2.85], kilo: [2.80, 2.40, 2.30, 2.30] },
  // Enfin Family
  { id: 'ef-qpeak-dc-pw3',   family: 'Enfin',       name: 'Q.Peak DUO DC + Powerwall 3',                   closer: [3.20, 2.85, 2.80, 2.75], kilo: [2.70, 2.30, 2.25, 2.25] },
  { id: 'ef-qpeak-tesla',    family: 'Enfin',       name: 'Q.Peak DUO + Tesla PVI',                        closer: [3.40, 3.05, 2.95, 2.90], kilo: [2.90, 2.50, 2.40, 2.40] },
  { id: 'ef-qpeak-enphase',  family: 'Enfin',       name: 'Q.Peak DUO + Enphase',                          closer: [3.25, 2.90, 2.75, 2.70], kilo: [2.75, 2.35, 2.20, 2.20] },
  // Lightreach Family
  { id: 'lr-hyundai-dc-pw3', family: 'Lightreach',  name: 'Hyundai 440 DC + Powerwall 3',                  closer: [3.10, 2.75, 2.70, 2.65], kilo: [2.60, 2.20, 2.15, 2.15] },
  { id: 'lr-hyundai-tesla',  family: 'Lightreach',  name: 'Hyundai 440 + Tesla PVI',                       closer: [3.30, 2.90, 2.85, 2.80], kilo: [2.80, 2.35, 2.30, 2.30] },
  { id: 'lr-hyundai-enphase',family: 'Lightreach',  name: 'Hyundai 440 + Enphase',                         closer: [3.45, 3.05, 3.00, 2.95], kilo: [2.95, 2.50, 2.45, 2.45] },
  { id: 'lr-spr-tesla',      family: 'Lightreach',  name: 'SPR-MAX3 + Tesla PVI',                          closer: [3.30, 3.00, 2.90, 2.85], kilo: [2.85, 2.45, 2.35, 2.35] },
  { id: 'lr-spr-dc-pw3',     family: 'Lightreach',  name: 'SPR-MAX3 DC + Powerwall 3',                     closer: [3.10, 2.80, 2.70, 2.65], kilo: [2.65, 2.25, 2.15, 2.15] },
  { id: 'lr-qpeak-tesla',    family: 'Lightreach',  name: 'Q.Peak DUO + Tesla PVI',                        closer: [3.35, 3.05, 2.95, 2.90], kilo: [2.90, 2.50, 2.40, 2.40] },
  { id: 'lr-qpeak-enphase',  family: 'Lightreach',  name: 'Q.Peak DUO + Enphase',                          closer: [3.60, 3.30, 3.15, 3.10], kilo: [3.15, 2.75, 2.60, 2.60] },
  { id: 'lr-qpeak-dc-pw3',   family: 'Lightreach',  name: 'Q.Peak DUO DC + Powerwall 3',                   closer: [3.15, 2.85, 2.80, 2.75], kilo: [2.70, 2.30, 2.25, 2.25] },
  { id: 'lr-spr-enphase',    family: 'Lightreach',  name: 'SPR-MAX3 + Enphase',                            closer: [3.50, 3.20, 3.10, 3.05], kilo: [3.05, 2.65, 2.55, 2.55] },
  // Cash/HDM/PE Family
  { id: 'ca-hyundai-dc-pw3', family: 'Cash/HDM/PE', name: 'Hyundai/SEG 440 DC + Powerwall 3',              closer: [3.10, 2.75, 2.70, 2.65], kilo: [2.60, 2.20, 2.15, 2.15] },
  { id: 'ca-hyundai-tesla',  family: 'Cash/HDM/PE', name: 'Hyundai/SEG 440 + Tesla PVI',                   closer: [3.30, 2.90, 2.85, 2.80], kilo: [2.80, 2.35, 2.30, 2.30] },
  { id: 'ca-hyundai-enphase',family: 'Cash/HDM/PE', name: 'Hyundai/SEG 440 + Enphase',                     closer: [3.45, 3.05, 3.00, 2.95], kilo: [2.95, 2.50, 2.45, 2.45] },
  { id: 'ca-spr-dc-pw3',     family: 'Cash/HDM/PE', name: 'SPR-MAX3 DC + Powerwall 3',                     closer: [3.10, 2.80, 2.70, 2.65], kilo: [2.65, 2.25, 2.15, 2.15] },
  { id: 'ca-spr-tesla',      family: 'Cash/HDM/PE', name: 'SPR-MAX3 + Tesla PVI',                          closer: [3.30, 3.00, 2.90, 2.85], kilo: [2.85, 2.45, 2.35, 2.35] },
  { id: 'ca-spr-enphase',    family: 'Cash/HDM/PE', name: 'SPR-MAX3 + Enphase',                            closer: [3.50, 3.20, 3.10, 3.05], kilo: [3.05, 2.65, 2.55, 2.55] },
  { id: 'ca-qpeak-dc-pw3',   family: 'Cash/HDM/PE', name: 'Q.Peak DUO DC + Powerwall 3',                   closer: [3.15, 2.85, 2.80, 2.75], kilo: [2.70, 2.30, 2.25, 2.25] },
  { id: 'ca-qpeak-tesla',    family: 'Cash/HDM/PE', name: 'Q.Peak DUO + Tesla PVI',                        closer: [3.35, 3.05, 2.95, 2.90], kilo: [2.90, 2.50, 2.40, 2.40] },
  { id: 'ca-qpeak-enphase',  family: 'Cash/HDM/PE', name: 'Q.Peak DUO + Enphase',                          closer: [3.60, 3.30, 3.15, 3.10], kilo: [3.15, 2.75, 2.60, 2.60] },
];

const TIER_BREAKS = [1, 5, 10, 13];

function makeTiers(closer, kilo) {
  return closer.map((c, i) => ({
    minKW: TIER_BREAKS[i],
    maxKW: i < TIER_BREAKS.length - 1 ? TIER_BREAKS[i + 1] : null,
    closerPerW: c,
    setterPerW: Math.round((c + 0.10) * 100) / 100,
    kiloPerW: kilo[i],
  }));
}

function cuid() {
  // Simple non-cryptographic cuid-ish ID. We use deterministic IDs for
  // Product (`prod.id`) and ProductPricingVersion (`ppv_${prod.id}_v1`)
  // matching the seed file, but ProductPricingTier needs ad-hoc unique IDs.
  return 'tier_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function main() {
  // ─── Sanity check: confirm SolarTech installer exists ─────────────────
  const inst = await client.execute({
    sql: "SELECT id FROM Installer WHERE id = 'inst_solartech'",
    args: [],
  });
  if (inst.rows.length === 0) {
    console.error('✗ No SolarTech installer row found. Cannot restore products.');
    console.error('  Recreate the installer first, then re-run this script.');
    process.exit(1);
  }
  console.log('✓ SolarTech installer row confirmed');

  // ─── Pre-flight: how much data would we create? ──────────────────────
  const existing = await client.execute({
    sql: "SELECT id FROM Product WHERE installerId = 'inst_solartech'",
    args: [],
  });
  const existingIds = new Set(existing.rows.map((r) => r.id));
  const toCreate = solarTechProducts.filter((p) => !existingIds.has(p.id));
  const skipCount = solarTechProducts.length - toCreate.length;

  console.log(`  Catalog: ${solarTechProducts.length} products defined`);
  console.log(`  Existing: ${skipCount} already in DB (will skip)`);
  console.log(`  To create: ${toCreate.length} products`);
  console.log();

  if (toCreate.length === 0) {
    console.log('Nothing to do — all products already exist. Exiting.');
    return;
  }

  // ─── Create each Product + 1 ProductPricingVersion + 4 tiers ──────────
  const now = new Date().toISOString();
  let created = 0;

  for (const prod of toCreate) {
    const pvId = `ppv_${prod.id}_v1`;
    const tiers = makeTiers(prod.closer, prod.kilo);

    try {
      // 1) Create the Product row
      await client.execute({
        sql: `INSERT INTO Product (id, installerId, family, name, active, createdAt, updatedAt)
              VALUES (?, 'inst_solartech', ?, ?, 1, ?, ?)`,
        args: [prod.id, prod.family, prod.name, now, now],
      });

      // 2) Create the ProductPricingVersion row
      await client.execute({
        sql: `INSERT INTO ProductPricingVersion (id, productId, label, effectiveFrom, effectiveTo, createdAt, updatedAt)
              VALUES (?, ?, 'v1 — Restored from seed', '2020-01-01', NULL, ?, ?)`,
        args: [pvId, prod.id, now, now],
      });

      // 3) Create the 4 tier rows
      for (const tier of tiers) {
        await client.execute({
          sql: `INSERT INTO ProductPricingTier (id, versionId, minKW, maxKW, closerPerW, setterPerW, kiloPerW, subDealerPerW)
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          args: [cuid(), pvId, tier.minKW, tier.maxKW, tier.closerPerW, tier.setterPerW, tier.kiloPerW],
        });
      }

      created++;
      console.log(`  ✓ ${prod.family.padEnd(12)} ${prod.name}`);
    } catch (err) {
      console.error(`  ✗ Failed to create ${prod.id}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log();
  console.log(`Restore complete: ${created} products created.`);

  // ─── Verify: count what's there now ───────────────────────────────────
  const afterProds = await client.execute({
    sql: "SELECT COUNT(*) as c FROM Product WHERE installerId = 'inst_solartech'",
    args: [],
  });
  const afterVersions = await client.execute({
    sql: `SELECT COUNT(*) as c FROM ProductPricingVersion
          WHERE productId IN (SELECT id FROM Product WHERE installerId = 'inst_solartech')`,
    args: [],
  });
  const afterTiers = await client.execute({
    sql: `SELECT COUNT(*) as c FROM ProductPricingTier
          WHERE versionId IN (
            SELECT id FROM ProductPricingVersion
            WHERE productId IN (SELECT id FROM Product WHERE installerId = 'inst_solartech')
          )`,
    args: [],
  });

  console.log();
  console.log('Post-restore counts:');
  console.log(`  Products:               ${afterProds.rows[0].c}`);
  console.log(`  ProductPricingVersions: ${afterVersions.rows[0].c}`);
  console.log(`  ProductPricingTiers:    ${afterTiers.rows[0].c}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Restore failed:', err);
    process.exit(1);
  });
