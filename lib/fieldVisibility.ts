/**
 * fieldVisibility.ts — declarative field-visibility contract for RBAC.
 *
 * Before this file existed, scrubProjectForViewer in serialize.ts had ~60
 * lines of imperative if/switch/delete logic deciding which Project fields
 * each viewer relationship sees. Four bugs of the Timothy/Gary/Paul/Brenda
 * class all had the same root cause: the imperative logic missed a field
 * when it was read in a new code path, or missed a relationship when a
 * new role-slot was added.
 *
 * Now there's a single matrix: `ProjectFieldVisibility`. Rows are sensitive
 * fields, columns are viewer relationships, cells are actions. Adding a
 * new sensitive field to the Project model requires adding a row here or
 * the scrubber test suite red-fails (tests auto-generate from this
 * config). The scrubber itself becomes a ~20-line applier.
 *
 * Policy = what the APP intends. Scrubber = the APPLIER. Tests = the
 * auditor. All three stay in sync by construction.
 *
 * Default behavior: if a (field × relationship) pair has no explicit entry
 * and no wildcard default, the field passes through unchanged. This is
 * SAFE for non-sensitive fields (customerName, phase, etc.) and only
 * applies to fields declared in the matrix.
 */

import type { ProjectRelationship } from './api-auth';

// ─── Action vocabulary ────────────────────────────────────────────────
// Every cell in the matrix says one of these.
export type VisibilityAction =
  | 'pass'          // passthrough; no change
  | 'zero'          // numeric 0
  | 'null'          // literal null (for nullable fields like m3Amount)
  | 'undefined'     // strip the field entirely (e.g. trainerId/Name/Rate)
  | 'empty-array'   // for array fields (additionalClosers when hidden)
  | 'zero-party';   // for additional{Closers,Setters}: keep userId/Name/
                    // position, zero m1/m2/m3 amounts. Closer+Setter share
                    // identity but not comp figures.

// ─── Per-field policy ─────────────────────────────────────────────────
export type FieldPolicy = Partial<Record<ProjectRelationship, VisibilityAction>>;

/**
 * The Project model's viewer-role × field visibility matrix.
 *
 * Columns implicit = default to 'pass' (visible).
 * Every cell here was derived from the prior imperative scrubber — the
 * characterization test suite (tests/unit/field-visibility.test.ts)
 * proves behavior parity.
 */
export const ProjectFieldVisibility: Record<string, FieldPolicy> = {
  // Sold PPW — a rep not on the deal shouldn't see the price point.
  // vendor_pm: never sees sold price (that's sales-side, not ops-side).
  netPPW: { vendor_pm: 'zero', none: 'zero' },

  // Closer milestone amounts — own-closer passthrough; setter/trainer/
  // vendor_pm/stranger get zeros.
  m1Amount: { vendor_pm: 'zero', setter: 'zero', trainer: 'zero', none: 'zero' },
  m2Amount: { vendor_pm: 'zero', setter: 'zero', trainer: 'zero', none: 'zero' },
  m3Amount: { vendor_pm: 'null', setter: 'null', trainer: 'null', none: 'null' },

  // Setter milestone amounts — closer sees TOTAL (m1+m2+m3 summed in UI)
  // so these stay visible for closer; trainer/vendor_pm/stranger see zero.
  setterM1Amount: { vendor_pm: 'zero', trainer: 'zero', none: 'zero' },
  setterM2Amount: { vendor_pm: 'zero', trainer: 'zero', none: 'zero' },
  setterM3Amount: { vendor_pm: 'null', trainer: 'null', none: 'null' },

  // Trainer identity fields — admin/pm only. Scrubbed for everyone else
  // including the trainer themselves (trainer-on-deal gets their payout
  // derived from rate+kW in the UI rather than reading trainerId directly).
  // Blitz owners: also scrubbed — trainer assignment is Kilo's internal
  // mentorship structure, not a participant payout.
  trainerId:   { vendor_pm: 'undefined', closer: 'undefined', setter: 'undefined', trainer: 'undefined', 'sub-dealer': 'undefined', blitz_owner: 'undefined', none: 'undefined' },
  trainerName: { vendor_pm: 'undefined', closer: 'undefined', setter: 'undefined', trainer: 'undefined', 'sub-dealer': 'undefined', blitz_owner: 'undefined', none: 'undefined' },
  trainerRate: { vendor_pm: 'undefined', closer: 'undefined', setter: 'undefined', trainer: 'undefined', 'sub-dealer': 'undefined', blitz_owner: 'undefined', none: 'undefined' },

  // Admin-only notes — strip the key entirely for everyone except
  // admin + pm. Reps / trainers / sub-dealers / vendor_pm / blitz_owner
  // never see these. Vendor PM is explicitly excluded: admin notes may
  // reference rep comp, cancellation reasons, or other internal-only
  // context. Blitz owners likewise — adminNotes can carry margin context.
  adminNotes: {
    vendor_pm: 'undefined',
    closer: 'undefined',
    setter: 'undefined',
    trainer: 'undefined',
    'sub-dealer': 'undefined',
    blitz_owner: 'undefined',
    none: 'undefined',
  },

  // Kilo margin — internal P&L number. Even if a future schema change
  // promotes it to a top-level Project field (Phase 2 baseline-versioning
  // work), the matrix is pre-armed. Strip for everyone except admin + pm.
  // Blitz owners explicitly included in the strip list — see the
  // 'blitz_owner' comment in ProjectRelationship for the rationale.
  kiloMargin: {
    vendor_pm: 'undefined',
    closer: 'undefined',
    setter: 'undefined',
    trainer: 'undefined',
    'sub-dealer': 'undefined',
    blitz_owner: 'undefined',
    none: 'undefined',
  },

  // Co-party arrays — nuanced per relationship.
  //   admin/pm: passthrough (full structure + amounts).
  //   vendor_pm: empty-array for both — vendor PMs don't need to know
  //              which reps were on the deal, only the operational fields.
  //   closer: own co-closers passthrough; co-setters zero-party (keep
  //           identity, zero amounts — closer shouldn't see what each
  //           setter makes but can see who's on the deal).
  //   setter: co-closers empty-array (hidden entirely); co-setters
  //           zero-party (other setters visible by name, amounts hidden).
  //   trainer / none: everyone hidden.
  additionalClosers: {
    vendor_pm: 'empty-array',
    setter: 'empty-array',
    trainer: 'empty-array',
    none: 'empty-array',
  },
  additionalSetters: {
    vendor_pm: 'empty-array',
    closer: 'zero-party',
    setter: 'zero-party',
    trainer: 'empty-array',
    none: 'empty-array',
  },
};

// ─── Applier ──────────────────────────────────────────────────────────

/** Apply a single VisibilityAction to a field value. Pure function. */
function applyAction(value: unknown, action: VisibilityAction): unknown {
  switch (action) {
    case 'pass':         return value;
    case 'zero':         return 0;
    case 'null':         return null;
    case 'undefined':    return undefined;
    case 'empty-array':  return [];
    case 'zero-party':
      // Array of party rows; keep identity, zero amounts.
      if (!Array.isArray(value)) return value;
      return value.map((p: Record<string, unknown>) => ({
        ...p,
        m1Amount: 0,
        m2Amount: 0,
        m3Amount: null,
      }));
    default: return value;
  }
}

/**
 * Apply the Project field-visibility matrix to a DTO.
 *
 * Passes-through for admin and pm (full visibility). For every other
 * relationship, walks each field in the matrix and applies the action
 * from the (field × relationship) cell (default: 'pass').
 *
 * Side rule: `baselineOverride.kiloPerW` is always stripped for non-
 * admin/pm. Kept out of the matrix because it's a nested field rather
 * than a top-level one.
 */
export function applyProjectVisibility<T extends Record<string, unknown>>(
  dto: T,
  relationship: ProjectRelationship,
): T {
  if (relationship === 'admin' || relationship === 'pm') {
    return dto;
  }

  const scrubbed: Record<string, unknown> = { ...dto };

  // Walk the matrix. Fields not present on the DTO are skipped silently.
  for (const [field, policy] of Object.entries(ProjectFieldVisibility)) {
    if (!(field in scrubbed)) continue;
    const action = policy[relationship] ?? 'pass';
    if (action === 'pass') continue;
    scrubbed[field] = applyAction(scrubbed[field], action);
  }

  // Strip internal-only fields from nested baselineOverride for non-admin/pm.
  // Not expressible as top-level actions; handled here.
  //   kiloPerW    — Kilo's per-watt cost (sensitive)
  //   kiloMargin  — Kilo's margin/profit (sensitive)
  if (scrubbed.baselineOverride && typeof scrubbed.baselineOverride === 'object') {
    const bo = { ...(scrubbed.baselineOverride as Record<string, unknown>) };
    delete bo.kiloPerW;
    delete bo.kiloMargin;
    scrubbed.baselineOverride = bo;
  }

  return scrubbed as T;
}
