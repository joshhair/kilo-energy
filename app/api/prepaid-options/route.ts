import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/prepaid-options — Add a prepaid option (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  // body: { installerId, name }
  const option = await prisma.installerPrepaidOption.create({
    data: { installerId: body.installerId, name: body.name.trim() },
  });
  return NextResponse.json(option, { status: 201 });
}
