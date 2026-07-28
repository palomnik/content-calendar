// Prompts for the three AI actions: outline a Brainstormed item, draft an
// Outlined one, and propose a batch of items for a campaign.
//
// The rules that matter most here are the ones that stop the model inventing
// evidence. A fabricated statistic in a draft gets copied verbatim by a writer
// who assumes it was researched, which is the single failure mode that makes
// AI drafts worse than useless.

export interface PromptPair {
  system: string;
  prompt: string;
}

/**
 * Render an item's populated fields as a bullet list.
 *
 * Empty fields are omitted rather than shown as blank: a wall of
 * "Platform: (none)" teaches the model that blanks are normal and it starts
 * producing them.
 */
function describeItem(item: any): string {
  const rows: [string, unknown][] = [
    ["Headline", item.headline],
    ["Description", item.description],
    ["Format", item.format],
    ["Platform", item.platform],
    ["Target reader", item.targetReader],
    ["Keywords", item.keywords],
    ["Target word count", item.wordCount],
    ["Writer", item.writer],
    ["Subject-matter experts", item.smes],
    ["Promotion plan", item.promotionPlan],
    ["Internal links to include", item.internalLinks],
    ["External references", item.externalLinks],
    ["Due date", item.dueDate],
    ["Publish date", item.publishDate],
  ];
  const lines = rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `- ${k}: ${String(v).trim()}`);
  return lines.length
    ? lines.join("\n")
    : "- (no details supplied beyond the headline)";
}

/* ─────────────── Outline ─────────────── */

export function buildOutlinePrompt(item: any): PromptPair {
  const system = [
    "You are a content strategist working inside an editorial calendar.",
    "You turn a one-line content idea into an outline a writer can draft from",
    "without needing a further briefing.",
    "",
    "Rules:",
    "- Output Markdown only. No preamble, no sign-off, no 'Here is your outline'.",
    "- Use an H2 for each major section, with bullets beneath it.",
    "- Under every section, say what it must accomplish for the reader, not just",
    "  what it is about.",
    "- Open with a suggested hook and close with a call to action.",
    "- Where a claim would need evidence, write 'Evidence needed: <what kind>'",
    "  rather than inventing a statistic, study, or quotation.",
    "- Do not invent product names, customer names, or numbers that were not given.",
    "- When a target word count is given, aim for roughly one H2 per 250-400 words.",
  ].join("\n");

  const notes = String(item.notes ?? "").trim();
  const prompt = [
    "Write an outline for this piece of content.",
    "",
    describeItem(item),
    "",
    notes
      ? `Existing notes from the team — treat these as instructions, not as content to repeat:\n${notes}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/* ─────────────── Draft ─────────────── */

export function buildDraftPrompt(item: any): PromptPair {
  const system = [
    "You are a writer producing a first draft from an approved outline.",
    "",
    "Rules:",
    "- Output Markdown only. No preamble and no meta-commentary.",
    "- Follow the outline's structure and section order. Do not add or drop sections.",
    "- Write full prose. Use bullets only where the outline calls for a list.",
    "- Where the outline says 'Evidence needed', write the sentence and mark it",
    "  `[CITATION NEEDED: what to find]`. Never invent a statistic, a study, a",
    "  quotation, or a customer name.",
    "- Put anything else you are unsure of in `[TK: ...]` so a human can resolve it.",
    "- Write for the stated target reader at the stated length. Do not pad to reach",
    "  a word count.",
    "- No emoji. No heading above H2 — the headline is the H1.",
  ].join("\n");

  const prompt = [
    "Write the first draft.",
    "",
    describeItem(item),
    "",
    "Approved outline and team notes:",
    "",
    String(item.notes ?? "").trim(),
  ].join("\n");

  return { system, prompt };
}

/* ─────────────── Campaign brainstorm ─────────────── */

export interface BrainstormInput {
  campaignName: string;
  campaignGoal: string;
  leadAvatar: string;
  painPoints: string;
  desires: string;
  count: number;
  defaults?: Record<string, string>;
}

export function buildBrainstormPrompt(input: BrainstormInput): PromptPair {
  const system = [
    "You are a content strategist planning a campaign for an editorial calendar.",
    "You produce distinct, non-overlapping content ideas that together move one",
    "audience toward one goal.",
    "",
    "Rules:",
    `- Return exactly ${input.count} items.`,
    "- Every item must take a different angle. Two items a reader would confuse",
    "  for each other is a failure.",
    "- Vary the funnel stage across the set: some awareness, some consideration,",
    "  some decision.",
    "- Headlines must be specific and concrete. Never produce 'The Ultimate Guide",
    "  to X' or 'Everything You Need to Know About X'.",
    "- The description gives, in two or three sentences, the argument the piece",
    "  makes and which pain point or desire it addresses.",
    "- Keywords are 3-6 comma-separated search phrases a real person would type,",
    "  not hashtags.",
    "- Do not invent product features, prices, statistics, or customer names.",
    "- Leave a field as an empty string when you have nothing useful to say.",
    "  Do not pad.",
  ].join("\n");

  const defaults = input.defaults
    ? Object.entries(input.defaults).filter(([, v]) => v && String(v).trim())
    : [];

  const prompt = [
    `Campaign: ${input.campaignName}`,
    `Goal: ${input.campaignGoal}`,
    "",
    `Lead avatar: ${input.leadAvatar}`,
    input.painPoints ? `Pain points: ${input.painPoints}` : "",
    input.desires ? `Desires: ${input.desires}` : "",
    "",
    defaults.length
      ? "Apply these to every item unless the idea demands otherwise:\n" +
        defaults.map(([k, v]) => `- ${k}: ${v}`).join("\n")
      : "",
    "",
    `Produce ${input.count} content items.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/**
 * Schema for structured output.
 *
 * Constrained by what the structured-output APIs accept: every object needs
 * `additionalProperties: false`, every property must be listed in `required`,
 * and item-count constraints (minItems/maxItems) are not supported — the count
 * is enforced by the prompt and then by a server-side slice.
 *
 * `contentStatus` is deliberately absent. The server always sets
 * "Brainstormed"; the model does not get to choose a workflow state.
 */
const ITEM_PROPERTIES = {
  headline: {
    type: "string",
    description:
      "The working title. Specific and concrete, roughly 40-90 characters.",
  },
  description: {
    type: "string",
    description:
      "Two or three sentences: the argument the piece makes and the pain point or desire it addresses.",
  },
  format: {
    type: "string",
    description:
      "e.g. Blog post, Case study, Video, Webinar, Email, Landing page. Empty string if unspecified.",
  },
  keywords: {
    type: "string",
    description:
      "3-6 comma-separated search phrases. Empty string if none apply.",
  },
  targetReader: {
    type: "string",
    description: "Who this specific item is for, drawn from the lead avatar.",
  },
  platform: {
    type: "string",
    description:
      "Where it will be published, e.g. Company blog, LinkedIn, YouTube. Empty string if unspecified.",
  },
  wordCount: {
    type: "integer",
    description: "Suggested length in words. Use 0 for non-written formats.",
  },
  promotionPlan: {
    type: "string",
    description:
      "One sentence on how this item gets distributed. Empty string if none.",
  },
  notes: {
    type: "string",
    description:
      "Angle, hook, or research direction for the writer. Empty string if none.",
  },
} as const;

export const BRAINSTORM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "The content ideas, in the order they should be produced.",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(ITEM_PROPERTIES),
        properties: ITEM_PROPERTIES,
      },
    },
  },
} as Record<string, unknown>;

/* ─────────────── Write-back ─────────────── */

/**
 * Fold generated text into an item's notes.
 *
 * Always appends under a dated heading — a writer's own notes are never
 * overwritten, and an outline stays visible above the draft written from it.
 */
export function composeNotes(
  existing: string | null | undefined,
  task: "outline" | "draft",
  text: string
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const heading = task === "outline" ? "AI outline" : "AI draft";
  const block = `## ${heading} — ${stamp}\n\n${text.trim()}\n`;
  const prior = String(existing ?? "").trim();
  return prior ? `${prior}\n\n---\n\n${block}` : block;
}
