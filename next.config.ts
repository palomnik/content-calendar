import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "export" is added by deploy.sh during production builds
  // For dev mode (npx next dev), keep this commented out to allow API routes
  // output: "export",
  // distDir: "www",
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
