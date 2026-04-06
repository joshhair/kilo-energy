import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '../../../lib/db';

// POST /api/projects — Create a new project/deal
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // PM must have canCreateDeals permission
  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (email) {
    const internalUser = await prisma.user.findFirst({ where: { email, active: true } });
    if (internalUser?.role === 'project_manager' && !internalUser.canCreateDeals) {
      return NextResponse.json({ error: 'Forbidden — deal creation not enabled for this account' }, { status: 403 });
    }
  }
  const body = await req.json();
  const project = await prisma.project.create({
    data: {
      customerName: body.customerName,
      closerId: body.closerId,
      setterId: body.setterId || null,
      soldDate: body.soldDate,
      installerId: body.installerId,
      financerId: body.financerId,
      productType: body.productType,
      kWSize: body.kWSize,
      netPPW: body.netPPW,
      phase: body.phase || 'New',
      m1Amount: body.m1Amount || 0,
      m2Amount: body.m2Amount || 0,
      m3Amount: body.m3Amount || 0,
      notes: body.notes || '',
      installerPricingVersionId: body.installerPricingVersionId || null,
      productId: body.productId || null,
      productPricingVersionId: body.productPricingVersionId || null,
      baselineOverrideJson: body.baselineOverrideJson || null,
      prepaidSubType: body.prepaidSubType || null,
      leadSource: body.leadSource || null,
      blitzId: body.blitzId || null,
      subDealerId: body.subDealerId || null,
    },
    include: { closer: true, setter: true, subDealer: true, installer: true, financer: true },
  });
  return NextResponse.json(project, { status: 201 });
}
