import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from './db';
import { NextResponse } from 'next/server';

export interface InternalUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string; // 'admin' | 'rep' | 'sub-dealer' | 'project_manager'
  repType: string | null;
  clerkUserId: string | null;
}

/**
 * Get the current authenticated user's internal record (with role) from the
 * database, mapped via their Clerk email. Returns null if not authenticated
 * or not found. Use this for server-side role/ownership checks.
 *
 * Does NOT throw — callers decide what to do with null (usually 401 or
 * return empty data). Use this helper instead of requireAdmin/requireAuth
 * when you need the user's role + id for server-side query filtering.
 */
export async function getInternalUser(): Promise<InternalUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (!email) return null;
  const user = await prisma.user.findFirst({
    where: { email, active: true },
  });
  if (!user) return null;

  // Lazy-populate clerkUserId on first sign-in (or after a Clerk identity
  // is recreated). The internal User row is the source of truth for our
  // own data, but Clerk owns the auth identity — we need the link to
  // perform lifecycle ops (lockUser, unlockUser, deleteUser) when an admin
  // deactivates or hard-deletes the user.
  if (user.clerkUserId !== userId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { clerkUserId: userId },
    });
    user.clerkUserId = userId;
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    repType: user.repType,
    clerkUserId: user.clerkUserId,
  };
}

/**
 * Require any authenticated internal user (any role). Returns the user
 * record or throws a 401/403 NextResponse.
 */
export async function requireInternalUser(): Promise<InternalUser> {
  const user = await getInternalUser();
  if (!user) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return user;
}

/**
 * Check whether the given user is allowed to read/write a project.
 * - admin + project_manager: always yes
 * - rep: yes if closerId OR setterId matches user id
 * - sub-dealer: yes if subDealerId OR closerId matches user id
 * Returns true/false, does not throw. For use inside endpoint handlers
 * that want to distinguish 403 from 404.
 */
export async function userCanAccessProject(
  user: InternalUser,
  projectId: string,
): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'project_manager') return true;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { closerId: true, setterId: true, subDealerId: true },
  });
  if (!project) return false;
  if (user.role === 'rep') {
    return project.closerId === user.id || project.setterId === user.id;
  }
  if (user.role === 'sub-dealer') {
    return project.subDealerId === user.id || project.closerId === user.id;
  }
  return false;
}

/**
 * Throws a 403 NextResponse if the user cannot access the project.
 * Convenience wrapper for use inside route handlers.
 */
export async function requireProjectAccess(
  user: InternalUser,
  projectId: string,
): Promise<void> {
  const ok = await userCanAccessProject(user, projectId);
  if (!ok) {
    throw NextResponse.json({ error: 'Forbidden — no access to this project' }, { status: 403 });
  }
}

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
  const user = await prisma.user.findFirst({ where: { email, role: 'admin', active: true } });
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
  const user = await prisma.user.findFirst({ where: { email, role: { in: ['admin', 'project_manager'] }, active: true } });
  if (!user) {
    throw NextResponse.json({ error: 'Forbidden — admin or project manager access required' }, { status: 403 });
  }
  return user;
}
