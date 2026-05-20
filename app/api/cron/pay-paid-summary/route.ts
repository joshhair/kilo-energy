/**
 * POST /api/cron/pay-paid-summary — end-of-day admin-only digest of every
 * payroll entry marked Paid in the last 24 hours.
 *
 * Why: the existing payroll fanout sends one summary email per rep per
 * publish batch. Admins receive each rep's email via blind-cc-style
 * notification copy, which means a 30-rep payroll publish = 30 emails for
 * admins. This digest collapses that into ONE email per day with rep
 * totals + per-rep breakdowns.
 *
 * Audience: admins only. Skips ad-hoc runs if no Paid entries today
 * (no "you have 0 things to review" email).
 *
 * Auth: Bearer token (PAY_PAID_SUMMARY_TOKEN) from GitHub Actions OR
 * admin session for manual runs.
 *
 * Schedule: nightly via .github/workflows/pay-paid-summary.yml at 6pm
 * Pacific (01:00 UTC the following day) so the window covers business hours.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/db';
import { logger, errorContext } from '@/lib/logger';
import { notify } from '@/lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '@/lib/email-templates/notification';

async function authenticate(req: NextRequest): Promise<NextResponse | null> {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.PAY_PAID_SUMMARY_TOKEN;
  if (expected && auth === `Bearer ${expected}`) return null;
  const { getInternalUser } = await import('@/lib/api-auth');
  const user = await getInternalUser();
  if (user?.role === 'admin') return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function POST(req: NextRequest) {
  const authErr = await authenticate(req);
  if (authErr) return authErr;

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    // Every payroll entry where paidAt fell in the last 24h.
    const entries = await dbAdmin.payrollEntry.findMany({
      where: {
        status: 'Paid',
        paidAt: { gte: since, lte: now },
      },
      select: {
        id: true,
        amountCents: true,
        paymentStage: true,
        repId: true,
        rep: { select: { firstName: true, lastName: true } },
        project: { select: { customerName: true } },
      },
    });

    if (entries.length === 0) {
      logger.info('pay_paid_summary_no_entries', { since: since.toISOString(), now: now.toISOString() });
      return NextResponse.json({ ok: true, sent: 0, reason: 'no entries' });
    }

    // Group by rep.
    type RepRow = {
      repId: string;
      repName: string;
      count: number;
      totalCents: number;
      stageCounts: Record<string, number>;
    };
    const byRep = new Map<string, RepRow>();
    let totalCents = 0;
    for (const e of entries) {
      totalCents += e.amountCents;
      const repName = `${e.rep?.firstName ?? ''} ${e.rep?.lastName ?? ''}`.trim() || 'Unknown';
      const row = byRep.get(e.repId) ?? { repId: e.repId, repName, count: 0, totalCents: 0, stageCounts: {} };
      row.count++;
      row.totalCents += e.amountCents;
      row.stageCounts[e.paymentStage] = (row.stageCounts[e.paymentStage] ?? 0) + 1;
      byRep.set(e.repId, row);
    }

    // Sort by total desc.
    const repRows = [...byRep.values()].sort((a, b) => b.totalCents - a.totalCents);

    // Send to every admin.
    const admins = (await dbAdmin.user.findMany({
      where: { role: 'admin', active: true },
      select: { id: true, firstName: true, email: true },
    })).filter((a) => !!a.email);
    if (admins.length === 0) {
      logger.warn('pay_paid_summary_no_admins');
      return NextResponse.json({ ok: true, sent: 0, reason: 'no admin recipients' });
    }

    const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';
    const itemListHtml = repRows.slice(0, 20).map((r) => {
      const stagesNote = Object.entries(r.stageCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([s, n]) => `${n}×${escapeHtml(s)}`)
        .join(', ');
      return `<li style="margin-bottom:6px;">
        <strong>${escapeHtml(r.repName)}</strong> · ${r.count} ${r.count === 1 ? 'entry' : 'entries'} · <strong>${fmt$(r.totalCents / 100)}</strong>
        <br><span style="color:#5b6477;font-size:11px;">${stagesNote}</span>
      </li>`;
    }).join('');
    const overflow = repRows.length > 20 ? `<p style="margin:8px 0 0 0;color:#5b6477;font-size:12px;">+ ${repRows.length - 20} more reps</p>` : '';

    const periodLabel = new Date(now.getTime() - 12 * 60 * 60 * 1000)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const subject = `Payroll paid summary — ${periodLabel} · ${fmt$(totalCents / 100)} across ${repRows.length} reps`;

    const sendCount = await Promise.all(admins.map((admin) =>
      notify({
        type: 'pay_paid_summary',
        userId: admin.id,
        subject,
        emailHtml: renderNotificationEmail({
          heading: `Payroll paid summary — ${periodLabel}`,
          bodyHtml: `
            <p style="margin:0 0 12px 0;">
              Hi ${escapeHtml(admin.firstName ?? 'there')}, here's everything that hit Paid in the last 24 hours.
            </p>
            <p style="margin:0 0 16px 0;font-size:15px;">
              <strong>${fmt$(totalCents / 100)}</strong> across <strong>${entries.length}</strong> ${entries.length === 1 ? 'entry' : 'entries'} for <strong>${repRows.length}</strong> ${repRows.length === 1 ? 'rep' : 'reps'}.
            </p>
            <ul style="margin:0;padding:0 0 0 18px;list-style:disc;font-size:13px;line-height:1.55;">${itemListHtml}</ul>
            ${overflow}
          `,
          cta: { label: 'Open Payroll', url: `${appUrl}/dashboard/payroll` },
          footerNote: `Sent because you're an admin with the daily paid-out summary on. Manage at ${appUrl}/dashboard/preferences.`,
        }),
        smsBody: undefined,
        pushBody: `Payroll paid summary — ${fmt$(totalCents / 100)} across ${repRows.length} reps`,
      })
    )).then((results) => results.filter(Boolean).length);

    logger.info('pay_paid_summary_sent', {
      adminsTargeted: admins.length,
      sendCount,
      entriesCovered: entries.length,
      repsCovered: repRows.length,
      totalCents,
    });

    return NextResponse.json({
      ok: true,
      sent: sendCount,
      entries: entries.length,
      reps: repRows.length,
      totalCents,
    });
  } catch (err) {
    logger.error('pay_paid_summary_failed', errorContext(err));
    return NextResponse.json({ error: 'Summary send failed' }, { status: 500 });
  }
}
