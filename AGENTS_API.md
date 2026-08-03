# Content Calendar — Agent / API Usage Guide

The app exposes a REST API at `http://localhost:3001` when running in dev mode (`npx next dev --port 3001`). This lets you or other agents programmatically add, edit, list, and delete content items.

## Base URL
```
http://localhost:3001/api/items
```

When hosting on an external domain via Caddy, replace accordingly:
```
https://contentcalendar.example.com/api/items
```

## Authentication and teams

Every endpoint below requires a signed-in session cookie. Sign in once and keep
the cookie jar:

```bash
curl -s -c cc.jar -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"jsmith","password":"…"}'
```

Content lives on **team boards**. An account sees only the boards of the teams it
belongs to, so every call is scoped to a team — including for administrators,
who get no access to a team they are not a member of.

```bash
# Teams this account can reach
curl -s -b cc.jar http://localhost:3001/api/teams
```

Where a team is not named explicitly the account's first team is used, so a
single-team account can leave `teamId` out entirely.

## Endpoints

### List a team's items
```bash
curl -s -b cc.jar "http://localhost:3001/api/items?teamId=TEAM_ID" | python3 -m json.tool
```

### Create a new item
```bash
curl -s -b cc.jar -X POST http://localhost:3001/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "teamId": "TEAM_ID",
    "headline": "How to Build a Content Calendar",
    "description": "Step-by-step guide for planning editorial content",
    "format": "Blog Post",
    "platform": "Website",
    "contentStatus": "Brainstormed",
    "writer": "AI Agent"
  }'
```

### Update an item (e.g., move to Draft)
```bash
curl -s -b cc.jar -X PATCH http://localhost:3001/api/items/ITEM_ID_HERE \
  -H "Content-Type: application/json" \
  -d '{
    "contentStatus": "Draft",
    "description": "Updated with new research"
  }'
```

An item cannot be moved between teams. `teamId` in a PATCH body is ignored — a
board is a permission boundary, and a stray field in an update is not the way
content should cross one.

### Delete an item
```bash
curl -s -b cc.jar -X DELETE http://localhost:3001/api/items/ITEM_ID_HERE
```

## Full Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `headline` | string (required) | Article or content title |
| `description` | string | Brief summary |
| `format` | string | Blog Post, Video, Podcast, etc. |
| `keywords` | string | SEO keywords |
| `targetReader` | string | Audience description |
| `platform` | string | Website, LinkedIn, Twitter, etc. |
| `internalLinks` | string | Related internal content |
| `externalLinks` | string | External references |
| `wordCount` | integer | Target or actual word count |
| `contentStatus` | string | Brainstormed, Outlined, Draft, In Review, Scheduled, Published |
| `dueDate` | string (ISO) | Writer deadline |
| `publishDate` | string (ISO) | Go-live date |
| `writer` | string | Assigned author |
| `promotionPlan` | string | Distribution strategy |
| `smes` | string | Subject matter experts |
| `gdriveLink` | string | Google Drive URL |
| `notes` | string | Free-form notes |
| `contextFileName` | string | Name of the uploaded context file, e.g. `brand-voice.md` |
| `contextFile` | string | Markdown context — brand voice, product details, ideal client avatar. Sent to the model with every outline and draft for this item. Max 40,000 characters |

## For AI Agents

When you (or another agent) want to modify the content calendar, use these curl commands or equivalent HTTP requests. The API returns JSON and uses standard HTTP status codes:
- `200` — success (GET, PATCH, DELETE)
- `201` — created (POST)
- `401` — not signed in, or the session has expired
- `403` — the named team is not one this account belongs to
- `404` — item not found. Also returned for an item on another team's board:
  a `403` there would confirm the id is real, which would leak what other teams
  are working on
- `500` — server error

## Important Notes

- The API **only works in dev mode** (`npx next dev`). The static export (`npx next build`) does not include API routes.
- The server-side database is stored at `content_calendar_api.db` in the project root. This is **separate** from the browser/iOS SQLite database (which lives in the browser's IndexedDB or the iOS app's Documents directory).
- To sync between the server API and the browser/iOS app, use **Export JSON** from the web UI and **Import** on the target device.
