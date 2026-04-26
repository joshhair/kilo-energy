/**
 * import-glide.mts — one-shot Glide → Kilo data migration.
 *
 * Reads six CSVs exported from Glide (see plan doc), transforms them
 * into Kilo's Prisma schema shape, and writes via the existing API
 * contract (wire dollars; the API seam converts to cents).
 *
 * Run in DRY-RUN by default. Pass `--commit` to actually write.
 *
 *   tsx scripts/import-glide.mts                    # dry-run, default
 *   tsx scripts/import-glide.mts --commit           # real write
 *   GLIDE_CSV_DIR=/path/to/dir tsx scripts/import-glide.mts
 *
 * Required env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN.
 *
 * Authoritative doc: ~/.claude/plans/bubbly-sleeping-mountain.md
 * (also in repo commit message of the import run).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { PrismaLibSql } from '@prisma/adapter-libsql';

// ─── Wiring ─────────────────────────────────────────────────────────────────

const COMMIT = process.argv.includes('--commit');
const MODE = COMMIT ? 'COMMIT' : 'DRY-RUN';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL + TURSO_AUTH_TOKEN must be in env');
  process.exit(1);
}
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

// Default locations Josh downloaded the CSVs to.
const DEFAULT_DIR = 'C:/Users/Jarvis/Downloads';
const DIR = process.env.GLIDE_CSV_DIR ?? DEFAULT_DIR;
const FILE = {
  deals:       path.join(DIR, '8991f4.Deals (1).csv'),
  reps:        path.join(DIR, 'Reps.csv'),
  commission:  path.join(DIR, '358220.Deal  Commission.csv'),
  payments:    path.join(DIR, 'e64b45.Deal  Commission  Payments.csv'),
  reimbs:      path.join(DIR, '76d60d.Rep  Reimbursements.csv'),
  notes:       path.join(DIR, 'bba733.Deal  Note.csv'),
};

// ─── CSV loader ─────────────────────────────────────────────────────────────

function loadCsv(filePath: string): Record<string, unknown>[] {
  try {
    const buf = readFileSync(filePath);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err);
    process.exit(1);
  }
}

// xlsx mangles the lock emoji in "🔒 Row ID" to invalid UTF-8, so the key
// ends up as "ð Row ID" or similar. Normalize: when asked for "Row ID",
// find whatever key actually ends with "Row ID" on this row and use that.
function findRowIdKey(r: Record<string, unknown>): string | null {
  for (const k of Object.keys(r)) {
    if (k === '🔒 Row ID' || k.endsWith(' Row ID') || k === 'Row ID') return k;
  }
  return null;
}

const get = (r: Record<string, unknown>, k: string): string => {
  if (k === '🔒 Row ID') {
    const actualKey = findRowIdKey(r);
    return actualKey ? String(r[actualKey] ?? '').trim() : '';
  }
  return String(r[k] ?? '').trim();
};
const getNum = (r: Record<string, unknown>, k: string): number => {
  const v = get(r, k);
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const getDate = (r: Record<string, unknown>, k: string): string | null => {
  const v = get(r, k);
  if (!v) return null;
  // Glide exports dates as ISO (2024-01-19T00:00:00.000Z) — we want YYYY-MM-DD.
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
};

// ─── Identity rules ─────────────────────────────────────────────────────────

const EMAIL_MERGES: Record<string, string> = {
  'jd.marketing83@gmail.com':   'josh@kiloenergies.com',
  'rebekahc@jdmsolarpros.com':  'rebekah@kiloenergies.com',
};
const SKIP_EMAILS = new Set(['jens@v88.co.uk']);   // Glide dev — no Kilo row
const PLACEHOLDER_EMAIL = /^\d+@gmail\.com$/;      // 19@gmail.com etc.

function classifyRep(r: Record<string, unknown>): {
  email: string;
  firstName: string;
  lastName: string;
  role: 'rep' | 'sub-dealer';
  repType: 'closer' | 'setter' | 'both';
  active: boolean;
} {
  const email = get(r, 'Email').toLowerCase();
  const firstName = get(r, 'First Name');
  const lastName = get(r, 'Last Name');
  const isSubDealer = get(r, 'Sub Dealer?').toLowerCase() === 'true';
  const searchType = get(r, 'Setter Search').toLowerCase();
  let repType: 'closer' | 'setter' | 'both' = 'both';
  if (searchType === 'closer') repType = 'closer';
  else if (searchType === 'setter') repType = 'setter';
  return {
    email,
    firstName,
    lastName,
    role: isSubDealer ? 'sub-dealer' : 'rep',
    repType,
    active: !PLACEHOLDER_EMAIL.test(email),
  };
}

// ─── Phase / payment-type / status mappings ────────────────────────────────

// Discovered mostly from sample rows. Dry-run reports unmapped values.
// Phase resolution is two-step because Glide uses Status 1 as a bucket
// (active/inactive/-) and Status 2 as the actual pipeline phase (pto,
// installed, pending, …). We read Status 2 first, fall back to
// milestone-state inference when Status 2 is blank.

const PHASE_MAP_S2: Record<string, string> = {
  'pto':           'PTO',
  'installed':     'Installed',
  'pending':       'Pending Install',
  'permitting':    'Permitting',
  'design':        'Design',
  'survey':        'Site Survey',
  'site survey':   'Site Survey',
  'new':           'New',
  'acceptance':    'Acceptance',
  'accepted':      'Acceptance',
  'sold':          'Acceptance',
  'completed':     'Completed',
  'complete':      'Completed',
  'on hold':       'On Hold',
  'cancelled':     'Cancelled',
  // NOTE: 'unresponsive' handled specially in resolvePhase — see below.
};

function resolvePhase(
  status1: string,
  status2: string,
  m1Amount: number,
  m2Amount: number,
  m3Amount: number,
): { kilo: string; source: string } {
  const s1 = status1.trim().toLowerCase();
  const s2 = status2.trim().toLowerCase();
  // "unresponsive" = Glide's kill switch for ghosted customers. Many of
  // these still hit install milestones before going dark, so we use the
  // money trail to preserve that signal instead of blanket-Cancelling.
  if (s2 === 'unresponsive') {
    if (m3Amount > 0) return { kilo: 'Completed',  source: 'unresponsive+M3 paid' };
    if (m2Amount > 0) return { kilo: 'Installed',  source: 'unresponsive+M2 paid' };
    if (m1Amount > 0) return { kilo: 'Acceptance', source: 'unresponsive+M1 paid' };
    return { kilo: 'Cancelled', source: 'unresponsive+no money' };
  }
  // Status 2 is the real phase when present.
  if (PHASE_MAP_S2[s2]) return { kilo: PHASE_MAP_S2[s2], source: `status2=${s2}` };
  // Status 2 blank or unknown — infer from milestone payments received.
  if (m3Amount > 0) return { kilo: 'Completed', source: 'inferred:M3 paid' };
  if (m2Amount > 0 && m1Amount > 0) return { kilo: 'Installed', source: 'inferred:M1+M2 paid' };
  if (m1Amount > 0) return { kilo: 'Acceptance', source: 'inferred:M1 paid' };
  // Cap at Cancelled for inactive-with-no-money deals (Glide's dead pool).
  if (s1 === 'inactive') return { kilo: 'Cancelled', source: 'status1=inactive+no money' };
  return { kilo: 'New', source: 'default' };
}

const PAYMENT_TYPE_TO_STAGE: Record<string, string> = {
  'up front': 'M1',
  'final':    'M2',
  'extra':    'Bonus',
};
const STATUS_MAP: Record<string, string> = {
  'paid':    'Paid',
  'draft':   'Draft',
  'pending': 'Pending',
};

// Names of known productTypes that show up in Glide's Financer column by
// mistake. We reclassify rather than fail the deal.
const PRODUCT_TYPE_VALUES = new Set(['PPA', 'Lease', 'Loan', 'Cash']);

// Glide installer name → Kilo installer name alias. When Josh used a
// suffixed label ("EXO (Sunnova)") for what's the same underlying
// installer in Kilo, alias it here instead of failing the deal.
const INSTALLER_ALIASES: Record<string, string> = {
  'exo (sunnova)': 'EXO',
};

// ─── Main ───────────────────────────────────────────────────────────────────

type GlideId = string;
type KiloId = string;

interface Summary {
  label: string;
  lines: string[];
}
const summaries: Summary[] = [];
function push(label: string, ...lines: string[]) {
  summaries.push({ label, lines });
}

async function main() {
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║ Glide → Kilo import — ${MODE.padEnd(35)}║`);
  console.log(`║ Source: ${DIR.padEnd(50)}║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  // ── Load all CSVs ────────────────────────────────────────────────────────
  const dealsRows       = loadCsv(FILE.deals);
  const repsRows        = loadCsv(FILE.reps);
  const commissionRows  = loadCsv(FILE.commission);
  const paymentsRows    = loadCsv(FILE.payments);
  const reimbsRows      = loadCsv(FILE.reimbs);
  const notesRows       = loadCsv(FILE.notes);

  console.log(`CSV row counts:`);
  console.log(`  Deals        ${dealsRows.length}`);
  console.log(`  Reps         ${repsRows.length}`);
  console.log(`  Commission   ${commissionRows.length}`);
  console.log(`  Payments     ${paymentsRows.length}`);
  console.log(`  Reimburse    ${reimbsRows.length}`);
  console.log(`  Notes        ${notesRows.length}`);
  console.log('');

  // ── Stage 1: Users ───────────────────────────────────────────────────────
  console.log('── Stage 1 — Users ──');
  const glideUserIdToKiloId = new Map<GlideId, KiloId>();
  const existingUsers = await prisma.user.findMany();
  const existingByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

  let usersCreated = 0, usersMerged = 0, usersSkipped = 0, usersInactive = 0;
  const createdUserEmails: string[] = [];
  for (const row of repsRows) {
    const glideId = get(row, '🔒 Row ID');
    if (!glideId) continue;
    const cls = classifyRep(row);
    if (!cls.email) continue;
    if (SKIP_EMAILS.has(cls.email)) {
      usersSkipped++;
      continue;
    }
    const mergeTo = EMAIL_MERGES[cls.email];
    const targetEmail = mergeTo ?? cls.email;
    const existing = existingByEmail.get(targetEmail);

    if (existing) {
      glideUserIdToKiloId.set(glideId, existing.id);
      usersMerged++;
      continue;
    }

    // New user — create on commit.
    if (!cls.active) usersInactive++;
    if (COMMIT) {
      const created = await prisma.user.create({
        data: {
          firstName: cls.firstName,
          lastName:  cls.lastName,
          email:     cls.email,
          role:      cls.role,
          repType:   cls.repType,
          active:    cls.active,
        },
      });
      glideUserIdToKiloId.set(glideId, created.id);
      existingByEmail.set(cls.email, created);
    } else {
      // Dry-run: use a placeholder Kilo ID so downstream stages can trace.
      glideUserIdToKiloId.set(glideId, `DRY_${glideId.slice(0, 8)}`);
    }
    createdUserEmails.push(cls.email);
    usersCreated++;
  }
  push('Users',
    `  ${usersCreated} ${COMMIT ? 'created' : 'would create'} (${usersInactive} inactive placeholders)`,
    `  ${usersMerged} merged into existing (Josh, Rebekah, etc.)`,
    `  ${usersSkipped} skipped (Jens)`,
  );

  // ── Stage 2: Installer + Financer maps ───────────────────────────────────
  console.log('── Stage 2 — Installer / Financer lookups ──');
  const installers = await prisma.installer.findMany();
  const financers = await prisma.financer.findMany();
  const instByName = new Map(installers.map((i) => [i.name.toLowerCase(), i]));
  const finByName  = new Map(financers.map((f) => [f.name.toLowerCase(), f]));
  const cashFinancer = financers.find((f) => f.name.toLowerCase() === 'cash');

  // Collect distinct Glide names that we'll try to match.
  const unknownInstallers = new Set<string>();
  const unknownFinancers  = new Set<string>();
  for (const row of dealsRows) {
    const iName = get(row, 'Installer / Text');
    const fName = get(row, 'Financer / text');
    if (iName && !instByName.has(iName.toLowerCase())) unknownInstallers.add(iName);
    if (fName && !finByName.has(fName.toLowerCase()) && !PRODUCT_TYPE_VALUES.has(fName)) {
      unknownFinancers.add(fName);
    }
  }
  // Build glide-internal Installer / ID → Installer / Text map from rows
  // where BOTH are populated. This recovers 200+ deals where the Text column
  // is blank in Glide but the ID column still points at a real installer.
  const glideInstallerIdToText = new Map<string, string>();
  const glideInstallerIdTextVotes: Record<string, Record<string, number>> = {};
  for (const row of dealsRows) {
    const id = get(row, 'Installer / ID');
    const text = get(row, 'Installer / Text');
    if (!id || !text) continue;
    if (!glideInstallerIdTextVotes[id]) glideInstallerIdTextVotes[id] = {};
    glideInstallerIdTextVotes[id][text] = (glideInstallerIdTextVotes[id][text] ?? 0) + 1;
  }
  for (const [id, votes] of Object.entries(glideInstallerIdTextVotes)) {
    // Winner by vote count; ties broken by alphabetical for determinism.
    const winner = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    glideInstallerIdToText.set(id, winner);
  }

  push('Installer / Financer lookups',
    `  ${instByName.size} Kilo installers, ${finByName.size} Kilo financers available`,
    `  ${glideInstallerIdToText.size} Glide installer IDs recovered from populated rows (fallback for blank-text rows)`,
    `  ${unknownInstallers.size} unmapped installer names: ${[...unknownInstallers].join(', ') || '(none)'}`,
    `  ${unknownFinancers.size} unmapped financer names: ${[...unknownFinancers].join(', ') || '(none)'}`,
    `  (Glide financer values matching a productType — "${[...PRODUCT_TYPE_VALUES].join('/')} — reclassified, not flagged.)`,
  );

  // ── Stage 3: Commission CSV — index per Glide deal ID + rep type ────────
  console.log('── Stage 3 — Indexing Commission rows ──');
  // Commission.csv: one row per rep per deal. Rep Types observed in
  // the export: closer (464), setter (442), trainer (139), self (113).
  //
  // Normalization:
  //   - 'self' = self-gen deal where one person is both closer and
  //     setter. Normalize to 'closer' — Kilo has no native "self" role;
  //     Project.setterId stays null. The rep still earns everything.
  //   - 'trainer' = trainer override row for a deal. Doesn't affect the
  //     Project row at all; becomes a Trainer PayrollEntry at payment
  //     time (Commission Payments CSV handles the money). We skip
  //     trainer rows here.
  interface CommissionRow {
    glideUserId: GlideId;
    repType: 'closer' | 'setter';
    baseline: number;
    override: number;
    totalAmount: number;
    upfrontPay: number;
    payment1: number;
    payment2: number;
  }
  const commissionByDeal = new Map<GlideId, CommissionRow[]>();
  for (const row of commissionRows) {
    const dealId = get(row, 'Deal / ID');
    const userId = get(row, 'User / ID');
    const rawType = get(row, 'Rep Type').toLowerCase();
    if (!dealId || !userId) continue;
    let repType: 'closer' | 'setter';
    if (rawType === 'closer' || rawType === 'self') repType = 'closer';
    else if (rawType === 'setter') repType = 'setter';
    else continue;   // skip 'trainer' + blank rows
    const list = commissionByDeal.get(dealId) ?? [];
    list.push({
      glideUserId: userId,
      repType,
      baseline:    getNum(row, 'Baseline'),
      override:    getNum(row, 'Override'),
      totalAmount: getNum(row, 'Total Amount'),
      upfrontPay:  getNum(row, 'Upfront Pay'),
      payment1:    getNum(row, 'Payments | Payment 1 / Amount'),
      payment2:    getNum(row, 'Payments | Payment 2 / Amount'),
    });
    commissionByDeal.set(dealId, list);
  }

  // ── Stage 4: Deals → Projects ────────────────────────────────────────────
  console.log('── Stage 4 — Deals → Projects ──');
  const glideDealIdToKiloId = new Map<GlideId, KiloId>();
  let dealsCreated = 0, dealsSkipped = 0, installerFallbackCount = 0;
  const installerFallbackDeals: string[] = [];
  const phaseCounts: Record<string, number> = {};
  const unmappedPhaseValues = new Set<string>();
  const reasons: string[] = [];

  for (const row of dealsRows) {
    const glideDealId = get(row, '🔒 Row ID');
    if (!glideDealId) continue;

    const customerName = get(row, 'Customer Name');
    const soldDate = getDate(row, 'Sold Date');
    const kWSize = getNum(row, 'KW System Size (Exact)');
    const soldPPW = getNum(row, 'Sold PPW');
    // Installer text — fall back to ID→name map when Glide's Text column is blank.
    let installerName = get(row, 'Installer / Text');
    let installerFallbackUsed = false;
    if (!installerName) {
      const instId = get(row, 'Installer / ID');
      if (instId) installerName = glideInstallerIdToText.get(instId) ?? '';
    }
    // Final fallback per Josh: default truly-unknown installers to ESP (most
    // common installer) so the deal survives; Josh fixes the handful manually.
    if (!installerName) {
      installerName = 'ESP';
      installerFallbackUsed = true;
    }
    let financerName = get(row, 'Financer / text');
    let productType = get(row, 'Product Type / text');
    const status1 = get(row, 'Status 1 / ID');
    const status2 = get(row, 'Status 2 / ID');
    // Milestone amounts (used both for phase inference + to set on Project)
    const m1AmountForPhase = getNum(row, 'Received | M1 / Amount');
    const m2AmountForPhase = getNum(row, 'Received | M2 / Amount');
    const m3AmountForPhase = getNum(row, 'Received | M3 / Amount');
    const { kilo: phase, source: phaseSource } = resolvePhase(status1, status2, m1AmountForPhase, m2AmountForPhase, m3AmountForPhase);
    if (phaseSource === 'default' && (status1 || status2)) unmappedPhaseValues.add(`${status1 || '(blank)'} / ${status2 || '(blank)'}`);
    // Phase count incremented later, AFTER the skip check, so the summary
    // reflects only imported deals — not skipped placeholders.

    // Required fields — relaxed. Many Glide records are half-finished
    // drafts (kW=0, blank sold date). We preserve them all so Josh has
    // a full audit trail; he can delete junk via the UI post-import.
    // Absolute minimums: customer name + installer (the FK requirement).
    if (!customerName || !installerName) {
      dealsSkipped++;
      const missing = !customerName && !installerName ? 'both' : !customerName ? 'customerName' : 'installerName';
      reasons.push(`${glideDealId.slice(0, 8)}: missing ${missing} [customer="${customerName}" installer="${installerName}" soldDate="${soldDate}" status1="${status1}" status2="${status2}"]`);
      continue;
    }
    // Sold date fallback — required by schema; use 2023-01-01 as sentinel
    // so the row is preserved but obviously placeholder.
    const effectiveSoldDate = soldDate || '2023-01-01';

    // Installer lookup (with alias fallback)
    const lowerInst = installerName.toLowerCase();
    const aliased = INSTALLER_ALIASES[lowerInst];
    const installer = instByName.get(lowerInst) || (aliased ? instByName.get(aliased.toLowerCase()) : undefined);
    if (!installer) {
      dealsSkipped++;
      reasons.push(`${glideDealId.slice(0, 8)}: installer "${installerName}" not in Kilo`);
      continue;
    }

    // Financer: reclassify productType-valued financers.
    if (PRODUCT_TYPE_VALUES.has(financerName)) {
      if (!productType) productType = financerName;
      financerName = 'Cash';
    }
    let financer = finByName.get(financerName.toLowerCase());
    if (!financer) financer = cashFinancer;
    if (!financer) {
      dealsSkipped++;
      reasons.push(`${glideDealId.slice(0, 8)}: no financer + no Cash fallback`);
      continue;
    }
    if (!productType) productType = 'Loan'; // safe default

    // Closer / setter resolution. Primary path: Commission CSV (has
    // both the glide user ID + the baseline used). Fallback: Deals CSV
    // `User | Closers / ID's` column when the deal has no Commission row
    // (common for pre-earn-state drafts).
    const commissions = (commissionByDeal.get(glideDealId) ?? []).slice();
    const closers = commissions.filter((c) => c.repType === 'closer');
    const setters = commissions.filter((c) => c.repType === 'setter');
    const primaryCloser = closers[0];
    const primarySetter = setters[0];

    let closerId: string | undefined;
    if (primaryCloser) {
      closerId = glideUserIdToKiloId.get(primaryCloser.glideUserId);
    } else {
      const fallbackCloserGlideId = get(row, "User | Closers / ID's") || get(row, 'User 1 / Row Owner');
      if (fallbackCloserGlideId) {
        closerId = glideUserIdToKiloId.get(fallbackCloserGlideId);
      }
    }
    if (!closerId) {
      dealsSkipped++;
      reasons.push(`${glideDealId.slice(0, 8)}: no resolvable closer (commission+fallback both empty)`);
      continue;
    }
    let setterId: string | undefined;
    if (primarySetter) {
      setterId = glideUserIdToKiloId.get(primarySetter.glideUserId);
    } else {
      const fallbackSetterGlideId = get(row, "User | Setters / ID's");
      if (fallbackSetterGlideId && fallbackSetterGlideId !== get(row, "User | Closers / ID's")) {
        setterId = glideUserIdToKiloId.get(fallbackSetterGlideId);
      }
    }

    // Milestone amounts from the Deals CSV's Received columns (closer side).
    // Already computed above for phase inference — reuse.
    const m1Amount = m1AmountForPhase;
    const m2Amount = m2AmountForPhase;
    const m3Amount = m3AmountForPhase;

    // Setter amounts from Glide's per-setter columns. (Setter 1 final amount.)
    const setterM1Amount = getNum(row, 'User | Setter 1 / Final Amount') || 0;
    const setterM2Amount = 0; // Glide doesn't split setter over milestones in the CSV.
    const setterM3Amount = 0;

    // baselineOverrideJson — per-deal baseline snapshot. Per Josh's spec.
    const closerPerW = primaryCloser.baseline || null;
    const setterPerW = primarySetter ? (primarySetter.baseline || null) : null;
    // kiloPerW: try Kilo Revenue copy / (kWSize × 1000) first.
    const kiloRevenue = getNum(row, 'Kilo Revenue copy');
    let kiloPerW: number | null = null;
    if (kiloRevenue > 0 && kWSize > 0) {
      kiloPerW = Math.round((kiloRevenue / (kWSize * 1000)) * 100) / 100;
    }
    const baselineOverride = closerPerW || kiloPerW || setterPerW
      ? { closerPerW: closerPerW ?? 0, kiloPerW: kiloPerW ?? 0, ...(setterPerW ? { setterPerW } : {}) }
      : null;

    // Cancellation
    const cancellationReason = phase === 'Cancelled' ? get(row, 'Status 1 / Cancellation Reason') || null : null;

    // Notes — Glide's "Note / Rep Note" textarea content lands in a
    // ProjectAdminNote (admin-only) instead of Project.notes (rep-
    // visible). Same rationale as the Stage 8 deal-notes treatment:
    // historical Glide note content can include comp adjustments,
    // cancellation backstory, and other admin context that shouldn't
    // be exposed to reps in the new app. Project.notes itself is left
    // empty for Glide-imported projects so reps see a clean Notes
    // section they can populate themselves going forward.
    const glideRepNote = get(row, 'Note / Rep Note').slice(0, 2000);

    const dealData = {
      customerName,
      closerId,
      setterId: setterId ?? null,
      soldDate: effectiveSoldDate,
      installerId: installer.id,
      financerId: financer.id,
      productType,
      kWSize,
      netPPW: soldPPW,
      phase,
      m1Paid: m1Amount > 0,
      m1AmountCents: Math.round(m1Amount * 100),
      m2Paid: m2Amount > 0,
      m2AmountCents: Math.round(m2Amount * 100),
      m3Paid: m3Amount > 0,
      m3AmountCents: m3Amount > 0 ? Math.round(m3Amount * 100) : null,
      setterM1AmountCents: Math.round(setterM1Amount * 100),
      setterM2AmountCents: Math.round(setterM2Amount * 100),
      setterM3AmountCents: setterM3Amount > 0 ? Math.round(setterM3Amount * 100) : null,
      // Project.notes intentionally cleared for Glide imports — content
      // moves to ProjectAdminNote below.
      notes: '',
      cancellationReason,
      baselineOverrideJson: baselineOverride ? JSON.stringify(baselineOverride) : null,
    };

    if (COMMIT) {
      const created = await prisma.project.create({ data: dealData });
      glideDealIdToKiloId.set(glideDealId, created.id);
      // Persist the legacy Glide rep-note as an admin-only note attributed
      // to the closer (or to Josh as a fallback) so authorship is preserved.
      if (glideRepNote.trim().length > 0) {
        const noteAuthorId = closerId;
        const noteAuthor = existingUsers.find((u) => u.id === noteAuthorId);
        const noteAuthorName = noteAuthor ? `${noteAuthor.firstName} ${noteAuthor.lastName}` : 'Glide Import';
        await prisma.projectAdminNote.create({
          data: {
            projectId: created.id,
            authorId: noteAuthorId,
            authorName: noteAuthorName,
            text: glideRepNote,
            createdAt: new Date(effectiveSoldDate + 'T12:00:00'),
          },
        });
      }
    } else {
      glideDealIdToKiloId.set(glideDealId, `DRY_${glideDealId.slice(0, 8)}`);
    }
    dealsCreated++;
    phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;
    if (installerFallbackUsed) {
      installerFallbackCount++;
      installerFallbackDeals.push(`${glideDealId.slice(0, 8)} ${customerName}`);
    }
  }

  // Write the full skip list to an auditable text file. Josh can open
  // this, spot-check any Glide row by its Row ID prefix, and confirm
  // whether the skip was correct before committing.
  if (reasons.length > 0) {
    const skipLogPath = path.join(process.cwd(), 'state', 'glide-import-skipped.txt');
    const skipLog = [
      `# Glide import — skipped deals`,
      `# Generated: ${new Date().toISOString()}`,
      `# Mode: ${MODE}`,
      `# Total skipped: ${reasons.length}`,
      ``,
      ...reasons,
    ].join('\n');
    writeFileSync(skipLogPath, skipLog, 'utf8');
  }

  push('Deals',
    `  ${dealsCreated} ${COMMIT ? 'created' : 'would create'}, ${dealsSkipped} skipped`,
    `  Phase distribution: ${Object.entries(phaseCounts).map(([p, n]) => `${p}=${n}`).join(', ')}`,
    unmappedPhaseValues.size > 0
      ? `  Unmapped phase combos (defaulted): ${[...unmappedPhaseValues].slice(0, 8).join('; ')}${unmappedPhaseValues.size > 8 ? ` … and ${unmappedPhaseValues.size - 8} more` : ''}`
      : `  Phase mapping: 100% clean`,
    installerFallbackCount > 0
      ? `  ⚠ ${installerFallbackCount} deals defaulted to ESP (installer unknown in Glide): ${installerFallbackDeals.slice(0, 10).join(', ')}${installerFallbackDeals.length > 10 ? '…' : ''}`
      : '',
    ...reasons.slice(0, 5).map((r) => `  SKIP: ${r}`),
    reasons.length > 5 ? `  … and ${reasons.length - 5} more in state/glide-import-skipped.txt` : '',
  );

  // ── Stage 5: Co-parties (ProjectCloser / ProjectSetter) ──────────────────
  console.log('── Stage 5 — Co-parties ──');
  let coClosersCreated = 0, coSettersCreated = 0;
  for (const [glideDealId, commissions] of commissionByDeal.entries()) {
    const kiloProjectId = glideDealIdToKiloId.get(glideDealId);
    if (!kiloProjectId || kiloProjectId.startsWith('DRY_')) {
      // Skipped deal or dry-run mode: don't write, but count.
    }
    const extraClosers = commissions.filter((c) => c.repType === 'closer').slice(1);
    const extraSetters = commissions.filter((c) => c.repType === 'setter').slice(1);
    for (const [i, co] of extraClosers.entries()) {
      const userId = glideUserIdToKiloId.get(co.glideUserId);
      if (!userId) continue;
      if (COMMIT && kiloProjectId && !kiloProjectId.startsWith('DRY_')) {
        await prisma.projectCloser.create({
          data: {
            projectId: kiloProjectId,
            userId,
            m1AmountCents: Math.round(co.upfrontPay * 100),
            m2AmountCents: Math.round(co.payment1 * 100),
            m3AmountCents: co.payment2 > 0 ? Math.round(co.payment2 * 100) : null,
            position: i + 1,
          },
        });
      }
      coClosersCreated++;
    }
    for (const [i, co] of extraSetters.entries()) {
      const userId = glideUserIdToKiloId.get(co.glideUserId);
      if (!userId) continue;
      if (COMMIT && kiloProjectId && !kiloProjectId.startsWith('DRY_')) {
        await prisma.projectSetter.create({
          data: {
            projectId: kiloProjectId,
            userId,
            m1AmountCents: Math.round(co.upfrontPay * 100),
            m2AmountCents: Math.round(co.payment1 * 100),
            m3AmountCents: co.payment2 > 0 ? Math.round(co.payment2 * 100) : null,
            position: i + 1,
          },
        });
      }
      coSettersCreated++;
    }
  }
  push('Co-parties',
    `  ${coClosersCreated} ProjectCloser rows (${COMMIT ? 'created' : 'would create'})`,
    `  ${coSettersCreated} ProjectSetter rows (${COMMIT ? 'created' : 'would create'})`,
  );

  // ── Stage 6: Commission Payments → PayrollEntry ──────────────────────────
  console.log('── Stage 6 — Payments ──');
  // Glide auto-populates draft rows for M1/M2/M3 at deal creation regardless
  // of whether the milestone was actually hit. Kilo's own phase-transition
  // logic regenerates drafts when projects advance — so importing Glide's
  // pre-populated drafts would double-create. Only Paid rows cross the line
  // (historical truth); Draft/Pending are skipped entirely.
  let paymentsCreated = 0, paymentsSkipped = 0, paymentsSkippedDraft = 0;
  const statusDist: Record<string, number> = {};
  for (const row of paymentsRows) {
    const glideDealId = get(row, 'Deal / ID');
    const glideUserId = get(row, 'User / ID');
    const paymentType = get(row, 'Payment Type / ID').toLowerCase();
    const stage = PAYMENT_TYPE_TO_STAGE[paymentType];
    const statusRaw = get(row, 'Status / ID').toLowerCase();
    const status = STATUS_MAP[statusRaw] ?? 'Draft';
    const amount = getNum(row, 'Amount');
    const date = getDate(row, 'Date') ?? soldDateFallback(commissionByDeal, glideDealId);
    const note = get(row, 'Note').slice(0, 1000);

    const kiloProjectId = glideDealIdToKiloId.get(glideDealId);
    const kiloUserId = glideUserIdToKiloId.get(glideUserId);
    if (!stage || !kiloProjectId || !kiloUserId || !date || amount === 0) {
      paymentsSkipped++;
      continue;
    }
    // Only Paid rows import. Draft/Pending are Glide artifacts — Kilo
    // regenerates them via phase-transition logic when milestones hit.
    if (status !== 'Paid') {
      paymentsSkippedDraft++;
      continue;
    }
    statusDist[status] = (statusDist[status] ?? 0) + 1;
    if (COMMIT && !kiloProjectId.startsWith('DRY_') && !kiloUserId.startsWith('DRY_')) {
      await prisma.payrollEntry.create({
        data: {
          repId: kiloUserId,
          projectId: kiloProjectId,
          amountCents: Math.round(amount * 100),
          type: stage === 'Bonus' ? 'Bonus' : 'Deal',
          paymentStage: stage,
          status,
          date,
          notes: note,
        },
      });
    }
    paymentsCreated++;
  }
  push('Payments',
    `  ${paymentsCreated} PayrollEntry rows (${COMMIT ? 'created' : 'would create'}), ${paymentsSkipped} skipped (unresolved FK / no amount)`,
    `  ${paymentsSkippedDraft} Draft/Pending rows skipped (Glide pre-population — Kilo will regenerate via phase transitions)`,
    `  Status distribution (imported): ${Object.entries(statusDist).map(([s, n]) => `${s}=${n}`).join(', ')}`,
  );

  // ── Stage 7: Reimbursements ──────────────────────────────────────────────
  console.log('── Stage 7 — Reimbursements ──');
  let reimbsCreated = 0;
  for (const row of reimbsRows) {
    const glideUserId = get(row, 'Rep / ID');
    const kiloUserId = glideUserIdToKiloId.get(glideUserId);
    if (!kiloUserId) continue;
    const amount = getNum(row, 'Amount');
    const description = get(row, 'Description');
    const date = getDate(row, 'Date');
    const fileUrl = get(row, 'File');
    const receiptName = fileUrl ? fileUrl.split('/').pop()?.split('?')[0] ?? null : null;
    if (!date || amount === 0) continue;
    if (COMMIT && !kiloUserId.startsWith('DRY_')) {
      await prisma.reimbursement.create({
        data: {
          repId: kiloUserId,
          amountCents: Math.round(amount * 100),
          description: description || '(no description)',
          date,
          status: 'Approved',
          receiptName,
        },
      });
    }
    reimbsCreated++;
  }
  push('Reimbursements',
    `  ${reimbsCreated} rows (${COMMIT ? 'created' : 'would create'})`,
    `  (receipt image files not migrated — URLs preserved as receiptName only)`,
  );

  // ── Stage 8: Deal Notes → ProjectAdminNote ──────────────────────────────
  // Glide-imported notes land in ProjectAdminNote (admin-only) instead
  // of ProjectMessage (rep-visible Chatter). Glide notes can contain
  // historical context, comp adjustments, and customer-resolution detail
  // that should NOT be exposed to reps in the new app — admins explicitly
  // asked for these to be admin-only. ProjectAdminNote is enforced as
  // admin/internal-PM only at the API endpoint boundary.
  console.log('── Stage 8 — Notes ──');
  let notesCreated = 0, notesSkipped = 0, notesFallbackAuthor = 0;
  // Fall back to Josh's user when a note's author isn't resolvable —
  // better to preserve the historical note content than drop it
  // entirely over attribution. The note body still has the original
  // author name in the text if they signed it.
  const joshUser = existingUsers.find((u) => u.email === 'josh@kiloenergies.com');

  for (const row of notesRows) {
    const text = get(row, 'Note');
    if (!text) { notesSkipped++; continue; }
    const glideDealId = get(row, 'Deal / ID');
    const glideAuthorId = get(row, 'Author / ID');
    const kiloProjectId = glideDealIdToKiloId.get(glideDealId);
    let kiloAuthorId = glideUserIdToKiloId.get(glideAuthorId);
    if (!kiloAuthorId && joshUser) {
      kiloAuthorId = joshUser.id;
      notesFallbackAuthor++;
    }
    if (!kiloProjectId || !kiloAuthorId) { notesSkipped++; continue; }
    const authorUser = existingUsers.find((u) => u.id === kiloAuthorId)
      ?? (await prisma.user.findUnique({ where: { id: kiloAuthorId } }).catch(() => null));
    const authorName = authorUser ? `${authorUser.firstName} ${authorUser.lastName}` : 'Unknown';
    const timestamp = get(row, 'Timestamp');
    const createdAt = timestamp ? new Date(timestamp) : new Date();
    if (COMMIT && !kiloProjectId.startsWith('DRY_') && !kiloAuthorId.startsWith('DRY_')) {
      await prisma.projectAdminNote.create({
        data: {
          projectId: kiloProjectId,
          authorId: kiloAuthorId,
          authorName,
          text,
          createdAt,
        },
      });
    }
    notesCreated++;
  }
  push('Notes',
    `  ${notesCreated} ProjectAdminNote rows (${COMMIT ? 'created' : 'would create'}, admin-only)`,
    `  ${notesSkipped} skipped (empty text or unresolved project FK)`,
    notesFallbackAuthor > 0 ? `  ${notesFallbackAuthor} notes attributed to Josh (original author not in user map)` : '',
  );

  // ── Stage 9: Audit log ───────────────────────────────────────────────────
  if (COMMIT) {
    await prisma.auditLog.create({
      data: {
        actorUserId: null,
        actorEmail: 'glide-import-script',
        action: 'glide_import',
        entityType: 'Project',
        entityId: 'bulk',
        newValue: JSON.stringify({
          users: usersCreated, merged: usersMerged, deals: dealsCreated,
          payments: paymentsCreated, reimbursements: reimbsCreated, notes: notesCreated,
          coClosers: coClosersCreated, coSetters: coSettersCreated,
        }),
      },
    });
  }

  // ── Print summaries ─────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  SUMMARY (${MODE})`);
  console.log('════════════════════════════════════════════════════════════\n');
  for (const s of summaries) {
    console.log(`→ ${s.label}:`);
    for (const line of s.lines) if (line) console.log(line);
    console.log('');
  }

  if (!COMMIT) {
    console.log('(dry-run — no rows written. Review above, then rerun with --commit.)\n');
  } else {
    console.log('✓ Import complete. Verify per plan docs.\n');
  }

  await prisma.$disconnect();
}

// Helpers

function soldDateFallback(
  commissionByDeal: Map<string, unknown[]>,
  glideDealId: string,
): string | null {
  // Some Commission Payment rows have blank Date fields; fall back to
  // the deal's soldDate when needed so we at least have a date to file.
  // We don't re-index the Deals CSV here — just null out; the caller
  // skips rows with no date anyway.
  void commissionByDeal; void glideDealId;
  return null;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
