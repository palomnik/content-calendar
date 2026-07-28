// The admin-managed team default AI connection.
//
// Stored in the same table as personal connections under a sentinel user id.
// Users inherit it until they save one of their own.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import {
  deleteLlmConnection,
  getOrgLlmConnection,
  ORG_CONNECTION_ID,
  publicLlmConnection,
  upsertLlmConnection,
} from "../../../lib/db";
import { encryptionProblem } from "../../../lib/crypto";
import { testConnection } from "../../../lib/llm";
import { normalizeConnectionInput } from "../shared";

// GET /api/llm/org-connection — the team default, key redacted. Admin only:
// the base URL can name an internal host.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const org = await getOrgLlmConnection();
    return NextResponse.json({
      encryptionProblem: encryptionProblem(),
      connection: org ? publicLlmConnection(org) : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/llm/org-connection — validate and save. { test: true } validates only.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const stored = await getOrgLlmConnection();
    const input = normalizeConnectionInput(body, stored);

    const result = await testConnection({
      provider: input.provider,
      apiKey: input.effectiveKey,
      baseUrl: input.baseUrl,
      model: input.model,
    });

    if (body?.test) {
      return NextResponse.json({ ok: true, model: result.model, note: result.note });
    }

    if (input.apiKey) {
      const problem = encryptionProblem();
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const saved = await upsertLlmConnection(ORG_CONNECTION_ID, {
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

// DELETE /api/llm/org-connection — remove the team default. Users with no
// connection of their own lose AI access until they add one.
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;
    await deleteLlmConnection(ORG_CONNECTION_ID);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
