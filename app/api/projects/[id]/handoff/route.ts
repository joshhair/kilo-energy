import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { sendInstallerHandoff } from '@/lib/handoff-service';

// POST /api/projects/[id]/handoff — Manually send the installer handoff email.
//
// Wraps lib/handoff-service.sendInstallerHandoff with auth + replay-guard.
//
// Auth: admin + internal PM only (vendor PM cannot trigger sends).
// Test mode: ?test=true sends to the calling user's email.
// Resend bypass: body { confirm: 'resend' } skips the "already sent" guard.

interface RequestBody {
  confirm?: 'resend';
}

const RESEND_GUARD_MS = 60_000;

export const POST = withApiHandler<{ id: string }>(async (req, { params, user }) => {
  const { id } = await params!;

  if (user.role !== 'admin' && !(user.role === 'project_manager' && !user.scopedInstallerId)) {
    return NextResponse.json({ error: 'Forbidden — only admins / internal PMs can trigger handoff sends' }, { status: 403 });
  }

  const isTestMode = req.nextUrl.searchParams.get('test') === 'true';

  // Replay guard for real (non-test) sends.
  if (!isTestMode) {
    const project = await db.project.findUnique({
      where: { id },
      select: { handoffSentAt: true },
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    let body: RequestBody = {};
    try { body = (await req.json()) as RequestBody; } catch { /* empty body OK */ }

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

  const result = await sendInstallerHandoff({
    projectId: id,
    mode: isTestMode ? 'test' : 'manual',
    actor: { id: user.id, email: user.email },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    deliveryId: result.deliveryId,
    providerMessageId: result.providerMessageId,
    isTest: result.isTest,
    to: result.to,
    cc: result.cc,
  });
});
