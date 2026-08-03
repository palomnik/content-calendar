import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  hashPassword,
  needsSetup,
  passwordProblem,
  setSessionCookie,
  setupTokenValid,
  usernameProblem,
} from "../../../lib/auth";
import { insertUser, listTeams } from "../../../lib/db";
import { checkRateLimit, clientKey, recordFailure } from "../../../lib/ratelimit";

// POST /api/auth/setup — claim the first administrator account.
//
// Only works while zero accounts exist. Once an admin is created this endpoint
// is permanently closed, so it cannot be used to escalate later. If SETUP_TOKEN
// is set in the environment it must also be supplied.
export async function POST(req: NextRequest) {
  try {
    if (!(await needsSetup())) {
      return NextResponse.json(
        { error: "Setup has already been completed. Sign in instead." },
        { status: 409 }
      );
    }

    const key = clientKey(req, "setup");
    const wait = checkRateLimit(key);
    if (wait !== null) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${wait}s.` },
        { status: 429 }
      );
    }

    const body = await req.json();

    if (!setupTokenValid(body?.setupToken)) {
      recordFailure(key);
      return NextResponse.json({ error: "Invalid setup token." }, { status: 403 });
    }

    const nameError = usernameProblem(body?.username);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

    const passError = passwordProblem(body?.password);
    if (passError) return NextResponse.json({ error: passError }, { status: 400 });

    if (body.password !== body.confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    // The first admin joins every team that exists, which on a fresh install is
    // the single "General" team created with the schema. Without this they
    // would sign in to a board they are not a member of and see nothing.
    const teams = await listTeams();

    const user = await insertUser({
      username: body.username,
      passwordHash: hashPassword(body.password),
      role: "admin",
      displayName: typeof body.displayName === "string" ? body.displayName.trim() || null : null,
      teamIds: teams.map((team) => team.id),
    });

    // Sign the new admin straight in.
    const token = await createSession(user.id);
    const res = NextResponse.json({ ok: true, user });
    setSessionCookie(res, token);
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
