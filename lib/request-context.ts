/**
 * Request-scoped user context, threaded through the entire call tree via
 * Node's AsyncLocalStorage.
 *
 * Every API route handler that touches sensitive data should run inside
 * `withRequestContext(ctx, () => handler(...))`. Once it's set, any code
 * downstream — service functions, the privacy-gated Prisma client, the
 * audit logger — can pull the current user via `getRequestContext()`
 * without prop-drilling.
 *
 * This is the foundation that the Prisma extension in `lib/db-gated.ts`
 * relies on to inject WHERE clauses correctly. If the extension fires
 * without a context (i.e. someone called the gated client outside
 * withRequestContext), it throws — that's by design. Either wrap the
 * handler, or use `dbAdmin` from `lib/db.ts` for explicit admin paths.
 *
 * Background: the Joe-Dale-BVI privacy leak (2026-04-26) was fixed at
 * the route layer in /api/data, but the same shape can recur in any
 * future endpoint that forgets to scope. The structural fix is to make
 * the data-access layer require a user context — a leak becomes a
 * runtime error in dev, not a silent broadcast in production.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { InternalUser } from './api-auth';

export interface RequestContext {
  /** The authenticated internal user driving this request. */
  user: InternalUser;
  /**
   * Closer IDs this user trains via an active rep-chain TrainerAssignment.
   * Preloaded once per request so the privacy gate doesn't re-query on
   * every project read. Empty for non-reps.
   */
  chainTraineeIds: readonly string[];
  /**
   * Optional admin View-As impersonation. When set, scoping decisions
   * use this user's identity even though auth ran as the admin. Only
   * the admin role may set this; other callers' values are ignored.
   */
  viewAsUser?: { id: string; role: string; scopedInstallerId: string | null };
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with the given context bound for any nested calls. The context
 * is automatically inherited across awaits / Promise chains within the
 * same async stack. Tests can call this directly with a fixture user.
 */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Returns the current context, or undefined if no context is bound. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Returns the current user. Throws if no context is bound — this is the
 * load-bearing assertion that catches "forgot to wrap the handler" bugs
 * at runtime instead of letting unscoped queries silently return all
 * rows.
 */
export function requireRequestUser(): InternalUser {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No request context bound. Wrap your handler with withRequestContext() or use dbAdmin from lib/db.ts for explicit admin paths.',
    );
  }
  return ctx.user;
}

/**
 * Returns the *effective* user — view-as target if set, else the
 * authenticated user. Use this for data-visibility decisions; use
 * requireRequestUser() for auth/audit (you want the real actor in logs).
 */
export function requireEffectiveUser(): Pick<InternalUser, 'id' | 'role' | 'scopedInstallerId' | 'email'> {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('No request context bound.');
  }
  if (ctx.viewAsUser) {
    return {
      id: ctx.viewAsUser.id,
      role: ctx.viewAsUser.role,
      scopedInstallerId: ctx.viewAsUser.scopedInstallerId,
      email: '', // view-as target email isn't loaded — gate logic doesn't need it
    };
  }
  return ctx.user;
}

/** Convenience for tests / scripts: bind a context and run a thunk. */
export async function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}
