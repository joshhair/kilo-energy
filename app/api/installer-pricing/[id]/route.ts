import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/installer-pricing/[id] — Update pricing version (rates, effectiveTo, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.effectiveTo !== undefined) data.effectiveTo = body.effectiveTo;
  if (body.label !== undefined) data.label = body.label;

  // If updating tiers, delete existing and recreate
  if (body.tiers) {
    await prisma.installerPricingTier.deleteMany({ where: { versionId: id } });
    await prisma.installerPricingTier.createMany({
      data: body.tiers.map((t: { minKW: number; maxKW?: number | null; closerPerW: number; setterPerW?: number | null; kiloPerW: number }) => ({
        versionId: id,
        minKW: t.minKW ?? 0,
        maxKW: t.maxKW ?? null,
        closerPerW: t.closerPerW,
        setterPerW: t.setterPerW ?? null,
        kiloPerW: t.kiloPerW,
      })),
    });
  }

  const version = await prisma.installerPricingVersion.update({
    where: { id },
    data,
    include: { tiers: true },
  });
  return NextResponse.json(version);
}
