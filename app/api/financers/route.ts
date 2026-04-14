import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// GET /api/financers?name=X — Look up a single financer by name (admin only)
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name query param required' }, { status: 400 });
  const financer = await prisma.financer.findFirst({ where: { name } });
  if (!financer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(financer);
}

// POST /api/financers — Create a new financer (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const financer = await prisma.financer.create({
    data: { name: body.name },
  });
  return NextResponse.json(financer, { status: 201 });
}
