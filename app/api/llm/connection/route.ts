// The signed-in user's own AI connection.
//
// Every user configures their own provider and key. An admin may also save a
// team default (see ../org-connection) that users inherit until they set one.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import {
  deleteLlmConnection,
  getLlmConnection,
  getOrgLlmConnection,
  publicLlmConnection,
  upsertLlmConnection,
} from "../../../lib/db";
import { encryptionProblem } from "../../../lib/crypto";
import { LLM_PROVIDERS, testConnection } from "../../../lib/llm";
import { normalizeConnectionInput } from "../shared";

// GET /api/llm/connection — this user's connection with the key redacted,
// the provider catalogue, and whether a team default is available.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const own = await getLlmConnection(auth.user.id);
    const org = await getOrgLlmConnection();

    return NextResponse.json({
      providers: LLM_PROVIDERS,
      encryptionProblem: encryptionProblem(),
      connection: own ? publicLlmConnection(own) : null,
      // Non-admins see enough to know what they are inheriting, but not the
      // base URL, which can name an internal host.
      orgConnection: org
        ? auth.user.role === "admin"
          ? publicLlmConnection(org)
          : {
              provider: org.provider,
              model: org.model,
              hasApiKey: Boolean(org.apiKey),
              apiKeyBroken: org.apiKeyBroken,
            }
        : null,
      effectiveSource: own ? "user" : org ? "org" : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/llm/connection — validate and save. { test: true } validates only.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const stored = await getLlmConnection(auth.user.id);
    const input = normalizeConnectionInput(body, stored);

    // Always prove the connection works before committing to it.
    const result = await testConnection({
      provider: input.provider,
      apiKey: input.effectiveKey,
      baseUrl: input.baseUrl,
      model: input.model,
    });

    if (body?.test) {
      return NextResponse.json({ ok: true, model: result.model, note: result.note });
    }

    // Saving a key requires working encryption; changing only the model does not.
    if (input.apiKey) {
      const problem = encryptionProblem();
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const saved = await upsertLlmConnection(auth.user.id, {
      provider: input.provider,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
    });

    return NextResponse.json({
      ok: true,
      connection: publicLlmConnection(saved),
      note: result.note,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e?.status ?? 400 });
  }
}

// DELETE /api/llm/connection — forget this user's key and fall back to the
// team default, if one exists.
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    await deleteLlmConnection(auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
