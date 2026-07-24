import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  hashPassword,
  passwordProblem,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "../../../lib/auth";
import { deleteSessionsForUser, findUserById, updateUser } from "../../../lib/db";
import {
  checkRateLimit,
  clearFailures,
  clientKey,
  recordFailure,
} from "../../../lib/ratelimit";

// POST /api/auth/password — change your own password.
// Requires the current password, and signs every other device out.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const key = clientKey(req, `password:${auth.user.id}`);
    const wait = checkRateLimit(key);
    if (wait !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${wait}s.` },
        { status: 429 }
      );
    }

    const body = await req.json();

    const problem = passwordProblem(body?.newPassword);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    if (body.newPassword !== body.confirmPassword) {
      return NextResponse.json({ error: "New passwords do not match." }, { status: 400 });
    }

    const full = await findUserById(auth.user.id);
    if (!full) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const currentPassword =
      typeof body?.currentPassword === "string" ? body.currentPassword : "";
    if (!verifyPassword(currentPassword, full.passwordHash)) {
      recordFailure(key);
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    clearFailures(key);
    await updateUser(auth.user.id, { passwordHash: hashPassword(body.newPassword) });

    // Invalidate everything, then re-issue a session for this browser so the
    // user is not logged out of the tab they just used.
    await deleteSessionsForUser(auth.user.id);
    const token = await createSession(auth.user.id);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, token);
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
