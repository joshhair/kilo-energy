/**
 * /api/audit — paginated audit log reader for admin UI.
 *
 * Admin-only. Every mutation on money-sensitive tables writes to
 * AuditLog via lib/audit.ts; this endpoint exposes the table with
 * server-side filtering + pagination so the admin UI doesn't have
 * to load 10k+ rows at once.
 *
 * Filters (all optional):
 *   entityType — Project, PayrollEntry, User, etc.
 *   action     — 'phase_change', 'project_update', 'payroll_create', etc.
 *   actorEmail — exact match (admin filtering by operator)
 *   from       — ISO date; logs >= this
 *   to         — ISO date; logs <= this (end of day)
 *   limit      — max 100, default 50
 *   cursor     — opaque ID for keyset pagination
 *
 * Response shape:
 *   { logs: [...], nextCursor: string | null }
 *
 * Uses keyset pagination (cursor = last seen id + createdAt) rather
 * than offset so page 100 is as fast as page 1 regardless of table size.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const url = req.nextUrl;
  const entityType = url.searchParams.get('entityType');
  const action = url.searchParams.get('action');
  const actorEmail = url.searchParams.get('actorEmail');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limitRaw = Number(url.searchParams.get('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_LIMIT, Math.floor(limitRaw)) : DEFAULT_LIMIT;
  const cursor = url.searchParams.get('cursor');

  const where: Record<string, unknown> = {};
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (actorEmail) where.actorEmail = actorEmail;
  if (from || to) {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = new Date(from);
    if (to) {
      // End-of-day semantics: "to=2026-04-19" includes everything up to
      // 2026-04-19 23:59:59.999.
      const end = new Date(to);
      end.setUTCHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    where.createdAt = createdAt;
  }

  // Keyset pagination: use id as the ordered cursor (cuid is
  // lexicographically monotonic within a millisecond — close enough
  // for audit log ordering, and cheaper than composite cursors).
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1, // +1 to peek whether there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const logs = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? logs[logs.length - 1].id : null;

  return NextResponse.json({ logs, nextCursor });
}
