// scripts/audit-reference-data.mjs
//
// Read-only health check for the reference data tables (Installers,
// Financers, pricing versions, product catalog, prepaid options). Prints
// a human-readable report AND writes a machine-readable snapshot to
// state/reference-audit.json so successive runs can be diffed.
//
// Why this exists: before bulk-importing Glide data, we need to know
// that every installer and financer referenced in that data has a
// corresponding row + correct pricing in Turso. This script surfaces
// gaps (installers with zero pricing versions, inactive financers with
// active projects, orphan pricing, etc.) so they can be fixed before
// the import event instead of blowing up the import transaction.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/audit-reference-data.mjs

import { createClient } from "@libsql/client";
import * as fs from "fs";
import * as path from "path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

function pad(s, n) { return String(s).padEnd(n); }
function padR(s, n) { return String(s).padStart(n); }

async function main() {
  const takenAt = new Date().toISOString();
  const findings = [];
  const report = { takenAt, installers: [], financers: [], productCatalog: [], summary: {}, findings };

  console.log("Reference data audit");
  console.log(`  ${takenAt}`);
  console.log();

  // ─── Installers ─────────────────────────────────────────────────────────
  const installers = (await client.execute("SELECT * FROM Installer ORDER BY name")).rows;
  const products = (await client.execute("SELECT id, installerId FROM Product WHERE active = 1")).rows;
  const productsByInstaller = new Map();
  for (const p of products) {
    if (!productsByInstaller.has(p.installerId)) productsByInstaller.set(p.installerId, 0);
    productsByInstaller.set(p.installerId, productsByInstaller.get(p.installerId) + 1);
  }
  const installerVersions = (await client.execute("SELECT id, installerId, effectiveTo FROM InstallerPricingVersion")).rows;
  const activeIVByInstaller = new Map();
  const totalIVByInstaller = new Map();
  for (const v of installerVersions) {
    totalIVByInstaller.set(v.installerId, (totalIVByInstaller.get(v.installerId) ?? 0) + 1);
    if (v.effectiveTo === null) {
      activeIVByInstaller.set(v.installerId, (activeIVByInstaller.get(v.installerId) ?? 0) + 1);
    }
  }
  const prepaidOptions = (await client.execute("SELECT id, installerId FROM InstallerPrepaidOption")).rows;
  const prepaidByInstaller = new Map();
  for (const p of prepaidOptions) {
    prepaidByInstaller.set(p.installerId, (prepaidByInstaller.get(p.installerId) ?? 0) + 1);
  }
  const projects = (await client.execute("SELECT id, installerId, financerId FROM Project")).rows;
  const projectsByInstaller = new Map();
  for (const p of projects) {
    projectsByInstaller.set(p.installerId, (projectsByInstaller.get(p.installerId) ?? 0) + 1);
  }

  console.log("INSTALLERS");
  console.log(`  ${pad("Name", 22)} ${pad("Active", 8)} ${pad("Model", 10)} ${padR("Products", 10)} ${padR("Versions", 10)} ${padR("ActiveV", 10)} ${padR("Prepaid", 10)} ${padR("Projects", 10)}`);
  console.log(`  ${"-".repeat(22)} ${"-".repeat(8)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`);
  for (const inst of installers) {
    const productCount = productsByInstaller.get(inst.id) ?? 0;
    const versionCount = totalIVByInstaller.get(inst.id) ?? 0;
    const activeVCount = activeIVByInstaller.get(inst.id) ?? 0;
    const prepaidCount = prepaidByInstaller.get(inst.id) ?? 0;
    const projectCount = projectsByInstaller.get(inst.id) ?? 0;
    const model = inst.usesProductCatalog ? "catalog" : "flat/tier";
    console.log(`  ${pad(inst.name, 22)} ${pad(inst.active ? "yes" : "NO", 8)} ${pad(model, 10)} ${padR(productCount, 10)} ${padR(versionCount, 10)} ${padR(activeVCount, 10)} ${padR(prepaidCount, 10)} ${padR(projectCount, 10)}`);

    report.installers.push({
      id: inst.id, name: inst.name, active: !!inst.active, usesProductCatalog: !!inst.usesProductCatalog,
      installPayPct: inst.installPayPct, productCount, versionCount, activeVCount, prepaidCount, projectCount,
    });

    // ─── Flag anomalies ───
    if (inst.active && inst.usesProductCatalog && productCount === 0) {
      findings.push({ severity: "critical", table: "Installer", id: inst.id, name: inst.name, issue: "Active product-catalog installer with ZERO products — new deals cannot be priced" });
    }
    if (inst.active && !inst.usesProductCatalog && versionCount === 0) {
      findings.push({ severity: "critical", table: "Installer", id: inst.id, name: inst.name, issue: "Active flat/tier installer with ZERO pricing versions — new deals cannot be priced" });
    }
    if (inst.active && !inst.usesProductCatalog && versionCount > 0 && activeVCount === 0) {
      findings.push({ severity: "high", table: "Installer", id: inst.id, name: inst.name, issue: `Has ${versionCount} pricing version(s) but none are active (effectiveTo=null) — new deals cannot resolve rates` });
    }
    if (!inst.active && projectCount > 0) {
      findings.push({ severity: "info", table: "Installer", id: inst.id, name: inst.name, issue: `Inactive but has ${projectCount} historical project(s) — OK, but cannot be used for new deals` });
    }
  }
  console.log();

  // ─── Financers ──────────────────────────────────────────────────────────
  const financers = (await client.execute("SELECT * FROM Financer ORDER BY name")).rows;
  const projectsByFinancer = new Map();
  for (const p of projects) {
    projectsByFinancer.set(p.financerId, (projectsByFinancer.get(p.financerId) ?? 0) + 1);
  }

  console.log("FINANCERS");
  console.log(`  ${pad("Name", 22)} ${pad("Active", 8)} ${padR("Projects", 10)}`);
  console.log(`  ${"-".repeat(22)} ${"-".repeat(8)} ${"-".repeat(10)}`);
  for (const f of financers) {
    const projectCount = projectsByFinancer.get(f.id) ?? 0;
    console.log(`  ${pad(f.name, 22)} ${pad(f.active ? "yes" : "NO", 8)} ${padR(projectCount, 10)}`);
    report.financers.push({ id: f.id, name: f.name, active: !!f.active, projectCount });
    if (!f.active && projectCount > 0) {
      findings.push({ severity: "info", table: "Financer", id: f.id, name: f.name, issue: `Inactive but has ${projectCount} historical project(s)` });
    }
  }
  console.log();

  // ─── Product Catalog Config ─────────────────────────────────────────────
  const configs = (await client.execute("SELECT * FROM ProductCatalogConfig")).rows;
  const installerById = new Map(installers.map((i) => [i.id, i]));

  console.log("PRODUCT CATALOG CONFIGS");
  if (configs.length === 0) {
    console.log("  (none)");
    const catalogInstallers = installers.filter((i) => i.active && i.usesProductCatalog);
    if (catalogInstallers.length > 0) {
      findings.push({
        severity: "high",
        table: "ProductCatalogConfig",
        id: null,
        name: null,
        issue: `Zero ProductCatalogConfig rows, but ${catalogInstallers.length} active installers have usesProductCatalog=true (${catalogInstallers.map((i) => i.name).join(", ")}). UI may fail to render family/financer dropdowns.`,
      });
    }
  } else {
    for (const cfg of configs) {
      const inst = installerById.get(cfg.installerId);
      const instName = inst?.name ?? `<orphan: ${cfg.installerId}>`;
      console.log(`  ${pad(instName, 22)} families=${cfg.families ?? "(none)"} prepaidFamily=${cfg.prepaidFamily ?? "(none)"}`);
      report.productCatalog.push({ installerId: cfg.installerId, installerName: instName, families: cfg.families, prepaidFamily: cfg.prepaidFamily });
      if (!inst) {
        findings.push({ severity: "critical", table: "ProductCatalogConfig", id: cfg.id, name: null, issue: `Orphan config — references non-existent installer ${cfg.installerId}` });
      }
    }
  }
  console.log();

  // ─── Summary ─────────────────────────────────────────────────────────────
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const info = findings.filter((f) => f.severity === "info").length;

  report.summary = {
    installerCount: installers.length,
    activeInstallers: installers.filter((i) => i.active).length,
    financerCount: financers.length,
    activeFinancers: financers.filter((f) => f.active).length,
    catalogConfigs: configs.length,
    productCount: products.length,
    installerVersionCount: installerVersions.length,
    prepaidOptionCount: prepaidOptions.length,
    findings: { critical, high, info, total: findings.length },
  };

  console.log("FINDINGS");
  if (findings.length === 0) {
    console.log("  None — reference data looks healthy.");
  } else {
    for (const f of findings) {
      const icon = f.severity === "critical" ? "✗" : f.severity === "high" ? "⚠" : "ℹ";
      const label = `[${f.severity.toUpperCase()}] ${f.table}${f.name ? ` "${f.name}"` : ""}`;
      console.log(`  ${icon} ${label}`);
      console.log(`    ${f.issue}`);
    }
  }
  console.log();

  console.log("SUMMARY");
  console.log(`  Installers: ${report.summary.installerCount} (${report.summary.activeInstallers} active)`);
  console.log(`  Financers:  ${report.summary.financerCount} (${report.summary.activeFinancers} active)`);
  console.log(`  Catalog configs: ${report.summary.catalogConfigs}`);
  console.log(`  Products:   ${report.summary.productCount}`);
  console.log(`  Installer pricing versions: ${report.summary.installerVersionCount}`);
  console.log(`  Prepaid options: ${report.summary.prepaidOptionCount}`);
  console.log(`  Findings:   ${report.summary.findings.critical} critical, ${report.summary.findings.high} high, ${report.summary.findings.info} info`);
  console.log();

  // ─── Write JSON artifact ─────────────────────────────────────────────────
  const outPath = path.resolve(process.cwd(), "state", "reference-audit.json");
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`  Artifact: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
