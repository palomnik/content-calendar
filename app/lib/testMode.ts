// Whether the database-free trial mode is available on this deployment.
//
// Off unless explicitly switched on. Test mode is reachable without signing in,
// and although it can neither read nor write the database, it does let an
// anonymous visitor make the server issue outbound requests to a model provider
// they nominate. On a private instance that is a convenience; on a public one it
// should be a deliberate choice, so the failure mode of forgetting to configure
// it is "no test mode" rather than "an open endpoint nobody meant to expose".
//
// Safe to import from the Edge runtime: it reads process.env and nothing else.

const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

export function isTestModeEnabled(): boolean {
  return TRUTHY.has((process.env.ENABLE_TEST_MODE ?? "").trim().toLowerCase());
}

/** The response every test-mode route gives when the feature is switched off. */
export const TEST_MODE_DISABLED = {
  error:
    "Test mode is not enabled on this server. Set ENABLE_TEST_MODE=true to turn it on.",
} as const;
