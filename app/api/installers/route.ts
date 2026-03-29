import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/installers — Create a new installer
export async function POST(req: NextRequest) {
  const body = await req.json();
  const installer = await prisma.installer.create({
    data: {
      name: body.name,
      installPayPct: body.installPayPct ?? 80,
      usesProductCatalog: body.usesProductCatalog ?? false,
    },
  });

  // Auto-create a baseline pricing version for new standard installers
  if (!body.usesProductCatalog) {
    await prisma.installerPricingVersion.create({
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
  }

  return NextResponse.json(installer, { status: 201 });
}
