import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// PATCH /api/projects/[id] — Update a project (phase change, notes, flag, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();

  // Build update data, only including fields that were sent
  const data: Record<string, unknown> = {};
  if (body.phase !== undefined) data.phase = body.phase;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.flagged !== undefined) data.flagged = body.flagged;
  if (body.m1Paid !== undefined) data.m1Paid = body.m1Paid;
  if (body.m1Amount !== undefined) data.m1Amount = body.m1Amount;
  if (body.m2Paid !== undefined) data.m2Paid = body.m2Paid;
  if (body.m2Amount !== undefined) data.m2Amount = body.m2Amount;
  if (body.m3Amount !== undefined) data.m3Amount = body.m3Amount;
  if (body.baselineOverrideJson !== undefined) data.baselineOverrideJson = body.baselineOverrideJson;
  if (body.leadSource !== undefined) data.leadSource = body.leadSource;
  if (body.blitzId !== undefined) data.blitzId = body.blitzId;
  if (body.productType !== undefined) data.productType = body.productType;
  if (body.kWSize !== undefined) data.kWSize = body.kWSize;
  if (body.netPPW !== undefined) data.netPPW = body.netPPW;
  if (body.setterId !== undefined) data.setterId = body.setterId || null;
  if (body.soldDate !== undefined) data.soldDate = body.soldDate;
  // FK resolution: installer/financer name → ID
  if (body.installer !== undefined) {
    const inst = await prisma.installer.findFirst({ where: { name: body.installer } });
    if (inst) data.installerId = inst.id;
  }
  if (body.financer !== undefined) {
    const fin = await prisma.financer.findFirst({ where: { name: body.financer } });
    if (fin) data.financerId = fin.id;
  }

  const project = await prisma.project.update({
    where: { id },
    data,
    include: { closer: true, setter: true, installer: true, financer: true },
  });
  return NextResponse.json(project);
}

// DELETE /api/projects/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  // Delete related records first (activity, messages, payroll entries)
  await prisma.projectActivity.deleteMany({ where: { projectId: id } });
  await prisma.projectCheckItem.deleteMany({ where: { message: { projectId: id } } });
  await prisma.projectMention.deleteMany({ where: { message: { projectId: id } } });
  await prisma.projectMessage.deleteMany({ where: { projectId: id } });
  await prisma.payrollEntry.deleteMany({ where: { projectId: id } });
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
