import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/reps — Create a new rep
export async function POST(req: NextRequest) {
  const body = await req.json();
  const user = await prisma.user.create({
    data: {
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email: body.email.trim(),
      phone: body.phone?.trim() || '',
      role: 'rep',
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
    role: 'rep' as const,
    repType: user.repType,
  }, { status: 201 });
}
