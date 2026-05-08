import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createFinancerSchema } from '../../../lib/schemas/business';
import { logChange } from '../../../lib/audit';
import { enforceAdminMutationLimit } from '../../../lib/rate-limit';

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
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const limited = await enforceAdminMutationLimit(actor.id, 'POST /api/financers');
  if (limited) return limited;

  const parsed = await parseJsonBody(req, createFinancerSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const financer = await prisma.financer.create({
    data: { name: body.name },
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'financer_create',
    entityType: 'Financer',
    entityId: financer.id,
    detail: { name: financer.name, active: financer.active },
  });
  return NextResponse.json(financer, { status: 201 });
}
