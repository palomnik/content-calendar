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

import { decryptSecret, encryptSecret } from "./crypto";
import { BACKUP_TABLES, ParsedBackup, sqlLiteral } from "./backup";
import {
  EDITABLE_ITEM_FIELDS,
  ITEM_COLUMNS,
  ITEM_FIELD_MAP,
  ITEM_FIELDS,
} from "./fields";

export type Provider = "sqlite" | "mysql" | "mariadb" | "postgres";

// How to treat TLS on the connection. Mirrors libpq's sslmode semantics, which
// is what every managed provider documents:
//   disable — plain TCP. Only sane on a private network.
//   require — encrypt, but do not verify the server certificate.
//   verify  — encrypt and verify the certificate against the trust store.
// Managed providers (Neon, Supabase, RDS) reject unencrypted connections, so
// anything on a public host needs at least "require". See isPrivateHost.
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

// Hosts we assume are reachable only over a trusted network, and therefore
// default to plain TCP. Managed providers always hand out a public FQDN, so
// requiring a dot is what separates "Neon" from "the Postgres container next
// to us". Covers loopback, container/service names (Docker Compose, Coolify,
// Kubernetes short names), the .internal/.local suffixes, and RFC 1918 /
// unique-local addresses.
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  // No dot at all: a container or service name on an internal network.
  if (!h.includes(".")) return true;
  if (/\.(internal|local|localdomain)$/.test(h)) return true;
  // RFC 1918 private ranges, plus the rest of the loopback /8.
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^127\./.test(h)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

/**
 * Reject a value that is a whole connection string rather than a hostname.
 *
 * Pasting the full URL into a host field is the single easiest mistake to
 * make, and the driver's only complaint is `getaddrinfo ENOTFOUND
 * postgres://user:pass@host:5432/db` — which buries the answer in what looks
 * like a DNS problem, and echoes the password into the logs while doing it.
 * Returns a message to show the operator, or null when the host is fine.
 */
export function hostProblem(host: string): string | null {
  const h = host.trim();
  if (!h) return "Host is required.";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) {
    return (
      "That is a full connection string, not a hostname. Either set it as " +
      "DATABASE_URL on its own, or enter just the host part here " +
      "(the text between @ and :port)."
    );
  }
  if (h.includes("@") || h.includes("/")) {
    return (
      "A host may not contain @ or /. Enter only the hostname, and put the " +
      "user, password, and database name in their own fields."
    );
  }
  return null;
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
  // a Postgres container on a private network generally has none configured,
  // and pg aborts the handshake outright when the server answers "no SSL".
  return isPrivateHost(host) ? "disable" : "require";
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

  const problem = hostProblem(host!);
  if (problem) throw new Error(`DB_HOST is invalid. ${problem}`);

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
  adapterPromise = null;
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

// Derived from app/lib/fields.ts so the CSV, the INSERT, and the row
// conversion can never disagree about the field list again.
const COLUMNS = ITEM_COLUMNS;

// camelCase (API/UI) → snake_case (columns) for the editable fields.
const FIELD_MAP: Record<string, string> = ITEM_FIELD_MAP;

export function rowToItem(row: any): any {
  const item: Record<string, any> = {};
  for (const field of ITEM_FIELDS) item[field.key] = row[field.column] ?? null;
  // Not an ITEM_FIELD — see createItem for why — but the routes need it to
  // authorize, and the board uses it to notice a stale team selection.
  item.teamId = row.team_id ?? null;
  return item;
}

function generateId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/* ─────────────── Adapter interface ─────────────── */

/** Execute one statement. `select` true → return rows. */
type RunFn = (sql: string, params: any[], select: boolean) => Promise<any[]>;

interface Adapter {
  init(): Promise<void>;
  run: RunFn;
  /**
   * Run `work` with every statement pinned to one connection, committing on
   * success and rolling back on any throw.
   *
   * This cannot be built from run() alone: the MySQL and Postgres adapters go
   * through a pool, so a BEGIN issued by one run() call and an INSERT issued by
   * the next can land on different connections, leaving the BEGIN dangling and
   * the writes uncommitted-but-unprotected.
   */
  transaction<T>(work: (run: RunFn) => Promise<T>): Promise<T>;
}

// MySQL's TEXT holds only 65,535 *bytes* and truncates silently past that.
// The free-text fields hold AI-generated drafts and uploaded context files,
// which run far longer, so they get LONGTEXT there. SQLite and Postgres TEXT
// are already unbounded.
function longText(provider: Provider): string {
  return provider === "mysql" || provider === "mariadb" ? "LONGTEXT" : "TEXT";
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
  const longTextType = longText(provider);

  return [
    `
    CREATE TABLE IF NOT EXISTS content_items (
      id ${idType} PRIMARY KEY,
      created_at ${shortType},
      updated_at ${shortType},
      headline TEXT NOT NULL,
      description ${longTextType},
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
      promotion_plan ${longTextType},
      smes TEXT,
      gdrive_link TEXT,
      notes ${longTextType},
      context_file_name TEXT,
      context_file ${longTextType},
      team_id ${idType}
    )
  `,
    // A board. Every content item belongs to exactly one, and only members of
    // that team can see or touch it.
    //
    // No UNIQUE on name, for the same reason llm_connections has no constraints:
    // there is no migration system here, so a constraint added now could never
    // be dropped from an already-deployed database. Name collisions are rejected
    // in insertTeam/updateTeam instead.
    `
    CREATE TABLE IF NOT EXISTS teams (
      id ${idType} PRIMARY KEY,
      created_at ${shortType},
      updated_at ${shortType},
      name ${nameType} NOT NULL
    )
  `,
    // Who is on which board. One row per (user, team); a user on two teams has
    // two rows and sees both boards.
    `
    CREATE TABLE IF NOT EXISTS team_members (
      id ${idType} PRIMARY KEY,
      team_id ${idType} NOT NULL,
      user_id ${idType} NOT NULL,
      created_at ${shortType}
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
    // One row per user, plus one for the team default (user_id = "__org__").
    //
    // Deliberately no UNIQUE(user_id) and no index. There is no migration
    // system here — every statement is CREATE TABLE IF NOT EXISTS — so a
    // constraint added now could never be dropped from a deployed database,
    // which would block a future "several connections per user" feature.
    // CREATE INDEX IF NOT EXISTS is also not valid MySQL, and inline INDEX(...)
    // is MySQL-only. The table holds one row per account, so a scan is free.
    // Uniqueness is enforced in upsertLlmConnection instead.
    //
    // api_key holds AES-256-GCM ciphertext (see app/lib/crypto.ts) and must be
    // TEXT: an encrypted long key runs to several hundred characters.
    `
    CREATE TABLE IF NOT EXISTS llm_connections (
      id ${idType} PRIMARY KEY,
      user_id ${idType} NOT NULL,
      created_at ${shortType},
      updated_at ${shortType},
      provider ${shortType} NOT NULL,
      api_key TEXT,
      base_url TEXT,
      model TEXT
    )
  `,
  ];
}

/**
 * Columns added to `content_items` after a database may already have been
 * created.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
 * without this an older database would be missing the column and every INSERT —
 * which lists every column in ITEM_COLUMNS — would fail outright.
 *
 * These run on every init and are expected to fail on the second and every
 * later start. SQLite and MySQL both reject `ADD COLUMN IF NOT EXISTS`, so
 * "attempt it and ignore the error" is the only form all three engines accept;
 * Postgres gets the guarded form because it has one and it keeps the server log
 * quiet. Adding a nullable column is instant on an empty table and cheap on a
 * populated one.
 */
function addColumnStatements(provider: Provider): string[] {
  const guard = provider === "postgres" ? "IF NOT EXISTS " : "";
  const idType = provider === "sqlite" ? "TEXT" : "VARCHAR(64)";
  return [
    `ALTER TABLE content_items ADD COLUMN ${guard}context_file_name TEXT`,
    `ALTER TABLE content_items ADD COLUMN ${guard}context_file ${longText(provider)}`,
    // Nullable on purpose. Rows that predate teams arrive here with no team;
    // backfillTeams() adopts them into the default team on the next start.
    `ALTER TABLE content_items ADD COLUMN ${guard}team_id ${idType}`,
  ];
}

/** Apply addColumnStatements, swallowing the "already exists" failures. */
async function applyAddColumns(
  provider: Provider,
  exec: (sql: string) => Promise<unknown>
): Promise<void> {
  for (const stmt of addColumnStatements(provider)) {
    try {
      await exec(stmt);
    } catch {
      // The column is already there. Any other cause — a missing table, no
      // permission — surfaces on the first real query instead.
    }
  }
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
    await applyAddColumns("sqlite", async (sql) => this.db.exec(sql));
  }

  async run(sql: string, params: any[], select: boolean) {
    await this.init();
    const stmt = this.db.prepare(sql);
    if (select) return stmt.all(...params);
    stmt.run(...params);
    return [];
  }

  async transaction<T>(work: (run: RunFn) => Promise<T>): Promise<T> {
    await this.init();
    // better-sqlite3 holds a single connection, so the ambient one is correct.
    // Its own db.transaction() helper only wraps synchronous callbacks.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await work((sql, params, select) => this.run(sql, params, select));
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* the transaction was already unwound */
      }
      throw e;
    }
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
    await applyAddColumns("mysql", (sql) => this.pool.query(sql));
  }

  async run(sql: string, params: any[], select: boolean) {
    await this.init();
    const [rows] = await this.pool.execute(sql, params);
    return select ? (rows as any[]) : [];
  }

  async transaction<T>(work: (run: RunFn) => Promise<T>): Promise<T> {
    await this.init();
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(async (sql, params, select) => {
        const [rows] = await conn.execute(sql, params);
        return select ? (rows as any[]) : [];
      });
      await conn.commit();
      return result;
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* connection already gone */
      }
      throw e;
    } finally {
      conn.release();
    }
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
    await applyAddColumns("postgres", (sql) => this.pool.query(sql));
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

  async transaction<T>(work: (run: RunFn) => Promise<T>): Promise<T> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(async (sql, params, select) => {
        const res = await client.query(this.toPg(sql), params);
        return select ? res.rows : [];
      });
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection already gone */
      }
      throw e;
    } finally {
      client.release();
    }
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

// The in-flight promise is cached, not the adapter, so two requests arriving
// together on a cold process share one connection pool instead of each building
// their own. A failed setup clears the cache so the next request retries rather
// than inheriting a half-built adapter forever.
let adapterPromise: Promise<Adapter> | null = null;
let cachedKey: string | null = null;

function getAdapter(): Promise<Adapter> {
  const config = readConfig();
  const key = JSON.stringify(config);
  if (!adapterPromise || cachedKey !== key) {
    cachedKey = key;
    const adapter = buildAdapter(config);
    adapterPromise = (async () => {
      await adapter.init();
      await backfillTeams((sql, params, select) => adapter.run(sql, params, select));
      return adapter;
    })().catch((e) => {
      adapterPromise = null;
      cachedKey = null;
      throw e;
    });
  }
  return adapterPromise;
}

/* ─────────────── Teams ─────────────── */

// A team is a board. Every content item belongs to exactly one team, and a user
// sees a board only by being a member of its team — being on two teams means
// seeing both boards and nothing else.
//
// Enforcement is entirely server-side, in the API routes: every read and write
// of an item first checks membership of that item's team. The team switcher in
// the UI is a convenience, never a control.
//
// Administrators are not exempt. An admin can add themselves to any team in a
// click, so nothing is out of reach, but an admin who is not a member of a team
// does not see its board — which is what "one team cannot view another team's
// records" has to mean to be worth anything.

/** The team every pre-teams row is adopted into. Underscores cannot collide
 *  with generateId(), which is why ORG_CONNECTION_ID uses the same trick. */
export const DEFAULT_TEAM_ID = "__default__";
const DEFAULT_TEAM_NAME = "General";

export interface TeamRow {
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

function rowToTeam(row: any): TeamRow {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Trim and validate a team name. Returns an error message, or null if OK. */
export function teamNameProblem(name: unknown): string | null {
  if (typeof name !== "string") return "Team name is required.";
  const value = name.trim();
  if (value.length < 2) return "Team name must be at least 2 characters.";
  if (value.length > 120) return "Team name must be 120 characters or fewer.";
  return null;
}

/**
 * Bring a database that predates teams — or one restored from a backup that
 * does — up to the teams model, and do nothing at all to one that is already
 * there.
 *
 * Runs on every adapter start and at the end of every restore, so it must stay
 * idempotent and cheap.
 */
async function backfillTeams(run: RunFn): Promise<void> {
  const anyTeam = await run("SELECT id FROM teams", [], true);
  if (anyTeam.length > 0) {
    // Teams already exist. Deliberately no repair pass here: if the default
    // team was deleted on purpose, re-creating it on the next request would
    // undo an administrator's decision.
    return;
  }

  const now = new Date().toISOString();
  await run(
    "INSERT INTO teams (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)",
    [DEFAULT_TEAM_ID, now, now, DEFAULT_TEAM_NAME],
    false
  );

  // Everyone who already had an account keeps seeing everything they saw
  // before the upgrade: one team, and all of them on it.
  const users = await run("SELECT id FROM users", [], true);
  for (const user of users) {
    await run(
      "INSERT INTO team_members (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      [generateId(), DEFAULT_TEAM_ID, user.id, now],
      false
    );
  }

  // Every item, not just the ones with a NULL team. This branch only runs when
  // the teams table is empty, and with no teams in existence every team_id is
  // dangling by definition — a row pointing at a team that is not there is as
  // invisible as one pointing at nothing.
  await run("UPDATE content_items SET team_id = ?", [DEFAULT_TEAM_ID], false);
}

export async function listTeams(): Promise<TeamRow[]> {
  const db = await getAdapter();
  const rows = await db.run("SELECT * FROM teams ORDER BY name ASC", [], true);
  return rows.map(rowToTeam);
}

export async function findTeamById(id: string): Promise<TeamRow | null> {
  const db = await getAdapter();
  const rows = await db.run("SELECT * FROM teams WHERE id = ?", [id], true);
  return rows[0] ? rowToTeam(rows[0]) : null;
}

/** Teams the user belongs to, in the order the switcher shows them. */
export async function listTeamsForUser(userId: string): Promise<TeamRow[]> {
  const db = await getAdapter();
  const rows = await db.run(
    `SELECT t.* FROM teams t
       JOIN team_members m ON m.team_id = t.id
      WHERE m.user_id = ?
      ORDER BY t.name ASC`,
    [userId],
    true
  );
  return rows.map(rowToTeam);
}

/**
 * The single check every item read and write goes through.
 *
 * Takes a possibly-null team id because an item restored from an old backup can
 * still be waiting for its backfill; no team means no access.
 */
export async function isTeamMember(
  userId: string,
  teamId: string | null | undefined
): Promise<boolean> {
  if (!teamId) return false;
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT id FROM team_members WHERE user_id = ? AND team_id = ?",
    [userId, teamId],
    true
  );
  return rows.length > 0;
}

/** Team ids for each of the given users, keyed by user id. */
export async function teamIdsByUser(): Promise<Record<string, string[]>> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT user_id, team_id FROM team_members",
    [],
    true
  );
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    (out[row.user_id] ??= []).push(row.team_id);
  }
  return out;
}

export async function memberIdsByTeam(): Promise<Record<string, string[]>> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT user_id, team_id FROM team_members",
    [],
    true
  );
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    (out[row.team_id] ??= []).push(row.user_id);
  }
  return out;
}

export async function countItemsInTeam(teamId: string): Promise<number> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT COUNT(*) AS n FROM content_items WHERE team_id = ?",
    [teamId],
    true
  );
  return Number(rows[0]?.n ?? rows[0]?.count ?? 0);
}

/** Reject a duplicate name, matched the way a person would read it. */
async function teamNameTaken(name: string, exceptId?: string): Promise<boolean> {
  const wanted = name.trim().toLowerCase();
  const teams = await listTeams();
  return teams.some(
    (t) => t.id !== exceptId && t.name.trim().toLowerCase() === wanted
  );
}

export async function insertTeam(name: string): Promise<TeamRow> {
  const db = await getAdapter();
  const clean = name.trim();
  if (await teamNameTaken(clean)) {
    throw new Error(`There is already a team called "${clean}".`);
  }

  const id = generateId();
  const now = new Date().toISOString();
  await db.run(
    "INSERT INTO teams (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)",
    [id, now, now, clean],
    false
  );

  const created = await findTeamById(id);
  if (!created) throw new Error("Failed to create the team.");
  return created;
}

export async function renameTeam(id: string, name: string): Promise<TeamRow | null> {
  const db = await getAdapter();
  const existing = await findTeamById(id);
  if (!existing) return null;

  const clean = name.trim();
  if (await teamNameTaken(clean, id)) {
    throw new Error(`There is already a team called "${clean}".`);
  }

  await db.run(
    "UPDATE teams SET name = ?, updated_at = ? WHERE id = ?",
    [clean, new Date().toISOString(), id],
    false
  );
  return findTeamById(id);
}

/** Replace a team's membership wholesale with the given user ids. */
export async function setTeamMembers(
  teamId: string,
  userIds: string[]
): Promise<void> {
  const db = await getAdapter();
  const wanted = [...new Set(userIds)];
  const now = new Date().toISOString();

  return db.transaction(async (run) => {
    const current = await run(
      "SELECT user_id FROM team_members WHERE team_id = ?",
      [teamId],
      true
    );
    const have = new Set(current.map((r: any) => r.user_id));

    for (const userId of wanted) {
      if (have.has(userId)) continue;
      await run(
        "INSERT INTO team_members (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)",
        [generateId(), teamId, userId, now],
        false
      );
    }
    for (const userId of have) {
      if (wanted.includes(userId as string)) continue;
      await run(
        "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
        [teamId, userId],
        false
      );
    }
  });
}

/** Replace one user's team list wholesale. Mirrors setTeamMembers. */
export async function setUserTeams(userId: string, teamIds: string[]): Promise<void> {
  const db = await getAdapter();
  const wanted = [...new Set(teamIds)];
  const now = new Date().toISOString();

  return db.transaction(async (run) => {
    const current = await run(
      "SELECT team_id FROM team_members WHERE user_id = ?",
      [userId],
      true
    );
    const have = new Set(current.map((r: any) => r.team_id));

    for (const teamId of wanted) {
      if (have.has(teamId)) continue;
      await run(
        "INSERT INTO team_members (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)",
        [generateId(), teamId, userId, now],
        false
      );
    }
    for (const teamId of have) {
      if (wanted.includes(teamId as string)) continue;
      await run(
        "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
        [teamId, userId],
        false
      );
    }
  });
}

/**
 * Delete a team, its memberships, and — only when asked — its items.
 *
 * `deleteItems` is not a convenience flag. A team's board is invisible to
 * everyone once the team is gone, so deleting a populated team silently would
 * strand the content rather than remove it; the caller has to say which it
 * means.
 */
export async function deleteTeam(
  id: string,
  deleteItems: boolean
): Promise<{ deletedItems: number }> {
  const db = await getAdapter();
  return db.transaction(async (run) => {
    let deletedItems = 0;
    if (deleteItems) {
      const rows = await run(
        "SELECT COUNT(*) AS n FROM content_items WHERE team_id = ?",
        [id],
        true
      );
      deletedItems = Number(rows[0]?.n ?? rows[0]?.count ?? 0);
      await run("DELETE FROM content_items WHERE team_id = ?", [id], false);
    }
    await run("DELETE FROM team_members WHERE team_id = ?", [id], false);
    await run("DELETE FROM teams WHERE id = ?", [id], false);
    return { deletedItems };
  });
}

/* ─────────────── Public data operations ─────────────── */

// Every item query is scoped by team. There is deliberately no "list all items"
// function: an unscoped SELECT is one careless call site away from being the
// hole this whole feature exists to close.

export async function listItems(teamId: string): Promise<any[]> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT * FROM content_items WHERE team_id = ? ORDER BY created_at DESC",
    [teamId],
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

export async function createItem(data: any, teamId: string): Promise<any> {
  const db = await getAdapter();
  const id = generateId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO content_items (${COLUMNS.join(", ")}, team_id)
     VALUES (${COLUMNS.map(() => "?").join(", ")}, ?)`,
    // Built from the same list as COLUMNS, so the two cannot fall out of step.
    // team_id is appended rather than being an ITEM_FIELD on purpose: keeping it
    // out of that list keeps it out of the CSV and out of ITEM_FIELD_MAP, so no
    // import and no PATCH body can move an item into another team's board.
    [
      id,
      now,
      now,
      ...EDITABLE_ITEM_FIELDS.map((field) =>
        field.key === "contentStatus"
          ? data.contentStatus ?? "Brainstormed"
          : data[field.key] ?? null
      ),
      teamId,
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

export interface UserWithTeams extends UserRow {
  teamIds: string[];
}

/** Every account, each with the teams it belongs to. Admin-only, by its caller. */
export async function listUsers(): Promise<UserWithTeams[]> {
  const db = await getAdapter();
  const rows = await db.run(
    "SELECT * FROM users ORDER BY created_at ASC",
    [],
    true
  );
  // One extra query rather than one per user: this list is rendered whole.
  const byUser = await teamIdsByUser();
  return rows.map((row) => ({
    ...rowToUser(row),
    teamIds: byUser[row.id] ?? [],
  }));
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
  /** Teams the new account joins. An account with none has no board to see. */
  teamIds?: string[];
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

  if (data.teamIds?.length) await setUserTeams(id, data.teamIds);

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
  // Real user ids never equal ORG_CONNECTION_ID, so the org default survives.
  await db.run("DELETE FROM llm_connections WHERE user_id = ?", [id], false);
  // Memberships go with the account. Left behind they would readmit whoever
  // happened to be issued the same id later — and clutter every member list.
  await db.run("DELETE FROM team_members WHERE user_id = ?", [id], false);
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

/* ─────────────── LLM connections ─────────────── */

// Each user configures their own model provider. An admin may also save a team
// default that users inherit until they set one of their own; it lives in the
// same table under a sentinel user id.
//
// api_key holds ciphertext. Plaintext keys exist only in memory, on the server,
// for the life of a request — they are never returned to a browser and never
// logged. Use publicLlmConnection() for anything that leaves the server.

/** Sentinel user id for the admin-managed team default. Real ids come from
 *  generateId(), which never produces underscores, so this cannot collide. */
export const ORG_CONNECTION_ID = "__org__";

export type LlmProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "ollama-cloud"
  | "ollama"
  | "huggingface"
  | "openai-compatible";

const LLM_PROVIDER_IDS: LlmProviderId[] = [
  "anthropic",
  "openai",
  "openrouter",
  "ollama-cloud",
  "ollama",
  "huggingface",
  "openai-compatible",
];

export interface LlmConnectionRow {
  id: string;
  userId: string;
  provider: LlmProviderId;
  /** Decrypted key, or null when absent or unreadable. Never send to a browser. */
  apiKey: string | null;
  /** True when a stored key exists but the current encryption key cannot open it. */
  apiKeyBroken: boolean;
  baseUrl: string | null;
  model: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function rowToLlmConnection(row: any): LlmConnectionRow {
  const provider: LlmProviderId = LLM_PROVIDER_IDS.includes(row.provider)
    ? row.provider
    : "openai-compatible";

  let apiKey: string | null = null;
  let apiKeyBroken = false;
  if (row.api_key) {
    try {
      apiKey = decryptSecret(row.api_key, row.user_id);
    } catch {
      // Rotated or missing APP_ENCRYPTION_KEY, or a corrupted row. Surface it
      // as "enter your key again" rather than failing the whole request.
      apiKeyBroken = true;
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    provider,
    apiKey,
    apiKeyBroken,
    baseUrl: row.base_url ?? null,
    model: row.model ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Redacted shape safe to hand to a browser. Mirrors publicConfig(). */
export function publicLlmConnection(conn: LlmConnectionRow) {
  return {
    provider: conn.provider,
    baseUrl: conn.baseUrl,
    model: conn.model,
    hasApiKey: Boolean(conn.apiKey),
    apiKeyBroken: conn.apiKeyBroken,
    updatedAt: conn.updatedAt,
  };
}

export async function getLlmConnection(
  userId: string
): Promise<LlmConnectionRow | null> {
  const db = await getAdapter();
  // Newest wins, so behaviour stays deterministic even if a duplicate ever
  // slipped in before upsert converged.
  const rows = await db.run(
    "SELECT * FROM llm_connections WHERE user_id = ? ORDER BY updated_at DESC",
    [userId],
    true
  );
  return rows[0] ? rowToLlmConnection(rows[0]) : null;
}

/** The admin-managed team default, if one has been saved. */
export function getOrgLlmConnection(): Promise<LlmConnectionRow | null> {
  return getLlmConnection(ORG_CONNECTION_ID);
}

/** The connection a given user actually generates with, and where it came from. */
export async function resolveLlmConnection(
  userId: string
): Promise<{ connection: LlmConnectionRow; source: "user" | "org" } | null> {
  const own = await getLlmConnection(userId);
  if (own) return { connection: own, source: "user" };
  const org = await getOrgLlmConnection();
  return org ? { connection: org, source: "org" } : null;
}

export async function upsertLlmConnection(
  userId: string,
  data: {
    provider: LlmProviderId;
    /** undefined keeps the stored key; null or "" clears it; a string replaces it. */
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
  }
): Promise<LlmConnectionRow> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const existing = await getLlmConnection(userId);

  let cipher: string | null;
  if (data.apiKey === undefined) {
    // Reuse the stored ciphertext verbatim rather than re-encrypting, so this
    // path works even when the key cannot currently be decrypted.
    const rows = await db.run(
      "SELECT api_key FROM llm_connections WHERE user_id = ?",
      [userId],
      true
    );
    cipher = rows[0]?.api_key ?? null;
  } else if (data.apiKey) {
    cipher = encryptSecret(data.apiKey, userId);
  } else {
    cipher = null;
  }

  if (existing) {
    await db.run(
      `UPDATE llm_connections
          SET provider = ?, api_key = ?, base_url = ?, model = ?, updated_at = ?
        WHERE id = ?`,
      [
        data.provider,
        cipher,
        data.baseUrl ?? null,
        data.model ?? null,
        now,
        existing.id,
      ],
      false
    );
    // Converge on one row per user without needing a UNIQUE constraint.
    await db.run(
      "DELETE FROM llm_connections WHERE user_id = ? AND id <> ?",
      [userId, existing.id],
      false
    );
  } else {
    const id = generateId();
    await db.run(
      `INSERT INTO llm_connections
         (id, user_id, created_at, updated_at, provider, api_key, base_url, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        now,
        now,
        data.provider,
        cipher,
        data.baseUrl ?? null,
        data.model ?? null,
      ],
      false
    );
  }

  const saved = await getLlmConnection(userId);
  if (!saved) throw new Error("Failed to save the AI connection.");
  return saved;
}

export async function deleteLlmConnection(userId: string): Promise<boolean> {
  const db = await getAdapter();
  const existing = await getLlmConnection(userId);
  if (!existing) return false;
  await db.run("DELETE FROM llm_connections WHERE user_id = ?", [userId], false);
  return true;
}

/* ─────────────── SQL backup ─────────────── */

// A portable dump of the active database: schema, then data.
//
// `sessions` is deliberately excluded. Sessions are short-lived credentials,
// not content — restoring them would resurrect sign-ins that were meant to have
// expired, and everyone simply signs in again after a restore.
//
// Everything else IS included, which means a backup file contains password
// hashes and encrypted API keys. It is not safe to share, and the API keys are
// only readable again by a server holding the same APP_ENCRYPTION_KEY.

/** Rows read per round trip, so a large board never lands in memory at once. */
const BACKUP_BATCH = 500;

/**
 * Render a value as a SQL literal.
 *
 * MySQL treats a backslash as an escape character inside string literals, so a
 * Windows path or a regex in someone's notes would come back mangled without
 * this. SQLite and Postgres take backslashes literally.
 */
/**
 * Stream a SQL dump of the active database.
 *
 * Yielded in chunks rather than returned whole so a board with long AI drafts
 * does not have to be buffered in memory before the download starts.
 */
export async function* generateSqlBackup(): AsyncGenerator<string> {
  const db = await getAdapter();
  const { provider } = readConfig();
  const now = new Date().toISOString();

  yield [
    `-- Content Calendar backup`,
    `-- Generated: ${now}`,
    `-- Source database: ${provider}`,
    `--`,
    `-- Contains password hashes and encrypted AI provider keys. Treat this file`,
    `-- as a secret. The API keys can only be decrypted by a server using the`,
    `-- same APP_ENCRYPTION_KEY; without it they are unreadable and each user`,
    `-- must enter their key again after a restore.`,
    `--`,
    `-- Active sessions are not included: everyone signs in again after a restore.`,
    `--`,
    `-- Restore into an EMPTY database, e.g.`,
    `--   sqlite3 content_calendar.db < this-file.sql`,
    `--   psql "$DATABASE_URL" -f this-file.sql`,
    `--   mysql -u user -p dbname < this-file.sql`,
    `--`,
    `-- Restoring over a database that already holds rows will fail on duplicate`,
    `-- primary keys. Empty the tables first if that is what you intend.`,
    ``,
    ``,
  ].join("\n");

  // Schema first, so the file restores into a blank database on its own.
  yield `-- ─────────── Schema ───────────\n\n`;
  for (const statement of ddlStatements(provider)) {
    yield `${statement.trim()};\n\n`;
  }

  for (const table of BACKUP_TABLES) {
    const countRows = await db.run(`SELECT COUNT(*) AS n FROM ${table.name}`, [], true);
    const total = Number(countRows[0]?.n ?? countRows[0]?.count ?? 0);

    yield `\n-- ─────────── Data: ${table.name} (${total} row${total === 1 ? "" : "s"}) ───────────\n\n`;
    if (total === 0) continue;

    const columnList = table.columns.join(", ");
    for (let offset = 0; offset < total; offset += BACKUP_BATCH) {
      // Ordered so the batches partition the table deterministically.
      const rows = await db.run(
        `SELECT ${columnList} FROM ${table.name} ORDER BY id LIMIT ${BACKUP_BATCH} OFFSET ${offset}`,
        [],
        true
      );
      let chunk = "";
      for (const row of rows) {
        const values = table.columns
          .map((column) => sqlLiteral(row[column], provider))
          .join(", ");
        chunk += `INSERT INTO ${table.name} (${columnList}) VALUES (${values});\n`;
      }
      yield chunk;
    }
  }

  yield `\n-- End of backup\n`;
}

export interface RestoreResult {
  /** Rows written, per table. */
  inserted: Record<string, number>;
  total: number;
}

/**
 * Replace the contents of the backed-up tables with a parsed backup.
 *
 * Everything happens inside one transaction: on any failure the database is
 * left exactly as it was. That matters more here than anywhere else in the app,
 * because the first thing a restore does is delete every existing row.
 *
 * Rows are written with parameterised queries rather than by executing the
 * uploaded file, so a backup taken from any provider restores into any other —
 * values travel as parameters and never have to survive a second round of
 * dialect-specific quoting.
 */
export async function restoreSqlBackup(parsed: ParsedBackup): Promise<RestoreResult> {
  const db = await getAdapter();
  const inserted: Record<string, number> = {};

  return db.transaction(async (run) => {
    // Sessions go too: the accounts they point at are about to be replaced, so
    // every existing sign-in is meaningless. Everyone signs in again.
    for (const table of [...BACKUP_TABLES].reverse()) {
      await run(`DELETE FROM ${table.name}`, [], false);
    }
    await run("DELETE FROM sessions", [], false);

    let total = 0;
    for (const table of BACKUP_TABLES) {
      const rows = parsed.tables[table.name] ?? [];
      inserted[table.name] = 0;
      if (!rows.length) continue;

      const placeholders = table.columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = table.columns.map((column) =>
          row[column] === undefined ? null : row[column]
        );
        await run(sql, values, false);
        inserted[table.name]++;
        total++;
      }
    }

    // A backup taken before teams existed carries no teams and no memberships,
    // so without this the restored board would belong to no one and be visible
    // to no one. Same adoption the first post-upgrade start performs.
    await backfillTeams(run);

    return { inserted, total };
  });
}

/* ─────────────── Connection test ─────────────── */

// Validate a candidate config by connecting and ensuring the schema.
// Throws with a readable message on failure.
export async function testConfig(config: DbConfig): Promise<void> {
  const adapter = buildAdapter(config);
  await adapter.init();
  await adapter.run("SELECT COUNT(*) FROM content_items", [], true);
}
