import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/db';
import { logger, errorContext } from '@/lib/logger';
import { notify } from '@/lib/notifications/service';

// POST /api/cron/blitz-reminders — Phase 3b scheduled countdown reminders.
//
// Runs daily and fires reminders to all approved participants on blitzes
// whose startDate is exactly 7 / 3 / 1 / 0 days away. Each kind is a
// separate notify() call so per-kind opt-outs and per-channel routing
// (email / sms / push) flow through the standard preference engine.
//
// Idempotency: the date filter only matches one calendar day per kind,
// so a single run/day naturally fires each (blitz, kind) once. If a
// Vercel re-run happens within the same UTC day, NotificationDelivery
// rows will dup — acceptable for now (better to over-remind than miss).
// A dedicated `BlitzNotificationSent` table can be added later if dup
// rates become noisy.
//
// Cron context: no user — uses dbAdmin to bypass the privacy gate.

const KINDS: Array<{ daysOut: number; key: '7d' | '3d' | '1d' | '0d'; label: string }> = [
  { daysOut: 7, key: '7d', label: '1 week out' },
  { daysOut: 3, key: '3d', label: '3 days out' },
  { daysOut: 1, key: '1d', label: 'tomorrow' },
  { daysOut: 0, key: '0d', label: 'today' },
];

async function authenticate(req: NextRequest): Promise<NextResponse | null> {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.BLITZ_REMINDERS_TOKEN || process.env.CRON_SECRET;
  if (expected && auth === `Bearer ${expected}`) return null;
  // Admin session fallback for manual triggers.
  const { getInternalUser } = await import('@/lib/api-auth');
  const user = await getInternalUser();
  if (user?.role === 'admin') return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function addDaysISO(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function renderReminderHtml(opts: {
  blitzName: string;
  location: string;
  housing: string;
  startDate: string;
  endDate: string;
  daysOut: number;
  appUrl: string;
  blitzId: string;
  firstName: string;
  hasGoal: boolean;
  targetDeals: number | null;
}): string {
  const countdown =
    opts.daysOut === 0 ? 'Starts today.'
    : opts.daysOut === 1 ? 'Starts tomorrow.'
    : `Starts in ${opts.daysOut} days.`;
  const goalLine = opts.hasGoal && opts.targetDeals != null
    ? `<p style="margin:8px 0 0 0;font-size:13px;color:#0f1322;">Your personal goal: <strong>${opts.targetDeals} deal${opts.targetDeals === 1 ? '' : 's'}</strong>.</p>`
    : `<p style="margin:8px 0 0 0;font-size:13px;color:#5b6477;">Tip: set your personal goal on the blitz page so the leaderboard tracks your progress.</p>`;
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1322;background:#ffffff;margin:0;padding:0;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;color:#0aa57b;text-transform:uppercase;letter-spacing:0.6px;">Blitz reminder · ${opts.daysOut === 0 ? 'today' : opts.daysOut === 1 ? 'tomorrow' : `${opts.daysOut} days out`}</p>
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0f1322;">${opts.blitzName}</h1>
    <p style="margin:0 0 4px 0;font-size:14px;color:#0f1322;">Hi ${opts.firstName || 'there'} — ${countdown}</p>
    <table style="border-collapse:collapse;margin:14px 0;font-size:13px;color:#0f1322;">
      <tr><td style="padding:2px 12px 2px 0;color:#5b6477;">When</td><td style="padding:2px 0;">${opts.startDate} – ${opts.endDate}</td></tr>
      ${opts.location ? `<tr><td style="padding:2px 12px 2px 0;color:#5b6477;">Where</td><td style="padding:2px 0;">${opts.location}</td></tr>` : ''}
      ${opts.housing ? `<tr><td style="padding:2px 12px 2px 0;color:#5b6477;">Housing</td><td style="padding:2px 0;">${opts.housing}</td></tr>` : ''}
    </table>
    ${goalLine}
    <p style="margin:18px 0 0 0;">
      <a href="${opts.appUrl}/dashboard/blitz/${opts.blitzId}" style="display:inline-block;background:#0aa57b;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 16px;border-radius:8px;">Open blitz</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7ee;margin:24px 0;" />
    <p style="margin:0;font-size:11px;color:#8a92a8;line-height:1.5;">
      Sent by Kilo Energy. Manage these notifications at /dashboard/settings → Notifications.
    </p>
  </div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const authErr = await authenticate(req);
  if (authErr) return authErr;

  const now = new Date();
  const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';

  const summary: Array<{ kind: string; blitzes: number; recipientsOk: number; recipientsFailed: number }> = [];

  for (const k of KINDS) {
    const targetDate = addDaysISO(now, k.daysOut);
    const blitzes = await dbAdmin.blitz.findMany({
      where: {
        startDate: targetDate,
        status: { in: ['upcoming', 'active'] },
      },
      include: {
        participants: {
          where: { joinStatus: 'approved' },
          include: { user: true },
        },
      },
    });

    let totalOk = 0;
    let totalFailed = 0;

    for (const b of blitzes) {
      for (const part of b.participants) {
        if (!part.user?.email) continue;
        const subject = `Kilo Blitz — ${b.name} ${k.daysOut === 0 ? 'starts today' : k.daysOut === 1 ? 'starts tomorrow' : `${k.daysOut} days out`}`;
        const html = renderReminderHtml({
          blitzName: b.name,
          location: b.location,
          housing: b.housing,
          startDate: b.startDate,
          endDate: b.endDate,
          daysOut: k.daysOut,
          appUrl,
          blitzId: b.id,
          firstName: part.user.firstName ?? '',
          hasGoal: typeof part.targetDeals === 'number' && part.targetDeals > 0,
          targetDeals: typeof part.targetDeals === 'number' ? part.targetDeals : null,
        });
        try {
          const res = await notify({
            type: 'blitz_reminder',
            userId: part.user.id,
            subject,
            emailHtml: html,
          });
          if (res.ok && !res.skipped) totalOk += 1;
          else totalFailed += res.ok ? 0 : 1;
        } catch (err) {
          totalFailed += 1;
          logger.error('blitz_reminder_notify_threw', { ...errorContext(err), blitzId: b.id, userId: part.user.id });
        }
      }
    }

    summary.push({ kind: k.key, blitzes: blitzes.length, recipientsOk: totalOk, recipientsFailed: totalFailed });
  }

  logger.info('blitz_reminders_sent', { summary });
  return NextResponse.json({ ok: true, summary });
}
