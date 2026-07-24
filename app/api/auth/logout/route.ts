import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, destroySession } from "../../../lib/auth";

// POST /api/auth/logout — revoke the current session server-side and clear the
// cookie. Safe to call when already signed out.
export async function POST(req: NextRequest) {
  await destroySession(req).catch(() => {});
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
