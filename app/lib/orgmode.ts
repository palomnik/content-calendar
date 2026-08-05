// Org mode export.
//
// Every item becomes a top-level TODO heading. Items with a due date carry an
// org DEADLINE line so they show up in the agenda; items without one are still
// exported — dropping them would silently lose records — they just have no
// deadline.
//
// This module must stay free of server-only imports: the browser builds the
// file and downloads it directly, the same way CSV and .ics export do.

export interface OrgRecord {
  headline: string;
  dueDate?: string | null;
}

// Fixed abbreviations rather than toLocaleDateString: org's agenda parses the
// day name, and a machine running under a non-English locale would otherwise
// emit "Mi" or "mer." into the timestamp.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-07-28" or "2026-07-28T00:00:00Z" → "2026-07-28 Tue". Null if unparseable. */
export function toOrgDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Parsed as UTC so the weekday matches the date as written, not as shifted
  // into the viewer's timezone.
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${day} ${DAY_NAMES[date.getUTCDay()]}`;
}

/** A heading is one line by definition — a newline in a title would end it,
 *  and the leftover text could be read as a new heading or drawer. */
function sanitizeHeadline(headline: string): string {
  const clean = headline.replace(/\s+/g, " ").trim();
  return clean || "Untitled";
}

/** Render items as an org file: `* TODO <title>` plus a DEADLINE line. */
export function buildOrg(items: OrgRecord[]): string {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`* TODO ${sanitizeHeadline(item.headline)}`);
    const deadline = toOrgDate(item.dueDate);
    if (deadline) lines.push(`DEADLINE: <${deadline}>`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
