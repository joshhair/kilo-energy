import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// GET /api/reps — List users by role (admin only)
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const role = req.nextUrl.searchParams.get('role') || 'rep';
  const users = await prisma.user.findMany({
    where: { role, active: true },
    orderBy: { lastName: 'asc' },
  });
  return NextResponse.json(users);
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
