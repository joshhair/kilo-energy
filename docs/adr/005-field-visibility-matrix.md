# ADR 005 — Field-visibility matrix for RBAC scrubbing

**Date**: 2026-04-19
**Status**: Accepted
**Supersedes**: the imperative switch-based scrubber that existed pre-Phase-2.1

## Context

Every API response containing project data is scrubbed to remove
fields the viewer isn't allowed to see. E.g. a setter viewing their
own deal should see setter amounts but not closer amounts; a
trainer sees trainer fields but not commission; a rep viewing a
blitz with someone else's deal sees all financials zeroed.

The original implementation was ~60 lines of imperative switch/if
logic in `scrubProjectForViewer`. Adding a new sensitive field
required remembering to scrub it in N branches manually.

Four production bugs (Timothy, Gary, Paul, Brenda) all traced to
the same pattern: data stored correctly, but the imperative scrubber
missed a case — either a new field was added without adding a scrub
rule, or a new viewer relationship was defined without being added
to every existing rule's switch.

## Decision

RBAC field visibility is codified as a declarative matrix in
`lib/fieldVisibility.ts`:

- Rows = sensitive model fields (netPPW, m1Amount, trainerId, etc.)
- Columns = viewer relationships (admin, pm, closer, setter, trainer,
  sub-dealer, none)
- Cells = actions (pass, zero, null, undefined, empty-array,
  zero-party)

`applyProjectVisibility` is a generic 20-line function that walks
the matrix. `scrubProjectForViewer` is now a 3-line delegator.

Adding a new sensitive field means adding a row to the matrix or
the characterization test suite (`tests/unit/field-visibility.test.ts`)
red-fails. Adding a new relationship means adding a column (one
action per existing field row). Forgetting either is a CI failure,
not a production bug.

## Alternatives considered

1. **Keep the imperative scrubber, add more tests** — doesn't
   change the failure mode. Tests catch bugs after they exist;
   the matrix prevents them from existing.

2. **CASL or similar permission library** — powerful but large;
   the matrix pattern is ~100 lines of handcrafted code that's
   easier to audit and explicitly tied to our field names.

3. **Database-level row security** — Turso doesn't support it at
   our maturity level. Would require rewriting every query through
   a RLS-aware layer.

## Consequences

- Characterization tests (32 tests covering every field × every
  relationship) pin current behavior. Any future refactor of the
  matrix or applier must leave these tests byte-identical green.
- New sensitive Project fields must be added to the matrix. The
  test suite fails fast if added to the DTO type without a matrix
  entry.
- The scrubber is now declarative + grep-able. Auditors can eyeball
  the matrix and spot-check "closer viewing own deal: can they see
  X?" without reading procedural code.
