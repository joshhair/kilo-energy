/**
 * audit.ts — Write immutable audit records for sensitive mutations.
 *
 * Use logChange() in server-side handlers whenever a commission-affecting
 * field changes, a user's role/active flips, or a payroll entry publishes.
 * Read from /dashboard/admin/audit when you need to answer "who changed what
 * when" — pre-launch, this is the primary accountability surface.
 *
 * Writes are fire-and-forget: if the audit insert fails, the mutation is NOT
 * rolled back. Audit is a log, not a gate. Failures are reported via the
 * structured logger so they show up in Vercel log drains.
 */

import { prisma } from "./db";
import { logger, errorContext } from "./logger";

export interface AuditActor {
  id: string | null;
  email: string | null;
}

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

/**
 * Compute the subset of fields that actually changed between before and after.
 * Only includes keys present in `fields`. Returns undefined if no changes.
 */
function diffFields(
  fields: readonly string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldV: Record<string, JsonValue>; newV: Record<string, JsonValue> } | undefined {
  const oldV: Record<string, JsonValue> = {};
  const newV: Record<string, JsonValue> = {};
  let dirty = false;
  for (const k of fields) {
    const b = before[k];
    const a = after[k];
    if (b === a) continue;
    // Handle Date / Decimal / etc. by stringifying through JSON round-trip
    const bs = JSON.stringify(b ?? null);
    const as = JSON.stringify(a ?? null);
    if (bs === as) continue;
    oldV[k] = (b ?? null) as JsonValue;
    newV[k] = (a ?? null) as JsonValue;
    dirty = true;
  }
  if (!dirty) return undefined;
  return { oldV, newV };
}

/**
 * Closed set of entity types we audit. Adding to this list is a
 * deliberate act — every new entity needs a corresponding `logChange`
 * call wired into the routes that mutate it, and (preferably) an
 * AUDITED_FIELDS entry for diff-based change detection.
 *
 * If you find yourself wanting a new entity type and tempted to skip
 * the audit-coverage gate, ask whether the mutation actually warrants
 * an audit record (chat messages and notes don't; financer/installer
 * config absolutely does — those touch commission resolution).
 */
export type AuditEntityType =
  | "Project"
  | "PayrollEntry"
  | "User"
  | "Blitz"
  | "Installer"
  | "Financer"
  | "InstallerPricingVersion"
  | "ProductPricingVersion"
  | "Product"
  | "SubDealer"
  | "ProjectManager"
  | "Reimbursement"
  | "BlitzRequest"
  | "BlitzCost"
  | "Incentive"
  | "TrainerAssignment"
  | "PrepaidOption"
  | "AdminInvitation"
  | "ProductCatalogConfig"
  // BVI handoff
  | "ProjectFile"
  | "ProjectSurveyLink"
  | "ProjectInstallerNote"
  | "EmailDelivery"
  | "StalledAlertConfig";

export async function logChange(params: {
  actor: AuditActor;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Which fields to diff. If omitted, records the whole before/after snapshot. */
  fields?: readonly string[];
  /** Used when before/after don't apply (e.g. a publish event). */
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    let oldValue: string | null = null;
    let newValue: string | null = null;

    if (params.fields && params.before && params.after) {
      const diff = diffFields(params.fields, params.before, params.after);
      if (!diff) return; // Nothing actually changed — skip the write.
      oldValue = JSON.stringify(diff.oldV);
      newValue = JSON.stringify(diff.newV);
    } else if (params.before || params.after) {
      oldValue = params.before ? JSON.stringify(params.before) : null;
      newValue = params.after ? JSON.stringify(params.after) : null;
    } else if (params.detail) {
      newValue = JSON.stringify(params.detail);
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: params.actor.id,
        actorEmail: params.actor.email,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue,
        newValue,
      },
    });
  } catch (err) {
    // Never throw — the original mutation already happened.
    logger.error("audit_log_write_failed", {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      ...errorContext(err),
    });
  }
}

/** Field lists used by the wiring sites. Centralized so tests + viewer stay honest. */
export const AUDITED_FIELDS = {
  Project: [
    "phase",
    "m1AmountCents",
    "m2AmountCents",
    "m3AmountCents",
    "setterM1AmountCents",
    "setterM2AmountCents",
    "setterM3AmountCents",
    "closerId",
    "setterId",
    "subDealerId",
    "netPPW",
    "kWSize",
    "installerId",
    "financerId",
    "cancellationReason",
  ] as const,
  User: ["role", "repType", "active", "email", "firstName", "lastName", "scopedInstallerId"] as const,
  PayrollEntry: ["status", "amountCents", "paymentStage"] as const,
  Installer: [
    "name",
    "active",
    "installPayPct",
    "usesProductCatalog",
    "primaryEmail",
    "ccEmails",
    "subjectPrefix",
    "handoffEnabled",
    "customNotes",
  ] as const,
  Financer: ["name", "active"] as const,
  SubDealer: ["name", "active"] as const,
  Reimbursement: ["amountCents", "status", "category"] as const,
  Incentive: ["name", "active", "amountCents"] as const,
  PrepaidOption: ["name", "active", "amountCents"] as const,
} as const;
