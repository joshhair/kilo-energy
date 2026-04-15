import type { NextConfig } from "next";

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

export default nextConfig;
