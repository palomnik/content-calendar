import { NextRequest, NextResponse } from "next/server";
import {
  hashPassword,
  passwordProblem,
  requireAdmin,
  usernameProblem,
} from "../../lib/auth";
import { insertUser, listUsers, Role } from "../../lib/db";

// GET /api/users — list accounts (admin only).
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;
    return NextResponse.json(await listUsers());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/users — create an account (admin only).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const body = await req.json();

    const nameError = usernameProblem(body?.username);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

    const passError = passwordProblem(body?.password);
    if (passError) return NextResponse.json({ error: passError }, { status: 400 });

    const role: Role = body?.role === "admin" ? "admin" : "user";

    // An account with no teams can sign in and see nothing — legitimate while
    // someone is being set up, so it is allowed rather than rejected. The
    // create form warns about it.
    const teamIds = Array.isArray(body?.teamIds)
      ? body.teamIds.filter((id: unknown) => typeof id === "string")
      : [];

    const user = await insertUser({
      username: body.username,
      passwordHash: hashPassword(body.password),
      role,
      displayName:
        typeof body?.displayName === "string" ? body.displayName.trim() || null : null,
      teamIds,
    });

    return NextResponse.json({ ...user, teamIds }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
