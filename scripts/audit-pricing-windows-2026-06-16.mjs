// audit-pricing-windows-2026-06-16.mjs — Phase 3 A1, READ-ONLY.
//
// Audits every product's ProductPricingVersion timeline for integrity problems
// that would make the planned DB constraints — UNIQUE(productId, effectiveFrom)
// and one-open-version-per-product — fail to apply, or that indicate latent
// data corruption from the keystroke-version explosion / past edits:
//
//   - duplicate effectiveFrom within a product (blocks the UNIQUE index)
//   - more than one open version (effectiveTo IS NULL) per product
//   - overlapping windows (a window starts on/before the previous one ends)
//   - zero/negative-width closed windows (effectiveTo < effectiveFrom)
//   - (informational) gaps between consecutive windows
//
// NO WRITES. Safe to run against prod for diagnostics. Must come back clean
// (zero blocking issues) before the migration that adds the constraints.
//
//   node scripts/audit-pricing-windows-2026-06-16.mjs
//   node scripts/audit-pricing-windows-2026-06-16.mjs --json   # machine-readable

import { createClient } from '@libsql/client';
import 'dotenv/config';

const AS_JSON = process.argv.includes('--json');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) { console.error('TURSO_DATABASE_URL not set.'); process.exit(1); }
const remote = !url.startsWith('file:');
const db = createClient({ url, authToken });
const day = (v) => (v == null ? null : String(v).slice(0, 10));

const rows = (await db.execute(`
  SELECT v.id, v.productId, v.effectiveFrom, v.effectiveTo, v.label,
         p.name AS productName, p.family AS family, p.active AS productActive,
         i.name AS installer
  FROM ProductPricingVersion v
  JOIN Product p ON p.id = v.productId
  LEFT JOIN Installer i ON i.id = p.installerId
`)).rows;

const byProduct = new Map();
for (const r of rows) {
  const list = byProduct.get(r.productId) ?? [];
  list.push({
    id: r.id,
    effectiveFrom: day(r.effectiveFrom),
    effectiveTo: day(r.effectiveTo),
    label: r.label,
    productName: r.productName,
    family: r.family,
    installer: r.installer,
    productActive: Number(r.productActive),
  });
  byProduct.set(r.productId, list);
}

const blocking = []; // issues that would break the constraints or are corruption
const info = [];      // gaps — not necessarily wrong

for (const [productId, versionsRaw] of byProduct.entries()) {
  const versions = [...versionsRaw].sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
  const head = versions[0];
  const tag = `${head.installer ?? '—'} / ${head.family ?? '—'} / ${head.productName ?? productId}${head.productActive ? '' : ' (archived)'}`;

  // Duplicate effectiveFrom.
  const seen = new Map();
  for (const v of versions) {
    const k = v.effectiveFrom;
    if (seen.has(k)) blocking.push({ productId, tag, kind: 'duplicate_effectiveFrom', detail: `${k} appears on versions ${seen.get(k)} and ${v.id}` });
    else seen.set(k, v.id);
  }

  // Multiple open versions.
  const open = versions.filter((v) => v.effectiveTo === null);
  if (open.length > 1) blocking.push({ productId, tag, kind: 'multiple_open_versions', detail: `${open.length} open: ${open.map((v) => `${v.id}@${v.effectiveFrom}`).join(', ')}` });

  // Zero/negative-width closed windows + overlaps + gaps.
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    if (v.effectiveTo !== null && v.effectiveTo < v.effectiveFrom) {
      blocking.push({ productId, tag, kind: 'inverted_window', detail: `${v.id}: effectiveTo ${v.effectiveTo} < effectiveFrom ${v.effectiveFrom}` });
    }
    if (i > 0) {
      const prev = versions[i - 1];
      const prevEnd = prev.effectiveTo ?? '9999-12-31';
      if (v.effectiveFrom <= prevEnd) {
        blocking.push({ productId, tag, kind: 'overlap', detail: `${v.id}@${v.effectiveFrom} overlaps prior ${prev.id} ending ${prevEnd}` });
      } else if (prev.effectiveTo !== null) {
        // Gap: prevEnd day-before should equal this start - 1; report any non-adjacency.
        const expectAdjacent = new Date(`${prev.effectiveTo}T00:00:00Z`);
        expectAdjacent.setUTCDate(expectAdjacent.getUTCDate() + 1);
        const adj = expectAdjacent.toISOString().slice(0, 10);
        if (v.effectiveFrom !== adj) info.push({ productId, tag, kind: 'gap', detail: `${prev.effectiveTo} → ${v.effectiveFrom} (not contiguous)` });
      }
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ remote, productCount: byProduct.size, versionCount: rows.length, blocking, info }, null, 1));
  process.exit(0);
}

console.log(`\n══ Pricing-window integrity audit (READ-ONLY${remote ? ', PROD' : ', LOCAL'}) ══`);
console.log(`  products ${byProduct.size} · versions ${rows.length}`);
console.log(`  blocking issues: ${blocking.length} · informational gaps: ${info.length}\n`);
for (const b of blocking) console.log(`  ✗ [${b.kind}] ${b.tag}\n      ${b.detail}`);
if (info.length) { console.log(''); for (const g of info.slice(0, 40)) console.log(`  · [gap] ${g.tag}: ${g.detail}`); if (info.length > 40) console.log(`  · …and ${info.length - 40} more gaps`); }
console.log(blocking.length === 0
  ? '\n✓ No blocking issues — the UNIQUE(productId, effectiveFrom) + one-open-version constraints can be applied safely.'
  : `\n✗ ${blocking.length} blocking issue(s) — resolve before adding constraints.`);
process.exit(0);
