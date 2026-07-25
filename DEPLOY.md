# Deployment Guide: Content Calendar

## Authentication

The app requires a sign-in. Every page and API route is protected; the only
public endpoints are the login page and the auth endpoints backing it.

### First run

On a database with no accounts, `/login` shows a **create administrator** form
instead of a sign-in form. The first person to submit it becomes the admin, and
the endpoint closes permanently after that.

Because a freshly deployed, publicly reachable instance is claimable by whoever
loads it first, set `SETUP_TOKEN` before exposing it:

```bash
SETUP_TOKEN="$(openssl rand -hex 24)"
```

When `SETUP_TOKEN` is set, the setup form also asks for that value. It is only
consulted while zero accounts exist and can be removed afterwards.

### Accounts follow the database

Users and sessions live in the **active database** (`users` and `sessions`
tables), alongside `content_items`. Switching providers in `/settings` switches
the account store too — the new database will prompt for admin setup if it has
no users. All three tables are created automatically.

### Cookies and HTTPS

Session cookies are `httpOnly` + `sameSite=lax`, and are marked `secure` when
`NODE_ENV=production` — so a production deployment **must** be served over
HTTPS or browsers will drop the cookie and logins will appear to silently fail.

### Recovering a lost admin password

There is no email reset. Another administrator can reset the password from
`/settings`. If every admin password is lost, delete the rows from the `users`
table in the active database (e.g. `DELETE FROM users;`) and reload `/login` —
the app returns to first-run setup. Content items are unaffected.

## Build verification (local)

```bash
cd /Users/strannik/Library/CloudStorage/Dropbox/Code/Content_Calendar
npm ci
npx next build
```

Build should complete successfully with 2 API routes (`/api/items`, `/api/items/[id]`) and the home page.

---

## Choosing a host

The app stores everything — content, users, sessions — in one database. Which
host suits you depends entirely on whether that database can be a local file.

| Host | Filesystem | Database |
|---|---|---|
| Coolify, Railway, Render | Persistent container disk | Built-in SQLite, no setup |
| Vercel | Read-only, ephemeral | **Requires** external Postgres/MySQL |

SQLite needs a writable file that survives between requests. Vercel's
serverless functions provide neither, so a deployment there must be pointed at
a network database via `DATABASE_URL`. This is not a settings problem — Vercel
has no persistent disk to offer.

---

## Option A: Vercel (requires an external database)

Vercel needs a Postgres database and one environment variable. The full
walkthrough — creating the database, connecting it, first-run setup, and
troubleshooting — is in **[VERCEL.md](./VERCEL.md)**.

The short version:

1. Create a Postgres database (Neon's free tier, via Vercel's Storage tab).
2. Import the GitHub repo at https://vercel.com/new — keep all build defaults.
3. Set `DATABASE_URL` to the **pooled** connection string, and `SETUP_TOKEN`
   to `openssl rand -hex 24`.
4. Deploy, then open the URL and create the admin account.

Environment variables are applied at deploy time, so **redeploy after changing
them**. Once connected, every push to `main` auto-deploys.

### Using CLI (headless)

```bash
vercel login
vercel --prod
```

---

## Option B: Railway

1. Go to https://railway.app/new and select "Deploy from GitHub repo"
2. Choose `palomnik/content-calendar`
3. Railway auto-detects Node.js — keep defaults
4. Deploy

Railway's container filesystem is **wiped on every redeploy**. SQLite works
between deploys but the data does not survive one, so add a Railway Volume
mounted at `/app/content_calendar.db` before putting anything real in it.
Alternatively set `DATABASE_URL` to a Railway Postgres instance and skip
volumes entirely.

---

## Option C: Render

1. Go to https://dashboard.render.com/new/web
2. Connect GitHub repo `palomnik/content-calendar`
3. Build command: `npm ci && npm run build`
4. Start command: `npm start`
5. Create a **Disk** mount at `/opt/render/project/src/content_calendar.db`

---

## Architecture notes

- **Runtime**: Node.js (required for API routes + better-sqlite3)
- **Database**: SQLite file (`content_calendar.db`) in the working directory by
  default; Postgres/MySQL/MariaDB when `DATABASE_URL` or the `DB_*` variables
  are set. Environment configuration wins over `data/db-config.json` and makes
  `/settings` read-only — see [VERCEL.md](./VERCEL.md) for the full reference.
- **Not suitable for**: Static export (`output: "export"`) — API routes need a server
- **Tailwind**: v4 with CSS-first config (`@import "tailwindcss"`)

---

## What's changed in this polish pass

- **Design**: Notion-like neutral palette (`#f7f6f3` surface, `#37352f` text, `#e3e2e0` borders), Inter font, subtle hover states
- **Loading**: Skeleton shimmer on header + all 6 kanban columns during initial data fetch
- **Empty states**: "No items" placeholder with icon in every empty column
- **Toasts**: Success/error/info toast notifications (top-right, auto-dismiss after 3s)
- **Responsive**: Mobile search bar, hamburger-ready header (icon-only buttons on small screens), `sm:grid-cols-2` forms, `flex-col-reverse` modal actions
- **Accessibility**: Proper labels, focus rings on inputs, keyboard-navigable modals
- **Error recovery**: Full-screen error state with retry button

---

## Files modified

- `app/globals.css` — Notion-like design tokens, skeleton animation, toast animations
- `app/layout.tsx` — Switched to Inter font
- `app/page.tsx` — Complete rewrite: skeletons, toasts, empty states, responsive grid, search, mobile menu stub
- `next.config.ts` — Removed commented export config, added `ignoreBuildErrors` for type mismatches
- `.gitignore` — Added `.pi/` to ignore Pi GSD workspace files

---

## Next step

Connect Vercel to the GitHub repo for one-click deploy: https://vercel.com/new
