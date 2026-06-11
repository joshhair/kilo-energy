/**
 * check:no-silent-rep-clears — guard against the recurring setter/rep/blitz
 * silent-drop regression.
 *
 * The new-deal / edit forms must NEVER blank a chosen `setterId` / `repId` /
 * `blitzId` from a reactive handler (onChange/onClick/useEffect) without
 * positive evidence the existing value is invalid. The pattern has regressed
 * FOUR times — each time a real submitted deal silently lost its setter:
 *
 *   - 2026-04-22: Tyson dropped from Trevor Schauwecker's deal
 *   - 2026-04-26: setter dropped from Bryce Marsh's Melissa Lance deal
 *   - 2026-05-11: setter dropped from Hunter Helton's deal
 *   - 2026-05-23: Patrick dropped from Bryce Marsh's deal
 *
 * The fix is always the same: DON'T auto-clear — let the memoized
 * setterValidationError banner surface the mismatch and the submit-time guard
 * block the submission; the user re-picks intentionally.
 *
 * ── Detection: AST-based (TypeScript compiler) ─────────────────────────────
 * Earlier versions used a line-local regex, which missed multiline calls,
 * template-literal empties, and disguised initializers, and could not tell a
 * reactive `setForm(p => ({ ...p, setterId: '' }))` from a `useState({ setterId:
 * '' })` default. We now parse each form with the TS parser and flag:
 *   1. `update('<field>', '')`  — any formatting, incl. multiline / template ``.
 *   2. `{ <field>: '' }`        — object-property clears, EXCEPT when the nearest
 *                                 enclosing call is a hook (useState/useRef/…),
 *                                 i.e. a render-time initializer default.
 *
 * ── Allowlist: content-anchored + counted ──────────────────────────────────
 * Each legitimate clear is keyed by `file::field::anchor`, where `anchor` is a
 * hash of the statement + up to 2 preceding NON-BLANK lines (anchorFor). This
 * survives unrelated line drift (the old line-pin failure mode) but changes if
 * the clear's own local context changes (forcing re-review). Each entry also
 * carries a `count` (default 1): if MORE occurrences of the same anchor appear
 * than are allowed, the extras are flagged — so a newly pasted duplicate of an
 * allowlisted clear cannot ride in unflagged.
 *
 * Exit 1 on any unallowlisted (or over-count) violation.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');

// Forms where a deal is created or edited — the only place the regression ships.
export const PROTECTED_FILES = [
  'app/dashboard/new-deal/page.tsx',
  'app/dashboard/mobile/MobileNewDeal.tsx',
  'app/dashboard/mobile/new-deal/StepReview.tsx',
  'app/dashboard/projects/[id]/page.tsx',
  'app/dashboard/projects/components/detail/EditProjectModal.tsx',
  'app/dashboard/mobile/MobileProjectDetail.tsx',
];

export const PROTECTED_FIELDS = ['setterId', 'repId', 'blitzId'];
const FIELD_SET = new Set(PROTECTED_FIELDS);
// Hooks whose first argument is a render-time INITIAL value (not a reactive
// updater). useCallback / useMemo are intentionally excluded — they can return
// a state updater that genuinely clears.
const INIT_HOOK_RE = /^use(State|Ref|Reducer)$/;
const CONTEXT_BEFORE = 2;

function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip wrappers that don't change a value: (x), x as T, x!, x satisfies T. */
function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

/** The node as a string/template literal (after unwrapping), or null. */
function asStringLiteral(node) {
  const n = unwrap(node);
  return n && ts.isStringLiteralLike(n) ? n : null;
}

/** Empty '' or `` literal, including wrapped forms like ('') or '' as const. */
function isEmptyStringLiteral(node) {
  const n = asStringLiteral(node);
  return !!n && n.text === '';
}

/** Field name from a property key: identifier, 'string', or ['computed string']. */
function propKeyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const e = asStringLiteral(name.expression);
    if (e) return e.text;
  }
  return null;
}

/**
 * Stable, line-number-independent anchor for the clear whose statement begins
 * at 0-based `lineIndex`: hash of that line + up to CONTEXT_BEFORE preceding
 * NON-BLANK lines (blank lines are skipped, not counted).
 */
export function anchorFor(lines, lineIndex) {
  const ctx = [normalize(lines[lineIndex] ?? '')];
  let collected = 0;
  for (let j = lineIndex - 1; j >= 0 && collected < CONTEXT_BEFORE; j--) {
    const t = normalize(lines[j] ?? '');
    if (!t) continue; // skip blank lines without consuming the budget
    ctx.unshift(t);
    collected++;
  }
  return createHash('sha256').update(ctx.join(' | ')).digest('hex').slice(0, 12);
}

function nearestEnclosingCall(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) return p;
  }
  return null;
}

/** A `{ field: '' }` whose nearest enclosing call is an INITIAL-value hook (useState/useRef/useReducer) is a default, not a clear. */
function isInitHookInitializer(propNode) {
  const call = nearestEnclosingCall(propNode);
  return !!(call && ts.isIdentifier(call.expression) && INIT_HOOK_RE.test(call.expression.text));
}

/**
 * A `{ field: '' }` only DROPS a previously-chosen value when its object spreads
 * prior state BEFORE the field — `{ ...prev, field: '' }`. A complete
 * initial-state object (no spread) is a creation default; `{ field: '', ...prev }`
 * doesn't clear either (the spread overwrites the field back).
 */
function objectSpreadsPriorState(propNode) {
  const obj = propNode.parent;
  if (!ts.isObjectLiteralExpression(obj)) return false;
  const fieldIdx = obj.properties.indexOf(propNode);
  return obj.properties.some((p, i) => i < fieldIdx && ts.isSpreadAssignment(p));
}

/**
 * Detect reactive setter/rep/blitz clears in a source string via the TS AST.
 * Pure — no filesystem. Returns [{ kind, field, line, anchor, snippet }].
 */
export function detectClears(src, fileName = 'form.tsx') {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = src.split('\n');
  const found = [];

  const record = (kind, field, node) => {
    const lineIdx = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line; // 0-based
    found.push({
      kind,
      field,
      line: lineIdx + 1,
      anchor: anchorFor(lines, lineIdx),
      snippet: normalize(node.getText(sf)).slice(0, 140),
    });
  };

  const visit = (node) => {
    // Pattern 1: update('<field>', '')  — any formatting, incl. multiline,
    // template literals, and wrapped empties ((''), '' as const). Also
    // matches PROPERTY-ACCESS callees (`formCtl.update(...)`, `props.update`)
    // — split components receive `update` through prop bundles, and the
    // pre-push audit defers to this gate for protected files, so a
    // property-access clear must not escape both (Codex, 2026-06-11).
    const callee = ts.isCallExpression(node) ? unwrap(node.expression) : null;
    const calleeIsUpdate =
      callee &&
      ((ts.isIdentifier(callee) && callee.text === 'update') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'update'));
    if (calleeIsUpdate && node.arguments.length >= 2) {
      const fieldArg = asStringLiteral(node.arguments[0]);
      if (fieldArg && FIELD_SET.has(fieldArg.text) && isEmptyStringLiteral(node.arguments[1])) {
        record('update-clear', fieldArg.text, node);
      }
    }

    // Pattern 2: { ...prev, <field>: '' } — a partial-update object that drops
    // a chosen value. Requires a spread BEFORE the field (rules out complete
    // initial-state defaults and `{ field:'', ...prev }`) and excludes
    // initial-value hook defaults. The key may be an identifier, 'string', or
    // ['computed string'].
    if (ts.isPropertyAssignment(node)) {
      const key = propKeyName(node.name);
      if (
        key &&
        FIELD_SET.has(key) &&
        isEmptyStringLiteral(node.initializer) &&
        objectSpreadsPriorState(node) &&
        !isInitHookInitializer(node)
      ) {
        record('object-clear', key, node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

/** Allowlist entries: { file, field, anchor, count?, snippet?, reason? }. */
export function loadAllowlist(rootDir = ROOT) {
  try {
    return (
      JSON.parse(
        readFileSync(join(rootDir, 'scripts', 'no-silent-rep-clears.allowlist.json'), 'utf-8'),
      ).entries ?? []
    );
  } catch {
    return [];
  }
}

/** Run the guard against the real PROTECTED_FILES. Returns { violations, audited }. */
export function runGuard(rootDir = ROOT) {
  const allowed = new Map(); // key -> allowed count
  for (const e of loadAllowlist(rootDir)) {
    const key = `${e.file}::${e.field}::${e.anchor}`;
    allowed.set(key, (allowed.get(key) ?? 0) + (e.count ?? 1));
  }

  const violations = [];
  const seen = new Map(); // key -> count seen so far
  let audited = 0;

  for (const rel of PROTECTED_FILES) {
    let src;
    try {
      src = readFileSync(join(rootDir, rel), 'utf-8');
    } catch {
      continue; // moved/deleted — broader gates catch that
    }
    audited++;
    const relKey = rel.replaceAll('\\', '/');
    for (const c of detectClears(src, relKey)) {
      const key = `${relKey}::${c.field}::${c.anchor}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > (allowed.get(key) ?? 0)) {
        violations.push({ file: relKey, ...c, occurrence: n });
      }
    }
  }
  return { violations, audited };
}

// ─── CLI ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { violations, audited } = runGuard();

  if (violations.length === 0) {
    const entries = loadAllowlist();
    const total = entries.reduce((s, e) => s + (e.count ?? 1), 0);
    console.log(`✓ check:no-silent-rep-clears — ${audited} files audited, 0 violations.`);
    if (entries.length) {
      console.log(`  (${entries.length} allowlist entries / ${total} allowed clears, AST-detected + content-anchored.)`);
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
    const dup = v.occurrence > 1 ? `  (occurrence #${v.occurrence} of this anchor — exceeds allowed count)` : '';
    console.error(`  ${v.file}:${v.line}  [${v.kind} → ${v.field}]  anchor=${v.anchor}${dup}`);
    console.error(`    ${v.snippet}`);
  }
  console.error(`\nIf a violation is truly intentional, add a content-anchored entry to`);
  console.error(`  ${relative(ROOT, join(ROOT, 'scripts', 'no-silent-rep-clears.allowlist.json'))}`);
  console.error(`with a written reason, e.g.:`);
  const ex = violations[0];
  console.error(`  { "file": "${ex.file}", "field": "${ex.field}", "anchor": "${ex.anchor}", "count": 1, "snippet": ${JSON.stringify(ex.snippet)} }`);
  console.error(`(Anchors are content-based — they survive unrelated line shifts but change`);
  console.error(` if the clear's own surrounding code changes. \`count\` caps how many identical`);
  console.error(` occurrences are allowed, so a pasted duplicate still flags.)`);
  process.exit(1);
}
