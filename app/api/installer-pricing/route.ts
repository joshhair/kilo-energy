import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createInstallerPricingSchema } from '../../../lib/schemas/pricing';

// POST /api/installer-pricing — Create a new pricing version (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createInstallerPricingSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // If closing the previous active version
  if (body.closePreviousForInstaller && body.closePreviousEffectiveTo) {
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
      rateType: body.rateType,
      tiers: {
        create: body.tiers.map((t) => ({
          minKW: t.minKW,
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
