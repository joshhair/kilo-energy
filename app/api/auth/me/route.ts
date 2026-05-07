import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/db';

// GET /api/auth/me — Look up the current Clerk user's email in the internal User table
// Returns their role + internal user ID (or 404 if not registered)
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser?.emailAddresses?.[0]?.emailAddress) {
    return NextResponse.json({ error: 'No email found on Clerk account' }, { status: 401 });
  }

  const email = clerkUser.emailAddresses[0].emailAddress;

  const user = await prisma.user.findFirst({
    where: { email, active: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'not_registered' }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    role: user.role,
    repType: user.repType,
    canExport: user.canExport,
    canCreateDeals: user.canCreateDeals,
    canAccessBlitz: user.canAccessBlitz,
    // Vendor-PM scope marker. Non-null only for vendor PMs (PM sessions
    // scoped to a single installer). Used client-side to hide UI
    // surfaces that should be admin/internal-PM-only — most notably
    // the Admin Notes section, which would otherwise render its header
    // for vendor PMs even though the API 403s the read.
    scopedInstallerId: user.scopedInstallerId,
  });
}
