// Propose a batch of content items for a campaign.
//
// Not streamed: the response is one structured JSON object, which is useless
// until complete, so streaming it would only delay the parse.
//
// This route creates nothing. It returns candidate items; the client shows them
// as a checklist and creates the ones the user keeps via POST /api/items.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { generate } from "../../../lib/llm";
import { BRAINSTORM_SCHEMA, buildBrainstormPrompt } from "../../../lib/prompts";
import { requireGenerationConnection } from "../shared";
import { MAX_CONTEXT_FILE_CHARS } from "../../../lib/fields";
import { sanitizeDraftItem, str } from "./sanitize";

const MIN_COUNT = 1;
const MAX_COUNT = 12;
const DEFAULT_COUNT = 6;

/** Fields the client may pre-set on every generated item. */
const DEFAULTABLE = [
  "format",
  "platform",
  "writer",
  "targetReader",
  "dueDate",
  "publishDate",
] as const;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const body = await req.json();

    const campaignName = str(body?.campaignName, 300);
    const campaignGoal = str(body?.campaignGoal, 2000);
    if (!campaignName || !campaignGoal) {
      return NextResponse.json(
        { error: "Campaign name and goal are both required." },
        { status: 400 }
      );
    }

    // Rejected rather than clamped. Silently dropping the tail of a brand voice
    // guide produces drafts that read as correct and are not.
    const contextFile = str(body?.contextFile, MAX_CONTEXT_FILE_CHARS + 1);
    if (contextFile.length > MAX_CONTEXT_FILE_CHARS) {
      return NextResponse.json(
        {
          error: `That context file is too long. Keep it under ${MAX_CONTEXT_FILE_CHARS.toLocaleString()} characters.`,
        },
        { status: 400 }
      );
    }
    const context = contextFile
      ? { name: str(body?.contextFileName, 300), content: contextFile }
      : null;

    const guard = await requireGenerationConnection(auth.user.id);
    if (guard.error) return guard.error;

    const requested = Number(body?.count);
    const count = Math.min(
      Math.max(Number.isFinite(requested) ? Math.round(requested) : DEFAULT_COUNT, MIN_COUNT),
      MAX_COUNT
    );

    const defaults: Record<string, string> = {};
    for (const key of DEFAULTABLE) {
      const value = str(body?.defaults?.[key], 300);
      if (value) defaults[key] = value;
    }

    const built = buildBrainstormPrompt({
      campaignName,
      campaignGoal,
      contextFile: context?.content ?? "",
      contextFileName: context?.name,
      count,
      defaults,
    });

    const result = await generate({
      connection: guard.connection,
      system: built.system,
      prompt: built.prompt,
      maxTokens: 12000,
      effort: "medium",
      json: { name: "content_items", schema: BRAINSTORM_SCHEMA },
      signal: req.signal,
    });

    const proposed = Array.isArray(result.data?.items) ? result.data.items : [];
    const items = proposed
      .slice(0, count)
      .map((raw: any) => sanitizeDraftItem(raw, defaults, context))
      .filter(Boolean);

    if (items.length === 0) {
      return NextResponse.json(
        {
          error:
            "The model did not return any usable ideas. Try again, or add more detail to the campaign goal.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Brainstorm failed." },
      { status: e?.status ?? 500 }
    );
  }
}
