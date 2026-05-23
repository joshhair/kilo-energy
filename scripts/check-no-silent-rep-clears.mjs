/**
 * check:no-silent-rep-clears — guard against the recurring setter/rep/blitz
 * silent-drop regression.
 *
 * The new-deal forms must NEVER call `update('setterId', '')` (or the
 * analogous `update('repId', '')` / `update('blitzId', '')`) from a
 * reactive handler (onChange/onClick/useEffect) without positive evidence
 * that the existing value is invalid. The pattern has regressed FOUR
 * times now:
 *
 *   - 2026-04-22: Tyson dropped from Trevor Schauwecker's deal
 *   - 2026-04-26: setter dropped from Bryce Marsh's Melissa Lance deal
 *   - 2026-05-11: setter dropped from Hunter Helton deal
 *   - 2026-05-23: Patrick dropped from Bryce Marsh's deal (this one)
 *
 * Each time, a developer (or auto-agent) added a "convenience" clear
 * inside a picker's onChange — and a real submitted deal silently lost
 * its setter to the database. The fix is always the same:
 *
 *   1. DO NOT auto-clear. Let the existing setterValidationError memoized
 *      banner surface the mismatch.
 *   2. Submit-time guard (already present) blocks the submission.
 *   3. User picks again, intentionally.
 *
 * This gate scans the two new-deal forms for the bad pattern and an
 * allowlist (scripts/no-silent-rep-clears.allowlist.json) holds the
 * legitimate exceptions, each with a written reason.
 *
 * Exit 1 on any unallowlisted violation.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// Files this gate audits. Setter/rep/blitz protection only matters where
// a deal is created or edited — these are the forms where the regression
// has actually shipped to prod.
const PROTECTED_FILES = [
  'app/dashboard/new-deal/page.tsx',
  'app/dashboard/mobile/MobileNewDeal.tsx',
  'app/dashboard/projects/[id]/page.tsx',
  'app/dashboard/mobile/MobileProjectDetail.tsx',
];

// Fields whose silent clearing has caused production regressions.
const PROTECTED_FIELDS = ['setterId', 'repId', 'blitzId'];

const ALLOWLIST_PATH = join(ROOT, 'scripts', 'no-silent-rep-clears.allowlist.json');
let allowlist = { entries: [] };
try {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
} catch {
  // File not yet present — first run, treat as empty allowlist.
}
const allowlisted = new Set((allowlist.entries ?? []).map((e) => e.location));

// Match: update('setterId', '')   /   update("repId", "")  / etc.
// Also matches: setForm((prev) => ({ ...prev, setterId: '' })) etc.
const fieldUnion = PROTECTED_FIELDS.join('|');
const UPDATE_CLEAR_RE = new RegExp(
  `update\\s*\\(\\s*['"](${fieldUnion})['"]\\s*,\\s*['"]['"]\\s*\\)`,
  'g',
);
const SETFORM_CLEAR_RE = new RegExp(
  `\\b(${fieldUnion})\\s*:\\s*['"]['"]\\s*(?:,|})`,
  'g',
);

const violations = [];

for (const rel of PROTECTED_FILES) {
  const full = join(ROOT, rel);
  let src;
  try {
    src = readFileSync(full, 'utf-8');
  } catch {
    // File deleted or moved — skip; check:schema/audit would flag broader changes.
    continue;
  }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const locKey = `${rel.replaceAll('\\', '/')}:${ln}`;

    UPDATE_CLEAR_RE.lastIndex = 0;
    let m;
    while ((m = UPDATE_CLEAR_RE.exec(line)) !== null) {
      if (allowlisted.has(locKey)) continue;
      violations.push({
        kind: 'update-clear',
        file: rel,
        line: ln,
        field: m[1],
        snippet: line.trim().slice(0, 140),
      });
    }
    SETFORM_CLEAR_RE.lastIndex = 0;
    while ((m = SETFORM_CLEAR_RE.exec(line)) !== null) {
      // Skip the initial form-state declaration — that's the default empty
      // value at render-time, not a reactive clear. Recognized by the line
      // starting (after trim) with the field name as a property in an
      // object literal that's part of useState initialization.
      const trimmed = line.trim();
      const isInitializer =
        trimmed.startsWith(`${m[1]}:`) || // bare property in an initializer object
        trimmed.startsWith(`${m[1]} :`);
      if (isInitializer) continue;
      if (allowlisted.has(locKey)) continue;
      violations.push({
        kind: 'setForm-clear',
        file: rel,
        line: ln,
        field: m[1],
        snippet: trimmed.slice(0, 140),
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ check:no-silent-rep-clears — ${PROTECTED_FILES.length} files audited, 0 violations.`);
  if ((allowlist.entries?.length ?? 0) > 0) {
    console.log(`  (${allowlist.entries.length} allowlist entries.)`);
  }
  process.exit(0);
}

console.error(`✗ check:no-silent-rep-clears — ${violations.length} violation(s):`);
console.error(`\nThese forms have a documented history of silently dropping a user's`);
console.error(`picked setter/rep/blitz from a real submitted deal. Each occurrence`);
console.error(`shipped a real bug to production. Do not add new silent-clear paths.`);
console.error(`Surface a banner via setterValidationError instead, and let the submit`);
console.error(`guard block invalid combinations.\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.kind} → ${v.field}]`);
  console.error(`    ${v.snippet}\n`);
}
console.error(`If a violation is truly intentional, add a typed entry to`);
console.error(`  ${relative(ROOT, ALLOWLIST_PATH)}`);
console.error(`with a written reason. Code review will scrutinize new allowlist entries.`);
process.exit(1);
