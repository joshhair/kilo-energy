#!/usr/bin/env node
/**
 * One-shot: bump mobile page bottom padding from pb-24 (96px) to pb-28
 * (112px). The FAB on BottomNav extends -mt-4 above the nav, eating
 * ~16px of the page's pb-24 buffer — at the bottom of long lists, the
 * last card's edge gets clipped behind the FAB. pb-28 restores
 * breathing room without making short pages look bottom-heavy.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync(
  `grep -rlE "px-5 pt-4 pb-24" --include='*.tsx' app/dashboard/mobile/`,
  { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

let totalSwaps = 0;
for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const matches = original.match(/px-5 pt-4 pb-24/g) || [];
  if (matches.length === 0) continue;
  const updated = original.replace(/px-5 pt-4 pb-24/g, 'px-5 pt-4 pb-28');
  writeFileSync(file, updated);
  console.log(`  ${matches.length}× ${file}`);
  totalSwaps += matches.length;
}
console.log(`\n${totalSwaps} swaps across ${files.length} files`);
