import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createInstallerSchema } from '../../../lib/schemas/pricing';

// GET /api/installers — admin only.
//   - ?name=X: look up a single installer by name
//   - no query param: return the full installer list, sorted by name
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const name = req.nextUrl.searchParams.get('name');
  if (name) {
    const installer = await prisma.installer.findFirst({ where: { name } });
    if (!installer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(installer);
  }
  const installers = await prisma.installer.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json(installers);
}

// POST /api/installers — Create a new installer (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createInstallerSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const installer = await prisma.installer.create({
    data: {
      name: body.name,
      installPayPct: body.installPayPct,
      usesProductCatalog: body.usesProductCatalog,
    },
  });

  // Auto-create a ProductCatalogConfig row for new PC installers
  if (body.usesProductCatalog) {
    await prisma.productCatalogConfig.create({
      data: {
        installerId: installer.id,
        families: (body.families ?? []).join(','),
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
            closerPerW: body.closerPerW ?? 2.90,
            kiloPerW: body.kiloPerW ?? 2.35,
          }],
        },
      },
    });
    pricingVersionId = pricingVersion.id;
  }

  return NextResponse.json({ ...installer, pricingVersionId }, { status: 201 });
}
