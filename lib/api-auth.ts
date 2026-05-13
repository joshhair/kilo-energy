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
  /** When role = 'project_manager' AND this is non-null, the user is a
   *  "vendor PM": access is scoped to a single installer. See the
   *  isVendorPM() helper and the vendor_pm column in fieldVisibility.ts. */
  scopedInstallerId: string | null;
}

/** True iff this user is a PM scoped to a specific installer (vendor PM). */
export function isVendorPM(user: Pick<InternalUser, 'role' | 'scopedInstallerId'>): boolean {
  return user.role === 'project_manager' && !!user.scopedInstallerId;
}

/**
 * Default-deny gate for project_manager users without an installer scope.
 *
 * Background: a PM with `scopedInstallerId = null` is treated as an
 * "internal PM" (full access to everything). That's the right behavior
 * for one or two real ops admins, but it's a massive privacy hole if a
 * VENDOR PM (e.g. Joe Dale, BVI) is created or edited and the scope
 * is silently left null — they end up seeing every project in the org.
 *
 * Mitigation: explicit allowlist via env. Only emails listed here are
 * permitted to act as unscoped internal PMs. Every other PM without a
 * scope gets treated as `role = 'none'` (no project access).
 *
 * INTERNAL_PM_EMAILS=alice@kilo.com,bob@kilo.com
 *
 * Truly internal PMs are rare; vendor PMs are the common case. Default-
 * deny here means an admin who forgets to set the installer scope can't
 * accidentally hand a vendor full org-wide access.
 */
const INTERNAL_PM_EMAILS = (process.env.INTERNAL_PM_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isInternalPM(user: Pick<InternalUser, 'role' | 'email' | 'scopedInstallerId'>): boolean {
  if (user.role !== 'project_manager') return false;
  if (user.scopedInstallerId) return false; // they're a vendor PM
  return INTERNAL_PM_EMAILS.includes((user.email ?? '').toLowerCase());
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
    scopedInstallerId: user.scopedInstallerId ?? null,
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
  if (user.role === 'admin') return true;
  // Vendor PM: access iff project's installerId matches their scope.
  if (user.role === 'project_manager' && user.scopedInstallerId) {
    const p = await prisma.project.findUnique({
      where: { id: projectId },
      select: { installerId: true },
    });
    return !!p && p.installerId === user.scopedInstallerId;
  }
  // Internal PM (full access): only if email is on the env allowlist.
  // PMs without a scope AND not on the allowlist default-deny — protects
  // against a vendor PM accidentally created without an installer scope
  // ending up with org-wide visibility.
  if (user.role === 'project_manager') {
    if (isInternalPM(user)) return true;
    return false;
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { closerId: true, setterId: true, subDealerId: true, trainerId: true, noChainTrainer: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
  });
  if (!project) return false;

  // Trainer visibility: the trainer of a project should be able to open it
  // to verify their own override amount. Two ways a user qualifies:
  //   1. Per-project trainer override (project.trainerId === user.id)
  //   2. Rep-chain trainer: active TrainerAssignment where this user is
  //      the trainer and the project's closer is the trainee — UNLESS
  //      admin explicitly suppressed the chain trainer for this project
  //      via the project sheet's Clear button (project.noChainTrainer = true).
  // Note: this is purely for access; what they *see* once inside is scrubbed
  // by the field-visibility matrix (trainer relationship), which hides
  // closer/setter commission and kiloMargin.
  if (project.trainerId === user.id) return true;
  if (!project.noChainTrainer) {
    const chainTrainer = await prisma.trainerAssignment.findFirst({
      where: { trainerId: user.id, traineeId: project.closerId, active: true },
      select: { id: true },
    });
    if (chainTrainer) return true;
  }

  if (user.role === 'rep') {
    if (project.closerId === user.id || project.setterId === user.id) return true;
    if (project.additionalClosers.some((c) => c.userId === user.id)) return true;
    if (project.additionalSetters.some((s) => s.userId === user.id)) return true;
    return false;
  }
  if (user.role === 'sub-dealer') {
    return project.subDealerId === user.id || project.closerId === user.id;
  }
  return false;
}

/**
 * Describes a viewer's relationship to a given project. Used by the
 * viewer-aware serializer to decide what commission / margin / per-party
 * fields to expose.
 *
 * Precedence (when multiple apply — e.g. admin who's also a closer on the
 * deal): admin > pm > trainer > closer > setter > sub-dealer > none.
 * Admins always get full visibility regardless of whether they're also
 * on the deal.
 */
export type ProjectRelationship =
  | 'admin'
  | 'pm'
  | 'vendor_pm'
  | 'closer'
  | 'setter'
  | 'trainer'
  | 'sub-dealer'
  // A non-admin rep who owns the blitz a project is attributed to. They
  // need to see every participant's commission amounts + kW so the blitz
  // leaderboard is meaningful — but they should NOT see Kilo internals
  // (kiloPerW, kiloMargin, adminNotes, BlitzCost rows). Sits between
  // 'pm' (full passthrough) and 'closer' (own-amounts-only) in scope.
  //
  // This is not computed by relationshipToProject — it's set explicitly
  // by the blitz route after detecting `blitz.ownerId === viewer.id` and
  // overrides whatever the natural-relationship resolver returned.
  | 'blitz_owner'
  | 'none';

export interface ProjectRelationshipInputs {
  closerId: string;
  setterId: string | null;
  subDealerId: string | null;
  trainerId: string | null;
  /** Required for the vendor_pm branch — we match viewer.scopedInstallerId
   *  against project.installerId. Optional for back-compat with existing
   *  callers that don't yet select this field. */
  installerId?: string | null;
  additionalClosers?: ReadonlyArray<{ userId: string }>;
  additionalSetters?: ReadonlyArray<{ userId: string }>;
}

export function relationshipToProject(
  viewer: Pick<InternalUser, 'id' | 'role' | 'scopedInstallerId'>,
  project: ProjectRelationshipInputs,
  /** Optional: set of closer user IDs this viewer trains via an active
   *  rep-chain TrainerAssignment. Callers that serve project data to
   *  trainers (e.g. /api/data, /api/projects/[id]) pre-load these once
   *  per request and pass them in; without this context, a rep-chain
   *  trainer would fall through to 'none' and see nothing. */
  chainTrainees?: ReadonlySet<string>,
): ProjectRelationship {
  if (viewer.role === 'admin') return 'admin';
  // Vendor PM (scoped to a specific installer) sits BETWEEN admin/pm and
  // the non-internal roles. Only if the project matches their installer
  // scope do they get any access at all; otherwise 'none' (and the
  // caller should filter/403 based on that).
  if (viewer.role === 'project_manager' && viewer.scopedInstallerId) {
    if (project.installerId && project.installerId === viewer.scopedInstallerId) {
      return 'vendor_pm';
    }
    return 'none';
  }
  if (viewer.role === 'project_manager') return 'pm';
  if (project.trainerId === viewer.id) return 'trainer';
  if (chainTrainees?.has(project.closerId)) return 'trainer';
  if (project.closerId === viewer.id) return 'closer';
  if (project.additionalClosers?.some((c) => c.userId === viewer.id)) return 'closer';
  if (project.setterId === viewer.id) return 'setter';
  if (project.additionalSetters?.some((s) => s.userId === viewer.id)) return 'setter';
  if (project.subDealerId === viewer.id) return 'sub-dealer';
  return 'none';
}

/**
 * Loads the set of closer IDs this user trains via an active
 * TrainerAssignment. Use at the top of any API route that serializes
 * projects for a non-admin viewer, then pass the result into every
 * relationshipToProject call in that request.
 *
 * Returns an empty set for non-reps or users with no trainer assignments;
 * this means the fast path is cheap (one indexed query, one row per
 * trainee) and the function is safe to call unconditionally.
 */
export async function loadChainTrainees(userId: string): Promise<ReadonlySet<string>> {
  const rows = await prisma.trainerAssignment.findMany({
    where: { trainerId: userId, active: true },
    select: { traineeId: true },
  });
  return new Set<string>(rows.map((r) => r.traineeId));
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
  // Vendor PMs (role=project_manager + scopedInstallerId) are installer-
  // side ops, NOT internal PMs. Deny them from payroll/bonus/admin
  // surfaces that gate on requireAdminOrPM.
  if (user.role === 'project_manager' && user.scopedInstallerId) {
    throw NextResponse.json({ error: 'Forbidden — vendor PMs cannot access this endpoint' }, { status: 403 });
  }
  return user;
}
