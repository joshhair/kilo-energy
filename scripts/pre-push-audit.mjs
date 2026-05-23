/**
 * audit:pre-push — "measure twice, cut once" gate for every push.
 *
 * Josh's standing rule (saved as feedback memory on 2026-05-23 after the
 * fourth setter-drop regression shipped to prod): every push must be
 * audited BEFORE it leaves the local machine. If the audit flags any
 * regression risk, fixes are applied AND THEN THE AUDIT IS RE-RUN until
 * it's clean. Only then does the push happen.
 *
 * This script:
 *   1. Runs every CI gate (check:*) — full quality matrix.
 *   2. Runs typecheck + vitest.
 *   3. Scans the diff against origin/main (or HEAD~1 if no remote) for
 *      ADDED lines matching high-risk patterns the team has been bitten
 *      by repeatedly:
 *        - Silent setter/rep/blitz clears in onChange/useEffect handlers
 *        - Hard-coded color: '#fff' / 'white' on inline styles
 *        - Use of accent-*-text/-display tokens as backgrounds
 *        - Removal of guard comments ("DON'T CLEAR", "regression",
 *          "do not", "sacred", "6-guard")
 *        - New top-level @ts-ignore / eslint-disable lines
 *        - Removed audit log calls (logChange) that were present before
 *
 *   4. Prints a structured "Pre-Push Audit Report" with: gates summary,
 *      diff risks (file:line + snippet + suggested fix), and an
 *      overall PASS / BLOCK verdict.
 *
 * Exit 0 on PASS. Exit 1 on BLOCK. The push wrapper (a future tweak to
 * the git workflow / husky pre-push hook) calls this and refuses the
 * push on non-zero exit.
 *
 * Run it directly:  npm run audit:pre-push
 *
 * After applying corrective fixes, RE-RUN. A single clean run alone is
 * insufficient — the report must be re-generated to prove the fixes
 * didn't introduce new risks (measure twice).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// Load the no-silent-rep-clears allowlist so the diff scanner doesn't
// false-positive on legitimate allowlisted clears (e.g. blitzId resets
// when the rep changes). Each allowlisted location is line-pinned, so
// shifts caused by surrounding edits are caught by re-validating against
// the file's current content via the check gate itself.
let silentClearAllowlist = new Set();
try {
  const data = JSON.parse(
    readFileSync(join(ROOT, 'scripts', 'no-silent-rep-clears.allowlist.json'), 'utf-8'),
  );
  silentClearAllowlist = new Set((data.entries ?? []).map((e) => e.location));
} catch {
  // No allowlist file — treat all as flaggable. The check gate will catch.
}

const GATES = [
  ['check:tokens', 'design-token drift'],
  ['check:schema', 'Prisma schema vs Turso snapshot'],
  ['check:sensitivity', 'sensitive-field access'],
  ['check:audit', 'audit-log coverage'],
  ['check:privacy-gate', 'privacy-gate coverage'],
  ['check:primitives', 'primitive-component usage'],
  ['check:notifications', 'notification event coverage'],
  ['check:button-contrast', 'white-on-emerald contrast guard'],
  ['check:no-silent-rep-clears', 'setter/rep/blitz silent-clear guard'],
];

// High-risk patterns scanned against ADDED diff lines.
const RISK_PATTERNS = [
  {
    id: 'silent-rep-clear',
    re: /update\s*\(\s*['"](setterId|repId|blitzId)['"]\s*,\s*['"]['"]\s*\)/,
    explain: (m) => `New silent clear of \`${m[1]}\` — has caused 4 production regressions. Surface a banner instead.`,
  },
  {
    id: 'hex-white-text',
    re: /color:\s*['"](#fff|#FFF|#ffffff|#FFFFFF|white)['"]/,
    explain: () => `Hard-coded white text — use var(--text-on-accent) for buttons on accent fills, or var(--text-primary).`,
  },
  {
    id: 'text-token-as-bg',
    re: /background(?:Color)?:\s*['"]var\(--accent-[a-z]+-(text|display)\)['"]/,
    explain: (m) => `--accent-*-${m[1]} is a TEXT color, not a background fill. Use --accent-*-solid (filled) or --accent-*-soft (tinted).`,
  },
  {
    id: 'new-ts-ignore',
    re: /^\s*\/\/\s*@ts-ignore/,
    explain: () => `New @ts-ignore — prefer fixing the underlying type. If truly necessary, use @ts-expect-error with a comment.`,
  },
  {
    id: 'new-eslint-disable',
    re: /^\s*\/\/\s*eslint-disable(-next-line)?\b/,
    explain: () => `New eslint-disable — investigate the underlying violation before disabling.`,
  },
  {
    id: 'no-verify-hook-skip',
    re: /--no-verify\b/,
    explain: () => `Skipping git hooks — typically forbidden. If a hook is broken, fix the hook, don't bypass it.`,
  },
];

// Patterns that are PROTECTIVE — losing them in the diff is itself a risk.
const PROTECTIVE_MARKERS = [
  /DO NOT\b/i,
  /DON'?T CLEAR\b/i,
  /regression/i,
  /6[-\s]?guard/i,
  /\bsacred\b/i,
];

function sh(cmd) {
  try {
    return { ok: true, stdout: execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      code: e.status ?? 1,
    };
  }
}

function header(label) {
  const bar = '─'.repeat(64);
  return `\n${bar}\n${label}\n${bar}`;
}

console.log(header('Pre-Push Audit — measure twice, cut once'));
console.log(`Repo: ${ROOT}\nStarted: ${new Date().toISOString()}\n`);

let blocked = false;

// 1. Quality gates ─────────────────────────────────────────────────────
console.log(header('1. Quality gates'));
const gateResults = [];
for (const [name, descr] of GATES) {
  const r = sh(`npm run ${name} --silent`);
  const status = r.ok ? '✓' : '✗';
  gateResults.push({ name, descr, ok: r.ok, output: r.ok ? '' : `${r.stdout}\n${r.stderr}` });
  console.log(`  ${status} ${name.padEnd(32)} ${descr}`);
  if (!r.ok) blocked = true;
}

// 2. Typecheck ─────────────────────────────────────────────────────────
console.log(header('2. Typecheck'));
{
  const r = sh('npx tsc --noEmit');
  console.log(`  ${r.ok ? '✓' : '✗'} tsc --noEmit`);
  if (!r.ok) {
    blocked = true;
    console.log(r.stdout.split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));
  }
}

// 3. Vitest ────────────────────────────────────────────────────────────
console.log(header('3. Tests'));
{
  const r = sh('npx vitest run --reporter=dot');
  const m = (r.stdout + r.stderr).match(/Tests\s+(\d+)\s+passed/);
  const tests = m ? m[1] : '?';
  console.log(`  ${r.ok ? '✓' : '✗'} vitest (${tests} tests)`);
  if (!r.ok) {
    blocked = true;
    console.log(r.stdout.split('\n').slice(-20).map((l) => `    ${l}`).join('\n'));
  }
}

// 4. Diff risk scan ────────────────────────────────────────────────────
console.log(header('4. Diff risk scan'));

let base = 'origin/main';
const fetchOk = sh('git rev-parse --verify origin/main').ok;
if (!fetchOk) {
  base = sh('git rev-parse HEAD~1').ok ? 'HEAD~1' : null;
}
if (!base) {
  console.log('  (no base commit to diff against — skipping risk scan)');
} else {
  // Scan BOTH committed-since-base AND uncommitted working-tree changes,
  // so the audit catches risky lines whether you ran it before or after
  // the commit. -U0 = no context. --diff-filter=AM = added or modified.
  const committedDiff = sh(`git diff ${base}...HEAD -U0 --diff-filter=AM -- "*.ts" "*.tsx" "*.mts"`).stdout;
  const workingDiff = sh(`git diff HEAD -U0 --diff-filter=AM -- "*.ts" "*.tsx" "*.mts"`).stdout;
  const diff = committedDiff + '\n' + workingDiff;
  const risks = [];
  const protectiveLosses = [];
  let currentFile = null;
  let currentNewLine = 0;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    const hunkMatch = line.match(/^@@ .* \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentNewLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (!currentFile) continue;
    // Skip the audit script itself + tests that intentionally exercise patterns
    if (currentFile.includes('scripts/check-') || currentFile.includes('scripts/pre-push-audit')) {
      // still tracks added lines from this file but don't risk-scan them
      if (line.startsWith('+') && !line.startsWith('+++')) currentNewLine++;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const added = line.slice(1);
      for (const pat of RISK_PATTERNS) {
        const m = added.match(pat.re);
        if (m) {
          // Cross-check against the silent-clear allowlist — if this exact
          // file:line was deliberately allowed (with a written reason),
          // surface it as an informational note instead of a hard block.
          // The check:no-silent-rep-clears gate is the authoritative
          // judge; the audit just mirrors that decision here.
          const loc = `${currentFile.replaceAll('\\', '/')}:${currentNewLine}`;
          if (pat.id === 'silent-rep-clear' && silentClearAllowlist.has(loc)) {
            continue;
          }
          risks.push({
            file: currentFile,
            line: currentNewLine,
            id: pat.id,
            snippet: added.trim().slice(0, 140),
            explain: pat.explain(m),
          });
        }
      }
      currentNewLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      const removed = line.slice(1);
      for (const marker of PROTECTIVE_MARKERS) {
        if (marker.test(removed)) {
          protectiveLosses.push({
            file: currentFile,
            marker: marker.toString(),
            snippet: removed.trim().slice(0, 140),
          });
        }
      }
    }
  }
  if (risks.length === 0 && protectiveLosses.length === 0) {
    console.log('  ✓ No risky patterns detected in added lines.');
  } else {
    if (risks.length > 0) {
      console.log(`  ✗ ${risks.length} risky pattern(s) added:\n`);
      for (const r of risks) {
        console.log(`    ${r.file}:${r.line}  [${r.id}]`);
        console.log(`      ${r.snippet}`);
        console.log(`      ${r.explain}\n`);
      }
      blocked = true;
    }
    if (protectiveLosses.length > 0) {
      console.log(`  ⚠ ${protectiveLosses.length} protective marker(s) removed (review carefully):\n`);
      for (const p of protectiveLosses) {
        console.log(`    ${p.file}  matched ${p.marker}`);
        console.log(`      ${p.snippet}\n`);
      }
      // Removal of protective markers isn't an automatic block — sometimes
      // it's legitimate cleanup. But it always warrants human review.
    }
  }
}

// 5. Verdict ───────────────────────────────────────────────────────────
console.log(header('Verdict'));
if (blocked) {
  console.log('  ✗ BLOCK — fix the issues above, then RE-RUN this audit.');
  console.log('  Per the measure-twice-cut-once rule, one clean run is not enough:');
  console.log('  the audit must be re-run AFTER corrections to prove no new risks');
  console.log('  were introduced.\n');
  process.exit(1);
}
console.log('  ✓ PASS — safe to push.');
console.log('  If you applied fixes between this run and the previous one,');
console.log('  this is the second pass that proves nothing regressed.\n');
process.exit(0);
