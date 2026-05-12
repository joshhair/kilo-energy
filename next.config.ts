import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Legacy /dashboard/vault → /dashboard/my-pay rename (kept permanent
      // for any old bookmarks, links, or external references).
      {
        source: "/dashboard/vault",
        destination: "/dashboard/my-pay",
        permanent: true,
      },
      {
        source: "/dashboard/vault/:path*",
        destination: "/dashboard/my-pay/:path*",
        permanent: true,
      },
      // /dashboard/reps → /dashboard/users rename. The Reps page has been
      // promoted to a unified Users directory that covers reps, sub-dealers,
      // project managers, and admins. Keep these redirects permanently so
      // old bookmarks, external links, and in-flight sessions keep working.
      {
        source: "/dashboard/reps",
        destination: "/dashboard/users",
        permanent: true,
      },
      {
        source: "/dashboard/reps/:path*",
        destination: "/dashboard/users/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    // Baseline security headers applied site-wide. CSP is deliberately broad
    // because Clerk injects inline scripts/styles and next/turbopack dev
    // serves from blob:/data: URIs. Tighten per-route if we ever move off
    // Clerk or add a CSP nonce flow.
    const securityHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Force dashboard HTML to always revalidate. Without this, Safari
      // on iOS can serve a cached HTML document that references an old
      // CSS hash for hours, so new layout/typography changes never land.
      // Static CSS/JS bundles stay long-cached (content-hashed filenames).
      {
        source: "/dashboard/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        source: "/dashboard",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

// Wrap with Sentry's withSentryConfig so the build pipeline uploads
// source maps to Sentry. Without this, every error in prod lands in
// Sentry with a minified stack trace (chunk-abc123.js:1:4567) instead
// of the original file:line — making triage nearly impossible.
//
// Critical safety options:
//   - `widenClientFileUpload: true` — captures more chunks for better coverage
//   - `sourcemaps.deleteSourcemapsAfterUpload: true` — uploads source maps
//     to Sentry and then DELETES them from the public build output, so
//     they can NEVER be fetched from the production CDN. Sentry-internal
//     use only. (Default in v10 but pinned explicitly for review clarity.)
//   - `disableLogger: true` — removes Sentry's own logger calls in client
//     bundles to keep the wire payload lean.
//   - `telemetry: false` — opt out of Sentry's plugin telemetry.
//
// When SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT are not set (local
// dev, preview without secrets), withSentryConfig gracefully no-ops the
// upload — the build still completes, errors still capture at runtime,
// only source-map upload is skipped.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  disableLogger: true,
  telemetry: false,
});
