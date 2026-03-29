import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/prepaid-options — Add a prepaid option
export async function POST(req: NextRequest) {
  const body = await req.json();
  // body: { installerId, name }
  const option = await prisma.installerPrepaidOption.create({
    data: { installerId: body.installerId, name: body.name.trim() },
  });
  return NextResponse.json(option, { status: 201 });
}
