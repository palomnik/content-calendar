import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  hashPassword,
  needsSetup,
  setSessionCookie,
  verifyPassword,
} from "../../../lib/auth";
import { findUserByUsername, normalizeUsername, publicUser } from "../../../lib/db";
import {
  checkRateLimit,
  clearFailures,
  clientKey,
  recordFailure,
} from "../../../lib/ratelimit";

// A throwaway hash compared against when the username does not exist, so that
// "no such user" and "wrong password" take about the same amount of time.
const DUMMY_HASH = hashPassword("decoy-password-not-in-use");

// POST /api/auth/login — exchange credentials for a session cookie.
export async function POST(req: NextRequest) {
  try {
    if (await needsSetup()) {
      return NextResponse.json(
        { error: "No accounts exist yet. Create the administrator account first.", needsSetup: true },
        { status: 409 }
      );
    }

    const body = await req.json();
    const username = normalizeUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";

    const key = clientKey(req, `login:${username}`);
    const wait = checkRateLimit(key);
    if (wait !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${wait}s.` },
        { status: 429 }
      );
    }

    const user = username ? await findUserByUsername(username) : null;
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !ok) {
      recordFailure(key);
      // Deliberately vague — do not reveal which half was wrong.
      return NextResponse.json(
        { error: "Incorrect username or password." },
        { status: 401 }
      );
    }

    clearFailures(key);
    const token = await createSession(user.id);
    const res = NextResponse.json({ ok: true, user: publicUser(user) });
    setSessionCookie(res, token);
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
