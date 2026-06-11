import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

const Database = require("better-sqlite3");

const DB_PATH = join(process.cwd(), "content_calendar.db");

let dbInstance: any | null = null;

function getDb(): any {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
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

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

// GET /api/items — list all items
export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM content_items ORDER BY created_at DESC").all();
    return NextResponse.json(rows.map(rowToItem));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/items — create a new item
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const id = generateId();
    const now = new Date().toISOString();

    const db = getDb();
    db.prepare(`
      INSERT INTO content_items (id, created_at, updated_at, headline, description, format, keywords, target_reader, platform, internal_links, external_links, word_count, content_status, due_date, publish_date, writer, promotion_plan, smes, gdrive_link, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, now, now,
      data.headline ?? null,
      data.description ?? null,
      data.format ?? null,
      data.keywords ?? null,
      data.targetReader ?? null,
      data.platform ?? null,
      data.internalLinks ?? null,
      data.externalLinks ?? null,
      data.wordCount ?? null,
      data.contentStatus ?? "Brainstormed",
      data.dueDate ?? null,
      data.publishDate ?? null,
      data.writer ?? null,
      data.promotionPlan ?? null,
      data.smes ?? null,
      data.gdriveLink ?? null,
      data.notes ?? null
    );

    const row = db.prepare("SELECT * FROM content_items WHERE id = ?").get(id);
    return NextResponse.json(rowToItem(row), { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
