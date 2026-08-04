# Deploying Content Calendar to Vercel

Complete walkthrough: create a Postgres database, connect it, deploy from
GitHub, and claim the admin account.

Budget about 15 minutes. Everything here is free-tier.

---

## Why this app needs Postgres on Vercel

Skip this if you just want the steps — but it explains why the extra database
step exists at all.

Vercel runs each API route as a **serverless function**. Those functions have a
read-only filesystem and are torn down between requests. SQLite is a file that
the database engine writes to continuously, so it fails on both counts:

- `better-sqlite3` cannot create `content_calendar.db` — the disk is read-only.
- Even pointed at `/tmp` (the one writable path), every function instance gets
  its own throwaway copy. Writes would vanish on the next cold start, and two
  concurrent requests would see different data.

This is not a configuration problem and no setting fixes it. Vercel offers no
persistent disk. The app therefore talks to a network database instead, using
the Postgres support that is already built in.

Coolify is unaffected — it runs one long-lived container with a real disk, so
it keeps using SQLite with no changes. See [Running both](#running-both-coolify-and-vercel).

---

## Step 1 — Create the Postgres database

Any Postgres works. Neon is the path of least resistance because Vercel can
provision it and inject the credentials for you.

### Option A: Neon through the Vercel Marketplace (recommended)

Do this *after* Step 2 if you have not imported the project yet — the
integration attaches a database to an existing project.

1. Open your project in the Vercel dashboard.
2. Go to the **Storage** tab.
3. Choose **Neon** (listed under Marketplace Database Providers) and follow the
   prompts. Accept the free plan and pick a region near your users.
4. Vercel creates the database and automatically adds `DATABASE_URL` (plus
   several `POSTGRES_*` and `PG*` variables) to your project's environment.

That is the whole database setup. The app reads `DATABASE_URL` directly, so
**skip Step 3** and go to Step 4.

> The exact wording of these dashboard menus shifts from time to time. Look for
> Storage → create/connect a Postgres database; the flow is the same.

### Option B: Neon directly

1. Sign up at <https://neon.tech> and create a project.
2. Name the database `content_calendar` (any name works).
3. On the project dashboard, copy the connection string. **Take the pooled
   one** — its host contains `-pooler`. It looks like:

   ```
   postgresql://user:password@ep-cool-name-12345-pooler.us-east-2.aws.neon.tech/content_calendar?sslmode=require
   ```

Keep that string for Step 3.

### Option C: Supabase, Railway, RDS, or your own Postgres

Any Postgres 12+ instance reachable from the public internet works. Copy its
connection string and make sure of two things:

- It ends with `?sslmode=require` (managed providers reject plaintext).
- You use the **connection-pooled** endpoint if one is offered. On Supabase
  that is the "Transaction pooler" string on port `6543`.

### Why the pooled connection string matters

Each warm serverless instance opens its own pool. Traffic spikes mean many
instances, and a direct Postgres connection limit (Neon free tier: ~100) is
exhausted quickly, producing `too many connections` errors under load. The
pooler multiplexes thousands of client connections onto a few real ones.

The app also caps its own pool at 2 connections per instance when it detects
Vercel. Override with `DB_POOL_MAX` if you need to.

---

## Step 2 — Import the repository

1. Go to <https://vercel.com/new>.
2. Select your `content-calendar` GitHub repository. Authorise Vercel to read
   it if prompted.
3. Vercel detects Next.js automatically. **Leave every build setting at its
   default** — framework preset `Next.js`, build command `next build`, no
   output directory override.
4. Do **not** deploy yet if you can avoid it. Expand **Environment Variables**
   and add them now (Step 3), so the first deploy already works.

If you already clicked Deploy and it failed, that is fine — add the variables
and redeploy (Step 5).

---

## Step 3 — Set environment variables

Skip `DATABASE_URL` if you used Option A, which added it for you.

In **Project → Settings → Environment Variables**, add:

| Name | Value | Environments |
|---|---|---|
| `DATABASE_URL` | your pooled Postgres connection string from Step 1 | Production, Preview, Development |
| `SETUP_TOKEN` | output of `openssl rand -hex 24` | Production, Preview |

### About `SETUP_TOKEN`

The first person to load `/login` on a database with no accounts is offered the
**create administrator** form and becomes the admin. On a public URL that could
be a stranger who finds your deployment before you do.

With `SETUP_TOKEN` set, the setup form also demands that value, so only you can
claim the account. It is consulted **only** while zero accounts exist. Once
you have created your admin, delete the variable — it does nothing after that.

Generate one with:

```bash
openssl rand -hex 24
```

### A caution about Preview deployments

Adding `DATABASE_URL` to the Preview environment points every pull-request
preview at the **same** database as production — including its users, sessions,
and content. That is convenient but it means preview builds can write to live
data. For real isolation, create a second Neon branch or database and scope
that URL to Preview only.

---

## Step 4 — Deploy

If you set the variables during import, click **Deploy**.

Otherwise trigger a fresh deployment — environment variables are baked in at
deploy time, so **a redeploy is required after adding or changing them**:

- Dashboard: **Deployments** → the latest one → ⋯ → **Redeploy**, or
- Push any commit to `main`.

The build takes a couple of minutes. Watch the log for `Compiled successfully`.

---

## Step 5 — Claim the admin account

1. Open your deployment URL. You will be redirected to `/login`.
2. Because the database has no accounts, you get the **create administrator**
   form rather than a sign-in form.
3. Fill in username, optional display name, and a password of at least 8
   characters. If you set `SETUP_TOKEN`, paste it into the token field.
4. Submit. You are signed in, and the setup endpoint closes permanently.
5. Go to **Settings** and confirm the database section reads **postgres**.

The `content_items`, `users`, and `sessions` tables are created automatically
on the first request — there is no migration step to run.

### Then remove the setup token

Delete `SETUP_TOKEN` from the environment variables and redeploy. Leaving it
set is harmless but misleading; it has no effect once an account exists.

---

## Step 6 — Verify

```bash
# Replace with your deployment URL.
BASE=https://your-app.vercel.app

# Expect: {"user":null,"authenticated":false,"needsSetup":false,...}
# needsSetup:false confirms the database is reachable and holds your account.
curl -s $BASE/api/auth/status

# Expect: 401 — content is protected.
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/items
```

`needsSetup: true` *after* you created an account means the app is talking to a
different (empty) database than you think — check that `DATABASE_URL` is set
for the environment you are actually hitting, and that you redeployed.

---

## Running both Coolify and Vercel

Your Coolify deployment keeps working with no changes. It has a writable disk,
`DATABASE_URL` is not set there, so it continues using the SQLite file exactly
as before.

You then have a choice:

**Separate databases (default).** Coolify keeps its SQLite file, Vercel uses
Postgres. Two independent instances with different content and different user
accounts. Nothing to configure.

**One shared database.** Set the same `DATABASE_URL` on Coolify (as an
environment variable in the Coolify UI) and both deployments read and write the
same Postgres — same content, same logins, either URL. Note that this makes
Coolify depend on the external database being reachable.

Accounts follow the database, not the deployment. Pointing an instance at an
empty database returns it to first-run setup.

### Moving existing SQLite content to Postgres

The two databases start out unrelated. If you have content in the Coolify
SQLite file you want on Vercel, copy it across — there is no built-in
migration. The schemas are deliberately identical (all `TEXT` except
`word_count`), so a dump and load works:

```bash
# On the Coolify host, export the content items as SQL INSERTs.
sqlite3 content_calendar.db .dump content_items > items.sql

# Load into Postgres, ignoring the CREATE TABLE (the app already made it).
grep '^INSERT INTO' items.sql | psql "$DATABASE_URL"
```

Do not copy the `users` table across if the password hashing differs between
versions — it is safer to recreate accounts.

---

## Troubleshooting

**Build fails on `better-sqlite3`**
It is a native module compiled at install time. It is only ever `require`d when
the SQLite provider is active, so it does not run on Vercel — but it still
installs. If the compile fails, confirm the Node version under **Settings →
General → Node.js Version** is 20 or 22.

**`SQLite cannot be used on Vercel: the filesystem is read-only`**
Working as intended — this is the app telling you `DATABASE_URL` is not
reaching it. Either the variable is unset, is scoped to a different environment
than the one you are hitting, or you have not redeployed since adding it.

**`The server does not support SSL connections`**
Your connection string says `sslmode=require` but the database has TLS off.
That is normal for a self-hosted Postgres on a private network — use
`?sslmode=disable`. Never do this over the public internet. Private hosts are
detected automatically (see `DB_SSL` below), so this should only appear when
`sslmode=require` was set explicitly.

**`self-signed certificate`**
You used `sslmode=verify` against a database with a self-signed certificate.
Use `sslmode=require`, which encrypts without demanding a trusted CA.

**`too many connections`**
You are on a direct rather than pooled connection string. Switch to the pooled
endpoint (Step 1), and optionally set `DB_POOL_MAX=1`.

**Login appears to succeed but bounces back to `/login`**
Session cookies are marked `Secure` in production, so they are dropped over
plain HTTP. Vercel serves HTTPS by default, so this normally indicates you are
hitting the site over `http://` — use the `https://` URL.

**Settings page will not let me change the database**
Expected. When `DATABASE_URL` is set it takes precedence and the configuration
becomes read-only, because nothing written to disk survives on Vercel. Change
the environment variable and redeploy instead.

**`DATABASE_URL is not a valid connection URL`**
The app refuses to start rather than silently falling back to SQLite. Check for
a stray quote, a missing scheme, or a password with unescaped `@` or `/` — those
must be percent-encoded (`@` → `%40`, `/` → `%2F`).

---

## Configuration reference

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Full connection string. Overrides `data/db-config.json` and makes `/settings` read-only. |
| `POSTGRES_URL` | Fallback name, read only if `DATABASE_URL` is unset. Set by Vercel's Neon integration. |
| `DB_PROVIDER` | `sqlite`, `mysql`, `mariadb`, or `postgres`. Alternative to a URL. |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Discrete connection fields, used with `DB_PROVIDER`. |
| `DB_SSL` | `disable`, `require`, or `verify`. Defaults to `disable` for private hosts and `require` everywhere else. Private means loopback, a bare service/container name with no dot (Docker Compose, Coolify, Kubernetes), a `.internal`/`.local` suffix, or an RFC 1918 / unique-local address. |
| `DB_POOL_MAX` | Connections per instance. Defaults to 2 on Vercel, 5 elsewhere. |
| `SETUP_TOKEN` | Shared secret required during first-run admin setup. |

`sslmode` values follow libpq: `require` encrypts without verifying the
certificate; `verify` (also `verify-ca`, `verify-full`) additionally validates
it against the system trust store.
