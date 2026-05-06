/**
 * Installer handoff send service.
 *
 * Extracts the PDF-render + email-send + delivery-log + audit-log core
 * from the manual handoff route so both the manual button and the
 * auto-send-on-deal-submit path can share it.
 *
 * Caller is responsible for:
 *   - Auth (admin vs rep vs system)
 *   - Replay guards (manual mode only — auto/test bypass)
 *
 * The service handles:
 *   - Project + installer + closer + financer load (gated db)
 *   - handoffEnabled / primaryEmail validation
 *   - PDF rendering (per installer slug)
 *   - Utility bill attachment fetch (best-effort)
 *   - Resend email send
 *   - EmailDelivery row persist (success or failure)
 *   - Project.handoffSentAt / handoffLastResendAt update (real sends only)
 *   - Audit log entry
 */

import { db } from '@/lib/db-gated';
import { logChange } from '@/lib/audit';
import { logger, errorContext } from '@/lib/logger';
import { sendEmail, buildHandoffReplyTo } from '@/lib/email-helpers';
import { renderInstallerHandoffPdf, type HandoffPdfPayload } from '@/lib/pdf/installer-handoff';
import { renderHandoffEmailHtml } from '@/lib/email-templates/installer-handoff';
import { parseBviIntake, bviHandoffFilename } from '@/lib/installer-intakes/bvi';

export type HandoffMode =
  | 'manual'   // admin/PM clicked Send/Resend in the project page
  | 'auto'     // rep submitted a BVI deal with auto-send checked
  | 'test';    // admin/PM clicked Test — sends to actor's email

export interface SendHandoffOptions {
  projectId: string;
  mode: HandoffMode;
  actor: { id: string; email: string };
}

export type SendHandoffResult =
  | {
      ok: true;
      deliveryId: string;
      providerMessageId: string | null;
      isTest: boolean;
      to: string[];
      cc: string[];
    }
  | {
      ok: false;
      status: number;            // suggested HTTP status for caller to surface
      error: string;
      code?: string;
      /** True when the failure was logged as a failed EmailDelivery row (so
       *  the project page can surface it). False when the failure was upstream
       *  of any send attempt (e.g. handoff disabled, no primaryEmail). */
      delivered?: boolean;
    };

export async function sendInstallerHandoff(opts: SendHandoffOptions): Promise<SendHandoffResult> {
  const { projectId, mode, actor } = opts;
  const isTest = mode === 'test';

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      customerName: true,
      installerIntakeJson: true,
      handoffSentAt: true,
      utilityBillFileId: true,
      kWSize: true,
      installer: {
        select: {
          id: true, name: true, primaryEmail: true, ccEmails: true,
          subjectPrefix: true, handoffEnabled: true, customNotes: true,
        },
      },
      financer: { select: { name: true } },
      closer: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  });
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  if (!project.installer.handoffEnabled) {
    return {
      ok: false, status: 400,
      error: `Handoff not enabled for ${project.installer.name}. Configure recipients in admin settings first.`,
    };
  }
  if (!project.installer.primaryEmail) {
    return {
      ok: false, status: 400,
      error: 'Handoff cannot send: installer has no primary email configured.',
    };
  }

  // Resolve installer slug — today only BVI is wired.
  const installerSlug = project.installer.name.toLowerCase().replace(/\s+/g, '-');
  if (installerSlug !== 'bvi') {
    return {
      ok: false, status: 400,
      error: `Handoff template not configured for installer "${project.installer.name}". Add lib/forms/${installerSlug}-intake.pdf and update the renderer.`,
    };
  }

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
    logger.error('handoff_pdf_render_failed', { projectId, ...errorContext(err) });
    return { ok: false, status: 500, error: 'PDF generation failed' };
  }

  // Fetch utility bill (best-effort)
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
          logger.error('handoff_utility_bill_fetch_failed', { projectId, status: blobRes.status });
        }
      } catch (err) {
        logger.error('handoff_utility_bill_fetch_threw', { projectId, ...errorContext(err) });
      }
    }
  }

  const subjectPrefix = project.installer.subjectPrefix?.trim() || `[${project.installer.name}]`;
  const baseSubject = `${subjectPrefix} New Project — ${project.customerName} | ${project.kWSize.toFixed(1)}kW | Rep: ${repName}`;
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

  const replyTo = buildHandoffReplyTo(project.closer.email);
  const to = isTest ? [actor.email].filter(Boolean) : [project.installer.primaryEmail];
  const cc = isTest ? [] : ccEmails;
  const subject = isTest ? `[TEST] ${baseSubject}` : baseSubject;

  // BCC list — combines:
  //   - The archive bcc (EMAIL_ARCHIVE_BCC, e.g. bvi-archive@kiloenergies.com)
  //   - The rep on real sends, so they have a paper trail of the exact
  //     email BVI received (PDF + utility bill). BCC keeps them invisible
  //     to the installer; replies still reach them via Reply-To.
  // Skipped on test mode — test sends go to admin's own email only.
  const archiveEmail = process.env.EMAIL_ARCHIVE_BCC;
  const directRecipients = [...to, ...cc].map((e) => e.toLowerCase());
  const bccList: string[] = [];
  if (archiveEmail && !directRecipients.includes(archiveEmail.toLowerCase())) {
    bccList.push(archiveEmail);
  }
  if (!isTest && project.closer.email && !directRecipients.includes(project.closer.email.toLowerCase())) {
    bccList.push(project.closer.email);
  }

  const sendResult = await sendEmail({
    to, cc, replyTo, subject, html,
    bccArchive: bccList.length > 0 ? bccList : null,
    attachments: [
      { filename: bviHandoffFilename(customerLastName, dateIso), content: Buffer.from(pdfBytes), contentType: 'application/pdf' },
      ...(utilityBillAttachment ? [utilityBillAttachment] : []),
    ],
  });

  if (!sendResult.ok) {
    logger.error('handoff_send_failed', { projectId, code: sendResult.code, error: sendResult.error });
    await db.emailDelivery.create({
      data: {
        projectId, installerId: project.installer.id,
        providerMessageId: null,
        toEmails: JSON.stringify(to), ccEmails: JSON.stringify(cc),
        subject, status: 'failed', errorReason: sendResult.error,
        isTest, createdById: actor.id,
      },
    });
    return {
      ok: false,
      status: sendResult.code === 'NOT_CONFIGURED' ? 503 : 502,
      error: sendResult.error,
      code: sendResult.code,
      delivered: true, // a failed-status row exists
    };
  }

  const delivery = await db.emailDelivery.create({
    data: {
      projectId, installerId: project.installer.id,
      providerMessageId: sendResult.providerMessageId,
      toEmails: JSON.stringify(to), ccEmails: JSON.stringify(cc),
      subject, status: 'sent',
      isTest, createdById: actor.id,
    },
  });

  if (!isTest) {
    const isResend = !!project.handoffSentAt;
    await db.project.update({
      where: { id: projectId },
      data: isResend ? { handoffLastResendAt: new Date() } : { handoffSentAt: new Date() },
    });
    await logChange({
      actor,
      action: mode === 'auto'
        ? 'project_handoff_auto_send'
        : isResend ? 'project_handoff_resend' : 'project_handoff_send',
      entityType: 'EmailDelivery',
      entityId: delivery.id,
      detail: {
        projectId, installerId: project.installer.id, installerName: project.installer.name,
        to, cc, providerMessageId: sendResult.providerMessageId,
      },
    });
  } else {
    await logChange({
      actor,
      action: 'project_handoff_test_send',
      entityType: 'EmailDelivery',
      entityId: delivery.id,
      detail: {
        projectId, installerId: project.installer.id,
        recipientUsedAdminEmail: actor.email,
        providerMessageId: sendResult.providerMessageId,
      },
    });
  }

  return {
    ok: true,
    deliveryId: delivery.id,
    providerMessageId: sendResult.providerMessageId,
    isTest,
    to, cc,
  };
}
