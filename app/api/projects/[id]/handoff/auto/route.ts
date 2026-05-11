import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { requireInternalUser, loadChainTrainees } from '../../../../../../lib/api-auth';
import { withRequestContext } from '../../../../../../lib/request-context';
import { sendInstallerHandoff } from '../../../../../../lib/handoff-service';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';
import { logger, errorContext } from '../../../../../../lib/logger';

/**
 * POST /api/projects/[id]/handoff/auto
 *
 * Rep-allowed companion to /api/projects/[id]/handoff. Fires the
 * installer handoff in 'auto' mode (the same path the new-deal POST
 * uses when `requestHandoff: true` is set on creation).
 *
 * # Why this exists
 *
 * Tristan Parry submitted a BVI deal with a utility bill attached. The
 * client uploads the utility bill AFTER POST /api/projects returns,
 * but the auto-send block inside POST /api/projects fires BEFORE the
 * upload — so the handoff email goes out without the attachment.
 *
 * Fix: the client defers the auto-send when a utility bill is attached,
 * uploads the file, then calls this endpoint. The handoff service then
 * sees `project.utilityBillFileId` populated and includes the attachment.
 *
 * # Guards
 *
 *   - Caller must be on the deal (closer / setter / additional closer /
 *     additional setter). Admin / internal-PM also allowed for parity
 *     with the manual endpoint.
 *   - One-shot: refuses if `handoffSentAt` is already populated. Reps
 *     can't use this endpoint to repeatedly re-fire — that's what the
 *     admin manual /handoff route's resend confirmation is for.
 *   - Installer must have `handoffEnabled: true`. If the admin disabled
 *     handoff between submit and upload completion, no email fires.
 *   - Rate-limited at 10/min per actor (well above any legit flow,
 *     stops a runaway client).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceRateLimit(`POST /api/projects/[id]/handoff/auto:${user.id}`, 10, 60_000);
  if (limited) return limited;

  // Pull the project + minimal scope to authorize + gate.
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      closerId: true,
      setterId: true,
      handoffSentAt: true,
      installer: { select: { handoffEnabled: true } },
      additionalClosers: { select: { userId: true } },
      additionalSetters: { select: { userId: true } },
    },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Authorization: actor must be on the deal, OR admin / internal PM.
  const isAdminOrInternalPM =
    user.role === 'admin' || (user.role === 'project_manager' && !user.scopedInstallerId);
  const isOnDeal =
    project.closerId === user.id ||
    project.setterId === user.id ||
    project.additionalClosers.some((p) => p.userId === user.id) ||
    project.additionalSetters.some((p) => p.userId === user.id);
  if (!isAdminOrInternalPM && !isOnDeal) {
    return NextResponse.json(
      { error: 'Forbidden — only the deal\'s closer/setter or an admin can fire the auto-handoff' },
      { status: 403 },
    );
  }

  // One-shot guard. Re-fires go through the admin manual endpoint with
  // its explicit resend confirmation.
  if (project.handoffSentAt) {
    return NextResponse.json(
      { error: 'Handoff already sent. Admin must use the resend flow for additional fires.', code: 'ALREADY_SENT' },
      { status: 409 },
    );
  }

  if (!project.installer.handoffEnabled) {
    return NextResponse.json(
      { error: 'Handoff is not enabled for this installer. Contact admin to enable.' },
      { status: 409 },
    );
  }

  // db-gated needs a RequestContext to operate. Mirror the wrapping the
  // POST /api/projects auto-send block does.
  try {
    const chainTrainees = user.role === 'rep' ? await loadChainTrainees(user.id) : new Set<string>();
    const result = await withRequestContext(
      { user, chainTraineeIds: Array.from(chainTrainees) },
      () => sendInstallerHandoff({
        projectId: id,
        mode: 'auto',
        actor: { id: user.id, email: user.email },
      }),
    );
    if (!result.ok) {
      logger.error('handoff_auto_retry_failed', {
        projectId: id, actorId: user.id, status: result.status, error: result.error, code: result.code,
      });
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    logger.info('handoff_auto_retry_ok', {
      projectId: id, actorId: user.id, deliveryId: result.deliveryId, providerMessageId: result.providerMessageId,
    });
    return NextResponse.json({
      ok: true,
      deliveryId: result.deliveryId,
      providerMessageId: result.providerMessageId,
      to: result.to,
      cc: result.cc,
    });
  } catch (err) {
    logger.error('handoff_auto_retry_threw', { projectId: id, ...errorContext(err) });
    return NextResponse.json({ error: 'Handoff send failed unexpectedly' }, { status: 500 });
  }
}
