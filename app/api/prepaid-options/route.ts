import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createPrepaidOptionSchema } from '../../../lib/schemas/business';
import { logChange } from '../../../lib/audit';

// POST /api/prepaid-options — Add a prepaid option (admin only)
export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createPrepaidOptionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const option = await prisma.installerPrepaidOption.create({
    data: { installerId: body.installerId, name: body.name },
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'prepaid_option_create',
    entityType: 'PrepaidOption',
    entityId: option.id,
    detail: { name: option.name, installerId: option.installerId },
  });
  return NextResponse.json(option, { status: 201 });
}
