import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Database drivers must not be bundled. better-sqlite3 is a native addon
  // that cannot be traced, and pg/mysql2 both resolve optional dependencies at
  // runtime — bundling them produces build warnings and broken requires.
  serverExternalPackages: ["better-sqlite3", "pg", "mysql2"],
  // The login page reads login_msg.md at request time. Nothing imports it, so
  // tracing cannot find it — name it explicitly or standalone/serverless
  // builds ship without the welcome message.
  outputFileTracingIncludes: {
    "/login": ["./login_msg.md"],
  },
};

export default nextConfig;
