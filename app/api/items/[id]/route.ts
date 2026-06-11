import * as Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

const DB_PATH = join(process.cwd(), "content_calendar.db");

let dbInstance: any | null = null;

function getDb(): any {
  if (!dbInstance) {
    dbInstance = new (Database as any)(DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        headline TEXT NOT NULL,
        description TEXT,
        format TEXT,
        keywords TEXT,
        target_reader TEXT,
        platform TEXT,
        internal_links TEXT,
        external_links TEXT,
        word_count INTEGER,
        content_status TEXT DEFAULT 'Brainstormed',
        due_date TEXT,
        publish_date TEXT,
        writer TEXT,
        promotion_plan TEXT,
        smes TEXT,
        gdrive_link TEXT,
        notes TEXT
      )
    `);
  }
  return dbInstance;
}

function rowToItem(row: any): any {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    headline: row.headline,
    description: row.description,
    format: row.format,
    keywords: row.keywords,
    targetReader: row.target_reader,
    platform: row.platform,
    internalLinks: row.internal_links,
    externalLinks: row.external_links,
    wordCount: row.word_count,
    contentStatus: row.content_status,
    dueDate: row.due_date,
    publishDate: row.publish_date,
    writer: row.writer,
    promotionPlan: row.promotion_plan,
    smes: row.smes,
    gdriveLink: row.gdrive_link,
    notes: row.notes,
  };
}

function getFieldMap(): Record<string, string> {
  return {
    headline: "headline", description: "description", format: "format",
    keywords: "keywords", targetReader: "target_reader", platform: "platform",
    internalLinks: "internal_links", externalLinks: "external_links",
    wordCount: "word_count", contentStatus: "content_status",
    dueDate: "due_date", publishDate: "publish_date", writer: "writer",
    promotionPlan: "promotion_plan", smes: "smes", gdriveLink: "gdrive_link",
    notes: "notes",
  };
}

// GET /api/items/[id] — get single item
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.prepare("SELECT * FROM content_items WHERE id = ?").get(id);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToItem(row));
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
    const { id } = await params;
    const data = await req.json();
    const db = getDb();

    const existing = db.prepare("SELECT * FROM content_items WHERE id = ?").get(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const fieldMap = getFieldMap();
    const setClause: string[] = [];
    const values: any[] = [];

    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key] !== undefined) {
        setClause.push(`${col} = ?`);
        values.push(data[key] ?? null);
      }
    }

    if (setClause.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(now, id);
    db.prepare(
      `UPDATE content_items SET ${setClause.join(", ")}, updated_at = ? WHERE id = ?`
    ).run(...values);

    const row = db.prepare("SELECT * FROM content_items WHERE id = ?").get(id);
    return NextResponse.json(rowToItem(row));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/items/[id] — delete item
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = db.prepare("DELETE FROM content_items WHERE id = ?").run(id);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, deleted: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
