// Test-mode: stream an outline or draft. Public, and stores nothing.
//
// The item arrives in the request body rather than being loaded by id — there
// is no database row to load, and the caller's board lives only in their tab.

import { NextRequest, NextResponse } from "next/server";
import { generateStream } from "../../../lib/llm";
import { buildDraftPrompt, buildOutlinePrompt } from "../../../lib/prompts";
import { connectionFromBody } from "../test-shared";
import { isTestModeEnabled, TEST_MODE_DISABLED } from "../../../lib/testMode";

const MAX_TOKENS = { outline: 4000, draft: 12000 } as const;

export async function POST(req: NextRequest) {
  try {
    if (!isTestModeEnabled()) {
      return NextResponse.json(TEST_MODE_DISABLED, { status: 404 });
    }

    const body = await req.json();
    const guard = connectionFromBody(body);
    if (guard.error) return guard.error;

    const task: "outline" | "draft" = body?.task === "draft" ? "draft" : "outline";
    const item = body?.item;
    if (!item || typeof item.headline !== "string" || !item.headline.trim()) {
      return NextResponse.json({ error: "That item has no headline." }, { status: 400 });
    }
    if (task === "draft" && !String(item.notes ?? "").trim()) {
      return NextResponse.json(
        { error: "This item has no outline yet. Generate an outline first, then draft from it." },
        { status: 400 }
      );
    }

    const built = task === "outline" ? buildOutlinePrompt(item) : buildDraftPrompt(item);
    const encoder = new TextEncoder();
    const line = (payload: unknown) => encoder.encode(JSON.stringify(payload) + "\n");

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const delta of generateStream({
            connection: guard.connection,
            system: built.system,
            prompt: built.prompt,
            maxTokens: MAX_TOKENS[task],
            effort: "medium",
            signal: req.signal,
          })) {
            controller.enqueue(line({ type: "delta", text: delta }));
          }
          controller.enqueue(line({ type: "done" }));
        } catch (e: any) {
          if (req.signal.aborted) {
            controller.close();
            return;
          }
          controller.enqueue(line({ type: "error", error: e?.message ?? "Generation failed." }));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Generation failed." },
      { status: e?.status ?? 500 }
    );
  }
}
