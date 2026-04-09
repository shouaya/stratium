import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: false,
  transpilePackages: [
    "@stratium/shared"
  ],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/trade",
        permanent: false
      },
      {
        source: "/admin",
        destination: "/admin/dashboard",
        permanent: false
      }
    ];
  }
};

export default nextConfig;
