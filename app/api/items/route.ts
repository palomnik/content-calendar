import { NextRequest, NextResponse } from "next/server";
import { listItems, createItem } from "../../lib/db";
import { requireTeam, requireUser } from "../../lib/auth";

// Items belong to a team, and a team is a board. Both handlers resolve the team
// through requireTeam(), which fails the request unless the caller is a member —
// so a hand-written request naming another team's id gets a 403, not a board.

// GET /api/items?teamId=… — list one team's items
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const team = await requireTeam(
      auth.user.id,
      req.nextUrl.searchParams.get("teamId")
    );
    if (team.error) return team.error;

    return NextResponse.json(await listItems(team.teamId));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/items — create an item on one of the caller's teams
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const data = await req.json();

    const team = await requireTeam(auth.user.id, data?.teamId);
    if (team.error) return team.error;

    // createItem takes the team separately and ignores data.teamId, so the
    // membership check above is the only thing that decides where this lands.
    const item = await createItem(data, team.teamId);
    return NextResponse.json(item, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
