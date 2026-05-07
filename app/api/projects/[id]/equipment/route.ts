import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { serializeEquipmentForProjectPage } from '@/lib/serializers/equipment';
import { parseBviIntake } from '@/lib/installer-intakes/bvi';
import { SOLARTECH_PRODUCTS } from '@/lib/data';

// GET /api/projects/[id]/equipment — equipment snapshot for the project page.
//
// All roles can call this — the response is non-sensitive (product name,
// family, installer/financer display names). Pricing fields are NOT in
// the response shape (see lib/serializers/equipment.ts) — pricing leakage
// is the load-bearing invariant this endpoint protects.
//
// Privacy: the parent Project is fetched via gated `db` so callers who
// can't see the project get a 404. Once visible, equipment metadata is
// safe to return without further restriction.

export const GET = withApiHandler<{ id: string }>(async (_req, { params }) => {
  const { id } = await params!;

  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      installerIntakeJson: true,
      installer: { select: { name: true } },
      financer: { select: { name: true } },
      product: {
        select: {
          id: true,
          name: true,
          family: true,
          // No pricing fields. Adding any here is a leak.
        },
      },
    },
  });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // SolarTech fallback: SolarTech products live in a hardcoded array
  // (lib/data.SOLARTECH_PRODUCTS), not the Product table. When the
  // project.product Prisma include returns null but productId is set,
  // try resolving from the hardcoded array. This is what makes the
  // Equipment snapshot show real product info on SolarTech deals
  // instead of the empty state that Bryce reported as "just shows Cash".
  let resolvedProduct = project.product
    ? { id: project.product.id, name: project.product.name, family: project.product.family ?? null }
    : null;
  if (!resolvedProduct && project.productId) {
    const st = SOLARTECH_PRODUCTS.find((p) => p.id === project.productId);
    if (st) {
      resolvedProduct = { id: st.id, name: st.name, family: st.family };
    }
  }

  const intake = parseBviIntake(project.installerIntakeJson);
  return NextResponse.json(
    serializeEquipmentForProjectPage({
      product: resolvedProduct,
      installerName: project.installer.name,
      financerName: project.financer.name,
      exportType: intake.exportType,
    }),
  );
});
