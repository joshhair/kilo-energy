/**
 * data-rollup.ts — builds the admin/internal-PM per-project margin rollup +
 * projected trainer legs for GET /api/data, extracted from the route handler
 * so it's unit-testable and keeps the route under the file-size ceiling.
 *
 * Resolves kiloPerW from RAW pricing data (kiloPerW intact, independent of the
 * viewer's tier-visibility scrub) and computes via computeProjectRollupServer,
 * which reconciles to the client's deriveProjectCommissionView to the cent.
 * Returns ONLY integer cents + name-hydrated trainer legs; the rate never
 * leaves this layer.
 *
 * Per-project try/catch is load-bearing: the baseline resolvers THROW on a
 * deactivated product / out-of-tier kW / future-dated-only pricing version. A
 * single bad deal must NOT 500 the whole /api/data hydration — it's skipped and
 * logged, and that project simply has no rollup fields.
 */
import { toDollars, fromCents } from './money';
import { logger } from './logger';
import { computeProjectRollupServer, type RollupProjectInput, type RollupDeps } from './commission-rollup-server';
import { buildKiloPricingArrays, type RawInstallerPV, type RawProduct, type RawProductPV } from './kilo-pricing-arrays';

// Structural subsets of the prisma rows /api/data already loads.
interface RawCoParty { userId: string; user: { firstName: string; lastName: string }; m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null; }
export interface RawRollupProject {
  id: string; installer: { name: string }; productId: string | null;
  soldDate: string; baselineOverrideJson: string | null; netPPW: number; kWSize: number;
  closerId: string; setterId: string | null; trainerId: string | null; trainerRate: number | null; noChainTrainer: boolean;
  m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null;
  setterM1AmountCents: number; setterM2AmountCents: number; setterM3AmountCents: number | null;
  additionalClosers: RawCoParty[]; additionalSetters: RawCoParty[];
}
interface RawUser { id: string; firstName: string; lastName: string; }

export interface ProjectRollupWire {
  totalCommissionGrossCents: number;
  kiloMarginCents: number;
  trainerLegs: Array<{ trainerName: string; traineeName: string; traineeRole: 'closer' | 'setter'; projectedPayoutCents: number }>;
}

export interface BuildProjectRollupsArgs {
  projects: RawRollupProject[];
  installerPricingVersions: RawInstallerPV[];
  products: RawProduct[];
  productPricingVersions: RawProductPV[];
  trainerAssignments: RollupDeps['trainerAssignments'];
  /** FULL payroll (not viewer-scoped) — needed for accurate trainer-tier resolution. */
  payrollEntries: RollupDeps['payrollEntries'];
  instIdToName: Record<string, string>;
  solarTechInstallerId: string | undefined;
  users: RawUser[];
  /** Current time for active-pricing-version selection (caller passes one `new Date()`). */
  now: Date;
}

/** Build per-project rollup cents + trainer legs, keyed by project id. */
export function buildProjectRollups(args: BuildProjectRollupsArgs): Map<string, ProjectRollupWire> {
  const { projects, installerPricingVersions, products, productPricingVersions,
    trainerAssignments, payrollEntries, instIdToName, solarTechInstallerId, users, now } = args;

  // kiloPerW-included baseline arrays (shared builder — also used by the blitz
  // profitability endpoints). What we SEND the client is scrubbed elsewhere;
  // this data only feeds the server-side compute that emits cents.
  const pricing = buildKiloPricingArrays({ installerPricingVersions, products, productPricingVersions, instIdToName, solarTechInstallerId, now });

  const deps = {
    solarTechProducts: pricing.solarTechProducts, productCatalogProducts: pricing.productCatalogProducts,
    productCatalogPricingVersions: pricing.productCatalogPricingVersions, installerPricingVersions: pricing.installerPricingVersions,
    trainerAssignments, payrollEntries,
  } as unknown as RollupDeps;

  const nameOf = (id: string | null | undefined): string => {
    if (!id) return '';
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : '';
  };

  const out = new Map<string, ProjectRollupWire>();
  for (const p of projects) {
    try {
      let bo: unknown = null;
      if (p.baselineOverrideJson) { try { bo = JSON.parse(p.baselineOverrideJson); } catch { bo = null; } }
      const coMap = (arr: RawCoParty[]) => arr.map((c) => ({
        userId: c.userId, userName: `${c.user.firstName} ${c.user.lastName}`,
        m1Amount: toDollars(fromCents(c.m1AmountCents)), m2Amount: toDollars(fromCents(c.m2AmountCents)),
        m3Amount: c.m3AmountCents == null ? null : toDollars(fromCents(c.m3AmountCents)),
      }));
      const input: RollupProjectInput = {
        id: p.id, installer: p.installer.name,
        solarTechProductId: p.installer.name === 'SolarTech' ? (p.productId ?? null) : null,
        installerProductId: p.installer.name !== 'SolarTech' ? (p.productId ?? null) : null,
        soldDate: p.soldDate, baselineOverride: bo as RollupProjectInput['baselineOverride'],
        netPPW: p.netPPW, kWSize: p.kWSize, closerId: p.closerId, setterId: p.setterId ?? null,
        trainerId: p.trainerId ?? null, trainerRate: p.trainerRate ?? null, noChainTrainer: p.noChainTrainer,
        m1Amount: toDollars(fromCents(p.m1AmountCents)), m2Amount: toDollars(fromCents(p.m2AmountCents)),
        m3Amount: p.m3AmountCents == null ? null : toDollars(fromCents(p.m3AmountCents)),
        setterM1Amount: toDollars(fromCents(p.setterM1AmountCents)), setterM2Amount: toDollars(fromCents(p.setterM2AmountCents)),
        setterM3Amount: p.setterM3AmountCents == null ? null : toDollars(fromCents(p.setterM3AmountCents)),
        additionalClosers: coMap(p.additionalClosers), additionalSetters: coMap(p.additionalSetters),
      };
      const r = computeProjectRollupServer(input, deps);
      out.set(p.id, {
        totalCommissionGrossCents: r.totalCommissionGrossCents,
        kiloMarginCents: r.kiloMarginCents,
        trainerLegs: r.trainerLegs.map((l) => ({
          trainerName: nameOf(l.trainerId),
          traineeName: (l.trainees && l.trainees.length)
            ? l.trainees.map((t) => t.name || nameOf(t.userId)).filter(Boolean).join(', ')
            : nameOf(l.leg === 'closer-trainer' ? p.closerId : p.setterId),
          traineeRole: l.leg === 'closer-trainer' ? 'closer' : 'setter',
          projectedPayoutCents: Math.round(l.amount * 100),
        })),
      });
    } catch (err) {
      // One bad deal (deactivated product / out-of-tier kW / future-only version)
      // must not 500 the whole hydration — skip it, leave its rollup absent.
      logger.warn('rollup_compute_skipped', { projectId: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Aggregate signal: a per-deal skip is routine, but EVERY deal failing means a
  // systemic bug (bad deps shape, broken resolver) silently returning 200 with
  // no rollups. Surface that at error level so it can't hide behind warn noise.
  if (projects.length > 0 && out.size === 0) {
    logger.error('rollup_all_projects_failed', { projectCount: projects.length });
  }
  return out;
}
