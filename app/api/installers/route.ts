import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/installers — Create a new installer (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const installer = await prisma.installer.create({
    data: {
      name: body.name,
      installPayPct: body.installPayPct ?? 80,
      usesProductCatalog: body.usesProductCatalog ?? false,
    },
  });

  // Auto-create a ProductCatalogConfig row for new PC installers
  if (body.usesProductCatalog) {
    await prisma.productCatalogConfig.create({
      data: {
        installerId: installer.id,
        families: (body.families as string[] ?? []).join(','),
        familyFinancerMap: JSON.stringify(body.familyFinancerMap ?? {}),
        prepaidFamily: body.prepaidFamily ?? null,
      },
    });
  }

  // Auto-create a baseline pricing version for new standard installers
  let pricingVersionId: string | null = null;
  if (!body.usesProductCatalog) {
    const pricingVersion = await prisma.installerPricingVersion.create({
      data: {
        installerId: installer.id,
        label: 'v1',
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
        rateType: 'flat',
        tiers: {
          create: [{
            minKW: 0,
            maxKW: null,
            closerPerW: 2.90,
            kiloPerW: 2.35,
          }],
        },
      },
    });
    pricingVersionId = pricingVersion.id;
  }

  return NextResponse.json({ ...installer, pricingVersionId }, { status: 201 });
}
