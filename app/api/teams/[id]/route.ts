import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import {
  countItemsInTeam,
  deleteTeam,
  findTeamById,
  memberIdsByTeam,
  renameTeam,
  setTeamMembers,
  teamNameProblem,
} from "../../../lib/db";

// PATCH /api/teams/[id] — rename a team and/or replace its membership (admin).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const team = await findTeamById(id);
    if (!team) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();

    if (body?.name !== undefined) {
      const problem = teamNameProblem(body.name);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      await renameTeam(id, body.name);
    }

    // memberIds replaces the whole list, so removing someone is just leaving
    // them out. Their items stay with the team; only their access goes.
    if (Array.isArray(body?.memberIds)) {
      await setTeamMembers(
        id,
        body.memberIds.filter((m: unknown) => typeof m === "string")
      );
    }

    const updated = await findTeamById(id);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const members = await memberIdsByTeam();
    return NextResponse.json({
      ...updated,
      memberIds: members[id] ?? [],
      itemCount: await countItemsInTeam(id),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// DELETE /api/teams/[id]?deleteItems=true — remove a team (admin).
//
// A team that still holds items is refused unless deleteItems says otherwise.
// Deleting the team alone would not free the content — it would leave it in a
// board no one can open — so the two outcomes have to be told apart explicitly
// rather than one being assumed.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const team = await findTeamById(id);
    if (!team) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const withItems = req.nextUrl.searchParams.get("deleteItems") === "true";
    const itemCount = await countItemsInTeam(id);

    if (itemCount > 0 && !withItems) {
      return NextResponse.json(
        {
          error: `"${team.name}" still has ${itemCount} item${
            itemCount === 1 ? "" : "s"
          }. Deleting the team deletes them too — confirm to go ahead.`,
          itemCount,
        },
        { status: 409 }
      );
    }

    const { deletedItems } = await deleteTeam(id, withItems);
    return NextResponse.json({ success: true, deleted: id, deletedItems });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
