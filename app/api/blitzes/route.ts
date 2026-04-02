import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAuth } from '../../../lib/api-auth';

// GET /api/blitzes — List all blitzes
export async function GET() {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const blitzes = await prisma.blitz.findMany({
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: { orderBy: { date: 'desc' } },
      projects: {
        include: { closer: true, setter: true, installer: true, financer: true },
      },
      incentives: { include: { milestones: true } },
    },
    orderBy: { startDate: 'desc' },
  });
  return NextResponse.json(blitzes);
}

// POST /api/blitzes — Create a new blitz
export async function POST(req: NextRequest) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const blitz = await prisma.blitz.create({
    data: {
      name: body.name,
      location: body.location || '',
      housing: body.housing || '',
      startDate: body.startDate,
      endDate: body.endDate,
      notes: body.notes || '',
      status: body.status || 'upcoming',
      createdById: body.createdById,
      ownerId: body.ownerId,
      // Auto-add the owner as an approved participant
      participants: {
        create: { userId: body.ownerId, joinStatus: 'approved' },
      },
    },
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: true,
    },
  });
  return NextResponse.json(blitz, { status: 201 });
}
