// Test-mode: prove an AI connection works. Public, and stores nothing.

import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "../../../lib/llm";
import { connectionFromBody } from "../test-shared";
import { isTestModeEnabled, TEST_MODE_DISABLED } from "../../../lib/testMode";

export async function POST(req: NextRequest) {
  try {
    if (!isTestModeEnabled()) {
      return NextResponse.json(TEST_MODE_DISABLED, { status: 404 });
    }

    const guard = connectionFromBody(await req.json());
    if (guard.error) return guard.error;

    const result = await testConnection(guard.connection);
    return NextResponse.json({ ok: true, model: result.model, note: result.note });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "The connection test failed." },
      { status: e?.status ?? 400 }
    );
  }
}
