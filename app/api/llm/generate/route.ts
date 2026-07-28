// Stream an outline or a draft for one content item.
//
// The response is newline-delimited JSON rather than a plain text stream, so a
// mid-generation failure can still be reported in-band:
//
//   {"type":"delta","text":"## I. Hook\n"}
//   {"type":"done"}
//   {"type":"error","error":"…"}
//
// This route deliberately does NOT write to the database. The client shows the
// text, the user accepts or discards it, and accepting issues an ordinary
// PATCH /api/items/<id>. That keeps a closed tab or a cancelled stream from
// leaving half-generated text in someone's notes.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { getItem } from "../../../lib/db";
import { generateStream } from "../../../lib/llm";
import { buildDraftPrompt, buildOutlinePrompt } from "../../../lib/prompts";
import { requireGenerationConnection } from "../shared";

// Token budgets. On Anthropic models this caps reasoning and visible text
// together, so it needs headroom well beyond the expected prose length.
const MAX_TOKENS = { outline: 4000, draft: 12000 } as const;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const task: "outline" | "draft" = body?.task === "draft" ? "draft" : "outline";

    const item = await getItem(String(body?.itemId ?? ""));
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Everything that can fail predictably is checked before the stream opens,
    // so the client gets a clean JSON error rather than a broken stream.
    const guard = await requireGenerationConnection(auth.user.id);
    if (guard.error) return guard.error;

    if (task === "draft" && !String(item.notes ?? "").trim()) {
      return NextResponse.json(
        {
          error:
            "This item has no outline yet. Generate an outline first, then draft from it.",
        },
        { status: 400 }
      );
    }

    const built =
      task === "outline" ? buildOutlinePrompt(item) : buildDraftPrompt(item);

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
            // Keeps a long draft inside the request budget on hosts that cap
            // function duration. Quality holds up well at this level.
            effort: "medium",
            signal: req.signal,
          })) {
            controller.enqueue(line({ type: "delta", text: delta }));
          }
          controller.enqueue(line({ type: "done" }));
        } catch (e: any) {
          // The client aborted (Stop, or a closed tab) — nothing to report.
          if (req.signal.aborted) {
            controller.close();
            return;
          }
          controller.enqueue(
            line({ type: "error", error: e?.message ?? "Generation failed." })
          );
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        // Stops nginx and similar proxies buffering the whole response.
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
