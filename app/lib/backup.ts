// Backup file format: what goes in a dump, how values are written, and how a
// dump is read back.
//
// The restore path deliberately **parses** a backup rather than executing it.
// Running an uploaded .sql file against the live database would let anyone who
// can reach the admin account run arbitrary SQL — DROP included. Parsing the
// INSERT statements and re-inserting through parameterised queries keeps the
// blast radius to "rows in three known tables", and has a second benefit: the
// values travel as parameters, so a dump taken from any provider restores into
// any other.

import type { Provider } from "./db";
import { ITEM_COLUMNS } from "./fields";

/**
 * Tables included in a backup, in restore order.
 *
 * `sessions` is deliberately absent. Sessions are short-lived credentials, not
 * content — restoring them would resurrect sign-ins that were meant to have
 * expired, and everyone signs in again after a restore anyway.
 */
export const BACKUP_TABLES: { name: string; columns: string[] }[] = [
  // Users first: llm_connections rows are meaningless without their owners.
  {
    name: "users",
    columns: [
      "id",
      "created_at",
      "updated_at",
      "username",
      "display_name",
      "password_hash",
      "role",
    ],
  },
  // Teams before memberships, and both before items, so the file reads in
  // dependency order even though nothing here declares a foreign key.
  {
    name: "teams",
    columns: ["id", "created_at", "updated_at", "name"],
  },
  {
    name: "team_members",
    columns: ["id", "team_id", "user_id", "created_at"],
  },
  // team_id is appended rather than living in ITEM_FIELDS, which is what keeps
  // it out of the CSV — a board is a permission boundary, not a spreadsheet
  // column someone can retype. A backup still has to carry it.
  { name: "content_items", columns: [...ITEM_COLUMNS, "team_id"] },
  {
    name: "llm_connections",
    columns: [
      "id",
      "user_id",
      "created_at",
      "updated_at",
      "provider",
      "api_key",
      "base_url",
      "model",
    ],
  },
];

export const BACKUP_TABLE_NAMES = BACKUP_TABLES.map((t) => t.name);

/** Columns that hold a number rather than text, per table. */
const NUMERIC_COLUMNS = new Set(["word_count"]);

function isMysql(provider: Provider): boolean {
  return provider === "mysql" || provider === "mariadb";
}

/* ─────────────── Writing ─────────────── */

/**
 * Render a value as a SQL literal for the given provider.
 *
 * Two dialect hazards are handled here:
 *
 *  • MySQL treats a backslash as an escape inside string literals, so a Windows
 *    path or a regex in someone's notes would come back mangled.
 *
 *  • A literal carriage return cannot appear in the file at all. Command-line
 *    restore tools read input line by line and strip CR as a line terminator —
 *    verified: sqlite3 turns 'a\r\nb' into 'a\nb', silently rewriting the data.
 *    It is emitted as an expression instead so the byte never appears.
 */
export function sqlLiteral(value: unknown, provider: Provider): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return `'${value.toISOString()}'`;

  const text = String(value);
  const mysql = isMysql(provider);

  const quote = (s: string) => {
    const escaped = mysql ? s.replace(/\\/g, "\\\\") : s;
    return `'${escaped.replace(/'/g, "''")}'`;
  };

  if (text.includes("\r")) {
    if (mysql) {
      // MySQL understands \r as an escape sequence, so no concatenation needed.
      return quote(text).replace(/\r/g, "\\r");
    }
    const cr = provider === "postgres" ? "chr(13)" : "char(13)";
    return text
      .split("\r")
      .map((part) => quote(part))
      .join(` || ${cr} || `);
  }

  return quote(text);
}

/* ─────────────── Reading ─────────────── */

export interface ParsedBackup {
  /** Provider the dump was taken from, when the header records it. */
  sourceProvider: Provider | null;
  generatedAt: string | null;
  /** Rows keyed by table name, each row keyed by column name. */
  tables: Record<string, Record<string, unknown>[]>;
  counts: Record<string, number>;
  /** Recognised-but-ignored issues worth telling the user about. */
  warnings: string[];
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupParseError";
  }
}

/**
 * Split a SQL document into statements, respecting string literals, line
 * comments, and (for MySQL dumps) backslash escapes.
 */
function splitStatements(text: string, mysqlEscapes: boolean): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      current += char;
      if (mysqlEscapes && char === "\\" && i + 1 < text.length) {
        current += text[++i]; // escaped character is part of the literal
        continue;
      }
      if (char === "'") {
        if (text[i + 1] === "'") {
          current += text[++i]; // doubled quote, still inside the literal
        } else {
          inString = false;
        }
      }
      continue;
    }

    // `-- comment` runs to end of line, and only outside a string.
    if (char === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (char === "'") {
      inString = true;
      current += char;
    } else if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Undo the escaping applied by sqlLiteral for a single quoted literal. */
function decodeQuoted(literal: string, mysqlEscapes: boolean): string {
  let body = literal.slice(1, -1).replace(/''/g, "'");
  if (mysqlEscapes) {
    body = body.replace(/\\(.)/g, (_, c: string) => {
      switch (c) {
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "0":
          return "\0";
        case "b":
          return "\b";
        case "Z":
          return "\x1a";
        default:
          return c; // \\ and \' collapse to the character itself
      }
    });
  }
  return body;
}

/**
 * Parse one value expression from a VALUES list.
 *
 * Handles the forms this app emits: NULL, a number, a quoted string, and a
 * `'a' || char(13) || 'b'` concatenation used to carry carriage returns.
 */
function parseValue(expr: string, mysqlEscapes: boolean): unknown {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  if (/^null$/i.test(trimmed)) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Concatenation of literals and char()/chr() calls.
  const parts: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;

    if (trimmed[i] === "'") {
      let j = i + 1;
      let literal = "'";
      while (j < trimmed.length) {
        const c = trimmed[j];
        literal += c;
        if (mysqlEscapes && c === "\\" && j + 1 < trimmed.length) {
          literal += trimmed[++j];
          j++;
          continue;
        }
        if (c === "'") {
          if (trimmed[j + 1] === "'") {
            literal += trimmed[++j];
            j++;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      parts.push(decodeQuoted(literal, mysqlEscapes));
      i = j;
    } else {
      const call = /^(?:char|chr)\s*\(\s*(\d+)\s*\)/i.exec(trimmed.slice(i));
      if (call) {
        parts.push(String.fromCharCode(Number(call[1])));
        i += call[0].length;
      } else if (trimmed.startsWith("||", i)) {
        i += 2;
      } else {
        throw new BackupParseError(
          `Unsupported value in the backup file: ${trimmed.slice(0, 60)}`
        );
      }
    }
  }
  return parts.join("");
}

/** Split a VALUES tuple into its top-level expressions. */
function splitTuple(tuple: string, mysqlEscapes: boolean): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < tuple.length; i++) {
    const char = tuple[i];
    if (inString) {
      current += char;
      if (mysqlEscapes && char === "\\" && i + 1 < tuple.length) {
        current += tuple[++i];
        continue;
      }
      if (char === "'") {
        if (tuple[i + 1] === "'") current += tuple[++i];
        else inString = false;
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
    } else if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * Read a backup file into rows.
 *
 * Only INSERT statements against the known tables are used; CREATE TABLE and
 * anything else is ignored rather than executed. Throws when the file is not a
 * backup at all, or when a row cannot be understood — nothing is written to the
 * database until the whole file has parsed cleanly.
 */
export function parseSqlBackup(text: string): ParsedBackup {
  const headerProvider = /--\s*Source database:\s*(\w+)/i.exec(text)?.[1]?.toLowerCase();
  const sourceProvider = (["sqlite", "mysql", "mariadb", "postgres"] as const).includes(
    headerProvider as any
  )
    ? (headerProvider as Provider)
    : null;
  const generatedAt = /--\s*Generated:\s*(\S+)/i.exec(text)?.[1] ?? null;

  if (text.includes("BACKUP FAILED PART WAY THROUGH")) {
    throw new BackupParseError(
      "This backup file records that it did not finish downloading. It is incomplete — take a fresh backup rather than restoring from it."
    );
  }

  // Only a MySQL-sourced dump uses backslash escapes. Guessing wrong would
  // corrupt every backslash in the data, so it is read from the header.
  const mysqlEscapes = sourceProvider ? isMysql(sourceProvider) : false;

  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  for (const table of BACKUP_TABLES) {
    tables[table.name] = [];
    counts[table.name] = 0;
  }

  const known = new Map(BACKUP_TABLES.map((t) => [t.name, t]));
  const skippedTables = new Set<string>();
  let sawInsert = false;

  for (const statement of splitStatements(text, mysqlEscapes)) {
    const match = /^INSERT\s+INTO\s+`?(\w+)`?\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)$/i.exec(
      statement
    );
    if (!match) continue;
    sawInsert = true;

    const [, tableName, columnList, valueList] = match;
    const table = known.get(tableName.toLowerCase());
    if (!table) {
      // Not an error: a dump from a future version may carry extra tables.
      skippedTables.add(tableName);
      continue;
    }

    const columns = columnList.split(",").map((c) => c.trim().replace(/`|"/g, ""));
    const values = splitTuple(valueList, mysqlEscapes);
    if (columns.length !== values.length) {
      throw new BackupParseError(
        `A row for "${tableName}" lists ${columns.length} columns but ${values.length} values.`
      );
    }

    const row: Record<string, unknown> = {};
    columns.forEach((column, idx) => {
      if (!table.columns.includes(column)) return; // unknown column: ignore
      const parsed = parseValue(values[idx], mysqlEscapes);
      row[column] =
        NUMERIC_COLUMNS.has(column) && parsed !== null ? Number(parsed) : parsed;
    });

    tables[table.name].push(row);
    counts[table.name]++;
  }

  if (!sawInsert) {
    throw new BackupParseError(
      "No rows were found in that file. It does not look like a Content Calendar backup."
    );
  }
  if (skippedTables.size) {
    warnings.push(
      `Ignored rows for unrecognised table${skippedTables.size === 1 ? "" : "s"}: ${[...skippedTables].join(", ")}.`
    );
  }

  return { sourceProvider, generatedAt, tables, counts, warnings };
}
