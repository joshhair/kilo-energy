import { NextResponse } from 'next/server';
import { prisma } from './db';

/**
 * Guardrails for user deactivation / hard delete. Each helper throws a
 * NextResponse on failure (matching the pattern in `lib/api-auth.ts`) so
 * route handlers can use the same try/catch idiom:
 *
 *   try { await assertNotSelf(viewer.id, targetId); } catch (r) { return r; }
 */

export class GuardrailError extends Error {
  constructor(public response: NextResponse) {
    super('GuardrailError');
  }
}

/**
 * Prevents an admin from deactivating or deleting their own account, which
 * would lock them out of the system. Throws a 400.
 */
export async function assertNotSelf(viewerId: string, targetId: string): Promise<void> {
  if (viewerId === targetId) {
    throw NextResponse.json(
      { error: 'You cannot deactivate or delete your own account' },
      { status: 400 },
    );
  }
}

/**
 * Prevents deactivating or deleting the last active admin. The system must
 * always have at least one admin who can manage users — otherwise nobody
 * can ever reactivate or invite anyone again.
 *
 * Counts admins OTHER than the target, so this passes when there are 2+
 * total active admins (including the target) or when the target isn't an
 * admin at all.
 */
export async function assertNotLastActiveAdmin(targetId: string): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true },
  });
  if (!target || target.role !== 'admin') return; // not an admin, nothing to guard

  const otherActiveAdmins = await prisma.user.count({
    where: { role: 'admin', active: true, NOT: { id: targetId } },
  });
  if (otherActiveAdmins === 0) {
    throw NextResponse.json(
      { error: 'Cannot deactivate the last active admin. Promote another user to admin first.' },
      { status: 400 },
    );
  }
}

/**
 * Counts every relation that points at this user. Used to gate hard delete:
 * a user with any history (deals, payroll, blitzes, chat messages, etc.)
 * cannot be hard-deleted — they must be deactivated instead, preserving
 * referential integrity and historical accuracy.
 *
 * Returns the count and a per-table breakdown when called via the helper
 * below; throws a 409 with the breakdown when called via assertNoRelations.
 */
export interface RelationCount {
  total: number;
  breakdown: Record<string, number>;
}

export async function countUserRelations(userId: string): Promise<RelationCount> {
  const [
    closer, setter, subDealer, payroll, reimb, trainer, trainee,
    incentives, blitzCreated, blitzOwned, blitzPart, blitzReq, messages,
  ] = await Promise.all([
    prisma.project.count({ where: { closerId: userId } }),
    prisma.project.count({ where: { setterId: userId } }),
    prisma.project.count({ where: { subDealerId: userId } }),
    prisma.payrollEntry.count({ where: { repId: userId } }),
    prisma.reimbursement.count({ where: { repId: userId } }),
    prisma.trainerAssignment.count({ where: { trainerId: userId } }),
    prisma.trainerAssignment.count({ where: { traineeId: userId } }),
    prisma.incentive.count({ where: { targetRepId: userId } }),
    prisma.blitz.count({ where: { createdById: userId } }),
    prisma.blitz.count({ where: { ownerId: userId } }),
    prisma.blitzParticipant.count({ where: { userId } }),
    prisma.blitzRequest.count({ where: { requestedById: userId } }),
    // ProjectMessage.authorId is a text field (not a true FK) but fired
    // employees who left chat messages should still block hard delete.
    prisma.projectMessage.count({ where: { authorId: userId } }),
  ]);

  const breakdown: Record<string, number> = {};
  if (closer) breakdown.projectsAsCloser = closer;
  if (setter) breakdown.projectsAsSetter = setter;
  if (subDealer) breakdown.projectsAsSubDealer = subDealer;
  if (payroll) breakdown.payrollEntries = payroll;
  if (reimb) breakdown.reimbursements = reimb;
  if (trainer) breakdown.trainerAssignmentsAsTrainer = trainer;
  if (trainee) breakdown.trainerAssignmentsAsTrainee = trainee;
  if (incentives) breakdown.targetedIncentives = incentives;
  if (blitzCreated) breakdown.blitzesCreated = blitzCreated;
  if (blitzOwned) breakdown.blitzesOwned = blitzOwned;
  if (blitzPart) breakdown.blitzParticipations = blitzPart;
  if (blitzReq) breakdown.blitzRequests = blitzReq;
  if (messages) breakdown.projectMessages = messages;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}

/**
 * Throws a 409 NextResponse if the user has any related rows. Used by the
 * hard-delete handler to enforce "deactivate, don't delete" for users with
 * history.
 */
export async function assertNoRelations(userId: string): Promise<void> {
  const { total, breakdown } = await countUserRelations(userId);
  if (total > 0) {
    const summary = Object.entries(breakdown)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    throw NextResponse.json(
      {
        error: `Cannot hard-delete this user — they have ${total} related record(s) (${summary}). Deactivate instead to preserve history.`,
        breakdown,
      },
      { status: 409 },
    );
  }
}
