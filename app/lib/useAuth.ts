"use client";

import { useEffect, useState } from "react";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Resolve a path against this origin. Navigating to a bare relative string can
 * be reinterpreted as a protocol-relative URL (`//evil.com`); anchoring to
 * window.location.origin keeps every redirect same-origin.
 */
function sameOrigin(path: string): string {
  return new URL(path, window.location.origin).toString();
}

/** Send the browser to the login page, remembering where it was. */
export function redirectToLogin(): void {
  const next = window.location.pathname + window.location.search;
  const url =
    next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
  window.location.replace(sameOrigin(url));
}

/**
 * Resolve the signed-in user for a client page.
 *
 * Middleware already redirects visitors with no cookie, but a cookie can be
 * expired or point at a deleted account — this catches those cases and is what
 * lets pages render a real identity. Data access is still authorized
 * server-side on every request; this hook is for the UI, not for security.
 */
export function useAuth(): { user: SessionUser | null; loading: boolean } {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((status) => {
        if (cancelled) return;
        if (!status.authenticated) {
          redirectToLogin();
          return;
        }
        setUser(status.user);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  // A hard navigation is intentional across an auth boundary: router.push()
  // would keep the router cache and React state of the user who just left.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(sameOrigin("/login"));
}
