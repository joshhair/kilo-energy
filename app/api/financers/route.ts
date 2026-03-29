import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/financers — Create a new financer
export async function POST(req: NextRequest) {
  const body = await req.json();
  const financer = await prisma.financer.create({
    data: { name: body.name },
  });
  return NextResponse.json(financer, { status: 201 });
}
