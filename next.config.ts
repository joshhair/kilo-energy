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
    return [
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
