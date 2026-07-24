// Server-side authentication: password hashing, sessions, and the guards
// used by every API route.
//
// Design notes
//   • Passwords are hashed with scrypt (Node built-in) — no native deps.
//   • Sessions are opaque random tokens. Only the SHA-256 of a token is
//     stored, so a database leak does not hand over live sessions.
//   • Accounts live in the active database (see app/lib/db.ts), which means
//     they follow whichever provider is configured in /settings.

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  countUsers,
  deleteSession,
  findSession,
  findUserById,
  insertSession,
  publicUser,
  purgeExpiredSessions,
  Role,
  UserRow,
} from "./db";

export const SESSION_COOKIE = "cc_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ─────────────── Password hashing ─────────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const MIN_PASSWORD_LENGTH = 8;

/** Validate a candidate password. Returns an error message, or null if OK. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 512) {
    return "Password is too long.";
  }
  return null;
}

/** Validate a candidate username. Returns an error message, or null if OK. */
export function usernameProblem(username: unknown): string | null {
  if (typeof username !== "string") return "Username is required.";
  const value = username.trim();
  if (value.length < 3) return "Username must be at least 3 characters.";
  if (value.length > 64) return "Username must be 64 characters or fewer.";
  if (!/^[a-zA-Z0-9._@-]+$/.test(value)) {
    return "Username may only contain letters, numbers, and . _ - @";
  }
  return null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split("$");
    if (scheme !== "scrypt") return false;

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ─────────────── Sessions ─────────────── */

function tokenToId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Create a session for a user and return the raw cookie token. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await insertSession(tokenToId(token), userId, expiresAt);
  // Opportunistic cleanup; failure here must not block a login.
  purgeExpiredSessions().catch(() => {});
  return token;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    ...cookieOptions,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

async function readToken(req?: NextRequest): Promise<string | null> {
  if (req) return req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Resolve the signed-in user, or null. This is the real check — middleware
 * only does a cheap cookie-presence test and cannot be trusted alone.
 */
export async function getSessionUser(req?: NextRequest): Promise<UserRow | null> {
  const token = await readToken(req);
  if (!token) return null;

  const session = await findSession(tokenToId(token));
  if (!session) return null;

  if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSession(session.id).catch(() => {});
    return null;
  }

  const user = await findUserById(session.userId);
  if (!user) {
    await deleteSession(session.id).catch(() => {});
    return null;
  }
  return publicUser(user);
}

/** Destroy the session backing the current request's cookie. */
export async function destroySession(req?: NextRequest): Promise<void> {
  const token = await readToken(req);
  if (token) await deleteSession(tokenToId(token)).catch(() => {});
}

/* ─────────────── Route guards ─────────────── */

// Guards return a NextResponse on failure so callers can early-return it:
//
//   const auth = await requireUser(req);
//   if (auth.error) return auth.error;
//   auth.user // typed, guaranteed
export type Guard =
  | { user: UserRow; error: null }
  | { user: null; error: NextResponse };

function deny(status: number, message: string): Guard {
  return { user: null, error: NextResponse.json({ error: message }, { status }) };
}

export async function requireUser(req?: NextRequest): Promise<Guard> {
  const user = await getSessionUser(req);
  if (!user) return deny(401, "Not signed in.");
  return { user, error: null };
}

export async function requireAdmin(req?: NextRequest): Promise<Guard> {
  const auth = await requireUser(req);
  if (auth.error) return auth;
  if (auth.user.role !== "admin") {
    return deny(403, "Administrator access required.");
  }
  return auth;
}

/* ─────────────── First-run setup ─────────────── */

/** True when no accounts exist yet — the app is open for admin bootstrap. */
export async function needsSetup(): Promise<boolean> {
  return (await countUsers()) === 0;
}

/**
 * Optional shared secret for the very first admin. When SETUP_TOKEN is set in
 * the environment, whoever claims the admin account must also supply it —
 * useful when the app is already reachable on the public internet.
 */
export function setupTokenRequired(): boolean {
  return Boolean(process.env.SETUP_TOKEN);
}

export function setupTokenValid(candidate: unknown): boolean {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return true;
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type { Role, UserRow };
