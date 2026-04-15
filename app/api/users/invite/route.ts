import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { createUserInviteSchema } from '../../../../lib/schemas/business';

/**
 * POST /api/users/invite — Admin creates a new internal user AND sends
 * them a Clerk invitation email. The user receives a sign-up link. When
 * they complete sign-up, `getInternalUser()` recognizes them on first
 * login via their email address (no webhook needed).
 *
 * Body:
 *   firstName: string
 *   lastName:  string
 *   email:     string
 *   phone?:    string
 *   role:      'rep' | 'sub-dealer' | 'admin' | 'project_manager'
 *   repType?:  'closer' | 'setter' | 'both'
 *
 * Admin only.
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  if (process.env.DISABLE_INVITES === 'true') {
    return NextResponse.json({ error: 'invites_disabled' }, { status: 503 });
  }

  const parsed = await parseJsonBody(req, createUserInviteSchema);
  if (!parsed.ok) return parsed.response;
  const { firstName, lastName, email, phone, role, repType } = parsed.data;

  // Refuse if an internal user with this email already exists
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
  }

  // 1. Create the internal User record first so we can stash its id in
  //    the Clerk invitation metadata. active=true so they can log in
  //    immediately on accepting the invite (no pending state to manage).
  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      phone,
      role,
      repType,
      active: true,
    },
  });

  // 2. Send the Clerk invitation. If this fails, roll back the internal
  //    user so we don't leak orphan rows.
  try {
    const client = await clerkClient();
    // Derive sign-up URL from the request origin so dev + prod both work.
    const origin = req.headers.get('origin') ?? new URL(req.url).origin;
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${origin}/sign-up`,
      publicMetadata: {
        internalUserId: user.id,
        role,
      },
      notify: true,
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          repType: user.repType,
        },
        invitation: {
          id: invitation.id,
          status: invitation.status,
          createdAt: invitation.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    // Roll back the internal user if the Clerk invitation fails
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : 'Unknown error sending invitation';
    return NextResponse.json({ error: `Invitation failed: ${message}` }, { status: 500 });
  }
}
