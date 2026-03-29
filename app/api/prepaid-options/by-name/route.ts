import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/prepaid-options/by-name?installerId=X&name=Y — Rename by installer+name
export async function PATCH(req: NextRequest) {
  const installerId = req.nextUrl.searchParams.get('installerId');
  const name = req.nextUrl.searchParams.get('name');
  if (!installerId || !name) return NextResponse.json({ error: 'installerId and name required' }, { status: 400 });

  const body = await req.json();
  const existing = await prisma.installerPrepaidOption.findFirst({ where: { installerId, name } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updated = await prisma.installerPrepaidOption.update({
    where: { id: existing.id },
    data: { name: body.name.trim() },
  });
  return NextResponse.json(updated);
}

// DELETE /api/prepaid-options/by-name?installerId=X&name=Y
export async function DELETE(req: NextRequest) {
  const installerId = req.nextUrl.searchParams.get('installerId');
  const name = req.nextUrl.searchParams.get('name');
  if (!installerId || !name) return NextResponse.json({ error: 'installerId and name required' }, { status: 400 });

  const existing = await prisma.installerPrepaidOption.findFirst({ where: { installerId, name } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.installerPrepaidOption.delete({ where: { id: existing.id } });
  return NextResponse.json({ success: true });
}
