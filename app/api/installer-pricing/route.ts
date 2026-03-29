import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/installer-pricing — Create a new pricing version with tiers
export async function POST(req: NextRequest) {
  const body = await req.json();
  // body: { installerId, label, effectiveFrom, effectiveTo?, rateType, tiers: [{minKW, maxKW, closerPerW, setterPerW?, kiloPerW}] }

  // If closing the previous active version
  if (body.closePreviousForInstaller) {
    await prisma.installerPricingVersion.updateMany({
      where: { installerId: body.installerId, effectiveTo: null },
      data: { effectiveTo: body.closePreviousEffectiveTo },
    });
  }

  const version = await prisma.installerPricingVersion.create({
    data: {
      installerId: body.installerId,
      label: body.label,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      rateType: body.rateType || 'flat',
      tiers: {
        create: (body.tiers || []).map((t: { minKW: number; maxKW?: number | null; closerPerW: number; setterPerW?: number | null; kiloPerW: number }) => ({
          minKW: t.minKW ?? 0,
          maxKW: t.maxKW ?? null,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW ?? null,
          kiloPerW: t.kiloPerW,
        })),
      },
    },
    include: { tiers: true },
  });
  return NextResponse.json(version, { status: 201 });
}
