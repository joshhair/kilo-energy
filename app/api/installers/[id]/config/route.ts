import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';

// PATCH /api/installers/[id]/config — Update ProductCatalogConfig for an installer (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.families !== undefined) data.families = (body.families as string[]).join(',');
  if (body.familyFinancerMap !== undefined) data.familyFinancerMap = JSON.stringify(body.familyFinancerMap);
  if (body.prepaidFamily !== undefined) data.prepaidFamily = body.prepaidFamily;

  const config = await prisma.productCatalogConfig.update({
    where: { installerId: id },
    data,
  });
  return NextResponse.json(config);
}
