import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/projects/[id] — Update a project (phase change, notes, flag, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const project = await prisma.project.update({
    where: { id },
    data,
    include: { closer: true, setter: true, installer: true, financer: true },
  });
  return NextResponse.json(project);
}

// DELETE /api/projects/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
