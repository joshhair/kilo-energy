import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from './db';
import { NextResponse } from 'next/server';

/**
 * Require any authenticated Clerk user. Returns the Clerk userId.
 * Throws a NextResponse with 401 if not authenticated.
 */
export async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return userId;
}

/**
 * Require an authenticated Clerk user whose email maps to an internal User
 * with role = 'admin'. Returns the internal User record.
 * Throws NextResponse with 401 (unauthenticated) or 403 (not admin).
 */
export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const clerkUser = await currentUser();
  if (!clerkUser?.emailAddresses?.[0]?.emailAddress) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = clerkUser.emailAddresses[0].emailAddress;
  const user = await prisma.user.findFirst({ where: { email, role: 'admin' } });
  if (!user) {
    throw NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 });
  }
  return user;
}

/**
 * Require an authenticated Clerk user whose email maps to an internal User
 * with role = 'admin' or 'project_manager'. Returns the internal User record.
 * Throws NextResponse with 401 (unauthenticated) or 403 (not admin/PM).
 */
export async function requireAdminOrPM() {
  const { userId } = await auth();
  if (!userId) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const clerkUser = await currentUser();
  if (!clerkUser?.emailAddresses?.[0]?.emailAddress) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = clerkUser.emailAddresses[0].emailAddress;
  const user = await prisma.user.findFirst({ where: { email, role: { in: ['admin', 'project_manager'] } } });
  if (!user) {
    throw NextResponse.json({ error: 'Forbidden — admin or project manager access required' }, { status: 403 });
  }
  return user;
}
