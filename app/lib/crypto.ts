// Symmetric encryption for secrets stored in the database — currently the
// per-user LLM API keys in llm_connections.api_key.
//
// This is the only encryption-at-rest in the codebase. It exists because those
// keys are *other people's* billable credentials sitting in a shared table,
// unlike the single admin-owned database password in data/db-config.json which
// is stored in the clear.
//
// Threat model: a leaked database — a backup, a read replica, a stolen
// DATABASE_URL. It does NOT protect against an attacker who already has the
// app server, because the app server necessarily holds the key.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const KEY_PATH = join(DATA_DIR, "encryption.key");

// Fixed salt. Acceptable because the input is expected to be a high-entropy
// secret rather than a human-chosen password: there is no dictionary worth
// precomputing against, and per-install salting would need a second stored
// value that shares the key's fate anyway.
const KEY_SALT = Buffer.from("content-calendar-secret-key-v1");

const SCHEME = "aesgcm";
const VERSION = "1";
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

let cachedKey: Buffer | null = null;

/**
 * Load the encryption key, generating one on first use where that is safe.
 * Throws with a readable explanation when no key can be established.
 */
function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.APP_ENCRYPTION_KEY?.trim();
  if (fromEnv) {
    // 64 hex characters is a raw 32-byte key. Anything else is treated as a
    // passphrase and stretched, so a pasted arbitrary string still works.
    cachedKey = HEX_KEY.test(fromEnv)
      ? Buffer.from(fromEnv, "hex")
      : scryptSync(fromEnv, KEY_SALT, 32);
    return cachedKey;
  }

  // No env var. A generated key file works on any host with a real disk, but
  // Vercel's filesystem is read-only and per-invocation — a key written there
  // would not survive to decrypt what it encrypted. Fail loudly instead, the
  // same way the SQLite adapter refuses to run on Vercel.
  if (process.env.VERCEL) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. API keys are encrypted before they are " +
        "stored, and on Vercel that key can only come from an environment " +
        "variable — the filesystem is read-only. Generate one with " +
        "`openssl rand -hex 32`, add it as APP_ENCRYPTION_KEY in your project " +
        "settings, and redeploy. Keep it safe: if it changes, saved API keys " +
        "can no longer be read and each user must enter theirs again."
    );
  }

  if (existsSync(KEY_PATH)) {
    const raw = readFileSync(KEY_PATH, "utf8").trim();
    if (!HEX_KEY.test(raw)) {
      throw new Error(
        `${KEY_PATH} does not contain a 64-character hex key. Delete it to ` +
          "generate a new one — saved API keys will then need to be entered " +
          "again — or restore the original file."
      );
    }
    cachedKey = Buffer.from(raw, "hex");
    return cachedKey;
  }

  // Generate and persist. `flag: "wx"` fails if another worker won the race,
  // in which case we read theirs rather than clobbering it — two keys would
  // make whichever ciphertext was written first permanently unreadable.
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const generated = randomBytes(32).toString("hex");
  try {
    writeFileSync(KEY_PATH, generated + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // The mode above only applies at creation; set it explicitly in case a
    // permissive umask widened it.
    chmodSync(KEY_PATH, 0o600);
    cachedKey = Buffer.from(generated, "hex");
  } catch (e: any) {
    if (e?.code === "EEXIST") {
      const raw = readFileSync(KEY_PATH, "utf8").trim();
      if (!HEX_KEY.test(raw)) {
        throw new Error(`${KEY_PATH} does not contain a 64-character hex key.`);
      }
      cachedKey = Buffer.from(raw, "hex");
    } else {
      throw new Error(
        `Could not create ${KEY_PATH}, which holds the key used to encrypt ` +
          `stored API keys: ${e.message}. Set APP_ENCRYPTION_KEY instead.`
      );
    }
  }
  return cachedKey!;
}

/** True when secrets can be encrypted on this host. */
export function encryptionAvailable(): boolean {
  return encryptionProblem() === null;
}

/** Human-readable reason encryption is unavailable, or null when it works. */
export function encryptionProblem(): string | null {
  try {
    loadKey();
    return null;
  } catch (e: any) {
    return e.message;
  }
}

/**
 * Encrypt a secret for storage.
 *
 * `context` is bound as additional authenticated data — pass the owning user's
 * id, so a ciphertext copied into another user's row fails to decrypt.
 *
 * Format: aesgcm$1$<iv hex>$<auth tag hex>$<ciphertext hex>
 * The `$`-joined shape matches hashPassword() in app/lib/auth.ts, and the
 * version field lets a future scheme be introduced without ambiguity.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const key = loadKey();
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    SCHEME,
    VERSION,
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    body.toString("hex"),
  ].join("$");
}

/**
 * Decrypt a stored secret. Throws when the key is wrong or has been rotated,
 * when the value was tampered with, or when `context` does not match the one
 * used to encrypt it. Callers should treat a throw as "ask the user to enter
 * the secret again" rather than as a fatal error.
 */
export function decryptSecret(stored: string, context: string): string {
  const key = loadKey();
  const parts = String(stored).split("$");
  if (parts.length !== 5) throw new Error("Unrecognised ciphertext format.");
  const [scheme, version, ivHex, tagHex, bodyHex] = parts;
  if (scheme !== SCHEME || version !== VERSION) {
    throw new Error("Unrecognised ciphertext format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
