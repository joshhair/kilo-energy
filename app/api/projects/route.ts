import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser, relationshipToProject } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProjectSchema } from '../../../lib/schemas/project';
import { enforceRateLimit } from '../../../lib/rate-limit';
import { serializeProject, serializeProjectParty, dollarsToCents, dollarsToNullableCents, scrubProjectForViewer } from '../../../lib/serialize';
import { logger, errorContext } from '../../../lib/logger';
import { logChange } from '../../../lib/audit';
import { sendInstallerHandoff } from '../../../lib/handoff-service';
import { withRequestContext } from '../../../lib/request-context';
import { loadChainTrainees } from '../../../lib/api-auth';
import { notify } from '../../../lib/notifications/service';
import {
  renderDealSubmittedRepEmail,
  renderDealSubmittedAdminEmail,
  type RepDealEmailData,
} from '../../../lib/email-templates/deal-submitted';

// POST /api/projects — Create a new project/deal.
// - admin: can create deals with any closer/setter/sub-dealer
// - project_manager: must have canCreateDeals flag; can create for any rep
// - rep: must be the closer or the setter on the deal they create
// - sub-dealer: must be the sub-dealer on the deal they create
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  // 30 deal creations/minute/user — the form + idempotency handle double-
  // clicks, so legit flow is nowhere near this. Catches runaway clients.
  const limited = await enforceRateLimit(`POST /api/projects:${user.id}`, 30, 60_000);
  if (limited) return limited;

  if (user.role === 'project_manager') {
    // Vendor PMs (scopedInstallerId set) NEVER create deals — they're
    // installer-side ops, not sales.
    if (user.scopedInstallerId) {
      return NextResponse.json({ error: 'Forbidden — vendor PMs cannot create deals' }, { status: 403 });
    }
    const pm = await prisma.user.findUnique({
      where: { id: user.id },
      select: { canCreateDeals: true },
    });
    if (!pm?.canCreateDeals) {
      return NextResponse.json({ error: 'Forbidden — deal creation not enabled for this account' }, { status: 403 });
    }
  }

  const parsed = await parseJsonBody(req, createProjectSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Admin-only fields: per-project trainer override. The schema accepts
  // them for forward-compat with admin tooling, but non-admin callers
  // (reps, sub-dealers, internal PMs) MUST NOT be able to set them via
  // a hand-crafted POST. Mirror the PM_BLOCKED_FIELDS doctrine from
  // PATCH /api/projects/[id]. Silent-strip rather than 403 so legitimate
  // admin-cloned forms don't break if a stale trainerId snuck into the
  // payload during a copy-paste flow.
  if (user.role !== 'admin') {
    if (body.trainerId !== undefined || body.trainerRate !== undefined) {
      logger.info('project_create_trainer_fields_stripped', {
        actorId: user.id,
        actorRole: user.role,
        attemptedTrainerId: body.trainerId ?? null,
        attemptedTrainerRate: body.trainerRate ?? null,
      });
    }
    body.trainerId = undefined;
    body.trainerRate = undefined;
  }

  // ─── Ownership check: reps + SDs can only create deals they're on ───
  if (user.role === 'rep') {
    const isCloser = body.closerId === user.id;
    const isSetter = body.setterId === user.id;
    if (!isCloser && !isSetter) {
      return NextResponse.json({ error: 'Forbidden — reps can only create deals they are on' }, { status: 403 });
    }
  } else if (user.role === 'sub-dealer') {
    if (body.subDealerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden — sub-dealers can only create their own deals' }, { status: 403 });
    }
  }

  // Validate blitz window and participation before writing
  if (body.blitzId) {
    if (!body.soldDate) {
      return NextResponse.json({ error: 'soldDate is required when blitzId is provided' }, { status: 400 });
    }
    const blitz = await prisma.blitz.findUnique({
      where: { id: body.blitzId },
      select: { startDate: true, endDate: true, status: true },
    });
    if (!blitz) {
      return NextResponse.json({ error: 'Blitz not found' }, { status: 400 });
    }
    if (blitz.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot attribute a deal to a cancelled blitz' }, { status: 400 });
    }
    const sold = new Date(body.soldDate);
    const start = new Date(blitz.startDate);
    const end = blitz.endDate ? new Date(blitz.endDate) : null;
    if (sold < start || (end !== null && sold > end)) {
      return NextResponse.json({ error: 'soldDate is outside the blitz window' }, { status: 400 });
    }

    if (body.closerId) {
      const participation = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: body.closerId, joinStatus: 'approved' },
      });
      if (!participation) {
        return NextResponse.json({ error: 'Closer is not an approved participant of this blitz' }, { status: 403 });
      }
    }
    if (body.setterId) {
      const setterParticipation = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: body.setterId, joinStatus: 'approved' },
      });
      if (!setterParticipation) {
        return NextResponse.json({ error: 'Setter is not an approved participant of this blitz' }, { status: 403 });
      }
    }
    for (const coCloser of body.additionalClosers ?? []) {
      const p = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: coCloser.userId, joinStatus: 'approved' },
      });
      if (!p) {
        return NextResponse.json({ error: 'Co-closer is not an approved participant of this blitz' }, { status: 403 });
      }
    }
    for (const coSetter of body.additionalSetters ?? []) {
      const p = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: coSetter.userId, joinStatus: 'approved' },
      });
      if (!p) {
        return NextResponse.json({ error: 'Co-setter is not an approved participant of this blitz' }, { status: 403 });
      }
    }
  }

  // ─── FK existence checks ───
  const closerRep = await prisma.user.findUnique({ where: { id: body.closerId }, select: { id: true, repType: true } });
  if (!closerRep) {
    return NextResponse.json({ error: 'Closer not found' }, { status: 400 });
  }
  if (closerRep.repType !== 'closer' && closerRep.repType !== 'both') {
    return NextResponse.json({ error: 'Setter-type rep cannot be assigned as closer' }, { status: 400 });
  }

  if (body.setterId) {
    const setterRep = await prisma.user.findUnique({ where: { id: body.setterId }, select: { repType: true } });
    if (!setterRep) {
      return NextResponse.json({ error: 'Setter not found' }, { status: 400 });
    }
    if (setterRep.repType !== 'setter' && setterRep.repType !== 'both') {
      return NextResponse.json({ error: 'Closer-type rep cannot be assigned as setter' }, { status: 400 });
    }
  }

  const installer = await prisma.installer.findUnique({ where: { id: body.installerId }, select: { id: true, active: true } });
  if (!installer) {
    return NextResponse.json({ error: 'Installer not found' }, { status: 400 });
  }
  if (!installer.active) {
    return NextResponse.json({ error: 'Installer is archived' }, { status: 400 });
  }

  // For Cash deals, auto-resolve the Cash financer so clients don't need the ID.
  // Cash is a system-managed record — we force active:true on every upsert so an
  // admin-triggered archive doesn't silently block new Cash deals.
  let financerId = body.financerId;
  const isCashAutoResolve = !financerId && (body.productType === 'Cash' || body.financer === 'Cash');
  if (isCashAutoResolve) {
    const cashFinancer = await prisma.financer.upsert({
      where: { name: 'Cash' },
      update: { active: true },
      create: { name: 'Cash', active: true },
    });
    financerId = cashFinancer.id;
  }
  if (!financerId) {
    return NextResponse.json({ error: 'financerId is required (unless productType=Cash)' }, { status: 400 });
  }
  // Skip the archive check on the auto-resolve path — we just reactivated it.
  if (!isCashAutoResolve) {
    const financer = await prisma.financer.findUnique({ where: { id: financerId }, select: { id: true, active: true } });
    if (!financer) {
      return NextResponse.json({ error: 'Financer not found' }, { status: 400 });
    }
    if (!financer.active) {
      return NextResponse.json({ error: 'Financer is archived' }, { status: 400 });
    }
  }

  // Build the additionalClosers / additionalSetters nested-create payload
  // so the project + its co-party rows land in a single Prisma transaction.
  // Fallback position assignment: if the client didn't send one, use the
  // array index + 1 (so the first co-closer is position 1, matching the
  // UI's "1-indexed display order" contract).
  const additionalClosersCreate = (body.additionalClosers ?? []).map((c, i) => ({
    userId: c.userId,
    m1AmountCents: dollarsToCents(c.m1Amount) ?? 0,
    m2AmountCents: dollarsToCents(c.m2Amount) ?? 0,
    m3AmountCents: dollarsToNullableCents(c.m3Amount) ?? null,
    position: c.position ?? i + 1,
  }));
  const additionalSettersCreate = (body.additionalSetters ?? []).map((s, i) => ({
    userId: s.userId,
    m1AmountCents: dollarsToCents(s.m1Amount) ?? 0,
    m2AmountCents: dollarsToCents(s.m2Amount) ?? 0,
    m3AmountCents: dollarsToNullableCents(s.m3Amount) ?? null,
    position: s.position ?? i + 1,
  }));

  const project = await prisma.project.create({
    data: {
      customerName: body.customerName,
      closerId: body.closerId,
      setterId: body.setterId ?? null,
      soldDate: body.soldDate,
      installerId: body.installerId,
      financerId,
      productType: body.productType,
      kWSize: body.kWSize,
      netPPW: body.netPPW,
      phase: body.phase,
      m1AmountCents: dollarsToCents(body.m1Amount) ?? 0,
      m2AmountCents: dollarsToCents(body.m2Amount) ?? 0,
      m3AmountCents: dollarsToNullableCents(body.m3Amount) ?? null,
      setterM1AmountCents: dollarsToCents(body.setterM1Amount) ?? 0,
      setterM2AmountCents: dollarsToCents(body.setterM2Amount) ?? 0,
      setterM3AmountCents: dollarsToNullableCents(body.setterM3Amount) ?? null,
      notes: body.notes ?? '',
      installerPricingVersionId: body.installerPricingVersionId ?? null,
      productId: body.productId ?? null,
      productPricingVersionId: body.productPricingVersionId ?? null,
      baselineOverrideJson: body.baselineOverrideJson ?? null,
      prepaidSubType: body.prepaidSubType ?? null,
      leadSource: body.leadSource ?? null,
      blitzId: body.blitzId ?? null,
      subDealerId: body.subDealerId ?? null,
      installerIntakeJson: body.installerIntakeJson ?? null,
      // Project-level trainer override: when admin assigns a specific
      // trainer + rate to a single deal (one-off, overrides TrainerAssignment
      // chain). Schema accepts both fields but the create payload was
      // dropping them on insert — the deal_submitted_rep trainer email
      // and downstream phase-transition trainer payout logic depend on
      // these landing in the row at create time.
      trainerId: body.trainerId ?? null,
      trainerRate: body.trainerRate ?? null,
      ...(additionalClosersCreate.length ? { additionalClosers: { create: additionalClosersCreate } } : {}),
      ...(additionalSettersCreate.length ? { additionalSetters: { create: additionalSettersCreate } } : {}),
    },
    include: {
      closer: true, setter: true, subDealer: true, installer: true, financer: true, trainer: true,
      additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
      additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
    },
  });

  // Materialize submitted notes into a ProjectNote row so they appear on
  // the project detail page. The legacy Project.notes column still gets
  // the same value (write-both during transition) but the display layer
  // reads from ProjectNote rows since the 2026-04-23 notes UI refactor.
  // Without this step the rep's submission note silently vanishes from
  // every view (Hunter Helton, 2026-05-11).
  const noteText = (body.notes ?? '').trim();
  if (noteText.length > 0) {
    try {
      const author = await prisma.user.findUnique({
        where: { id: user.id },
        select: { firstName: true, lastName: true },
      });
      const authorName = author
        ? `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim() || user.email
        : user.email;
      await prisma.projectNote.create({
        data: {
          projectId: project.id,
          authorId: user.id,
          authorName,
          text: noteText,
        },
      });
    } catch (err) {
      // Non-fatal — project is created, but the note didn't materialize.
      // Log loudly so we can debug; UX shows the deal but not the note.
      logger.warn('project_create_note_materialization_failed', {
        projectId: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const dto = {
    ...serializeProject(project),
    additionalClosers: project.additionalClosers.map(serializeProjectParty),
    additionalSetters: project.additionalSetters.map(serializeProjectParty),
  };
  const rel = relationshipToProject(user, {
    closerId: project.closerId,
    setterId: project.setterId,
    subDealerId: project.subDealerId,
    trainerId: project.trainerId,
    additionalClosers: dto.additionalClosers.map((c) => ({ userId: c.userId })),
    additionalSetters: dto.additionalSetters.map((s) => ({ userId: s.userId })),
  });
  logger.info('project_created', {
    projectId: project.id,
    actorId: user.id,
    actorRole: user.role,
    closerId: project.closerId,
    setterId: project.setterId,
    kWSize: project.kWSize,
    netPPW: project.netPPW,
    m1Cents: project.m1AmountCents,
    m2Cents: project.m2AmountCents,
    m3Cents: project.m3AmountCents,
  });
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_create',
    entityType: 'Project',
    entityId: project.id,
    detail: {
      actorRole: user.role,
      trainerId: body.trainerId ?? null,
      trainerRate: body.trainerRate ?? null,
      customerName: project.customerName,
      closerId: project.closerId,
      setterId: project.setterId,
      subDealerId: project.subDealerId,
      installerId: project.installerId,
      financerId: project.financerId,
      productId: project.productId,
      kWSize: project.kWSize,
      netPPW: project.netPPW,
      m1AmountCents: project.m1AmountCents,
      m2AmountCents: project.m2AmountCents,
      m3AmountCents: project.m3AmountCents,
      blitzId: project.blitzId,
      soldDate: project.soldDate,
      additionalCloserCount: project.additionalClosers.length,
      additionalSetterCount: project.additionalSetters.length,
    },
  });

  // Auto-send installer handoff email if rep opted in via the BVI intake
  // panel + admin has handoff enabled for the installer. Failures are
  // logged but do NOT roll back the deal — the project exists, the rep's
  // submit succeeded, and the failure surfaces on the project page as a
  // failed-status EmailDelivery row that admin/PM can inspect or retry.
  //
  // The service uses lib/db-gated which requires a RequestContext (set up
  // by withApiHandler in other routes). This route uses requireInternalUser
  // directly, so we wrap the service call ourselves — otherwise the gated
  // db throws and the auto-send silently fails.
  if (body.requestHandoff && project.installer.handoffEnabled) {
    try {
      const chainTrainees = user.role === 'rep'
        ? await loadChainTrainees(user.id)
        : new Set<string>();
      const result = await withRequestContext(
        { user, chainTraineeIds: Array.from(chainTrainees) },
        () => sendInstallerHandoff({
          projectId: project.id,
          mode: 'auto',
          actor: { id: user.id, email: user.email },
        }),
      );
      if (!result.ok) {
        logger.error('handoff_auto_send_failed', {
          projectId: project.id,
          status: result.status,
          error: result.error,
          code: result.code,
        });
      } else {
        logger.info('handoff_auto_send_ok', {
          projectId: project.id,
          deliveryId: result.deliveryId,
          providerMessageId: result.providerMessageId,
        });
      }
    } catch (err) {
      logger.error('handoff_auto_send_threw', { projectId: project.id, ...errorContext(err) });
    }
  }

  // Fire deal-submitted notifications. Two events:
  //   - deal_submitted_rep → closer + setter + co-parties + trainer (if
  //     attached). Each gets THEIR slice only; no other-party amounts,
  //     no kilo margin, no baseline rates. Privacy enforced at the type
  //     level via RepDealEmailData (no margin / baseline fields exist).
  //   - deal_submitted_admin → every active admin (preferences gate).
  //     Full attribution + commission breakdown for ops awareness.
  // Sub-dealer deals skip the rep event entirely; admin event fires.
  // Fire-and-forget — never block the response on the email fanout.
  void (async () => {
    try {
      const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';
      const projectUrl = `${appUrl}/dashboard/projects/${project.id}`;
      const salePrice = project.netPPW * project.kWSize * 1000;
      const closerName = project.closer
        ? `${project.closer.firstName ?? ''} ${project.closer.lastName ?? ''}`.trim() || project.closer.email
        : 'Unknown';
      const setterName = project.setter
        ? `${project.setter.firstName ?? ''} ${project.setter.lastName ?? ''}`.trim() || project.setter.email
        : undefined;
      const trainerName = project.trainer
        ? `${project.trainer.firstName ?? ''} ${project.trainer.lastName ?? ''}`.trim() || project.trainer.email
        : undefined;
      const coCloserNames = project.additionalClosers
        .map((c) => `${c.user.firstName ?? ''} ${c.user.lastName ?? ''}`.trim() || c.user.email)
        .filter((n) => n.length > 0);
      const coSetterNames = project.additionalSetters
        .map((s) => `${s.user.firstName ?? ''} ${s.user.lastName ?? ''}`.trim() || s.user.email)
        .filter((n) => n.length > 0);

      const closerTotal = (project.m1AmountCents + project.m2AmountCents + (project.m3AmountCents ?? 0)) / 100;
      const setterTotal = (project.setterM1AmountCents + project.setterM2AmountCents + (project.setterM3AmountCents ?? 0)) / 100;
      const trainerRate = project.trainerRate ?? 0;
      const trainerPayout = trainerRate > 0 ? trainerRate * project.kWSize * 1000 : 0;
      const isSubDealer = project.subDealerId != null;

      // --- Rep notifications: one per non-sub-dealer party.
      const repTargets: Array<{ userId: string; firstName: string; role: RepDealEmailData['recipientRole']; commission: { m1: number; m2: number; m3?: number | null } }> = [];
      if (!isSubDealer && project.closerId) {
        repTargets.push({
          userId: project.closerId,
          firstName: project.closer?.firstName ?? '',
          role: 'closer',
          commission: {
            m1: project.m1AmountCents / 100,
            m2: project.m2AmountCents / 100,
            m3: project.m3AmountCents == null ? null : project.m3AmountCents / 100,
          },
        });
      }
      if (!isSubDealer && project.setterId) {
        repTargets.push({
          userId: project.setterId,
          firstName: project.setter?.firstName ?? '',
          role: 'setter',
          commission: {
            m1: project.setterM1AmountCents / 100,
            m2: project.setterM2AmountCents / 100,
            m3: project.setterM3AmountCents == null ? null : project.setterM3AmountCents / 100,
          },
        });
      }
      if (!isSubDealer) {
        for (const cc of project.additionalClosers) {
          repTargets.push({
            userId: cc.userId,
            firstName: cc.user.firstName ?? '',
            role: 'co-closer',
            commission: {
              m1: cc.m1AmountCents / 100,
              m2: cc.m2AmountCents / 100,
              m3: cc.m3AmountCents == null ? null : cc.m3AmountCents / 100,
            },
          });
        }
        for (const cs of project.additionalSetters) {
          repTargets.push({
            userId: cs.userId,
            firstName: cs.user.firstName ?? '',
            role: 'co-setter',
            commission: {
              m1: cs.m1AmountCents / 100,
              m2: cs.m2AmountCents / 100,
              m3: cs.m3AmountCents == null ? null : cs.m3AmountCents / 100,
            },
          });
        }
      }
      // Trainer is notified on attribution. Their actual commission
      // amounts accrue on M2/M3 milestones, so we show the per-watt
      // rate as their slice (representative — full payout is computed
      // when payroll entries are drafted at the milestone phase).
      if (!isSubDealer && project.trainerId && trainerPayout > 0) {
        const trainerInstallPayPct = project.installer?.installPayPct ?? 100;
        const trainerM2 = trainerPayout * (trainerInstallPayPct / 100);
        const trainerM3 = trainerPayout - trainerM2;
        repTargets.push({
          userId: project.trainerId,
          firstName: project.trainer?.firstName ?? '',
          role: 'trainer',
          commission: { m1: 0, m2: trainerM2, m3: trainerM3 > 0 ? trainerM3 : null },
        });
      }

      const repSends = repTargets.map((target) => {
        const data: RepDealEmailData = {
          recipientFirstName: target.firstName || 'there',
          recipientRole: target.role,
          customerName: project.customerName,
          soldDate: project.soldDate,
          kWSize: project.kWSize,
          salePrice,
          myCommission: target.commission,
          parties: {
            closerName: target.role === 'closer' ? undefined : closerName,
            setterName: target.role === 'setter' ? undefined : setterName,
            trainerName: target.role === 'trainer' ? undefined : trainerName,
            coCloserNames: coCloserNames.length > 0 ? coCloserNames : undefined,
            coSetterNames: coSetterNames.length > 0 ? coSetterNames : undefined,
          },
          projectUrl,
        };
        const { subject, html } = renderDealSubmittedRepEmail(data);
        return notify({
          type: 'deal_submitted_rep',
          userId: target.userId,
          projectId: project.id,
          subject,
          emailHtml: html,
        });
      });

      // --- Admin notifications: fan out to every active admin.
      const admins = await prisma.user.findMany({
        where: { role: 'admin', active: true },
        select: { id: true },
      });
      const { subject: adminSubject, html: adminHtml } = renderDealSubmittedAdminEmail({
        customerName: project.customerName,
        closerName,
        setterName,
        trainerName,
        installer: project.installer?.name ?? '',
        financer: project.financer?.name,
        soldDate: project.soldDate,
        kWSize: project.kWSize,
        netPPW: project.netPPW,
        salePrice,
        closerTotal,
        setterTotal,
        trainerPayout,
        coCloserNames: coCloserNames.length > 0 ? coCloserNames : undefined,
        coSetterNames: coSetterNames.length > 0 ? coSetterNames : undefined,
        isSubDealer,
        projectUrl,
      });
      const adminSends = admins.map((a) =>
        notify({
          type: 'deal_submitted_admin',
          userId: a.id,
          projectId: project.id,
          subject: adminSubject,
          emailHtml: adminHtml,
        })
      );

      await Promise.allSettled([...repSends, ...adminSends]);
    } catch (err) {
      logger.warn('deal_submitted_notify_failed', {
        projectId: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return NextResponse.json(scrubProjectForViewer(dto, rel), { status: 201 });
}
