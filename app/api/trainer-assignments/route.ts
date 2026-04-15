import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// Maximum allowed trainer override rate. $0.50/W is 5x the typical setter
// premium of $0.10/W. Anything above this risks eating into closer pay
// at low soldPPW and is almost certainly a data-entry mistake.
const MAX_TRAINER_RATE_PER_W = 0.5;

type TierInput = { upToDeal: number | null; ratePerW: number };

function validateTiers(tiers: unknown): { ok: true; tiers: TierInput[] } | { ok: false; error: string } {
  if (!Array.isArray(tiers)) return { ok: false, error: 'tiers must be an array' };
  const out: TierInput[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i] as Partial<TierInput> | null;
    if (!t || typeof t !== 'object') return { ok: false, error: `tiers[${i}] is not an object` };

    const { upToDeal, ratePerW } = t;
    if (upToDeal !== null && (typeof upToDeal !== 'number' || !Number.isInteger(upToDeal) || upToDeal <= 0)) {
      return { ok: false, error: `tiers[${i}].upToDeal must be a positive integer or null` };
    }
    if (typeof ratePerW !== 'number' || !Number.isFinite(ratePerW)) {
      return { ok: false, error: `tiers[${i}].ratePerW must be a finite number` };
    }
    if (ratePerW < 0) {
      return { ok: false, error: `tiers[${i}].ratePerW cannot be negative` };
    }
    if (ratePerW > MAX_TRAINER_RATE_PER_W) {
      return { ok: false, error: `tiers[${i}].ratePerW exceeds cap of $${MAX_TRAINER_RATE_PER_W}/W — likely a data-entry error` };
    }
    out.push({ upToDeal, ratePerW });
  }
  // Verify tiers are ordered by upToDeal ascending (null = catch-all at end).
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].upToDeal;
    const cur = out[i].upToDeal;
    if (prev === null && cur !== null) {
      return { ok: false, error: 'null (catch-all) tier must be last' };
    }
    if (prev !== null && cur !== null && cur <= prev) {
      return { ok: false, error: 'tiers must be in ascending upToDeal order' };
    }
  }
  return { ok: true, tiers: out };
}

// POST /api/trainer-assignments — Create a trainer assignment (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();

  if (!body.trainerId || !body.traineeId) {
    return NextResponse.json({ error: 'trainerId and traineeId are required' }, { status: 400 });
  }
  if (body.trainerId === body.traineeId) {
    return NextResponse.json({ error: 'trainer and trainee must be different users' }, { status: 400 });
  }

  const tiersInput = body.tiers ?? [];
  const validated = validateTiers(tiersInput);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const assignment = await prisma.trainerAssignment.create({
    data: {
      trainerId: body.trainerId,
      traineeId: body.traineeId,
      tiers: validated.tiers.length
        ? {
            create: validated.tiers.map((t, i) => ({
              upToDeal: t.upToDeal,
              ratePerW: t.ratePerW,
              sortOrder: i,
            })),
          }
        : undefined,
    },
    include: { trainer: true, trainee: true, tiers: { orderBy: { sortOrder: 'asc' } } },
  });
  return NextResponse.json(assignment, { status: 201 });
}

// PATCH /api/trainer-assignments — Update tiers (admin only)
export async function PATCH(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  const { id, tiers } = body;

  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const validated = validateTiers(tiers ?? []);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  const assignment = await prisma.trainerAssignment.update({
    where: { id },
    data: {
      tiers: {
        create: validated.tiers.map((t, i) => ({
          upToDeal: t.upToDeal,
          ratePerW: t.ratePerW,
          sortOrder: i,
        })),
      },
    },
    include: { trainer: true, trainee: true, tiers: { orderBy: { sortOrder: 'asc' } } },
  });
  return NextResponse.json(assignment);
}

// DELETE /api/trainer-assignments — Delete a trainer assignment (admin only)
export async function DELETE(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await req.json();
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId: id } });
  await prisma.trainerAssignment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
