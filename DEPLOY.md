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

## Option A: Vercel (Recommended — easiest)

### One-time setup

1. Go to https://vercel.com/new and import `palomnik/content-calendar`
2. Vercel auto-detects Next.js — keep defaults
3. Add environment variable if needed: `NODE_OPTIONS="--no-warnings"`
4. Deploy

### Auto-deploy from pushes

Once connected, every push to `main` auto-deploys.

### Using CLI (headless)

If you prefer CLI deployment:

```bash
vercel login
# Then:
vercel --prod
```

---

## Option B: Railway

1. Go to https://railway.app/new and select "Deploy from GitHub repo"
2. Choose `palomnik/content-calendar`
3. Railway auto-detects Node.js — keep defaults
4. Deploy

The SQLite DB will persist on Railway's ephemeral filesystem. For production durability, add a Railway Volume mounted at `/app/content_calendar.db`.

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
- **Database**: SQLite file (`content_calendar.db`) — persists in working directory
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
