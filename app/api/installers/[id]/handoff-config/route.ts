import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { parseJsonBody, parseJsonSafe } from '../../../../../lib/api-validation';
import { patchInstallerHandoffConfigSchema } from '../../../../../lib/schemas/pricing';
import { logChange, AUDITED_FIELDS } from '../../../../../lib/audit';
import { validateEmail } from '../../../../../lib/validation';
import { z } from 'zod';

// GET  /api/installers/[id]/handoff-config — Read installer handoff config (admin)
// PATCH /api/installers/[id]/handoff-config — Update installer handoff config (admin)
//
// Drives the per-installer auto-email of the intake PDF + utility bill
// at deal submission time. Audit-logged via lib/audit.logChange against
// AUDITED_FIELDS.Installer (which now includes the handoff fields).
//
// Email shape validation is two-layer: Zod (length + string type) +
// validateEmail() (NFC, invisible chars, format). validateEmail's
// normalized output is what we persist — admins can enter mixed-case
// or extra whitespace and we store the canonical form.

interface HandoffConfigResponse {
  id: string;
  primaryEmail: string | null;
  ccEmails: string[];
  subjectPrefix: string | null;
  handoffEnabled: boolean;
  customNotes: string;
}

function shapeResponse(installer: {
  id: string;
  primaryEmail: string | null;
  ccEmails: string;
  subjectPrefix: string | null;
  handoffEnabled: boolean;
  customNotes: string;
}): HandoffConfigResponse {
  // Malformed legacy JSON returns null and falls through to []. Don't
  // fail the response on bad stored data — admin needs to be able to
  // open the form to fix it.
  const ccEmails = parseJsonSafe(installer.ccEmails, z.array(z.string())) ?? [];
  return {
    id: installer.id,
    primaryEmail: installer.primaryEmail,
    ccEmails,
    subjectPrefix: installer.subjectPrefix,
    handoffEnabled: installer.handoffEnabled,
    customNotes: installer.customNotes,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const installer = await prisma.installer.findUnique({
    where: { id },
    select: {
      id: true,
      primaryEmail: true,
      ccEmails: true,
      subjectPrefix: true,
      handoffEnabled: true,
      customNotes: true,
    },
  });
  if (!installer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(shapeResponse(installer));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchInstallerHandoffConfigSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};

  // primaryEmail: null (clear) | string (validate + normalize) | undefined (skip)
  if (body.primaryEmail !== undefined) {
    if (body.primaryEmail === null || body.primaryEmail.trim() === '') {
      data.primaryEmail = null;
    } else {
      const result = validateEmail(body.primaryEmail);
      if (!result.ok) {
        return NextResponse.json({ error: `primaryEmail: ${result.reason}` }, { status: 400 });
      }
      data.primaryEmail = result.value;
    }
  }

  // ccEmails: validate every entry; reject the whole patch if any fail.
  // Normalized to lowercase + NFC; deduplicated.
  if (body.ccEmails !== undefined) {
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of body.ccEmails) {
      if (raw.trim() === '') continue; // silently drop empty entries
      const result = validateEmail(raw);
      if (!result.ok) {
        return NextResponse.json({ error: `ccEmails: "${raw}" — ${result.reason}` }, { status: 400 });
      }
      if (seen.has(result.value)) continue;
      seen.add(result.value);
      cleaned.push(result.value);
    }
    data.ccEmails = JSON.stringify(cleaned);
  }

  if (body.subjectPrefix !== undefined) {
    data.subjectPrefix = body.subjectPrefix === null ? null : body.subjectPrefix.trim() || null;
  }
  if (body.handoffEnabled !== undefined) {
    data.handoffEnabled = body.handoffEnabled;
  }
  if (body.customNotes !== undefined) {
    data.customNotes = body.customNotes;
  }

  // Refuse to enable handoff without a primary email — would just bounce
  // every send. Cross-field check after individual validation.
  const before = await prisma.installer.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const willBeEnabled = data.handoffEnabled === true || (data.handoffEnabled === undefined && before.handoffEnabled);
  const willHaveEmail = data.primaryEmail !== null && (data.primaryEmail !== undefined ? !!data.primaryEmail : !!before.primaryEmail);
  if (willBeEnabled && !willHaveEmail) {
    return NextResponse.json(
      { error: 'Cannot enable handoff without a primary email — set primaryEmail first.' },
      { status: 400 },
    );
  }

  const installer = await prisma.installer.update({ where: { id }, data });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'installer_handoff_config_update',
    entityType: 'Installer',
    entityId: installer.id,
    before, after: installer,
    fields: AUDITED_FIELDS.Installer,
  });

  return NextResponse.json(shapeResponse(installer));
}
