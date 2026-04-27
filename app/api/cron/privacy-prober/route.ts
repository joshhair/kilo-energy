/**
 * Privacy synthetic prober.
 *
 * Runs as a Vercel cron and validates that the privacy gate is doing
 * its job in production. We compute the visibility WHERE for a few
 * known fixture roles (e.g. an unscoped vendor PM that owns no real
 * projects) and assert the WHERE doesn't accidentally collapse to
 * "empty = full access". If it ever does, the prober fires an alert.
 *
 * This is a best-effort detection layer — the structural enforcement
 * (lib/db-gated.ts + lint rule) is what prevents leaks. The prober
 * catches a leak that snuck past structural checks (e.g. a manual
 * route that bypasses the gate, a DB-side misconfiguration, a typo'd
 * role that accidentally returns empty WHERE).
 *
 * Auth: cron secret OR admin session. Same pattern as
 * app/api/admin/retention.
 *
 * Schedule: every 15 minutes via vercel.json. Frequent enough to
 * catch a regression in the same deploy that introduced it; cheap
 * enough not to matter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withRequestContext } from '../../../../lib/request-context';
import { projectVisibilityWhere, payrollEntryVisibilityWhere } from '../../../../lib/db-gated';
import type { InternalUser } from '../../../../lib/api-auth';
import { logger } from '../../../../lib/logger';

interface ProbeResult {
  fixture: string;
  model: string;
  ok: boolean;
  whereJson: string;
  reason?: string;
}

function assertWhereDeniesAll(
  fixture: string,
  model: string,
  where: Record<string, unknown>,
): ProbeResult {
  const whereJson = JSON.stringify(where);
  // The visibility WHERE for these fixtures must contain a deny token.
  // Empty WHERE = full access = leak. Anything that doesn't include a
  // __deny_* sentinel is a violation of the policy.
  const ok = whereJson.includes('__deny_');
  return {
    fixture,
    model,
    ok,
    whereJson,
    reason: ok ? undefined : 'Visibility WHERE did not contain a __deny_ sentinel — policy regression',
  };
}

export async function GET(req: NextRequest) {
  // Cron secret OR admin session. Vercel sends a Bearer header for
  // scheduled runs; admins can also hit this manually for diagnostics.
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET;
  const isCron = !!expected && auth === `Bearer ${expected}`;
  if (!isCron) {
    // Allow admin session (for manual probing) — call the same auth helper.
    const { getInternalUser } = await import('../../../../lib/api-auth');
    const user = await getInternalUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const fixtures: { name: string; user: InternalUser }[] = [
    {
      name: 'misconfigured_pm_no_scope_no_allowlist',
      user: {
        id: 'prober_misconfigured_pm',
        firstName: 'Prober',
        lastName: 'MisconfiguredPM',
        email: 'prober-misconfigured-pm@kilo-energy.test',
        role: 'project_manager',
        repType: null,
        clerkUserId: null,
        scopedInstallerId: null,
      },
    },
    {
      name: 'vendor_pm_scoped_to_fake_installer',
      user: {
        id: 'prober_vendor_pm',
        firstName: 'Prober',
        lastName: 'VendorPM',
        email: 'prober-vendor-pm@kilo-energy.test',
        role: 'project_manager',
        repType: null,
        clerkUserId: null,
        scopedInstallerId: 'inst_prober_fake',
      },
    },
    {
      name: 'unknown_role',
      user: {
        id: 'prober_unknown',
        firstName: 'Prober',
        lastName: 'UnknownRole',
        email: 'prober-unknown@kilo-energy.test',
        role: 'fictitious_role',
        repType: null,
        clerkUserId: null,
        scopedInstallerId: null,
      },
    },
  ];

  const results: ProbeResult[] = [];
  for (const f of fixtures) {
    // misconfigured + unknown + vendor PM all should NOT have empty WHERE
    // for any sensitive model. Vendor PM scoped to a fake installer DOES
    // have a non-empty WHERE (installerId match), but won't match real
    // projects since the installer is fake — we accept that as deny too
    // by checking the WHERE shape, not just for sentinel.
    const projectWhere = withRequestContext(
      { user: f.user, chainTraineeIds: [] },
      () => projectVisibilityWhere(),
    );
    const payrollWhere = withRequestContext(
      { user: f.user, chainTraineeIds: [] },
      () => payrollEntryVisibilityWhere(),
    );

    if (f.name === 'vendor_pm_scoped_to_fake_installer') {
      // Special case: vendor PM with a real-looking scope returns an
      // installerId where, not a deny sentinel. Validate the where
      // matches the fake-installer policy instead.
      const projectOk = JSON.stringify(projectWhere).includes('inst_prober_fake');
      const payrollOk = JSON.stringify(payrollWhere).includes('__deny_');
      results.push({
        fixture: f.name,
        model: 'Project',
        ok: projectOk,
        whereJson: JSON.stringify(projectWhere),
        reason: projectOk ? undefined : 'Vendor PM scope did not produce installerId-bound WHERE',
      });
      results.push({
        fixture: f.name,
        model: 'PayrollEntry',
        ok: payrollOk,
        whereJson: JSON.stringify(payrollWhere),
        reason: payrollOk ? undefined : 'Vendor PM payroll WHERE did not contain a __deny_ sentinel',
      });
    } else {
      results.push(assertWhereDeniesAll(f.name, 'Project', projectWhere));
      results.push(assertWhereDeniesAll(f.name, 'PayrollEntry', payrollWhere));
    }
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    logger.error('privacy_prober_failed', {
      failureCount: failures.length,
      failures,
    });
    return NextResponse.json(
      { ok: false, failures, results },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, probedFixtures: fixtures.length, results });
}
