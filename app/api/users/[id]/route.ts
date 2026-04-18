import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser } from '../../../../lib/api-auth';
import { logger, errorContext } from '../../../../lib/logger';
import {
  assertNotSelf,
  assertNotLastActiveAdmin,
  assertNoRelations,
  countUserRelations,
} from '../../../../lib/user-guardrails';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchUserSchema } from '../../../../lib/schemas/user';

/**
 * GET /api/users/[id] — Single user. Admins see everything; a non-admin
 * user can fetch their own record but gets a trimmed-down view (profile +
 * permission flags only, no admin-only fields like relation counts or
 * pending-invitation lookups).
 *
 * Why self-access matters: /dashboard/blitz fetches the current user's
 * record to gate canRequestBlitz / canCreateBlitz. Admin-only would
 * silently 403 and leave the flags defaulted to false, making the whole
 * blitz-request feature dead code for reps.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const isAdmin = viewer.role === 'admin';
  const isSelf = viewer.id === id;
  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Self view — return only the fields the client needs for permission
  // gating + profile display. No Clerk lookups, no relation counts.
  if (!isAdmin) {
    return NextResponse.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      repType: user.repType,
      active: user.active,
      canRequestBlitz: user.canRequestBlitz,
      canCreateBlitz: user.canCreateBlitz,
      canExport: user.canExport,
      canCreateDeals: user.canCreateDeals,
      canAccessBlitz: user.canAccessBlitz,
    });
  }

  // Admin view — includes relation breakdown + pending-invitation lookup.
  const { total: relationCount, breakdown: relationBreakdown } = await countUserRelations(id);

  let pendingInvitation: { id: string; createdAt: number } | null = null;
  if (!user.clerkUserId) {
    try {
      const client = await clerkClient();
      const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
      const items = Array.isArray(list) ? list : list?.data ?? [];
      const inv = items.find((i) => i.emailAddress.toLowerCase() === user.email.toLowerCase());
      if (inv) pendingInvitation = { id: inv.id, createdAt: inv.createdAt };
    } catch {
      // Clerk lookup failure is non-fatal — just leave pendingInvitation null.
    }
  }

  return NextResponse.json({
    ...user,
    hasClerkAccount: !!user.clerkUserId,
    relationCount,
    relationBreakdown,
    pendingInvitation,
  });
}

/**
 * PATCH /api/users/[id] — Update user fields. Admin only.
 *
 * Accepts:
 *   - Contact info: firstName, lastName, email, phone
 *   - active: true | false (deactivation / reactivation, with full Clerk
 *     lifecycle handling — locks/unlocks Clerk user, revokes pending invite)
 *   - Permission flags: canRequestBlitz, canCreateBlitz, canExport,
 *     canCreateDeals, canAccessBlitz, repType
 *
 * Guardrails on `active: false`: cannot deactivate self, cannot deactivate
 * the last active admin.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchUserSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data: Record<string, unknown> = {};

  // Contact info (already trimmed + lowercased by Zod)
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.repType !== undefined) data.repType = body.repType;

  // Role flip — only rep ↔ sub-dealer. Admin/PM are out of scope for this
  // endpoint; those stay administrative-only and immutable here.
  //
  // Note: we intentionally leave repType alone on rep→SD. The prod Turso
  // column is still NOT NULL DEFAULT 'both' (see memory "repType schema
  // drift") — nulling would fail in prod and the test DB. SDs don't read
  // repType anywhere (the two render sites in app/dashboard/users/[id]/
  // and MobileRepDetail.tsx manufacture a 'both' default client-side), so
  // the leftover value is harmless. Reverse flip (SD→rep) keeps whatever
  // value was there; if it's somehow null, that's still fine because the
  // Prisma client treats it as optional, and rep dropdowns handle
  // undefined defensively.
  if (body.role !== undefined && body.role !== existing.role) {
    if (existing.role !== 'rep' && existing.role !== 'sub-dealer') {
      return NextResponse.json(
        { error: `Cannot change role of ${existing.role} user via PATCH` },
        { status: 400 },
      );
    }
    data.role = body.role;
    logger.info('user_role_converted', {
      userId: id,
      from: existing.role,
      to: body.role,
      actorId: viewer.id,
    });
  }

  // Permission flags
  if (body.canRequestBlitz !== undefined) data.canRequestBlitz = body.canRequestBlitz;
  if (body.canCreateBlitz !== undefined) data.canCreateBlitz = body.canCreateBlitz;
  if (body.canExport !== undefined) data.canExport = body.canExport;
  if (body.canCreateDeals !== undefined) data.canCreateDeals = body.canCreateDeals;
  if (body.canAccessBlitz !== undefined) data.canAccessBlitz = body.canAccessBlitz;

  // Active flag — handles the deactivation / reactivation workflow with
  // full Clerk lifecycle ops. Done after guardrails so we don't touch
  // Clerk if the rules reject the operation.
  const activeChanged = body.active !== undefined && body.active !== existing.active;
  if (activeChanged) {
    if (body.active === false) {
      // Deactivation — guardrails first
      try { await assertNotSelf(viewer.id, id); } catch (r) { return r as NextResponse; }
      try { await assertNotLastActiveAdmin(id); } catch (r) { return r as NextResponse; }

      // Lock Clerk user (reversible — unlock on reactivate)
      if (existing.clerkUserId) {
        try {
          const client = await clerkClient();
          await client.users.lockUser(existing.clerkUserId);
        } catch (err) {
          logger.error('clerk_lock_user_failed', { userId: id, op: 'deactivate', ...errorContext(err) });
          // Non-fatal — proceed with DB update so the user is still marked
          // inactive in our system. Worst case the admin can manually lock
          // them in the Clerk dashboard.
        }
      }

      // Revoke any pending invitation so the email slot is freed
      try {
        const client = await clerkClient();
        const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
        const items = Array.isArray(list) ? list : list?.data ?? [];
        const pending = items.filter((i) => i.emailAddress.toLowerCase() === existing.email.toLowerCase());
        for (const inv of pending) {
          await client.invitations.revokeInvitation(inv.id).catch(() => {});
        }
      } catch (err) {
        logger.error('clerk_revoke_invitations_failed', { userId: id, op: 'deactivate', ...errorContext(err) });
      }
    } else {
      // Reactivation — unlock Clerk user
      if (existing.clerkUserId) {
        try {
          const client = await clerkClient();
          await client.users.unlockUser(existing.clerkUserId);
        } catch (err) {
          logger.error('clerk_unlock_user_failed', { userId: id, op: 'reactivate', ...errorContext(err) });
        }
      }
    }
    data.active = body.active;
  }

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({
    ...user,
    hasClerkAccount: !!user.clerkUserId,
  });
}

/**
 * DELETE /api/users/[id] — Hard delete. Admin only. Gated by guardrails:
 *   - Cannot delete self
 *   - Cannot delete the last active admin
 *   - Cannot delete a user with any FK relations (returns 409 with breakdown)
 *
 * For deactivation (the common case), use PATCH with `{active: false}`
 * instead. Hard delete is for cleaning up typos and brand-new accounts
 * that have no history.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try { await assertNotSelf(viewer.id, id); } catch (r) { return r as NextResponse; }
  try { await assertNotLastActiveAdmin(id); } catch (r) { return r as NextResponse; }
  try { await assertNoRelations(id); } catch (r) { return r as NextResponse; }

  // Clerk-side cleanup — best effort. We continue even on failure since
  // the DB row is the source of truth and an orphaned Clerk user/invite
  // is recoverable from the Clerk dashboard.
  if (user.clerkUserId) {
    try {
      const client = await clerkClient();
      await client.users.deleteUser(user.clerkUserId);
    } catch (err) {
      logger.error('clerk_delete_user_failed', { userId: id, op: 'hard_delete', ...errorContext(err) });
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
    logger.error('clerk_revoke_invitations_failed', { userId: id, op: 'hard_delete', ...errorContext(err) });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
