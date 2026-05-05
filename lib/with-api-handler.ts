/**
 * Route-handler wrapper that binds the AsyncLocalStorage request context.
 *
 * Every API route that touches sensitive data should be wrapped with
 * `withApiHandler` so the gated Prisma client (`db` from lib/db-gated.ts)
 * has access to the current user. The wrapper:
 *
 *   1. Resolves the authenticated internal user (401 if missing).
 *   2. Pre-loads `chainTraineeIds` once per request (so the gate doesn't
 *      re-query for every project read).
 *   3. Optionally honors `?viewAs=<userId>` for admin impersonation.
 *   4. Runs the handler inside `withRequestContext`.
 *
 * Usage:
 *
 *   export const GET = withApiHandler(async (req, { user }) => {
 *     const projects = await db.project.findMany(); // gated automatically
 *     return NextResponse.json(projects);
 *   });
 *
 * Migration plan (Phase 2+): existing routes built around bare
 * `requireInternalUser()` calls keep working because they import `prisma`
 * directly (unfiltered). Migrate them one at a time to use this wrapper
 * + the gated `db` client. Each migrated route must include a privacy
 * test in `tests/privacy/` (Phase 4 CI rule will enforce this).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  type InternalUser,
  getInternalUser,
  loadChainTrainees,
} from './api-auth';
import { withRequestContext, type RequestContext } from './request-context';
import { prisma } from './db';

export interface ApiHandlerContext {
  user: InternalUser;
  /**
   * The effective user for data-visibility decisions — view-as target
   * if admin is impersonating, else the same as `user`. Use `user` for
   * audit logs (you want the real actor); use `effectiveUser` for any
   * scope-resolution path that doesn't already go through the gate.
   */
  effectiveUser: Pick<InternalUser, 'id' | 'role' | 'scopedInstallerId' | 'email'>;
}

type Handler<TParams = unknown> = (
  req: NextRequest,
  ctx: ApiHandlerContext & { params?: Promise<TParams> },
) => Promise<NextResponse>;

export function withApiHandler<TParams = unknown>(
  handler: Handler<TParams>,
): (req: NextRequest, routeCtx?: { params?: Promise<TParams> }) => Promise<NextResponse> {
  return async (req: NextRequest, routeCtx?: { params?: Promise<TParams> }) => {
    const user = await getInternalUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Pre-load trainer chain so the privacy gate doesn't re-query per row.
    const chainTrainees = user.role === 'rep'
      ? await loadChainTrainees(user.id)
      : new Set<string>();

    // View-As: admin can pass ?viewAs=<userId> on read endpoints to
    // inspect data as that user. The auth check ran as the admin so
    // unauthorized callers can't smuggle this — non-admins setting
    // viewAs is silently ignored.
    let viewAsUser: RequestContext['viewAsUser'];
    if (user.role === 'admin') {
      const viewAsId = req.nextUrl.searchParams.get('viewAs');
      if (viewAsId) {
        const target = await prisma.user.findUnique({
          where: { id: viewAsId },
          select: { id: true, role: true, scopedInstallerId: true },
        });
        if (target) {
          viewAsUser = {
            id: target.id,
            role: target.role,
            scopedInstallerId: target.scopedInstallerId,
          };
        }
      }
    }

    const ctx: RequestContext = {
      user,
      chainTraineeIds: Array.from(chainTrainees),
      viewAsUser,
    };

    return withRequestContext(ctx, () =>
      handler(req, {
        user,
        effectiveUser: viewAsUser
          ? { ...viewAsUser, email: '' }
          : user,
        params: routeCtx?.params,
      }),
    );
  };
}
