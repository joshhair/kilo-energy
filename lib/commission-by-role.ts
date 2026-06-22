/**
 * commission-by-role.ts — classify a rep's payroll entries by the role the
 * rep played on each deal (Closer / Co-closer / Setter / Co-setter /
 * Trainer / Bonus) and aggregate paid-vs-pending totals per role.
 *
 * SINGLE SOURCE OF TRUTH for the classification. `classifyEntryRole` is the
 * exact logic the mobile rep-detail view uses (app/dashboard/mobile/
 * MobileRepDetail.tsx) AND the GET /api/reps/[id]/commission-by-role
 * endpoint that feeds the native iOS rep profile. One copy means the money
 * figure can't drift between the web and the app — the whole reason the
 * classification is server-exposed rather than re-derived on the client
 * (payroll entries the iOS holds have no projectId, and it keeps co-party
 * names only, no userId).
 *
 * Pure — no DB, no money arithmetic beyond integer-cents summation.
 */

export type CommissionRole =
  | 'Closer'
  | 'Co-closer'
  | 'Setter'
  | 'Co-setter'
  | 'Trainer'
  | 'Bonus';

/** Minimal payroll-entry shape the classifier reads. */
export interface ClassifiableEntry {
  paymentStage?: string | null;
  type?: string | null;
  projectId?: string | null;
  notes?: string | null;
}

/** Minimal project shape the classifier reads. `repId` is the CLOSER's user
 *  id — the client Project type aliases closerId → repId; the server
 *  endpoint maps closerId → repId explicitly before calling. */
export interface ClassifiableProject {
  repId?: string | null;
  setterId?: string | null;
  additionalClosers?: ReadonlyArray<{ userId: string }> | null;
  additionalSetters?: ReadonlyArray<{ userId: string }> | null;
}

/**
 * Classify one payroll entry by the role `repId` played on it. Mirrors
 * MobileRepDetail.tsx's classifyEntry verbatim — do NOT fork this logic;
 * both the web and the iOS endpoint depend on it agreeing.
 */
export function classifyEntryRole(
  entry: ClassifiableEntry,
  projectById: ReadonlyMap<string, ClassifiableProject>,
  repId: string,
): CommissionRole {
  if (entry.paymentStage === 'Trainer') return 'Trainer';
  if (entry.type !== 'Deal') return 'Bonus';
  if (!entry.projectId) return 'Bonus';
  const proj = projectById.get(entry.projectId);
  if (!proj) return 'Closer';
  if (proj.repId === repId && proj.setterId === repId) {
    return entry.notes === 'Setter' ? 'Setter' : 'Closer';
  }
  if (proj.repId === repId) return 'Closer';
  if (proj.setterId === repId) return 'Setter';
  if (proj.additionalClosers?.some((c) => c.userId === repId)) return 'Co-closer';
  if (proj.additionalSetters?.some((c) => c.userId === repId)) return 'Co-setter';
  return 'Closer';
}

// ─── Aggregation (endpoint-side) ───────────────────────────────────────

/** A displayed role bucket — Co-setter folds into Setter (as the web groups
 *  it), so it is not a key here. */
export type DisplayRole = 'Closer' | 'Co-closer' | 'Setter' | 'Trainer' | 'Bonus';

/** Payroll entry as the endpoint reads it from the DB: integer cents +
 *  status, plus the classifier fields. */
export interface RolePayrollEntry extends ClassifiableEntry {
  amountCents: number;
  status?: string | null;
}

/** Project as the endpoint maps it: id + phase + classifier fields. */
export interface RoleProject extends ClassifiableProject {
  id: string;
  phase?: string | null;
}

export interface RoleBreakdown {
  role: DisplayRole;
  paidCents: number;
  pendingCents: number;
  dealCount: number;
}

const DISPLAY_ROLE_ORDER: DisplayRole[] = ['Closer', 'Co-closer', 'Setter', 'Trainer', 'Bonus'];
const PHASES_EXCLUDED_FROM_DEAL_COUNT = new Set(['Cancelled', 'On Hold']);

/**
 * Aggregate a rep's payroll into per-role paid/pending cent totals + deal
 * counts. Mirrors MobileRepDetail's commission-by-role section:
 *   - Co-setter folds into Setter (web behavior).
 *   - paidCents = entries with status 'Paid'; pendingCents = everything else
 *     (Pending + Draft) so paidCents + pendingCents == the web's per-role
 *     total (which sums all statuses). Chargebacks (negative cents) net in,
 *     same as the web.
 *   - dealCount mirrors the web rep-detail tables exactly:
 *       Closer  = the rep's non-cancelled/non-on-hold deals (project-based).
 *       Trainer / Setter / Co-closer = distinct projectIds among that role's
 *         entries (Setter folds Co-setter in).
 *       Bonus   = 0 (the web shows "—"; the iOS can suppress the count).
 *
 * Returns every display role in a stable order (callers / the iOS drop
 * all-zero rows).
 */
export function commissionByRole(
  payroll: ReadonlyArray<RolePayrollEntry>,
  projects: ReadonlyArray<RoleProject>,
  repId: string,
): RoleBreakdown[] {
  const projectById = new Map<string, ClassifiableProject>(
    projects.map((p) => [p.id, p]),
  );

  const buckets = new Map<DisplayRole, { paidCents: number; pendingCents: number; projectIds: Set<string> }>(
    DISPLAY_ROLE_ORDER.map((r) => [r, { paidCents: 0, pendingCents: 0, projectIds: new Set<string>() }]),
  );

  for (const e of payroll) {
    const raw = classifyEntryRole(e, projectById, repId);
    const role: DisplayRole = raw === 'Co-setter' ? 'Setter' : raw;
    const bucket = buckets.get(role);
    if (!bucket) continue;
    if (e.status === 'Paid') bucket.paidCents += e.amountCents;
    else bucket.pendingCents += e.amountCents;
    if (e.projectId) bucket.projectIds.add(e.projectId);
  }

  // Closer count is project-based (matches the web: deals where the rep is
  // the closer, excluding Cancelled / On Hold), NOT entry-based — a closer
  // with no payroll yet still counts.
  const closerDealCount = projects.filter(
    (p) => p.repId === repId && !PHASES_EXCLUDED_FROM_DEAL_COUNT.has(p.phase ?? ''),
  ).length;

  return DISPLAY_ROLE_ORDER.map((role) => {
    const b = buckets.get(role)!;
    const dealCount =
      role === 'Closer' ? closerDealCount
        : role === 'Bonus' ? 0
          : b.projectIds.size; // Setter / Co-closer / Trainer: distinct projects
    return { role, paidCents: b.paidCents, pendingCents: b.pendingCents, dealCount };
  });
}
