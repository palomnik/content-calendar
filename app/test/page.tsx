import { notFound } from "next/navigation";
import Board from "../Board";
import { isTestModeEnabled } from "../lib/testMode";

/**
 * Test mode: the same board, backed by this browser tab instead of the
 * database. Reachable without signing in, and only when ENABLE_TEST_MODE is
 * set — see app/lib/testMode.ts for why it is off by default.
 */
// Read the flag per request, not at build time. Next would otherwise
// prerender this page during `next build` and bake in whichever answer the
// build environment gave — so a host that sets ENABLE_TEST_MODE at runtime
// (Coolify, Docker, Vercel env vars) would be ignored.
export const dynamic = "force-dynamic";

export default function TestPage() {
  if (!isTestModeEnabled()) notFound();
  return <Board testMode />;
}
