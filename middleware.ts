import { NextRequest, NextResponse } from "next/server";

// Edge-runtime gate. This is an *optimistic* check only — it looks for the
// presence of a session cookie so unauthenticated visitors land on /login
// instead of a flash of empty UI. It cannot reach the database, so it proves
// nothing about the cookie's validity.
//
// The real enforcement lives in app/lib/auth.ts and runs inside every API
// route (requireUser / requireAdmin). Do not relax those on the strength of
// this file.

const SESSION_COOKIE = "cc_session";

// Reachable without a session.
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/setup",
]);

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  // API calls get a clean 401 rather than an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  const next = `${pathname}${search}`;
  if (next && next !== "/") loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)",
  ],
};
