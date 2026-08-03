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

/**
 * Accounts and teams, loaded together.
 *
 * The two sections below edit opposite ends of the same relationship — a team's
 * member list and an account's team list — so they share one copy of both. Two
 * independent fetches would let one section keep showing a membership the other
 * had just changed.
 */
interface DirectoryUser extends SessionUser {
  teamIds: string[];
}

interface TeamSummary {
  id: string;
  name: string;
  memberIds: string[];
  itemCount: number;
}

interface Directory {
  users: DirectoryUser[] | null;
  teams: TeamSummary[] | null;
  reload: () => Promise<void>;
  error: string | null;
}

function useDirectory(enabled: boolean): Directory {
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [userRes, teamRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/teams?all=1"),
      ]);
      const userData = await userRes.json();
      const teamData = await teamRes.json();
      if (!userRes.ok) throw new Error(userData.error || "Failed to load users");
      if (!teamRes.ok) throw new Error(teamData.error || "Failed to load teams");
      setUsers(userData);
      setTeams(teamData.teams);
      setError(null);
    } catch (e: any) {
      setError(e.message);
      setUsers((prev) => prev ?? []);
      setTeams((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { users, teams, reload, error };
}

/** Tick-box list of accounts, used for "who is on this team". */
function MemberPicker({
  users,
  selected,
  onChange,
  emptyHint,
}: {
  users: DirectoryUser[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyHint: string;
}) {
  if (users.length === 0) {
    return <p className="text-xs text-[var(--muted)]">{emptyHint}</p>;
  }
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    );

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {users.map((u) => (
        <label
          key={u.id}
          className="flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]"
        >
          <input
            type="checkbox"
            checked={selected.includes(u.id)}
            onChange={() => toggle(u.id)}
          />
          <span className="truncate">{u.displayName || u.username}</span>
        </label>
      ))}
    </div>
  );
}

/* ─────────────── Teams (admin) ─────────────── */

function TeamsSection({
  currentUser,
  directory,
}: {
  currentUser: SessionUser;
  directory: Directory;
}) {
  const { users, teams, reload } = directory;
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Per-team edits, held locally until saved. Re-seeded whenever the server
  // copy changes, which is exactly when unsaved edits stop being meaningful.
  const [drafts, setDrafts] = useState<Record<string, { name: string; memberIds: string[] }>>({});
  useEffect(() => {
    if (!teams) return;
    setDrafts(
      Object.fromEntries(
        teams.map((t) => [t.id, { name: t.name, memberIds: [...t.memberIds] }])
      )
    );
  }, [teams]);

  const [newTeam, setNewTeam] = useState<{ name: string; memberIds: string[] }>({
    name: "",
    // Whoever is creating the team is on it by default: an admin almost always
    // wants to see the board they just made, and unticking is one click.
    memberIds: [currentUser.id],
  });

  const save = async (team: TeamSummary) => {
    const draft = drafts[team.id];
    if (!draft) return;
    setBusy(team.id);
    setMessage(null);
    try {
      await postJson(
        `/api/teams/${team.id}`,
        { name: draft.name, memberIds: draft.memberIds },
        "PATCH"
      );
      setMessage({ type: "success", text: `Saved “${draft.name.trim()}”.` });
      await reload();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (team: TeamSummary) => {
    setMessage(null);
    // Asked without the flag first, so the confirmation can quote the real
    // number of items at risk rather than a number this page cached earlier.
    const attempt = async (deleteItems: boolean) => {
      const res = await fetch(
        `/api/teams/${team.id}${deleteItems ? "?deleteItems=true" : ""}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    };

    if (!window.confirm(`Delete the team “${team.name}”?`)) return;

    setBusy(team.id);
    try {
      let result = await attempt(false);

      if (!result.ok && result.status === 409) {
        const count = result.data.itemCount ?? 0;
        const confirmed = window.confirm(
          `“${team.name}” has ${count} content item${count === 1 ? "" : "s"}. ` +
            `Deleting the team deletes them permanently. Continue?`
        );
        if (!confirmed) {
          setBusy(null);
          return;
        }
        result = await attempt(true);
      }

      if (!result.ok) throw new Error(result.data.error || "Failed to delete team");
      setMessage({ type: "success", text: `Deleted “${team.name}”.` });
      await reload();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("new");
    setMessage(null);
    try {
      await postJson("/api/teams", newTeam);
      setMessage({ type: "success", text: `Created team “${newTeam.name.trim()}”.` });
      setNewTeam({ name: "", memberIds: [currentUser.id] });
      await reload();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const dirty = (team: TeamSummary) => {
    const draft = drafts[team.id];
    if (!draft) return false;
    return (
      draft.name !== team.name ||
      draft.memberIds.length !== team.memberIds.length ||
      draft.memberIds.some((id) => !team.memberIds.includes(id))
    );
  };

  return (
    <Section
      title="Teams"
      description="Each team has its own board. Members see only the boards of the teams they belong to — someone on two teams sees both, and no one else's. Administrators are no exception: add yourself to a team to see its board."
    >
      <div className="space-y-6">
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          {teams === null || users === null ? (
            <div className="skeleton h-32 w-full" />
          ) : teams.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">
              No teams yet. Create one below — until then, no one has a board.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {teams.map((team) => {
                const draft = drafts[team.id] ?? {
                  name: team.name,
                  memberIds: team.memberIds,
                };
                return (
                  <li key={team.id} className="space-y-3 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        className={`${inputClass} max-w-xs flex-1`}
                        value={draft.name}
                        aria-label={`Name of team ${team.name}`}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [team.id]: { ...draft, name: e.target.value },
                          }))
                        }
                      />
                      <span className="text-xs text-[var(--muted)]">
                        {team.itemCount} item{team.itemCount === 1 ? "" : "s"}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => save(team)}
                          disabled={busy === team.id || !dirty(team)}
                          className={primaryButton}
                        >
                          {busy === team.id ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => remove(team)}
                          disabled={busy === team.id}
                          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--danger)] transition hover:bg-[var(--surface)] disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className={labelClass}>Members</p>
                      <MemberPicker
                        users={users}
                        selected={draft.memberIds}
                        onChange={(memberIds) =>
                          setDrafts((d) => ({ ...d, [team.id]: { ...draft, memberIds } }))
                        }
                        emptyHint="No accounts exist yet."
                      />
                      {draft.memberIds.length === 0 && (
                        <p className="mt-2 text-xs text-[var(--danger)]">
                          With no members this board is invisible to everyone, including you.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Notice message={message} />

        <form
          onSubmit={create}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Create team</h3>
          <div>
            <label className={labelClass}>Team name</label>
            <input
              className={`${inputClass} max-w-sm`}
              placeholder="Marketing"
              required
              value={newTeam.name}
              onChange={(e) => setNewTeam((t) => ({ ...t, name: e.target.value }))}
            />
          </div>
          <div>
            <p className={labelClass}>Members</p>
            <MemberPicker
              users={users ?? []}
              selected={newTeam.memberIds}
              onChange={(memberIds) => setNewTeam((t) => ({ ...t, memberIds }))}
              emptyHint="No accounts exist yet."
            />
          </div>
          <button type="submit" disabled={busy === "new"} className={primaryButton}>
            {busy === "new" ? "Creating…" : "Create team"}
          </button>
        </form>
      </div>
    </Section>
  );
}

/* ─────────────── Users (admin) ─────────────── */

function UsersSection({
  currentUser,
  directory,
}: {
  currentUser: SessionUser;
  directory: Directory;
}) {
  const { users, teams, reload: load } = directory;
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "user" | "admin",
    teamIds: [] as string[],
  });

  // id of the user whose password is being reset inline
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const teamName = (id: string) => teams?.find((t) => t.id === id)?.name ?? "unknown team";

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/users", form);
      setMessage({ type: "success", text: `Created account “${form.username.trim()}”.` });
      setForm({
        username: "",
        displayName: "",
        password: "",
        role: "user",
        teamIds: [],
      });
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
      description="An account can view and edit content on the boards of the teams it belongs to, and nothing else. Administrators can additionally manage accounts, teams, and database settings. Change who is on which team in the Teams section above."
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
                        {/* Shown, not edited, here: membership is edited from
                            the team side so there is one place it can change. */}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {u.teamIds.length === 0 ? (
                            <span className="text-xs text-[var(--danger)]">
                              No team — sees no board
                            </span>
                          ) : (
                            u.teamIds.map((id) => (
                              <span
                                key={id}
                                className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--muted)]"
                              >
                                {teamName(id)}
                              </span>
                            ))
                          )}
                        </div>
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
          <div>
            <p className={labelClass}>Teams</p>
            {teams === null ? (
              <div className="skeleton h-5 w-40" />
            ) : teams.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                No teams exist yet. Create one above first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {teams.map((team) => (
                  <label
                    key={team.id}
                    className="flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]"
                  >
                    <input
                      type="checkbox"
                      checked={form.teamIds.includes(team.id)}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          teamIds: f.teamIds.includes(team.id)
                            ? f.teamIds.filter((id) => id !== team.id)
                            : [...f.teamIds, team.id],
                        }))
                      }
                    />
                    <span className="truncate">{team.name}</span>
                  </label>
                ))}
              </div>
            )}
            {form.teamIds.length === 0 && (teams?.length ?? 0) > 0 && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Pick at least one, or this account signs in to an empty screen.
              </p>
            )}
          </div>
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

/* ─────────────── AI assistant ─────────────── */

// Mirrors LlmProviderDescriptor in app/lib/llm.ts. Declared locally because
// that module reaches the filesystem and cannot be imported into a client
// component; the catalogue itself arrives from GET /api/llm/connection.
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

type StoredConnection = {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  apiKeyBroken: boolean;
} | null;

/**
 * The provider form, used for both a personal connection and the team default.
 * `endpoint` decides which one is being edited.
 */
function LlmConnectionForm({
  endpoint,
  providers,
  initial,
  onSaved,
  onCleared,
  clearLabel,
}: {
  endpoint: string;
  providers: LlmProvider[];
  initial: StoredConnection;
  onSaved: (c: StoredConnection) => void;
  onCleared: () => void;
  clearLabel: string;
}) {
  const first = providers[0]?.id ?? "anthropic";
  const [providerId, setProviderId] = useState(initial?.provider ?? first);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(Boolean(initial?.hasApiKey));
  const [keyBroken, setKeyBroken] = useState(Boolean(initial?.apiKeyBroken));
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const descriptor =
    providers.find((p) => p.id === providerId) ?? providers[0] ?? null;

  const pickProvider = (next: LlmProvider) => {
    setProviderId(next.id);
    setMessage(null);
    // Offer the provider's defaults rather than carrying the previous
    // provider's model or URL across, which would never be valid.
    setModel(next.id === initial?.provider ? initial?.model ?? next.defaultModel : next.defaultModel);
    setBaseUrl(
      next.baseUrl === "fixed"
        ? ""
        : next.id === initial?.provider
          ? initial?.baseUrl ?? next.defaultBaseUrl
          : next.defaultBaseUrl
    );
  };

  const submit = async (test: boolean) => {
    setBusy(test ? "test" : "save");
    setMessage(null);
    try {
      const data = await postJson(endpoint, {
        provider: providerId,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey,
        test,
      });
      if (test) {
        setMessage({
          type: "success",
          text: data.note ?? `Connected. Using ${data.model}.`,
        });
      } else {
        setMessage({ type: "success", text: data.note ?? "Saved." });
        setApiKey("");
        setHasStoredKey(Boolean(data.connection?.hasApiKey));
        setKeyBroken(false);
        onSaved(data.connection ?? null);
      }
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!window.confirm(clearLabel)) return;
    setBusy("clear");
    setMessage(null);
    try {
      await postJson(endpoint, {}, "DELETE");
      setApiKey("");
      setHasStoredKey(false);
      setKeyBroken(false);
      onCleared();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  if (!descriptor) return null;

  return (
    <div className="space-y-6">
      {keyBroken && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-[#2e2618] dark:text-amber-200">
          The saved API key can no longer be read — the server&apos;s encryption key
          changed. Enter the key again to restore access.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pickProvider(p)}
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
              placeholder={
                hasStoredKey && !keyBroken ? "•••••••• (unchanged)" : "Paste your key"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}

        <p className="text-xs text-[var(--muted)]">{descriptor.docsHint}</p>
      </div>

      <Notice message={message} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => submit(false)}
          disabled={busy !== null}
          className={primaryButton}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => submit(true)}
          disabled={busy !== null}
          className={secondaryButton}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        {initial && (
          <button
            onClick={clear}
            disabled={busy !== null}
            className="rounded-lg border border-[var(--danger)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-hover)] hover:text-white disabled:opacity-50"
          >
            {busy === "clear" ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
    </div>
  );
}

function AiSection({ user }: { user: SessionUser }) {
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [own, setOwn] = useState<StoredConnection>(null);
  const [org, setOrg] = useState<StoredConnection>(null);
  const [encryption, setEncryption] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A user inheriting the team default only sees the form once they ask to
  // override it, so the common case stays a single line of text.
  const [overriding, setOverriding] = useState(false);

  const fetchConnections = useCallback(
    () =>
      fetch("/api/llm/connection")
        .then((r) => r.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setProviders(data.providers ?? []);
          setOwn(data.connection ?? null);
          setOrg(data.orgConnection ?? null);
          setEncryption(data.encryptionProblem ?? null);
          setLoadError(null);
        })
        .catch((e) => setLoadError(e.message || "Failed to load AI settings."))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  /** Re-read from the server after a change that can shift what is inherited. */
  const reload = useCallback(() => {
    setLoading(true);
    void fetchConnections();
  }, [fetchConnections]);

  const providerLabel = (id?: string) =>
    providers.find((p) => p.id === id)?.label ?? id ?? "";

  const inheriting = !own && org;
  const showForm = Boolean(own) || overriding || !org;

  return (
    <>
      <Section
        title="AI assistant"
        description="Connect a model provider to generate outlines, drafts, and campaign ideas. Your key is encrypted before it is stored and is never shown again."
      >
        {loading ? (
          <div className="skeleton h-40 w-full rounded-xl" />
        ) : loadError ? (
          <Notice message={{ type: "error", text: loadError }} />
        ) : (
          <div className="space-y-6">
            {encryption && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-[#2e2618] dark:text-amber-200">
                {encryption}
              </div>
            )}

            {inheriting && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
                <span className="font-semibold text-[var(--foreground)]">
                  Using the team default
                </span>{" "}
                ({providerLabel(org!.provider)}
                {org!.model ? ` · ${org!.model}` : ""}). Set your own connection to
                use a different provider or bill usage to your own account.
                {!overriding && (
                  <button
                    onClick={() => setOverriding(true)}
                    className="mt-3 block rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
                  >
                    Use my own key instead
                  </button>
                )}
              </div>
            )}

            {showForm && (
              <LlmConnectionForm
                endpoint="/api/llm/connection"
                providers={providers}
                initial={own}
                onSaved={(c) => {
                  setOwn(c);
                  setOverriding(false);
                }}
                onCleared={() => {
                  setOwn(null);
                  setOverriding(false);
                  reload();
                }}
                clearLabel="Remove your saved AI connection? You will fall back to the team default if one exists."
              />
            )}
          </div>
        )}
      </Section>

      {user.role === "admin" && !loading && !loadError && (
        <Section
          title="Team AI default"
          description="An optional shared connection. Users who have not set up their own AI connection generate with this one, and its usage is billed to this key."
        >
          <LlmConnectionForm
            endpoint="/api/llm/org-connection"
            providers={providers}
            initial={org}
            onSaved={(c) => setOrg(c)}
            onCleared={() => {
              setOrg(null);
              reload();
            }}
            clearLabel="Remove the team default? Users without their own connection will lose AI access until they add one."
          />
        </Section>
      )}
    </>
  );
}

/* ─────────────── Backup ─────────────── */

function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `${res.status} ${res.statusText}`);
      }

      const text = await res.text();
      // The route reports a mid-stream failure in the file rather than in the
      // status code, which has already been sent by then.
      if (text.includes("-- BACKUP FAILED PART WAY THROUGH:")) {
        const reason = text.split("-- BACKUP FAILED PART WAY THROUGH:")[1].split("\n")[0];
        throw new Error(`The backup did not finish:${reason}`);
      }

      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        `content_calendar_backup_${new Date().toISOString().slice(0, 10)}.sql`;

      const blob = new Blob([text], { type: "application/sql" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const rows = (text.match(/^INSERT INTO /gm) ?? []).length;
      const size = text.length < 1_048_576
        ? `${Math.max(1, Math.round(text.length / 1024))} KB`
        : `${(text.length / 1_048_576).toFixed(1)} MB`;
      setMessage({
        type: "success",
        text: `Downloaded ${name} — ${rows.toLocaleString()} row${rows === 1 ? "" : "s"}, ${size}.`,
      });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Backup"
      description="Download the whole database as a SQL file — content items, accounts, and AI connections. Restore it with your database's own command-line tool."
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-[#2e2618] dark:text-amber-200">
          <span className="font-semibold">Keep this file private.</span> It contains
          every account&apos;s password hash and each user&apos;s encrypted AI provider
          key. Those keys can only be read again by a server using the same{" "}
          <code>APP_ENCRYPTION_KEY</code>; restore onto a server without it and each
          user must enter their key again.
        </div>

        <p className="text-sm text-[var(--muted)]">
          Active sessions are not included — everyone signs in again after a restore.
          The file is written to restore into an <strong>empty</strong> database; the
          commands for each provider are in a comment at the top of the file.
        </p>

        <Notice message={message} />

        <button onClick={download} disabled={busy} className={primaryButton}>
          {busy ? "Preparing…" : "Download SQL backup"}
        </button>
      </div>
    </Section>
  );
}

/* ─────────────── Restore ─────────────── */

type RestorePreview = {
  fileName: string;
  sql: string;
  sourceProvider: string | null;
  generatedAt: string | null;
  targetProvider: string;
  counts: Record<string, number>;
  admins: number;
  warnings: string[];
};

const TABLE_LABELS: Record<string, string> = {
  content_items: "content items",
  users: "accounts",
  llm_connections: "AI connections",
};

function RestoreSection() {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [busy, setBusy] = useState<"inspect" | "restore" | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [done, setDone] = useState(false);

  // Reading the file and asking the server what is in it changes nothing —
  // it is the confirmation step that commits.
  const pickFile = async () => {
    setMessage(null);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sql,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy("inspect");
      try {
        const sql = await file.text();
        const data = await postJson("/api/restore", { sql, inspect: true });
        setPreview({
          fileName: file.name,
          sql,
          sourceProvider: data.sourceProvider ?? null,
          generatedAt: data.generatedAt ?? null,
          targetProvider: data.targetProvider,
          counts: data.counts ?? {},
          admins: data.admins ?? 0,
          warnings: data.warnings ?? [],
        });
      } catch (e: any) {
        setPreview(null);
        setMessage({ type: "error", text: e.message });
      } finally {
        setBusy(null);
      }
    };
    input.click();
  };

  const commit = async () => {
    if (!preview) return;
    const totals = Object.entries(preview.counts)
      .map(([table, n]) => `${n} ${TABLE_LABELS[table] ?? table}`)
      .join(", ");
    if (
      !window.confirm(
        `This deletes EVERY content item, account, and AI connection in the ` +
          `current database and replaces them with the contents of ` +
          `${preview.fileName} (${totals}).\n\n` +
          `You will be signed out, and you must sign in with an account from ` +
          `the backup — not your current password unless it is the same account.\n\n` +
          `This cannot be undone. Continue?`
      )
    ) {
      return;
    }

    setBusy("restore");
    setMessage(null);
    try {
      const data = await postJson("/api/restore", { sql: preview.sql });
      const written = Object.entries(data.inserted ?? {})
        .map(([table, n]) => `${n} ${TABLE_LABELS[table] ?? table}`)
        .join(", ");
      setDone(true);
      setPreview(null);
      setMessage({
        type: "success",
        text: `Restored ${written}. Everyone has been signed out — sign in again with an account from the backup.`,
      });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Restore"
      description="Load a backup file back into the database. The file is checked and summarised before anything is changed."
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300">
          <span className="font-semibold">Restoring replaces everything.</span> Every
          content item, account, and AI connection in the current database is deleted
          and rewritten from the file. Take a backup first if the current data still
          matters. It all happens in one transaction, so a failure part way through
          leaves the database untouched.
        </div>

        {preview && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
            <p className="mb-2 font-semibold text-[var(--foreground)]">
              {preview.fileName}
            </p>
            <ul className="space-y-1 text-[var(--muted)]">
              {Object.entries(preview.counts).map(([table, n]) => (
                <li key={table}>
                  {n.toLocaleString()} {TABLE_LABELS[table] ?? table}
                  {table === "users" && preview.admins > 0
                    ? ` (${preview.admins} administrator${preview.admins === 1 ? "" : "s"})`
                    : ""}
                </li>
              ))}
              {preview.generatedAt && <li>Taken {preview.generatedAt.slice(0, 10)}</li>}
              {preview.sourceProvider && (
                <li>
                  From {preview.sourceProvider}
                  {preview.sourceProvider !== preview.targetProvider
                    ? ` → restoring into ${preview.targetProvider}`
                    : ""}
                </li>
              )}
              {preview.warnings.map((w) => (
                <li key={w} className="text-amber-700 dark:text-amber-300">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Notice message={message} />

        {done ? (
          <a href="/login" className={primaryButton}>
            Sign in again
          </a>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={pickFile} disabled={busy !== null} className={secondaryButton}>
              {busy === "inspect" ? "Reading…" : preview ? "Choose a different file…" : "Choose backup file…"}
            </button>
            {preview && (
              <button
                onClick={commit}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--danger-hover)] disabled:opacity-50"
              >
                {busy === "restore" ? "Restoring…" : "Replace all data with this backup"}
              </button>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/* ─────────────── Page ─────────────── */

export default function SettingsPage() {
  const { user, loading } = useAuth();
  // Only administrators can read either endpoint, so only they load them.
  const directory = useDirectory(user?.role === "admin");

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
            <AiSection user={user} />
            {user.role === "admin" && (
              <TeamsSection currentUser={user} directory={directory} />
            )}
            {user.role === "admin" && (
              <UsersSection currentUser={user} directory={directory} />
            )}
            {user.role === "admin" && <DatabaseSection />}
            {user.role === "admin" && <BackupSection />}
            {user.role === "admin" && <RestoreSection />}
          </>
        )}
      </main>
    </div>
  );
}
