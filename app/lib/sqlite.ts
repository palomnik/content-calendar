import initSqlJs from "sql.js";

let db: any = null;
let SQL: any = null;
const IDB_KEY = "content_calendar_db";

const CREATE_TABLE = `
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
  );
`;

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

/* ---------- IndexedDB helpers ---------- */

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ContentCalendarDB", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const req = store.get(key);
    req.onsuccess = () => {
      const result = req.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else if (result instanceof Uint8Array) {
        resolve(result);
      } else if (result instanceof Blob) {
        const reader = new FileReader();
        reader.onloadend = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = reject;
        reader.readAsArrayBuffer(result);
      } else {
        resolve(undefined);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, data: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const req = store.put(data.buffer, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ---------- Persistence ---------- */

async function saveDbToDisk() {
  if (!db) return;
  try {
    const data = db.export() as Uint8Array;
    await idbSet(IDB_KEY, data);
  } catch (e) {
    console.error("Failed to save DB:", e);
  }
}

/* ---------- Init ---------- */

export async function initDb(): Promise<void> {
  if (db) return;
  SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });

  const saved = await idbGet(IDB_KEY);
  if (saved) {
    db = new SQL.Database(saved);
  } else {
    db = new SQL.Database();
  }

  db.run(CREATE_TABLE);
  await saveDbToDisk();
}

/* ---------- Row mapping ---------- */

function rowToItem(row: any[]): any {
  return {
    id: row[0],
    createdAt: row[1],
    updatedAt: row[2],
    headline: row[3],
    description: row[4],
    format: row[5],
    keywords: row[6],
    targetReader: row[7],
    platform: row[8],
    internalLinks: row[9],
    externalLinks: row[10],
    wordCount: row[11],
    contentStatus: row[12],
    dueDate: row[13],
    publishDate: row[14],
    writer: row[15],
    promotionPlan: row[16],
    smes: row[17],
    gdriveLink: row[18],
    notes: row[19],
  };
}

/* ---------- CRUD ---------- */

export function getAllItems(): any[] {
  if (!db) throw new Error("DB not initialized");
  const stmt = db.prepare("SELECT * FROM content_items ORDER BY created_at DESC");
  const items: any[] = [];
  while (stmt.step()) {
    items.push(rowToItem(stmt.get()));
  }
  stmt.free();
  return items;
}

export async function createItem(data: any): Promise<any> {
  if (!db) throw new Error("DB not initialized");
  const id = generateId();
  const now = new Date().toISOString();
  const {
    headline, description, format, keywords, targetReader,
    platform, internalLinks, externalLinks, wordCount,
    contentStatus, dueDate, publishDate, writer,
    promotionPlan, smes, gdriveLink, notes,
  } = data;

  db.run(
    `INSERT INTO content_items (id, created_at, updated_at, headline, description, format, keywords, target_reader, platform, internal_links, external_links, word_count, content_status, due_date, publish_date, writer, promotion_plan, smes, gdrive_link, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, now, now,
      headline ?? null, description ?? null, format ?? null,
      keywords ?? null, targetReader ?? null, platform ?? null,
      internalLinks ?? null, externalLinks ?? null, wordCount ?? null,
      contentStatus ?? "Brainstormed", dueDate ?? null, publishDate ?? null,
      writer ?? null, promotionPlan ?? null, smes ?? null,
      gdriveLink ?? null, notes ?? null,
    ]
  );
  await saveDbToDisk();

  const stmt = db.prepare("SELECT * FROM content_items WHERE id = ?");
  stmt.bind([id]);
  let item = null;
  if (stmt.step()) item = rowToItem(stmt.get());
  stmt.free();
  return item;
}

export async function updateItem(id: string, data: any): Promise<any> {
  if (!db) throw new Error("DB not initialized");
  const now = new Date().toISOString();
  const setClause: string[] = [];
  const values: any[] = [];

  const fieldMap: Record<string, string> = {
    headline: "headline", description: "description", format: "format",
    keywords: "keywords", targetReader: "target_reader", platform: "platform",
    internalLinks: "internal_links", externalLinks: "external_links",
    wordCount: "word_count", contentStatus: "content_status",
    dueDate: "due_date", publishDate: "publish_date", writer: "writer",
    promotionPlan: "promotion_plan", smes: "smes", gdriveLink: "gdrive_link",
    notes: "notes",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (data[key] !== undefined) {
      setClause.push(`${col} = ?`);
      values.push(data[key] ?? null);
    }
  }

  if (setClause.length === 0) return null;
  values.push(now, id);
  db.run(
    `UPDATE content_items SET ${setClause.join(", ")}, updated_at = ? WHERE id = ?`,
    values
  );
  await saveDbToDisk();

  const stmt = db.prepare("SELECT * FROM content_items WHERE id = ?");
  stmt.bind([id]);
  let item = null;
  if (stmt.step()) item = rowToItem(stmt.get());
  stmt.free();
  return item;
}

export async function deleteItem(id: string): Promise<void> {
  if (!db) throw new Error("DB not initialized");
  db.run("DELETE FROM content_items WHERE id = ?", [id]);
  await saveDbToDisk();
}

/* ---------- CSV Export / Import ---------- */

const CSV_HEADERS = [
  "id", "created_at", "updated_at", "headline", "description", "format",
  "keywords", "target_reader", "platform", "internal_links", "external_links",
  "word_count", "content_status", "due_date", "publish_date", "writer",
  "promotion_plan", "smes", "gdrive_link", "notes",
];

function escapeCsv(value: string | null): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function exportCsv(items: any[]): string {
  const rows = items.map((item) =>
    CSV_HEADERS.map((h) => escapeCsv(item[h] ?? "")).join(",")
  );
  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

export function parseCsv(csvText: string): any[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  const items: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        if (inQuotes && line[j + 1] === '"') {
          current += '"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);

    const item: Record<string, any> = {};
    headers.forEach((h, idx) => {
      const raw = values[idx]?.trim() ?? "";
      if (h === "word_count") {
        item[h] = raw ? parseInt(raw, 10) : null;
      } else {
        item[h] = raw || null;
      }
    });
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
