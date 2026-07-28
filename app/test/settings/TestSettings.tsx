"use client";

// Test-mode settings: just the AI connection, so the generation features can be
// tried without an account.
//
// This is deliberately not the signed-in settings form. That one carries a
// stored secret forward without showing it, because the key lives server-side.
// Here the key lives in this tab and nowhere else, so it is simply held and
// cleared — different semantics, and a much smaller surface.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { leaveTo } from "../../lib/useAuth";
import {
  clearTestSession,
  readTestConnection,
  testLlmConnection,
  writeTestConnection,
} from "../../lib/store";

type LlmProvider = {
  id: string;
  label: string;
  blurb: string;
  apiKey: "required" | "optional" | "none";
  baseUrl: "fixed" | "required" | "optional";
  defaultBaseUrl: string;
  defaultModel: string;
  docsHint: string;
};

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";
const labelClass =
  "mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]";
const primaryButton =
  "rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50";
const secondaryButton =
  "rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-50";

type Message = { type: "success" | "error"; text: string } | null;

export default function TestSettings() {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerId, setProviderId] = useState("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [saved, setSaved] = useState(false);

  const applyProvider = useCallback((p: LlmProvider, stored?: ReturnType<typeof readTestConnection>) => {
    setProviderId(p.id);
    setBaseUrl(
      p.baseUrl === "fixed" ? "" : stored?.baseUrl ?? p.defaultBaseUrl ?? ""
    );
    setModel(stored?.model ?? p.defaultModel ?? "");
  }, []);

  const load = useCallback(
    () =>
      fetch("/api/llm/providers")
        .then((r) => r.json())
        .then((data) => {
          const list: LlmProvider[] = data.providers ?? [];
          setProviders(list);

          const stored = readTestConnection();
          const chosen =
            list.find((p) => p.id === (stored?.provider ?? "anthropic")) ?? list[0];
          if (chosen) {
            applyProvider(chosen, stored?.provider === chosen.id ? stored : undefined);
            if (stored?.provider === chosen.id) {
              setApiKey(stored.apiKey ?? "");
              setSaved(true);
            }
          }
        })
        .catch(() =>
          setMessage({ type: "error", text: "Could not load the provider list." })
        )
        .finally(() => setLoading(false)),
    [applyProvider]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const descriptor = providers.find((p) => p.id === providerId) ?? null;

  const connection = () => ({
    provider: providerId,
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim() || null,
    model: model.trim() || null,
  });

  const runTest = async () => {
    setBusy("test");
    setMessage(null);
    try {
      const data = await testLlmConnection(connection());
      setMessage({ type: "success", text: data.note ?? `Connected. Using ${data.model}.` });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      // Prove it works before keeping it, so the board's AI buttons only ever
      // appear for a connection that actually responded.
      await testLlmConnection(connection());
      writeTestConnection(connection());
      setSaved(true);
      setMessage({
        type: "success",
        text: "Connection ready. The AI buttons are now available on the board.",
      });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const forget = () => {
    writeTestConnection(null);
    setApiKey("");
    setSaved(false);
    setMessage({ type: "success", text: "Connection removed from this tab." });
  };

  return (
    <div className="min-h-screen bg-[var(--background)] pb-16">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/test"
            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface)]"
          >
            ← Back
          </Link>
          <h1 className="text-base font-semibold tracking-tight text-[var(--foreground)] md:text-lg">
            Test settings
          </h1>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-[#2e2618] dark:text-amber-200">
            Test mode
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8 md:px-6">
        <div>
          <h2 className="mb-1 text-lg font-semibold text-[var(--foreground)]">
            AI assistant
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Connect a model provider to try the outline, draft, and brainstorm
            features. The key is held in this browser tab only — it is never sent
            to the database and is gone when the tab closes.
          </p>
        </div>

        {loading ? (
          <div className="skeleton h-40 w-full rounded-xl" />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    applyProvider(p);
                    setMessage(null);
                  }}
                  className={`rounded-xl border p-4 text-left transition ${
                    providerId === p.id
                      ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] hover:bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--foreground)]">
                      {p.label}
                    </span>
                    {providerId === p.id && <span className="text-[var(--accent)]">✓</span>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{p.blurb}</p>
                </button>
              ))}
            </div>

            {descriptor && (
              <div className="space-y-4">
                {descriptor.baseUrl !== "fixed" && (
                  <div>
                    <label className={labelClass}>
                      Base URL{descriptor.baseUrl === "optional" ? " (optional)" : ""}
                    </label>
                    <input
                      className={inputClass}
                      placeholder={descriptor.defaultBaseUrl || "https://…"}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    className={inputClass}
                    placeholder={descriptor.defaultModel || "model name"}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
                {descriptor.apiKey !== "none" && (
                  <div>
                    <label className={labelClass}>
                      API key{descriptor.apiKey === "optional" ? " (optional)" : ""}
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      className={inputClass}
                      placeholder="Paste your key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                )}
                <p className="text-xs text-[var(--muted)]">{descriptor.docsHint}</p>
              </div>
            )}

            {message && (
              <div
                role="alert"
                className={`rounded-lg border px-4 py-3 text-sm ${
                  message.type === "success"
                    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-[#1a2e1a] dark:text-green-300"
                    : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300"
                }`}
              >
                {message.text}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={save} disabled={busy !== null} className={primaryButton}>
                {busy === "save" ? "Checking…" : "Use this connection"}
              </button>
              <button onClick={runTest} disabled={busy !== null} className={secondaryButton}>
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
              {saved && (
                <button
                  onClick={forget}
                  disabled={busy !== null}
                  className="rounded-lg border border-[var(--danger)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-hover)] hover:text-white disabled:opacity-50"
                >
                  Forget key
                </button>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-[var(--border)] pt-6">
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Leave test mode? Everything on the board is discarded. Export to CSV first if you want to keep it."
                )
              ) {
                clearTestSession();
                leaveTo("/login");
              }
            }}
            className={secondaryButton}
          >
            Exit test mode
          </button>
        </div>
      </main>

      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] border-t border-amber-300 bg-amber-50/95 px-4 py-2.5 text-center text-xs text-amber-900 backdrop-blur-sm dark:border-amber-800 dark:bg-[#2e2618]/95 dark:text-amber-200"
        style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
      >
        <span className="font-semibold">Test mode — nothing is saved.</span> No
        database is read or written. Everything you create here is discarded when you
        close this tab; use <span className="font-semibold">Export CSV</span> to keep
        it.
      </div>
    </div>
  );
}
