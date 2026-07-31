// The single definition of a content item's fields.
//
// Four things need to agree about this list — the INSERT column order, the
// camelCase/snake_case mapping used by updates, the row-to-object conversion,
// and the CSV header row. They used to be four hand-maintained lists, and the
// CSV one drifted: it looked up snake_case keys on camelCase objects, so
// eleven of twenty columns exported silently blank. Deriving all four from
// here makes that class of bug impossible.
//
// This module must stay free of server-only imports (fs, node:crypto, the
// database drivers) because the client-side CSV code imports it too.

export interface ItemField {
  /** camelCase — what the API returns and accepts. */
  key: string;
  /** snake_case — the database column, and the CSV header. */
  column: string;
  type: "text" | "number";
  /** Server-assigned. Exported for reference, ignored on import. */
  readOnly?: boolean;
}

export const ITEM_FIELDS: ItemField[] = [
  { key: "id", column: "id", type: "text", readOnly: true },
  { key: "createdAt", column: "created_at", type: "text", readOnly: true },
  { key: "updatedAt", column: "updated_at", type: "text", readOnly: true },
  { key: "headline", column: "headline", type: "text" },
  { key: "description", column: "description", type: "text" },
  { key: "format", column: "format", type: "text" },
  { key: "keywords", column: "keywords", type: "text" },
  { key: "targetReader", column: "target_reader", type: "text" },
  { key: "platform", column: "platform", type: "text" },
  { key: "internalLinks", column: "internal_links", type: "text" },
  { key: "externalLinks", column: "external_links", type: "text" },
  { key: "wordCount", column: "word_count", type: "number" },
  { key: "contentStatus", column: "content_status", type: "text" },
  { key: "dueDate", column: "due_date", type: "text" },
  { key: "publishDate", column: "publish_date", type: "text" },
  { key: "writer", column: "writer", type: "text" },
  { key: "promotionPlan", column: "promotion_plan", type: "text" },
  { key: "smes", column: "smes", type: "text" },
  { key: "gdriveLink", column: "gdrive_link", type: "text" },
  { key: "notes", column: "notes", type: "text" },
  // Appended, never inserted mid-list: the CSV header order and the INSERT
  // column order both come from this array, and a file exported before a new
  // field existed must still import cleanly.
  { key: "contextFileName", column: "context_file_name", type: "text" },
  { key: "contextFile", column: "context_file", type: "text" },
];

/**
 * How much of an uploaded context file is kept.
 *
 * The whole file is sent to the model on every outline and draft, so this is a
 * cost ceiling as much as a storage one — roughly 10k tokens. Files above it
 * are rejected at the point of upload rather than silently truncated: a brand
 * voice guide that loses its last third produces drafts that look fine and are
 * subtly wrong.
 */
export const MAX_CONTEXT_FILE_CHARS = 40000;

/** Fields a caller may set — everything except the server-assigned ones. */
export const EDITABLE_ITEM_FIELDS = ITEM_FIELDS.filter((f) => !f.readOnly);

/** Database column order. Used verbatim by the INSERT statement. */
export const ITEM_COLUMNS = ITEM_FIELDS.map((f) => f.column);

/** camelCase → snake_case, for the fields an update may touch. */
export const ITEM_FIELD_MAP: Record<string, string> = Object.fromEntries(
  EDITABLE_ITEM_FIELDS.map((f) => [f.key, f.column])
);

/**
 * Resolve a CSV header to a field, accepting either spelling.
 *
 * Files exported by this app use snake_case, but people also hand-build
 * spreadsheets from the API's camelCase names, and spreadsheet apps love to
 * change capitalisation and spacing. Match generously.
 */
export function fieldForHeader(header: string): ItemField | null {
  const normalized = header
    .trim()
    .replace(/^﻿/, "") // stray BOM on the first header
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (
    ITEM_FIELDS.find(
      (f) =>
        f.column === normalized ||
        f.key.toLowerCase() === normalized ||
        f.key.toLowerCase() === normalized.replace(/_/g, "")
    ) ?? null
  );
}
