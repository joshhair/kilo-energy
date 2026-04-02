import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '..', 'dev.db');

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });

const mod = await import('../lib/generated/prisma/client.js');
const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient;
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // =========================================================================
  // 1. INSTALLERS
  // =========================================================================
  const installerData = [
    { id: 'inst_esp',            name: 'ESP',            installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_exo',            name: 'EXO',            installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_solartech',      name: 'SolarTech',      installPayPct: 100, usesProductCatalog: true },
    { id: 'inst_geg',            name: 'GEG',            installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_sunpower',       name: 'SunPower',       installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_complete',       name: 'Complete Solar',  installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_solrite',        name: 'Solrite',        installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_solnova',        name: 'Solnova',        installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_exo_old',        name: 'EXO (OLD)',      installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_bryton',         name: 'Bryton',         installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_one_source',     name: 'One Source',     installPayPct: 80,  usesProductCatalog: false },
    { id: 'inst_pacific',        name: 'Pacific Coast',  installPayPct: 80,  usesProductCatalog: false },
  ];

  for (const inst of installerData) {
    await prisma.installer.create({ data: inst });
  }
  console.log(`  Created ${installerData.length} installers`);

  // Prepaid options for SolarTech
  for (const name of ['HDM', 'PE']) {
    await prisma.installerPrepaidOption.create({
      data: { installerId: 'inst_solartech', name },
    });
  }
  console.log('  Created SolarTech prepaid options');

  // =========================================================================
  // 2. FINANCERS
  // =========================================================================
  const financerData = [
    { id: 'fin_enfin',        name: 'Enfin' },
    { id: 'fin_everbright',   name: 'Everbright' },
    { id: 'fin_mosaic',       name: 'Mosaic' },
    { id: 'fin_solrite',      name: 'Solrite' },
    { id: 'fin_sunnova',      name: 'Sunnova' },
    { id: 'fin_sunrun',       name: 'Sunrun' },
    { id: 'fin_lightreach',   name: 'LightReach' },
    { id: 'fin_dividend',     name: 'Dividend' },
    { id: 'fin_wheelhouse',   name: 'Wheelhouse' },
    { id: 'fin_sungage',      name: 'Sungage' },
    { id: 'fin_goodleap',     name: 'Goodleap' },
    { id: 'fin_participate',  name: 'Participate' },
    { id: 'fin_credit_human', name: 'Credit Human' },
    { id: 'fin_cash',         name: 'Cash' },
  ];

  for (const fin of financerData) {
    await prisma.financer.create({ data: fin });
  }
  console.log(`  Created ${financerData.length} financers`);

  // =========================================================================
  // 3. USERS (Reps + Admins)
  // =========================================================================
  const repData = [
    { id: 'rep1', firstName: 'Alex',   lastName: 'Rivera', email: 'alex@kiloenergy.com',   phone: '(555) 100-0001', role: 'rep', repType: 'both' },
    { id: 'rep2', firstName: 'Maria',  lastName: 'Santos', email: 'maria@kiloenergy.com',  phone: '(555) 100-0002', role: 'rep', repType: 'both' },
    { id: 'rep3', firstName: 'James',  lastName: 'Park',   email: 'james@kiloenergy.com',  phone: '(555) 100-0003', role: 'rep', repType: 'closer' },
    { id: 'rep4', firstName: 'Taylor', lastName: 'Brooks', email: 'taylor@kiloenergy.com', phone: '(555) 100-0004', role: 'rep', repType: 'setter' },
    { id: 'rep5', firstName: 'Jordan', lastName: 'Lee',    email: 'jordan@kiloenergy.com', phone: '(555) 100-0005', role: 'rep', repType: 'both' },
  ];

  const adminData = [
    { id: 'admin1', firstName: 'Jens',    lastName: 'van den Dries', email: 'jens@kiloenergy.com',    phone: '', role: 'admin', repType: 'both' },
    { id: 'admin2', firstName: 'Josh',    lastName: 'Hair',          email: 'josh@kiloenergy.com',    phone: '', role: 'admin', repType: 'both' },
    { id: 'admin3', firstName: 'Rebekah', lastName: 'Carpenter',     email: 'rebekah@kiloenergy.com', phone: '', role: 'admin', repType: 'both' },
    { id: 'admin4', firstName: 'Jessica', lastName: 'Sousa',         email: 'jessica@kiloenergy.com', phone: '', role: 'admin', repType: 'both' },
  ];

  const subDealerData = [
    { id: 'sd1', firstName: 'Chris', lastName: 'Nguyen',  email: 'chris@solardealers.com',  phone: '(555) 200-0001', role: 'sub-dealer', repType: 'both' },
    { id: 'sd2', firstName: 'Dana',  lastName: 'Morales', email: 'dana@greendealers.com',   phone: '(555) 200-0002', role: 'sub-dealer', repType: 'both' },
    { id: 'sd3', firstName: 'Pat',   lastName: 'Kim',     email: 'pat@sunstardealers.com',  phone: '(555) 200-0003', role: 'sub-dealer', repType: 'both' },
  ];

  for (const user of [...repData, ...adminData, ...subDealerData]) {
    await prisma.user.create({ data: user });
  }
  console.log(`  Created ${repData.length} reps + ${adminData.length} admins + ${subDealerData.length} sub-dealers`);

  // =========================================================================
  // 4. INSTALLER PRICING VERSIONS (Standard track)
  // =========================================================================
  const installerPricingData: Array<{
    id: string; installerId: string; label: string;
    effectiveFrom: string; rateType: string;
    closerPerW: number; kiloPerW: number;
  }> = [
    { id: 'ipv_esp_v1',      installerId: 'inst_esp',        label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_exo_v1',      installerId: 'inst_exo',        label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_geg_v1',      installerId: 'inst_geg',        label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.70, kiloPerW: 2.15 },
    { id: 'ipv_sunpower_v1', installerId: 'inst_sunpower',   label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.00, kiloPerW: 1.50 },
    { id: 'ipv_complete_v1', installerId: 'inst_complete',    label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_solrite_v1',  installerId: 'inst_solrite',    label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_solnova_v1',  installerId: 'inst_solnova',    label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_exo_old_v1',  installerId: 'inst_exo_old',    label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_bryton_v1',   installerId: 'inst_bryton',     label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.80, kiloPerW: 2.25 },
    { id: 'ipv_one_src_v1',  installerId: 'inst_one_source', label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
    { id: 'ipv_pacific_v1',  installerId: 'inst_pacific',    label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', rateType: 'flat', closerPerW: 2.90, kiloPerW: 2.35 },
  ];

  for (const pv of installerPricingData) {
    await prisma.installerPricingVersion.create({
      data: {
        id: pv.id,
        installerId: pv.installerId,
        label: pv.label,
        effectiveFrom: pv.effectiveFrom,
        effectiveTo: null,
        rateType: pv.rateType,
        tiers: {
          create: [{
            minKW: 0,
            maxKW: null,
            closerPerW: pv.closerPerW,
            setterPerW: null, // auto = closerPerW + 0.10
            kiloPerW: pv.kiloPerW,
            // Sub-dealer rates for select installers (what Kilo pays the sub-dealer per watt)
            ...(pv.installerId === 'inst_esp' ? { subDealerPerW: 2.50 } : {}),
            ...(pv.installerId === 'inst_exo' ? { subDealerPerW: 2.50 } : {}),
            ...(pv.installerId === 'inst_geg' ? { subDealerPerW: 2.30 } : {}),
          }],
        },
      },
    });
  }
  console.log(`  Created ${installerPricingData.length} installer pricing versions`);

  // =========================================================================
  // 5. PRODUCT CATALOG CONFIG (SolarTech)
  // =========================================================================
  await prisma.productCatalogConfig.create({
    data: {
      installerId: 'inst_solartech',
      families: 'Goodleap,Enfin,Lightreach,Cash/HDM/PE',
      familyFinancerMap: JSON.stringify({
        'Goodleap': 'Goodleap',
        'Enfin': 'Enfin',
        'Lightreach': 'LightReach',
        'Cash/HDM/PE': 'Cash',
      }),
      prepaidFamily: 'Cash/HDM/PE',
    },
  });
  console.log('  Created SolarTech product catalog config');

  // =========================================================================
  // 6. SOLARTECH PRODUCTS + PRICING VERSIONS + TIERS
  // =========================================================================
  function makeTiers(closer: number[], kilo: number[]) {
    const breaks = [1, 5, 10, 13];
    return closer.map((c, i) => ({
      minKW: breaks[i],
      maxKW: i < breaks.length - 1 ? breaks[i + 1] : null,
      closerPerW: c,
      setterPerW: Math.round((c + 0.10) * 100) / 100,
      kiloPerW: kilo[i],
    }));
  }

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
    { id: 'ef-qpeak-dc-pw3',   family: 'Enfin',      name: 'Q.Peak DUO DC + Powerwall 3',                   closer: [3.20, 2.85, 2.80, 2.75], kilo: [2.70, 2.30, 2.25, 2.25] },
    { id: 'ef-qpeak-tesla',    family: 'Enfin',      name: 'Q.Peak DUO + Tesla PVI',                        closer: [3.40, 3.05, 2.95, 2.90], kilo: [2.90, 2.50, 2.40, 2.40] },
    { id: 'ef-qpeak-enphase',  family: 'Enfin',      name: 'Q.Peak DUO + Enphase',                          closer: [3.25, 2.90, 2.75, 2.70], kilo: [2.75, 2.35, 2.20, 2.20] },
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

  for (const prod of solarTechProducts) {
    const tiers = makeTiers(prod.closer, prod.kilo);
    await prisma.product.create({
      data: {
        id: prod.id,
        installerId: 'inst_solartech',
        family: prod.family,
        name: prod.name,
        pricingVersions: {
          create: [{
            id: `ppv_${prod.id}_v1`,
            label: 'v1 — Initial',
            effectiveFrom: '2020-01-01',
            effectiveTo: null,
            tiers: {
              create: tiers,
            },
          }],
        },
      },
    });
  }
  console.log(`  Created ${solarTechProducts.length} SolarTech products with pricing`);

  // =========================================================================
  // 7. PROJECTS
  // =========================================================================
  // Map installer names to IDs
  const instMap: Record<string, string> = {
    'ESP': 'inst_esp', 'EXO': 'inst_exo', 'SolarTech': 'inst_solartech',
    'GEG': 'inst_geg', 'SunPower': 'inst_sunpower', 'Complete Solar': 'inst_complete',
    'Solrite': 'inst_solrite', 'Solnova': 'inst_solnova', 'EXO (OLD)': 'inst_exo_old',
    'Bryton': 'inst_bryton', 'One Source': 'inst_one_source', 'Pacific Coast': 'inst_pacific',
  };
  // Map financer names to IDs
  const finMap: Record<string, string> = {
    'Enfin': 'fin_enfin', 'Everbright': 'fin_everbright', 'Mosaic': 'fin_mosaic',
    'Solrite': 'fin_solrite', 'Sunnova': 'fin_sunnova', 'Sunrun': 'fin_sunrun',
    'LightReach': 'fin_lightreach', 'Dividend': 'fin_dividend', 'Wheelhouse': 'fin_wheelhouse',
    'Sungage': 'fin_sungage', 'Goodleap': 'fin_goodleap', 'Participate': 'fin_participate',
    'Credit Human': 'fin_credit_human', 'Cash': 'fin_enfin', // Cash deals use Enfin as placeholder financer
  };
  // Map installer name to pricing version ID
  const pvMap: Record<string, string> = {
    'ESP': 'ipv_esp_v1', 'EXO': 'ipv_exo_v1', 'GEG': 'ipv_geg_v1',
    'SunPower': 'ipv_sunpower_v1', 'Complete Solar': 'ipv_complete_v1',
    'Solrite': 'ipv_solrite_v1', 'Solnova': 'ipv_solnova_v1', 'EXO (OLD)': 'ipv_exo_old_v1',
    'Bryton': 'ipv_bryton_v1', 'One Source': 'ipv_one_src_v1', 'Pacific Coast': 'ipv_pacific_v1',
  };

  const projects = [
    { id: 'proj1',  customerName: 'Robert & Linda Hawkins', closerId: 'rep1', soldDate: '2025-11-05', installer: 'ESP',           financer: 'Goodleap',    productType: 'Loan',  kWSize: 8.4,  netPPW: 3.55, phase: 'PTO',             m1Paid: true,  m1Amount: 1890, m2Paid: true,  m2Amount: 1890, m3Amount: 473,  notes: 'Smooth install, customer very happy.',         flagged: false },
    { id: 'proj2',  customerName: 'Sandra Nguyen',          closerId: 'rep1', soldDate: '2025-12-01', installer: 'EXO',           financer: 'Mosaic',      productType: 'Loan',  kWSize: 6.6,  netPPW: 2.72, phase: 'Installed',        m1Paid: true,  m1Amount: 950,  m2Paid: false, m2Amount: 700,  m3Amount: 175,  notes: 'PTO application submitted.',                 flagged: false },
    { id: 'proj3',  customerName: 'Derek & Amy Collins',    closerId: 'rep1', soldDate: '2026-01-14', installer: 'GEG',           financer: 'Sunrun',      productType: 'PPA',   kWSize: 10.2, netPPW: 3.1,  phase: 'Permitting',      m1Paid: false, m1Amount: 1450, m2Paid: false, m2Amount: 1100, notes: '',                                           flagged: false },
    { id: 'proj4',  customerName: 'Michelle Tran',          closerId: 'rep2', soldDate: '2025-10-22', installer: 'SolarTech',     financer: 'Everbright',  productType: 'Lease', kWSize: 7.8,  netPPW: 2.95, phase: 'PTO',             m1Paid: true,  m1Amount: 1100, m2Paid: true,  m2Amount: 850,  notes: 'Great customer, referral sent.',              flagged: false },
    { id: 'proj5',  customerName: 'Carlos Mendoza',         closerId: 'rep2', soldDate: '2026-01-08', installer: 'Bryton',        financer: 'Dividend',    productType: 'Loan',  kWSize: 9.0,  netPPW: 2.88, phase: 'Design',           m1Paid: false, m1Amount: 1300, m2Paid: false, m2Amount: 975,  notes: 'Waiting on HOA approval.',                   flagged: true },
    { id: 'proj6',  customerName: 'Patricia Kim',           closerId: 'rep2', soldDate: '2026-02-03', installer: 'ESP',           financer: 'Enfin',       productType: 'PPA',   kWSize: 5.4,  netPPW: 3.05, phase: 'Acceptance',       m1Paid: false, m1Amount: 750,  m2Paid: false, m2Amount: 600,  notes: '',                                           flagged: false },
    { id: 'proj7',  customerName: 'William Foster',         closerId: 'rep3', soldDate: '2025-11-30', installer: 'Complete Solar',financer: 'Sungage',     productType: 'Loan',  kWSize: 12.0, netPPW: 2.65, phase: 'Installed',        m1Paid: true,  m1Amount: 1680, m2Paid: false, m2Amount: 1260, m3Amount: 315,  notes: 'Large system, commercial adjacent.',          flagged: false },
    { id: 'proj8',  customerName: 'Helen & Mark Russo',     closerId: 'rep3', soldDate: '2026-01-20', installer: 'Solnova',       financer: 'LightReach',  productType: 'Lease', kWSize: 7.2,  netPPW: 3.0,  phase: 'Site Survey',     m1Paid: false, m1Amount: 1020, m2Paid: false, m2Amount: 765,  notes: '',                                           flagged: false },
    { id: 'proj9',  customerName: 'Gary Thompson',          closerId: 'rep3', soldDate: '2026-02-11', installer: 'EXO',           financer: 'Cash',        productType: 'Cash',  kWSize: 4.8,  netPPW: 3.5,  phase: 'New',             m1Paid: false, m1Amount: 840,  m2Paid: false, m2Amount: 630,  notes: 'Cash deal, fast close expected.',             flagged: false },
    { id: 'proj10', customerName: 'Denise Walker',          closerId: 'rep4', soldDate: '2025-09-14', installer: 'SunPower',      financer: 'Sunnova',     productType: 'Lease', kWSize: 8.0,  netPPW: 3.2,  phase: 'Cancelled',       m1Paid: false, m1Amount: 0,    m2Paid: false, m2Amount: 0,    notes: 'Customer backed out, financing fell through.',flagged: false },
    { id: 'proj11', customerName: 'Bruce & Nancy Patel',    closerId: 'rep4', soldDate: '2026-01-05', installer: 'Pacific Coast', financer: 'Wheelhouse',  productType: 'Loan',  kWSize: 9.6,  netPPW: 2.78, phase: 'Pending Install',  m1Paid: true,  m1Amount: 1344, m2Paid: false, m2Amount: 1008, notes: 'Install scheduled for March.',                flagged: false },
    { id: 'proj12', customerName: 'Laura Jensen',           closerId: 'rep4', soldDate: '2026-02-20', installer: 'Solrite',       financer: 'Solrite',     productType: 'Loan',  kWSize: 6.0,  netPPW: 2.9,  phase: 'Acceptance',      m1Paid: false, m1Amount: 870,  m2Paid: false, m2Amount: 650,  notes: '',                                           flagged: false },
    { id: 'proj13', customerName: 'Kevin & Sara Okonkwo',   closerId: 'rep5', soldDate: '2025-12-15', installer: 'One Source',    financer: 'Credit Human',productType: 'Loan',  kWSize: 11.4, netPPW: 2.7,  phase: 'PTO',             m1Paid: true,  m1Amount: 1596, m2Paid: true,  m2Amount: 1197, m3Amount: 299,  notes: '',                                           flagged: false },
    { id: 'proj14', customerName: 'Fiona Castillo',         closerId: 'rep5', soldDate: '2026-01-28', installer: 'GEG',           financer: 'Participate', productType: 'PPA',   kWSize: 7.5,  netPPW: 3.15, phase: 'Permitting',      m1Paid: false, m1Amount: 1050, m2Paid: false, m2Amount: 790,  notes: 'Permitting taking longer than expected.',    flagged: false },
    { id: 'proj15', customerName: 'Thomas & Gwen Burke',    closerId: 'rep5', soldDate: '2026-02-14', installer: 'ESP',           financer: 'Mosaic',      productType: 'Loan',  kWSize: 8.8,  netPPW: 2.82, phase: 'On Hold',          m1Paid: false, m1Amount: 1232, m2Paid: false, m2Amount: 924,  notes: 'HOA dispute, on hold until resolved.',       flagged: true },
  ];

  for (const p of projects) {
    const isSolarTech = p.installer === 'SolarTech';
    await prisma.project.create({
      data: {
        id: p.id,
        customerName: p.customerName,
        closerId: p.closerId,
        soldDate: p.soldDate,
        installerId: instMap[p.installer],
        financerId: finMap[p.financer],
        productType: p.productType,
        kWSize: p.kWSize,
        netPPW: p.netPPW,
        phase: p.phase,
        m1Paid: p.m1Paid,
        m1Amount: p.m1Amount,
        m2Paid: p.m2Paid,
        m2Amount: p.m2Amount,
        m3Amount: (p as any).m3Amount ?? null,
        notes: p.notes,
        flagged: p.flagged,
        installerPricingVersionId: isSolarTech ? null : pvMap[p.installer] ?? null,
      },
    });
  }
  console.log(`  Created ${projects.length} projects`);

  // =========================================================================
  // 8. PAYROLL ENTRIES
  // =========================================================================
  const payrollEntries = [
    { id: 'pay_p1_m1',  repId: 'rep1', projectId: 'proj1',  amount: 1890, type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2025-11-14', notes: '' },
    { id: 'pay_p1_m2',  repId: 'rep1', projectId: 'proj1',  amount: 1890, type: 'Deal', paymentStage: 'M2', status: 'Paid',    date: '2025-12-19', notes: '' },
    { id: 'pay_p2_m1',  repId: 'rep1', projectId: 'proj2',  amount: 950,  type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2025-12-12', notes: '' },
    { id: 'pay_p2_m2',  repId: 'rep1', projectId: 'proj2',  amount: 700,  type: 'Deal', paymentStage: 'M2', status: 'Draft',   date: '2026-03-28', notes: '' },
    { id: 'pay_p3_m1',  repId: 'rep1', projectId: 'proj3',  amount: 1450, type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2026-01-24', notes: '' },
    { id: 'pay_p4_m1',  repId: 'rep2', projectId: 'proj4',  amount: 1100, type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2025-10-31', notes: '' },
    { id: 'pay_p4_m2',  repId: 'rep2', projectId: 'proj4',  amount: 850,  type: 'Deal', paymentStage: 'M2', status: 'Paid',    date: '2025-12-05', notes: '' },
    { id: 'pay_p5_m1',  repId: 'rep2', projectId: 'proj5',  amount: 1300, type: 'Deal', paymentStage: 'M1', status: 'Pending', date: '2026-01-17', notes: '' },
    { id: 'pay_p6_m1',  repId: 'rep2', projectId: 'proj6',  amount: 750,  type: 'Deal', paymentStage: 'M1', status: 'Draft',   date: '2026-04-04', notes: '' },
    { id: 'pay_p7_m1',  repId: 'rep3', projectId: 'proj7',  amount: 1680, type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2025-12-12', notes: '' },
    { id: 'pay_p7_m2',  repId: 'rep3', projectId: 'proj7',  amount: 1260, type: 'Deal', paymentStage: 'M2', status: 'Pending', date: '2026-03-28', notes: '' },
    { id: 'pay_p8_m1',  repId: 'rep3', projectId: 'proj8',  amount: 1020, type: 'Deal', paymentStage: 'M1', status: 'Pending', date: '2026-01-31', notes: '' },
    { id: 'pay_p11_m1', repId: 'rep4', projectId: 'proj11', amount: 1344, type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2026-01-17', notes: '' },
    { id: 'pay_p12_m1', repId: 'rep4', projectId: 'proj12', amount: 870,  type: 'Deal', paymentStage: 'M1', status: 'Draft',   date: '2026-04-04', notes: '' },
    { id: 'pay_p13_m1', repId: 'rep5', projectId: 'proj13', amount: 1596, type: 'Deal', paymentStage: 'M1', status: 'Paid',    date: '2025-12-26', notes: '' },
    { id: 'pay_p13_m2', repId: 'rep5', projectId: 'proj13', amount: 1197, type: 'Deal', paymentStage: 'M2', status: 'Paid',    date: '2026-01-31', notes: '' },
    { id: 'pay_p14_m1', repId: 'rep5', projectId: 'proj14', amount: 1050, type: 'Deal', paymentStage: 'M1', status: 'Pending', date: '2026-02-07', notes: '' },
    { id: 'pay_p15_m1', repId: 'rep5', projectId: 'proj15', amount: 1232, type: 'Deal', paymentStage: 'M1', status: 'Draft',   date: '2026-02-21', notes: '' },
  ];

  for (const pe of payrollEntries) {
    await prisma.payrollEntry.create({ data: pe });
  }
  console.log(`  Created ${payrollEntries.length} payroll entries`);

  // =========================================================================
  // 9. REIMBURSEMENTS
  // =========================================================================
  const reimbursements = [
    { id: 'reimb1', repId: 'rep1', amount: 45.50, description: 'Gas mileage — site visits',     date: '2026-02-15', status: 'Approved', receiptName: 'receipt_feb.pdf' },
    { id: 'reimb2', repId: 'rep3', amount: 120.0, description: 'Client lunch',                   date: '2026-02-20', status: 'Pending',  receiptName: 'lunch_receipt.jpg' },
    { id: 'reimb3', repId: 'rep5', amount: 30.0,  description: 'Printed marketing materials',    date: '2026-03-01', status: 'Pending',  receiptName: 'print_receipt.pdf' },
  ];

  for (const r of reimbursements) {
    await prisma.reimbursement.create({ data: r });
  }
  console.log(`  Created ${reimbursements.length} reimbursements`);

  // =========================================================================
  // 10. TRAINER ASSIGNMENTS + TIERS
  // =========================================================================
  await prisma.trainerAssignment.create({
    data: {
      id: 'ta1',
      trainerId: 'rep1',
      traineeId: 'rep3',
      tiers: {
        create: [
          { upToDeal: 10,   ratePerW: 0.20, sortOrder: 0 },
          { upToDeal: 25,   ratePerW: 0.10, sortOrder: 1 },
          { upToDeal: null,  ratePerW: 0.05, sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.trainerAssignment.create({
    data: {
      id: 'ta2',
      trainerId: 'rep2',
      traineeId: 'rep5',
      tiers: {
        create: [
          { upToDeal: 10,   ratePerW: 0.20, sortOrder: 0 },
          { upToDeal: null,  ratePerW: 0.10, sortOrder: 1 },
        ],
      },
    },
  });
  console.log('  Created 2 trainer assignments with tiers');

  // =========================================================================
  // 11. INCENTIVES + MILESTONES
  // =========================================================================
  await prisma.incentive.create({
    data: {
      id: 'inc1',
      title: 'Q1 Team Push',
      description: 'Hit 10 deals as a team this quarter and unlock rewards',
      type: 'company',
      metric: 'deals',
      period: 'quarter',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      active: true,
      milestones: {
        create: [
          { id: 'inc1m1', threshold: 5,  reward: 'Team Lunch',               achieved: false },
          { id: 'inc1m2', threshold: 8,  reward: '$200 Bonus Pool',           achieved: false },
          { id: 'inc1m3', threshold: 10, reward: '$500 Bonus Pool + Day Off', achieved: false },
        ],
      },
    },
  });

  await prisma.incentive.create({
    data: {
      id: 'inc2',
      title: 'March Closer Challenge',
      description: 'Personal goal for Alex — close 5 deals in March',
      type: 'personal',
      metric: 'deals',
      period: 'month',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      targetRepId: 'rep1',
      active: true,
      milestones: {
        create: [
          { id: 'inc2m1', threshold: 3, reward: '$150 Bonus', achieved: false },
          { id: 'inc2m2', threshold: 5, reward: '$400 Bonus', achieved: false },
        ],
      },
    },
  });

  await prisma.incentive.create({
    data: {
      id: 'inc3',
      title: 'kW Sprint — Maria',
      description: 'Hit 20 kW sold in Q1',
      type: 'personal',
      metric: 'kw',
      period: 'quarter',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetRepId: 'rep2',
      active: true,
      milestones: {
        create: [
          { id: 'inc3m1', threshold: 10, reward: '$100 Gift Card', achieved: false },
          { id: 'inc3m2', threshold: 20, reward: '$300 Bonus',      achieved: false },
        ],
      },
    },
  });
  console.log('  Created 3 incentives with 7 milestones');

  console.log('\nSeed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
