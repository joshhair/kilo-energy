import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { logChange } from '../../../../lib/audit';

/**
 * POST /api/import/users — Bulk user import endpoint.
 *
 * DRY-RUN BY DEFAULT. The request body must include `commit: true` to
 * actually write rows. Without `commit: true` the endpoint computes the
 * three-bucket preview and returns without touching the database.
 *
 * Body shape:
 *   {
 *     users: UserRow[],
 *     commit?: boolean
 *   }
 *
 * UserRow:
 *   firstName: string (required, non-empty)
 *   lastName:  string (required, non-empty)
 *   email:     string (required, lowercased + trimmed server-side)
 *   phone?:    string
 *   role:      "rep" | "sub-dealer" | "project_manager" | "admin"
 *   repType?:  "closer" | "setter" | "both"   (only meaningful when role=rep; defaults to "both")
 *   canRequestBlitz?, canCreateBlitz?:         booleans
 *   canExport?, canCreateDeals?, canAccessBlitz?: booleans (PM permission flags)
 *
 * Response:
 *   {
 *     dryRun: boolean,                         // true if this was a preview
 *     total: number,                           // input row count
 *     wouldCreate: Array<{ index, row }>,      // valid rows that would become new users
 *     wouldSkip:   Array<{ index, row, reason, existingUserId }>,  // email already taken
 *     wouldError:  Array<{ index, row, errors: string[] }>,        // validation failures
 *     created?:    Array<{ id, email, firstName, lastName, role }> // only present when commit=true and transaction succeeded
 *   }
 *
 * On commit=true, writes happen inside a single `prisma.$transaction` so
 * either every wouldCreate row lands or none do. wouldError rows still
 * block the commit — the endpoint refuses to write if ANY row has
 * validation errors. This forces the caller to clean up bad input before
 * committing, instead of silently dropping errors.
 *
 * The endpoint does NOT send Clerk invitations — it's for the bulk-silent-
 * create workflow. Use POST /api/users/[id]/invite per-user afterwards to
 * trigger invites on your own schedule.
 *
 * Admin only.
 */

type UserRow = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  repType?: unknown;
  canRequestBlitz?: unknown;
  canCreateBlitz?: unknown;
  canExport?: unknown;
  canCreateDeals?: unknown;
  canAccessBlitz?: unknown;
};

type NormalizedUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: 'rep' | 'sub-dealer' | 'project_manager' | 'admin';
  repType: 'closer' | 'setter' | 'both';
  canRequestBlitz: boolean;
  canCreateBlitz: boolean;
  canExport: boolean;
  canCreateDeals: boolean;
  canAccessBlitz: boolean;
};

const VALID_ROLES = new Set(['rep', 'sub-dealer', 'project_manager', 'admin']);
const VALID_REP_TYPES = new Set(['closer', 'setter', 'both']);
// Minimal email shape check — server-side only, not exhaustive.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return fallback;
}

function validateRow(row: UserRow): { errors: string[]; normalized: NormalizedUser | null } {
  const errors: string[] = [];

  const firstName = asString(row.firstName).trim();
  const lastName = asString(row.lastName).trim();
  const emailRaw = asString(row.email).trim().toLowerCase();
  const phone = asString(row.phone).trim();
  const role = asString(row.role).trim();
  const repType = asString(row.repType).trim() || 'both';

  if (!firstName) errors.push('firstName is required');
  if (!lastName) errors.push('lastName is required');
  if (!emailRaw) errors.push('email is required');
  else if (!EMAIL_RE.test(emailRaw)) errors.push(`email "${emailRaw}" is not a valid format`);
  if (!role) errors.push('role is required');
  else if (!VALID_ROLES.has(role)) errors.push(`role "${role}" must be one of: rep, sub-dealer, project_manager, admin`);
  if (!VALID_REP_TYPES.has(repType)) errors.push(`repType "${repType}" must be one of: closer, setter, both`);

  if (errors.length > 0) return { errors, normalized: null };

  return {
    errors: [],
    normalized: {
      firstName,
      lastName,
      email: emailRaw,
      phone,
      role: role as NormalizedUser['role'],
      repType: repType as NormalizedUser['repType'],
      canRequestBlitz: asBool(row.canRequestBlitz),
      canCreateBlitz: asBool(row.canCreateBlitz),
      canExport: asBool(row.canExport),
      canCreateDeals: asBool(row.canCreateDeals),
      canAccessBlitz: asBool(row.canAccessBlitz),
    },
  };
}

export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  let body: { users?: unknown; commit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.users)) {
    return NextResponse.json({ error: 'Body must include a `users` array' }, { status: 400 });
  }

  const input = body.users as UserRow[];
  const commit = body.commit === true;

  // ─── Validate every row, collect three buckets ────────────────────────
  const wouldCreate: Array<{ index: number; row: NormalizedUser }> = [];
  const wouldSkip: Array<{ index: number; row: NormalizedUser; reason: string; existingUserId: string }> = [];
  const wouldError: Array<{ index: number; row: UserRow; errors: string[] }> = [];

  // First pass: shape + field validation
  const normalizedOk: Array<{ index: number; row: NormalizedUser }> = [];
  for (let i = 0; i < input.length; i++) {
    const result = validateRow(input[i]);
    if (result.errors.length > 0 || !result.normalized) {
      wouldError.push({ index: i, row: input[i], errors: result.errors });
    } else {
      normalizedOk.push({ index: i, row: result.normalized });
    }
  }

  // Second pass: check for in-payload duplicate emails (same email twice in the
  // same request is a user error, not a DB collision)
  const seenEmails = new Map<string, number>();
  const dupIndices = new Set<number>();
  for (const { index, row } of normalizedOk) {
    const prior = seenEmails.get(row.email);
    if (prior !== undefined) {
      dupIndices.add(index);
      // Flag the later occurrence as an error (keep the first)
      wouldError.push({ index, row: input[index], errors: [`duplicate email "${row.email}" (first occurrence at index ${prior})`] });
    } else {
      seenEmails.set(row.email, index);
    }
  }
  const deduped = normalizedOk.filter(({ index }) => !dupIndices.has(index));

  // Third pass: check against existing DB rows
  const incomingEmails = deduped.map(({ row }) => row.email);
  const existing = incomingEmails.length > 0
    ? await prisma.user.findMany({
        where: { email: { in: incomingEmails } },
        select: { id: true, email: true },
      })
    : [];
  const existingByEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u.id]));

  for (const { index, row } of deduped) {
    const existingId = existingByEmail.get(row.email);
    if (existingId) {
      wouldSkip.push({ index, row, reason: 'email already exists in database', existingUserId: existingId });
    } else {
      wouldCreate.push({ index, row });
    }
  }

  const base = {
    dryRun: !commit,
    total: input.length,
    wouldCreate: wouldCreate.map(({ index, row }) => ({ index, row })),
    wouldSkip,
    wouldError,
  };

  // ─── Dry-run path: return the preview without writing ─────────────────
  if (!commit) {
    return NextResponse.json(base);
  }

  // ─── Commit path: refuse if there are any errors ──────────────────────
  if (wouldError.length > 0) {
    return NextResponse.json(
      {
        ...base,
        committed: false,
        error: `Refusing to commit: ${wouldError.length} row(s) failed validation. Fix errors and retry, or remove bad rows from the payload.`,
      },
      { status: 400 },
    );
  }

  // ─── Commit path: write everything atomically ─────────────────────────
  if (wouldCreate.length === 0) {
    return NextResponse.json({ ...base, committed: true, created: [] });
  }

  try {
    const created = await prisma.$transaction(
      wouldCreate.map(({ row }) =>
        prisma.user.create({
          data: {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.phone,
            role: row.role,
            repType: row.repType,
            canRequestBlitz: row.canRequestBlitz,
            canCreateBlitz: row.canCreateBlitz,
            canExport: row.canExport,
            canCreateDeals: row.canCreateDeals,
            canAccessBlitz: row.canAccessBlitz,
            active: true,
          },
          select: { id: true, email: true, firstName: true, lastName: true, role: true },
        }),
      ),
    );

    // Single batch-summary audit entry per import run (see import/projects
     // for the same rationale — per-row audit would drown the signal).
    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'user_bulk_import',
      entityType: 'User',
      entityId: created[0]?.id ?? 'no_created',
      detail: {
        total: input.length,
        createdCount: created.length,
        skippedCount: wouldSkip.length,
        errorCount: wouldError.length,
        firstCreatedId: created[0]?.id ?? null,
        lastCreatedId: created[created.length - 1]?.id ?? null,
      },
    });

    return NextResponse.json({
      ...base,
      committed: true,
      created,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown transaction error';
    return NextResponse.json(
      { ...base, committed: false, error: `Transaction failed: ${message}` },
      { status: 500 },
    );
  }
}
