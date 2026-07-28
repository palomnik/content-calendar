// iCalendar (RFC 5545) export.
//
// Every item contributes up to two all-day events — one on its due date, one
// on its publish date — so a subscriber sees both deadlines in Google
// Calendar, Apple Calendar or Outlook. Items with neither date are skipped.
//
// This module must stay free of server-only imports: the browser builds the
// file and downloads it directly, the same way CSV export works.

const CRLF = "\r\n";
const PRODID = "-//Content Calendar//EN";

export interface IcsRecord {
  id: string;
  headline: string;
  description?: string | null;
  format?: string | null;
  platform?: string | null;
  writer?: string | null;
  keywords?: string | null;
  targetReader?: string | null;
  wordCount?: number | null;
  contentStatus?: string | null;
  dueDate?: string | null;
  publishDate?: string | null;
  gdriveLink?: string | null;
  notes?: string | null;
}

/** Escape the reserved characters in a TEXT value. Order matters — the
 *  backslash rule has to run first or it would double-escape the others. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** UTF-8 size of a single code point, used to fold on octets rather than
 *  characters — splitting a multi-byte character across lines corrupts it. */
function byteLength(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** Fold a content line to 75 octets, continuation lines starting with a space. */
function fold(line: string): string {
  const limit = 74; // 75 octets minus the leading space on continuations
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = byteLength(ch);
    if (bytes + size > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(CRLF);
}

/** "2026-07-28" or "2026-07-28T00:00:00Z" → "20260728". Null if unparseable. */
function toDateValue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return day.replace(/-/g, "");
}

/** All-day DTEND is exclusive, so a one-day event ends on the following day. */
function nextDayValue(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6));
  const date = Number(day.slice(6, 8));
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, "");
}

function stamp(now: Date): string {
  return `${now.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** Human-readable body for the event, built from whichever fields are set. */
function buildDescription(item: IcsRecord, kind: "due" | "publish"): string {
  const lines: string[] = [];
  const other =
    kind === "due"
      ? item.publishDate && `Publish date: ${String(item.publishDate).slice(0, 10)}`
      : item.dueDate && `Due date: ${String(item.dueDate).slice(0, 10)}`;

  if (item.description) lines.push(String(item.description).trim());
  const facts: string[] = [];
  if (item.contentStatus) facts.push(`Status: ${item.contentStatus}`);
  if (item.format) facts.push(`Format: ${item.format}`);
  if (item.platform) facts.push(`Platform: ${item.platform}`);
  if (item.writer) facts.push(`Writer: ${item.writer}`);
  if (item.targetReader) facts.push(`Target reader: ${item.targetReader}`);
  if (item.keywords) facts.push(`Keywords: ${item.keywords}`);
  if (item.wordCount != null) facts.push(`Word count: ${item.wordCount}`);
  if (other) facts.push(other);
  if (facts.length) lines.push(facts.join("\n"));
  if (item.gdriveLink) lines.push(String(item.gdriveLink).trim());
  if (item.notes) lines.push(`Notes:\n${String(item.notes).trim()}`);

  return lines.join("\n\n");
}

function buildEvent(
  item: IcsRecord,
  kind: "due" | "publish",
  day: string,
  dtstamp: string
): string[] {
  const summary =
    kind === "due"
      ? `Due: ${item.headline || "Untitled"}`
      : `Publish: ${item.headline || "Untitled"}`;

  const lines = [
    "BEGIN:VEVENT",
    // Stable per item and per date field, so re-importing updates the same
    // events instead of duplicating them.
    `UID:${item.id}-${kind}@content-calendar`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${nextDayValue(day)}`,
    `SUMMARY:${escapeText(summary)}`,
  ];

  const description = buildDescription(item, kind);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (item.contentStatus) lines.push(`CATEGORIES:${escapeText(item.contentStatus)}`);
  if (item.gdriveLink) lines.push(`URL:${escapeText(String(item.gdriveLink).trim())}`);
  lines.push("TRANSP:TRANSPARENT");
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Render items as an iCalendar file. `now` is injectable so the output is
 * deterministic in tests.
 */
export function buildIcs(
  items: IcsRecord[],
  calendarName = "Content Calendar",
  now: Date = new Date()
): string {
  const dtstamp = stamp(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `NAME:${escapeText(calendarName)}`,
  ];

  for (const item of items) {
    const due = toDateValue(item.dueDate);
    if (due) lines.push(...buildEvent(item, "due", due, dtstamp));
    const publish = toDateValue(item.publishDate);
    if (publish) lines.push(...buildEvent(item, "publish", publish, dtstamp));
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}

/** How many events `buildIcs` would emit — used to label the download button. */
export function countIcsEvents(items: IcsRecord[]): number {
  let count = 0;
  for (const item of items) {
    if (toDateValue(item.dueDate)) count++;
    if (toDateValue(item.publishDate)) count++;
  }
  return count;
}
