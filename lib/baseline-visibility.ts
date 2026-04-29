/**
 * baseline-visibility.ts — single source of truth for who can see what
 * pricing data.
 *
 * Pricing fields land in three sensitivity tiers:
 *
 *   tier-1 / public-to-rep:    closerPerW, setterPerW
 *     Reps need to forecast their own commission. Visible to everyone
 *     who sees a deal's product.
 *
 *   tier-2 / sub-dealer-visible: kiloPerW (on baseline tiers)
 *     Sub-dealers buy product through Kilo and need to see what Kilo
 *     pays the installer (their cost ceiling). Admins also see this.
 *     Reps / trainers / vendor PMs do NOT see kiloPerW on baseline
 *     tiers.
 *
 *   tier-3 / admin-only:        kiloPerW on per-project baselineOverride
 *                              + subDealerPerW on baseline tiers
 *     Per-project overrides reveal margin negotiations on a specific
 *     deal — admins only. subDealerPerW reveals what Kilo pays
 *     sub-dealers per watt — admins only.
 *
 * Routing every "should this field appear in this viewer's payload?"
 * decision through these helpers means a future field-add can't
 * accidentally get the visibility tier wrong: the call site asks
 * `canViewKiloOnBaselineTier(viewer)` rather than re-deriving the
 * `isAdmin || isSubDealer` boolean inline. Test coverage for this
 * file is the privacy contract.
 */

export interface BaselineViewer {
  /** 'admin' | 'rep' | 'sub-dealer' | 'project_manager' | 'trainer' */
  role: string;
  /** True iff role === 'project_manager' AND scopedInstallerId !== null.
   *  Vendor PMs are scoped to one installer and should not see pricing
   *  from any other installer; for the installer they ARE scoped to,
   *  they still don't get kilo cost (that's commercially sensitive). */
  isVendorPM?: boolean;
}

/**
 * kiloPerW on a baseline tier (InstallerPricingTier or
 * ProductPricingTier). Visible to admins and sub-dealers.
 *
 * Rationale: sub-dealers need cost visibility for their pricing model
 * (they pay Kilo, then mark up to their reps). Reps / trainers /
 * vendor PMs / project managers do NOT need kilo cost — exposing it
 * leaks margin.
 */
export function canViewKiloOnBaselineTier(viewer: BaselineViewer): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'sub-dealer') return true;
  return false;
}

/**
 * kiloPerW on a per-project `baselineOverride` JSON field. Admins only.
 *
 * Rationale: a per-project override means the deal's pricing was
 * specifically negotiated; that's commercially sensitive for everyone
 * except the admin who set it. Even sub-dealers don't see this — it's
 * specific to the deal owner's relationship with Kilo, not the
 * sub-dealer's.
 */
export function canViewKiloOnProjectOverride(viewer: BaselineViewer): boolean {
  return viewer.role === 'admin';
}

/**
 * subDealerPerW on a baseline tier. Admins only.
 *
 * Rationale: this field is "what Kilo pays a sub-dealer per watt" —
 * the sub-dealer's compensation rate. Even sub-dealers themselves
 * don't see this on baseline tiers (they see their own contract,
 * which is admin-administered separately). Reps / trainers / PMs
 * never see it.
 */
export function canViewSubDealerRateOnTier(viewer: BaselineViewer): boolean {
  return viewer.role === 'admin';
}
