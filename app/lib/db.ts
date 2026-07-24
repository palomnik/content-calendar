// Server-side database abstraction layer.
//
// Supports the built-in SQLite database (default) as well as external
// MySQL, MariaDB, and PostgreSQL databases. The active provider and its
// connection settings are persisted to data/db-config.json and can be
// changed at runtime from the configuration screen (/settings).
//
// All table columns are snake_case and identical across every provider so
// the same INSERT/UPDATE/SELECT statements work everywhere. Statements are
// written with `?` placeholders; the Postgres adapter rewrites them to
// `$1, $2, …` before executing.

import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export type Provider = "sqlite" | "mysql" | "mariadb" | "postgres";

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DbConfig {
  provider: Provider;
  connection?: DbConnection;
}

const DATA_DIR = join(process.cwd(), "data");
const CONFIG_PATH = join(DATA_DIR, "db-config.json");
const SQLITE_PATH = join(process.cwd(), "content_calendar.db");

const DEFAULT_CONFIG: DbConfig = { provider: "sqlite" };

/* ─────────────── Config persistence ─────────────── */

export function readConfig(): DbConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      if (parsed && typeof parsed.provider === "string") return parsed;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_CONFIG;
}

export function writeConfig(config: DbConfig): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  // Invalidate any cached adapter so the next request reconnects.
  cachedAdapter = null;
  cachedKey = null;
}

/** Config safe to send to the browser (password redacted). */
export function publicConfig(config: DbConfig = readConfig()) {
  if (!config.connection) return { provider: config.provider };
  const { password, ...rest } = config.connection;
  return {
    provider: config.provider,
    connection: { ...rest, hasPassword: Boolean(password) },
  };
}

/* ─────────────── Shared shape ─────────────── */

const COLUMNS = [
  "id", "created_at", "updated_at", "headline", "description", "format",
  "keywords", "target_reader", "platform", "internal_links", "external_links",
  "word_count", "content_status", "due_date", "publish_date", "writer",
  "promotion_plan", "smes", "gdrive_link", "notes",
];

// camelCase (API/UI) → snake_case (columns) for the editable fields.
const FIELD_MAP: Record<string, string> = {
  headline: "headline", description: "description", format: "format",
  keywords: "keywords", targetReader: "target_reader", platform: "platform",
  internalLinks: "internal_links", externalLinks: "external_links",
  wordCount: "word_count", contentStatus: "content_status",
  dueDate: "due_date", publishDate: "publish_date", writer: "writer",
  promotionPlan: "promotion_plan", smes: "smes", gdriveLink: "gdrive_link",
  notes: "notes",
};

export function rowToItem(row: any): any {
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

function generateId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/* ─────────────── Adapter interface ─────────────── */

interface Adapter {
  init(): Promise<void>;
  // Execute a statement. `select` true → return rows.
  run(sql: string, params: any[], select: boolean): Promise<any[]>;
}

function ddl(provider: Provider): string {
  // word_count is the only non-text column; everything else is TEXT so the
  // shape stays identical across engines.
  const intType = "INTEGER";
  const idType = provider === "sqlite" ? "TEXT" : "VARCHAR(64)";
  const shortType = provider === "sqlite" ? "TEXT" : "VARCHAR(64)";
  return `
    CREATE TABLE IF NOT EXISTS content_items (
      id ${idType} PRIMARY KEY,
      created_at ${shortType},
      updated_at ${shortType},
      headline TEXT NOT NULL,
      description TEXT,
      format TEXT,
      keywords TEXT,
      target_reader TEXT,
      platform TEXT,
      internal_links TEXT,
      external_links TEXT,
      word_count ${intType},
      content_status ${shortType},
      due_date ${shortType},
      publish_date ${shortType},
      writer TEXT,
      promotion_plan TEXT,
      smes TEXT,
      gdrive_link TEXT,
      notes TEXT
    )
  `;
}

/* ---- SQLite (better-sqlite3, synchronous) ---- */

class SqliteAdapter implements Adapter {
  private db: any = null;

  async init() {
    if (this.db) return;
    const Database = require("better-sqlite3");
    this.db = new Database(SQLITE_PATH);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(ddl("sqlite"));
  }

  async run(sql: string, params: any[], select: boolean) {
    await this.init();
    const stmt = this.db.prepare(sql);
    if (select) return stmt.all(...params);
    stmt.run(...params);
    return [];
  }
}

/* ---- MySQL / MariaDB (mysql2/promise) ---- */

class MysqlAdapter implements Adapter {
  private pool: any = null;
  constructor(private conn: DbConnection) {}

  async init() {
    if (this.pool) return;
    const mysql = require("mysql2/promise");
    this.pool = mysql.createPool({
      host: this.conn.host,
      port: this.conn.port || 3306,
      user: this.conn.user,
      password: this.conn.password,
      database: this.conn.database,
      waitForConnections: true,
      connectionLimit: 5,
    });
    await this.pool.query(ddl("mysql"));
  }

  async run(sql: string, params: any[], select: boolean) {
    await this.init();
    const [rows] = await this.pool.execute(sql, params);
    return select ? (rows as any[]) : [];
  }
}

/* ---- PostgreSQL (pg) ---- */

class PostgresAdapter implements Adapter {
  private pool: any = null;
  constructor(private conn: DbConnection) {}

  async init() {
    if (this.pool) return;
    const { Pool } = require("pg");
    this.pool = new Pool({
      host: this.conn.host,
      port: this.conn.port || 5432,
      user: this.conn.user,
      password: this.conn.password,
      database: this.conn.database,
      max: 5,
    });
    await this.pool.query(ddl("postgres"));
  }

  // Rewrite `?` placeholders to `$1, $2, …`.
  private toPg(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async run(sql: string, params: any[], select: boolean) {
    await this.init();
    const res = await this.pool.query(this.toPg(sql), params);
    return select ? res.rows : [];
  }
}

function buildAdapter(config: DbConfig): Adapter {
  switch (config.provider) {
    case "mysql":
    case "mariadb":
      if (!config.connection) throw new Error("Missing connection settings");
      return new MysqlAdapter(config.connection);
    case "postgres":
      if (!config.connection) throw new Error("Missing connection settings");
      return new PostgresAdapter(config.connection);
    case "sqlite":
    default:
      return new SqliteAdapter();
  }
}

/* ─────────────── Adapter cache ─────────────── */

let cachedAdapter: Adapter | null = null;
let cachedKey: string | null = null;

async function getAdapter(): Promise<Adapter> {
  const config = readConfig();
  const key = JSON.stringify(config);
  if (!cachedAdapter || cachedKey !== key) {
    cachedAdapter = buildAdapter(config);
    cachedKey = key;
    await cachedAdapter.init();
  }
  return cachedAdapter;
}

/* ─────────────── Public data operations ─────────────── */

export async function listItems(): Promise<any[]> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT * FROM content_items ORDER BY created_at DESC",
    [],
    true
  );
  return rows.map(rowToItem);
}

export async function getItem(id: string): Promise<any | null> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT * FROM content_items WHERE id = ?",
    [id],
    true
  );
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function createItem(data: any): Promise<any> {
  const db = await getAdapter();
  const id = generateId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO content_items (${COLUMNS.join(", ")})
     VALUES (${COLUMNS.map(() => "?").join(", ")})`,
    [
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
      data.notes ?? null,
    ],
    false
  );
  return getItem(id);
}

export async function updateItem(id: string, data: any): Promise<any | null> {
  const db = await getAdapter();
  const existing = await getItem(id);
  if (!existing) return null;

  const setClause: string[] = [];
  const values: any[] = [];
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (data[key] !== undefined) {
      setClause.push(`${col} = ?`);
      values.push(data[key] ?? null);
    }
  }
  if (setClause.length === 0) return existing;

  values.push(new Date().toISOString(), id);
  await db.run(
    `UPDATE content_items SET ${setClause.join(", ")}, updated_at = ? WHERE id = ?`,
    values,
    false
  );
  return getItem(id);
}

export async function deleteItem(id: string): Promise<boolean> {
  const db = await getAdapter();
  const existing = await getItem(id);
  if (!existing) return false;
  await db.run("DELETE FROM content_items WHERE id = ?", [id], false);
  return true;
}

/* ─────────────── Connection test ─────────────── */

// Validate a candidate config by connecting and ensuring the schema.
// Throws with a readable message on failure.
export async function testConfig(config: DbConfig): Promise<void> {
  const adapter = buildAdapter(config);
  await adapter.init();
  await adapter.run("SELECT COUNT(*) FROM content_items", [], true);
}
