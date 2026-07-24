// Minimal in-process throttle for credential endpoints.
//
// This is deliberately simple: it holds counters in memory, so it protects a
// single server process and resets on restart. That is enough to blunt online
// password guessing for a self-hosted app. Behind multiple replicas you would
// want a shared store (Redis) instead.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Identify the caller for throttling purposes. */
export function clientKey(req: Request, suffix = ""): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `${ip}:${suffix}`;
}

/** Returns seconds to wait if the caller is locked out, otherwise null. */
export function checkRateLimit(key: string): number | null {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return null;
  if (bucket.count < MAX_ATTEMPTS) return null;
  return Math.ceil((bucket.resetAt - now) / 1000);
}

/** Record a failed attempt. */
export function recordFailure(key: string): void {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

/** Clear the counter after a successful attempt. */
export function clearFailures(key: string): void {
  buckets.delete(key);
}
