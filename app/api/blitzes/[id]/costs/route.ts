import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { createBlitzCostSchema } from '../../../../../lib/schemas/business';
import { serializeBlitzCost } from '../../../../../lib/serialize';
import { fromDollars } from '../../../../../lib/money';
import { logger, errorContext } from '../../../../../lib/logger';
import { logChange } from '../../../../../lib/audit';
import { enforceAdminMutationLimit } from '../../../../../lib/rate-limit';

// POST /api/blitzes/[id]/costs — Add a cost
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'POST /api/blitzes/[id]/costs');
  if (limited) return limited;

  const parsed = await parseJsonBody(req, createBlitzCostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const cost = await prisma.blitzCost.create({
      data: {
        blitzId,
        category: body.category,
        amountCents: fromDollars(body.amount).cents,
        description: body.description ?? '',
        date: body.date,
      },
    });
    logger.info('blitz_cost_created', {
      costId: cost.id,
      blitzId,
      actorId: actor.id,
      amountCents: cost.amountCents,
      category: cost.category,
    });
    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'blitz_cost_create',
      entityType: 'BlitzCost',
      entityId: cost.id,
      detail: {
        blitzId,
        category: cost.category,
        amountCents: cost.amountCents,
        description: cost.description,
        date: cost.date,
      },
    });
    return NextResponse.json(serializeBlitzCost(cost), { status: 201 });
  } catch (err) {
    logger.error('blitz_cost_create_failed', {
      blitzId,
      actorId: actor.id,
      category: body.category,
      amountCents: fromDollars(body.amount).cents,
      ...errorContext(err),
    });
    return NextResponse.json({ error: 'Failed to create cost' }, { status: 500 });
  }
}

// DELETE /api/blitzes/[id]/costs — Delete a cost
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'DELETE /api/blitzes/[id]/costs');
  if (limited) return limited;

  const costId = req.nextUrl.searchParams.get('costId');
  if (!costId) return NextResponse.json({ error: 'costId required' }, { status: 400 });

  const before = await prisma.blitzCost.findUnique({ where: { id: costId } });
  await prisma.blitzCost.delete({ where: { id: costId, blitzId } });
  logger.info('blitz_cost_deleted', { costId, blitzId, actorId: actor.id });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'blitz_cost_delete',
    entityType: 'BlitzCost',
    entityId: costId,
    detail: before
      ? { blitzId, category: before.category, amountCents: before.amountCents, description: before.description }
      : { blitzId, costId },
  });
  return NextResponse.json({ success: true });
}
