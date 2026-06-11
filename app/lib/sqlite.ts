// Client-side data layer — talks to server API routes
// All data persists in the server-side SQLite database (content_calendar.db)

const API_BASE = "/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function initDb(): Promise<void> {
  // Server handles DB init automatically; no-op on client
}

export async function getAllItems(): Promise<any[]> {
  return api<any[]>("/items");
}

export async function createItem(data: any): Promise<any> {
  return api<any>("/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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
