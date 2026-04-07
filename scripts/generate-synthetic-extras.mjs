// scripts/generate-synthetic-extras.mjs
//
// Phase A.5 (extension) — generate the REST of the synthetic dataset on
// top of the users + projects already inserted by
// scripts/generate-synthetic-dataset.mjs.
//
// Adds:
//   Blitzes (past, current, future) with participants, costs, and one
//     pending blitz request from a rep
//   Incentives (past + current, company-wide + targeted) with milestones
//   PayrollEntries that match each project's phase + paid flags
//     (so the payroll dashboard shows real volume that lines up with
//     dashboard "paid" totals on rep profiles)
//   TrainerAssignments + tier rows so the trainer override commission
//     code path has data to exercise
//   Reimbursements across the rep population in various states
//
// Idempotency: every new row's id starts with one of these prefixes:
//   synth_blitz_       Blitz
//   synth_bp_          BlitzParticipant
//   synth_bc_          BlitzCost
//   synth_br_          BlitzRequest
//   synth_inc_         Incentive
//   synth_im_          IncentiveMilestone
//   synth_pay_         PayrollEntry
//   synth_ta_          TrainerAssignment
//   synth_tot_         TrainerOverrideTier
//   synth_reim_        Reimbursement
// Each section checks for its own prefix and skips if anything exists.
// Re-run-friendly per-section (you can wipe one and rebuild without
// touching the others).
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/generate-synthetic-extras.mjs           (dry-run)
//   set -a && . ./.env && set +a && node scripts/generate-synthetic-extras.mjs --commit  (write)

import { createClient } from "@libsql/client";

// ─── Args ───────────────────────────────────────────────────────────────────
const commit = process.argv.includes("--commit");

// ─── Env ────────────────────────────────────────────────────────────────────
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}
const client = createClient({ url, authToken });

// ─── Deterministic RNG (seed offset from main script so distributions
// are independent — same seed family for reproducibility) ────────────────
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(99);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randChoice = (arr) => arr[Math.floor(rand() * arr.length)];
function randSubset(arr, count) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}
function round2(n) { return Math.round(n * 100) / 100; }
function formatDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDays(d, days) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
// Friday-of-the-week for a given date — payroll dates are Fridays in
// the existing app code (see app/dashboard/page.tsx pendingPayrollTotal).
function nextFriday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const offset = (5 - day + 7) % 7;
  return addDays(d, offset);
}
function fridayAfter(date) {
  const d = new Date(date);
  // Always strictly after, not same-day
  d.setDate(d.getDate() + 1);
  return nextFriday(d);
}

// ─── Lookups against Turso ──────────────────────────────────────────────────
async function loadContext() {
  console.log("Loading context from Turso...");

  const synthUsers = (await client.execute("SELECT id, firstName, lastName, role, repType FROM \"User\" WHERE id LIKE 'synth_%'")).rows;
  const realAdmins = (await client.execute("SELECT id, firstName, lastName FROM \"User\" WHERE role = 'admin' AND active = 1 AND id NOT LIKE 'synth_%'")).rows;
  const synthProjects = (await client.execute("SELECT id, closerId, setterId, soldDate, kWSize, m1Paid, m1Amount, m2Paid, m2Amount, m3Paid, m3Amount, setterM2Amount, setterM3Amount, phase FROM \"Project\" WHERE id LIKE 'synth_%'")).rows;

  if (synthUsers.length === 0) {
    console.error("✗ No synth_* users found. Run generate-synthetic-dataset.mjs --commit first.");
    process.exit(1);
  }
  if (synthProjects.length === 0) {
    console.error("✗ No synth_* projects found. Run generate-synthetic-dataset.mjs --commit first.");
    process.exit(1);
  }

  const closers = synthUsers.filter((u) => u.role === "rep" && (u.repType === "closer" || u.repType === "both"));
  const setters = synthUsers.filter((u) => u.role === "rep" && (u.repType === "setter" || u.repType === "both"));
  const reps = synthUsers.filter((u) => u.role === "rep");
  const subDealers = synthUsers.filter((u) => u.role === "sub-dealer");

  console.log(`  ${synthUsers.length} synth users, ${synthProjects.length} synth projects`);
  console.log(`  ${realAdmins.length} real admins for blitz ownership`);
  console.log();

  if (realAdmins.length === 0) {
    console.error("✗ No active admins in Turso. Blitzes need admin createdById/ownerId.");
    process.exit(1);
  }

  return { synthUsers, realAdmins, synthProjects, closers, setters, reps, subDealers };
}

// ─── Section: Blitzes + participants + costs + requests ─────────────────────
function generateBlitzes(ctx) {
  const today = new Date();
  const blitzes = [];
  const participants = [];
  const costs = [];
  const requests = [];

  const COST_CATEGORIES = ["housing", "travel", "gas", "meals", "incentives", "swag", "other"];
  const LOCATIONS = [
    { name: "Phoenix, AZ",       housing: "Hampton Inn Phoenix Downtown" },
    { name: "Las Vegas, NV",     housing: "Element Las Vegas Summerlin" },
    { name: "Sacramento, CA",    housing: "Residence Inn Sacramento" },
    { name: "San Diego, CA",     housing: "TownePlace Suites San Diego" },
    { name: "Salt Lake City, UT",housing: "Hyatt Place Salt Lake" },
    { name: "Denver, CO",        housing: "Springhill Suites Denver" },
    { name: "Boise, ID",         housing: "AC Hotel Boise" },
    { name: "Reno, NV",          housing: "Hyatt Place Reno-Tahoe" },
    { name: "Tucson, AZ",        housing: "Embassy Suites Tucson Paloma" },
    { name: "Albuquerque, NM",   housing: "Hilton Garden Inn Albuquerque" },
  ];
  const NAMES = ["Spring Sprint", "Summer Crush", "Fall Push", "Winter Warriors", "Q1 Blitz", "Q2 Blitz", "Q3 Blitz", "Q4 Blitz", "Holiday Hammer", "Year-End Sprint"];

  // ── Past blitzes (5) — completed, dates in last 12 months ────────────
  for (let i = 0; i < 5; i++) {
    const monthsAgo = 2 + i * 2; // 2, 4, 6, 8, 10 months ago
    const start = addDays(today, -monthsAgo * 30);
    const end = addDays(start, randInt(7, 14));
    const loc = randChoice(LOCATIONS);
    const owner = randChoice(ctx.realAdmins);
    blitzes.push({
      id: `synth_blitz_past_${i + 1}`,
      name: `${NAMES[i]} ${start.getFullYear()}`,
      location: loc.name,
      housing: loc.housing,
      startDate: formatDate(start),
      endDate: formatDate(end),
      notes: "Completed blitz with full attendance and good outcomes.",
      status: "completed",
      createdById: owner.id,
      ownerId: owner.id,
    });
  }

  // ── Current blitz (1) — active, today within window ──────────────────
  {
    const start = addDays(today, -3);
    const end = addDays(today, 4);
    const loc = randChoice(LOCATIONS);
    const owner = randChoice(ctx.realAdmins);
    blitzes.push({
      id: `synth_blitz_current_1`,
      name: "Active Push — This Week",
      location: loc.name,
      housing: loc.housing,
      startDate: formatDate(start),
      endDate: formatDate(end),
      notes: "Currently in flight. Daily standup at 8am local.",
      status: "active",
      createdById: owner.id,
      ownerId: owner.id,
    });
  }

  // ── Future blitzes (3) — upcoming, dates in next 4 months ────────────
  for (let i = 0; i < 3; i++) {
    const monthsAhead = 1 + i; // 1, 2, 3 months out
    const start = addDays(today, monthsAhead * 30);
    const end = addDays(start, randInt(7, 14));
    const loc = randChoice(LOCATIONS);
    const owner = randChoice(ctx.realAdmins);
    blitzes.push({
      id: `synth_blitz_future_${i + 1}`,
      name: `${randChoice(NAMES)} (Upcoming)`,
      location: loc.name,
      housing: loc.housing,
      startDate: formatDate(start),
      endDate: formatDate(end),
      notes: "Planning phase. Sign-ups open now.",
      status: "upcoming",
      createdById: owner.id,
      ownerId: owner.id,
    });
  }

  // ── Participants per blitz ───────────────────────────────────────────
  let bpIdx = 1;
  for (const blitz of blitzes) {
    const targetCount = blitz.status === "completed" ? randInt(15, 30)
                       : blitz.status === "active"   ? randInt(12, 20)
                       : randInt(5, 15);
    const chosen = randSubset(ctx.reps, targetCount);
    for (const rep of chosen) {
      let joinStatus, attendanceStatus = null;
      if (blitz.status === "completed") {
        joinStatus = "approved";
        // 80% attended, 15% no-show, 5% partial
        const r = rand();
        attendanceStatus = r < 0.8 ? "attended" : r < 0.95 ? "no_show" : "partial";
      } else if (blitz.status === "active") {
        joinStatus = "approved";
      } else {
        // upcoming: 70% approved, 30% pending
        joinStatus = rand() < 0.7 ? "approved" : "pending";
      }
      participants.push({
        id: `synth_bp_${String(bpIdx).padStart(5, "0")}`,
        blitzId: blitz.id,
        userId: rep.id,
        joinStatus,
        attendanceStatus,
      });
      bpIdx++;
    }
  }

  // ── Costs per blitz (only for past + current — future blitzes have no costs yet) ──
  let bcIdx = 1;
  const blitzesWithCosts = blitzes.filter((b) => b.status === "completed" || b.status === "active");
  for (const blitz of blitzesWithCosts) {
    const costCount = blitz.status === "completed" ? randInt(8, 14) : randInt(3, 6);
    for (let i = 0; i < costCount; i++) {
      const category = randChoice(COST_CATEGORIES);
      const amount = category === "housing" ? randInt(2000, 8000)
                   : category === "travel" ? randInt(200, 1500)
                   : category === "gas" ? randInt(50, 400)
                   : category === "meals" ? randInt(100, 600)
                   : category === "incentives" ? randInt(500, 3000)
                   : category === "swag" ? randInt(150, 800)
                   : randInt(50, 500);
      // date within blitz window
      const blitzStart = new Date(blitz.startDate);
      const blitzEnd = new Date(blitz.endDate);
      const range = blitzEnd.getTime() - blitzStart.getTime();
      const costDate = new Date(blitzStart.getTime() + rand() * range);
      costs.push({
        id: `synth_bc_${String(bcIdx).padStart(5, "0")}`,
        blitzId: blitz.id,
        category,
        amount: round2(amount),
        description: `${category.charAt(0).toUpperCase() + category.slice(1)} expense`,
        date: formatDate(costDate),
      });
      bcIdx++;
    }
  }

  // ── One pending blitz request from a rep (for the admin requests UI) ─
  {
    const requester = randChoice(ctx.reps);
    const start = addDays(today, 90);
    const end = addDays(start, 10);
    const loc = randChoice(LOCATIONS);
    requests.push({
      id: `synth_br_001`,
      requestedById: requester.id,
      type: "create",
      blitzId: null,
      name: "Rep-requested blitz: West Coast Tour",
      location: loc.name,
      startDate: formatDate(start),
      endDate: formatDate(end),
      housing: loc.housing,
      notes: "We've been getting strong interest in this market — proposing a 10-day push.",
      expectedHeadcount: 18,
      status: "pending",
      adminNotes: null,
    });
  }

  return { blitzes, participants, costs, requests };
}

// ─── Section: Incentives + milestones ───────────────────────────────────────
function generateIncentives(ctx, blitzIds) {
  const today = new Date();
  const incentives = [];
  const milestones = [];

  // ── Past incentives (5) — ended, mix of company + targeted ───────────
  const PAST_INCENTIVES = [
    { title: "Q1 Closer Bonus",       description: "Top 5 closers get cash bonus",     type: "company",  metric: "deals",      period: "quarter", monthsAgo: 9 },
    { title: "March Madness — kW",    description: "Hit 100kW in March, get $500",     type: "company",  metric: "kw",         period: "month",   monthsAgo: 7 },
    { title: "Maria's $50k Q",        description: "Personal incentive: $50k commission in one quarter", type: "personal", metric: "commission", period: "quarter", monthsAgo: 5 },
    { title: "Setter of the Year 2025", description: "Top setter wins trip",            type: "company",  metric: "deals",      period: "year",    monthsAgo: 4 },
    { title: "Holiday Push — Revenue",description: "Hit team revenue target",          type: "company",  metric: "revenue",    period: "month",   monthsAgo: 2 },
  ];
  let imIdx = 1;
  PAST_INCENTIVES.forEach((inc, i) => {
    const startDate = addDays(today, -(inc.monthsAgo + 1) * 30);
    const endDate = addDays(today, -inc.monthsAgo * 30);
    const targetRepId = inc.type === "personal" ? randChoice(ctx.reps).id : null;
    const id = `synth_inc_past_${i + 1}`;
    incentives.push({
      id,
      title: inc.title,
      description: inc.description,
      type: inc.type,
      metric: inc.metric,
      period: inc.period,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      targetRepId,
      active: 0,
      blitzId: null,
    });
    // 2-4 milestones, with achievement based on whether time has passed
    const tierCount = randInt(2, 4);
    for (let j = 0; j < tierCount; j++) {
      const threshold = (j + 1) * (inc.metric === "kw" ? 50 : inc.metric === "commission" ? 10000 : inc.metric === "revenue" ? 50000 : 10);
      const reward = j === 0 ? "$500 Amazon gift card"
                  : j === 1 ? "$1000 cash bonus"
                  : j === 2 ? "$2500 cash + jacket"
                            : "$5000 + trip";
      milestones.push({
        id: `synth_im_${String(imIdx).padStart(4, "0")}`,
        incentiveId: id,
        threshold,
        reward,
        achieved: rand() < 0.6 ? 1 : 0, // most past milestones got hit
      });
      imIdx++;
    }
  });

  // ── Current incentives (4) — active, ongoing ─────────────────────────
  const CURRENT_INCENTIVES = [
    { title: "Q2 2026 Closer Race",       description: "Top 3 closers Q2 win prizes", type: "company",  metric: "deals",      period: "quarter" },
    { title: "April kW Sprint",           description: "Hit 80kW this month",          type: "company",  metric: "kw",         period: "month" },
    { title: "Personal Goal: $30k Month", description: "Hit $30k commission in April",  type: "personal", metric: "commission", period: "month" },
    { title: "Active Blitz Push",         description: "Bonus for blitz week dealss",   type: "company",  metric: "deals",      period: "month" },
  ];
  CURRENT_INCENTIVES.forEach((inc, i) => {
    const startDate = addDays(today, -randInt(5, 25));
    const endDate = addDays(today, randInt(10, 40));
    const targetRepId = inc.type === "personal" ? randChoice(ctx.reps).id : null;
    const blitzId = i === 3 ? blitzIds.find((id) => id.startsWith("synth_blitz_current")) ?? null : null;
    const id = `synth_inc_current_${i + 1}`;
    incentives.push({
      id,
      title: inc.title,
      description: inc.description,
      type: inc.type,
      metric: inc.metric,
      period: inc.period,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      targetRepId,
      active: 1,
      blitzId,
    });
    const tierCount = randInt(2, 4);
    for (let j = 0; j < tierCount; j++) {
      const threshold = (j + 1) * (inc.metric === "kw" ? 30 : inc.metric === "commission" ? 7500 : inc.metric === "revenue" ? 30000 : 5);
      const reward = j === 0 ? "$250 gift card"
                  : j === 1 ? "$750 cash bonus"
                  : j === 2 ? "$1500 + swag"
                            : "$3000 + dinner";
      milestones.push({
        id: `synth_im_${String(imIdx).padStart(4, "0")}`,
        incentiveId: id,
        threshold,
        reward,
        achieved: rand() < 0.3 ? 1 : 0, // some current milestones already hit
      });
      imIdx++;
    }
  });

  return { incentives, milestones };
}

// ─── Section: Payroll entries that match project payment flags ──────────────
function generatePayrollEntries(ctx) {
  const entries = [];
  let payIdx = 1;

  // For each project, walk the paid milestones (m1Paid, m2Paid, m3Paid)
  // and create one PayrollEntry per (rep, milestone) that's been paid.
  // The closer gets m1+m2+m3 (their share). The setter gets m1+m2+m3
  // (their share, where setterM*Amount > 0).
  //
  // Date for each entry: a Friday near the project's soldDate, offset
  // by typical milestone delays (~immediate for M1, ~30d for M2, ~60d
  // for M3 — rough but realistic for a payroll history view).
  //
  // Status: "Paid" for past entries (their date is before today),
  //         "Pending" for any that fall on the upcoming Friday window,
  //         "Draft" for none in this seed.

  const today = new Date();
  const upcomingFriday = nextFriday(today);
  const upcomingFridayStr = formatDate(upcomingFriday);

  for (const project of ctx.synthProjects) {
    const soldDate = new Date(project.soldDate);

    // Helper to determine status by date
    const statusFor = (dateStr) => {
      if (dateStr === upcomingFridayStr) return "Pending";
      const d = new Date(dateStr);
      return d < today ? "Paid" : "Pending";
    };

    // ── M1 — closer ─────────────────────────────────────────────────────
    if (project.m1Paid && project.m1Amount > 0) {
      // Note: in the existing model, m1Amount stores the COMBINED closer+setter
      // M1 (the flat). Approximation: split it 50/50 if there's a setter,
      // otherwise the full amount goes to closer.
      const closerPortion = project.setterId ? round2(project.m1Amount / 2) : project.m1Amount;
      const date = formatDate(fridayAfter(soldDate));
      entries.push({
        id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
        repId: project.closerId,
        projectId: project.id,
        amount: closerPortion,
        type: "Deal",
        paymentStage: "M1",
        status: statusFor(date),
        date,
        notes: "",
      });
      payIdx++;

      // ── M1 — setter ───────────────────────────────────────────────────
      if (project.setterId) {
        const setterPortion = round2(project.m1Amount / 2);
        entries.push({
          id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
          repId: project.setterId,
          projectId: project.id,
          amount: setterPortion,
          type: "Deal",
          paymentStage: "M1",
          status: statusFor(date),
          date,
          notes: "",
        });
        payIdx++;
      }
    }

    // ── M2 — closer ─────────────────────────────────────────────────────
    if (project.m2Paid && project.m2Amount > 0) {
      // M2 is paid ~30 days after sold date typically (Installed phase)
      const date = formatDate(fridayAfter(addDays(soldDate, 30)));
      entries.push({
        id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
        repId: project.closerId,
        projectId: project.id,
        amount: project.m2Amount,
        type: "Deal",
        paymentStage: "M2",
        status: statusFor(date),
        date,
        notes: "",
      });
      payIdx++;

      // ── M2 — setter ───────────────────────────────────────────────────
      if (project.setterId && project.setterM2Amount > 0) {
        entries.push({
          id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
          repId: project.setterId,
          projectId: project.id,
          amount: project.setterM2Amount,
          type: "Deal",
          paymentStage: "M2",
          status: statusFor(date),
          date,
          notes: "",
        });
        payIdx++;
      }
    }

    // ── M3 — closer ─────────────────────────────────────────────────────
    if (project.m3Paid && project.m3Amount && project.m3Amount > 0) {
      // M3 is paid ~60 days after sold date typically (PTO phase)
      const date = formatDate(fridayAfter(addDays(soldDate, 60)));
      entries.push({
        id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
        repId: project.closerId,
        projectId: project.id,
        amount: project.m3Amount,
        type: "Deal",
        paymentStage: "M3",
        status: statusFor(date),
        date,
        notes: "",
      });
      payIdx++;

      // ── M3 — setter ───────────────────────────────────────────────────
      if (project.setterId && project.setterM3Amount && project.setterM3Amount > 0) {
        entries.push({
          id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
          repId: project.setterId,
          projectId: project.id,
          amount: project.setterM3Amount,
          type: "Deal",
          paymentStage: "M3",
          status: statusFor(date),
          date,
          notes: "",
        });
        payIdx++;
      }
    }
  }

  // ── Sprinkle ~20 bonus payments across reps for variety ──────────────
  const bonusReps = randSubset(ctx.reps, 20);
  for (const rep of bonusReps) {
    const monthsAgo = randInt(0, 8);
    const date = formatDate(fridayAfter(addDays(today, -monthsAgo * 30)));
    entries.push({
      id: `synth_pay_${String(payIdx).padStart(6, "0")}`,
      repId: rep.id,
      projectId: null,
      amount: round2(randInt(250, 2500)),
      type: "Bonus",
      paymentStage: "Bonus",
      status: new Date(date) < today ? "Paid" : "Pending",
      date,
      notes: randChoice(["Top performer bonus", "Blitz incentive payout", "Q1 winner", "Spiff bonus", "Manager appreciation"]),
    });
    payIdx++;
  }

  return entries;
}

// ─── Section: Trainer assignments + override tiers ──────────────────────────
function generateTrainerAssignments(ctx) {
  const assignments = [];
  const tiers = [];

  // Pick ~25 setter trainees and assign each to a closer-trainer
  const trainees = randSubset(ctx.setters, 25);
  let taIdx = 1;
  let totIdx = 1;

  for (const trainee of trainees) {
    // Trainer must be a different person and ideally a closer
    let trainer = randChoice(ctx.closers);
    // Avoid self-assignment
    let attempts = 0;
    while (trainer.id === trainee.id && attempts < 5) {
      trainer = randChoice(ctx.closers);
      attempts++;
    }
    if (trainer.id === trainee.id) continue;

    const assignmentId = `synth_ta_${String(taIdx).padStart(4, "0")}`;
    assignments.push({
      id: assignmentId,
      trainerId: trainer.id,
      traineeId: trainee.id,
      active: 1,
    });
    taIdx++;

    // 3 override tiers per assignment: $0.20 → $0.15 → $0.10 perpetual
    const tierConfigs = [
      { upToDeal: 5,  ratePerW: 0.20, sortOrder: 0 },
      { upToDeal: 15, ratePerW: 0.15, sortOrder: 1 },
      { upToDeal: null, ratePerW: 0.10, sortOrder: 2 },
    ];
    for (const cfg of tierConfigs) {
      tiers.push({
        id: `synth_tot_${String(totIdx).padStart(4, "0")}`,
        assignmentId,
        upToDeal: cfg.upToDeal,
        ratePerW: cfg.ratePerW,
        sortOrder: cfg.sortOrder,
      });
      totIdx++;
    }
  }

  return { assignments, tiers };
}

// ─── Section: Reimbursements ────────────────────────────────────────────────
function generateReimbursements(ctx) {
  const reimbursements = [];
  const today = new Date();
  const STATUS_DIST = [
    { value: "Approved", weight: 50 },
    { value: "Pending",  weight: 25 },
    { value: "Denied",   weight: 15 },
    { value: "Rejected", weight: 10 },
  ];
  const DESCRIPTIONS = [
    "Mileage to Vegas blitz",
    "Customer dinner",
    "Door knocker swag",
    "Print marketing materials",
    "Conference admission",
    "Hotel night Phoenix",
    "Lead gen software",
    "Mobile phone reimbursement",
    "Branded apparel",
    "Sample materials",
  ];
  function pickStatus() {
    const total = STATUS_DIST.reduce((s, e) => s + e.weight, 0);
    let r = rand() * total;
    for (const e of STATUS_DIST) {
      if (r < e.weight) return e.value;
      r -= e.weight;
    }
    return "Pending";
  }

  // 50 reimbursements across reps
  const eligibleReps = ctx.reps;
  for (let i = 0; i < 50; i++) {
    const rep = randChoice(eligibleReps);
    const monthsAgo = randInt(0, 9);
    const date = formatDate(addDays(today, -monthsAgo * 30 - randInt(0, 27)));
    reimbursements.push({
      id: `synth_reim_${String(i + 1).padStart(4, "0")}`,
      repId: rep.id,
      amount: round2(randInt(20, 800) + rand()),
      description: randChoice(DESCRIPTIONS),
      date,
      status: pickStatus(),
      receiptName: rand() < 0.7 ? `receipt-${i + 1}.jpg` : null,
    });
  }

  return reimbursements;
}

// ─── Idempotency checks ────────────────────────────────────────────────────
async function existsAny(table, prefix) {
  const r = await client.execute(`SELECT COUNT(*) as c FROM "${table}" WHERE id LIKE '${prefix}%'`);
  return Number(r.rows[0].c) > 0;
}

// ─── Insert helpers ────────────────────────────────────────────────────────
async function insertBlitzes(blitzes, participants, costs, requests) {
  const now = new Date().toISOString();
  for (const b of blitzes) {
    await client.execute({
      sql: `INSERT INTO "Blitz" (id, name, location, housing, startDate, endDate, notes, status, createdById, ownerId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [b.id, b.name, b.location, b.housing, b.startDate, b.endDate, b.notes, b.status, b.createdById, b.ownerId, now, now],
    });
  }
  console.log(`  inserted ${blitzes.length} blitzes`);

  for (const p of participants) {
    await client.execute({
      sql: `INSERT INTO "BlitzParticipant" (id, blitzId, userId, joinStatus, attendanceStatus, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [p.id, p.blitzId, p.userId, p.joinStatus, p.attendanceStatus, now, now],
    });
  }
  console.log(`  inserted ${participants.length} blitz participants`);

  for (const c of costs) {
    await client.execute({
      sql: `INSERT INTO "BlitzCost" (id, blitzId, category, amount, description, date, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.id, c.blitzId, c.category, c.amount, c.description, c.date, now, now],
    });
  }
  console.log(`  inserted ${costs.length} blitz costs`);

  for (const r of requests) {
    await client.execute({
      sql: `INSERT INTO "BlitzRequest" (id, requestedById, name, location, startDate, endDate, housing, notes, expectedHeadcount, status, adminNotes, createdAt, updatedAt, type, blitzId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [r.id, r.requestedById, r.name, r.location, r.startDate, r.endDate, r.housing, r.notes, r.expectedHeadcount, r.status, r.adminNotes, now, now, r.type, r.blitzId],
    });
  }
  console.log(`  inserted ${requests.length} blitz requests`);
}

async function insertIncentives(incentives, milestones) {
  const now = new Date().toISOString();
  for (const inc of incentives) {
    await client.execute({
      sql: `INSERT INTO "Incentive" (id, title, description, type, metric, period, startDate, endDate, targetRepId, active, blitzId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [inc.id, inc.title, inc.description, inc.type, inc.metric, inc.period, inc.startDate, inc.endDate, inc.targetRepId, inc.active, inc.blitzId, now, now],
    });
  }
  console.log(`  inserted ${incentives.length} incentives`);

  for (const m of milestones) {
    await client.execute({
      sql: `INSERT INTO "IncentiveMilestone" (id, incentiveId, threshold, reward, achieved)
            VALUES (?, ?, ?, ?, ?)`,
      args: [m.id, m.incentiveId, m.threshold, m.reward, m.achieved],
    });
  }
  console.log(`  inserted ${milestones.length} incentive milestones`);
}

async function insertPayrollEntries(entries) {
  const now = new Date().toISOString();
  let count = 0;
  for (const e of entries) {
    await client.execute({
      sql: `INSERT INTO "PayrollEntry" (id, repId, projectId, amount, type, paymentStage, status, date, notes, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [e.id, e.repId, e.projectId, e.amount, e.type, e.paymentStage, e.status, e.date, e.notes, now, now],
    });
    count++;
    if (count % 500 === 0) process.stdout.write(`  inserted ${count}/${entries.length} payroll entries\r`);
  }
  process.stdout.write(`  inserted ${count}/${entries.length} payroll entries\n`);
}

async function insertTrainers(assignments, tiers) {
  const now = new Date().toISOString();
  for (const a of assignments) {
    await client.execute({
      sql: `INSERT INTO "TrainerAssignment" (id, trainerId, traineeId, active, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [a.id, a.trainerId, a.traineeId, a.active, now, now],
    });
  }
  console.log(`  inserted ${assignments.length} trainer assignments`);

  for (const t of tiers) {
    await client.execute({
      sql: `INSERT INTO "TrainerOverrideTier" (id, assignmentId, upToDeal, ratePerW, sortOrder)
            VALUES (?, ?, ?, ?, ?)`,
      args: [t.id, t.assignmentId, t.upToDeal, t.ratePerW, t.sortOrder],
    });
  }
  console.log(`  inserted ${tiers.length} trainer override tiers`);
}

async function insertReimbursements(reimbursements) {
  const now = new Date().toISOString();
  for (const r of reimbursements) {
    await client.execute({
      sql: `INSERT INTO "Reimbursement" (id, repId, amount, description, date, status, receiptName, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [r.id, r.repId, r.amount, r.description, r.date, r.status, r.receiptName, now, now],
    });
  }
  console.log(`  inserted ${reimbursements.length} reimbursements`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // Idempotency check up front — refuse if any synth extras already exist
  const checks = [
    { table: "Blitz",             prefix: "synth_blitz_", label: "blitzes" },
    { table: "Incentive",         prefix: "synth_inc_",   label: "incentives" },
    { table: "PayrollEntry",      prefix: "synth_pay_",   label: "payroll entries" },
    { table: "TrainerAssignment", prefix: "synth_ta_",    label: "trainer assignments" },
    { table: "Reimbursement",     prefix: "synth_reim_",  label: "reimbursements" },
  ];
  for (const c of checks) {
    if (await existsAny(c.table, c.prefix)) {
      console.error(`✗ ${c.label} with prefix ${c.prefix}* already exist in Turso.`);
      console.error(`  Wipe with: DELETE FROM "${c.table}" WHERE id LIKE '${c.prefix}%';`);
      process.exit(1);
    }
  }

  const ctx = await loadContext();

  // Generate everything in memory first
  const { blitzes, participants, costs, requests } = generateBlitzes(ctx);
  const { incentives, milestones } = generateIncentives(ctx, blitzes.map((b) => b.id));
  const payrollEntries = generatePayrollEntries(ctx);
  const { assignments, tiers } = generateTrainerAssignments(ctx);
  const reimbursements = generateReimbursements(ctx);

  // Summary
  const totalBlitzCosts = costs.reduce((s, c) => s + c.amount, 0);
  const totalPaidPayroll = payrollEntries.filter((e) => e.status === "Paid").reduce((s, e) => s + e.amount, 0);
  const totalPendingPayroll = payrollEntries.filter((e) => e.status === "Pending").reduce((s, e) => s + e.amount, 0);

  console.log("Will generate:");
  console.log(`  Blitzes:                ${blitzes.length} (${blitzes.filter((b) => b.status === "completed").length} past, ${blitzes.filter((b) => b.status === "active").length} active, ${blitzes.filter((b) => b.status === "upcoming").length} upcoming)`);
  console.log(`  Blitz participants:     ${participants.length}`);
  console.log(`  Blitz costs:            ${costs.length} ($${Math.round(totalBlitzCosts).toLocaleString()})`);
  console.log(`  Blitz requests:         ${requests.length}`);
  console.log(`  Incentives:             ${incentives.length} (${incentives.filter((i) => i.active).length} active, ${incentives.filter((i) => !i.active).length} past)`);
  console.log(`  Incentive milestones:   ${milestones.length}`);
  console.log(`  Payroll entries:        ${payrollEntries.length}`);
  console.log(`    Paid total:           $${Math.round(totalPaidPayroll).toLocaleString()}`);
  console.log(`    Pending total:        $${Math.round(totalPendingPayroll).toLocaleString()}`);
  console.log(`  Trainer assignments:    ${assignments.length}`);
  console.log(`  Trainer override tiers: ${tiers.length}`);
  console.log(`  Reimbursements:         ${reimbursements.length}`);
  console.log();

  if (!commit) {
    console.log("  (dry-run — no inserts. Pass --commit to write to Turso.)");
    return;
  }

  console.log("Inserting into Turso...");
  await insertBlitzes(blitzes, participants, costs, requests);
  await insertIncentives(incentives, milestones);
  await insertPayrollEntries(payrollEntries);
  await insertTrainers(assignments, tiers);
  await insertReimbursements(reimbursements);

  console.log();
  console.log("Done. Run scripts/backup-turso.mjs for a post-extras snapshot.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
