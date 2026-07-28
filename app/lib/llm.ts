// Model-provider adapter. Server-side only.
//
// One entry point per operation (generate / generateStream / testConnection),
// dispatching to one of four request shapes:
//
//   anthropic                                  → official @anthropic-ai/sdk
//   openai | openrouter | openai-compatible    → shared POST /chat/completions
//   ollama | ollama-cloud                      → native POST /api/chat
//   huggingface                                → POST {baseUrl}/{model}
//
// Everything a provider can throw is normalised into an LlmError carrying a
// sentence a non-engineer can act on, because that string goes straight into
// the app's `{ error: string }` convention and is shown verbatim in the UI.
//
// API keys never appear in a thrown message, a response, or a log — see
// shortDetail(). Never console.log a connection object.

import { LlmProviderId } from "./db";

/* ─────────────── Provider catalogue ─────────────── */

export interface LlmProviderDescriptor {
  id: LlmProviderId;
  label: string;
  blurb: string;
  apiKey: "required" | "optional" | "none";
  baseUrl: "fixed" | "required" | "optional";
  defaultBaseUrl: string;
  defaultModel: string;
  docsHint: string;
  /** Whether the endpoint reliably honours a JSON *schema* (not just JSON mode). */
  supportsJsonSchema: boolean;
  /** Whether generateStream() can stream incrementally from this provider. */
  supportsStreaming: boolean;
}

export const LLM_PROVIDERS: LlmProviderDescriptor[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    blurb: "Claude models via the official API. Recommended.",
    apiKey: "required",
    baseUrl: "fixed",
    defaultBaseUrl: "",
    defaultModel: "claude-opus-5",
    docsHint: "Create a key at console.anthropic.com under API Keys.",
    supportsJsonSchema: true,
    supportsStreaming: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT models via api.openai.com.",
    apiKey: "required",
    baseUrl: "optional",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    docsHint: "Create a key at platform.openai.com under API keys.",
    supportsJsonSchema: true,
    supportsStreaming: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb: "One key, many models from many vendors.",
    apiKey: "required",
    baseUrl: "optional",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    docsHint: "Model IDs are listed at openrouter.ai/models — use the full slug.",
    supportsJsonSchema: true,
    supportsStreaming: true,
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    blurb:
      "Large open models hosted at ollama.com. Nothing to install, and no GPU needed.",
    apiKey: "required",
    // Left editable rather than fixed so a proxy or self-hosted gateway that
    // speaks the same API can be pointed at.
    baseUrl: "optional",
    defaultBaseUrl: "https://ollama.com",
    defaultModel: "gpt-oss:120b",
    docsHint:
      "Create a key at ollama.com/settings/keys. Leave the base URL as the " +
      "server root — the /api path is added for you. Browse the hosted models " +
      "at ollama.com/search?c=cloud and enter the name with its tag, e.g. " +
      "glm-5.2:cloud or gpt-oss:120b.",
    supportsJsonSchema: true,
    supportsStreaming: true,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    blurb: "A model running on your own machine or network. Usually no API key.",
    // Optional rather than none: a local Ollama behind an authenticating
    // reverse proxy still needs a bearer token.
    apiKey: "optional",
    baseUrl: "required",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    docsHint: "Run `ollama list` to see the models you have pulled.",
    supportsJsonSchema: true,
    supportsStreaming: true,
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    blurb: "Serverless inference for models on the Hub. Slow to warm up.",
    apiKey: "required",
    baseUrl: "optional",
    defaultBaseUrl: "https://api-inference.huggingface.co/models",
    defaultModel: "meta-llama/Llama-3.1-8B-Instruct",
    docsHint:
      "Create a token at huggingface.co/settings/tokens. Not every model is " +
      "served, and cold starts can take a minute. For anything demanding, " +
      "prefer the OpenAI-compatible option pointed at router.huggingface.co/v1.",
    supportsJsonSchema: false,
    supportsStreaming: false,
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    blurb:
      "Groq, Together, Fireworks, LM Studio, vLLM, or anything else serving /chat/completions.",
    apiKey: "optional",
    baseUrl: "required",
    defaultBaseUrl: "",
    defaultModel: "",
    docsHint: "Enter the base URL up to and including /v1.",
    // Conservative: many gateways advertise compatibility but reject a schema.
    supportsJsonSchema: false,
    supportsStreaming: true,
  },
];

export function providerById(id: string): LlmProviderDescriptor | null {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? null;
}

/* ─────────────── Types ─────────────── */

export interface LlmConnection {
  provider: LlmProviderId;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
}

/** A connection with descriptor defaults applied and required fields present. */
interface ResolvedConnection {
  provider: LlmProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface JsonSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface GenerateArgs {
  connection: LlmConnection;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Ask for structured output. Providers without native support get a prompt-level fallback. */
  json?: JsonSpec;
  /** Anthropic only. Lower effort trades some quality for latency. */
  effort?: "low" | "medium" | "high";
  /**
   * Ollama only. Reasoning is ON by default when `think` is unset, and its
   * tokens come out of the same budget as the answer — so a small budget can
   * yield an empty `content`. Set this for cheap probes that just need text.
   */
  disableThinking?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  /** Parsed output when `json` was requested. */
  data?: any;
  model: string;
}

export class LlmError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 50_000;

/* ─────────────── Helpers ─────────────── */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Ollama's base URL is the server root — this client appends `/api/chat`
 * itself. But Ollama's own documentation describes the API as living at
 * `https://ollama.com/api`, so that is what people paste in, which would
 * produce `/api/api/chat` and a 404 that looks like a missing model.
 * Strip a trailing `/api` (or `/v1`) so either form works.
 */
function normalizeOllamaBase(url: string): string {
  return url.replace(/\/(api|v1)$/i, "");
}

/** Apply descriptor defaults and fail early on anything genuinely missing. */
function resolveConnection(
  input: LlmConnection,
  desc: LlmProviderDescriptor
): ResolvedConnection {
  let baseUrl =
    desc.baseUrl === "fixed"
      ? ""
      : trimSlash((input.baseUrl || desc.defaultBaseUrl || "").trim());
  if (desc.id === "ollama" || desc.id === "ollama-cloud") {
    baseUrl = normalizeOllamaBase(baseUrl);
  }
  const model = (input.model || desc.defaultModel || "").trim();
  const apiKey = (input.apiKey || "").trim();

  if (desc.baseUrl === "required" && !baseUrl) {
    throw new LlmError(`${desc.label} needs a base URL. Set one in Settings.`, 400);
  }
  if (!model) {
    throw new LlmError(`${desc.label} needs a model name. Set one in Settings.`, 400);
  }
  if (desc.apiKey === "required" && !apiKey) {
    throw new LlmError(
      `${desc.label} needs an API key. Add one in Settings. ${desc.docsHint}`,
      400
    );
  }
  return { provider: desc.id, apiKey, baseUrl, model };
}

function authHeaders(
  conn: ResolvedConnection,
  desc: LlmProviderDescriptor
): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
  if (desc.id === "openrouter") {
    // OpenRouter uses these to attribute traffic. Optional, but well-behaved.
    headers["HTTP-Referer"] = "https://github.com/";
    headers["X-Title"] = "Content Calendar";
  }
  return headers;
}

/** Combine a caller's abort signal with a timeout. */
function withTimeout(args: GenerateArgs): AbortSignal {
  const timeout = AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
}

/**
 * Read a response, throwing a status-tagged error when it is not OK so that
 * normalizeError() sees every provider failure in the same shape.
 */
async function readJsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? body;
    } catch {
      /* not JSON — use the raw text */
    }
    const err: any = new Error(
      typeof message === "string" ? message : JSON.stringify(message)
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Parse JSON out of a response that may be wrapped in prose or a code fence.
 * Needed for providers without a native JSON mode.
 */
export function parseJsonLoose(text: string): any {
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    /* fall through to the scan */
  }

  // Find the first balanced {...} or [...], ignoring braces inside strings.
  const start = s.search(/[{[]/);
  if (start >= 0) {
    const open = s[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }

  throw new LlmError(
    "The model did not return valid JSON. Try a larger or different model — " +
      "smaller local models often struggle with structured output.",
    502
  );
}

/** Prompt-level JSON instruction for providers with no schema support. */
export function jsonFallbackSuffix(spec: JsonSpec): string {
  return [
    "",
    "Respond with a single JSON object and nothing else. No text before it, no",
    "text after it, and no Markdown code fence.",
    "It must match this schema exactly, including every key on every object:",
    "",
    JSON.stringify(spec.schema, null, 2),
  ].join("\n");
}

/* ─────────────── Error normalisation ─────────────── */

// Redact anything that looks like a credential before it can reach a response
// or a log, even if the provider echoed it back to us.
const KEY_PATTERN = /\b(sk|hf|gsk|xai|or|key)[-_][A-Za-z0-9_-]{8,}/gi;

function shortDetail(e: any): string {
  const raw = String(e?.error?.message ?? e?.message ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const scrubbed = raw.replace(KEY_PATTERN, "[key]");
  return scrubbed.length > 200 ? scrubbed.slice(0, 197) + "…" : scrubbed;
}

function normalizeError(
  e: any,
  desc: LlmProviderDescriptor,
  conn: { baseUrl?: string; model?: string }
): LlmError {
  if (e instanceof LlmError) return e;

  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new LlmError(
      `${desc.label} did not respond in time. Long drafts can exceed the ` +
        "request limit — try again, or switch to a faster model.",
      504
    );
  }

  const code = e?.cause?.code ?? e?.code;
  if (
    e instanceof TypeError ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ECONNRESET"
  ) {
    const where = conn.baseUrl || desc.label;
    return new LlmError(
      desc.id === "ollama"
        ? `Could not reach Ollama at ${where}. Is it running? Start it with \`ollama serve\`.`
        : desc.id === "ollama-cloud"
          ? `Could not reach Ollama Cloud at ${where}. Check your network connection.`
          : `Could not reach ${where}. Check the base URL in Settings.`,
      502
    );
  }

  const status: number | undefined = e?.status ?? e?.statusCode;
  const detail = shortDetail(e);

  if (status === 401 || status === 403) {
    return new LlmError(
      `${desc.label} rejected the API key. Check it in Settings under AI assistant.`,
      400
    );
  }
  if (status === 404) {
    // A 404 can mean the model is missing OR the URL is wrong. Ollama says
    // which: its body reads `path "/api/api/chat" not found`. Blaming the model
    // for a bad base URL sends people hunting for a model that exists.
    if (/path\s+"?[^"]*"?\s+not found/i.test(detail) || /\bnot found\b.*\/api\//i.test(detail)) {
      return new LlmError(
        `${desc.label} has no endpoint at that address. Set the base URL to the ` +
          `server root${desc.defaultBaseUrl ? ` (e.g. ${desc.defaultBaseUrl})` : ""} — ` +
          `the API path is appended automatically.`,
        400
      );
    }
    return new LlmError(
      `${desc.label} has no model called "${conn.model}". ${desc.docsHint}`,
      400
    );
  }
  if (status === 429) {
    return new LlmError(
      `${desc.label} is rate limiting this key. Wait a moment and try again.`,
      429
    );
  }
  if (status === 402) {
    return new LlmError(
      `${desc.label} reports insufficient credit on this account.`,
      400
    );
  }
  if (status === 400 || status === 422) {
    return new LlmError(
      `${desc.label} rejected the request${detail ? `: ${detail}` : "."}`,
      400
    );
  }
  if (typeof status === "number" && status >= 500) {
    return new LlmError(
      `${desc.label} is having trouble right now. Try again shortly.`,
      502
    );
  }
  return new LlmError(
    `${desc.label} request failed${detail ? `: ${detail}` : "."}`,
    502
  );
}

/* ─────────────── Anthropic ─────────────── */

async function anthropicClient(apiKey: string) {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  return new Anthropic({ apiKey, maxRetries: 1 });
}

/**
 * Request body shared by the streaming and non-streaming Anthropic paths.
 *
 * Deliberately absent: temperature / top_p / top_k (rejected with 400 on this
 * model), any `thinking` configuration (adaptive is the default and is what we
 * want), and assistant prefill (also a 400). Structured output goes through
 * output_config.format, never the deprecated top-level output_format.
 *
 * max_tokens caps thinking *and* visible text together, so callers pass a
 * generous value; too small a budget yields an empty content array.
 */
function anthropicBody(conn: ResolvedConnection, args: GenerateArgs) {
  const outputConfig: Record<string, unknown> = {};
  if (args.effort) outputConfig.effort = args.effort;
  if (args.json) {
    outputConfig.format = { type: "json_schema", schema: args.json.schema };
  }

  return {
    model: conn.model,
    max_tokens: args.maxTokens,
    system: args.system || undefined,
    messages: [{ role: "user" as const, content: args.prompt }],
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
  };
}

function anthropicText(res: any): string {
  // Safety classifiers can decline. Check before touching content.
  if (res.stop_reason === "refusal") {
    throw new LlmError(
      "Claude declined to answer this request. Try rephrasing the item's " +
        "headline or description.",
      422
    );
  }
  const text = (res.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();

  if (!text) {
    throw new LlmError(
      "Claude returned an empty response — the token budget was most likely " +
        "consumed by reasoning. Try again.",
      502
    );
  }
  return text;
}

async function generateAnthropic(
  conn: ResolvedConnection,
  args: GenerateArgs
): Promise<GenerateResult> {
  const client = await anthropicClient(conn.apiKey);
  const res: any = await client.messages.create(anthropicBody(conn, args) as any, {
    signal: withTimeout(args),
  });
  const text = anthropicText(res);
  return {
    text,
    data: args.json ? parseJsonLoose(text) : undefined,
    model: res.model ?? conn.model,
  };
}

async function* streamAnthropic(
  conn: ResolvedConnection,
  args: GenerateArgs
): AsyncIterable<string> {
  const client = await anthropicClient(conn.apiKey);
  const stream = client.messages.stream(anthropicBody(conn, args) as any, {
    signal: withTimeout(args),
  });

  let sawText = false;
  for await (const event of stream as any) {
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta" &&
      event.delta.text
    ) {
      sawText = true;
      yield event.delta.text as string;
    }
  }

  const final: any = await (stream as any).finalMessage();
  if (final?.stop_reason === "refusal") {
    throw new LlmError(
      "Claude declined to answer this request. Try rephrasing the item's " +
        "headline or description.",
      422
    );
  }
  if (!sawText) {
    throw new LlmError(
      "Claude returned an empty response — the token budget was most likely " +
        "consumed by reasoning. Try again.",
      502
    );
  }
}

/* ─────────────── OpenAI-compatible (openai / openrouter / generic) ─────────────── */

function openAiBody(
  conn: ResolvedConnection,
  desc: LlmProviderDescriptor,
  args: GenerateArgs,
  stream: boolean
): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (args.system) messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: args.prompt });

  const body: Record<string, unknown> = {
    model: conn.model,
    max_tokens: args.maxTokens,
    messages,
    stream,
  };

  if (args.json) {
    body.response_format = desc.supportsJsonSchema
      ? {
          type: "json_schema",
          json_schema: { name: args.json.name, schema: args.json.schema, strict: true },
        }
      : { type: "json_object" };
  }
  return body;
}

async function generateOpenAiCompatible(
  conn: ResolvedConnection,
  desc: LlmProviderDescriptor,
  args: GenerateArgs
): Promise<GenerateResult> {
  const url = `${conn.baseUrl}/chat/completions`;
  const headers = authHeaders(conn, desc);
  const body = openAiBody(conn, desc, args, false);
  const signal = withTimeout(args);

  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });

  // Exactly one fallback step. Many gateways advertise OpenAI compatibility but
  // reject response_format; drop it and lean on the prompt-level instruction.
  // A second retry would blow the request time budget.
  if (res.status === 400 && args.json) {
    delete body.response_format;
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  }

  const payload = await readJsonOrThrow(res);
  const text = String(payload?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new LlmError(`${desc.label} returned an empty response.`, 502);

  return {
    text,
    data: args.json ? parseJsonLoose(text) : undefined,
    model: payload?.model ?? conn.model,
  };
}

async function* streamOpenAiCompatible(
  conn: ResolvedConnection,
  desc: LlmProviderDescriptor,
  args: GenerateArgs
): AsyncIterable<string> {
  const res = await fetch(`${conn.baseUrl}/chat/completions`, {
    method: "POST",
    headers: authHeaders(conn, desc),
    body: JSON.stringify(openAiBody(conn, desc, args, true)),
    signal: withTimeout(args),
  });
  if (!res.ok || !res.body) {
    await readJsonOrThrow(res); // throws with the provider's own message
    throw new LlmError(`${desc.label} returned no response body.`, 502);
  }

  // Server-sent events: "data: {...}\n\n", terminated by "data: [DONE]".
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        /* keep-alive or partial frame — ignore */
      }
    }
  }
}

/* ─────────────── Ollama (local and Cloud) ─────────────── */

// Ollama Cloud serves the same native API as a local install, so both share
// these functions. The only differences are the host, the bearer token, and
// how a connection is proved (see testConnection).

function ollamaHeaders(conn: ResolvedConnection): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Required by ollama.com; also allows a local instance behind an
  // authenticating proxy.
  if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
  return headers;
}

function ollamaBody(
  conn: ResolvedConnection,
  args: GenerateArgs,
  stream: boolean
): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (args.system) messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: args.prompt });

  const body: Record<string, unknown> = {
    model: conn.model,
    stream,
    messages,
    options: { num_predict: args.maxTokens },
  };
  // Omitting `think` means "model default", which for reasoning models is ON.
  if (args.disableThinking) body.think = false;
  // The native endpoint accepts a JSON schema here; older builds want "json".
  if (args.json) body.format = args.json.schema;
  return body;
}

/**
 * Ollama splits reasoning models' output into `message.thinking` and
 * `message.content`, and `num_predict` caps the two together. A budget spent
 * entirely on reasoning therefore returns an empty answer — which is a very
 * different problem from a provider returning nothing at all, and needs a
 * different fix from the user.
 */
function emptyOllamaError(
  sawThinking: boolean,
  conn: ResolvedConnection,
  label: string
): LlmError {
  return new LlmError(
    sawThinking
      ? `${label} used its whole token budget reasoning and produced no answer. ` +
        `"${conn.model}" is a reasoning model — allow more tokens, or choose a ` +
        `model that does not think before answering.`
      : `${label} returned an empty response.`,
    502
  );
}

async function generateOllama(
  conn: ResolvedConnection,
  args: GenerateArgs
): Promise<GenerateResult> {
  const url = `${conn.baseUrl}/api/chat`;
  const headers = ollamaHeaders(conn);
  const body = ollamaBody(conn, args, false);
  const signal = withTimeout(args);

  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  // One fallback step, covering both an older server that wants format:"json"
  // and one that rejects the `think` field outright.
  if (res.status === 400 && (args.json || args.disableThinking)) {
    if (args.json) body.format = "json";
    delete body.think;
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  }

  const payload = await readJsonOrThrow(res);
  const label = conn.provider === "ollama-cloud" ? "Ollama Cloud" : "Ollama";
  const text = String(payload?.message?.content ?? "").trim();
  if (!text) {
    throw emptyOllamaError(
      Boolean(String(payload?.message?.thinking ?? "").trim()),
      conn,
      label
    );
  }

  return {
    text,
    data: args.json ? parseJsonLoose(text) : undefined,
    model: payload?.model ?? conn.model,
  };
}

async function* streamOllama(
  conn: ResolvedConnection,
  args: GenerateArgs
): AsyncIterable<string> {
  const res = await fetch(`${conn.baseUrl}/api/chat`, {
    method: "POST",
    headers: ollamaHeaders(conn),
    body: JSON.stringify(ollamaBody(conn, args, true)),
    signal: withTimeout(args),
  });
  const label = conn.provider === "ollama-cloud" ? "Ollama Cloud" : "Ollama";
  if (!res.ok || !res.body) {
    await readJsonOrThrow(res);
    throw new LlmError(`${label} returned no response body.`, 502);
  }

  // Ollama streams newline-delimited JSON, not SSE. Reasoning models emit
  // `message.thinking` frames first; those are not shown — the user asked for
  // an outline, not the model's deliberation — but they are tracked so an
  // answerless stream can explain itself.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawContent = false;
  let sawThinking = false;
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line);
        if (String(frame?.message?.thinking ?? "").trim()) sawThinking = true;
        const delta = frame?.message?.content;
        if (delta) {
          sawContent = true;
          yield delta as string;
        }
        if (frame?.done) {
          finished = true;
          break;
        }
      } catch {
        /* partial frame — ignore */
      }
    }
  }

  if (!sawContent) throw emptyOllamaError(sawThinking, conn, label);
}

/* ─────────────── Hugging Face ─────────────── */

async function generateHuggingFace(
  conn: ResolvedConnection,
  args: GenerateArgs
): Promise<GenerateResult> {
  const res = await fetch(`${conn.baseUrl}/${conn.model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conn.apiKey}`,
    },
    body: JSON.stringify({
      inputs: args.system ? `${args.system}\n\n${args.prompt}` : args.prompt,
      parameters: { max_new_tokens: args.maxTokens, return_full_text: false },
      options: { wait_for_model: true },
    }),
    signal: withTimeout(args),
  });

  const payload = await readJsonOrThrow(res);
  // Response shape varies by task: [{generated_text}] | {generated_text} | [[{…}]]
  const text = String(
    Array.isArray(payload)
      ? payload[0]?.generated_text ?? payload[0]?.[0]?.generated_text ?? ""
      : payload?.generated_text ?? ""
  ).trim();
  if (!text) throw new LlmError("Hugging Face returned no generated text.", 502);

  return {
    text,
    data: args.json ? parseJsonLoose(text) : undefined,
    model: conn.model,
  };
}

/* ─────────────── Public entry points ─────────────── */

/** Append the prompt-level JSON instruction where the wire format can't carry one. */
function withJsonFallback(args: GenerateArgs, desc: LlmProviderDescriptor): GenerateArgs {
  if (!args.json || desc.id === "anthropic") return args;
  return { ...args, prompt: `${args.prompt}\n${jsonFallbackSuffix(args.json)}` };
}

export async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const desc = providerById(args.connection.provider);
  if (!desc) {
    throw new LlmError(`Unknown AI provider: ${args.connection.provider}`, 400);
  }
  const conn = resolveConnection(args.connection, desc);
  const effective = withJsonFallback(args, desc);

  try {
    switch (desc.id) {
      case "anthropic":
        return await generateAnthropic(conn, effective);
      case "ollama":
      case "ollama-cloud":
        return await generateOllama(conn, effective);
      case "huggingface":
        return await generateHuggingFace(conn, effective);
      default:
        return await generateOpenAiCompatible(conn, desc, effective);
    }
  } catch (e) {
    throw normalizeError(e, desc, conn);
  }
}

/**
 * Stream generated text. Providers without streaming support fall back to a
 * single chunk, so callers never need to branch on provider.
 */
export async function* generateStream(args: GenerateArgs): AsyncIterable<string> {
  const desc = providerById(args.connection.provider);
  if (!desc) {
    throw new LlmError(`Unknown AI provider: ${args.connection.provider}`, 400);
  }
  const conn = resolveConnection(args.connection, desc);
  const effective = withJsonFallback(args, desc);

  try {
    if (!desc.supportsStreaming) {
      const result = await generate(args);
      yield result.text;
      return;
    }
    switch (desc.id) {
      case "anthropic":
        yield* streamAnthropic(conn, effective);
        return;
      case "ollama":
      case "ollama-cloud":
        yield* streamOllama(conn, effective);
        return;
      default:
        yield* streamOpenAiCompatible(conn, desc, effective);
        return;
    }
  } catch (e) {
    throw normalizeError(e, desc, conn);
  }
}

/**
 * Turn "no model called X" from Ollama Cloud into something actionable by
 * naming models that do exist. Best effort — a failure here leaves the
 * original message untouched.
 */
async function withCloudModelSuggestions(
  e: any,
  conn: ResolvedConnection
): Promise<any> {
  if (!(e instanceof LlmError) || !/no model called/i.test(e.message)) return e;
  try {
    const res = await fetch(`${conn.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return e;
    const payload = await res.json();
    const names: string[] = (payload?.models ?? [])
      .map((m: any) => m?.name)
      .filter(Boolean);
    if (!names.length) return e;
    return new LlmError(
      `${e.message} Currently hosted: ${names.slice(0, 10).join(", ")}.`,
      400
    );
  } catch {
    return e;
  }
}

/**
 * Prove a connection works without spending meaningful tokens. Mirrors
 * testConfig() for databases: connect, verify, persist nothing.
 */
export async function testConnection(
  input: LlmConnection
): Promise<{ model: string; note?: string }> {
  const desc = providerById(input.provider);
  if (!desc) throw new LlmError(`Unknown AI provider: ${input.provider}`, 400);
  const conn = resolveConnection(input, desc);
  const signal = AbortSignal.timeout(20_000);

  try {
    switch (desc.id) {
      case "anthropic": {
        // Validates the key and the model id, and costs no tokens.
        const client = await anthropicClient(conn.apiKey);
        const model: any = await client.models.retrieve(conn.model, null, { signal });
        return { model: model?.id ?? conn.model };
      }

      case "ollama-cloud": {
        // /api/tags does list the hosted catalogue, but it needs no key, so it
        // cannot prove the key entered here works. It also lists bare names
        // (glm-5.2) while model pages document a ":cloud" alias (glm-5.2:cloud)
        // that is equally valid — so absence from that list is not evidence a
        // model is wrong. A one-token generation settles key and model at once.
        try {
          await generate({
            connection: input,
            system: "",
            prompt: "Reply with the single word OK.",
            // think:false plus real headroom. Most hosted models here reason by
            // default, and reasoning shares this budget with the answer — a
            // tight cap returns an empty answer rather than a failure.
            disableThinking: true,
            maxTokens: 512,
            timeoutMs: 30_000,
          });
        } catch (e: any) {
          throw await withCloudModelSuggestions(e, conn);
        }
        return { model: conn.model };
      }

      case "ollama": {
        const res = await fetch(`${conn.baseUrl}/api/tags`, {
          headers: ollamaHeaders(conn),
          signal,
        });
        const payload = await readJsonOrThrow(res);
        const names: string[] = (payload?.models ?? []).map((m: any) => m.name);
        const installed = names.some(
          (n) => n === conn.model || n.startsWith(`${conn.model}:`)
        );
        if (!installed) {
          throw new LlmError(
            `Ollama is reachable, but "${conn.model}" is not installed. ` +
              `Available: ${names.slice(0, 8).join(", ") || "none"}. ` +
              `Run \`ollama pull ${conn.model}\`.`,
            404
          );
        }
        return { model: conn.model };
      }

      case "huggingface": {
        // No cheap listing endpoint, so a small generation is the only honest
        // probe. The budget is generous rather than minimal: a reasoning model
        // given a few tokens spends them all thinking and returns nothing,
        // which reads as a broken connection when it is merely a tight cap.
        await generate({
          connection: input,
          system: "",
          prompt: "Reply with the single word OK.",
          maxTokens: 512,
          // Cold starts on the serverless Inference API are routinely slow.
          timeoutMs: 40_000,
        });
        return { model: conn.model };
      }

      default: {
        const res = await fetch(`${conn.baseUrl}/models`, {
          headers: authHeaders(conn, desc),
          signal,
        });
        const payload = await readJsonOrThrow(res);
        const ids: string[] = (payload?.data ?? []).map((m: any) => m.id);
        // Some gateways return a partial list, so a miss is a note, not a failure.
        if (ids.length && !ids.includes(conn.model)) {
          return {
            model: conn.model,
            note: `Connected, but "${conn.model}" was not in this endpoint's model list. It may still work.`,
          };
        }
        return { model: conn.model };
      }
    }
  } catch (e) {
    throw normalizeError(e, desc, conn);
  }
}
