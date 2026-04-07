import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin, requireInternalUser } from '../../../lib/api-auth';

// GET /api/reps — List users by role.
// - admin: full records (PII included)
// - everyone else: PII (email, phone) is stripped
// Reps/SDs/PMs all need the list for pickers (setter dropdown, new deal
// form, etc.), but no one except admin needs contact info.
export async function GET(req: NextRequest) {
  let viewer;
  try { viewer = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const role = req.nextUrl.searchParams.get('role') || 'rep';

  // Admins see all users (active + inactive). Non-admins only see active.
  const users = await prisma.user.findMany({
    where: viewer.role === 'admin' ? { role } : { role, active: true },
    orderBy: { lastName: 'asc' },
  });

  if (viewer.role === 'admin') {
    return NextResponse.json(users);
  }

  // Strip PII + admin-only flags for non-admin viewers.
  const stripped = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    repType: u.repType,
    active: u.active,
    // No email, phone, or permission flags (canCreateDeals, canAccessBlitz, etc.)
  }));
  return NextResponse.json(stripped);
}

// POST /api/reps — Create a new rep (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const user = await prisma.user.create({
    data: {
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email: body.email.trim(),
      phone: body.phone?.trim() || '',
      role: body.role || 'rep',
      repType: body.repType || 'both',
    },
  });
  return NextResponse.json({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone,
    role: user.role as 'rep' | 'admin' | 'sub-dealer',
    repType: user.repType,
  }, { status: 201 });
}
