"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SessionUser, signOut, useAuth } from "../lib/useAuth";

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
const primaryButton =
  "rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50";
const secondaryButton =
  "rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-50";

type Message = { type: "success" | "error"; text: string } | null;

function Notice({ message }: { message: Message }) {
  if (!message) return null;
  return (
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
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] pt-8 first:border-t-0 first:pt-0">
      <h2 className="mb-1 text-lg font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mb-6 text-sm text-[var(--muted)]">{description}</p>
      {children}
    </section>
  );
}

async function postJson(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

/* ─────────────── Your account ─────────────── */

function AccountSection({ user }: { user: SessionUser }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/auth/password", {
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({
        type: "success",
        text: "Password changed. Any other signed-in devices were signed out.",
      });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Your account"
      description="Signed in as an administrator? You can also manage other accounts below."
    >
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--foreground)]">
          {user.displayName || user.username}
        </span>
        <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
          {user.username}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            user.role === "admin"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--background)] text-[var(--muted)]"
          }`}
        >
          {user.role === "admin" ? "Administrator" : "User"}
        </span>
        <button onClick={() => signOut()} className={`${secondaryButton} ml-auto`}>
          Sign out
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Change password</h3>
        <div>
          <label className={labelClass}>Current password</label>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>New password</label>
            <input
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Confirm new password</label>
            <input
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">At least 8 characters.</p>
        <Notice message={message} />
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </Section>
  );
}

/* ─────────────── User management (admin) ─────────────── */

function UsersSection({ currentUser }: { currentUser: SessionUser }) {
  const [users, setUsers] = useState<SessionUser[] | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "user" | "admin",
  });

  // id of the user whose password is being reset inline
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(data);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/users", form);
      setMessage({ type: "success", text: `Created account “${form.username.trim()}”.` });
      setForm({ username: "", displayName: "", password: "", role: "user" });
      await load();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (user: SessionUser, role: "user" | "admin") => {
    setMessage(null);
    try {
      await postJson(`/api/users/${user.id}`, { role }, "PATCH");
      await load();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    }
  };

  const submitReset = async (user: SessionUser) => {
    setBusy(true);
    setMessage(null);
    try {
      await postJson(`/api/users/${user.id}`, { password: resetPassword }, "PATCH");
      setMessage({
        type: "success",
        text: `Password reset for “${user.username}”. They were signed out everywhere.`,
      });
      setResetting(null);
      setResetPassword("");
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: SessionUser) => {
    if (
      !window.confirm(
        `Delete the account “${user.username}”? This cannot be undone. Content items they created are kept.`
      )
    ) {
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      setMessage({ type: "success", text: `Deleted “${user.username}”.` });
      await load();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    }
  };

  return (
    <Section
      title="Users"
      description="Everyone with an account can view and edit all content items. Administrators can additionally manage accounts and database settings."
    >
      <div className="space-y-6">
        {/* Existing accounts */}
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          {users === null ? (
            <div className="skeleton h-32 w-full" />
          ) : users.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">No accounts found.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <li key={u.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--foreground)]">
                            {u.displayName || u.username}
                          </span>
                          {isSelf && (
                            <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--muted)]">
                              you
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-[var(--muted)]">{u.username}</p>
                      </div>

                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value as "user" | "admin")}
                        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)]"
                        aria-label={`Role for ${u.username}`}
                      >
                        <option value="user">User</option>
                        <option value="admin">Administrator</option>
                      </select>

                      <button
                        onClick={() => {
                          setResetting(resetting === u.id ? null : u.id);
                          setResetPassword("");
                        }}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface)]"
                      >
                        Reset password
                      </button>

                      <button
                        onClick={() => remove(u)}
                        disabled={isSelf}
                        title={isSelf ? "You cannot delete your own account" : undefined}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--danger)] transition hover:bg-[var(--surface)] disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>

                    {resetting === u.id && (
                      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-[var(--surface)] p-3">
                        <div className="min-w-[220px] flex-1">
                          <label className={labelClass}>New password for {u.username}</label>
                          <input
                            type="password"
                            autoComplete="new-password"
                            className={inputClass}
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                          />
                        </div>
                        <button
                          onClick={() => submitReset(u)}
                          disabled={busy || resetPassword.length === 0}
                          className={primaryButton}
                        >
                          {busy ? "Saving…" : "Set password"}
                        </button>
                        <button
                          onClick={() => setResetting(null)}
                          className={secondaryButton}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Notice message={message} />

        {/* Create account */}
        <form
          onSubmit={create}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Create account</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Username</label>
              <input
                className={inputClass}
                placeholder="jsmith"
                required
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>
                Display name <span className="normal-case">(optional)</span>
              </label>
              <input
                className={inputClass}
                placeholder="Jane Smith"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Temporary password</label>
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                required
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>Role</label>
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({ ...f, role: e.target.value as "user" | "admin" }))
                }
                className={inputClass}
              >
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">
            At least 8 characters. Share it with the new user and ask them to change it from
            this page after signing in.
          </p>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>
    </Section>
  );
}

/* ─────────────── Database (admin) ─────────────── */

function DatabaseSection() {
  const [provider, setProvider] = useState<Provider>("sqlite");
  const [conn, setConn] = useState({ ...EMPTY_CONN });
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<Message>(null);
  // Set when the server reads its configuration from environment variables.
  // Nothing here can be saved in that case — on hosts with a read-only
  // filesystem (Vercel) the environment is the only way to configure the app.
  const [envLocked, setEnvLocked] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.error) throw new Error(cfg.error);
        setProvider(cfg.provider || "sqlite");
        setEnvLocked(Boolean(cfg.envLocked));
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
    if (
      !test &&
      !window.confirm(
        "User accounts are stored in the active database. Switching databases means signing in with the accounts in the new database — and creating a new administrator there if it has none. Continue?"
      )
    ) {
      return;
    }

    setBusy(test ? "test" : "save");
    setMessage(null);
    try {
      await postJson("/api/config", buildBody(test));
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
    <Section
      title="Database"
      description="Choose where your content items are stored. The built-in SQLite database works with no setup. To share data across machines or deployments, connect an external database."
    >
      {loading ? (
        <div className="skeleton h-40 w-full rounded-xl" />
      ) : (
        <div className="space-y-6">
          {envLocked ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">
                Managed by environment variables.
              </span>{" "}
              This deployment reads its database settings from <code>DATABASE_URL</code> (or the{" "}
              <code>DB_*</code> variables), which take precedence over anything saved here. The
              settings below are read-only. To change them, update the variables in your hosting
              provider and redeploy.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-[#2e2618] dark:text-amber-200">
              User accounts live in the active database. Switching providers switches the account
              store too — the new database will prompt for administrator setup if it has no users.
            </div>
          )}

          {/* Provider selector */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                disabled={envLocked}
                onClick={() => setProvider(p.value)}
                className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  provider === p.value
                    ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                    : "border-[var(--border)] enabled:hover:bg-[var(--surface)]"
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
                    disabled={envLocked}
                    placeholder="db.example.com"
                    value={conn.host}
                    onChange={(e) => setConn((c) => ({ ...c, host: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Port</label>
                  <input
                    className={inputClass}
                    disabled={envLocked}
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
                  disabled={envLocked}
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
                    disabled={envLocked}
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
                    disabled={envLocked}
                    placeholder={hasStoredPassword ? "•••••••• (unchanged)" : "password"}
                    value={conn.password}
                    onChange={(e) => setConn((c) => ({ ...c, password: e.target.value }))}
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--muted)]">
                The <code>content_items</code>, <code>users</code>, and <code>sessions</code>{" "}
                tables are created automatically if they do not exist.
              </p>
            </div>
          )}

          <Notice message={message} />

          {/* Saving is impossible while the environment supplies the config, but
              testing the live connection is still useful for diagnosis. */}
          <div className="flex items-center gap-3">
            {!envLocked && (
              <button
                onClick={() => submit(false)}
                disabled={busy !== null}
                className={primaryButton}
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            )}
            {isExternal && (
              <button
                onClick={() => submit(true)}
                disabled={busy !== null}
                className={envLocked ? primaryButton : secondaryButton}
              >
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ─────────────── Page ─────────────── */

export default function SettingsPage() {
  const { user, loading } = useAuth();

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

      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8 md:px-6">
        {loading || !user ? (
          <div className="skeleton h-40 w-full rounded-xl" />
        ) : (
          <>
            <AccountSection user={user} />
            {user.role === "admin" && <UsersSection currentUser={user} />}
            {user.role === "admin" && <DatabaseSection />}
          </>
        )}
      </main>
    </div>
  );
}
