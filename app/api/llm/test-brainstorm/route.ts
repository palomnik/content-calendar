// Test-mode: propose campaign ideas. Public, and stores nothing — the ideas
// are returned to the caller's browser and never written to the database.

import { NextRequest, NextResponse } from "next/server";
import { generate } from "../../../lib/llm";
import { BRAINSTORM_SCHEMA, buildBrainstormPrompt } from "../../../lib/prompts";
import { connectionFromBody } from "../test-shared";
import { isTestModeEnabled, TEST_MODE_DISABLED } from "../../../lib/testMode";
import { sanitizeDraftItem, str } from "../brainstorm/sanitize";

const MIN_COUNT = 1;
const MAX_COUNT = 12;
const DEFAULT_COUNT = 6;

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
    if (!isTestModeEnabled()) {
      return NextResponse.json(TEST_MODE_DISABLED, { status: 404 });
    }

    const body = await req.json();
    const guard = connectionFromBody(body);
    if (guard.error) return guard.error;

    const campaignName = str(body?.campaignName, 300);
    const campaignGoal = str(body?.campaignGoal, 2000);
    const leadAvatar = str(body?.leadAvatar, 4000);
    if (!campaignName || !campaignGoal || !leadAvatar) {
      return NextResponse.json(
        { error: "Campaign name, goal, and lead avatar are all required." },
        { status: 400 }
      );
    }

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
      leadAvatar,
      painPoints: str(body?.painPoints, 4000),
      desires: str(body?.desires, 4000),
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
      .map((raw: any) => sanitizeDraftItem(raw, defaults))
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
