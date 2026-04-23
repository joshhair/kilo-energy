import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchRepSchema } from '../../../../lib/schemas/business';

// GET /api/reps/[id] — Fetch a single user by id, regardless of role.
// Used by the unified Users detail page to look up admins / PMs who
// aren't in the app context (which only ships reps + sub-dealers).
// Auth: any authenticated internal user. PII (email, phone) is only
// returned to admins. Everyone else gets name + role + repType only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = viewer.role === 'admin';
  // Non-admin viewers cannot see inactive users — preserves the prior
  // behavior (deactivated reps disappear from rep-side views).
  if (!isAdmin && !user.active) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`,
    email: isAdmin ? user.email : '',
    phone: isAdmin ? user.phone : '',
    role: user.role,
    repType: user.repType,
    active: user.active,
    hasClerkAccount: !!user.clerkUserId,
    // PM permission flags — admin viewers only
    canCreateDeals: isAdmin ? (user.canCreateDeals ?? false) : undefined,
    canAccessBlitz: isAdmin ? (user.canAccessBlitz ?? false) : undefined,
    canExport: isAdmin ? (user.canExport ?? false) : undefined,
    scopedInstallerId: isAdmin ? (user.scopedInstallerId ?? null) : undefined,
  });
}

// PATCH /api/reps/[id] — Update rep (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchRepSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.repType !== undefined) data.repType = body.repType;
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.active !== undefined) data.active = body.active;

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone,
    role: user.role,
    repType: user.repType,
  });
}

// DELETE removed — use PATCH /api/users/[id] {active: false} for deactivation
// or DELETE /api/users/[id] for hard delete (gated to zero relations).
// Both routes handle Clerk lifecycle (lock/unlock/delete + invitation revoke).
