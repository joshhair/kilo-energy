import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAuth } from '../../../lib/api-auth';

// GET /api/blitz-requests — List all blitz requests
export async function GET() {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const requests = await prisma.blitzRequest.findMany({
    include: { requestedBy: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(requests);
}

// POST /api/blitz-requests — Submit a blitz request
export async function POST(req: NextRequest) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const request = await prisma.blitzRequest.create({
    data: {
      requestedById: body.requestedById,
      name: body.name,
      location: body.location || '',
      startDate: body.startDate,
      endDate: body.endDate,
      housing: body.housing || '',
      notes: body.notes || '',
      expectedHeadcount: body.expectedHeadcount || 0,
    },
    include: { requestedBy: true },
  });
  return NextResponse.json(request, { status: 201 });
}
