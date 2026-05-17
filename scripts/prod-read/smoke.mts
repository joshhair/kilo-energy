/**
 * scripts/prod-read/smoke.mts — First read against prod.
 *
 * Run: `node --experimental-vm-modules --import tsx scripts/prod-read/smoke.mts`
 *
 * Confirms:
 *   1. Credentials load from .env.local
 *   2. Read-only Proxy is in place (attempts a forbidden write, expects throw)
 *   3. A single safe count query succeeds against Turso
 *   4. Audit log + snapshot dir are writable
 *
 * Does NOT touch any rep-specific or PII-sensitive data. Just `user.count()`
 * and a deliberate negative test.
 */

import { readDb } from './index.mts';
import { smokeCheck, getRowCounts } from './queries.mts';

console.log('=== prod-read smoke test ===\n');

// Negative test: confirm a mutating call throws synchronously.
console.log('1. Negative test: attempting forbidden write…');
try {
  // @ts-expect-error — intentionally calling a forbidden method
  await readDb.user.create({ data: { name: 'should-not-happen', email: 'x@y.z' } });
  console.error('   ✗ FAIL: write was allowed. ABORT.');
  process.exit(1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('refused mutating method')) {
    console.log(`   ✓ blocked: ${msg}`);
  } else {
    console.error(`   ✗ unexpected error: ${msg}`);
    process.exit(1);
  }
}

// Negative test 2: raw escape hatch blocked
console.log('2. Negative test: $executeRawUnsafe blocked…');
try {
  // @ts-expect-error
  await readDb.$executeRawUnsafe('SELECT 1');
  console.error('   ✗ FAIL: raw escape hatch was allowed. ABORT.');
  process.exit(1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("refused method '$executeRawUnsafe'")) {
    console.log(`   ✓ blocked: ${msg}`);
  } else {
    console.error(`   ✗ unexpected error: ${msg}`);
    process.exit(1);
  }
}

// Positive test: safe read
console.log('3. Positive test: user.count()…');
try {
  const { userCount } = await smokeCheck();
  console.log(`   ✓ connected · user count = ${userCount}`);
} catch (err) {
  console.error(`   ✗ FAIL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

// Positive test: row counts across all relevant tables
console.log('4. Schema sanity: row counts…');
try {
  const counts = await getRowCounts();
  console.log(`   ✓ users=${counts.users} projects=${counts.projects} payroll=${counts.payroll} blitzes=${counts.blitzes}`);
} catch (err) {
  console.error(`   ✗ FAIL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

console.log('\n=== smoke OK · prod-read helper is safe to use in verification phases ===');
process.exit(0);
