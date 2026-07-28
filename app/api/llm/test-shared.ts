// Shared guards for the test-mode AI routes.
//
// These routes are reachable without signing in — that is the point of test
// mode — so they must never read or write the database, and must never fall
// back to a stored connection. Everything comes from the request body, which
// means the caller can only ever spend their own API key.

import { NextResponse } from "next/server";
import { LlmConnection, providerById } from "../../lib/llm";
import { validateBaseUrl } from "./shared";
import { isTestModeEnabled, TEST_MODE_DISABLED } from "../../lib/testMode";

export type TestGuard =
  | { connection: LlmConnection; error: null }
  | { connection: null; error: NextResponse };

/** Build a connection from an untrusted body, or the response explaining why not. */
export function connectionFromBody(body: any): TestGuard {
  // Belt and braces: every route checks this too, but a new one added later
  // cannot silently become a public endpoint by forgetting to.
  if (!isTestModeEnabled()) {
    return {
      connection: null,
      error: NextResponse.json(TEST_MODE_DISABLED, { status: 404 }),
    };
  }

  const raw = body?.connection;
  const descriptor = providerById(String(raw?.provider ?? ""));
  if (!descriptor) {
    return {
      connection: null,
      error: NextResponse.json(
        { error: "Choose an AI provider before running a test." },
        { status: 400 }
      ),
    };
  }

  const baseUrl =
    descriptor.baseUrl === "fixed"
      ? null
      : (typeof raw?.baseUrl === "string" && raw.baseUrl.trim()) ||
        descriptor.defaultBaseUrl ||
        null;

  if (baseUrl) {
    // The server fetches this address, so the same SSRF rules apply as for a
    // signed-in connection — more so, since anyone can reach test mode.
    const problem = validateBaseUrl(baseUrl);
    if (problem) {
      return { connection: null, error: NextResponse.json({ error: problem }, { status: 400 }) };
    }
  }

  return {
    connection: {
      provider: descriptor.id,
      apiKey: typeof raw?.apiKey === "string" ? raw.apiKey : null,
      baseUrl,
      model:
        (typeof raw?.model === "string" && raw.model.trim()) ||
        descriptor.defaultModel ||
        null,
    },
    error: null,
  };
}
