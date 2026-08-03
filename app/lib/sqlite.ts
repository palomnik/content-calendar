// Client-side data layer — talks to server API routes
// All data persists in the server-side SQLite database (content_calendar.db)

import { redirectToLogin } from "./useAuth";
import { fieldForHeader, ITEM_FIELDS } from "./fields";

const API_BASE = "/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    // Session expired or revoked mid-session — send them back to sign in
    // rather than surfacing a confusing error in the UI.
    if (res.status === 401) {
      redirectToLogin();
      throw new Error("Your session has expired. Redirecting to sign in…");
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function initDb(): Promise<void> {
  // Server handles DB init automatically; no-op on client
}

/* ─────────────── AI assistant ─────────────── */

/** Whether the signed-in user can generate — their own connection or a team default. */
export async function getLlmStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/llm/connection`);
    if (!res.ok) return { configured: false };
    const data = await res.json();
    return { configured: Boolean(data.effectiveSource) };
  } catch {
    return { configured: false };
  }
}

/**
 * Stream an outline or draft, yielding text as it arrives.
 *
 * Cannot go through api() above, which calls res.json() on the whole body — so
 * the 401 redirect is reproduced here rather than inherited.
 */
export async function* streamGeneration(
  itemId: string,
  task: "outline" | "draft",
  signal?: AbortSignal
): AsyncGenerator<string> {
  const res = await fetch(`${API_BASE}/llm/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, task }),
    signal,
  });

  if (!res.ok) {
    if (res.status === 401) {
      redirectToLogin();
      throw new Error("Your session has expired. Redirecting to sign in…");
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error("The server returned no response body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!raw) continue;

      let frame: any;
      try {
        frame = JSON.parse(raw);
      } catch {
        continue; // partial or malformed frame
      }
      if (frame.type === "delta" && frame.text) yield frame.text as string;
      else if (frame.type === "error") throw new Error(frame.error);
      else if (frame.type === "done") return;
    }
  }
}

export async function brainstormItems(body: any): Promise<{ items: any[] }> {
  return api<{ items: any[] }>("/llm/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ─────────────── Teams ─────────────── */

export interface Team {
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** Admin listing only. */
  memberIds?: string[];
  itemCount?: number;
}

/** The teams this user belongs to — the boards they can open. */
export async function getMyTeams(): Promise<Team[]> {
  const { teams } = await api<{ teams: Team[] }>("/teams");
  return teams;
}

/** Every team, with membership and item counts. Admin only, server-enforced. */
export async function getAllTeams(): Promise<Team[]> {
  const { teams } = await api<{ teams: Team[] }>("/teams?all=1");
  return teams;
}

export async function createTeam(name: string, memberIds: string[]): Promise<Team> {
  return api<Team>("/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, memberIds }),
  });
}

export async function updateTeam(
  id: string,
  patch: { name?: string; memberIds?: string[] }
): Promise<Team> {
  return api<Team>(`/teams/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/**
 * Delete a team.
 *
 * Without `deleteItems` the server refuses a team that still holds items and
 * answers 409 with the count, which is what the confirmation prompt is built
 * from — the caller asks, then repeats the call having been told the cost.
 */
export async function deleteTeam(
  id: string,
  deleteItems = false
): Promise<{ deletedItems: number }> {
  const res = await fetch(
    `${API_BASE}/teams/${id}${deleteItems ? "?deleteItems=true" : ""}`,
    { method: "DELETE" }
  );
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    const err: any = new Error(body.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.itemCount = body.itemCount;
    throw err;
  }
  return body;
}

/* ─────────────── Items ─────────────── */

export async function getAllItems(teamId: string | null): Promise<any[]> {
  return api<any[]>(teamId ? `/items?teamId=${encodeURIComponent(teamId)}` : "/items");
}

export async function createItem(data: any, teamId: string | null): Promise<any> {
  return api<any>("/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The server takes this as a request, not an instruction: it creates the
    // item only if the session actually belongs to that team.
    body: JSON.stringify({ ...data, teamId }),
  });
}

export async function updateItem(id: string, data: any): Promise<any> {
  return api<any>(`/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteItem(id: string): Promise<void> {
  await api<void>(`/items/${id}`, { method: "DELETE" });
}

/* ---------- CSV Export / Import ---------- */

// Every column comes from the shared field list, so an export can never quietly
// omit a field that exists. Headers are the snake_case database names.
const CSV_HEADERS = ITEM_FIELDS.map((f) => f.column);

// Excel assumes the system codepage unless a file starts with a UTF-8 byte
// order mark, which mangles accented names in `writer` and `smes`.
const UTF8_BOM = "﻿";

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  // Quote anything a reader could mangle. Leading/trailing whitespace is
  // included: an unquoted field gets trimmed on the way back in, which would
  // silently shorten a note that ends in a blank line.
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r") ||
    str !== str.trim()
  ) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Every field of every item, including the server-assigned id and timestamps.
 *
 * Items arrive from the API in camelCase; the CSV is written with the
 * snake_case column names. Reading `item[header]` directly — as this once did —
 * silently blanks every multi-word field.
 */
export function exportCsv(items: any[]): string {
  const rows = items.map((item) =>
    ITEM_FIELDS.map((field) => escapeCsv(item[field.key])).join(",")
  );
  // CRLF is what RFC 4180 specifies and what spreadsheet apps expect.
  return UTF8_BOM + [CSV_HEADERS.join(","), ...rows].join("\r\n") + "\r\n";
}

/**
 * Split a whole CSV document into rows of fields.
 *
 * Done in one pass over the text rather than line by line, because a quoted
 * field may legitimately contain newlines — `notes` and `description` routinely
 * do, and this app's own export writes them that way.
 */
interface CsvCell {
  value: string;
  /**
   * Whether the field was quoted in the source.
   *
   * This decides whether trimming is safe. A quoted field is exact — a note
   * ending in a blank line must keep it — whereas an unquoted one is usually
   * hand-typed, where stray spaces are noise.
   */
  quoted: boolean;
}

function splitCsv(text: string): CsvCell[][] {
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let started = false; // distinguishes an empty trailing line from a real row

  const endField = () => {
    row.push({ value: field, quoted });
    field = "";
    quoted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      quoted = true;
      started = true;
    } else if (char === ",") {
      endField();
      started = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (started || field !== "" || row.length) {
        endField();
        rows.push(row);
      }
      row = [];
      field = "";
      quoted = false;
      started = false;
    } else {
      field += char;
      started = true;
    }
  }
  if (started || field !== "" || row.length) {
    endField();
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a CSV into items ready for createItem().
 *
 * Accepts either snake_case (what this app exports) or camelCase (what the API
 * uses) headers, in any order, and ignores columns it does not recognise.
 * Returns camelCase keys — the shape createItem expects.
 *
 * id / createdAt / updatedAt are parsed but dropped: an import creates new
 * items, and the server assigns those.
 */
export function parseCsv(csvText: string): any[] {
  const rows = splitCsv(csvText.replace(/^﻿/, ""));
  if (rows.length < 2) return [];

  // Unrecognised headers map to null and are skipped, so a spreadsheet with
  // extra working columns still imports cleanly.
  const fields = rows[0].map((h) => fieldForHeader(h.value));
  const items: any[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // A row of nothing but empty cells is padding, not an item.
    if (!cells.some((c) => c.value.trim() !== "")) continue;

    const item: Record<string, any> = {};
    fields.forEach((field, idx) => {
      if (!field || field.readOnly) return;
      const cell = cells[idx];
      // A quoted field is reproduced exactly. Trimming here is what used to
      // clip the final newline off a multi-line note.
      const raw = cell ? (cell.quoted ? cell.value : cell.value.trim()) : "";
      if (field.type === "number") {
        const trimmed = raw.trim();
        const n = Number(trimmed);
        item[field.key] = trimmed && Number.isFinite(n) ? Math.round(n) : null;
      } else {
        item[field.key] = raw === "" ? null : raw;
      }
    });

    // Headline is the only NOT NULL column; a row without one cannot be saved.
    if (!item.headline) continue;
    items.push(item);
  }

  return items;
}

/* ---------- Browser download helper ---------- */

export function browserDownload(data: Uint8Array | string, filename: string, type: string) {
  const blob = typeof data === "string"
    ? new Blob([data], { type })
    : new Blob([data as any], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
