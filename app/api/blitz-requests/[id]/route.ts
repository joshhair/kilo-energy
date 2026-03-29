import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/blitz-requests/[id] — Approve/deny a request
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes;

  const request = await prisma.blitzRequest.update({
    where: { id },
    data,
    include: { requestedBy: true },
  });
  return NextResponse.json(request);
}
