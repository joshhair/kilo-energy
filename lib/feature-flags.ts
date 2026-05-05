/**
 * Feature flags — env-var-driven boolean toggles.
 *
 * Used to gate in-flight features behind a flip in production env vars.
 * Default-OFF for any new feature so a half-built flow can ship to main
 * without surfacing in production. Flip ON in Vercel env when ready.
 *
 * Server-side only. For client-side consumption, expose via an API
 * endpoint that returns the relevant flags after a role check, OR
 * compile-bake at render time. Don't ship unevaluated env vars to the
 * client.
 */

/**
 * Coerces an env-var string to a boolean. "1" / "true" / "yes" → true,
 * everything else → false. Whitespace tolerated.
 */
function envBool(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * BVI installer-handoff feature. When false, the conditional BVI panel
 * does not appear on the new-deal form, and BVI handoff endpoints
 * default-deny. Flipped on per-environment after Phase 9 verification.
 */
export function isBviFeatureEnabled(): boolean {
  return envBool('BVI_FEATURE_ENABLED', false);
}

/**
 * Stalled-project digest. When false, the digest cron is a no-op. Lets
 * us deploy the cron route + scheduler in advance, then flip on after
 * thresholds are dialed in via the Customization page.
 */
export function isStalledDigestEnabled(): boolean {
  return envBool('STALLED_DIGEST_ENABLED', false);
}
