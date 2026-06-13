"use client";

import { useEffect, useState, useCallback } from "react";
import {
  initDb,
  getAllItems,
  createItem,
  updateItem,
  deleteItem,
  exportCsv,
  parseCsv,
  browserDownload,
} from "./lib/sqlite";

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
  };
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

/* ─────────────── Main Page ─────────────── */

export default function Home() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const { toasts, show, dismiss } = useToast();

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    initDb()
      .then(() => getAllItems())
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((e) => {
        console.error("DB init failed:", e);
        setError("Database failed to load: " + String(e));
        setLoading(false);
      });
  }, []);

  const refresh = async () => {
    try {
      const data = await getAllItems();
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
      const newItem = await createItem({
        ...addForm,
        wordCount: addForm.wordCount ? parseInt(addForm.wordCount, 10) : null,
        dueDate: addForm.dueDate || null,
        publishDate: addForm.publishDate || null,
      });
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

  const openEdit = (item: ContentItem) => {
    setEditingItem(item);
    setEditForm(toFormValues(item));
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editForm.headline.trim()) return;
    setEditSaving(true);
    try {
      const updated = await updateItem(editingItem.id, {
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
      await deleteItem(editingItem.id);
      setItems((prev) => prev.filter((i) => i.id !== editingItem.id));
      setEditingItem(null);
      show("Item deleted", "info");
    } catch (e: any) {
      setError(String(e));
      show("Failed to delete item", "error");
    }
  };

  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDragEnd = () => setDraggingId(null);

  const handleDrop = async (status: string) => {
    if (!draggingId) return;
    try {
      const updated = await updateItem(draggingId, { contentStatus: status });
      if (updated) {
        setItems((prev) => prev.map((i) => (i.id === draggingId ? updated : i)));
      }
      show(`Moved to ${status}`, "info");
    } catch (e: any) {
      setError(String(e));
      show("Failed to move item", "error");
    } finally {
      setDraggingId(null);
    }
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

  const handleImportCsv = async (csvText: string) => {
    try {
      const rows = parseCsv(csvText);
      for (const row of rows) {
        await createItem(row);
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

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

  const labelClass =
    "mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]";

  /* ─────────────── Loading ─────────────── */
  if (loading) {
    return (
      <div className="flex h-screen flex-col bg-[var(--background)]">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-6 py-4">
          <div className="skeleton h-6 w-40"></div>
          <div className="skeleton h-9 w-24 rounded-lg"></div>
        </header>
        <main className="flex-1 overflow-x-auto p-6">
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
      <div className="flex h-screen flex-col items-center justify-center bg-[var(--background)] px-6">
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

  /* ─────────────── Main UI ─────────────── */
  return (
    <div className="flex h-screen flex-col bg-[var(--background)]">
      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4 py-3 md:px-6 md:py-4">
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
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] active:opacity-90 md:px-4"
          >
            <span className="hidden md:inline">+ Add Item</span>
            <span className="md:hidden">+</span>
          </button>
        </div>
      </header>

      {/* ── Mobile search bar ── */}
      <div className="border-b border-[var(--border)] px-4 py-2 md:hidden">
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
      </div>

      {/* ── Kanban Board ── */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6">
        <div className="flex min-w-max gap-4">
          {STATUSES.map((status) => {
            const columnItems = byStatus(status);
            const colors = STATUS_COLORS[status] || STATUS_COLORS.Brainstormed;
            return (
              <div
                key={status}
                className={`flex w-72 shrink-0 flex-col rounded-xl border ${colors.border} ${colors.bg} p-3 transition-colors`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(status)}
              >
                {/* Column header */}
                <div className="mb-3 flex items-center justify-between">
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

                {/* Cards */}
                <div className="flex flex-col gap-3">
                  {columnItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-white/60 py-8 text-center dark:bg-black/20">
                      <span className="mb-1 text-2xl">📝</span>
                      <p className="text-xs text-[var(--muted)]">No items</p>
                    </div>
                  ) : (
                    columnItems.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => handleDragStart(item.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openEdit(item)}
                        className="group cursor-grab rounded-lg border border-[var(--border)] bg-white p-3 shadow-sm transition hover:shadow-md hover:border-[var(--accent)] active:cursor-grabbing dark:border-[var(--border)] dark:bg-[#252525]"
                      >
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
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

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
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-[var(--background)] p-6 shadow-2xl border border-[var(--border)]">
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
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-[var(--background)] p-6 shadow-2xl border border-[var(--border)]">
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
