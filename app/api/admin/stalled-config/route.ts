import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchStalledConfigSchema } from '../../../../lib/schemas/pricing';
import { logChange } from '../../../../lib/audit';
import { validateEmail } from '../../../../lib/validation';

// GET   /api/admin/stalled-config — Read the singleton config row (admin)
// PATCH /api/admin/stalled-config — Update the singleton config row (admin)
//
// The StalledAlertConfig table holds a single row keyed "singleton".
// The migration script seeds it; we never create or delete rows here.
// Read by /api/cron/stalled-digest at digest time.

const SINGLETON_ID = 'singleton';

interface StalledConfigResponse {
  enabled: boolean;
  soldDateCutoffDays: number;
  digestRecipients: string[];
  phaseThresholds: Record<string, number>;
  digestSendHourUtc: number;
  updatedAt: string;
}

function shapeResponse(row: {
  enabled: boolean;
  soldDateCutoffDays: number;
  digestRecipients: string;
  phaseThresholds: string;
  digestSendHourUtc: number;
  updatedAt: Date;
}): StalledConfigResponse {
  let recipients: string[] = [];
  try {
    const parsed = JSON.parse(row.digestRecipients) as unknown;
    if (Array.isArray(parsed)) recipients = parsed.filter((x): x is string => typeof x === 'string');
  } catch { recipients = []; }

  let thresholds: Record<string, number> = {};
  try {
    const parsed = JSON.parse(row.phaseThresholds) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) thresholds[k] = v;
      }
    }
  } catch { thresholds = {}; }

  return {
    enabled: row.enabled,
    soldDateCutoffDays: row.soldDateCutoffDays,
    digestRecipients: recipients,
    phaseThresholds: thresholds,
    digestSendHourUtc: row.digestSendHourUtc,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const row = await prisma.stalledAlertConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) {
    // Singleton missing — should never happen in practice (seeded by migration)
    // but recover gracefully by recreating with defaults.
    const created = await prisma.stalledAlertConfig.create({ data: { id: SINGLETON_ID } });
    return NextResponse.json(shapeResponse(created));
  }
  return NextResponse.json(shapeResponse(row));
}

export async function PATCH(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, patchStalledConfigSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};

  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.soldDateCutoffDays !== undefined) data.soldDateCutoffDays = body.soldDateCutoffDays;
  if (body.digestSendHourUtc !== undefined) data.digestSendHourUtc = body.digestSendHourUtc;

  // Validate every digest recipient email through validateEmail. Reject
  // the whole patch if any fail. Normalize + dedupe.
  if (body.digestRecipients !== undefined) {
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of body.digestRecipients) {
      if (raw.trim() === '') continue;
      const result = validateEmail(raw);
      if (!result.ok) {
        return NextResponse.json({ error: `digestRecipients: "${raw}" — ${result.reason}` }, { status: 400 });
      }
      if (seen.has(result.value)) continue;
      seen.add(result.value);
      cleaned.push(result.value);
    }
    data.digestRecipients = JSON.stringify(cleaned);
  }

  if (body.phaseThresholds !== undefined) {
    // Each value already validated as int 1..3650 by Zod; just persist.
    data.phaseThresholds = JSON.stringify(body.phaseThresholds);
  }

  data.updatedById = actor.id;

  const before = await prisma.stalledAlertConfig.findUnique({ where: { id: SINGLETON_ID } });
  const updated = await prisma.stalledAlertConfig.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });

  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'stalled_alert_config_update',
    entityType: 'StalledAlertConfig',
    entityId: SINGLETON_ID,
    detail: {
      fieldsChanged: Object.keys(data).filter((k) => k !== 'updatedById'),
      before: before
        ? {
            enabled: before.enabled,
            soldDateCutoffDays: before.soldDateCutoffDays,
            digestSendHourUtc: before.digestSendHourUtc,
            digestRecipients: before.digestRecipients,
            phaseThresholds: before.phaseThresholds,
          }
        : null,
      after: {
        enabled: updated.enabled,
        soldDateCutoffDays: updated.soldDateCutoffDays,
        digestSendHourUtc: updated.digestSendHourUtc,
        digestRecipients: updated.digestRecipients,
        phaseThresholds: updated.phaseThresholds,
      },
    },
  });

  return NextResponse.json(shapeResponse(updated));
}
