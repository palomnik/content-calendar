// Coercion for model-proposed items, shared by the signed-in and test-mode
// brainstorm routes so both apply exactly the same guards.

export function str(value: unknown, max = 2000): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

/** The uploaded campaign context, copied onto every item it produced. */
export interface ContextFile {
  name: string;
  content: string;
}

/**
 * Turn one model-proposed item into something safe to create.
 *
 * Unknown keys are dropped, every field is clamped, and contentStatus is forced
 * — the model never chooses a workflow state. Returns null when the row has no
 * headline, which is the one column that cannot be null.
 *
 * The context file is stored on each item rather than referenced from a shared
 * row. It costs some duplication, and buys three things this app depends on:
 * the item survives a CSV round trip intact, test mode needs no server storage
 * at all, and an outline generated a year later still uses the brand voice the
 * idea was conceived under, even if the file has since been replaced.
 */
export function sanitizeDraftItem(
  raw: any,
  defaults: Record<string, string>,
  context?: ContextFile | null
) {
  const headline = str(raw?.headline, 300);
  if (!headline) return null;

  const pick = (key: string, fallbackKey?: string) =>
    str(raw?.[key], 4000) || (fallbackKey ? defaults[fallbackKey] ?? "" : "");

  const wordCount = Number(raw?.wordCount);

  return {
    headline,
    description: str(raw?.description, 4000),
    format: pick("format", "format"),
    keywords: str(raw?.keywords, 1000),
    targetReader: pick("targetReader", "targetReader"),
    platform: pick("platform", "platform"),
    internalLinks: "",
    externalLinks: "",
    wordCount: Number.isFinite(wordCount) && wordCount > 0 ? Math.round(wordCount) : null,
    contentStatus: "Brainstormed",
    dueDate: defaults.dueDate || null,
    publishDate: defaults.publishDate || null,
    writer: defaults.writer || "",
    promotionPlan: str(raw?.promotionPlan, 2000),
    smes: "",
    gdriveLink: "",
    notes: str(raw?.notes, 4000),
    contextFileName: context?.name || "",
    contextFile: context?.content || "",
  };
}
