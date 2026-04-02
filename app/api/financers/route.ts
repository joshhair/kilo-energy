import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/financers — Create a new financer (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const financer = await prisma.financer.create({
    data: { name: body.name },
  });
  return NextResponse.json(financer, { status: 201 });
}
