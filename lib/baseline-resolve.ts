/**
 * baseline-resolve.ts — the shared "view" baseline-resolution ladder.
 *
 * Resolves a project's baseline rates (closer/setter/Kilo $/W) for DISPLAY,
 * in the exact precedence the project-detail breakdown uses:
 *   1. per-project admin override (baselineOverride) wins
 *   2. SolarTech archived product-per-deal (falls THROUGH on lookup failure —
 *      e.g. a deactivated product — to the installer ladder, NOT to zeros)
 *   3. Product-Catalog installers (versioned by sold date)
 *   4. standard installer rates (versioned by sold date)
 *
 * Extracted VERBATIM from deriveProjectCommissionView (commission-derived.ts)
 * so the server read-path (/api/data) resolves the rate through the SAME
 * ladder the client renders from — including the deactivated-SolarTech
 * fall-through. Without this, the server's recompute resolver
 * (commission-server.ts resolveBaselines) returns zeros on that failure while
 * the client falls through, silently diverging the displayed Kilo margin.
 *
 * No return type is annotated on purpose: the inferred union exactly matches
 * the original inline IIFE, so this is a behavior-preserving move for every
 * existing caller.
 */
import {
  getSolarTechBaseline,
  getProductCatalogBaselineVersioned,
  getInstallerRatesForDeal,
  type InstallerBaseline,
  type SolarTechProduct,
  type ProductCatalogProduct,
  type ProductCatalogPricingVersion,
  type InstallerPricingVersion,
} from './data';

/** The project fields the view ladder reads. */
export interface ViewBaselineProject {
  installer: string;
  solarTechProductId?: string | null;
  installerProductId?: string | null;
  kWSize: number;
  soldDate: string;
  baselineOverride?: InstallerBaseline | null;
}

/** The reference datasets the ladder resolves against (all already loaded by callers). */
export interface ViewBaselineData {
  solarTechProducts: SolarTechProduct[];
  productCatalogProducts: ProductCatalogProduct[];
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  installerPricingVersions: InstallerPricingVersion[];
}

export function resolveProjectViewBaselines(project: ViewBaselineProject, data: ViewBaselineData) {
  if (project.baselineOverride) return project.baselineOverride;
  if (project.installer === 'SolarTech' && project.solarTechProductId) {
    try {
      return getSolarTechBaseline(project.solarTechProductId, project.kWSize, data.solarTechProducts);
    } catch {
      // Product deactivated — fall through to generic installer rates.
    }
  }
  if (project.installerProductId) {
    return getProductCatalogBaselineVersioned(
      data.productCatalogProducts,
      project.installerProductId,
      project.kWSize,
      project.soldDate,
      data.productCatalogPricingVersions,
    );
  }
  return getInstallerRatesForDeal(project.installer, project.soldDate, project.kWSize, data.installerPricingVersions);
}
