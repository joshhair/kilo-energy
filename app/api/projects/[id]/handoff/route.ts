import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { logChange } from '@/lib/audit';
import { logger, errorContext } from '@/lib/logger';
import { sendEmail, buildHandoffReplyTo } from '@/lib/email-helpers';
import { renderInstallerHandoffPdf, type HandoffPdfPayload } from '@/lib/pdf/installer-handoff';
import { renderHandoffEmailHtml } from '@/lib/email-templates/installer-handoff';
import { parseBviIntake, bviHandoffFilename } from '@/lib/installer-intakes/bvi';

// POST /api/projects/[id]/handoff — Send the installer handoff email.
//
// Composes:
//   - PDF rendered against the installer's master template (lib/forms/<slug>-intake.pdf)
//     filled with project + intake data.
//   - Utility bill attachment (fetched from the project's ProjectFile of kind='utility_bill')
//   - Email body via lib/email-templates/installer-handoff
//   - Recipients from Installer.primaryEmail + Installer.ccEmails
//   - Reply-To from rep email + partners@kiloenergies.com
//
// Idempotency: 60s replay guard via Project.handoffSentAt; subsequent
// resends require body { confirm: 'resend' } to bypass.
//
// Test mode: ?test=true sends to the calling admin's own email instead
// of the configured recipients, doesn't update Project.handoffSentAt,
// flags the EmailDelivery row with isTest=true.
//
// Audience: admin + internal PM only (vendor PM cannot trigger the send).
// Even though vendor PMs see installer surfaces, they don't trigger sends —
// that's a Kilo-side action.

interface RequestBody {
  confirm?: 'resend';
}

const RESEND_GUARD_MS = 60_000;

export const POST = withApiHandler<{ id: string }>(async (req, { params, user }) => {
  const { id } = await params!;

  // Auth: admin or internal PM (NOT vendor PM)
  if (user.role !== 'admin' && !(user.role === 'project_manager' && !user.scopedInstallerId)) {
    return NextResponse.json({ error: 'Forbidden — only admins / internal PMs can trigger handoff sends' }, { status: 403 });
  }

  const isTestMode = req.nextUrl.searchParams.get('test') === 'true';

  // Pull project + installer + utility bill in one round trip via gated db.
  // The gate enforces visibility; we additionally check installer.handoffEnabled.
  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true,
      customerName: true,
      installerIntakeJson: true,
      handoffSentAt: true,
      utilityBillFileId: true,
      kWSize: true,
      installer: {
        select: {
          id: true,
          name: true,
          primaryEmail: true,
          ccEmails: true,
          subjectPrefix: true,
          handoffEnabled: true,
          customNotes: true,
        },
      },
      financer: { select: { name: true } },
      closer: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!project.installer.handoffEnabled) {
    return NextResponse.json(
      { error: `Handoff not enabled for ${project.installer.name}. Configure recipients in admin settings first.` },
      { status: 400 },
    );
  }
  if (!project.installer.primaryEmail) {
    return NextResponse.json(
      { error: 'Handoff cannot send: installer has no primary email configured.' },
      { status: 400 },
    );
  }

  // Parse body for confirm flag (resend bypass)
  let body: RequestBody = {};
  try { body = (await req.json()) as RequestBody; } catch { /* empty body OK */ }

  // Idempotency: 60s replay guard. Resends after the window need confirm:'resend'.
  // Skip these checks in test mode.
  if (!isTestMode) {
    const sentAt = project.handoffSentAt?.getTime() ?? null;
    const now = Date.now();
    if (sentAt && now - sentAt < RESEND_GUARD_MS) {
      return NextResponse.json(
        { error: `Handoff was just sent ${Math.round((now - sentAt) / 1000)}s ago. Wait at least 60s before retrying.` },
        { status: 409 },
      );
    }
    if (sentAt && body.confirm !== 'resend') {
      return NextResponse.json(
        { error: `Handoff already sent for this project. Pass confirm:'resend' to override.`, code: 'ALREADY_SENT' },
        { status: 409 },
      );
    }
  }

  // Resolve installer slug — today only BVI is wired.
  const installerSlug = project.installer.name.toLowerCase().replace(/\s+/g, '-');
  if (installerSlug !== 'bvi') {
    return NextResponse.json(
      { error: `Handoff template not configured for installer "${project.installer.name}". Add lib/forms/${installerSlug}-intake.pdf and update the renderer.` },
      { status: 400 },
    );
  }

  // Resolve cc list from JSON column.
  let ccEmails: string[] = [];
  try {
    const parsed = JSON.parse(project.installer.ccEmails) as unknown;
    if (Array.isArray(parsed)) ccEmails = parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* empty */ }

  const intake = parseBviIntake(project.installerIntakeJson);
  const repName = `${project.closer.firstName} ${project.closer.lastName}`.trim();
  const customerLastName = project.customerName.split(/\s+/).pop() || project.customerName;
  const dateIso = new Date().toISOString().slice(0, 10);

  // Render PDF
  const pdfPayload: HandoffPdfPayload = {
    installerSlug: 'bvi',
    salesRepName: repName,
    customerName: project.customerName,
    financeProduct: project.financer.name,
    intake,
  };
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderInstallerHandoffPdf(pdfPayload);
  } catch (err) {
    logger.error('handoff_pdf_render_failed', { projectId: id, ...errorContext(err) });
    return NextResponse.json({ error: 'PDF generation failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  // Fetch utility bill (best-effort — we proceed without it if missing,
  // letting BVI ops know via a flag in the email body in a future iteration).
  let utilityBillAttachment: { filename: string; content: Buffer; contentType: string } | null = null;
  if (project.utilityBillFileId) {
    const file = await db.projectFile.findUnique({ where: { id: project.utilityBillFileId } });
    if (file) {
      try {
        const blobRes = await fetch(file.blobUrl);
        if (blobRes.ok) {
          const buf = Buffer.from(await blobRes.arrayBuffer());
          utilityBillAttachment = {
            filename: file.originalName || `utility-bill-${customerLastName}-${dateIso}.pdf`,
            content: buf,
            contentType: file.mimeType,
          };
        } else {
          logger.error('handoff_utility_bill_fetch_failed', { projectId: id, status: blobRes.status });
        }
      } catch (err) {
        logger.error('handoff_utility_bill_fetch_threw', { projectId: id, ...errorContext(err) });
      }
    }
  }

  // Build email envelope
  const subjectPrefix = project.installer.subjectPrefix?.trim() || `[${project.installer.name}]`;
  const subject = `${subjectPrefix} New Project — ${project.customerName} | ${project.kWSize.toFixed(1)}kW | Rep: ${repName}`;
  const html = renderHandoffEmailHtml({
    installerDisplayName: project.installer.name,
    customerName: project.customerName,
    customerAddress: intake.customerAddress,
    systemSizeKw: project.kWSize.toFixed(1),
    financeProduct: project.financer.name,
    exportType: intake.exportType ?? '',
    siteSurveyText:
      intake.siteSurveyNeeded === true ? 'Yes' :
      intake.siteSurveyNeeded === false ? 'No' : '',
    repName,
    repPhone: project.closer.phone || '',
    repEmail: project.closer.email,
    customNotes: project.installer.customNotes,
    projectUrl: `${process.env.APP_URL || 'https://app.kiloenergies.com'}/dashboard/projects/${project.id}`,
  });

  // Recipients
  const replyTo = buildHandoffReplyTo(project.closer.email);
  const to = isTestMode ? [user.email].filter(Boolean) : [project.installer.primaryEmail];
  const cc = isTestMode ? [] : ccEmails;

  // Send
  const sendResult = await sendEmail({
    to,
    cc,
    replyTo,
    subject: isTestMode ? `[TEST] ${subject}` : subject,
    html,
    attachments: [
      {
        filename: bviHandoffFilename(customerLastName, dateIso),
        content: Buffer.from(pdfBytes),
        contentType: 'application/pdf',
      },
      ...(utilityBillAttachment ? [utilityBillAttachment] : []),
    ],
  });

  if (!sendResult.ok) {
    logger.error('handoff_send_failed', { projectId: id, code: sendResult.code, error: sendResult.error });
    // Persist a failed-status EmailDelivery row so the failure shows on
    // the project page rather than vanishing silently.
    await db.emailDelivery.create({
      data: {
        projectId: id,
        installerId: project.installer.id,
        providerMessageId: null,
        toEmails: JSON.stringify(to),
        ccEmails: JSON.stringify(cc),
        subject,
        status: sendResult.code === 'NOT_CONFIGURED' ? 'failed' : 'failed',
        errorReason: sendResult.error,
        isTest: isTestMode,
        createdById: user.id,
      },
    });
    return NextResponse.json(
      { error: 'Email send failed', detail: sendResult.error, code: sendResult.code },
      { status: sendResult.code === 'NOT_CONFIGURED' ? 503 : 502 },
    );
  }

  // Persist EmailDelivery + bump Project.handoffSentAt (real sends only)
  const delivery = await db.emailDelivery.create({
    data: {
      projectId: id,
      installerId: project.installer.id,
      providerMessageId: sendResult.providerMessageId,
      toEmails: JSON.stringify(to),
      ccEmails: JSON.stringify(cc),
      subject,
      status: 'sent',
      isTest: isTestMode,
      createdById: user.id,
    },
  });

  if (!isTestMode) {
    const isResend = !!project.handoffSentAt;
    await db.project.update({
      where: { id },
      data: isResend
        ? { handoffLastResendAt: new Date() }
        : { handoffSentAt: new Date() },
    });
    await logChange({
      actor: { id: user.id, email: user.email },
      action: isResend ? 'project_handoff_resend' : 'project_handoff_send',
      entityType: 'EmailDelivery',
      entityId: delivery.id,
      detail: {
        projectId: id,
        installerId: project.installer.id,
        installerName: project.installer.name,
        to,
        cc,
        providerMessageId: sendResult.providerMessageId,
      },
    });
  } else {
    await logChange({
      actor: { id: user.id, email: user.email },
      action: 'project_handoff_test_send',
      entityType: 'EmailDelivery',
      entityId: delivery.id,
      detail: {
        projectId: id,
        installerId: project.installer.id,
        recipientUsedAdminEmail: user.email,
        providerMessageId: sendResult.providerMessageId,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    deliveryId: delivery.id,
    providerMessageId: sendResult.providerMessageId,
    isTest: isTestMode,
    to,
    cc,
  });
});
