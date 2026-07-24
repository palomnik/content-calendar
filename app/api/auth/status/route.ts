import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, needsSetup, setupTokenRequired } from "../../../lib/auth";

// GET /api/auth/status — who am I, and does the app still need an admin?
// Public: the client uses this to decide between the login and setup forms.
export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    return NextResponse.json({
      user,
      authenticated: Boolean(user),
      needsSetup: await needsSetup(),
      setupTokenRequired: setupTokenRequired(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
