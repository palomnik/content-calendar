import { NextRequest, NextResponse } from "next/server";
import { getItem, updateItem, deleteItem } from "../../../lib/db";
import { canReachItem, itemNotFound, requireUser } from "../../../lib/auth";

// Every handler here loads the item first and checks the caller's membership of
// that item's team before doing anything with it. A non-member gets the same
// 404 as a made-up id — see itemNotFound() for why that matters.
//
// Note there is no path to move an item between teams: updateItem writes only
// the fields in ITEM_FIELD_MAP, and team_id is deliberately not one of them.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const item = await getItem(id);
    if (!(await canReachItem(auth.user.id, item))) return itemNotFound();

    return NextResponse.json(item);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH /api/items/[id] — update item
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const existing = await getItem(id);
    if (!(await canReachItem(auth.user.id, existing))) return itemNotFound();

    const data = await req.json();
    const item = await updateItem(id, data);
    if (!item) return itemNotFound();
    return NextResponse.json(item);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/items/[id] — delete item
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const existing = await getItem(id);
    if (!(await canReachItem(auth.user.id, existing))) return itemNotFound();

    const ok = await deleteItem(id);
    if (!ok) return itemNotFound();

    return NextResponse.json({ success: true, deleted: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
