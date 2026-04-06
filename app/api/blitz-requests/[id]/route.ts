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

  const request = await prisma.$transaction(async (tx) => {
    const updated = await tx.blitzRequest.update({
      where: { id },
      data,
      include: { requestedBy: true, blitz: true },
    });

    // If approving a cancellation request, also cancel the blitz
    if (body.status === 'approved' && updated.type === 'cancel' && updated.blitzId) {
      await tx.blitz.update({
        where: { id: updated.blitzId },
        data: { status: 'cancelled' },
      });
    }

    // If approving a create request, create the blitz
    if (body.status === 'approved' && updated.type === 'create') {
      await tx.blitz.create({
        data: {
          name: updated.name,
          location: updated.location,
          startDate: updated.startDate,
          endDate: updated.endDate,
          housing: updated.housing,
          notes: updated.notes,
          createdById: updated.requestedById,
          ownerId: updated.requestedById,
          participants: {
            create: { userId: updated.requestedById, joinStatus: 'approved' },
          },
        },
      });
    }

    return updated;
  });

  return NextResponse.json(request);
}
