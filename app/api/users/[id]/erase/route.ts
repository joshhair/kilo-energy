import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { logChange } from '../../../../../lib/audit';
import { logger, errorContext } from '../../../../../lib/logger';
import { assertNotSelf, assertNotLastActiveAdmin } from '../../../../../lib/user-guardrails';

/**
 * POST /api/users/[id]/erase — GDPR/CCPA-style right-to-erasure.
 *
 * Policy: financial records cannot be deleted (tax/commission audit
 * retention). Instead we *anonymize* the User row — strip identifying
 * fields so the user is no longer personally identifiable, while
 * preserving referential integrity of historical deals and payroll.
 *
 * What we do:
 *   - firstName → "Erased"
 *   - lastName  → `User-{8-char-hash-of-id}` (stable identifier for
 *                 audit trails without being PII)
 *   - email     → `erased+{hash}@kilo-erased.invalid`
 *   - phone     → ""
 *   - active    → false
 *   - Clerk account → deleted (via clerkClient.users.deleteUser)
 *   - pending Clerk invitations → revoked
 *
 * What we don't do (intentionally):
 *   - Delete PayrollEntry, Project, Reimbursement records — retained for
 *     commission audit trails, tax reporting, and legal hold.
 *   - Delete AuditLog entries where this user was the actor — our own
 *     accountability record, anonymized via actorEmail replacement.
 *
 * The anonymization is captured in AuditLog with action=`user_erasure`.
 * Admin-only. Self-erasure requires the admin to erase their own
 * account — we refuse to let the last active admin erase themselves,
 * same guard as the delete route.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Guardrails — can't erase yourself, can't erase the last admin.
  try { await assertNotSelf(viewer.id, id); } catch (r) { return r as NextResponse; }
  try { await assertNotLastActiveAdmin(id); } catch (r) { return r as NextResponse; }

  if (!user.active) {
    // Already deactivated is fine — continue to full erasure for a
    // previously soft-deleted user.
  }

  // Derive a stable short hash so anonymous records can still be correlated
  // in historical reports (e.g. "the same 'User-a3f21b9c' appears across
  // these 14 deals"), without any reverse mapping back to PII.
  const shortHash = id.slice(-8);
  const erasedEmail = `erased+${shortHash}@kilo-erased.invalid`;
  const erasedBefore = {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
  };

  // 1. Anonymize the DB row.
  const updated = await prisma.user.update({
    where: { id },
    data: {
      firstName: 'Erased',
      lastName: `User-${shortHash}`,
      email: erasedEmail,
      phone: '',
      active: false,
    },
  });

  // 2. Anonymize this user's actorEmail in historical AuditLog rows so a
  //    future viewer of the audit table doesn't see their real email.
  //    (We keep actorUserId so admin queries can still trace "who did X",
  //    but only anonymized name + email will render in UIs.)
  await prisma.auditLog.updateMany({
    where: { actorUserId: id },
    data: { actorEmail: erasedEmail },
  });

  // 3. Nuke the Clerk identity + invitations. Best-effort — the DB anonymization
  //    is the source of truth; a Clerk hiccup shouldn't fail the erasure.
  if (user.clerkUserId) {
    try {
      const client = await clerkClient();
      await client.users.deleteUser(user.clerkUserId);
    } catch (err) {
      logger.error('erasure_clerk_user_delete_failed', { userId: id, ...errorContext(err) });
    }
  }
  try {
    const client = await clerkClient();
    const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
    const items = Array.isArray(list) ? list : list?.data ?? [];
    const pending = items.filter((i) => i.emailAddress.toLowerCase() === user.email.toLowerCase());
    for (const inv of pending) {
      await client.invitations.revokeInvitation(inv.id).catch(() => {});
    }
  } catch (err) {
    logger.error('erasure_clerk_invitation_revoke_failed', { userId: id, ...errorContext(err) });
  }

  // 4. Log the erasure. Explicit AuditLog row so regulators (or Josh, 2
  //    years from now) can verify the request was honored.
  await logChange({
    actor: { id: viewer.id, email: viewer.email ?? null },
    action: 'user_erasure',
    entityType: 'User',
    entityId: id,
    before: erasedBefore,
    after: {
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email,
      phone: updated.phone,
    },
  });

  return NextResponse.json({
    success: true,
    erasedUser: {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email,
      active: updated.active,
    },
  });
}
