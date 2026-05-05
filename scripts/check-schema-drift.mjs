/**
 * Compares prisma/schema.prisma scalar columns against the checked-in
 * turso-schema.sql snapshot. Exits 1 on drift so CI fails.
 *
 * Run before any PR that touches schema:
 *   1. `npm run snapshot:turso-schema`  (refresh snapshot from live DB)
 *   2. `npm run check:schema`           (this script)
 *
 * What it checks:
 *   - Tables present in Prisma but missing from Turso (or vice versa)
 *   - Columns present in one but not the other
 *   - Column type mismatches (mapped Prisma types <-> SQLite types)
 *   - Nullability mismatches (`?` in Prisma vs `NOT NULL` in SQL)
 *
 * What it does NOT check:
 *   - Indexes (orthogonal to data integrity; left for human review)
 *   - Default values (legitimate to drift slightly between code and DB)
 *   - Foreign-key constraints
 *
 * Author note: built to catch silent drift like the cycle-861 repType bug
 * and the BlitzCost amount/amountCents mismatch. Keep this gate honest.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'prisma', 'schema.prisma');
const tursoPath = join(here, '..', 'turso-schema.sql');

const prismaSrc = readFileSync(schemaPath, 'utf-8');
const tursoSrc = readFileSync(tursoPath, 'utf-8');

// ── Prisma → column shape ───────────────────────────────────────────────
// model X {
//   field   String   @id @default(cuid())
//   other   Int?
//   relName Other    @relation(...)        // skip — relation, not column
//   @@index([field])                        // skip — table annotation
// }

const PRISMA_TO_SQL_TYPE = {
  String: 'TEXT',
  Int: 'INTEGER',
  BigInt: 'INTEGER',
  Float: 'REAL',
  Decimal: 'REAL',
  Boolean: 'BOOLEAN',
  DateTime: 'DATETIME',
  Json: 'TEXT', // SQLite stores JSON as TEXT
  Bytes: 'BLOB',
};

// SQLite has type affinity, not strict types. A few declared types are
// interchangeable in practice — match them so we don't false-positive on
// migrations that used the more idiomatic SQLite spelling.
const SQL_TYPE_COMPATIBLE = {
  BOOLEAN: ['BOOLEAN', 'INTEGER'], // booleans are commonly declared INTEGER 0/1 in SQLite
};

function parsePrisma(src) {
  const tables = new Map();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm;
  let m;
  while ((m = modelRe.exec(src)) !== null) {
    const tableName = m[1];
    const body = m[2];
    const cols = new Map();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('///')) continue;
      // Match "name Type[?] [@anything ...]"
      const fieldRe = /^(\w+)\s+(\w+)(\?)?(\[\])?(\s+.*)?$/;
      const fm = line.match(fieldRe);
      if (!fm) continue;
      const [, name, prismaType, nullable, list, rest] = fm;
      // Skip relation fields (no @relation column on this row, but the
      // type is a model). Heuristic: if there's "@relation(" in `rest`,
      // this row is a relation accessor, not a column. Also skip list
      // types (arrays — implicit-many relations).
      if (list) continue;
      if (rest && /@relation\b/.test(rest)) continue;
      // Skip the type-side of a relation accessor: if the type is not a
      // mappable scalar AND there's no @relation, it's still a relation
      // (just unmarked). Filter by mapped types only.
      const sqlType = PRISMA_TO_SQL_TYPE[prismaType];
      if (!sqlType) continue;
      cols.set(name, {
        prismaType,
        sqlType,
        nullable: Boolean(nullable),
      });
    }
    tables.set(tableName, cols);
  }
  return tables;
}

// ── Turso SQL → column shape ───────────────────────────────────────────
// CREATE TABLE "X" (
//   "field" TEXT NOT NULL DEFAULT '',
//   "other" INTEGER,
//   ...
//   CONSTRAINT "..." FOREIGN KEY ...   // skip
// )

function parseTurso(src) {
  const tables = new Map();
  // Match the first `);` after the opening `(`. Schemas that grew via
  // ALTER TABLE ADD COLUMN end up with multiple columns on a single
  // line just before the close, so we can't anchor on `\n);`. Use a
  // non-greedy capture and stop at the first `);` we hit.
  const tableRe = /CREATE TABLE\s+"([^"]+)"\s*\(([\s\S]*?)\)\s*;/g;
  let m;
  while ((m = tableRe.exec(src)) !== null) {
    const tableName = m[1];
    const body = m[2];
    const cols = new Map();
    // Tables built up via ALTER TABLE ADD COLUMN can have multiple
    // column defs on a single line, separated by commas. Split on
    // top-level commas (not commas inside parens like DEFAULT '...').
    const segments = splitTopLevelCommas(body);
    for (const rawSeg of segments) {
      const line = rawSeg.trim();
      if (!line) continue;
      if (/^CONSTRAINT\b/i.test(line)) continue;
      if (/^PRIMARY KEY\s*\(/i.test(line)) continue;
      if (/^UNIQUE\s*\(/i.test(line)) continue;
      if (/^FOREIGN KEY\b/i.test(line)) continue;
      // Optional quotes around column name (Turso emits some unquoted)
      const colRe = /^"?([\w]+)"?\s+(\w+)(.*)$/;
      const cm = line.match(colRe);
      if (!cm) continue;
      const [, name, sqlType, modifiers] = cm;
      // SQLite quirk: only INTEGER PRIMARY KEY implies NOT NULL. For
      // TEXT primary keys, NULLs are technically allowed unless NOT NULL
      // is explicit. But Prisma always populates id columns via @id +
      // @default(cuid()), so treat PRIMARY KEY as NOT NULL here to match
      // the app-level contract instead of SQLite's permissive default.
      const isPrimary = /\bPRIMARY KEY\b/i.test(modifiers);
      const nullable = !(/\bNOT NULL\b/i.test(modifiers) || isPrimary);
      cols.set(name, { sqlType: sqlType.toUpperCase(), nullable });
    }
    tables.set(tableName, cols);
  }
  return tables;
}

// Split a CREATE TABLE body on commas that are at depth 0 (not inside
// nested parens like `DEFAULT (datetime('now'))`).
function splitTopLevelCommas(body) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// ── Diff ────────────────────────────────────────────────────────────────

const prismaTables = parsePrisma(prismaSrc);
const tursoTables = parseTurso(tursoSrc);

const issues = [];

// Tables in Prisma not in Turso
for (const tableName of prismaTables.keys()) {
  if (!tursoTables.has(tableName)) {
    issues.push({
      severity: 'error',
      table: tableName,
      message: `Table exists in Prisma but missing from Turso snapshot.`,
    });
  }
}

// Tables in Turso not in Prisma
for (const tableName of tursoTables.keys()) {
  if (!prismaTables.has(tableName)) {
    issues.push({
      severity: 'warning',
      table: tableName,
      message: `Table exists in Turso snapshot but not in Prisma (orphan or refresh needed).`,
    });
  }
}

// Per matching table, diff columns
for (const [tableName, prismaCols] of prismaTables.entries()) {
  const tursoCols = tursoTables.get(tableName);
  if (!tursoCols) continue;
  for (const [colName, prismaCol] of prismaCols.entries()) {
    const tursoCol = tursoCols.get(colName);
    if (!tursoCol) {
      issues.push({
        severity: 'error',
        table: tableName,
        column: colName,
        message: `Column exists in Prisma but missing from Turso. (Prisma: ${prismaCol.prismaType}${prismaCol.nullable ? '?' : ''})`,
      });
      continue;
    }
    if (tursoCol.sqlType !== prismaCol.sqlType) {
      const compatible = SQL_TYPE_COMPATIBLE[prismaCol.sqlType] ?? [prismaCol.sqlType];
      if (!compatible.includes(tursoCol.sqlType)) {
        issues.push({
          severity: 'error',
          table: tableName,
          column: colName,
          message: `Type mismatch. Prisma: ${prismaCol.prismaType} (→${prismaCol.sqlType}). Turso: ${tursoCol.sqlType}.`,
        });
      }
    }
    if (tursoCol.nullable !== prismaCol.nullable) {
      issues.push({
        severity: 'error',
        table: tableName,
        column: colName,
        message: `Nullability mismatch. Prisma: ${prismaCol.nullable ? 'nullable' : 'NOT NULL'}. Turso: ${tursoCol.nullable ? 'nullable' : 'NOT NULL'}.`,
      });
    }
  }
  for (const colName of tursoCols.keys()) {
    if (!prismaCols.has(colName)) {
      issues.push({
        severity: 'warning',
        table: tableName,
        column: colName,
        message: `Column exists in Turso but missing from Prisma scalar fields (relation, computed, or orphan).`,
      });
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

if (issues.length === 0) {
  console.log(`✓ Schema is in sync. ${prismaTables.size} tables compared.`);
  process.exit(0);
}

console.log(`Schema drift detected: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
for (const i of issues) {
  const tag = i.severity === 'error' ? 'ERROR' : 'WARN ';
  const loc = i.column ? `${i.table}.${i.column}` : i.table;
  console.log(`  [${tag}] ${loc}: ${i.message}`);
}
console.log('');
console.log('If the snapshot is stale, refresh it: npm run snapshot:turso-schema');
console.log('If Prisma drifted from Turso, write a migration to align them.');

process.exit(errors.length > 0 ? 1 : 0);
