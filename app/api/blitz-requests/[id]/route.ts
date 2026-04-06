import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// PATCH /api/blitz-requests/[id] — Approve/deny a request (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes;

  const request = await prisma.blitzRequest.update({
    where: { id },
    data,
    include: { requestedBy: true, blitz: true },
  });

  // If approving a cancellation request, also cancel the blitz
  if (body.status === 'approved' && request.type === 'cancel' && request.blitzId) {
    await prisma.blitz.update({
      where: { id: request.blitzId },
      data: { status: 'cancelled' },
    });
  }

  // If approving a create request, create the blitz
  if (body.status === 'approved' && request.type === 'create') {
    await prisma.blitz.create({
      data: {
        name: request.name,
        location: request.location,
        startDate: request.startDate,
        endDate: request.endDate,
        housing: request.housing,
        notes: request.notes,
        createdById: request.requestedById,
        ownerId: request.requestedById,
        participants: {
          create: { userId: request.requestedById, joinStatus: 'approved' },
        },
      },
    });
  }

  return NextResponse.json(request);
}
