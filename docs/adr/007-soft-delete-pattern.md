# 007 — Soft-delete pattern (audited 2026-04-28)

**Status:** Active. Captures the existing pattern + the documented
exception. New entities follow the active-flag rule.

## Context

The codebase has 8 entities that support soft-delete or deactivation:
Financer, Installer, Product, User (rep / SD / PM / admin),
Reimbursement, InstallerPrepaidOption, Incentive, TrainerAssignment.

A 2026-04-28 audit (PR 19) surveyed every entity's pattern and found
six of eight on `active: boolean`, one on `archivedAt: DateTime?`, and
one with no soft-delete at all. The variations weren't bugs — each had
a reason — but they were undocumented, so a new entity could pick any
shape and add a 4th variant.

## Decision

**Default: `active: boolean` flag.**

```prisma
model X {
  // ...
  active Boolean @default(true)
}
```

- **Soft-delete (archive):** PATCH `{ active: false }`
- **Restore:** PATCH `{ active: true }`
- **Hard-delete (DELETE):** allowed only when no FK references would
  break. Returns 409 with reference count if blocked.

UI labels:
- "Archive" / "Restore" for reference data (Financer, Installer,
  Product, Incentive)
- "Deactivate" / "Reactivate" for user identities (User, including
  the rep / SD / PM rolesUI label) — distinguishes from the data-row
  "archive" semantic and reflects the Clerk lifecycle (lock / unlock)
  that runs alongside.

## Documented exceptions

### Reimbursement uses `archivedAt: DateTime?`

Not a bug. Audit-precision tradeoff: the timestamp records *when* an
admin archived a reimbursement, which the boolean shape can't. The
audit log captures the change, but `archivedAt` is denormalized onto
the row for cheap "Show archived" filters and admin sorting.

A future migration could collapse this to `active: boolean` if the
denorm cost outweighs the audit-precision win. As of writing, it
doesn't.

### Product uses DELETE-as-soft-delete + dedicated `/restore` endpoint

Slightly inverted REST: `DELETE /api/products/[id]` flips
`active: false`, and `POST /api/products/[id]/restore` flips it back.
Why it's this way: when this was originally built, the admin UI had
a single "Trash" affordance per row that mapped naturally to DELETE,
and a separate Archived-tab restore button that mapped to a POST.
The pattern is functional and the audit-coverage gate (PR 3) wires
both endpoints, so the inversion is observable but not actionable.

If we ever do a full pattern consolidation: change the DELETE to
PATCH-with-active-false and merge the restore endpoint into the same
PATCH handler. Not urgent.

### InstallerPrepaidOption has no soft-delete

Hard-delete only. Acceptable because Project rows hold the
`prepaidSubType` as a string column, not as an FK to the prepaid
option's id — so deleting an option doesn't dangle any references.

If prepaid options ever become referenced by id (e.g. for foreign
key integrity), add `active: boolean` per the default pattern.

### Incentive + TrainerAssignment use hard-delete

Both have an `active` flag (Incentive) or `isActiveTraining` flag
(TrainerAssignment) for "deactivate without losing history" but their
DELETE endpoints currently hard-delete. Fine because:
- Incentive: temporary records (start/end dates)
- TrainerAssignment: replaceable; payroll history persists in
  PayrollEntry regardless

If you find yourself wanting to "restore" a deleted Incentive or
TrainerAssignment, that's the signal to switch DELETE to PATCH-soft.
Not a today problem.

## Consequences

**For new entities:**
1. Default to `active: boolean @default(true)`.
2. PATCH for soft-delete and restore. DELETE for hard-delete with FK guards.
3. UI label: "Archive" for data, "Deactivate" for users.
4. Add the entity to `lib/audit.ts` `AuditEntityType` union.
5. Wire `logChange()` into POST/PATCH/DELETE handlers (the
   audit-coverage CI gate will catch you if you don't).

**For modifying existing entities:**
- Don't pattern-match a one-off exception; check this ADR first. If
  you're tempted to add a 4th variant, propose it as a new ADR that
  supersedes this one.

## Related

- `lib/audit.ts` — every soft-delete / restore should call `logChange`
- `scripts/audit-coverage.allowlist.json` — gate that enforces it
- `app/api/products/[id]/route.ts` + `restore/route.ts` — the
  DELETE-as-soft pattern with separate restore (the documented
  Product exception)
