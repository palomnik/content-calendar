"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Provider = "sqlite" | "mysql" | "mariadb" | "postgres";

const PROVIDERS: { value: Provider; label: string; blurb: string }[] = [
  { value: "sqlite", label: "SQLite (built-in)", blurb: "Zero-config local file database. Default." },
  { value: "mysql", label: "MySQL", blurb: "Connect to an external MySQL server." },
  { value: "mariadb", label: "MariaDB", blurb: "Connect to an external MariaDB server." },
  { value: "postgres", label: "PostgreSQL", blurb: "Connect to an external PostgreSQL server." },
];

const EMPTY_CONN = { host: "", port: "", user: "", password: "", database: "" };

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";
const labelClass =
  "mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]";

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("sqlite");
  const [conn, setConn] = useState({ ...EMPTY_CONN });
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        setProvider(cfg.provider || "sqlite");
        if (cfg.connection) {
          setConn({
            host: cfg.connection.host || "",
            port: cfg.connection.port ? String(cfg.connection.port) : "",
            user: cfg.connection.user || "",
            password: "",
            database: cfg.connection.database || "",
          });
          setHasStoredPassword(Boolean(cfg.connection.hasPassword));
        }
      })
      .catch(() => setMessage({ type: "error", text: "Failed to load current configuration." }))
      .finally(() => setLoading(false));
  }, []);

  const isExternal = provider !== "sqlite";
  const defaultPort = provider === "postgres" ? "5432" : "3306";

  const buildBody = (test: boolean) => ({
    provider,
    test,
    connection: isExternal
      ? {
          host: conn.host.trim(),
          port: conn.port.trim() ? Number(conn.port) : Number(defaultPort),
          user: conn.user.trim(),
          password: conn.password,
          database: conn.database.trim(),
        }
      : undefined,
  });

  const submit = async (test: boolean) => {
    setBusy(test ? "test" : "save");
    setMessage(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(test)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMessage({
        type: "success",
        text: test
          ? "Connection successful."
          : `Saved. The app is now using ${PROVIDERS.find((p) => p.value === provider)?.label}.`,
      });
      if (!test && isExternal && conn.password) setHasStoredPassword(true);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface)]"
          >
            ← Back
          </Link>
          <h1 className="text-base font-semibold tracking-tight text-[var(--foreground)] md:text-lg">
            Settings
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 md:px-6">
        <h2 className="mb-1 text-lg font-semibold text-[var(--foreground)]">Database</h2>
        <p className="mb-6 text-sm text-[var(--muted)]">
          Choose where your content items are stored. The built-in SQLite database works with no
          setup. To share data across machines or deployments, connect an external database.
        </p>

        {loading ? (
          <div className="skeleton h-40 w-full rounded-xl" />
        ) : (
          <div className="space-y-6">
            {/* Provider selector */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  className={`rounded-xl border p-4 text-left transition ${
                    provider === p.value
                      ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] hover:bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--foreground)]">{p.label}</span>
                    {provider === p.value && <span className="text-[var(--accent)]">✓</span>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{p.blurb}</p>
                </button>
              ))}
            </div>

            {/* Connection details */}
            {isExternal && (
              <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Host</label>
                    <input
                      className={inputClass}
                      placeholder="db.example.com"
                      value={conn.host}
                      onChange={(e) => setConn((c) => ({ ...c, host: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Port</label>
                    <input
                      className={inputClass}
                      placeholder={defaultPort}
                      value={conn.port}
                      onChange={(e) => setConn((c) => ({ ...c, port: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Database</label>
                  <input
                    className={inputClass}
                    placeholder="content_calendar"
                    value={conn.database}
                    onChange={(e) => setConn((c) => ({ ...c, database: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>User</label>
                    <input
                      className={inputClass}
                      placeholder="app_user"
                      value={conn.user}
                      onChange={(e) => setConn((c) => ({ ...c, user: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Password</label>
                    <input
                      type="password"
                      className={inputClass}
                      placeholder={hasStoredPassword ? "•••••••• (unchanged)" : "password"}
                      value={conn.password}
                      onChange={(e) => setConn((c) => ({ ...c, password: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  The <code>content_items</code> table is created automatically if it does not exist.
                </p>
              </div>
            )}

            {/* Message */}
            {message && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  message.type === "success"
                    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-[#1a2e1a] dark:text-green-300"
                    : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300"
                }`}
              >
                {message.text}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => submit(false)}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              {isExternal && (
                <button
                  onClick={() => submit(true)}
                  disabled={busy !== null}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-50"
                >
                  {busy === "test" ? "Testing…" : "Test connection"}
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
