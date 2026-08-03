// Teams — the boards themselves.
//
// Two audiences, one route:
//   • Everyone reads their own list, which is what the board's team switcher
//     is built from.
//   • Administrators read every team with its membership (?all=1) to run the
//     Teams section of /settings, and are the only ones who can create one.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "../../lib/auth";
import {
  countItemsInTeam,
  insertTeam,
  listTeams,
  listTeamsForUser,
  memberIdsByTeam,
  setTeamMembers,
  teamNameProblem,
} from "../../lib/db";

// GET /api/teams          — teams the caller belongs to
// GET /api/teams?all=1    — every team, with members and item counts (admin)
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    if (req.nextUrl.searchParams.get("all") !== "1") {
      return NextResponse.json({ teams: await listTeamsForUser(auth.user.id) });
    }

    if (auth.user.role !== "admin") {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    const teams = await listTeams();
    const members = await memberIdsByTeam();
    // Item counts are what make "delete this team" an informed decision, so
    // they are part of the admin listing rather than a second round trip.
    const counts = await Promise.all(teams.map((t) => countItemsInTeam(t.id)));

    return NextResponse.json({
      teams: teams.map((team, i) => ({
        ...team,
        memberIds: members[team.id] ?? [],
        itemCount: counts[i],
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/teams — create a team (admin).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const body = await req.json();

    const problem = teamNameProblem(body?.name);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const team = await insertTeam(body.name);

    // Membership is set in the same request so a new team is never created in
    // a state nobody can see.
    const memberIds = Array.isArray(body?.memberIds)
      ? body.memberIds.filter((id: unknown) => typeof id === "string")
      : [];
    if (memberIds.length) await setTeamMembers(team.id, memberIds);

    return NextResponse.json({ ...team, memberIds, itemCount: 0 }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
