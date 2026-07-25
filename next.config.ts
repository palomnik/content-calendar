import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Database drivers must not be bundled. better-sqlite3 is a native addon
  // that cannot be traced, and pg/mysql2 both resolve optional dependencies at
  // runtime — bundling them produces build warnings and broken requires.
  serverExternalPackages: ["better-sqlite3", "pg", "mysql2"],
};

export default nextConfig;
