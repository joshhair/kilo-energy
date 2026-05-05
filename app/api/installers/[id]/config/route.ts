import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { patchInstallerConfigSchema } from '../../../../../lib/schemas/pricing';
import { logChange } from '../../../../../lib/audit';

// PATCH /api/installers/[id]/config — Update ProductCatalogConfig for an installer (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchInstallerConfigSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.families !== undefined) data.families = body.families.join(',');
  if (body.familyFinancerMap !== undefined) data.familyFinancerMap = JSON.stringify(body.familyFinancerMap);
  if (body.prepaidFamily !== undefined) data.prepaidFamily = body.prepaidFamily;

  const before = await prisma.productCatalogConfig.findUnique({ where: { installerId: id } });
  const config = await prisma.productCatalogConfig.update({
    where: { installerId: id },
    data,
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'product_catalog_config_update',
    entityType: 'ProductCatalogConfig',
    entityId: config.id,
    detail: {
      installerId: id,
      fieldsChanged: Object.keys(data),
      familiesBefore: before?.families,
      familiesAfter: config.families,
      familyFinancerMapBefore: before?.familyFinancerMap,
      familyFinancerMapAfter: config.familyFinancerMap,
      prepaidFamilyBefore: before?.prepaidFamily,
      prepaidFamilyAfter: config.prepaidFamily,
    },
  });
  return NextResponse.json(config);
}
