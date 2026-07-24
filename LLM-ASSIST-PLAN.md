# LLM Content Assistant — Proposal & Plan

> **Status: proposal only.** This document plans and suggests an LLM-powered
> assistant for the Content Calendar. Per the V2 spec, **no implementation is
> included** — this is the design to review and approve before any code is
> written.

## 1. Goal

Give each content item an on-demand AI collaborator that is *aware of where the
item is in the pipeline*. A record in **Brainstormed** needs help generating
angles; a record in **In Review** needs a critical editor. The assistant should
adapt its behavior to the item's `contentStatus` rather than being a single
generic chat box.

## 2. Where it lives in the UI

Two complementary surfaces, both optional and non-intrusive:

1. **"✨ Assist" button inside the edit modal.** Opens a side panel scoped to the
   currently-open record. This is the primary entry point — the assistant always
   has the full record as context.
2. **Per-card quick action (stretch goal).** A small ✨ icon on Kanban cards that
   deep-links into the same panel for that record.

The panel is a chat thread: message history on top, an input box at the bottom,
and a row of **status-specific suggested prompts** ("quick actions") above the
input.

## 3. Status-aware behavior

The assistant's system prompt and quick actions change with the record's status.
This is the core idea — the assistant meets the writer at their current stage.

| Status        | Assistant role        | Suggested quick actions |
|---------------|-----------------------|-------------------------|
| Brainstormed  | Ideator               | "Generate 5 angles", "Suggest headlines", "Who's the target reader?", "Related topics to cover" |
| Outlined      | Structural editor     | "Draft an outline", "Suggest H2/H3 sections", "What's missing from this outline?" |
| Draft         | Writing partner       | "Expand this section", "Tighten the intro", "Suggest a stronger hook", "Add examples" |
| In Review     | Critical editor       | "Line-edit for clarity", "Flag unsupported claims", "Check tone vs. target reader", "Suggest a title A/B test" |
| Scheduled     | Promotion planner     | "Draft social posts", "Suggest promo channels", "Write a newsletter blurb", "Repurpose ideas" |
| Published     | Analyst / repurposer  | "Suggest follow-up pieces", "Draft a LinkedIn recap", "Internal links to add", "Update/refresh ideas" |

Each record field (`headline`, `description`, `keywords`, `targetReader`,
`format`, `platform`, `writer`, `notes`, …) is passed as structured context so
the assistant's output is grounded in the actual item.

## 4. Architecture

```
Edit modal ──"✨ Assist"──▶ AssistPanel (client)
                                  │  POST /api/assist  { itemId, status, messages }
                                  ▼
                          app/api/assist/route.ts (server)
                                  │  1. Load item via app/lib/db.ts (getItem)
                                  │  2. Pick system prompt by contentStatus
                                  │  3. Call the model provider (streaming)
                                  ▼
                          Provider adapter (app/lib/assist.ts)
                                  │  Claude (Anthropic) by default; pluggable
                                  ▼
                          Stream tokens back to the panel (SSE / ReadableStream)
```

Key decisions:

- **Reuse the DB layer.** The route pulls the record through the existing
  `getItem()` in `app/lib/db.ts`, so it works identically across SQLite, MySQL,
  MariaDB, and Postgres.
- **Server-side only.** The API key never touches the browser. The route is a
  standard App Router `route.ts` returning a streamed response.
- **Provider-agnostic adapter.** A thin `app/lib/assist.ts` mirrors the pattern
  of the DB adapter so a different model/provider can be swapped without touching
  the route or UI. Default to the latest Claude model (`claude-opus-4-8` /
  `claude-sonnet-5`) via the Anthropic SDK.
- **Streaming responses** for perceived speed, using a `ReadableStream` from the
  route handler.

## 5. Configuration (extends the Settings screen)

Add an **"AI Assistant"** section to `/settings`, persisted alongside the DB
config in `data/`:

- Enable / disable the assistant globally.
- Provider + model selection.
- API key (stored server-side in `data/assist-config.json`, redacted on read —
  same pattern already used for the DB password).
- Optional: default temperature, and a house **brand-voice / style note** that is
  prepended to every system prompt so output matches the publication's voice.

When disabled or unconfigured, the ✨ Assist button is simply hidden.

## 6. Proposed data model additions (optional)

To make the assistant persistent and auditable, optionally add a table:

```
assist_messages (
  id, item_id, role,        -- 'user' | 'assistant'
  content, status_at_time,  -- the item's status when the message was sent
  created_at
)
```

This lets a conversation resume later and records *which stage* advice was given
in. If we want to stay stateless for v1, skip this and keep history client-side
for the life of the modal only.

## 7. Suggested build phases

1. **Phase 1 — Read-only assist (MVP).** Assist panel in the edit modal, status
   quick actions, streaming responses, Anthropic adapter, settings toggle + key.
   No persistence; assistant output is copy/paste into fields.
2. **Phase 2 — Write-back.** "Apply" buttons that write a suggestion directly into
   the relevant field (e.g. accept a generated headline → `headline`). Uses the
   existing `PATCH /api/items/[id]`.
3. **Phase 3 — Persistence & history.** Add `assist_messages`, resumable threads,
   per-stage audit trail.
4. **Phase 4 — Bulk / proactive.** "Brainstorm 10 new items" from a topic, or
   nudges like "3 drafts have been idle 2 weeks — want help?".

## 8. Risks & considerations

- **Cost / rate limits** — gate behind the settings toggle; consider per-day caps.
- **Key security** — server-only, redacted on read, never logged.
- **Latency** — streaming mitigates; keep context to the single record, not the
  whole board.
- **Accuracy** — the assistant drafts; the human always approves. Never
  auto-publish or auto-change status.
- **Provider portability** — the adapter keeps us from locking to one vendor.

## 9. Explicitly out of scope for this document

No routes, components, buttons, or model calls are created here. Implementation
begins only after this plan is approved.
