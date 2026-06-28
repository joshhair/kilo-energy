import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser, getInternalUserById, relationshipToProject } from '../../../../lib/api-auth';
import { resolveEffectiveUser } from '../../../../lib/view-as';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchBlitzSchema } from '../../../../lib/schemas/business';
import { serializeProject, serializeProjectParty, serializeBlitzCost, scrubProjectForViewer } from '../../../../lib/serialize';
import { logger } from '../../../../lib/logger';
import { logChange } from '../../../../lib/audit';
import { computeBlitzProfitabilityCents } from '../../../../lib/blitzComputed';
import { buildKiloPricingArrays } from '../../../../lib/kilo-pricing-arrays';

// GET /api/blitzes/[id] — Get a single blitz. Access:
// - admin, project_manager: yes
// - owner, creator, or approved participant: yes
// - everyone else: 403
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const blitz = await prisma.blitz.findUnique({
    where: { id },
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: { orderBy: { date: 'desc' } },
      projects: {
        include: {
          closer: true, setter: true, installer: true, financer: true,
          additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
          additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
        },
      },
      incentives: { include: { milestones: true } },
    },
  });
  if (!blitz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ─── PM canAccessBlitz gate (mirrors GET /api/blitzes) ───
  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // ─── Visibility check ───
  // Internal reps (rep, sub-dealer, trainer) can DISCOVER any blitz, not
  // just ones they're on. Roster transparency was Phase 2b's pillar —
  // reps were missing blitzes because the prior gate hid them from
  // non-participants. Sensitive data (BlitzCost rows, project-level
  // commission amounts) stays gated below via scrubProjectForViewer and
  // the costs-admin-only filter; nothing on the open-discovery side
  // leaks margin or pay info.
  //
  // The frontend uses the join-status to render a FOMO "Request to Join"
  // CTA for non-participants. Owner approves via the existing
  // /participants PATCH flow.
  //
  // No additional gate for non-admin/non-PM users — they all see.

  // BlitzCost rows are strictly admin-only. Earlier revisions exposed them
  // to the blitz owner on the theory that "they're running the blitz, they
  // should see their budget burn" — but BlitzCost is Kilo's operational
  // spend (housing/travel/meals/swag), not the participant's. Combined
  // with the per-project scrubbing below it would let an owner reconstruct
  // Kilo's net margin (closer baseline + kW + sold PPW minus costs). Lock
  // it down here; the desktop + mobile UI already hide the Costs tab from
  // non-admins, so this change has no UI-visible impact for owners.
  // View-As: an admin may impersonate a rep (?viewAs=<repId>) to see ONLY
  // the REP's view. All data visibility (owner-ness, join status,
  // announcements, per-project scrub, BlitzCost) uses the effective user;
  // only the audit identity + PM-access auth gate stay on the REAL user.
  const { effectiveUser, impersonating } = await resolveEffectiveUser(
    user, req.nextUrl.searchParams.get('viewAs'), getInternalUserById,
  );
  if (impersonating) {
    logger.info('view_as_read', { route: '/api/blitzes/[id]', actorId: user.id, effectiveUserId: effectiveUser.id });
  }

  const isBlitzOwner = blitz.ownerId === effectiveUser.id;
  // Costs gated on the EFFECTIVE user — viewing-as a rep shows ONLY the rep's
  // view (no BlitzCost rows). The PATCH path keeps its own real-user gate.
  const visibleCosts = effectiveUser.role === 'admin' ? blitz.costs : [];

  // ─── Announcements (field-gated) ───
  // The blitz detail itself is open-discovery for internal reps (above),
  // but announcements are addressed to the ROSTER: managers, the owner/
  // creator, and approved/invited participants. Waitlisted reps are
  // excluded until promoted (announcements can carry operational
  // logistics that aren't theirs yet — flip deliberately if waitlist
  // becomes a standby roster). Non-participant discovery viewers see none.
  const viewerJoinStatus = blitz.participants.find((p) => p.userId === effectiveUser.id)?.joinStatus ?? null;
  const canSeeAnnouncements =
    effectiveUser.role === 'admin' ||
    effectiveUser.role === 'project_manager' ||
    isBlitzOwner ||
    blitz.createdById === effectiveUser.id ||
    viewerJoinStatus === 'approved' ||
    viewerJoinStatus === 'invited';
  const [announcements, announcementsTotal] = canSeeAnnouncements
    ? await Promise.all([
        prisma.blitzAnnouncement.findMany({
          where: { blitzId: id },
          orderBy: { createdAt: 'desc' },
          take: 3,
        }),
        prisma.blitzAnnouncement.count({ where: { blitzId: id } }),
      ])
    : [[], 0];

  // ── Admin-only blitz profitability (server-computed integer cents) so the
  //    native Blitz Profitability tab renders without on-device cost-basis math.
  //    Reconciles to the client (same computeBlitzKiloMargin). NEVER the blitz
  //    owner — this is Kilo's P&L; gated on effectiveUser.role === 'admin'. ──
  let blitzProfitability: ReturnType<typeof computeBlitzProfitabilityCents> | null = null;
  if (effectiveUser.role === 'admin') {
    const [installers, products, installerPricingVersions, productPricingVersions] = await Promise.all([
      prisma.installer.findMany(),
      prisma.product.findMany({ where: { active: true }, include: { pricingVersions: { include: { tiers: true }, orderBy: { effectiveFrom: 'desc' } } } }),
      prisma.installerPricingVersion.findMany({ include: { tiers: true } }),
      prisma.productPricingVersion.findMany({ include: { tiers: true } }),
    ]);
    const instIdToName: Record<string, string> = {};
    for (const inst of installers) instIdToName[inst.id] = inst.name;
    const pricing = buildKiloPricingArrays({
      installerPricingVersions, products, productPricingVersions, instIdToName,
      solarTechInstallerId: installers.find((i) => i.name === 'SolarTech')?.id, now: new Date(),
    });
    blitzProfitability = computeBlitzProfitabilityCents(blitz, {
      solarTechProducts: pricing.solarTechProducts,
      productCatalogProducts: pricing.productCatalogProducts,
      installerPricingVersions: pricing.installerPricingVersions,
    });
  }
  const projectMarginById = new Map((blitzProfitability?.projectMarginsCents ?? []).map((m) => [m.projectId, m.kiloMarginCents]));

  return NextResponse.json({
    ...blitz,
    ...(blitzProfitability ? {
      kiloMarginCents: blitzProfitability.kiloMarginCents,
      totalCostsCents: blitzProfitability.totalCostsCents,
      netProfitCents: blitzProfitability.netProfitCents,
      roiBps: blitzProfitability.roiBps,
      costsByCategoryCents: blitzProfitability.costsByCategoryCents,
    } : {}),
    canSeeAnnouncements,
    announcements,
    announcementsTotal,
    costs: visibleCosts.map(serializeBlitzCost),
    projects: blitz.projects.map((p) => {
      const s = serializeProject(p);
      const withParties = {
        ...s,
        additionalClosers: p.additionalClosers.map(serializeProjectParty),
        additionalSetters: p.additionalSetters.map(serializeProjectParty),
      };
      // Admin: full passthrough (sees kiloMargin / baselineOverride.kiloPerW).
      // Everyone else: scrub. Blitz owners get the 'blitz_owner' relationship
      // override, which passes per-deal commission amounts + kW but still
      // strips Kilo's internal P&L fields (matrix in lib/fieldVisibility.ts).
      // Without the override they'd resolve to 'none' on deals they aren't
      // on and see $0 payouts — the cycle 1127 bug. The override fixes the
      // leaderboard without re-leaking margin.
      if (effectiveUser.role !== 'admin') {
        const naturalRel = relationshipToProject(effectiveUser, {
          closerId: p.closerId,
          setterId: p.setterId,
          subDealerId: p.subDealerId,
          trainerId: p.trainerId,
          additionalClosers: withParties.additionalClosers.map((c) => ({ userId: c.userId })),
          additionalSetters: withParties.additionalSetters.map((sv) => ({ userId: sv.userId })),
        });
        const rel = isBlitzOwner ? 'blitz_owner' : naturalRel;
        return scrubProjectForViewer(withParties, rel);
      }
      // Admin: passthrough + per-project blitz margin cents (only on approved-
      // participant deals, which are the ones that contribute to the rollup).
      return projectMarginById.has(p.id) ? { ...withParties, kiloMarginCents: projectMarginById.get(p.id) } : withParties;
    }),
  });
}

// PATCH /api/blitzes/[id] — Update blitz (admin or blitz owner)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  if (user.role !== 'admin') {
    const existing = await prisma.blitz.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.ownerId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, patchBlitzSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.location !== undefined) data.location = body.location;
  if (body.housing !== undefined) data.housing = body.housing;
  if (body.startDate !== undefined) data.startDate = body.startDate;
  if (body.endDate !== undefined) data.endDate = body.endDate;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.status !== undefined) {
    if (user.role !== 'admin' && (body.status === 'cancelled' || body.status === 'completed')) {
      return NextResponse.json({ error: 'Only admins can set a blitz to cancelled or completed' }, { status: 403 });
    }
    data.status = body.status;
  }
  if (body.ownerId !== undefined) {
    if (user.role !== 'admin') return NextResponse.json({ error: 'Only admins can transfer blitz ownership' }, { status: 403 });
    data.ownerId = body.ownerId;
  }
  // Phase 2e — RSVP fields. Owner-editable. confirmDeadline is stored as
  // DateTime; the client passes ISO string and Prisma coerces. Both fields
  // tolerate null to clear.
  if (body.confirmDeadline !== undefined) {
    data.confirmDeadline = body.confirmDeadline === null ? null : new Date(body.confirmDeadline);
  }
  if (body.maxParticipants !== undefined) {
    data.maxParticipants = body.maxParticipants;
  }

  const blitz = await prisma.blitz.update({
    where: { id },
    data,
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: {
        include: {
          closer: true, setter: true, installer: true, financer: true,
          additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
          additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
        },
      },
    },
  });

  // Deals are intentionally NOT unlinked when the window changes. Attachment is a
  // deliberate act and stays durable even if the deal's sold date later falls
  // outside the blitz dates (2026-06-05, per Josh — pairs with the soldDate-window
  // gate removal in POST/PATCH /api/projects). unlinkedCount stays 0; the field is
  // kept in the response for backwards compatibility.
  const unlinkedCount = 0;
  if (body.startDate !== undefined || body.endDate !== undefined) {
    // Re-link deals that now fall within the expanded date window
    const approvedParticipants = await prisma.blitzParticipant.findMany({
      where: { blitzId: id, joinStatus: 'approved' },
      select: { userId: true },
    });
    const approvedParticipantIds = approvedParticipants.map(p => p.userId);
    for (const { userId } of approvedParticipants) {
      await prisma.project.updateMany({
        where: {
          blitzId: null,
          soldDate: { gte: blitz.startDate, lte: blitz.endDate },
          closerId: userId,
          OR: [{ setterId: null }, { setterId: { in: approvedParticipantIds } }],
        },
        data: { blitzId: id },
      });
      await prisma.project.updateMany({
        where: {
          blitzId: null,
          soldDate: { gte: blitz.startDate, lte: blitz.endDate },
          setterId: userId,
          closerId: { in: approvedParticipantIds },
        },
        data: { blitzId: id },
      });
      const coRoleProjects = await prisma.project.findMany({
        where: {
          blitzId: null,
          soldDate: { gte: blitz.startDate, lte: blitz.endDate },
          OR: [
            { additionalClosers: { some: { userId } } },
            { additionalSetters: { some: { userId } } },
          ],
        },
        select: { id: true, closerId: true, setterId: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
      });
      for (const project of coRoleProjects) {
        const isAdditionalCloser = project.additionalClosers.some(ac => ac.userId === userId);
        const isAdditionalSetter = project.additionalSetters.some(as => as.userId === userId);
        const shouldLink =
          (isAdditionalCloser && project.setterId !== null && approvedParticipantIds.includes(project.setterId)) ||
          (isAdditionalSetter && project.closerId !== null && approvedParticipantIds.includes(project.closerId));
        if (shouldLink) {
          await prisma.project.update({ where: { id: project.id }, data: { blitzId: id } });
        }
      }
    }

    blitz.projects = await prisma.project.findMany({
      where: { blitzId: id },
      include: {
        closer: true, setter: true, installer: true, financer: true,
        additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
        additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
      },
    });
  }

  // Non-admins (except blitz owner): strip other reps' financial data from projects + hide costs.
  // Using `as unknown as` tightens the cast vs `any` — explicit about what
  // shape we're forcing, and only the fields we actually mutate.
  const isBlitzOwnerPatch = blitz.ownerId === user.id;
  if (user.role !== 'admin' && !isBlitzOwnerPatch) {
    (blitz as unknown as { costs: unknown[] }).costs = [];
    for (const p of blitz.projects) {
      type WithParties = { additionalClosers?: Array<{ userId: string }>; additionalSetters?: Array<{ userId: string }> };
      const pWithParties = p as WithParties;
      const isMyDeal = p.closerId === user.id || p.setterId === user.id
        || pWithParties.additionalClosers?.some((cc) => cc.userId === user.id)
        || pWithParties.additionalSetters?.some((cs) => cs.userId === user.id);
      if (!isMyDeal) {
        const mp = p as unknown as {
          netPPW: number;
          m1AmountCents: number;
          m2AmountCents: number;
          m3AmountCents: number;
          setterM1AmountCents: number;
          setterM2AmountCents: number;
          setterM3AmountCents: number;
        };
        mp.netPPW = 0;
        mp.m1AmountCents = 0;
        mp.m2AmountCents = 0;
        mp.m3AmountCents = 0;
        mp.setterM1AmountCents = 0;
        mp.setterM2AmountCents = 0;
        mp.setterM3AmountCents = 0;
      }
    }
  }

  logger.info('blitz_updated', {
    blitzId: id,
    actorId: user.id,
    fieldsChanged: Object.keys(data),
  });
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'blitz_update',
    entityType: 'Blitz',
    entityId: id,
    detail: {
      fieldsChanged: Object.keys(data),
      newStatus: blitz.status,
      newOwnerId: blitz.ownerId,
      unlinkedCount,
    },
  });
  // Mirror the GET endpoint's gates: costs admin-only, projects scrubbed
  // via 'blitz_owner' for owners (passes amounts, strips kiloMargin /
  // kiloPerW / adminNotes / trainer*). PATCH is reachable by admin OR
  // owner (the guard at the top of this handler), so `user.role !== admin`
  // here means the caller is the owner.
  const isPatchBlitzOwner = blitz.ownerId === user.id;
  const visibleCostsPatch = user.role === 'admin' ? blitz.costs : [];
  return NextResponse.json({
    ...blitz,
    unlinkedCount,
    costs: visibleCostsPatch.map(serializeBlitzCost),
    projects: blitz.projects.map((p) => {
      const s = serializeProject(p);
      type WithParties = { additionalClosers?: Array<Parameters<typeof serializeProjectParty>[0]>; additionalSetters?: Array<Parameters<typeof serializeProjectParty>[0]> };
      const pWithParties = p as WithParties;
      const withParties = {
        ...s,
        additionalClosers: pWithParties.additionalClosers?.map(serializeProjectParty) ?? [],
        additionalSetters: pWithParties.additionalSetters?.map(serializeProjectParty) ?? [],
      };
      if (user.role !== 'admin') {
        const naturalRel = relationshipToProject(user, {
          closerId: p.closerId,
          setterId: p.setterId,
          subDealerId: (p as { subDealerId?: string | null }).subDealerId ?? null,
          trainerId: (p as { trainerId?: string | null }).trainerId ?? null,
          additionalClosers: withParties.additionalClosers.map((c) => ({ userId: c.userId })),
          additionalSetters: withParties.additionalSetters.map((sv) => ({ userId: sv.userId })),
        });
        const rel = isPatchBlitzOwner ? 'blitz_owner' : naturalRel;
        return scrubProjectForViewer(withParties, rel);
      }
      return withParties;
    }),
  });
}

// DELETE /api/blitzes/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const before = await prisma.blitz.findUnique({ where: { id } });
  await prisma.project.updateMany({ where: { blitzId: id }, data: { blitzId: null } });
  await prisma.blitz.delete({ where: { id } });
  logger.info('blitz_deleted', { blitzId: id, actorId: actor.id });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'blitz_delete',
    entityType: 'Blitz',
    entityId: id,
    detail: before ? { name: before.name, ownerId: before.ownerId, startDate: before.startDate, endDate: before.endDate, status: before.status } : { id },
  });
  return NextResponse.json({ success: true });
}
