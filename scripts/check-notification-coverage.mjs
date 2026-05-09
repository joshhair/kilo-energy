#!/usr/bin/env node
// CI gate: every event type referenced from a notify() call site MUST be
// registered in lib/notifications/events.ts. Catches the silent class of
// bug where someone fires `notify({ type: 'pay_pendng', ... })` and no
// preference can ever match (so no notification fires).
//
// Strategy:
//   1. Load NOTIFICATION_EVENTS from the registry.
//   2. Walk source dirs, scan for `notify({ ... type: '<x>' ... })` patterns.
//   3. Diff: every type used must be registered. Bonus: warn on registered
//      types with no caller (potentially dead).
//
// Run via `npm run check:notifications` (added by Phase 2.6).

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'lib', 'notifications', 'events.ts');

const SCAN_DIRS = ['app', 'lib'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'generated', 'notifications']);
// SKIP "lib/notifications" since the registry itself contains all type literals
// (we'd self-match every registered event).

function readRegisteredTypes() {
  const src = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const matches = [...src.matchAll(/\btype:\s*'([a-z][a-z0-9_]*)'/g)];
  return new Set(matches.map((m) => m[1]));
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)) yield full;
  }
}

function findNotifyCalls(file, registered) {
  const src = fs.readFileSync(file, 'utf8');
  const calls = [];
  // Two-pass detection:
  //
  // Pass A — direct literal: `notify({ ... type: 'foo' ... })`. Catches
  // the common case where the type is hard-coded in the call.
  const directRe = /\bnotify\s*\(\s*\{[\s\S]*?\btype:\s*'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = directRe.exec(src)) !== null) {
    const before = src.slice(0, m.index);
    calls.push({
      file: path.relative(ROOT, file),
      line: before.split('\n').length,
      type: m[1],
    });
  }
  // Pass B — indirect literal: any registered event-type string literal
  // appearing in a file that imports `notify`. Catches the dispatcher
  // pattern where eventType is computed from a switch / ternary and
  // passed in via variable. Skip the registry itself (handled in main()).
  // The TS type system already guards against typos in the variable
  // assignment, but we still want the gate to confirm the literal lives
  // in this file so a refactor that drops the call site is caught.
  const importsNotify = /\bimport\b[^;]*\bnotify\b[^;]*from\s+['"][^'"]*notifications\/service['"]/.test(src);
  if (importsNotify) {
    for (const t of registered) {
      // Word-boundary-ish: surround with quotes so we only match string literals.
      const lit = new RegExp(`['"]${t}['"]`, 'g');
      let m2;
      while ((m2 = lit.exec(src)) !== null) {
        const before = src.slice(0, m2.index);
        const line = before.split('\n').length;
        // Don't double-count if Pass A already saw this exact (file, line, type).
        if (calls.some((c) => c.file === path.relative(ROOT, file) && c.line === line && c.type === t)) continue;
        calls.push({
          file: path.relative(ROOT, file),
          line,
          type: t,
        });
      }
    }
  }
  return calls;
}

function main() {
  const registered = readRegisteredTypes();
  const allCalls = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      // Skip the registry itself + anything under lib/notifications.
      if (file.includes(path.sep + 'notifications' + path.sep)) continue;
      allCalls.push(...findNotifyCalls(file, registered));
    }
  }

  const violations = [];
  const usedTypes = new Set();
  for (const c of allCalls) {
    usedTypes.add(c.type);
    if (!registered.has(c.type)) {
      violations.push(`${c.file}:${c.line} → notify({ type: '${c.type}' }) — not in NOTIFICATION_EVENTS`);
    }
  }
  const dead = [...registered].filter((t) => !usedTypes.has(t));

  console.log(`Registered events: ${registered.size}`);
  console.log(`Call sites:        ${allCalls.length}`);
  console.log(`Violations:        ${violations.length}`);
  console.log(`Unreferenced:      ${dead.length}`);

  if (violations.length > 0) {
    console.error('\n✗ Notification-coverage violations:\n');
    for (const v of violations) console.error('  ' + v);
    console.error(
      '\nFix: register the event in lib/notifications/events.ts (with sane defaults + label/description) ' +
      'or correct the type string at the call site.',
    );
    process.exit(1);
  }

  if (dead.length > 0) {
    console.log('\n⚠ Registered events with no call site (informational, not a failure):');
    for (const t of dead) console.log('  - ' + t);
    console.log('  These either represent planned events or stale registry rows.');
  }

  console.log('\n✓ Notification-coverage gate passes.');
}

main();
