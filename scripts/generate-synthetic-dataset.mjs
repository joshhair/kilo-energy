// scripts/generate-synthetic-dataset.mjs
//
// Phase A.5 — generate a realistic-density synthetic dataset and insert
// it into Turso so the app can be stress-tested at launch scale.
//
// Target shape:
//   150 reps (90 closers, 45 setters, 15 both)
//   8 sub-dealers
//   3 project_managers
//   2 new admins (Josh already exists, so we don't duplicate him)
//   2000 projects distributed across phases, installers, and financers
//
// Design notes:
// - Uses the libSQL client directly (same pattern as backup/restore
//   scripts). The HTTP import endpoints exist for when an admin is
//   actually running a real Glide import from the UI — for internal
//   synthetic seeding we go straight to the DB.
// - IDEMPOTENT via id prefixes: every synthetic row has id starting
//   with "synth_". If you re-run the script, it detects existing synth
//   rows and refuses (won't duplicate). To re-run, first call the
//   cleanup script (scripts/cleanup-synthetic.mjs — not yet written,
//   manual SQL also works: DELETE FROM "<Table>" WHERE id LIKE 'synth_%').
// - Deterministic RNG (fixed seed) so re-runs produce the SAME data
//   shape. Makes bug reports reproducible.
// - Only uses ACTIVE installers (ESP, SolarTech, Solrite, SunPower) and
//   ACTIVE financers. Inactive reference data stays untouched.
// - Commission math is APPROXIMATE, not exact. The goal is realistic
//   magnitudes, not penny-perfect numbers. The app itself will recompute
//   anything authoritative when admins view these deals.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/generate-synthetic-dataset.mjs
//
// Flags:
//   --dry-run   (default) print counts, write nothing
//   --commit              actually insert into Turso

import { createClient } from "@libsql/client";

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const commit = args.includes("--commit");

// ─── Env ────────────────────────────────────────────────────────────────────
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}
const client = createClient({ url, authToken });

// ─── Deterministic RNG (mulberry32 seeded with constant) ────────────────────
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);

function rand() { return rng(); }
function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function randChoice(arr) { return arr[Math.floor(rand() * arr.length)]; }
function randWeighted(entries) {
  // entries: [{value, weight}, ...]
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rand() * total;
  for (const e of entries) {
    if (r < e.weight) return e.value;
    r -= e.weight;
  }
  return entries[entries.length - 1].value;
}
function randNormal(mean, std) {
  // Box-Muller
  const u1 = rand() || 1e-9;
  const u2 = rand();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round2(n) { return Math.round(n * 100) / 100; }
function formatDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ─── Sample names for realistic feel ────────────────────────────────────────
const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph",
  "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy",
  "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Helen", "Mark", "Sandra",
  "Donald", "Donna", "Steven", "Carol", "Paul", "Ruth", "Andrew", "Sharon",
  "Joshua", "Michelle", "Kenneth", "Laura", "Kevin", "Sarah", "Brian", "Kimberly",
  "George", "Deborah", "Edward", "Dorothy", "Ronald", "Amy", "Timothy", "Angela",
  "Jason", "Ashley", "Jeffrey", "Brenda", "Ryan", "Emma", "Jacob", "Olivia",
  "Gary", "Cynthia", "Nicholas", "Marie", "Eric", "Janet", "Jonathan", "Catherine",
  "Stephen", "Frances", "Larry", "Christine", "Justin", "Samantha", "Scott", "Debra",
  "Brandon", "Rachel", "Benjamin", "Carolyn", "Samuel", "Virginia", "Gregory", "Maria",
  "Frank", "Heather", "Alexander", "Diane", "Raymond", "Julie", "Patrick", "Joyce",
  "Jack", "Victoria", "Dennis", "Kelly", "Jerry", "Christina", "Tyler", "Joan",
  "Aaron", "Evelyn", "Jose", "Lauren", "Adam", "Judith", "Henry", "Megan",
  "Nathan", "Cheryl", "Douglas", "Andrea", "Zachary", "Hannah", "Peter", "Jacqueline",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
  "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill",
  "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell",
  "Mitchell", "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz",
  "Parker", "Cruz", "Edwards", "Collins", "Reyes", "Stewart", "Morris", "Morales",
];

function randomName() {
  return { firstName: randChoice(FIRST_NAMES), lastName: randChoice(LAST_NAMES) };
}
function emailOf(firstName, lastName, idx) {
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${idx}@kilosynth.test`;
}
function phoneOf() {
  return `(${randInt(200, 999)}) ${randInt(100, 999)}-${randInt(1000, 9999)}`;
}

// ─── Reference data (active installers + financers) ────────────────────────
// Pulled from the anchor snapshot. Weights control how many projects each
// one gets in the synthetic dataset — SolarTech oversampled because it's
// the one with the product catalog and needs more stress-testing UI-wise.
const ACTIVE_INSTALLERS = [
  { id: "inst_solartech", name: "SolarTech", usesProductCatalog: true, weight: 40, pricingVersionId: null },
  { id: "inst_esp",        name: "ESP",       usesProductCatalog: false, weight: 25, pricingVersionId: "ipv_esp_v1" },
  { id: "inst_solrite",    name: "Solrite",   usesProductCatalog: false, weight: 20, pricingVersionId: "ipv_solrite_v1" },
  { id: "inst_sunpower",   name: "SunPower",  usesProductCatalog: false, weight: 15, pricingVersionId: "ipv_sunpower_v1" },
];
const ACTIVE_FINANCERS = [
  { id: "fin_goodleap",     name: "Goodleap",     weight: 20 },
  { id: "fin_lightreach",   name: "LightReach",   weight: 15 },
  { id: "fin_enfin",        name: "Enfin",        weight: 15 },
  { id: "fin_sunrun",       name: "Sunrun",       weight: 10 },
  { id: "fin_sungage",      name: "Sungage",      weight: 10 },
  { id: "cmnjpjmnb00010al84tq1ez84", name: "Cash", weight: 8 }, // the legacy Cash financer id
  { id: "fin_wheelhouse",   name: "Wheelhouse",   weight: 7 },
  { id: "fin_solrite",      name: "Solrite",      weight: 6 },
  { id: "fin_participate",  name: "Participate",  weight: 5 },
  { id: "fin_credit_human", name: "Credit Human", weight: 4 },
];

const PHASE_DISTRIBUTION = [
  { value: "New",             weight: 5 },
  { value: "Acceptance",      weight: 5 },
  { value: "Site Survey",     weight: 10 },
  { value: "Design",          weight: 10 },
  { value: "Permitting",      weight: 15 },
  { value: "Pending Install", weight: 10 },
  { value: "Installed",       weight: 20 },
  { value: "PTO",             weight: 15 },
  { value: "Completed",       weight: 5 },
  { value: "Cancelled",       weight: 3 },
  { value: "On Hold",         weight: 2 },
];

const PRODUCT_TYPES = ["PPA", "Lease", "Loan", "Cash"];

// ─── User generation ────────────────────────────────────────────────────────
function generateUsers() {
  const users = [];
  let idx = 0;

  // 90 closers
  for (let i = 0; i < 90; i++) {
    const { firstName, lastName } = randomName();
    idx++;
    users.push({
      id: `synth_user_${String(idx).padStart(4, "0")}`,
      firstName, lastName,
      email: emailOf(firstName, lastName, idx),
      phone: phoneOf(),
      role: "rep",
      repType: "closer",
    });
  }
  // 45 setters
  for (let i = 0; i < 45; i++) {
    const { firstName, lastName } = randomName();
    idx++;
    users.push({
      id: `synth_user_${String(idx).padStart(4, "0")}`,
      firstName, lastName,
      email: emailOf(firstName, lastName, idx),
      phone: phoneOf(),
      role: "rep",
      repType: "setter",
    });
  }
  // 15 both
  for (let i = 0; i < 15; i++) {
    const { firstName, lastName } = randomName();
    idx++;
    users.push({
      id: `synth_user_${String(idx).padStart(4, "0")}`,
      firstName, lastName,
      email: emailOf(firstName, lastName, idx),
      phone: phoneOf(),
      role: "rep",
      repType: "both",
    });
  }
  // 8 sub-dealers
  for (let i = 0; i < 8; i++) {
    const { firstName, lastName } = randomName();
    idx++;
    users.push({
      id: `synth_user_${String(idx).padStart(4, "0")}`,
      firstName, lastName,
      email: emailOf(firstName, lastName, idx),
      phone: phoneOf(),
      role: "sub-dealer",
      repType: "both",
    });
  }
  // 3 PMs
  for (let i = 0; i < 3; i++) {
    const { firstName, lastName } = randomName();
    idx++;
    users.push({
      id: `synth_user_${String(idx).padStart(4, "0")}`,
      firstName, lastName,
      email: emailOf(firstName, lastName, idx),
      phone: phoneOf(),
      role: "project_manager",
      repType: "both",
      canCreateDeals: true, // so PMs can interact meaningfully in stress test
      canAccessBlitz: true,
    });
  }
  // 2 additional admins (Josh already exists, not duplicating)
  for (let i = 0; i < 2; i++) {
    const { firstName, lastName } = randomName();
    idx++;
    users.push({
      id: `synth_user_${String(idx).padStart(4, "0")}`,
      firstName, lastName,
      email: emailOf(firstName, lastName, idx),
      phone: phoneOf(),
      role: "admin",
      repType: "both",
    });
  }

  return users;
}

// ─── Project generation ─────────────────────────────────────────────────────
function generateProjects(users) {
  const closers = users.filter((u) => u.role === "rep" && (u.repType === "closer" || u.repType === "both"));
  const setters = users.filter((u) => u.role === "rep" && (u.repType === "setter" || u.repType === "both"));
  const subDealers = users.filter((u) => u.role === "sub-dealer");

  const today = new Date();
  const eighteenMonthsAgo = new Date();
  eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  const dayRangeMs = today.getTime() - eighteenMonthsAgo.getTime();

  const projects = [];
  for (let i = 0; i < 2000; i++) {
    const phase = randWeighted(PHASE_DISTRIBUTION);
    const installer = randWeighted(ACTIVE_INSTALLERS.map((i) => ({ value: i, weight: i.weight })));
    const financer = randWeighted(ACTIVE_FINANCERS.map((f) => ({ value: f, weight: f.weight })));
    const productType = randChoice(PRODUCT_TYPES);

    // soldDate: uniform in last 18 months
    const soldTs = eighteenMonthsAgo.getTime() + rand() * dayRangeMs;
    const soldDate = formatDate(new Date(soldTs));

    // kWSize: normal around 8, range 3-20
    const kWSize = round2(clamp(randNormal(8, 2.5), 3, 20));

    // netPPW: normal around 3.5, range 2.5-4.5
    const netPPW = round2(clamp(randNormal(3.5, 0.4), 2.5, 4.5));

    // Closer: always present, random from closer pool
    const closer = randChoice(closers);

    // Setter: 60% chance, and distinct from closer
    const hasSetter = rand() < 0.6;
    let setter = null;
    if (hasSetter && setters.length > 0) {
      for (let attempts = 0; attempts < 5; attempts++) {
        const candidate = randChoice(setters);
        if (candidate.id !== closer.id) { setter = candidate; break; }
      }
    }

    // Sub-dealer: 15% chance (exclusive of setter — either SD deal or rep deal)
    let subDealer = null;
    if (rand() < 0.15 && subDealers.length > 0) {
      subDealer = randChoice(subDealers);
      setter = null; // sub-dealer deals don't have setters in this model
    }

    // Commission math (approximate — realistic magnitudes, not exact baselines)
    // Assumed rep baseline ~$2.60/W, kilo baseline ~$2.20/W.
    // Closer commission per W = max(0, netPPW - closerBaseline)
    // Setter differential: ~$0.50/W when present (a rough mid-range)
    const closerBaseline = 2.60;
    const kiloBaseline = 2.20;
    const hasFlat = installer.usesProductCatalog; // SolarTech is flat
    const closerM2Base = Math.max(0, netPPW - closerBaseline) * kWSize * 1000;

    // M1 flat: $1000 if kW >= 5, else $500 (matches the app logic)
    const m1Flat = kWSize >= 5 ? 1000 : 500;
    const isSelfGen = !setter; // self-gen = no setter
    const closerM1 = isSelfGen ? m1Flat : 0;
    const closerM2Full = Math.max(0, closerM2Base - closerM1);

    // Setter commission: ~30% of closer M2 when present
    const setterM2Full = setter ? round2(closerM2Full * 0.35) : 0;
    const setterM1 = setter ? m1Flat : 0;
    const closerM2AfterSetter = setter ? round2(closerM2Full * 0.65) : closerM2Full;

    // Split M2/M3 based on installer's installPayPct
    // SolarTech (flat, 100%): all at M2, no M3
    // Others (80/20): 80% at M2, 20% at M3
    const installPayPct = hasFlat ? 100 : 80;
    const m2Amount = round2(closerM2AfterSetter * (installPayPct / 100));
    const m3Amount = hasFlat ? null : round2(closerM2AfterSetter * ((100 - installPayPct) / 100));
    const setterM2Amount = round2(setterM2Full * (installPayPct / 100));
    const setterM3Amount = hasFlat ? null : round2(setterM2Full * ((100 - installPayPct) / 100));

    // Payment flags based on phase
    // New → Pending Install: nothing paid yet
    // Installed: m1 + m2 paid
    // PTO: m1 + m2 paid, m3 paid if applicable
    // Completed: everything paid
    // Cancelled / On Hold: nothing paid (simplification)
    const m1Paid = ["Installed", "PTO", "Completed"].includes(phase);
    const m2Paid = ["Installed", "PTO", "Completed"].includes(phase);
    const m3Paid = ["PTO", "Completed"].includes(phase) && !hasFlat;

    projects.push({
      id: `synth_proj_${String(i + 1).padStart(4, "0")}`,
      customerName: `${randChoice(FIRST_NAMES)} ${randChoice(LAST_NAMES)}`,
      closerId: closer.id,
      setterId: setter?.id ?? null,
      subDealerId: subDealer?.id ?? null,
      soldDate,
      installerId: installer.id,
      installerName: installer.name,
      installerPricingVersionId: installer.pricingVersionId,
      financerId: financer.id,
      productType,
      kWSize,
      netPPW,
      phase,
      m1Paid: m1Paid ? 1 : 0,
      m1Amount: round2(closerM1 + setterM1),
      m2Paid: m2Paid ? 1 : 0,
      m2Amount,
      m3Amount,
      m3Paid: m3Paid ? 1 : 0,
      setterM2Amount,
      setterM3Amount,
    });

    // Suppress unused warning
    void kiloBaseline;
  }

  return projects;
}

// ─── Commit to Turso ────────────────────────────────────────────────────────
async function checkExistingSynth() {
  const r = await client.execute("SELECT COUNT(*) as c FROM User WHERE id LIKE 'synth_%'");
  return Number(r.rows[0].c);
}

async function insertUsers(users) {
  const now = new Date().toISOString();
  let count = 0;
  for (const u of users) {
    await client.execute({
      sql: `INSERT INTO "User" (id, firstName, lastName, email, phone, role, repType, active, canRequestBlitz, canCreateBlitz, createdAt, updatedAt, canExport, canCreateDeals, canAccessBlitz, clerkUserId)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, 0, ?, ?, NULL)`,
      args: [
        u.id, u.firstName, u.lastName, u.email, u.phone, u.role, u.repType,
        now, now,
        u.canCreateDeals ? 1 : 0,
        u.canAccessBlitz ? 1 : 0,
      ],
    });
    count++;
    if (count % 30 === 0) process.stdout.write(`  inserted ${count}/${users.length} users\r`);
  }
  process.stdout.write(`  inserted ${count}/${users.length} users\n`);
}

async function insertProjects(projects) {
  const now = new Date().toISOString();
  let count = 0;
  for (const p of projects) {
    await client.execute({
      sql: `INSERT INTO "Project" (id, customerName, closerId, setterId, subDealerId, soldDate, installerId, financerId, productType, kWSize, netPPW, phase, m1Paid, m1Amount, m2Paid, m2Amount, m3Amount, notes, flagged, installerPricingVersionId, productId, productPricingVersionId, baselineOverrideJson, prepaidSubType, leadSource, blitzId, createdAt, updatedAt, m3Paid, setterM2Amount, setterM3Amount, cancellationReason, cancellationNotes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL)`,
      args: [
        p.id, p.customerName, p.closerId, p.setterId, p.subDealerId, p.soldDate,
        p.installerId, p.financerId, p.productType, p.kWSize, p.netPPW, p.phase,
        p.m1Paid, p.m1Amount, p.m2Paid, p.m2Amount, p.m3Amount,
        p.installerPricingVersionId,
        now, now, p.m3Paid, p.setterM2Amount, p.setterM3Amount,
      ],
    });
    count++;
    if (count % 100 === 0) process.stdout.write(`  inserted ${count}/${projects.length} projects\r`);
  }
  process.stdout.write(`  inserted ${count}/${projects.length} projects\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const existing = await checkExistingSynth();
  if (existing > 0) {
    console.error(`✗ Found ${existing} existing synth_* users in Turso.`);
    console.error(`  Clean them up first with:`);
    console.error(`  DELETE FROM "Project" WHERE id LIKE 'synth_%';`);
    console.error(`  DELETE FROM "User" WHERE id LIKE 'synth_%';`);
    process.exit(1);
  }

  console.log("Generating synthetic dataset (deterministic, seed=42)...");
  const users = generateUsers();
  const projects = generateProjects(users);

  // Summary stats
  const usersByRole = users.reduce((acc, u) => { acc[u.role] = (acc[u.role] ?? 0) + 1; return acc; }, {});
  const projectsByPhase = projects.reduce((acc, p) => { acc[p.phase] = (acc[p.phase] ?? 0) + 1; return acc; }, {});
  const projectsByInstaller = projects.reduce((acc, p) => { acc[p.installerName] = (acc[p.installerName] ?? 0) + 1; return acc; }, {});
  const setterCount = projects.filter((p) => p.setterId).length;
  const subDealerCount = projects.filter((p) => p.subDealerId).length;
  const totalKw = projects.reduce((s, p) => s + p.kWSize, 0);
  const totalCommission = projects.reduce((s, p) => s + p.m1Amount + p.m2Amount + (p.m3Amount ?? 0), 0);

  console.log();
  console.log(`  Users:    ${users.length}`);
  for (const [role, n] of Object.entries(usersByRole)) console.log(`    ${role.padEnd(18)} ${n}`);
  console.log();
  console.log(`  Projects: ${projects.length}`);
  for (const [phase, n] of Object.entries(projectsByPhase).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${phase.padEnd(18)} ${n}`);
  }
  console.log();
  console.log(`  By installer:`);
  for (const [name, n] of Object.entries(projectsByInstaller)) console.log(`    ${name.padEnd(18)} ${n}`);
  console.log();
  console.log(`  With setter:     ${setterCount} (${Math.round((setterCount / projects.length) * 100)}%)`);
  console.log(`  With sub-dealer: ${subDealerCount} (${Math.round((subDealerCount / projects.length) * 100)}%)`);
  console.log(`  Total kW:        ${Math.round(totalKw)} kW`);
  console.log(`  Total commission approx: $${Math.round(totalCommission).toLocaleString()}`);
  console.log();

  if (!commit) {
    console.log("  (dry-run — no inserts. Pass --commit to write to Turso.)");
    return;
  }

  console.log("Inserting into Turso...");
  await insertUsers(users);
  await insertProjects(projects);
  console.log();
  console.log("Done. Next: run scripts/backup-turso.mjs to take a post-synthetic snapshot.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
