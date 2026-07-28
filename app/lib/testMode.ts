// Whether the database-free trial mode is available on this deployment.
//
// ON unless explicitly switched off, so a deploy straight from the repo — with
// no environment variables set anywhere — has the trial button on its login
// screen. Set ENABLE_TEST_MODE=false to turn it off on a given host.
//
// Know what that default buys: test mode is reachable without signing in, and
// although it can neither read nor write the database, it does let an anonymous
// visitor make the server issue outbound requests to a model provider they
// nominate. On a private instance that is a convenience; on a public one it is
// an open endpoint, so a public deployment should set ENABLE_TEST_MODE=false
// unless the trial is the point.
//
// Safe to import from the Edge runtime: it reads process.env and nothing else.

const DEFAULT_ENABLED = true;

const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSY = new Set(["0", "false", "no", "off", "disabled"]);

export function isTestModeEnabled(): boolean {
  const value = (process.env.ENABLE_TEST_MODE ?? "").trim().toLowerCase();
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  // Unset, or something we don't recognise — fall back to the default rather
  // than guessing at intent.
  return DEFAULT_ENABLED;
}

/** The response every test-mode route gives when the feature is switched off. */
export const TEST_MODE_DISABLED = {
  error:
    "Test mode is not enabled on this server. Unset ENABLE_TEST_MODE, or set it to true, to turn it on.",
} as const;
