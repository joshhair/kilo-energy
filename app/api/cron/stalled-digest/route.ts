import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/db';
import { sendEmail } from '@/lib/email-helpers';
import { logger, errorContext } from '@/lib/logger';
import { parseJsonSafe } from '@/lib/api-validation';
import { z } from 'zod';

// POST /api/cron/stalled-digest — Daily summary of stalled projects + recent bounces.
//
// Reads StalledAlertConfig (singleton), iterates active projects, applies
// three filters, and sends a single digest email to the configured recipients.
//
// Filters (per the plan):
//   A. Phase exclusion: terminal phases (PTO/Completed/Cancelled/On Hold) skip
//   B. Sold-date cutoff: projects sold > N days ago skip (legacy-data filter)
//   C. (deferred) per-project mute toggle
//
// Auth: Bearer token from GitHub Actions OR admin session for manual ad-hoc runs.
// Cron context — no user, uses dbAdmin.

const TERMINAL_PHASES = new Set(['PTO', 'Completed', 'Cancelled', 'On Hold']);

const DEFAULT_THRESHOLDS: Record<string, number> = {
  'New': 5, 'Acceptance': 10, 'Site Survey': 20, 'Design': 30,
  'Permitting': 50, 'Pending Install': 65, 'Installed': 75,
};

interface StalledRow {
  id: string;
  customerName: string;
  phase: string;
  daysInPhase: number;
  threshold: number;
  installerName: string;
}

function daysBetween(from: Date | string, to: Date): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  if (Number.isNaN(start.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((to.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function parseRecipients(json: string): string[] {
  return parseJsonSafe(json, z.array(z.string())) ?? [];
}

function parseThresholds(json: string): Record<string, number> {
  return parseJsonSafe(
    json,
    z.record(z.string(), z.number().refine((v) => Number.isFinite(v) && v > 0)),
  ) ?? {};
}

async function authenticate(req: NextRequest): Promise<NextResponse | null> {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.STALLED_DIGEST_TOKEN;
  if (expected && auth === `Bearer ${expected}`) return null;
  // Admin session fallback for manual runs
  const { getInternalUser } = await import('@/lib/api-auth');
  const user = await getInternalUser();
  if (user?.role === 'admin') return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function renderDigestHtml(opts: {
  date: string;
  byPhase: Record<string, StalledRow[]>;
  bouncedCount: number;
  bouncedRows: Array<{ projectId: string; customerName: string; toEmails: string; reason: string | null }>;
  appUrl: string;
}): string {
  const phaseSections = Object.entries(opts.byPhase)
    .map(([phase, rows]) => `
      <h3 style="margin:20px 0 6px 0;font-size:13px;font-weight:600;color:#0f1322;text-transform:uppercase;letter-spacing:0.5px;">
        ${phase} — ${rows.length} stalled (threshold ${rows[0]?.threshold ?? '?'} days)
      </h3>
      <ul style="margin:0;padding:0 0 0 18px;list-style:disc;color:#0f1322;font-size:13px;line-height:1.5;">
        ${rows.map((r) => `
          <li>
            <a href="${opts.appUrl}/dashboard/projects/${r.id}" style="color:#0f1322;text-decoration:underline;">${r.customerName}</a>
            — ${r.daysInPhase} days · ${r.installerName}
          </li>
        `).join('')}
      </ul>
    `)
    .join('');

  const bouncedSection = opts.bouncedCount > 0 ? `
    <h3 style="margin:24px 0 6px 0;font-size:13px;font-weight:600;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">
      Bounced handoffs (${opts.bouncedCount})
    </h3>
    <ul style="margin:0;padding:0 0 0 18px;list-style:disc;color:#0f1322;font-size:13px;line-height:1.5;">
      ${opts.bouncedRows.map((r) => `
        <li>
          <a href="${opts.appUrl}/dashboard/projects/${r.projectId}" style="color:#0f1322;text-decoration:underline;">${r.customerName}</a>
          — ${r.toEmails} bounced${r.reason ? ` (${r.reason})` : ''}
        </li>
      `).join('')}
    </ul>
  ` : '';

  const totalStalled = Object.values(opts.byPhase).reduce((a, b) => a + b.length, 0);

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1322;background:#ffffff;margin:0;padding:0;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <h1 style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:#0f1322;">Stalled Projects Digest — ${opts.date}</h1>
    <p style="margin:0 0 16px 0;font-size:13px;color:#5b6477;">
      ${totalStalled} stalled project${totalStalled === 1 ? '' : 's'}${opts.bouncedCount > 0 ? `, ${opts.bouncedCount} bounced handoff${opts.bouncedCount === 1 ? '' : 's'}` : ''}.
    </p>
    ${phaseSections || '<p style="font-size:13px;color:#5b6477;">No stalled projects today. 🎉</p>'}
    ${bouncedSection}
    <hr style="border:none;border-top:1px solid #e5e7ee;margin:24px 0;" />
    <p style="margin:0;font-size:11px;color:#8a92a8;line-height:1.5;">
      Sent by Kilo Energy · Configure thresholds + recipients at /dashboard/settings → Customization
    </p>
  </div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const authErr = await authenticate(req);
  if (authErr) return authErr;

  const config = await dbAdmin.stalledAlertConfig.findUnique({ where: { id: 'singleton' } });
  if (!config || !config.enabled) {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }

  const recipients = parseRecipients(config.digestRecipients);
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_recipients' });
  }

  const customThresholds = parseThresholds(config.phaseThresholds);
  const cutoffDays = config.soldDateCutoffDays;
  const now = new Date();

  // Pull active projects (broad query — privacy gate is bypassed via dbAdmin
  // because cron has no user context). The filter logic below is the gate
  // for what enters the digest.
  const projects = await dbAdmin.project.findMany({
    where: {
      phase: { notIn: Array.from(TERMINAL_PHASES) },
    },
    select: {
      id: true,
      customerName: true,
      phase: true,
      soldDate: true,
      createdAt: true,
      phaseChangedAt: true,
      installer: { select: { name: true } },
    },
  });

  const stalled: StalledRow[] = [];
  for (const p of projects) {
    // Filter B: sold-date cutoff
    const soldRef = p.soldDate || p.createdAt.toISOString().slice(0, 10);
    const soldAge = daysBetween(soldRef, now);
    if (soldAge > cutoffDays) continue;

    const threshold = customThresholds[p.phase] ?? DEFAULT_THRESHOLDS[p.phase];
    if (!threshold) continue; // unknown phase — skip rather than alert noisily

    // Time-in-phase: phaseChangedAt → fallback createdAt
    const phaseEntry = p.phaseChangedAt ?? p.createdAt;
    const daysInPhase = daysBetween(phaseEntry, now);
    if (daysInPhase < threshold) continue;

    stalled.push({
      id: p.id,
      customerName: p.customerName,
      phase: p.phase,
      daysInPhase,
      threshold,
      installerName: p.installer.name,
    });
  }

  // Group by phase for the digest layout
  const byPhase: Record<string, StalledRow[]> = {};
  for (const row of stalled) {
    (byPhase[row.phase] ??= []).push(row);
  }
  for (const rows of Object.values(byPhase)) {
    rows.sort((a, b) => b.daysInPhase - a.daysInPhase);
  }

  // Recent bounced handoffs (last 24h) — separate signal in the same email
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const bounced = await dbAdmin.emailDelivery.findMany({
    where: { status: 'bounced', bouncedAt: { gte: since } },
    select: {
      providerMessageId: true,
      projectId: true,
      toEmails: true,
      errorReason: true,
      project: { select: { customerName: true } },
    },
    orderBy: { bouncedAt: 'desc' },
  });
  const bouncedRows = bounced.map((b) => {
    let toEmails = '(unknown)';
    try {
      const parsed = JSON.parse(b.toEmails) as unknown;
      if (Array.isArray(parsed)) toEmails = parsed.filter((x): x is string => typeof x === 'string').join(', ');
    } catch { /* ignore */ }
    return {
      projectId: b.projectId,
      customerName: b.project?.customerName ?? '(deleted project)',
      toEmails,
      reason: b.errorReason,
    };
  });

  const totalStalled = stalled.length;
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const subject = `Kilo Stalled Projects — ${dateStr} (${totalStalled} stalled${bouncedRows.length > 0 ? `, ${bouncedRows.length} bounced` : ''})`;

  const html = renderDigestHtml({
    date: dateStr,
    byPhase,
    bouncedCount: bouncedRows.length,
    bouncedRows,
    appUrl: process.env.APP_URL || 'https://app.kiloenergies.com',
  });

  // Skip the actual send if there's nothing meaningful AND no bounces — keeps
  // recipients' inboxes clean during quiet stretches.
  if (totalStalled === 0 && bouncedRows.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'nothing_to_report' });
  }

  try {
    const result = await sendEmail({
      to: recipients,
      subject,
      html,
      bccArchive: null, // skip BCC archive on digest emails (recipients already capture)
    });
    if (!result.ok) {
      logger.error('stalled_digest_send_failed', { code: result.code, error: result.error });
      return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 502 });
    }
    logger.info('stalled_digest_sent', {
      messageId: result.providerMessageId,
      stalled: totalStalled,
      bounced: bouncedRows.length,
      recipientCount: recipients.length,
    });
    return NextResponse.json({
      ok: true,
      providerMessageId: result.providerMessageId,
      stalled: totalStalled,
      bounced: bouncedRows.length,
    });
  } catch (err) {
    logger.error('stalled_digest_threw', errorContext(err));
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
