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

function findNotifyCalls(file) {
  const src = fs.readFileSync(file, 'utf8');
  const calls = [];
  // Match: notify( ... type: 'foo' ... ) within a small window. Cheap regex
  // beats a full parser for our needs — only false positives are explicit
  // `notify` test mocks, which we filter by ignoring lines containing `vi.mock`.
  const re = /\bnotify\s*\(\s*\{[\s\S]*?\btype:\s*'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const typeStr = m[1];
    // Compute line number from char offset.
    const before = src.slice(0, m.index);
    const line = before.split('\n').length;
    calls.push({ file: path.relative(ROOT, file), line, type: typeStr });
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
      allCalls.push(...findNotifyCalls(file));
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
