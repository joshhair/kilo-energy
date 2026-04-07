import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

/**
 * POST /api/import/projects — Bulk project import endpoint.
 *
 * DRY-RUN BY DEFAULT. The request body must include `commit: true` to
 * actually write rows.
 *
 * Body shape:
 *   {
 *     projects: ProjectRow[],
 *     commit?: boolean
 *   }
 *
 * ProjectRow uses HUMAN-READABLE identifiers instead of internal IDs so
 * the Glide transform script doesn't need to know about Kilo's cuid()s.
 * The endpoint resolves every FK by email (users) or name (installer,
 * financer) and surfaces specific errors if any lookup fails:
 *
 *   customerName:     string (required)
 *   closerEmail:      string (required) → User.id where role in (rep, sub-dealer) and email matches
 *   setterEmail?:     string | null → same lookup, setter must be a user too
 *   subDealerEmail?:  string | null → user with role='sub-dealer'
 *   installerName:    string (required) → Installer.id (case-insensitive exact match)
 *   financerName:     string (required) → Financer.id
 *   soldDate:         string (YYYY-MM-DD)
 *   productType:      "PPA" | "Lease" | "Loan" | "Cash"
 *   kWSize:           number > 0
 *   netPPW:           number >= 0
 *   phase:            one of the 10 enum phases
 *   m1Amount?, m2Amount?, m3Amount?, setterM2Amount?, setterM3Amount?: numbers
 *   m1Paid?, m2Paid?, m3Paid?: booleans
 *   notes?:           string
 *   flagged?:         boolean
 *   leadSource?:      "organic" | "referral" | "blitz" | "door_knock" | "web" | "other"
 *
 * Response shape mirrors /api/import/users: three buckets + optional
 * `created` array when commit=true succeeds. Atomic $transaction on
 * commit — either every wouldCreate row lands or none do.
 *
 * De-duplication is by customerName + soldDate + closerEmail (rough but
 * effective for Glide imports, which don't have stable cross-app IDs).
 * Collisions land in wouldSkip with the existing project id for reference.
 *
 * Admin only.
 */

type ProjectRow = {
  customerName?: unknown;
  closerEmail?: unknown;
  setterEmail?: unknown;
  subDealerEmail?: unknown;
  installerName?: unknown;
  financerName?: unknown;
  soldDate?: unknown;
  productType?: unknown;
  kWSize?: unknown;
  netPPW?: unknown;
  phase?: unknown;
  m1Amount?: unknown;
  m2Amount?: unknown;
  m3Amount?: unknown;
  setterM2Amount?: unknown;
  setterM3Amount?: unknown;
  m1Paid?: unknown;
  m2Paid?: unknown;
  m3Paid?: unknown;
  notes?: unknown;
  flagged?: unknown;
  leadSource?: unknown;
};

type NormalizedProject = {
  customerName: string;
  closerEmail: string;
  setterEmail: string | null;
  subDealerEmail: string | null;
  installerName: string;
  financerName: string;
  soldDate: string;
  productType: string;
  kWSize: number;
  netPPW: number;
  phase: string;
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
  setterM2Amount: number;
  setterM3Amount: number | null;
  m1Paid: boolean;
  m2Paid: boolean;
  m3Paid: boolean;
  notes: string;
  flagged: boolean;
  leadSource: string | null;
};

type ResolvedProject = NormalizedProject & {
  closerId: string;
  setterId: string | null;
  subDealerId: string | null;
  installerId: string;
  financerId: string;
};

const VALID_PHASES = new Set([
  'New', 'Acceptance', 'Site Survey', 'Design', 'Permitting',
  'Pending Install', 'Installed', 'PTO', 'Completed', 'Cancelled', 'On Hold',
]);
const VALID_PRODUCT_TYPES = new Set(['PPA', 'Lease', 'Loan', 'Cash']);
const VALID_LEAD_SOURCES = new Set(['organic', 'referral', 'blitz', 'door_knock', 'web', 'other']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'string' ? v : null;
}
function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = asNumber(v, NaN);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return fallback;
}

function validateRow(row: ProjectRow): { errors: string[]; normalized: NormalizedProject | null } {
  const errors: string[] = [];

  const customerName = asString(row.customerName).trim();
  const closerEmail = asString(row.closerEmail).trim().toLowerCase();
  const setterEmail = asStringOrNull(row.setterEmail)?.trim().toLowerCase() ?? null;
  const subDealerEmail = asStringOrNull(row.subDealerEmail)?.trim().toLowerCase() ?? null;
  const installerName = asString(row.installerName).trim();
  const financerName = asString(row.financerName).trim();
  const soldDate = asString(row.soldDate).trim();
  const productType = asString(row.productType).trim();
  const phase = asString(row.phase).trim();
  const kWSize = asNumber(row.kWSize, NaN);
  const netPPW = asNumber(row.netPPW, NaN);
  const leadSource = asStringOrNull(row.leadSource);

  if (!customerName) errors.push('customerName is required');
  if (!closerEmail) errors.push('closerEmail is required');
  if (!installerName) errors.push('installerName is required');
  if (!financerName) errors.push('financerName is required');
  if (!soldDate) errors.push('soldDate is required');
  else if (!DATE_RE.test(soldDate)) errors.push(`soldDate "${soldDate}" must be YYYY-MM-DD`);
  if (!productType) errors.push('productType is required');
  else if (!VALID_PRODUCT_TYPES.has(productType)) errors.push(`productType "${productType}" must be one of: PPA, Lease, Loan, Cash`);
  if (!phase) errors.push('phase is required');
  else if (!VALID_PHASES.has(phase)) errors.push(`phase "${phase}" must be one of the 10 pipeline phases (e.g. New, Installed, PTO, Completed, Cancelled, On Hold)`);
  if (!Number.isFinite(kWSize) || kWSize <= 0) errors.push(`kWSize must be a positive number (got "${row.kWSize}")`);
  if (!Number.isFinite(netPPW) || netPPW < 0) errors.push(`netPPW must be a non-negative number (got "${row.netPPW}")`);
  if (leadSource && !VALID_LEAD_SOURCES.has(leadSource)) {
    errors.push(`leadSource "${leadSource}" must be one of: organic, referral, blitz, door_knock, web, other`);
  }

  if (errors.length > 0) return { errors, normalized: null };

  return {
    errors: [],
    normalized: {
      customerName,
      closerEmail,
      setterEmail,
      subDealerEmail,
      installerName,
      financerName,
      soldDate,
      productType,
      kWSize,
      netPPW,
      phase,
      m1Amount: asNumber(row.m1Amount, 0),
      m2Amount: asNumber(row.m2Amount, 0),
      m3Amount: asNumberOrNull(row.m3Amount),
      setterM2Amount: asNumber(row.setterM2Amount, 0),
      setterM3Amount: asNumberOrNull(row.setterM3Amount),
      m1Paid: asBool(row.m1Paid),
      m2Paid: asBool(row.m2Paid),
      m3Paid: asBool(row.m3Paid),
      notes: asString(row.notes),
      flagged: asBool(row.flagged),
      leadSource,
    },
  };
}

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  let body: { projects?: unknown; commit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.projects)) {
    return NextResponse.json({ error: 'Body must include a `projects` array' }, { status: 400 });
  }

  const input = body.projects as ProjectRow[];
  const commit = body.commit === true;

  // ─── Pass 1: shape / field validation ────────────────────────────────
  const wouldCreate: Array<{ index: number; row: ResolvedProject }> = [];
  const wouldSkip: Array<{ index: number; row: NormalizedProject; reason: string; existingProjectId: string }> = [];
  const wouldError: Array<{ index: number; row: ProjectRow; errors: string[] }> = [];

  const normalizedOk: Array<{ index: number; row: NormalizedProject }> = [];
  for (let i = 0; i < input.length; i++) {
    const result = validateRow(input[i]);
    if (result.errors.length > 0 || !result.normalized) {
      wouldError.push({ index: i, row: input[i], errors: result.errors });
    } else {
      normalizedOk.push({ index: i, row: result.normalized });
    }
  }

  // ─── Pass 2: resolve FKs by name/email ────────────────────────────────
  // Batch the lookups so we make exactly 4 DB queries total, not N*4.
  const allEmails = new Set<string>();
  const allInstallerNames = new Set<string>();
  const allFinancerNames = new Set<string>();
  for (const { row } of normalizedOk) {
    allEmails.add(row.closerEmail);
    if (row.setterEmail) allEmails.add(row.setterEmail);
    if (row.subDealerEmail) allEmails.add(row.subDealerEmail);
    allInstallerNames.add(row.installerName);
    allFinancerNames.add(row.financerName);
  }

  const [userRows, installerRows, financerRows] = await Promise.all([
    allEmails.size > 0
      ? prisma.user.findMany({
          where: { email: { in: [...allEmails] } },
          select: { id: true, email: true, role: true, active: true },
        })
      : Promise.resolve([]),
    allInstallerNames.size > 0
      ? prisma.installer.findMany({
          where: { name: { in: [...allInstallerNames] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    allFinancerNames.size > 0
      ? prisma.financer.findMany({
          where: { name: { in: [...allFinancerNames] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const userByEmail = new Map(userRows.map((u) => [u.email.toLowerCase(), u]));
  const installerByName = new Map(installerRows.map((i) => [i.name.toLowerCase(), i]));
  const financerByName = new Map(financerRows.map((f) => [f.name.toLowerCase(), f]));

  const resolvedOk: Array<{ index: number; row: ResolvedProject }> = [];
  for (const { index, row } of normalizedOk) {
    const lookupErrors: string[] = [];

    const closer = userByEmail.get(row.closerEmail);
    if (!closer) {
      lookupErrors.push(`closerEmail "${row.closerEmail}" not found — create the user first`);
    } else if (!closer.active) {
      lookupErrors.push(`closerEmail "${row.closerEmail}" is inactive — reactivate or import to a different closer`);
    }

    let setter: { id: string; email: string; active: boolean } | undefined;
    if (row.setterEmail) {
      setter = userByEmail.get(row.setterEmail);
      if (!setter) lookupErrors.push(`setterEmail "${row.setterEmail}" not found`);
      else if (!setter.active) lookupErrors.push(`setterEmail "${row.setterEmail}" is inactive`);
    }

    let subDealer: { id: string; email: string; role: string; active: boolean } | undefined;
    if (row.subDealerEmail) {
      subDealer = userByEmail.get(row.subDealerEmail);
      if (!subDealer) lookupErrors.push(`subDealerEmail "${row.subDealerEmail}" not found`);
      else if (subDealer.role !== 'sub-dealer') lookupErrors.push(`subDealerEmail "${row.subDealerEmail}" has role "${subDealer.role}", not "sub-dealer"`);
      else if (!subDealer.active) lookupErrors.push(`subDealerEmail "${row.subDealerEmail}" is inactive`);
    }

    const installer = installerByName.get(row.installerName.toLowerCase());
    if (!installer) {
      lookupErrors.push(`installerName "${row.installerName}" not found — check spelling or create the installer first`);
    }

    const financer = financerByName.get(row.financerName.toLowerCase());
    if (!financer) {
      lookupErrors.push(`financerName "${row.financerName}" not found — check spelling or create the financer first`);
    }

    if (lookupErrors.length > 0) {
      wouldError.push({ index, row: input[index], errors: lookupErrors });
      continue;
    }

    resolvedOk.push({
      index,
      row: {
        ...row,
        closerId: closer!.id,
        setterId: setter?.id ?? null,
        subDealerId: subDealer?.id ?? null,
        installerId: installer!.id,
        financerId: financer!.id,
      },
    });
  }

  // ─── Pass 3: duplicate detection (customerName + soldDate + closerId) ──
  // Glide projects don't have stable cross-app IDs so we use this triple
  // as a natural key. Not bulletproof but effective for typical imports.
  const existingDupes = resolvedOk.length > 0
    ? await prisma.project.findMany({
        where: {
          OR: resolvedOk.map(({ row }) => ({
            customerName: row.customerName,
            soldDate: row.soldDate,
            closerId: row.closerId,
          })),
        },
        select: { id: true, customerName: true, soldDate: true, closerId: true },
      })
    : [];
  const dupeKey = (r: { customerName: string; soldDate: string; closerId: string }) =>
    `${r.customerName}::${r.soldDate}::${r.closerId}`;
  const dupeMap = new Map(existingDupes.map((p) => [dupeKey(p), p.id]));

  for (const { index, row } of resolvedOk) {
    const existingId = dupeMap.get(dupeKey(row));
    if (existingId) {
      wouldSkip.push({
        index,
        row,
        reason: 'project with same customerName + soldDate + closer already exists',
        existingProjectId: existingId,
      });
    } else {
      wouldCreate.push({ index, row });
    }
  }

  const base = {
    dryRun: !commit,
    total: input.length,
    wouldCreate: wouldCreate.map(({ index, row }) => ({
      index,
      row: {
        customerName: row.customerName,
        closerEmail: row.closerEmail,
        setterEmail: row.setterEmail,
        installerName: row.installerName,
        financerName: row.financerName,
        soldDate: row.soldDate,
        phase: row.phase,
        kWSize: row.kWSize,
        netPPW: row.netPPW,
      },
    })),
    wouldSkip: wouldSkip.map(({ index, row, reason, existingProjectId }) => ({
      index,
      row: {
        customerName: row.customerName,
        closerEmail: row.closerEmail,
        soldDate: row.soldDate,
      },
      reason,
      existingProjectId,
    })),
    wouldError,
  };

  // ─── Dry-run path ────────────────────────────────────────────────────
  if (!commit) {
    return NextResponse.json(base);
  }

  // ─── Commit: refuse on any errors ────────────────────────────────────
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

  if (wouldCreate.length === 0) {
    return NextResponse.json({ ...base, committed: true, created: [] });
  }

  // ─── Commit: atomic transaction ──────────────────────────────────────
  try {
    const created = await prisma.$transaction(
      wouldCreate.map(({ row }) =>
        prisma.project.create({
          data: {
            customerName: row.customerName,
            closerId: row.closerId,
            setterId: row.setterId,
            subDealerId: row.subDealerId,
            installerId: row.installerId,
            financerId: row.financerId,
            soldDate: row.soldDate,
            productType: row.productType,
            kWSize: row.kWSize,
            netPPW: row.netPPW,
            phase: row.phase,
            m1Amount: row.m1Amount,
            m2Amount: row.m2Amount,
            m3Amount: row.m3Amount,
            setterM2Amount: row.setterM2Amount,
            setterM3Amount: row.setterM3Amount,
            m1Paid: row.m1Paid,
            m2Paid: row.m2Paid,
            m3Paid: row.m3Paid,
            notes: row.notes,
            flagged: row.flagged,
            leadSource: row.leadSource,
          },
          select: {
            id: true,
            customerName: true,
            soldDate: true,
            phase: true,
            kWSize: true,
          },
        }),
      ),
    );

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
