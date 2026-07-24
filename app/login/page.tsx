"use client";

import { useCallback, useEffect, useState } from "react";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";
const labelClass =
  "mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]";

/** Only allow same-origin relative redirects — never `//evil.com`. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/** Anchor a vetted path to this origin before navigating. */
function sameOrigin(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function currentNext(): string {
  return safeNext(new URLSearchParams(window.location.search).get("next"));
}

export default function LoginPage() {
  const [mode, setMode] = useState<"loading" | "login" | "setup">("loading");
  const [tokenRequired, setTokenRequired] = useState(false);
  const [next, setNext] = useState("/");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupToken, setSetupToken] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNext(currentNext());

    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((status) => {
        if (status.authenticated) {
          // Already signed in — bounce straight through.
          window.location.replace(sameOrigin(currentNext()));
          return;
        }
        setTokenRequired(Boolean(status.setupTokenRequired));
        setMode(status.needsSetup ? "setup" : "login");
      })
      .catch(() => {
        setError("Could not reach the server. Check the database configuration.");
        setMode("login");
      });
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const endpoint = mode === "setup" ? "/api/auth/setup" : "/api/auth/login";
        const body =
          mode === "setup"
            ? { username, password, confirmPassword, displayName, setupToken }
            : { username, password };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          // Someone else completed setup while this form was open.
          if (res.status === 409 && mode === "setup") setMode("login");
          throw new Error(data.error || "Request failed");
        }

        // Hard navigation is intentional: it guarantees middleware re-runs
        // with the new cookie and that no state from a previous session (or a
        // previously signed-in account) survives in the router cache.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(sameOrigin(next));
      } catch (err: any) {
        setError(err.message);
        setBusy(false);
      }
    },
    [mode, username, password, confirmPassword, displayName, setupToken, next]
  );

  if (mode === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="skeleton h-64 w-full max-w-sm rounded-xl" />
      </div>
    );
  }

  const isSetup = mode === "setup";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
            Content Calendar
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {isSetup
              ? "No accounts exist yet. Create the administrator account to get started."
              : "Sign in to continue."}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
        >
          <div>
            <label className={labelClass} htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className={inputClass}
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {isSetup && (
            <div>
              <label className={labelClass} htmlFor="displayName">
                Display name <span className="normal-case">(optional)</span>
              </label>
              <input
                id="displayName"
                className={inputClass}
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className={inputClass}
              autoComplete={isSetup ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {isSetup && (
            <>
              <div>
                <label className={labelClass} htmlFor="confirmPassword">
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  className={inputClass}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {tokenRequired && (
                <div>
                  <label className={labelClass} htmlFor="setupToken">
                    Setup token
                  </label>
                  <input
                    id="setupToken"
                    type="password"
                    className={inputClass}
                    required
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                  />
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Matches the <code>SETUP_TOKEN</code> environment variable.
                  </p>
                </div>
              )}

              <p className="text-xs text-[var(--muted)]">
                At least 8 characters. This account can manage database settings and
                create other users.
              </p>
            </>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {busy
              ? isSetup
                ? "Creating…"
                : "Signing in…"
              : isSetup
                ? "Create administrator"
                : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
