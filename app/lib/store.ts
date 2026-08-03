// Where the board gets its data.
//
// Two implementations behind one interface: the live store talks to the API
// (and therefore the database), and the test store keeps everything in the
// browser tab. Test mode exists so someone can try the app — including the AI
// features with their own key — without a database being read or written at
// all, so nothing here may fall through to an API route that touches one.

"use client";

import {
  brainstormItems,
  createItem,
  deleteItem,
  getAllItems,
  getLlmStatus,
  streamGeneration,
  updateItem,
} from "./sqlite";

export interface ItemStore {
  /**
   * Items on one team's board.
   *
   * The team id is passed on every read and create because the live board is
   * per-team. Test mode has no teams — there is no account and no database to
   * partition — so its store takes the argument and ignores it.
   */
  getAll(teamId: string | null): Promise<any[]>;
  create(data: any, teamId: string | null): Promise<any>;
  update(id: string, data: any): Promise<any>;
  remove(id: string): Promise<void>;
  /** Whether AI features should be offered. */
  llmConfigured(): Promise<boolean>;
  streamGeneration(
    item: any,
    task: "outline" | "draft",
    signal?: AbortSignal
  ): AsyncGenerator<string>;
  brainstorm(body: any): Promise<{ items: any[] }>;
}

/* ─────────────── Live: the database, via the API ─────────────── */

export const liveStore: ItemStore = {
  getAll: (teamId) => getAllItems(teamId),
  create: (data, teamId) => createItem(data, teamId),
  update: (id, data) => updateItem(id, data),
  remove: (id) => deleteItem(id),
  llmConfigured: async () => (await getLlmStatus()).configured,
  streamGeneration: (item, task, signal) => streamGeneration(item.id, task, signal),
  brainstorm: (body) => brainstormItems(body),
};

/* ─────────────── Test: this browser tab only ─────────────── */

const ITEMS_KEY = "cc_test_items";
const CONNECTION_KEY = "cc_test_llm";

/**
 * sessionStorage, not memory: the board and settings are separate pages, so a
 * navigation between them would otherwise discard everything. It is still
 * per-tab and dies with the tab, which is what "does not persist" means here.
 */
function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, or storage disabled. The board keeps working from React
    // state for this page view; the CSV export is the real safety net.
  }
}

export interface TestConnection {
  provider: string;
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

export function readTestConnection(): TestConnection | null {
  return readJson<TestConnection | null>(CONNECTION_KEY, null);
}

export function writeTestConnection(conn: TestConnection | null): void {
  if (conn) writeJson(CONNECTION_KEY, conn);
  else if (typeof window !== "undefined") window.sessionStorage.removeItem(CONNECTION_KEY);
}

export function clearTestSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ITEMS_KEY);
  window.sessionStorage.removeItem(CONNECTION_KEY);
}

/** Same shape as the server's generateId, so ids look native. */
function testId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/** Fill in every field the board expects, so test rows and live rows match. */
function normalizeTestItem(data: any, existing?: any): any {
  const now = new Date().toISOString();
  // Caller data is layered over the defaults, then the server-assigned fields
  // are applied last so an incoming id or timestamp cannot override them.
  const supplied = Object.fromEntries(
    Object.entries(data ?? {}).filter(
      ([k]) => k !== "id" && k !== "createdAt" && k !== "updatedAt"
    )
  );
  return {
    headline: "",
    description: null,
    format: null,
    keywords: null,
    targetReader: null,
    platform: null,
    internalLinks: null,
    externalLinks: null,
    wordCount: null,
    contentStatus: "Brainstormed",
    dueDate: null,
    publishDate: null,
    writer: null,
    promotionPlan: null,
    smes: null,
    gdriveLink: null,
    notes: null,
    contextFileName: null,
    contextFile: null,
    ...(existing ?? {}),
    ...supplied,
    id: existing?.id ?? testId(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** Ask a test-mode endpoint, which never reads or writes the database. */
async function postTest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const testStore: ItemStore = {
  async getAll() {
    return readJson<any[]>(ITEMS_KEY, []);
  },

  async create(data) {
    const items = readJson<any[]>(ITEMS_KEY, []);
    const item = normalizeTestItem(data);
    writeJson(ITEMS_KEY, [item, ...items]);
    return item;
  },

  async update(id, data) {
    const items = readJson<any[]>(ITEMS_KEY, []);
    const existing = items.find((i) => i.id === id);
    if (!existing) return null;
    const updated = normalizeTestItem(data, existing);
    writeJson(ITEMS_KEY, items.map((i) => (i.id === id ? updated : i)));
    return updated;
  },

  async remove(id) {
    const items = readJson<any[]>(ITEMS_KEY, []);
    writeJson(ITEMS_KEY, items.filter((i) => i.id !== id));
  },

  async llmConfigured() {
    return readTestConnection() !== null;
  },

  async *streamGeneration(item, task, signal) {
    const connection = readTestConnection();
    if (!connection) {
      throw new Error("No AI connection is set up. Add one in test settings.");
    }

    const res = await fetch("/api/llm/test-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection, item, task }),
      signal,
    });
    if (!res.ok) {
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
          continue;
        }
        if (frame.type === "delta" && frame.text) yield frame.text as string;
        else if (frame.type === "error") throw new Error(frame.error);
        else if (frame.type === "done") return;
      }
    }
  },

  async brainstorm(body) {
    const connection = readTestConnection();
    if (!connection) {
      throw new Error("No AI connection is set up. Add one in test settings.");
    }
    return postTest<{ items: any[] }>("/api/llm/test-brainstorm", {
      ...body,
      connection,
    });
  },
};

/** Prove a connection works without saving it anywhere. */
export function testLlmConnection(connection: TestConnection) {
  return postTest<{ ok: true; model: string; note?: string }>(
    "/api/llm/test-connection",
    { connection }
  );
}
