// Helpers shared by the /api/llm routes.

import { NextResponse } from "next/server";
import {
  getLlmConnection,
  LlmConnectionRow,
  LlmProviderId,
  resolveLlmConnection,
} from "../../lib/db";
import { LlmProviderDescriptor, providerById, LLM_PROVIDERS } from "../../lib/llm";

/** Hosts that must never be reachable, whatever the user types. */
const BLOCKED_HOSTS = new Set([
  "169.254.169.254", // AWS / GCP / Azure instance metadata
  "metadata.google.internal",
  "metadata",
]);

/**
 * Validate a user-supplied base URL.
 *
 * The server fetches this address, so it is an SSRF surface. A blanket
 * private-range block is not an option — reaching a LAN or localhost Ollama is
 * the entire point of that provider — so this blocks the one target with real
 * blast radius (cloud instance-metadata, which hands out credentials) and
 * accepts the rest as inside the existing trust model: accounts are created by
 * an admin, and admins already control DATABASE_URL.
 */
export function validateBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That base URL is not a valid URL. Include http:// or https://.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The base URL must start with http:// or https://.";
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.startsWith("169.254.")) {
    return "That address is not allowed.";
  }
  return null;
}

/** Compare two endpoints for the carry-forward check. */
export function sameEndpoint(a: string | null, b: string | null): boolean {
  const norm = (v: string | null) =>
    (v ?? "").trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

export interface NormalizedConnectionInput {
  provider: LlmProviderId;
  descriptor: LlmProviderDescriptor;
  baseUrl: string | null;
  model: string;
  /** undefined keeps the stored key, null clears it, a string replaces it. */
  apiKey: string | null | undefined;
  /** The key to use for a live test right now, without persisting anything. */
  effectiveKey: string | null;
}

/**
 * Build a validated connection from a request body.
 *
 * The browser never receives the stored key, so a blank field means "keep the
 * one you have" — but only while the request still points at the same provider
 * and endpoint. Otherwise someone could repoint base_url at a server they
 * control and have us send the saved key there. Same defence as normalize() in
 * app/api/config/route.ts, which only carries a database password forward when
 * host, database, and user are unchanged.
 *
 * Throws an Error whose message is safe to show the user.
 */
export function normalizeConnectionInput(
  body: any,
  stored: LlmConnectionRow | null
): NormalizedConnectionInput {
  const descriptor = providerById(String(body?.provider ?? ""));
  if (!descriptor) {
    throw new Error(
      `Unknown provider. Expected one of: ${LLM_PROVIDERS.map((p) => p.id).join(", ")}.`
    );
  }

  const baseUrl =
    descriptor.baseUrl === "fixed"
      ? null
      : (typeof body?.baseUrl === "string" && body.baseUrl.trim()) ||
        descriptor.defaultBaseUrl ||
        null;

  if (descriptor.baseUrl === "required" && !baseUrl) {
    throw new Error(`${descriptor.label} needs a base URL.`);
  }
  if (baseUrl) {
    const problem = validateBaseUrl(baseUrl);
    if (problem) throw new Error(problem);
  }

  const model =
    (typeof body?.model === "string" && body.model.trim()) ||
    descriptor.defaultModel;
  if (!model) throw new Error(`${descriptor.label} needs a model name.`);

  const supplied = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const sameTarget = Boolean(
    stored &&
      stored.provider === descriptor.id &&
      sameEndpoint(stored.baseUrl, baseUrl) &&
      !stored.apiKeyBroken
  );

  let apiKey: string | null | undefined;
  if (supplied) apiKey = supplied;
  else if (sameTarget) apiKey = undefined;
  else apiKey = null;

  if (descriptor.apiKey === "required" && !supplied && !sameTarget) {
    throw new Error(
      `Enter the ${descriptor.label} API key. A saved key is not reused when ` +
        "the provider or base URL changes."
    );
  }

  return {
    provider: descriptor.id,
    descriptor,
    baseUrl,
    model,
    apiKey,
    effectiveKey: supplied || (sameTarget ? stored!.apiKey : null),
  };
}

/**
 * Load the connection a user generates with, or return the response explaining
 * why they cannot. Keeps the guard identical across every generation route.
 */
export async function requireGenerationConnection(
  userId: string
): Promise<
  | { connection: LlmConnectionRow; error: null }
  | { connection: null; error: NextResponse }
> {
  const resolved = await resolveLlmConnection(userId);
  if (!resolved) {
    return {
      connection: null,
      error: NextResponse.json(
        {
          error:
            "No AI connection is set up. Open Settings and add one under AI assistant.",
        },
        { status: 400 }
      ),
    };
  }
  if (resolved.connection.apiKeyBroken) {
    const whose =
      resolved.source === "org"
        ? "The team default API key can no longer be read"
        : "Your saved API key can no longer be read";
    return {
      connection: null,
      error: NextResponse.json(
        {
          error: `${whose} — the server's encryption key changed. Enter it again in Settings.`,
        },
        { status: 400 }
      ),
    };
  }
  return { connection: resolved.connection, error: null };
}

/** Re-export for routes that only need the user's own row. */
export { getLlmConnection };
