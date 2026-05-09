import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logger, errorContext } from '../../../../../lib/logger';
import { logChange } from '../../../../../lib/audit';
import { notify } from '../../../../../lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '../../../../../lib/email-templates/notification';

/**
 * POST /api/users/[id]/invite — Idempotent send/resend of a Clerk invitation
 * for an existing internal user. Admin only.
 *
 * Workflow:
 *   1. Look up the internal user by id.
 *   2. Find any pending Clerk invitation matching their email and revoke it.
 *      (Prevents duplicate pending invitations from piling up in the Clerk
 *      dashboard.)
 *   3. Create a fresh invitation with `publicMetadata.internalUserId` so
 *      `getInternalUser()` can map them on first sign-in.
 *
 * Use cases:
 *   - First-time send for users created silently (bulk-import workflow:
 *     create everyone with the "Send invitation" checkbox UNCHECKED, verify
 *     the data, then click "Send invite" on each profile when ready).
 *   - Resend for users whose invitation was lost, expired, or never accepted.
 *
 * Refuses if the user is inactive (no point inviting a fired employee) or
 * if they already have a `clerkUserId` (they've accepted and signed in).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  // Resend cap — each call triggers a Clerk email. 30/min/admin tolerates
  // burst "resend all pending" flows; stops an accidental loop.
  const limited = await enforceRateLimit(`POST /api/users/[id]/invite:${actor.id}`, 30, 60_000);
  if (limited) return limited;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (!user.active) {
    return NextResponse.json(
      { error: 'Cannot invite an inactive user. Reactivate them first.' },
      { status: 400 },
    );
  }
  if (user.clerkUserId) {
    return NextResponse.json(
      { error: 'This user has already accepted an invitation and signed in.' },
      { status: 400 },
    );
  }
  if (!user.email) {
    return NextResponse.json({ error: 'User has no email address' }, { status: 400 });
  }

  try {
    const client = await clerkClient();

    // Revoke any existing pending invitations for this email — keeps the
    // Clerk dashboard tidy and prevents the user from receiving stale links.
    const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
    const items = Array.isArray(list) ? list : list?.data ?? [];
    const pending = items.filter((i) => i.emailAddress.toLowerCase() === user.email.toLowerCase());
    for (const inv of pending) {
      await client.invitations.revokeInvitation(inv.id).catch((err) => {
        logger.warn('clerk_revoke_invitation_individual_failed', {
          userId: id, op: 'invite_resend', invitationId: inv.id, ...errorContext(err),
        });
      });
    }

    // Create a fresh invitation. Origin derived from the request so dev
    // and prod both work without env-var plumbing.
    const origin = req.headers.get('origin') ?? new URL(req.url).origin;
    const invitation = await client.invitations.createInvitation({
      emailAddress: user.email,
      redirectUrl: `${origin}/sign-up`,
      publicMetadata: {
        internalUserId: user.id,
        role: user.role,
      },
      notify: true,
    });

    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'user_invite_resend',
      entityType: 'AdminInvitation',
      entityId: user.id,
      detail: {
        invitedEmail: user.email,
        role: user.role,
        clerkInvitationId: invitation.id,
        revokedCount: pending.length,
      },
    });

    // Admin-team notification — let other admins know someone was invited.
    // Audience-gated by the registry to admin role only; quietly defaults
    // to daily_digest cadence so this isn't a notification spam vector.
    const otherAdmins = await prisma.user.findMany({
      where: { role: 'admin', active: true, id: { not: actor.id } },
      select: { id: true },
    });
    const inviterName = `${actor.firstName} ${actor.lastName}`.trim() || actor.email || 'An admin';
    const inviteeName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    Promise.all(
      otherAdmins.map((a) =>
        notify({
          type: 'admin_user_invited',
          userId: a.id,
          subject: `${inviterName} invited ${inviteeName} (${user.role})`,
          emailHtml: renderNotificationEmail({
            heading: 'New user invited',
            bodyHtml: `
              <p style="margin:0 0 12px 0;"><strong>${escapeHtml(inviterName)}</strong> invited <strong>${escapeHtml(inviteeName)}</strong> as <strong>${escapeHtml(user.role)}</strong>.</p>
              <p style="margin:0;color:#5b6477;font-size:13px;">Email: ${escapeHtml(user.email)}</p>
            `,
            footerNote: 'Sent because you have admin user-invite alerts on. Manage at /dashboard/preferences.',
          }),
          smsBody: `Kilo: ${inviterName} invited ${inviteeName} (${user.role}).`,
          pushBody: `New user invited: ${inviteeName}`,
        }),
      ),
    ).catch((err) => {
      logger.error('admin_user_invited_notification_failed', {
        invitedUserId: id,
        recipientCount: otherAdmins.length,
        ...errorContext(err),
      });
    });

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        status: invitation.status,
        createdAt: invitation.createdAt,
        emailAddress: invitation.emailAddress,
      },
      revokedCount: pending.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error sending invitation';
    return NextResponse.json({ error: `Invitation failed: ${message}` }, { status: 500 });
  }
}
