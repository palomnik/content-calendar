// Server-side database abstraction layer.
//
// Supports the built-in SQLite database (default) as well as external
// MySQL, MariaDB, and PostgreSQL databases. The active provider and its
// connection settings come from one of two places:
//
//   1. Environment variables (DATABASE_URL, or discrete DB_* vars). These win
//      when present and make the configuration read-only — required on hosts
//      with a read-only filesystem, such as Vercel, where nothing can be
//      persisted to disk between requests.
//   2. data/db-config.json, written at runtime from /settings. Used on hosts
//      with a real writable disk (Coolify, Railway, Render, local dev).
//
// All table columns are snake_case and identical across every provider so
// the same INSERT/UPDATE/SELECT statements work everywhere. Statements are
// written with `?` placeholders; the Postgres adapter rewrites them to
// `$1, $2, …` before executing.

import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export type Provider = "sqlite" | "mysql" | "mariadb" | "postgres";

// How to treat TLS on the connection. Mirrors libpq's sslmode semantics, which
// is what every managed provider documents:
//   disable — plain TCP. Only sane for localhost.
//   require — encrypt, but do not verify the server certificate.
//   verify  — encrypt and verify the certificate against the trust store.
// Managed providers (Neon, Supabase, RDS) reject unencrypted connections, so
// anything not on localhost needs at least "require".
export type SslMode = "disable" | "require" | "verify";

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: SslMode;
}

export interface DbConfig {
  provider: Provider;
  connection?: DbConnection;
}

const DATA_DIR = join(process.cwd(), "data");
const CONFIG_PATH = join(DATA_DIR, "db-config.json");
const SQLITE_PATH = join(process.cwd(), "content_calendar.db");

const DEFAULT_CONFIG: DbConfig = { provider: "sqlite" };

const DEFAULT_PORT: Record<Provider, number> = {
  sqlite: 0,
  mysql: 3306,
  mariadb: 3306,
  postgres: 5432,
};

// URL scheme → provider. Both Postgres spellings are in the wild; providers
// hand out `postgres://` and `postgresql://` interchangeably.
const PROVIDER_BY_SCHEME: Record<string, Provider> = {
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "mysql:": "mysql",
  "mariadb:": "mariadb",
};

/* ─────────────── Environment configuration ─────────────── */

// Connection URLs we recognise, in precedence order. DATABASE_URL is the
// convention; POSTGRES_URL is what Vercel's Neon/Postgres integration injects.
const URL_VARS = ["DATABASE_URL", "POSTGRES_URL"];

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function parseSslMode(raw: string | null | undefined, host: string): SslMode {
  if (raw) {
    const v = raw.trim().toLowerCase();
    if (v === "disable" || v === "false" || v === "off" || v === "0") {
      return "disable";
    }
    // libpq's verify-ca/verify-full both mean "check the certificate".
    if (v === "verify" || v === "verify-ca" || v === "verify-full") {
      return "verify";
    }
    if (v === "require" || v === "true" || v === "on" || v === "1" ||
        v === "prefer" || v === "allow" || v === "no-verify") {
      return "require";
    }
    throw new Error(`Unrecognised SSL mode: ${raw}`);
  }
  // No explicit mode: managed databases are remote and always want TLS, but
  // a local Postgres in Docker generally has none configured.
  return isLocalHost(host) ? "disable" : "require";
}

// Parse a connection URL such as
//   postgresql://user:pass@host:5432/dbname?sslmode=require
function parseDbUrl(raw: string, source: string): DbConfig {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${source} is not a valid connection URL.`);
  }

  const provider = PROVIDER_BY_SCHEME[url.protocol];
  if (!provider) {
    throw new Error(
      `${source} has unsupported scheme "${url.protocol.replace(":", "")}". ` +
        `Expected one of: postgres, postgresql, mysql, mariadb.`
    );
  }

  const database = url.pathname.replace(/^\//, "");
  if (!database) throw new Error(`${source} is missing a database name.`);
  if (!url.hostname) throw new Error(`${source} is missing a host.`);

  // URL-encoded credentials are common — passwords routinely contain @ and /.
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!user) throw new Error(`${source} is missing a username.`);

  return {
    provider,
    connection: {
      host: url.hostname,
      port: Number(url.port) || DEFAULT_PORT[provider],
      user,
      password,
      database: decodeURIComponent(database),
      ssl: parseSslMode(url.searchParams.get("sslmode"), url.hostname),
    },
  };
}

// Build a config from discrete DB_* variables, for hosts where a single URL is
// awkward. Returns null when DB_PROVIDER is absent.
function parseDiscreteEnv(): DbConfig | null {
  const provider = process.env.DB_PROVIDER?.trim().toLowerCase();
  if (!provider) return null;

  if (provider === "sqlite") return { provider: "sqlite" };
  if (provider !== "mysql" && provider !== "mariadb" && provider !== "postgres") {
    throw new Error(
      `DB_PROVIDER is "${provider}". Expected sqlite, mysql, mariadb, or postgres.`
    );
  }

  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const missing = [
    !host && "DB_HOST",
    !database && "DB_NAME",
    !user && "DB_USER",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `DB_PROVIDER=${provider} requires ${missing.join(", ")} to also be set.`
    );
  }

  return {
    provider,
    connection: {
      host: host!,
      port: Number(process.env.DB_PORT) || DEFAULT_PORT[provider],
      user: user!,
      password: process.env.DB_PASSWORD ?? "",
      database: database!,
      ssl: parseSslMode(process.env.DB_SSL, host!),
    },
  };
}

/**
 * Configuration supplied by the environment, or null if none is set.
 *
 * Deliberately throws on a malformed value rather than falling back to SQLite.
 * A silent fallback is how a misconfigured deployment ends up quietly writing
 * to a throwaway file instead of the database you meant to use.
 */
export function envConfig(): DbConfig | null {
  for (const name of URL_VARS) {
    const raw = process.env[name]?.trim();
    if (raw) return parseDbUrl(raw, name);
  }
  return parseDiscreteEnv();
}

/** True when the environment pins the configuration, making /settings read-only. */
export function isEnvConfigured(): boolean {
  return envConfig() !== null;
}

/* ─────────────── Config persistence ─────────────── */

export function readConfig(): DbConfig {
  // The environment wins: on a read-only host it is the only thing that can
  // carry a configuration into the running process.
  const fromEnv = envConfig();
  if (fromEnv) return fromEnv;

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
  if (isEnvConfigured()) {
    throw new Error(
      "The database is configured by environment variables, which take " +
        "precedence and cannot be overwritten from here. Change DATABASE_URL " +
        "(or the DB_* variables) in your hosting provider instead."
    );
  }
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  // Invalidate any cached adapter so the next request reconnects.
  cachedAdapter = null;
  cachedKey = null;
}

/** Config safe to send to the browser (password redacted). */
export function publicConfig(config: DbConfig = readConfig()) {
  const envLocked = isEnvConfigured();
  if (!config.connection) return { provider: config.provider, envLocked };
  const { password, ...rest } = config.connection;
  return {
    provider: config.provider,
    connection: { ...rest, hasPassword: Boolean(password) },
    envLocked,
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

// Each statement is executed separately — MySQL/Postgres drivers reject
// multi-statement strings by default.
function ddlStatements(provider: Provider): string[] {
  // word_count is the only non-text column; everything else is TEXT so the
  // shape stays identical across engines.
  const intType = "INTEGER";
  const idType = provider === "sqlite" ? "TEXT" : "VARCHAR(64)";
  const shortType = provider === "sqlite" ? "TEXT" : "VARCHAR(64)";
  // Usernames are indexed UNIQUE; MySQL needs a bounded length for that.
  const nameType = provider === "sqlite" ? "TEXT" : "VARCHAR(190)";

  return [
    `
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
  `,
    `
    CREATE TABLE IF NOT EXISTS users (
      id ${idType} PRIMARY KEY,
      created_at ${shortType},
      updated_at ${shortType},
      username ${nameType} NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role ${shortType} NOT NULL
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS sessions (
      id ${idType} PRIMARY KEY,
      user_id ${idType} NOT NULL,
      created_at ${shortType},
      expires_at ${shortType}
    )
  `,
  ];
}

/* ---- Shared connection helpers ---- */

// Translate our SslMode into the `ssl` option both drivers accept.
// `undefined` means "no TLS" to pg and mysql2 alike.
function sslOption(mode: SslMode | undefined) {
  switch (mode) {
    case "verify":
      return { rejectUnauthorized: true };
    case "require":
      // Encrypt without validating the chain. This is what libpq's
      // sslmode=require means, and it is what lets self-signed certificates on
      // self-hosted databases work.
      return { rejectUnauthorized: false };
    default:
      return undefined;
  }
}

// Pool size per process. Serverless multiplies processes, so the effective
// connection count is this times the number of warm instances — keep it small
// and point at the provider's pooled connection string.
function poolMax(): number {
  const raw = Number(process.env.DB_POOL_MAX);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return process.env.VERCEL ? 2 : 5;
}

/* ---- SQLite (better-sqlite3, synchronous) ---- */

class SqliteAdapter implements Adapter {
  private db: any = null;

  async init() {
    if (this.db) return;
    // SQLite needs a writable, persistent disk. Serverless hosts have neither,
    // so fail with an explanation rather than an opaque SQLITE_CANTOPEN.
    if (process.env.VERCEL) {
      throw new Error(
        "SQLite cannot be used on Vercel: the filesystem is read-only and " +
          "nothing written by one request survives into the next. Set " +
          "DATABASE_URL to a Postgres/MySQL connection string instead."
      );
    }
    const Database = require("better-sqlite3");
    this.db = new Database(SQLITE_PATH);
    this.db.pragma("journal_mode = WAL");
    for (const stmt of ddlStatements("sqlite")) this.db.exec(stmt);
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
      ssl: sslOption(this.conn.ssl),
      waitForConnections: true,
      connectionLimit: poolMax(),
    });
    for (const stmt of ddlStatements("mysql")) await this.pool.query(stmt);
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
      ssl: sslOption(this.conn.ssl),
      max: poolMax(),
    });
    for (const stmt of ddlStatements("postgres")) await this.pool.query(stmt);
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

/* ─────────────── Users ─────────────── */

// Accounts live in the *active* database, alongside content_items. Switching
// providers therefore switches account stores too (see /settings for the
// warning shown to admins).

export type Role = "admin" | "user";

export interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserWithHash extends UserRow {
  passwordHash: string;
}

// Usernames are matched case-insensitively; we store the normalized form.
export function normalizeUsername(username: string): string {
  return String(username ?? "").trim().toLowerCase();
}

function rowToUser(row: any): UserRow {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? null,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Strip the password hash before anything leaves the server. */
export function publicUser(user: UserRow | UserWithHash): UserRow {
  const { passwordHash, ...rest } = user as UserWithHash;
  return rest;
}

export async function countUsers(): Promise<number> {
  const db = await getAdapter();
  const rows = await db.run("SELECT COUNT(*) AS n FROM users", [], true);
  // Postgres returns counts as strings; MySQL may return BigInt.
  return Number(rows[0]?.n ?? rows[0]?.count ?? 0);
}

export async function listUsers(): Promise<UserRow[]> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT * FROM users ORDER BY created_at ASC",
    [],
    true
  );
  return rows.map(rowToUser);
}

export async function findUserById(id: string): Promise<UserWithHash | null> {
  const db = await getAdapter();
  const rows = await db.run("SELECT * FROM users WHERE id = ?", [id], true);
  if (!rows[0]) return null;
  return { ...rowToUser(rows[0]), passwordHash: rows[0].password_hash };
}

export async function findUserByUsername(
  username: string
): Promise<UserWithHash | null> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT * FROM users WHERE username = ?",
    [normalizeUsername(username)],
    true
  );
  if (!rows[0]) return null;
  return { ...rowToUser(rows[0]), passwordHash: rows[0].password_hash };
}

export async function insertUser(data: {
  username: string;
  passwordHash: string;
  role: Role;
  displayName?: string | null;
}): Promise<UserRow> {
  const db = await getAdapter();
  const username = normalizeUsername(data.username);

  if (await findUserByUsername(username)) {
    throw new Error("That username is already taken.");
  }

  const id = generateId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (id, created_at, updated_at, username, display_name, password_hash, role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, now, now, username, data.displayName ?? null, data.passwordHash, data.role],
    false
  );

  const created = await findUserById(id);
  if (!created) throw new Error("Failed to create user.");
  return publicUser(created);
}

export async function updateUser(
  id: string,
  data: { passwordHash?: string; role?: Role; displayName?: string | null }
): Promise<UserRow | null> {
  const db = await getAdapter();
  const existing = await findUserById(id);
  if (!existing) return null;

  const set: string[] = [];
  const values: any[] = [];
  if (data.passwordHash !== undefined) {
    set.push("password_hash = ?");
    values.push(data.passwordHash);
  }
  if (data.role !== undefined) {
    set.push("role = ?");
    values.push(data.role);
  }
  if (data.displayName !== undefined) {
    set.push("display_name = ?");
    values.push(data.displayName);
  }
  if (set.length === 0) return publicUser(existing);

  values.push(new Date().toISOString(), id);
  await db.run(
    `UPDATE users SET ${set.join(", ")}, updated_at = ? WHERE id = ?`,
    values,
    false
  );

  const updated = await findUserById(id);
  return updated ? publicUser(updated) : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = await getAdapter();
  const existing = await findUserById(id);
  if (!existing) return false;
  await db.run("DELETE FROM sessions WHERE user_id = ?", [id], false);
  await db.run("DELETE FROM users WHERE id = ?", [id], false);
  return true;
}

export async function countAdmins(): Promise<number> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT COUNT(*) AS n FROM users WHERE role = ?",
    ["admin"],
    true
  );
  return Number(rows[0]?.n ?? rows[0]?.count ?? 0);
}

/* ─────────────── Sessions ─────────────── */

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: string;
}

export async function insertSession(
  id: string,
  userId: string,
  expiresAt: string
): Promise<void> {
  const db = await getAdapter();
  await db.run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [id, userId, new Date().toISOString(), expiresAt],
    false
  );
}

export async function findSession(id: string): Promise<SessionRow | null> {
  const db = await getAdapter();
  const rows = await db.run("SELECT * FROM sessions WHERE id = ?", [id], true);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    userId: rows[0].user_id,
    expiresAt: rows[0].expires_at,
  };
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getAdapter();
  await db.run("DELETE FROM sessions WHERE id = ?", [id], false);
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  const db = await getAdapter();
  await db.run("DELETE FROM sessions WHERE user_id = ?", [userId], false);
}

export async function purgeExpiredSessions(): Promise<void> {
  const db = await getAdapter();
  await db.run(
    "DELETE FROM sessions WHERE expires_at < ?",
    [new Date().toISOString()],
    false
  );
}

/* ─────────────── Connection test ─────────────── */

// Validate a candidate config by connecting and ensuring the schema.
// Throws with a readable message on failure.
export async function testConfig(config: DbConfig): Promise<void> {
  const adapter = buildAdapter(config);
  await adapter.init();
  await adapter.run("SELECT COUNT(*) FROM content_items", [], true);
}
