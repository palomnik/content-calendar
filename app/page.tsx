"use client";

import { useEffect, useState } from "react";
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

const STATUS_COLORS: Record<string, string> = {
  Brainstormed: "bg-zinc-100 border-zinc-200",
  Outlined: "bg-yellow-50 border-yellow-200",
  Draft: "bg-blue-50 border-blue-200",
  "In Review": "bg-purple-50 border-purple-200",
  Scheduled: "bg-orange-50 border-orange-200",
  Published: "bg-green-50 border-green-200",
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

export default function Home() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  const [showImport, setShowImport] = useState(false);

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
    } catch (e: any) {
      setError(String(e));
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
    } catch (e: any) {
      setError(String(e));
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
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDragEnd = () => setDraggingId(null);

  const handleDrop = async (status: string) => {
    if (!draggingId) return;
    try {
      const updated = await updateItem(draggingId, { contentStatus: status });
      if (updated) {
        setItems((prev) =>
          prev.map((i) => (i.id === draggingId ? updated : i))
        );
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setDraggingId(null);
    }
  };

  const handleExportCsv = () => {
    try {
      const csv = exportCsv(items);
      const fileName = `content_calendar_${new Date().toISOString().slice(0, 10)}.csv`;
      browserDownload(csv, fileName, "text/csv");
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleImportCsv = async (csvText: string) => {
    try {
      const rows = parseCsv(csvText);
      for (const row of rows) {
        await createItem(row);
      }
      refresh();
      alert(`Imported ${rows.length} items`);
      setShowImport(false);
    } catch (e: any) {
      setError(String(e));
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
    }
  };

  const byStatus = (status: string) =>
    items.filter((i) => i.contentStatus === status);

  const inputClass =
    "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

  const labelClass =
    "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center text-zinc-500">
        Loading…
      </div>
    );

  if (error)
    return (
      <div className="flex h-screen items-center justify-center text-red-600">
        Error: {error}
      </div>
    );

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Content Calendar
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-zinc-500">{items.length} items</div>
          <button
            onClick={handleExportCsv}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Import CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            + Add Item
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto p-6">
        <div className="flex min-w-max gap-4">
          {STATUSES.map((status) => {
            const columnItems = byStatus(status);
            return (
              <div
                key={status}
                className={`flex w-72 flex-col rounded-xl border p-3 ${STATUS_COLORS[status] || "bg-white border-zinc-200"}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(status)}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    {status}
                  </h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-zinc-500 shadow-sm">
                    {columnItems.length}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {columnItems.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(item.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => openEdit(item)}
                      className="cursor-grab rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <h3 className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {item.headline}
                      </h3>
                      {item.description && (
                        <p className="mb-2 text-xs text-zinc-500 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {item.format && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            {item.format}
                          </span>
                        )}
                        {item.platform && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            {item.platform}
                          </span>
                        )}
                        {item.writer && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            ✍ {item.writer}
                          </span>
                        )}
                      </div>
                      {(item.dueDate || item.publishDate) && (
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
                          {item.dueDate && (
                            <span>
                              Due: {new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                            </span>
                          )}
                          {item.publishDate && (
                            <span>
                              Pub:{" "}
                              {new Date(item.publishDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Add Content Item
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className={labelClass}>Headline *</label>
                <input
                  required
                  className={inputClass}
                  value={addForm.headline}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, headline: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  rows={2}
                  className={inputClass}
                  value={addForm.description}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Format</label>
                  <input
                    className={inputClass}
                    value={addForm.format}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, format: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Platform</label>
                  <input
                    className={inputClass}
                    value={addForm.platform}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, platform: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Writer</label>
                  <input
                    className={inputClass}
                    value={addForm.writer}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, writer: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    className={inputClass}
                    value={addForm.contentStatus}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        contentStatus: e.target.value,
                      }))
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Due Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={addForm.dueDate}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, dueDate: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Publish Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={addForm.publishDate}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        publishDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Word Count</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={addForm.wordCount}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        wordCount: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Keywords</label>
                  <input
                    className={inputClass}
                    value={addForm.keywords}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, keywords: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Target Reader</label>
                  <input
                    className={inputClass}
                    value={addForm.targetReader}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        targetReader: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>SMEs</label>
                  <input
                    className={inputClass}
                    value={addForm.smes}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, smes: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Internal Links</label>
                <input
                  className={inputClass}
                  value={addForm.internalLinks}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      internalLinks: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>External Links</label>
                <input
                  className={inputClass}
                  value={addForm.externalLinks}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      externalLinks: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Promotion Plan</label>
                <textarea
                  rows={2}
                  className={inputClass}
                  value={addForm.promotionPlan}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      promotionPlan: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={2}
                  className={inputClass}
                  value={addForm.notes}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>GDrive Link</label>
                <input
                  className={inputClass}
                  value={addForm.gdriveLink}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      gdriveLink: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {addSaving ? "Saving…" : "Add Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit / View Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Edit Content Item
              </h2>
              <button
                onClick={() => setEditingItem(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-3">
              <div>
                <label className={labelClass}>Headline *</label>
                <input
                  required
                  className={inputClass}
                  value={editForm.headline}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, headline: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  className={inputClass}
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Format</label>
                  <input
                    className={inputClass}
                    value={editForm.format}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, format: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Platform</label>
                  <input
                    className={inputClass}
                    value={editForm.platform}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        platform: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Writer</label>
                  <input
                    className={inputClass}
                    value={editForm.writer}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, writer: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    className={inputClass}
                    value={editForm.contentStatus}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        contentStatus: e.target.value,
                      }))
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Due Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={editForm.dueDate}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        dueDate: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Publish Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={editForm.publishDate}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        publishDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Word Count</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={editForm.wordCount}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        wordCount: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Keywords</label>
                  <input
                    className={inputClass}
                    value={editForm.keywords}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        keywords: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Target Reader</label>
                  <input
                    className={inputClass}
                    value={editForm.targetReader}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        targetReader: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>SMEs</label>
                  <input
                    className={inputClass}
                    value={editForm.smes}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, smes: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Internal Links</label>
                <input
                  className={inputClass}
                  value={editForm.internalLinks}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      internalLinks: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>External Links</label>
                <input
                  className={inputClass}
                  value={editForm.externalLinks}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      externalLinks: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Promotion Plan</label>
                <textarea
                  rows={3}
                  className={inputClass}
                  value={editForm.promotionPlan}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      promotionPlan: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={3}
                  className={inputClass}
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>GDrive Link</label>
                <input
                  className={inputClass}
                  value={editForm.gdriveLink}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      gdriveLink: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Delete
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {editSaving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Import Data
              </h2>
              <button
                onClick={() => setShowImport(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Select a <strong>.csv</strong> file to import. Each row will be added as a new content item.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleFilePick}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Choose File…
              </button>
              <button
                onClick={() => setShowImport(false)}
                className="rounded-lg border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
