import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';

// GET /api/blitz-requests — List blitz requests scoped to role.
// Admin: all requests. Everyone else: only their own requests.
export async function GET() {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const where = user.role === 'admin' ? {} : { requestedById: user.id };
  const requests = await prisma.blitzRequest.findMany({
    where,
    include: { requestedBy: true, blitz: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(requests);
}

// POST /api/blitz-requests — Submit a blitz request (create or cancel).
// Caller must have canRequestBlitz. requestedById is forced to the current
// user to prevent spoofing.
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const internal = await prisma.user.findUnique({
    where: { id: user.id },
    select: { canRequestBlitz: true },
  });
  if (!internal?.canRequestBlitz) {
    return NextResponse.json({ error: 'Forbidden — blitz request permission required' }, { status: 403 });
  }
  const body = await req.json();
  const type = body.type || 'create';

  const request = await prisma.blitzRequest.create({
    data: {
      requestedById: user.id,
      type,
      blitzId: type === 'cancel' ? body.blitzId : null,
      name: body.name || '',
      location: body.location || '',
      startDate: body.startDate || '',
      endDate: body.endDate || '',
      housing: body.housing || '',
      notes: body.notes || '',
      expectedHeadcount: body.expectedHeadcount || 0,
    },
    include: { requestedBy: true, blitz: true },
  });
  return NextResponse.json(request, { status: 201 });
}
