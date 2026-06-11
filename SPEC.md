# Content Calendar App — SPEC

> **Context:** This spec is derived from a standard content-calendar database (fallback) because the source Notion URL (`https://app.notion.com/p/johnsimmonshypertext/2d82c90ce08e8048ad39c484995e1c0a`) requires workspace authentication and is inaccessible to automated inspection. If the live template deviates from this model, update the spec before implementation begins.

---

## 1. Data Model — Core Entity: `ContentItem`

Every row in the content calendar is a `ContentItem`.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | UUID (PK) | Yes | Auto-generated |
| `name` | String | Yes | Title of the post/content piece |
| `status` | Enum | Yes | `Idea`, `Draft`, `In Review`, `Scheduled`, `Published`, `Archived` |
| `platform` | Enum | Yes | `Instagram`, `TikTok`, `X/Twitter`, `LinkedIn`, `YouTube`, `Blog`, `Email`, `Other` |
| `publishDate` | DateTime | No | Target publish date & time (UTC, displayed in user tz) |
| `contentType` | Enum | No | `Carousel`, `Reel/Short`, `Text Post`, `Thread`, `Story`, `Live`, `Long-form`, `Newsletter` |
| `assignee` | Relation → `User` | No | Team member responsible |
| `notes` | Text | No | Free-form markdown notes |
| `campaign` | Relation → `Campaign` | No | Campaign this item belongs to |
| `tags` | Relation → `Tag` (many) | No | Categorization tags |
| `mediaUrl` | String[] | No | URLs to assets (images, video, Figma, Drive) |
| `caption` | Text | No | Full caption / body copy |
| `hashtags` | String[] | No | Stored as array for reuse/rendering |
| `performance` | JSON | No | `{ impressions, engagement, clicks, shares, comments }` |
| `createdAt` | DateTime | Yes | Auto |
| `updatedAt` | DateTime | Yes | Auto |

---

## 2. Data Model — Supporting Entities

### `User`
| Property | Type |
|----------|------|
| `id` | UUID (PK) |
| `email` | String (unique) |
| `name` | String |
| `avatarUrl` | String |
| `role` | Enum: `Admin`, `Editor`, `Viewer` |

### `Campaign`
| Property | Type |
|----------|------|
| `id` | UUID (PK) |
| `name` | String |
| `description` | Text |
| `startDate` | DateTime |
| `endDate` | DateTime |
| `status` | Enum: `Planning`, `Active`, `Completed`, `Paused` |

### `Tag`
| Property | Type |
|----------|------|
| `id` | UUID (PK) |
| `name` | String (unique) |
| `color` | String (hex) |

---

## 3. Views

The app must provide the following views, matching Notion’s database view parity:

1. **Table View** — All properties as sortable/filterable columns. Default sort: `publishDate` ASC.
2. **Board View (Kanban)** — Grouped by `status`. Cards show `name`, `platform`, `publishDate`, `assignee` avatar.
3. **Calendar View** — Items placed on `publishDate`. Month/week toggle. Click date to create new item.
4. **List View** — Condensed rows, grouped by `status` or `platform`.
5. **Gallery View** — Card grid with thumbnail/preview, `name`, `status`, `platform`, `publishDate`.

All views share the same filters (property-based) and sorts.

---

## 4. Computed / Formula Fields

Derived values displayed in views but not stored as editable columns:

| Formula | Logic |
|---------|-------|
| `daysUntilPublish` | `publishDate ? ceil((publishDate - now) / 86400000) : null` |
| `isOverdue` | `publishDate < now && status NOT IN ('Published','Archived')` |
| `performanceScore` | `performance ? weighted(impressions, engagement, clicks) : null` |

These can be computed client-side or via DB views; no dedicated storage required.

---

## 5. Workflows (Status Transitions)

```
Idea → Draft → In Review → Scheduled → Published → Archived
         ↑_________________________________________|
```

- Any status can move backwards or to `Archived` except `Published` cannot return to `Draft` without admin override.
- On transition to `Scheduled`, if `publishDate` is null, prompt user.
- On transition to `Published`, lock `caption` and `mediaUrl` (soft-lock with confirmation).

---

## 6. Tech Stack Recommendation

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | **Next.js 15** (App Router) | Full-stack React, SSR, API routes in one repo |
| Language | TypeScript | Type safety across DB ↔ API ↔ UI |
| Styling | Tailwind CSS | Rapid UI iteration, consistent spacing |
| Components | shadcn/ui + Radix | Accessible primitives, matches Notion’s density |
| ORM | Prisma | Type-safe queries, migration system |
| Database | PostgreSQL | Robust relational data, JSONB for `performance` |
| Auth | NextAuth.js (OAuth: Google) | Aligns with user’s existing Google Workspace |
| State | Zustand (client) | Lightweight global state for filters/views |
| Date handling | date-fns | Immutable, tree-shakeable |
| Calendar UI | @fullcalendar/react or react-big-calendar | Drop-in month/week/day views |

---

## 7. Prisma Schema Sketch

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  avatarUrl String?
  role      Role     @default(Editor)
  items     ContentItem[]
}

model Campaign {
  id          String   @id @default(uuid())
  name        String
  description String?
  startDate   DateTime?
  endDate     DateTime?
  status      CampaignStatus @default(Planning)
  items       ContentItem[]
}

model Tag {
  id    String @id @default(uuid())
  name  String @unique
  color String @default("#6366f1")
  items ContentItem[]
}

model ContentItem {
  id          String       @id @default(uuid())
  name        String
  status      Status       @default(Idea)
  platform    Platform
  publishDate DateTime?
  contentType ContentType?
  notes       String?
  caption     String?
  hashtags    String[]
  mediaUrl    String[]
  performance Json?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  assigneeId  String?
  assignee    User?        @relation(fields: [assigneeId], references: [id])

  campaignId  String?
  campaign    Campaign?    @relation(fields: [campaignId], references: [id])

  tags        Tag[]
}

enum Role {
  Admin
  Editor
  Viewer
}

enum CampaignStatus {
  Planning
  Active
  Completed
  Paused
}

enum Status {
  Idea
  Draft
  InReview
  Scheduled
  Published
  Archived
}

enum Platform {
  Instagram
  TikTok
  X
  LinkedIn
  YouTube
  Blog
  Email
  Other
}

enum ContentType {
  Carousel
  ReelShort
  TextPost
  Thread
  Story
  Live
  LongForm
  Newsletter
}
```

---

## 8. API Surface (REST)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/items` | GET, POST | List (with filters/sort/pagination) or create |
| `/api/items/[id]` | GET, PATCH, DELETE | CRUD single item |
| `/api/items/[id]/status` | PATCH | Transition status with validation |
| `/api/campaigns` | GET, POST | Campaign list / create |
| `/api/tags` | GET, POST | Tag list / create |
| `/api/users` | GET | Team directory |
| `/api/views` | GET | Saved view configurations per user |

---

## 9. Page Routes

| Route | Purpose |
|-------|---------|
| `/` | Dashboard redirect |
| `/calendar` | Default Calendar view |
| `/table` | Table view |
| `/board` | Kanban board view |
| `/list` | List view |
| `/gallery` | Gallery view |
| `/items/[id]` | Detail/edit drawer or page |
| `/campaigns` | Campaign management |
| `/settings` | Team, tags, integrations |

---

## 10. Acceptance Criteria

- [ ] `SPEC.md` is present in `/Users/strannik/Dropbox/Code/Content_Calendar/docs/SPEC.md`
- [ ] Schema covers all core properties, views, formulas, and workflows above
- [ ] Prisma schema is valid and can generate a migration
- [ ] Tech stack is justified and consistent with existing JSH projects
- [ ] Reviewer has approved the spec before any implementation task begins

---

*Last updated: 2026-06-08*
