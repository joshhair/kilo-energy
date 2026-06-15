import { createClient } from '@libsql/client';

// SECURITY (2026-06-12): this file previously fell back to a HARDCODED prod
// read-write Turso token + prod URL when env vars were unset — meaning anyone
// running `node scripts/seed-turso.mjs` with a bare shell would authenticate
// to PRODUCTION and overwrite seed data. The token was committed to git
// (b970c50) and MUST be rotated in the Turso dashboard. Both credentials are
// now required from the environment; no prod fallback exists.
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in the environment.');
  console.error('This seed script has NO production fallback (by design — see header).');
  console.error('Run with: set -a && . ./.env.local && set +a && node scripts/seed-turso.mjs  (point at a non-prod DB)');
  process.exit(1);
}
const c = createClient({ url, authToken });

const now = new Date().toISOString();

// ── Admin Users ──
const admins = [
  { id: 'admin_josh', firstName: 'Josh', lastName: 'Hair', email: 'josh@kiloenergies.com' },
  { id: 'admin_jens', firstName: 'Jens', lastName: 'van den Dries', email: 'jens@kiloenergy.com' },
  { id: 'admin_rebekah', firstName: 'Rebekah', lastName: 'Carpenter', email: 'rebekah@kiloenergy.com' },
  { id: 'admin_jessica', firstName: 'Jessica', lastName: 'Sousa', email: 'jessica@kiloenergy.com' },
];

// ── Installers ──
const installers = [
  { name: 'ESP', installPayPct: 80 },
  { name: 'EXO', installPayPct: 80 },
  { name: 'SolarTech', installPayPct: 100, usesProductCatalog: true },
  { name: 'GEG', installPayPct: 80 },
  { name: 'SunPower', installPayPct: 80 },
  { name: 'Complete Solar', installPayPct: 80 },
  { name: 'Solrite', installPayPct: 80 },
  { name: 'Solnova', installPayPct: 80 },
  { name: 'Bryton', installPayPct: 80 },
  { name: 'One Source', installPayPct: 80 },
  { name: 'Pacific Coast', installPayPct: 80 },
];

// ── Financers ──
const financers = [
  'Enfin', 'Everbright', 'Mosaic', 'Solrite', 'Sunnova', 'Sunrun',
  'LightReach', 'Dividend', 'Wheelhouse', 'Sungage', 'Goodleap',
  'Participate', 'Credit Human',
];

// ── Installer Pricing Versions (flat rates for standard installers) ──
const pricingVersions = [
  { installer: 'ESP',           closerPerW: 2.90, kiloPerW: 2.35 },
  { installer: 'EXO',           closerPerW: 2.90, kiloPerW: 2.35 },
  { installer: 'GEG',           closerPerW: 2.70, kiloPerW: 2.15 },
  { installer: 'SunPower',      closerPerW: 2.00, kiloPerW: 1.50 },
  { installer: 'Complete Solar', closerPerW: 2.90, kiloPerW: 2.35 },
  { installer: 'Solrite',       closerPerW: 2.90, kiloPerW: 2.35 },
  { installer: 'Solnova',       closerPerW: 2.90, kiloPerW: 2.35 },
  { installer: 'Bryton',        closerPerW: 2.80, kiloPerW: 2.25 },
  { installer: 'One Source',    closerPerW: 2.90, kiloPerW: 2.35 },
  { installer: 'Pacific Coast', closerPerW: 2.90, kiloPerW: 2.35 },
];

// ── SolarTech Prepaid Options ──
const prepaidOptions = ['HDM', 'PE'];

async function seed() {
  console.log('Seeding Turso production database...\n');

  // 1. Admin users (upsert)
  for (const a of admins) {
    await c.execute({
      sql: `INSERT INTO User (id, firstName, lastName, email, role, repType, active, canRequestBlitz, canCreateBlitz, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'admin', 'both', true, false, true, ?, ?)
            ON CONFLICT(id) DO UPDATE SET firstName=?, lastName=?, email=?, role='admin', updatedAt=?`,
      args: [a.id, a.firstName, a.lastName, a.email, now, now, a.firstName, a.lastName, a.email, now],
    });
  }
  console.log(`✓ ${admins.length} admin users`);

  // 2. Installers (upsert by name)
  const installerIds = {};
  for (const inst of installers) {
    const id = `inst_${inst.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await c.execute({
      sql: `INSERT INTO Installer (id, name, active, installPayPct, usesProductCatalog, createdAt, updatedAt)
            VALUES (?, ?, true, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET installPayPct=?, usesProductCatalog=?, updatedAt=?`,
      args: [id, inst.name, inst.installPayPct, inst.usesProductCatalog ?? false, now, now, inst.installPayPct, inst.usesProductCatalog ?? false, now],
    });
    installerIds[inst.name] = id;
  }
  console.log(`✓ ${installers.length} installers`);

  // 3. Financers (upsert by name)
  for (const name of financers) {
    const id = `fin_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await c.execute({
      sql: `INSERT INTO Financer (id, name, active, createdAt, updatedAt)
            VALUES (?, ?, true, ?, ?)
            ON CONFLICT(name) DO UPDATE SET active=true, updatedAt=?`,
      args: [id, name, now, now, now],
    });
  }
  console.log(`✓ ${financers.length} financers`);

  // 4. Pricing versions (one flat version per standard installer)
  for (const pv of pricingVersions) {
    const instId = installerIds[pv.installer];
    if (!instId) continue;
    const versionId = `ipv_${pv.installer.toLowerCase().replace(/[^a-z0-9]/g, '_')}_v1`;

    // Check if version exists
    const existing = await c.execute({ sql: 'SELECT id FROM InstallerPricingVersion WHERE id = ?', args: [versionId] });
    if (existing.rows.length > 0) continue;

    await c.execute({
      sql: `INSERT INTO InstallerPricingVersion (id, installerId, label, effectiveFrom, effectiveTo, rateType, createdAt, updatedAt)
            VALUES (?, ?, 'v1 — Initial', '2020-01-01', NULL, 'flat', ?, ?)`,
      args: [versionId, instId, now, now],
    });

    const tierId = `${versionId}_t1`;
    await c.execute({
      sql: `INSERT INTO InstallerPricingTier (id, versionId, minKW, maxKW, closerPerW, setterPerW, kiloPerW, subDealerPerW)
            VALUES (?, ?, 0, NULL, ?, NULL, ?, NULL)`,
      args: [tierId, versionId, pv.closerPerW, pv.kiloPerW],
    });
  }
  console.log(`✓ ${pricingVersions.length} pricing versions with tiers`);

  // 5. SolarTech prepaid options
  const stId = installerIds['SolarTech'];
  if (stId) {
    for (const opt of prepaidOptions) {
      const optId = `prepaid_st_${opt.toLowerCase()}`;
      await c.execute({
        sql: `INSERT OR IGNORE INTO InstallerPrepaidOption (id, installerId, name, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?)`,
        args: [optId, stId, opt, now, now],
      });
    }
    console.log(`✓ ${prepaidOptions.length} SolarTech prepaid options`);
  }

  // Verify
  console.log('\n── Verification ──');
  const uCount = await c.execute('SELECT count(*) as n FROM User');
  const iCount = await c.execute('SELECT count(*) as n FROM Installer');
  const fCount = await c.execute('SELECT count(*) as n FROM Financer');
  const pvCount = await c.execute('SELECT count(*) as n FROM InstallerPricingVersion');
  console.log(`Users: ${uCount.rows[0].n}, Installers: ${iCount.rows[0].n}, Financers: ${fCount.rows[0].n}, Pricing Versions: ${pvCount.rows[0].n}`);
  console.log('\n✓ Turso seed complete');
}

seed().catch(e => { console.error('SEED FAILED:', e); process.exit(1); });
