import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { logger } from '../../../../lib/logger';

/**
 * POST /api/admin/retention — rotate AuditLog entries older than 2 years.
 *
 * Policy per /legal/privacy: "rotate entries older than 2 years to cold
 * storage or drop". Pre-launch we drop. When we wire a cold-storage
 * backend (S3, Vercel Blob), this is the hook to push-before-delete.
 *
 * Callable two ways:
 *   1. Admin UI (future): admin-authenticated POST from a Settings screen.
 *   2. Vercel Cron: scheduled POST with the shared RETENTION_SECRET in
 *      the Authorization: Bearer header.
 *
 * Safe to re-run (nothing happens if no rows are past the cutoff).
 */

const RETENTION_DAYS = 2 * 365;

export async function POST(req: NextRequest) {
  // Prefer the cron-secret path when configured — lets us schedule this
  // without baking in a service account.
  const authHeader = req.headers.get('authorization') ?? '';
  const expectedSecret = process.env.RETENTION_SECRET;
  const presentedSecret = authHeader.replace(/^Bearer\s+/i, '').trim();

  let authorized = false;
  if (expectedSecret && presentedSecret && expectedSecret === presentedSecret) {
    authorized = true;
  } else {
    // Fall back to admin session auth (for manual triggers from an admin UI).
    const { requireAdmin } = await import('../../../../lib/api-auth');
    try { await requireAdmin(); authorized = true; } catch { /* unauthorized */ }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  logger.info('audit_retention_run', {
    cutoff: cutoff.toISOString(),
    deleted: result.count,
  });

  return NextResponse.json({
    success: true,
    cutoff: cutoff.toISOString(),
    deleted: result.count,
    retentionDays: RETENTION_DAYS,
  });
}
