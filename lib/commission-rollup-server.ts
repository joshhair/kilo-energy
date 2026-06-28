/**
 * commission-rollup-server.ts — server-side per-project financial rollup.
 *
 * Computes the admin/internal-PM Total / Rep / Kilo-Margin rollup (in integer
 * cents) plus the projected trainer legs for ONE project, reusing the SAME
 * shared building blocks the client view-model uses:
 *   - resolveProjectViewBaselines  (lib/baseline-resolve.ts)  → kiloPerW
 *   - computeProjectedTrainerLegs   (lib/trainer-projection.ts) → trainer legs
 *   - computeProjectRollup          (lib/commission-rollup.ts)  → gross/margin
 *
 * Because it calls the identical functions on the identical inputs, the result
 * reconciles to the cent with deriveProjectCommissionView (the desktop derive).
 * The cents + the id-based legs are all that ever leave this layer; the route
 * gates them to admin + internal PM and hydrates trainer/trainee names.
 *
 * Amounts in are DOLLARS (the same values the client uses), so the rounding
 * matches exactly. Callers pass the REAL (unstripped) amounts — the rollup is
 * an authoritative server figure, independent of per-viewer financial scrubs.
 */
import type { InstallerBaseline } from './data';
import type { TrainerResolverAssignment, TrainerResolverPayrollEntry } from './commission';
import { resolveProjectViewBaselines, type ViewBaselineData } from './baseline-resolve';
import { computeProjectedTrainerLegs, type ProjectedTrainerLeg } from './trainer-projection';
import { computeProjectRollup, type ProjectRollup } from './commission-rollup';

/** A co-party (additional closer/setter) as the rollup needs it. */
export interface RollupCoParty {
  userId: string;
  userName?: string;
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
}

/** Everything the server rollup reads for one project. Amounts are DOLLARS. */
export interface RollupProjectInput {
  id: string;
  // ── baseline-ladder inputs ──
  installer: string;
  solarTechProductId?: string | null;
  installerProductId?: string | null;
  soldDate: string;
  baselineOverride?: InstallerBaseline | null;
  netPPW: number;
  kWSize: number;
  // ── parties (for trainer projection + the rep total) ──
  closerId: string; // the closer's user id (= repId for trainer projection)
  setterId: string | null;
  trainerId: string | null;
  trainerRate: number | null;
  /** Admin "remove all chain trainers" flag — suppresses projected chain legs. */
  noChainTrainer?: boolean;
  // ── stored milestone amounts (dollars) ──
  //
  // m2Amount / setterM2Amount are OPTIONAL on purpose: they double as the
  // multi-party SHARE weights fed to computeProjectedTrainerLegs, where an
  // ABSENT value means "full share" (the `?? 1` sentinel inside the
  // projection), NOT zero. Callers must pass the raw Project value through —
  // coalescing an absent value to 0 would silently zero a trainer leg's share
  // and drop it (overstating Kilo margin). For the rep-total SUMS below we
  // coalesce to 0 separately, matching deriveProjectCommissionView.
  m1Amount: number;
  m2Amount?: number;
  m3Amount: number | null;
  setterM1Amount: number;
  setterM2Amount?: number;
  setterM3Amount: number | null;
  additionalClosers: RollupCoParty[];
  additionalSetters: RollupCoParty[];
}

/** Reference datasets + resolver dependencies the rollup needs. */
export interface RollupDeps extends ViewBaselineData {
  trainerAssignments: readonly TrainerResolverAssignment[];
  payrollEntries: readonly TrainerResolverPayrollEntry[];
}

export interface ProjectRollupServerResult extends ProjectRollup {
  /** Projected trainer legs (id-based; the route hydrates names for the wire). */
  trainerLegs: ProjectedTrainerLeg[];
}

/**
 * Compute the rollup cents + projected trainer legs for one project. Mirrors
 * deriveProjectCommissionView():83-137 exactly (same resolvers, same sums,
 * same rounding) so server and client agree to the cent.
 */
export function computeProjectRollupServer(
  p: RollupProjectInput,
  deps: RollupDeps,
): ProjectRollupServerResult {
  const baselines = resolveProjectViewBaselines(p, deps);

  const trainerLegs = computeProjectedTrainerLegs(
    {
      id: p.id,
      trainerId: p.trainerId,
      trainerRate: p.trainerRate,
      repId: p.closerId,
      setterId: p.setterId,
      kWSize: p.kWSize ?? 0,
      noChainTrainer: p.noChainTrainer,
      m2Amount: p.m2Amount,
      setterM2Amount: p.setterM2Amount,
      additionalClosers: p.additionalClosers.map((c) => ({ userId: c.userId, userName: c.userName ?? '', m2Amount: c.m2Amount ?? 0 })),
      additionalSetters: p.additionalSetters.map((s) => ({ userId: s.userId, userName: s.userName ?? '', m2Amount: s.m2Amount ?? 0 })),
    },
    deps.trainerAssignments,
    deps.payrollEntries,
  );
  const trainerTotalExpected = trainerLegs.reduce((s, l) => s + l.amount, 0);

  const closerTotalExpected = (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
  const setterTotalExpected = p.setterId
    ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0)
    : 0;
  const coCloserTotal = p.additionalClosers.reduce((s, c) => s + (c.m1Amount ?? 0) + (c.m2Amount ?? 0) + (c.m3Amount ?? 0), 0);
  const coSetterTotal = p.additionalSetters.reduce((s, c) => s + (c.m1Amount ?? 0) + (c.m2Amount ?? 0) + (c.m3Amount ?? 0), 0);

  const rollup = computeProjectRollup({
    netPPW: p.netPPW,
    kWSize: p.kWSize,
    kiloPerW: baselines.kiloPerW,
    closerTotalExpected,
    setterTotalExpected,
    coCloserTotal,
    coSetterTotal,
    trainerTotalExpected,
  });

  return { ...rollup, trainerLegs };
}
