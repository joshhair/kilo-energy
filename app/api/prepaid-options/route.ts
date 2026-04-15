import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createPrepaidOptionSchema } from '../../../lib/schemas/business';

// POST /api/prepaid-options — Add a prepaid option (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createPrepaidOptionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const option = await prisma.installerPrepaidOption.create({
    data: { installerId: body.installerId, name: body.name },
  });
  return NextResponse.json(option, { status: 201 });
}
