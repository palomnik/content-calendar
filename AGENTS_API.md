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

## Endpoints

### List all items
```bash
curl -s http://localhost:3001/api/items | python3 -m json.tool
```

### Create a new item
```bash
curl -s -X POST http://localhost:3001/api/items \
  -H "Content-Type: application/json" \
  -d '{
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
curl -s -X PATCH http://localhost:3001/api/items/ITEM_ID_HERE \
  -H "Content-Type: application/json" \
  -d '{
    "contentStatus": "Draft",
    "description": "Updated with new research"
  }'
```

### Delete an item
```bash
curl -s -X DELETE http://localhost:3001/api/items/ITEM_ID_HERE
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

## For AI Agents

When you (or another agent) want to modify the content calendar, use these curl commands or equivalent HTTP requests. The API returns JSON and uses standard HTTP status codes:
- `200` — success (GET, PATCH, DELETE)
- `201` — created (POST)
- `404` — item not found
- `500` — server error

## Important Notes

- The API **only works in dev mode** (`npx next dev`). The static export (`npx next build`) does not include API routes.
- The server-side database is stored at `content_calendar_api.db` in the project root. This is **separate** from the browser/iOS SQLite database (which lives in the browser's IndexedDB or the iOS app's Documents directory).
- To sync between the server API and the browser/iOS app, use **Export JSON** from the web UI and **Import** on the target device.
