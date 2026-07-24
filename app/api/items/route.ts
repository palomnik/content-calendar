import { NextRequest, NextResponse } from "next/server";
import { listItems, createItem } from "../../lib/db";
import { requireUser } from "../../lib/auth";

// GET /api/items — list all items
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    return NextResponse.json(await listItems());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/items — create a new item
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const data = await req.json();
    const item = await createItem(data);
    return NextResponse.json(item, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
