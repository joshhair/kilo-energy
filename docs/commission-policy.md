# Commission Policy

Plain-English reference for how Kilo Energy pays reps on each deal.
This document is the source of truth for INTENT; the tests referenced
at the end are the source of truth for BEHAVIOR. If the two
disagree, the tests have already decided and this doc needs editing.

---

## Who gets paid on a deal

Every project has up to four commission-earning roles:

1. **Closer** (primary) — the rep credited on the project row
2. **Setter** (primary, optional) — the rep who set the appointment
3. **Co-closers and co-setters** (optional) — additional reps who
   contributed; amounts are explicitly entered by admin rather than
   formula-derived
4. **Trainer** (optional) — a mentor rep who earns a per-watt
   override on their trainee's deals

**Sub-dealer deals** are paid differently — they get a single per-watt
payment tied to the sub-dealer's own baseline and don't go through
the closer/setter split described below.

---

## The core formula

For every paired (closer + setter) deal, commission is computed in
two steps.

### Step 1 — Closer differential

The closer earns a premium over the setter's baseline pay rate:

```
closerDifferential = max(0, min(setterPerW − closerPerW, soldPPW − closerPerW))
                     × kW × 1000
```

The closer baseline is typically $0.10/W below the setter baseline
(e.g. closer at $2.85/W, setter at $2.95/W). For a 5.28 kW deal,
that's $528 extra going to the closer — their bonus for closing.

### Step 2 — Above-split 50/50

Everything the rep sold ABOVE the setter baseline gets split 50/50
between closer and setter:

```
splitPoint   = setterPerW + trainerRate
aboveSplit   = max(0, (soldPPW − splitPoint)) × kW × 1000
closerHalf   = aboveSplit / 2
setterHalf   = aboveSplit / 2
closerTotal  = closerDifferential + closerHalf
setterTotal  = setterHalf
```

The `trainerRate` term shifts the split point UP by the trainer's
per-watt rate — see [Trainer override](#trainer-override) below.

### Self-gen deals (no setter)

When the closer ran the appointment themselves, `setterPerW = 0` in
the math. The entire commission above `closerPerW` routes to the
closer with no setter split.

---

## Milestones (M1 / M2 / M3)

Pay is released in up to three installments:

- **M1**: flat upfront bonus, paid when the project enters the
  Acceptance phase
  - $1,000 when system size ≥ 5 kW
  - $500 when system size < 5 kW
- **M2**: paid when the project reaches the Installed phase
- **M3**: paid when the project reaches PTO (only for installers with
  `installPayPct < 100`; see below)

### How the remainder splits

After M1 is taken off the top, whatever's left of each rep's total
(`closerTotal − closerM1` and `setterTotal − setterM1`) gets
allocated between M2 and M3 based on the installer's
`installPayPct`:

```
M2 = remainder × (installPayPct / 100)
M3 = remainder × ((100 − installPayPct) / 100)  // null when pct = 100
```

Most installers are `installPayPct = 80` — meaning 80% paid at
install, 20% at PTO. A few (SolarTech) are `installPayPct = 100` —
everything at install, nothing at PTO. M3 is explicitly `null` (not
0) for those deals so the UI can distinguish "no M3 by design" from
"M3 earned but unpaid."

### M1 routing

- **Paired deal**: M1 flat goes to the setter, closer gets $0 at M1
- **Self-gen deal**: M1 flat goes to the closer

---

## Trainer override

A trainer is a senior rep who mentors another rep. When the trainee
closes or sets a deal, the trainer earns a per-watt override paid
*alongside* — NOT subtracted from — the commission paid out.

### How the rate is resolved

For every project, the server asks: "is there a trainer rate in
effect?" The answer comes from one of two sources, in order:

1. **Per-project override** — `Project.trainerId + Project.trainerRate`
   set by admin on the project detail page. Bypasses everything below.
2. **Assignment chain** — `TrainerAssignment` for the setter as trainee
   with tiered rates (`[upToDeal: 5, ratePerW: 0.15]`, etc.). The
   resolver counts how many of the trainee's deals have fully paid out
   already, advances to the correct tier, and returns that rate.

### What the rate changes

`trainerRate` shifts the split point up (see Step 2 above). That
means:

- Both closer and setter earn *less* on the 50/50 split portion
  (each loses `trainerRate × kW × 1000 / 2`).
- The trainer earns exactly `trainerRate × kW × 1000` total, paid
  as a single Trainer-stage PayrollEntry on phase progression.
- The overall "envelope" (total paid out to reps on this deal)
  stays the same — the trainer's cut comes FROM the split area,
  not from extra customer spend.

**Example**: 5.28 kW deal, closer $2.85/W, setter $2.95/W, sold at
$3.85/W, trainer at $0.10/W.

- Without trainer: closer $2,904, setter $2,376, trainer $0 → $5,280
- With trainer:    closer $2,640, setter $2,112, trainer $528 → $5,280

Same $5,280 envelope; trainer shifts the distribution.

---

## Chargebacks

When a deal cancels AFTER a rep has been paid on it, the rep owes
back the commission. Mechanics:

- Cancellation after M2 Paid → a negative-amount PayrollEntry is
  generated for the rep covering what they owe back.
- Chargebacks show as red negative values in the payroll UI.
- Glide-imported deals are excluded from chargeback generation —
  their commission state was frozen at import and shouldn't retroact.
- Admin can manually create a chargeback via the Add Payment modal
  with type="Chargeback". The same imported-deal guard applies.

---

## Privacy / visibility rules

Every API response is scrubbed per the viewer's relationship to the
project (via `lib/fieldVisibility.ts`):

- **Admin / PM**: full visibility.
- **Closer** on their own deal: sees own M1/M2/M3 + setter TOTAL
  (not breakdown). Co-closer structure visible with amounts; co-
  setters visible by name but amounts zeroed.
- **Setter** on their own deal: sees own setter M1/M2/M3 only.
  Closer amounts zeroed; co-closers hidden entirely.
- **Trainer** on a deal: trainer payout only; closer and setter
  commission hidden.
- **Sub-dealer**: sees their deal as primary closer.
- **Stranger** (rep on a blitz viewing another rep's deal): all
  financials zeroed; defense in depth.

Trainer identity fields (`trainerId`, `trainerName`, `trainerRate`)
are admin-only regardless of viewer relationship to the deal. The
trainer's own payout is derived client-side from the rate+kW rather
than reading `trainerRate` directly.

Baseline override `kiloPerW` (the installer wholesale rate) is
stripped for every non-admin/PM viewer — reps never see installer
wholesale pricing.

---

## Server authority on commission math

Commission amounts stored on `Project.m1AmountCents` (etc.) are
computed by the server on every POST /api/projects and on every
PATCH /api/projects/[id] that changes a math-input. Client-supplied
amounts are silently overridden. This prevents the Timothy Salunga
bug where editing `netPPW` after submission left stale amounts.

Source of truth:
- **`lib/commission.ts`** — `splitCloserSetterPay`, `resolveTrainerRate`
- **`lib/commission-server.ts`** — `computeProjectCommission` (the
  server entry point that calls the lib functions and returns the
  full `{ m1, m2, m3, setterM1, setterM2, setterM3, ... }` result)
- **`app/api/projects/[id]/route.ts`** — the PATCH handler that
  invokes `computeProjectCommission` whenever a math-input changes
- **`scripts/reconcile-project-commission.mts`** — nightly CI cron
  that diffs stored vs computed and surfaces drift

---

## Tests that enforce this policy

Every non-trivial rule above has a corresponding test:

| Rule | Test |
|---|---|
| Core formula invariants (non-negative, deterministic, cent precision) | `tests/unit/commission-invariants.test.ts` |
| `splitCloserSetterPay` example cases | `tests/unit/commission.test.ts` |
| Server-authoritative recompute + trainer path + sub-dealer short-circuit | `tests/unit/commission-server.test.ts` |
| Field-visibility matrix (every field × every relationship) | `tests/unit/field-visibility.test.ts` |
| Setter-re-add orphan M1 prevention | `tests/unit/commission-invariants.test.ts` (shouldCreateSetterM1OnSetterAdd block) |
| API-level RBAC negatives | `tests/e2e/access-control/role-boundaries.test.ts` |

If a policy change lands in code, the matching test must change in
the same commit. Don't rely on this doc alone — tests are
authoritative.

---

## Change log

Major policy changes should be added here with date + PR link. Keep
entries short; the git history has the full detail.

- **2026-04-18**: Trainer tab visibility now ORs per-project override
  with assignment chain (was assignment-only). Paul Tupou class fix.
- **2026-04-18**: Server-authoritative recompute on PATCH
  `/api/projects/[id]`. Timothy Salunga class fix.
- **2026-04-19**: Field-visibility contract codified in
  `lib/fieldVisibility.ts`. Replaces imperative scrubber with a
  declarative matrix + auto-generated test suite.
