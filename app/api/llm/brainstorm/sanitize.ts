// Coercion for model-proposed items, shared by the signed-in and test-mode
// brainstorm routes so both apply exactly the same guards.

export function str(value: unknown, max = 2000): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

/**
 * Turn one model-proposed item into something safe to create.
 *
 * Unknown keys are dropped, every field is clamped, and contentStatus is forced
 * — the model never chooses a workflow state. Returns null when the row has no
 * headline, which is the one column that cannot be null.
 */
export function sanitizeDraftItem(raw: any, defaults: Record<string, string>) {
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
  };
}
