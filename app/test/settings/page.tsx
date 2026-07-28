import { notFound } from "next/navigation";
import { isTestModeEnabled } from "../../lib/testMode";
import TestSettings from "./TestSettings";

// Read the flag per request, not at build time. Next would otherwise
// prerender this page during `next build` and bake in whichever answer the
// build environment gave — so a host that sets ENABLE_TEST_MODE at runtime
// (Coolify, Docker, Vercel env vars) would be ignored.
export const dynamic = "force-dynamic";

export default function TestSettingsPage() {
  if (!isTestModeEnabled()) notFound();
  return <TestSettings />;
}
