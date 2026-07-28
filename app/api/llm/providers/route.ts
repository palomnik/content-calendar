// The provider catalogue. Public: it is a static list of names, default URLs
// and default models — no secrets, and nothing about who is signed in. Test
// mode needs it to render the connection form without a session.

import { NextResponse } from "next/server";
import { LLM_PROVIDERS } from "../../../lib/llm";
import { isTestModeEnabled, TEST_MODE_DISABLED } from "../../../lib/testMode";

export async function GET() {
  // Only test mode reads this without a session; signed-in settings gets the
  // catalogue from /api/llm/connection.
  if (!isTestModeEnabled()) {
    return NextResponse.json(TEST_MODE_DISABLED, { status: 404 });
  }
  return NextResponse.json({ providers: LLM_PROVIDERS });
}
