"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { MAX_CONTEXT_FILE_CHARS } from "./lib/fields";
import { exportCsv, parseCsv, browserDownload, getMyTeams, Team } from "./lib/sqlite";
import { buildIcs, countIcsEvents } from "./lib/ics";
import { clearTestSession, liveStore, testStore } from "./lib/store";
import { leaveTo, signOut, useAuth } from "./lib/useAuth";
import MonthCalendar from "./MonthCalendar";

interface ContentItem {
  id: string;
  headline: string;
  description: string | null;
  format: string | null;
  keywords: string | null;
  targetReader: string | null;
  platform: string | null;
  internalLinks: string | null;
  externalLinks: string | null;
  wordCount: number | null;
  contentStatus: string;
  dueDate: string | null;
  publishDate: string | null;
  writer: string | null;
  promotionPlan: string | null;
  smes: string | null;
  gdriveLink: string | null;
  notes: string | null;
  contextFileName: string | null;
  contextFile: string | null;
}

/* ─────────────── Design Tokens ─────────────── */

const STATUS_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  Brainstormed: { bg: "bg-[#f7f6f3]", border: "border-[#e3e2e0]", dot: "bg-gray-400" },
  Outlined:     { bg: "bg-[#fff9e6]", border: "border-[#f0e6b6]", dot: "bg-yellow-500" },
  Draft:        { bg: "bg-[#e8f4f8]", border: "border-[#b8dce8]", dot: "bg-sky-500" },
  "In Review":  { bg: "bg-[#f3e8ff]", border: "border-[#d8c4f0]", dot: "bg-purple-500" },
  Scheduled:    { bg: "bg-[#fff3e0]", border: "border-[#f0d6b0]", dot: "bg-orange-500" },
  Published:    { bg: "bg-[#e8f5e9]", border: "border-[#b8e0ba]", dot: "bg-green-500" },
};

const STATUSES = [
  "Brainstormed",
  "Outlined",
  "Draft",
  "In Review",
  "Scheduled",
  "Published",
];

type View = "kanban" | "date" | "status";

const VIEWS: { value: View; label: string }[] = [
  { value: "kanban", label: "Kanban View" },
  { value: "date", label: "Date" },
  { value: "status", label: "Status" },
];

/* ─────────────── AI assistant ─────────────── */

// Which status offers which generation, and what the button says.
const AI_ACTIONS: Record<string, { task: "outline" | "draft"; label: string }> = {
  Brainstormed: { task: "outline", label: "Generate outline" },
  Outlined: { task: "draft", label: "Generate draft" },
};

const EMPTY_CAMPAIGN = {
  campaignName: "",
  campaignGoal: "",
  contextFileName: "",
  contextFile: "",
  count: "6",
  format: "",
  platform: "",
  writer: "",
  targetReader: "",
  dueDate: "",
  publishDate: "",
};

export interface ContextFileValue {
  contextFileName: string;
  contextFile: string;
}

/**
 * Upload a markdown file of standing campaign context.
 *
 * The file is read in the browser and travels as ordinary JSON — there is no
 * upload endpoint and nothing is written to disk. It is stored on each content
 * item, which is what makes it available to the outline and draft generators
 * long after the campaign that produced the item.
 */
function ContextFileField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: ContextFileValue;
  onChange: (next: ContextFileValue) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const attached = Boolean(value.contextFile.trim());

  const takeFile = async (file: File | undefined) => {
    setError(null);
    // Always clear the picker: without this, choosing the same file again
    // after a Remove fires no change event and nothing appears to happen.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) {
        setError("That file is empty.");
        return;
      }
      if (text.length > MAX_CONTEXT_FILE_CHARS) {
        setError(
          `That file is ${text.length.toLocaleString()} characters. Keep it under ${MAX_CONTEXT_FILE_CHARS.toLocaleString()} — the whole file is sent to the model with every outline and draft.`
        );
        return;
      }
      onChange({ contextFileName: file.name, contextFile: text });
    } catch {
      setError("That file could not be read.");
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </label>
      {help && (
        <p className="mb-2 text-xs leading-relaxed text-[var(--muted)]">{help}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
        onChange={(e) => void takeFile(e.target.files?.[0])}
        className="block w-full cursor-pointer text-sm text-[var(--muted)] file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--foreground)] hover:file:bg-[var(--surface-hover)]"
      />
      {attached && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className="font-medium text-[var(--foreground)]">
            {value.contextFileName || "Context file"}
          </span>
          <span>{value.contextFile.length.toLocaleString()} characters</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              onChange({ contextFileName: "", contextFile: "" });
            }}
            className="underline transition hover:text-[var(--danger)]"
          >
            Remove
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Append generated text under a dated heading, never overwriting existing notes. */
function composeNotes(
  existing: string | null | undefined,
  task: "outline" | "draft",
  text: string
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const heading = task === "outline" ? "AI outline" : "AI draft";
  const block = `## ${heading} — ${stamp}\n\n${text.trim()}\n`;
  const prior = String(existing ?? "").trim();
  return prior ? `${prior}\n\n---\n\n${block}` : block;
}

/** Remembers which board was open, per browser. Never trusted for access. */
const LAST_TEAM_KEY = "cc_last_team";

const EMPTY_FORM = {
  headline: "",
  description: "",
  format: "",
  keywords: "",
  targetReader: "",
  platform: "",
  internalLinks: "",
  externalLinks: "",
  wordCount: "",
  contentStatus: "Brainstormed",
  dueDate: "",
  publishDate: "",
  writer: "",
  promotionPlan: "",
  smes: "",
  gdriveLink: "",
  notes: "",
  contextFileName: "",
  contextFile: "",
};

function toFormValues(item: ContentItem | null) {
  if (!item) return EMPTY_FORM;
  return {
    headline: item.headline || "",
    description: item.description || "",
    format: item.format || "",
    keywords: item.keywords || "",
    targetReader: item.targetReader || "",
    platform: item.platform || "",
    internalLinks: item.internalLinks || "",
    externalLinks: item.externalLinks || "",
    wordCount: item.wordCount != null ? String(item.wordCount) : "",
    contentStatus: item.contentStatus || "Brainstormed",
    dueDate: item.dueDate ? item.dueDate.slice(0, 10) : "",
    publishDate: item.publishDate ? item.publishDate.slice(0, 10) : "",
    writer: item.writer || "",
    promotionPlan: item.promotionPlan || "",
    smes: item.smes || "",
    gdriveLink: item.gdriveLink || "",
    notes: item.notes || "",
    contextFileName: item.contextFileName || "",
    contextFile: item.contextFile || "",
  };
}

/* ─────────────── Drag & drop (pointer based) ───────────────

   HTML5 drag-and-drop does not fire on iOS/iPadOS touch, so dragging is built
   on Pointer Events instead — one code path for mouse, trackpad and touch.

   Touch drags arm on a short press-and-hold: until the hold completes the
   browser scrolls normally, and any movement past TOUCH_SLOP cancels the
   pending drag so swiping across a card still pans the board. Once armed we
   preventDefault touchmove to take the gesture away from the scroller. */

const LONG_PRESS_MS = 200; // hold before a touch drag arms
const TOUCH_SLOP = 8; // movement (px) that cancels a pending touch drag
const MOUSE_SLOP = 4; // movement (px) that starts a mouse drag
const EDGE_ZONE = 72; // distance (px) from a scroll edge that auto-scrolls
const EDGE_SPEED = 18; // max auto-scroll travel per frame (px)

type PendingDrag = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  isTouch: boolean;
  active: boolean;
  over: string | null;
  timer: number | null;
};

type DragPreview = {
  id: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
};

/** Column (and its card list) sitting under the pointer, via hit-testing. */
function columnUnder(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const column = el?.closest<HTMLElement>("[data-drop-status]") ?? null;
  return {
    status: column?.dataset.dropStatus ?? null,
    list: column?.querySelector<HTMLElement>("[data-card-list]") ?? null,
  };
}

/** Auto-scroll speed, ramping up as the pointer nears the edge. */
function edgeSpeed(depth: number) {
  return Math.min(1, depth / EDGE_ZONE) * EDGE_SPEED;
}

/* ─────────────── Toast ─────────────── */

type Toast = { id: string; message: string; type: "success" | "error" | "info" };

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);
  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  return { toasts, show, dismiss };
}

/* ─────────────── Skeletons ─────────────── */

function CardSkeleton() {
  return (
    <div className="mb-3 rounded-lg border border-[var(--border)] bg-white p-3 shadow-sm">
      <div className="skeleton mb-2 h-4 w-3/4"></div>
      <div className="skeleton mb-1 h-3 w-full"></div>
      <div className="skeleton h-3 w-1/2"></div>
      <div className="mt-2 flex gap-1">
        <div className="skeleton h-4 w-12"></div>
        <div className="skeleton h-4 w-10"></div>
      </div>
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="skeleton h-4 w-24"></div>
        <div className="skeleton h-5 w-7 rounded-full"></div>
      </div>
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

/* ─────────────── Kanban card ─────────────── */

/** Card contents, shared by the in-column card and the floating drag preview. */
function CardBody({ item }: { item: ContentItem }) {
  return (
    <>
      <h3 className="mb-1.5 text-sm font-semibold leading-snug text-[var(--foreground)]">
        {item.headline}
      </h3>
      {item.description && (
        <p className="mb-2.5 text-xs leading-relaxed text-[var(--muted)] line-clamp-2">
          {item.description}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {item.format && (
          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--foreground)] dark:bg-[#333]">
            {item.format}
          </span>
        )}
        {item.platform && (
          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--foreground)] dark:bg-[#333]">
            {item.platform}
          </span>
        )}
        {item.writer && (
          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--foreground)] dark:bg-[#333]">
            ✍ {item.writer}
          </span>
        )}
      </div>
      {(item.dueDate || item.publishDate) && (
        <div className="mt-2.5 flex items-center gap-2 text-[10px] text-[var(--muted)]">
          {item.dueDate && (
            <span>
              Due{" "}
              {new Date(item.dueDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          )}
          {item.publishDate && (
            <span>
              Pub{" "}
              {new Date(item.publishDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/* ─────────────── List views (Date / Status) ─────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
      <span className="mb-2 text-3xl">📭</span>
      <p className="text-sm text-[var(--muted)]">No items to show</p>
    </div>
  );
}

function ListGroup({
  heading,
  records,
  onOpen,
  dot,
}: {
  heading: string;
  records: ContentItem[];
  onOpen: (item: ContentItem) => void;
  dot?: string;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-2 border-b border-[var(--border)] pb-1.5">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`}></span>}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          {heading}
        </h2>
        <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
          {records.length}
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {records.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => onOpen(item)}
              className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-[var(--surface)]"
            >
              <span className="flex-1 truncate text-sm font-medium text-[var(--foreground)]">
                {item.headline}
              </span>
              {item.format && (
                <span className="hidden shrink-0 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)] sm:inline">
                  {item.format}
                </span>
              )}
              {item.writer && (
                <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">
                  ✍ {item.writer}
                </span>
              )}
              <span className="shrink-0 text-xs text-[var(--muted)]">{item.contentStatus}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─────────────── Main Page ─────────────── */

export default function Board({ testMode = false }: { testMode?: boolean }) {
  // Test mode swaps the entire data layer for one that lives in this browser
  // tab, so no request that could reach the database is ever made.
  const store = testMode ? testStore : liveStore;
  const { user } = useAuth(testMode);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Teams ── */
  // One board per team. `teams` stays null in test mode, which has no account
  // and therefore no teams — the switcher and everything around it is hidden
  // rather than faked.
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const { toasts, show, dismiss } = useToast();

  const boardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<PendingDrag | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [dropStatus, setDropStatus] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [view, setView] = useState<View>("kanban");

  /* ── AI assistant ── */
  // Null until the check resolves, so the buttons never flash in and out.
  const [aiReady, setAiReady] = useState(false);
  const [aiPanel, setAiPanel] = useState<{
    item: ContentItem;
    task: "outline" | "draft";
    text: string;
    status: "streaming" | "done" | "error" | "stopped";
    error: string | null;
    saving: boolean;
  } | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  const [showBrainstorm, setShowBrainstorm] = useState(false);
  const [campaign, setCampaign] = useState(EMPTY_CAMPAIGN);
  const [brainstormBusy, setBrainstormBusy] = useState(false);
  const [brainstormError, setBrainstormError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<any[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [creatingItems, setCreatingItems] = useState(false);

  // Which board was open last time. A preference only — the server decides
  // whether this session may actually read that team, and a stale id here is
  // dropped below rather than trusted.
  useEffect(() => {
    if (testMode) return;
    let cancelled = false;

    getMyTeams()
      .then((mine) => {
        if (cancelled) return;
        setTeams(mine);
        const remembered = window.localStorage.getItem(LAST_TEAM_KEY);
        const keep = mine.some((t) => t.id === remembered) ? remembered : null;
        setTeamId(keep ?? mine[0]?.id ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load teams:", e);
        setError("Could not load your teams: " + String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [testMode]);

  useEffect(() => {
    // Live mode waits for the team list: loading a board before knowing which
    // board would just be the server's fallback choice, then a second load.
    if (!testMode) {
      if (teams === null) return;
      if (teams.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }
      if (!teamId) return;
    }

    let cancelled = false;
    setLoading(true);

    store
      .getAll(teamId)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load items:", e);
        setError(
          (testMode ? "Could not start test mode: " : "Database failed to load: ") +
            String(e)
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [store, testMode, teams, teamId]);

  const switchTeam = (next: string) => {
    setTeamId(next);
    setSearch("");
    try {
      window.localStorage.setItem(LAST_TEAM_KEY, next);
    } catch {
      // Private mode, or storage disabled. The board still switches; it just
      // will not remember the choice on the next visit.
    }
  };

  // Hide the AI buttons entirely when nothing is configured — a button that
  // always errors is worse than no button.
  useEffect(() => {
    store.llmConfigured().then(setAiReady);
  }, [store]);

  const refresh = async () => {
    try {
      const data = await store.getAll(teamId);
      setItems(data);
    } catch (e: any) {
      setError(String(e));
      show("Failed to refresh items", "error");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.headline.trim()) return;
    setAddSaving(true);
    try {
      const newItem = await store.create(
        {
          ...addForm,
          wordCount: addForm.wordCount ? parseInt(addForm.wordCount, 10) : null,
          dueDate: addForm.dueDate || null,
          publishDate: addForm.publishDate || null,
        },
        teamId
      );
      setItems((prev) => [newItem, ...prev]);
      setAddForm(EMPTY_FORM);
      setShowAddModal(false);
      show("Item created", "success");
    } catch (e: any) {
      setError(String(e));
      show("Failed to create item", "error");
    } finally {
      setAddSaving(false);
    }
  };

  const openEdit = useCallback((item: ContentItem) => {
    setEditingItem(item);
    setEditForm(toFormValues(item));
  }, []);

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editForm.headline.trim()) return;
    setEditSaving(true);
    try {
      const updated = await store.update(editingItem.id, {
        ...editForm,
        wordCount: editForm.wordCount ? parseInt(editForm.wordCount, 10) : null,
        dueDate: editForm.dueDate || null,
        publishDate: editForm.publishDate || null,
      });
      if (updated) {
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      setEditingItem(null);
      show("Changes saved", "success");
    } catch (e: any) {
      setError(String(e));
      show("Failed to save changes", "error");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingItem) return;
    if (!confirm("Delete this item?")) return;
    try {
      await store.remove(editingItem.id);
      setItems((prev) => prev.filter((i) => i.id !== editingItem.id));
      setEditingItem(null);
      show("Item deleted", "info");
    } catch (e: any) {
      setError(String(e));
      show("Failed to delete item", "error");
    }
  };

  /* ─────────────── AI assistant ─────────────── */

  // Streams into a modal rather than the card: a 288px column cannot show a
  // 1500-word draft. Nothing is written until the user accepts it.
  const runGeneration = useCallback(
    async (item: ContentItem, task: "outline" | "draft") => {
      aiAbortRef.current?.abort();
      const controller = new AbortController();
      aiAbortRef.current = controller;

      setAiPanel({ item, task, text: "", status: "streaming", error: null, saving: false });

      try {
        for await (const delta of store.streamGeneration(item, task, controller.signal)) {
          setAiPanel((p) =>
            p && p.item.id === item.id && p.status === "streaming"
              ? { ...p, text: p.text + delta }
              : p
          );
        }
        setAiPanel((p) => (p && p.status === "streaming" ? { ...p, status: "done" } : p));
      } catch (e: any) {
        if (controller.signal.aborted) return; // user pressed Stop
        setAiPanel((p) =>
          p ? { ...p, status: "error", error: e?.message ?? "Generation failed." } : p
        );
      } finally {
        if (aiAbortRef.current === controller) aiAbortRef.current = null;
      }
    },
    [store]
  );

  const stopGeneration = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    // Keep whatever arrived — a partial outline is still worth saving.
    setAiPanel((p) => (p && p.status === "streaming" ? { ...p, status: "stopped" } : p));
  };

  const closeAiPanel = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiPanel(null);
  };

  const saveGeneration = async () => {
    const panel = aiPanel;
    if (!panel || !panel.text.trim()) return;
    setAiPanel((p) => (p ? { ...p, saving: true } : p));
    try {
      // Re-read from state so a note edited since the panel opened is preserved.
      const current = items.find((i) => i.id === panel.item.id) ?? panel.item;
      const updated = await store.update(panel.item.id, {
        notes: composeNotes(current.notes, panel.task, panel.text),
      });
      if (updated) {
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      setAiPanel(null);
      show(panel.task === "outline" ? "Outline saved to notes" : "Draft saved to notes", "success");
    } catch (e: any) {
      setAiPanel((p) =>
        p ? { ...p, saving: false, error: e?.message ?? "Could not save to notes." } : p
      );
    }
  };

  const runBrainstorm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBrainstormBusy(true);
    setBrainstormError(null);
    try {
      const { items: proposed } = await store.brainstorm({
        campaignName: campaign.campaignName,
        campaignGoal: campaign.campaignGoal,
        contextFileName: campaign.contextFileName,
        contextFile: campaign.contextFile,
        count: Number(campaign.count) || 6,
        defaults: {
          format: campaign.format,
          platform: campaign.platform,
          writer: campaign.writer,
          targetReader: campaign.targetReader,
          dueDate: campaign.dueDate,
          publishDate: campaign.publishDate,
        },
      });
      setProposals(proposed);
      setChosen(new Set(proposed.map((_: any, i: number) => i)));
    } catch (e: any) {
      setBrainstormError(e?.message ?? "Brainstorm failed.");
    } finally {
      setBrainstormBusy(false);
    }
  };

  const createChosenItems = async () => {
    if (!proposals || chosen.size === 0) return;
    setCreatingItems(true);
    try {
      // Sequential, matching how CSV import already creates in bulk.
      const created: ContentItem[] = [];
      for (let i = 0; i < proposals.length; i++) {
        if (!chosen.has(i)) continue;
        created.push(await store.create(proposals[i], teamId));
      }
      setItems((prev) => [...created, ...prev]);
      show(`Created ${created.length} item${created.length === 1 ? "" : "s"}`, "success");
      closeBrainstorm();
    } catch (e: any) {
      setBrainstormError(e?.message ?? "Could not create the selected items.");
      refresh();
    } finally {
      setCreatingItems(false);
    }
  };

  const closeBrainstorm = () => {
    setShowBrainstorm(false);
    setProposals(null);
    setChosen(new Set());
    setBrainstormError(null);
    setCampaign(EMPTY_CAMPAIGN);
  };

  /* ─────────────── Drag & drop ─────────────── */

  // Pointer handlers live outside React's render cycle, so they read items
  // through a ref rather than a captured closure.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const moveItem = useCallback(
    async (id: string, status: string) => {
      const original = itemsRef.current.find((i) => i.id === id);
      if (!original || original.contentStatus === status) return;
      // Apply optimistically — a drop should land the instant the finger lifts.
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, contentStatus: status } : i))
      );
      try {
        const updated = await store.update(id, { contentStatus: status });
        if (updated) {
          setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        }
        show(`Moved to ${status}`, "info");
      } catch {
        setItems((prev) => prev.map((i) => (i.id === id ? original : i)));
        show("Failed to move item", "error");
      }
    },
    [show, store]
  );

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Nudge the board horizontally and the hovered column vertically whenever the
  // pointer sits near an edge — on iPad the six columns never fit at once.
  const startAutoScroll = useCallback(() => {
    function step() {
      rafRef.current = null;
      if (!dragRef.current?.active) return;
      const { x, y } = pointerRef.current;

      const board = boardRef.current;
      if (board) {
        const r = board.getBoundingClientRect();
        if (x < r.left + EDGE_ZONE) board.scrollLeft -= edgeSpeed(r.left + EDGE_ZONE - x);
        else if (x > r.right - EDGE_ZONE) board.scrollLeft += edgeSpeed(x - (r.right - EDGE_ZONE));
      }

      const list = columnUnder(x, y).list;
      if (list) {
        const r = list.getBoundingClientRect();
        if (y < r.top + EDGE_ZONE) list.scrollTop -= edgeSpeed(r.top + EDGE_ZONE - y);
        else if (y > r.bottom - EDGE_ZONE) list.scrollTop += edgeSpeed(y - (r.bottom - EDGE_ZONE));
      }

      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const activateDrag = useCallback(() => {
    const st = dragRef.current;
    if (!st || st.active) return;
    if (st.timer !== null) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    st.active = true;
    const { x, y } = pointerRef.current;
    st.over = columnUnder(x, y).status;
    setDropStatus(st.over);
    setDragPreview({
      id: st.id,
      x,
      y,
      offsetX: st.offsetX,
      offsetY: st.offsetY,
      width: st.width,
    });
    document.body.classList.add("dragging-card");
    startAutoScroll();
  }, [startAutoScroll]);

  const endDrag = useCallback(
    (commit: boolean) => {
      const st = dragRef.current;
      dragRef.current = null;
      if (st?.timer != null) clearTimeout(st.timer);
      stopAutoScroll();
      document.body.classList.remove("dragging-card");
      setDragPreview(null);
      setDropStatus(null);
      if (commit && st?.active && st.over) void moveItem(st.id, st.over);
    },
    [moveItem, stopAutoScroll]
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pointerId) return;
      pointerRef.current = { x: e.clientX, y: e.clientY };

      if (!st.active) {
        const dist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
        if (st.isTouch) {
          // Moving before the hold completes means the user is scrolling.
          if (dist > TOUCH_SLOP) endDrag(false);
        } else if (dist > MOUSE_SLOP) {
          activateDrag();
        }
        return;
      }

      st.over = columnUnder(e.clientX, e.clientY).status;
      setDropStatus(st.over);
      setDragPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p));
    };

    const onPointerUp = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pointerId) return;
      const wasActive = st.active;
      const dist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
      endDrag(true);
      // A press that never armed and never travelled is a tap: open the item.
      if (!wasActive && dist <= TOUCH_SLOP) {
        const item = itemsRef.current.find((i) => i.id === st.id);
        if (item) openEdit(item);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (dragRef.current && e.pointerId === dragRef.current.pointerId) endDrag(false);
    };

    // Non-passive: an armed drag has to suppress iOS scrolling mid-gesture.
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current?.active) e.preventDefault();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [activateDrag, endDrag, openEdit]);

  // Release the drag if the component unmounts mid-gesture.
  useEffect(() => () => {
    stopAutoScroll();
    document.body.classList.remove("dragging-card");
  }, [stopAutoScroll]);

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>, item: ContentItem) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isTouch = e.pointerType !== "mouse";
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const st: PendingDrag = {
      id: item.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      isTouch,
      active: false,
      over: null,
      timer: null,
    };
    dragRef.current = st;
    if (isTouch) st.timer = window.setTimeout(activateDrag, LONG_PRESS_MS);
  };

  const handleExportCsv = () => {
    try {
      const csv = exportCsv(items);
      const fileName = `content_calendar_${new Date().toISOString().slice(0, 10)}.csv`;
      browserDownload(csv, fileName, "text/csv");
      show("CSV exported", "success");
    } catch (e: any) {
      setError(String(e));
      show("Export failed", "error");
    }
  };

  // Exports every item, not just the search matches: an .ics dropped into
  // Google or Apple Calendar is expected to be the whole calendar, and a
  // stray search term silently truncating it would be a nasty surprise.
  const handleExportIcs = () => {
    try {
      const ics = buildIcs(items, "Content Calendar");
      const fileName = `content_calendar_${new Date().toISOString().slice(0, 10)}.ics`;
      browserDownload(ics, fileName, "text/calendar;charset=utf-8");
      show("Calendar file downloaded", "success");
    } catch (e: any) {
      setError(String(e));
      show("Calendar export failed", "error");
    }
  };

  const handleImportCsv = async (csvText: string) => {
    try {
      const rows = parseCsv(csvText);
      // An import lands on the board that is open. The CSV has no team column
      // and never will: a spreadsheet is not the place to decide who can read
      // what.
      for (const row of rows) {
        await store.create(row, teamId);
      }
      refresh();
      show(`Imported ${rows.length} items`, "success");
      setShowImport(false);
    } catch (e: any) {
      setError(String(e));
      show("Import failed", "error");
    }
  };

  const handleFilePick = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const text = await file.text();
        await handleImportCsv(text);
      };
      input.click();
    } catch (e: any) {
      setError(String(e));
      show("Import failed", "error");
    }
  };

  const filtered = items.filter((i) => {
    const q = search.toLowerCase();
    return (
      i.headline.toLowerCase().includes(q) ||
      (i.description?.toLowerCase().includes(q) ?? false) ||
      (i.writer?.toLowerCase().includes(q) ?? false) ||
      (i.format?.toLowerCase().includes(q) ?? false) ||
      (i.platform?.toLowerCase().includes(q) ?? false)
    );
  });

  const byStatus = (status: string) =>
    filtered.filter((i) => i.contentStatus === status);

  const formatDateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });

  // Date view: group by due date. Only dates with records appear. Records
  // without a due date collapse into a single trailing "No due date" group.
  const dateGroups = (() => {
    const map = new Map<string, ContentItem[]>();
    const undated: ContentItem[] = [];
    for (const item of filtered) {
      const key = item.dueDate ? item.dueDate.slice(0, 10) : null;
      if (key === null) {
        undated.push(item);
      } else {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
      }
    }
    const groups = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, records]) => ({ label: formatDateLabel(date), records }));
    if (undated.length) groups.push({ label: "No due date", records: undated });
    return groups;
  })();

  const icsEventCount = countIcsEvents(items);

  // Status view: group by status in workflow order. Only statuses with
  // records appear.
  const statusGroups = STATUSES.map((status) => ({
    label: status,
    records: byStatus(status),
    dot: (STATUS_COLORS[status] || STATUS_COLORS.Brainstormed).dot,
  })).filter((g) => g.records.length > 0);

  const draggedItem = dragPreview
    ? items.find((i) => i.id === dragPreview.id) ?? null
    : null;

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

  const labelClass =
    "mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]";

  /* ─────────────── Loading ─────────────── */
  if (loading) {
    return (
      <div className="app-shell flex flex-col overflow-hidden bg-[var(--background)]">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-6 py-4">
          <div className="skeleton h-6 w-40"></div>
          <div className="skeleton h-9 w-24 rounded-lg"></div>
        </header>
        <main className="kanban-scroll min-h-0 flex-1 overflow-x-auto p-6">
          <div className="flex min-w-max gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <ColumnSkeleton key={i} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  /* ─────────────── Error ─────────────── */
  if (error) {
    return (
      <div className="app-shell flex flex-col items-center justify-center overflow-hidden bg-[var(--background)] px-6">
        <div className="mb-4 text-5xl">💥</div>
        <h1 className="mb-2 text-lg font-semibold text-[var(--foreground)]">Something went wrong</h1>
        <p className="mb-6 max-w-md text-center text-sm text-[var(--muted)]">{error}</p>
        <button
          onClick={() => { setError(null); refresh(); }}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
        >
          Retry
        </button>
      </div>
    );
  }

  /* ─────────────── No team ─────────────── */
  // Content lives on team boards, so an account on no team has nothing to show.
  // This is a normal state during onboarding, not an error — hence a route out
  // (settings, where an admin can fix it themselves) rather than a dead end.
  if (!testMode && teams && teams.length === 0) {
    return (
      <div className="app-shell flex flex-col items-center justify-center overflow-hidden bg-[var(--background)] px-6">
        <div className="mb-4 text-5xl">🗂️</div>
        <h1 className="mb-2 text-lg font-semibold text-[var(--foreground)]">
          No team board yet
        </h1>
        <p className="mb-6 max-w-md text-center text-sm text-[var(--muted)]">
          {user?.role === "admin"
            ? "Create a team in Settings and add yourself to it. Each team gets its own board, visible only to its members."
            : "You are not a member of any team. An administrator can add you to one — each team has its own board, and you will see it here."}
        </p>
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
          >
            {user?.role === "admin" ? "Set up teams" : "Settings"}
          </Link>
          <button
            onClick={() => signOut()}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  /* ─────────────── Main UI ─────────────── */
  return (
    <div className={`app-shell flex flex-col overflow-hidden bg-[var(--background)] ${
        testMode ? "pb-11" : ""
      }`}>
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-md p-1 text-[var(--foreground)] md:hidden"
            aria-label="Menu"
          >
            ☰
          </button>
          <h1 className="text-base font-semibold tracking-tight text-[var(--foreground)] md:text-lg">
            Content Calendar
          </h1>
          {/* One board per team. A dropdown only when there is a choice to
              make — a select with a single option is a control that does
              nothing, so a member of one team just sees its name. */}
          {teams && teams.length > 1 && (
            <select
              value={teamId ?? ""}
              onChange={(e) => switchTeam(e.target.value)}
              aria-label="Team board"
              title="Switch team board"
              className="max-w-[9rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] md:max-w-none"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          )}
          {teams && teams.length === 1 && (
            <span className="hidden rounded-full bg-[var(--surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--foreground)] sm:inline-block">
              {teams[0].name}
            </span>
          )}
          <span className="hidden rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-medium text-[var(--muted)] md:inline-block">
            {items.length}
          </span>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden md:block">
            <input
              type="text"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} w-48 lg:w-64`}
            />
          </div>
          <button
            onClick={handleExportCsv}
            className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)] md:px-3"
            title="Export CSV"
          >
            <span className="hidden md:inline">Export CSV</span>
            <span className="md:hidden">📤</span>
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)] md:px-3"
            title="Import CSV"
          >
            <span className="hidden md:inline">Import CSV</span>
            <span className="md:hidden">📥</span>
          </button>
          {aiReady && (
            <button
              onClick={() => setShowBrainstorm(true)}
              className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)] md:px-3"
              title="Brainstorm a campaign"
            >
              <span className="hidden md:inline">✦ Brainstorm</span>
              <span className="md:hidden">✦</span>
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] active:opacity-90 md:px-4"
          >
            <span className="hidden md:inline">+ Add Item</span>
            <span className="md:hidden">+</span>
          </button>
          <Link
            href={testMode ? "/test/settings" : "/settings"}
            className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)] md:px-3"
            title="Settings"
          >
            <span aria-hidden>⚙</span>
            <span className="sr-only">Settings</span>
          </Link>
          {testMode && (
            <div className="flex items-center gap-2 border-l border-[var(--border)] pl-2 md:pl-3">
              <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 lg:inline dark:bg-[#2e2618] dark:text-amber-200">
                Test mode
              </span>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Leave test mode? Everything on this board is discarded. Export to CSV first if you want to keep it."
                    )
                  ) {
                    clearTestSession();
                    leaveTo("/login");
                  }
                }}
                className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)] md:px-3"
                title="Leave test mode"
              >
                <span className="hidden md:inline">Exit test mode</span>
                <span className="md:hidden" aria-hidden>
                  ⏻
                </span>
                <span className="sr-only md:hidden">Exit test mode</span>
              </button>
            </div>
          )}
          {!testMode && user && (
            <div className="flex items-center gap-2 border-l border-[var(--border)] pl-2 md:pl-3">
              <span
                className="hidden text-sm text-[var(--muted)] lg:inline"
                title={`Signed in as ${user.username}`}
              >
                {user.displayName || user.username}
              </span>
              <button
                onClick={() => signOut()}
                className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)] md:px-3"
                title="Sign out"
              >
                <span className="hidden md:inline">Sign out</span>
                <span className="md:hidden" aria-hidden>
                  ⏻
                </span>
                <span className="sr-only md:hidden">Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── View selector ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2 md:px-6">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                view === v.value
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Mobile search bar ── */}
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2 md:hidden">
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
      </div>

      {/* ── Kanban Board ── */}
      {view === "kanban" && (
      <main
        ref={boardRef}
        className="kanban-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain p-4 md:p-6"
      >
        <div className="flex h-full min-w-max gap-4">
          {STATUSES.map((status) => {
            const columnItems = byStatus(status);
            const colors = STATUS_COLORS[status] || STATUS_COLORS.Brainstormed;
            const isDropTarget = dropStatus === status;
            return (
              <div
                key={status}
                data-drop-status={status}
                className={`flex h-full min-h-0 w-72 shrink-0 flex-col rounded-xl border p-3 transition-colors ${colors.border} ${colors.bg} ${
                  isDropTarget ? "ring-2 ring-[var(--accent)]" : ""
                }`}
              >
                {/* Column header */}
                <div className="mb-3 flex shrink-0 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${colors.dot}`}></span>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {status}
                    </h2>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-[var(--muted)] shadow-sm dark:bg-[#333]">
                    {columnItems.length}
                  </span>
                </div>

                {/* Cards — scroll inside the column so tall columns never push
                    the board past the bottom of the viewport. Contain only the
                    vertical axis: a vertical flick must not chain out to the
                    page, but a horizontal swipe still needs to pan the board. */}
                <div
                  data-card-list
                  className="kanban-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain"
                >
                  {columnItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-white/60 py-8 text-center dark:bg-black/20">
                      <span className="mb-1 text-2xl">📝</span>
                      <p className="text-xs text-[var(--muted)]">No items</p>
                    </div>
                  ) : (
                    columnItems.map((item) => {
                      const aiAction = AI_ACTIONS[item.contentStatus];
                      return (
                        // The AI button is a sibling of the card, not a child:
                        // the card is itself role="button", and nesting a button
                        // inside one is invalid and would fold "Generate
                        // outline" into the card's accessible name.
                        <div key={item.id} className="shrink-0">
                          <div
                            role="button"
                            tabIndex={0}
                            onPointerDown={(e) => handleCardPointerDown(e, item)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openEdit(item);
                              }
                            }}
                            className={`kanban-card group cursor-grab rounded-lg border border-[var(--border)] bg-white p-3 shadow-sm transition hover:border-[var(--accent)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:cursor-grabbing dark:border-[var(--border)] dark:bg-[#252525] ${
                              dragPreview?.id === item.id ? "opacity-40" : ""
                            }`}
                          >
                            <CardBody item={item} />
                          </div>
                          {aiReady && aiAction && (
                            <button
                              onClick={() => void runGeneration(item, aiAction.task)}
                              className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-white/60 px-2 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] dark:bg-black/20"
                            >
                              ✦ {aiAction.label}
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
      )}

      {/* ── Date View ── */}
      {view === "date" && (
        <main className="kanban-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
          {/* Wider than the other list view: the month grid divides into seven
              columns, and at max-w-3xl every headline truncates to nothing. */}
          <div className="mx-auto max-w-5xl">
            <MonthCalendar
              items={filtered}
              onOpen={openEdit}
              statusDot={(status) =>
                (STATUS_COLORS[status] || STATUS_COLORS.Brainstormed).dot
              }
              action={
                <button
                  onClick={handleExportIcs}
                  title={`Download all ${icsEventCount} calendar events as an .ics file`}
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)]"
                >
                  ⤓ Download .ics
                </button>
              }
            />
            {dateGroups.length === 0 ? (
              <EmptyState />
            ) : (
              dateGroups.map((group) => (
                <ListGroup
                  key={group.label}
                  heading={group.label}
                  records={group.records}
                  onOpen={openEdit}
                />
              ))
            )}
          </div>
        </main>
      )}

      {/* ── Status View ── */}
      {view === "status" && (
        <main className="kanban-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
          <div className="mx-auto max-w-3xl">
            {statusGroups.length === 0 ? (
              <EmptyState />
            ) : (
              statusGroups.map((group) => (
                <ListGroup
                  key={group.label}
                  heading={group.label}
                  dot={group.dot}
                  records={group.records}
                  onOpen={openEdit}
                />
              ))
            )}
          </div>
        </main>
      )}

      {/* ── AI generation panel ── */}
      {aiPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="modal-panel flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  {aiPanel.task === "outline" ? "AI outline" : "AI draft"}
                </h2>
                <p className="truncate text-sm text-[var(--muted)]">
                  {aiPanel.item.headline}
                </p>
              </div>
              <button
                onClick={closeAiPanel}
                className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="kanban-scroll min-h-[8rem] flex-1 overflow-y-auto overscroll-contain px-6 py-4">
              {aiPanel.text ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[var(--foreground)]">
                  {aiPanel.text}
                  {aiPanel.status === "streaming" && (
                    <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[var(--accent)] align-text-bottom" />
                  )}
                </pre>
              ) : (
                <p className="py-8 text-center text-sm text-[var(--muted)]">
                  {aiPanel.status === "streaming"
                    ? "Thinking…"
                    : "Nothing was generated."}
                </p>
              )}

              {aiPanel.error && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300"
                >
                  {aiPanel.error}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
              {aiPanel.status === "streaming" ? (
                <button
                  onClick={stopGeneration}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
                >
                  Stop
                </button>
              ) : (
                <>
                  <button
                    onClick={closeAiPanel}
                    disabled={aiPanel.saving}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    Discard
                  </button>
                  {aiPanel.status === "error" && (
                    <button
                      onClick={() => void runGeneration(aiPanel.item, aiPanel.task)}
                      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
                    >
                      Try again
                    </button>
                  )}
                  <button
                    onClick={saveGeneration}
                    disabled={aiPanel.saving || !aiPanel.text.trim()}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {aiPanel.saving ? "Saving…" : "Save to notes"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Brainstorm campaign ── */}
      {showBrainstorm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="modal-panel w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {proposals ? "Choose ideas to add" : "Brainstorm a campaign"}
              </h2>
              <button
                onClick={closeBrainstorm}
                className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {proposals ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted)]">
                  {chosen.size} of {proposals.length} selected. Nothing is added to
                  the board until you confirm.
                </p>
                <ul className="space-y-2">
                  {proposals.map((p, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer gap-3 rounded-lg border border-[var(--border)] p-3 transition hover:bg-[var(--surface)]">
                        <input
                          type="checkbox"
                          checked={chosen.has(i)}
                          onChange={() =>
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i);
                              else next.add(i);
                              return next;
                            })
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--foreground)]">
                            {p.headline}
                          </span>
                          {p.description && (
                            <span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">
                              {p.description}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>

                {brainstormError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300"
                  >
                    {brainstormError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setProposals(null)}
                    disabled={creatingItems}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={createChosenItems}
                    disabled={creatingItems || chosen.size === 0}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {creatingItems
                      ? "Creating…"
                      : `Create ${chosen.size} item${chosen.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={runBrainstorm} className="space-y-4">
                <div>
                  <label className={labelClass}>Campaign name *</label>
                  <input
                    required
                    className={inputClass}
                    placeholder="Q3 developer awareness"
                    value={campaign.campaignName}
                    onChange={(e) =>
                      setCampaign((c) => ({ ...c, campaignName: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Campaign goal *</label>
                  <textarea
                    required
                    rows={2}
                    className={inputClass}
                    placeholder="Get developers to download the migration guide"
                    value={campaign.campaignGoal}
                    onChange={(e) =>
                      setCampaign((c) => ({ ...c, campaignGoal: e.target.value }))
                    }
                  />
                </div>
                <ContextFileField
                  label="Context File Upload"
                  help="Upload a markdown file with descriptions of your Brand Voice, Product or Service Details, and Ideal Client Avatar. It is saved with every idea you keep, and reused when you generate an outline or a draft."
                  value={campaign}
                  onChange={(next) => setCampaign((c) => ({ ...c, ...next }))}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>How many ideas</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      className={inputClass}
                      value={campaign.count}
                      onChange={(e) =>
                        setCampaign((c) => ({ ...c, count: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Format</label>
                    <input
                      className={inputClass}
                      placeholder="Blog post"
                      value={campaign.format}
                      onChange={(e) =>
                        setCampaign((c) => ({ ...c, format: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Platform</label>
                    <input
                      className={inputClass}
                      placeholder="Company blog"
                      value={campaign.platform}
                      onChange={(e) =>
                        setCampaign((c) => ({ ...c, platform: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Writer</label>
                    <input
                      className={inputClass}
                      placeholder="Assigned writer"
                      value={campaign.writer}
                      onChange={(e) =>
                        setCampaign((c) => ({ ...c, writer: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {brainstormError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-[#2e1a1a] dark:text-red-300"
                  >
                    {brainstormError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeBrainstorm}
                    disabled={brainstormBusy}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={brainstormBusy}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {brainstormBusy ? "Generating…" : "Generate ideas"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Drag preview (follows the finger/cursor) ── */}
      {draggedItem && dragPreview && (
        <div
          className="pointer-events-none fixed z-[200] rounded-lg border border-[var(--accent)] bg-white p-3 shadow-2xl dark:bg-[#252525]"
          style={{
            width: dragPreview.width,
            left: dragPreview.x - dragPreview.offsetX,
            top: dragPreview.y - dragPreview.offsetY,
            transform: "rotate(1.5deg) scale(1.03)",
          }}
        >
          <CardBody item={draggedItem} />
        </div>
      )}

      {/* ── Test-mode warning ── */}
      {testMode && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] border-t border-amber-300 bg-amber-50/95 px-4 py-2.5 text-center text-xs text-amber-900 backdrop-blur-sm dark:border-amber-800 dark:bg-[#2e2618]/95 dark:text-amber-200"
          style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
        >
          <span className="font-semibold">Test mode — nothing is saved.</span> No
          database is read or written. Everything you create here is discarded when
          you close this tab; use <span className="font-semibold">Export CSV</span> to
          keep it.
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex max-w-xs flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg toast-enter ${
              t.type === "success"
                ? "border-green-200 bg-white text-green-700 dark:bg-[#1a2e1a] dark:text-green-300 dark:border-green-800"
                : t.type === "error"
                ? "border-red-200 bg-white text-red-700 dark:bg-[#2e1a1a] dark:text-red-300 dark:border-red-800"
                : "border-[var(--border)] bg-white text-[var(--foreground)] dark:bg-[#252525] dark:border-[var(--border)]"
            }`}
            onClick={() => dismiss(t.id)}
          >
            <span>
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ️"}
            </span>
            {t.message}
          </div>
        ))}
      </div>

      {/* ── Add Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="modal-panel w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-[var(--background)] p-6 shadow-2xl border border-[var(--border)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Add Content Item</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className={labelClass}>Headline *</label>
                <input
                  required
                  placeholder="Enter headline…"
                  className={inputClass}
                  value={addForm.headline}
                  onChange={(e) => setAddForm((f) => ({ ...f, headline: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  placeholder="Brief description…"
                  className={inputClass}
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Format</label>
                  <input
                    placeholder="Blog post, video, etc."
                    className={inputClass}
                    value={addForm.format}
                    onChange={(e) => setAddForm((f) => ({ ...f, format: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Platform</label>
                  <input
                    placeholder="Website, LinkedIn, etc."
                    className={inputClass}
                    value={addForm.platform}
                    onChange={(e) => setAddForm((f) => ({ ...f, platform: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Writer</label>
                  <input
                    placeholder="Assigned writer"
                    className={inputClass}
                    value={addForm.writer}
                    onChange={(e) => setAddForm((f) => ({ ...f, writer: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    className={inputClass}
                    value={addForm.contentStatus}
                    onChange={(e) => setAddForm((f) => ({ ...f, contentStatus: e.target.value }))}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Due Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={addForm.dueDate}
                    onChange={(e) => setAddForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Publish Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={addForm.publishDate}
                    onChange={(e) => setAddForm((f) => ({ ...f, publishDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Word Count</label>
                  <input
                    type="number"
                    placeholder="0"
                    className={inputClass}
                    value={addForm.wordCount}
                    onChange={(e) => setAddForm((f) => ({ ...f, wordCount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>Keywords</label>
                  <input
                    placeholder="SEO keywords"
                    className={inputClass}
                    value={addForm.keywords}
                    onChange={(e) => setAddForm((f) => ({ ...f, keywords: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Target Reader</label>
                  <input
                    placeholder="Audience segment"
                    className={inputClass}
                    value={addForm.targetReader}
                    onChange={(e) => setAddForm((f) => ({ ...f, targetReader: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelClass}>SMEs</label>
                  <input
                    placeholder="Subject matter experts"
                    className={inputClass}
                    value={addForm.smes}
                    onChange={(e) => setAddForm((f) => ({ ...f, smes: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Internal Links</label>
                <input
                  placeholder="Related internal content"
                  className={inputClass}
                  value={addForm.internalLinks}
                  onChange={(e) => setAddForm((f) => ({ ...f, internalLinks: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>External Links</label>
                <input
                  placeholder="External references"
                  className={inputClass}
                  value={addForm.externalLinks}
                  onChange={(e) => setAddForm((f) => ({ ...f, externalLinks: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Promotion Plan</label>
                <textarea
                  rows={2}
                  placeholder="How will you promote this?"
                  className={inputClass}
                  value={addForm.promotionPlan}
                  onChange={(e) => setAddForm((f) => ({ ...f, promotionPlan: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={2}
                  placeholder="Any additional notes…"
                  className={inputClass}
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>GDrive Link</label>
                <input
                  placeholder="https://drive.google.com/…"
                  className={inputClass}
                  value={addForm.gdriveLink}
                  onChange={(e) => setAddForm((f) => ({ ...f, gdriveLink: e.target.value }))}
                />
              </div>
              <ContextFileField
                label="Context File"
                help="Optional markdown file — Brand Voice, Product or Service Details, Ideal Client Avatar. The AI outline and draft for this item will follow it."
                value={addForm}
                onChange={(next) => setAddForm((f) => ({ ...f, ...next }))}
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {addSaving ? "Saving…" : "Add Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="modal-panel w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-[var(--background)] p-6 shadow-2xl border border-[var(--border)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Edit Content Item</h2>
              <button
                onClick={() => setEditingItem(null)}
                className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-4">
              <div>
                <label className={labelClass}>Headline *</label>
                <input
                  required
                  className={inputClass}
                  value={editForm.headline}
                  onChange={(e) => setEditForm((f) => ({ ...f, headline: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  className={inputClass}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Format</label>
                  <input className={inputClass} value={editForm.format} onChange={(e) => setEditForm((f) => ({ ...f, format: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Platform</label>
                  <input className={inputClass} value={editForm.platform} onChange={(e) => setEditForm((f) => ({ ...f, platform: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Writer</label>
                  <input className={inputClass} value={editForm.writer} onChange={(e) => setEditForm((f) => ({ ...f, writer: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    className={inputClass}
                    value={editForm.contentStatus}
                    onChange={(e) => setEditForm((f) => ({ ...f, contentStatus: e.target.value }))}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Due Date</label>
                  <input type="date" className={inputClass} value={editForm.dueDate} onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Publish Date</label>
                  <input type="date" className={inputClass} value={editForm.publishDate} onChange={(e) => setEditForm((f) => ({ ...f, publishDate: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Word Count</label>
                  <input type="number" className={inputClass} value={editForm.wordCount} onChange={(e) => setEditForm((f) => ({ ...f, wordCount: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Keywords</label>
                  <input className={inputClass} value={editForm.keywords} onChange={(e) => setEditForm((f) => ({ ...f, keywords: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Target Reader</label>
                  <input className={inputClass} value={editForm.targetReader} onChange={(e) => setEditForm((f) => ({ ...f, targetReader: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>SMEs</label>
                  <input className={inputClass} value={editForm.smes} onChange={(e) => setEditForm((f) => ({ ...f, smes: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Internal Links</label>
                <input className={inputClass} value={editForm.internalLinks} onChange={(e) => setEditForm((f) => ({ ...f, internalLinks: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>External Links</label>
                <input className={inputClass} value={editForm.externalLinks} onChange={(e) => setEditForm((f) => ({ ...f, externalLinks: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Promotion Plan</label>
                <textarea rows={2} className={inputClass} value={editForm.promotionPlan} onChange={(e) => setEditForm((f) => ({ ...f, promotionPlan: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea rows={2} className={inputClass} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>GDrive Link</label>
                <input className={inputClass} value={editForm.gdriveLink} onChange={(e) => setEditForm((f) => ({ ...f, gdriveLink: e.target.value }))} />
              </div>
              <ContextFileField
                label="Context File"
                help="Markdown file — Brand Voice, Product or Service Details, Ideal Client Avatar. The AI outline and draft for this item will follow it."
                value={editForm}
                onChange={(next) => setEditForm((f) => ({ ...f, ...next }))}
              />
              <div className="flex flex-col-reverse justify-between gap-3 pt-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg border border-[var(--danger)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-hover)] hover:text-white"
                >
                  Delete
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {editSaving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import Modal ── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--background)] p-6 shadow-2xl border border-[var(--border)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Import Data</h2>
              <button
                onClick={() => setShowImport(false)}
                className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Select a <strong>.csv</strong> file to import. Each row will be added as a new content item.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button
                onClick={() => setShowImport(false)}
                className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] sm:flex-none"
              >
                Cancel
              </button>
              <button
                onClick={handleFilePick}
                className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
              >
                Choose File…
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
