/**
 * Data-access audit log writer.
 *
 * Use this whenever a route returns sensitive data, AFTER the response
 * has been built. Writes are fire-and-forget: we don't await them on
 * the request hot path because the read response shouldn't block on
 * a log write.
 *
 * Usage (typical):
 *
 *   const projects = await db.project.findMany();
 *   logDataAccess({
 *     route: '/api/data',
 *     modelName: 'Project',
 *     recordIds: projects.map(p => p.id),
 *   }).catch((err) => logger.error('audit_log_write_failed', { err }));
 *
 * The write is async but does NOT block. If the audit DB is down, we
 * log to stderr and move on — losing audit history is preferable to
 * blocking real users on a logging failure.
 *
 * Retention: 90 days, enforced by `scripts/prune-data-access-log.mjs`
 * run nightly via Vercel cron. Don't hand-edit retention here.
 */

import { dbAdmin } from './db';
import { getRequestContext } from './request-context';
import { logger } from './logger';

const MAX_IDS_PER_LOG = 1000;

export interface LogDataAccessInput {
  /** Route path, e.g. "/api/data" or "/api/projects/abc123/messages". */
  route: string;
  /** Model exposed, e.g. "Project". One write per model per request. */
  modelName: string;
  /** Record IDs returned to the caller. Capped at MAX_IDS_PER_LOG. */
  recordIds: readonly string[];
}

export async function logDataAccess(input: LogDataAccessInput): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx) {
    // No context = called from outside a request handler (cron, script).
    // Skip: there's no actor to attribute to.
    return;
  }
  const { user, viewAsUser } = ctx;
  const idsToLog = input.recordIds.slice(0, MAX_IDS_PER_LOG);

  try {
    await dbAdmin.dataAccessLog.create({
      data: {
        actorUserId: user.id,
        effectiveUserId: viewAsUser?.id ?? null,
        route: input.route,
        modelName: input.modelName,
        recordIdsJson: JSON.stringify(idsToLog),
        recordCount: input.recordIds.length,
      },
    });
  } catch (err) {
    // Don't throw — audit log failures should never block the request.
    logger.error('audit_log_write_failed', {
      err: err instanceof Error ? err.message : String(err),
      actorUserId: user.id,
      route: input.route,
      modelName: input.modelName,
    });
  }
}
