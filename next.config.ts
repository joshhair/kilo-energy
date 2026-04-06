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
    ];
  },
};

export default nextConfig;
