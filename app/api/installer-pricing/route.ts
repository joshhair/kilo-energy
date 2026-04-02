import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/installer-pricing — Create a new pricing version (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
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
        create: (body.tiers || []).map((t: { minKW: number; maxKW?: number | null; closerPerW: number; setterPerW?: number | null; kiloPerW: number; subDealerPerW?: number | null }) => ({
          minKW: t.minKW ?? 0,
          maxKW: t.maxKW ?? null,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW ?? null,
          kiloPerW: t.kiloPerW,
          subDealerPerW: t.subDealerPerW ?? null,
        })),
      },
    },
    include: { tiers: true },
  });
  return NextResponse.json(version, { status: 201 });
}
