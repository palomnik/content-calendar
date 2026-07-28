"use client";

import { useMemo, useState } from "react";

/* ─────────────── Month calendar ───────────────

   A compact month grid that sits above the date list. Every record with a due
   date or a publish date shows up on the matching day; a record with both
   appears twice, tagged, because the two deadlines are separate commitments.

   Dates are stored as plain YYYY-MM-DD strings, so every calculation here runs
   in UTC. Doing the arithmetic in local time would shift a record onto the
   previous day for anyone west of Greenwich. */

export interface CalendarRecord {
  id: string;
  headline: string;
  contentStatus: string;
  dueDate: string | null;
  publishDate: string | null;
}

type Entry<T> = { item: T; kind: "due" | "publish" };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local calendar day as YYYY-MM-DD — only used to mark "today". */
function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function MonthCalendar<T extends CalendarRecord>({
  items,
  onOpen,
  statusDot,
  action,
}: {
  items: T[];
  onOpen: (item: T) => void;
  /** Tailwind background class for a status's colour swatch. */
  statusDot: (status: string) => string;
  /** Rendered at the right of the toolbar — the .ics download lives here. */
  action?: React.ReactNode;
}) {
  // Captured once so "today" cannot drift mid-session, and so the first render
  // matches whatever the server produced.
  const [today] = useState(() => localDayKey(new Date()));
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [selected, setSelected] = useState<string | null>(null);

  // day (YYYY-MM-DD) → the entries falling on it.
  const byDay = useMemo(() => {
    const map = new Map<string, Entry<T>[]>();
    const add = (day: string, entry: Entry<T>) => {
      const list = map.get(day);
      if (list) list.push(entry);
      else map.set(day, [entry]);
    };
    for (const item of items) {
      const due = item.dueDate?.slice(0, 10);
      if (due) add(due, { item, kind: "due" });
      const publish = item.publishDate?.slice(0, 10);
      if (publish) add(publish, { item, kind: "publish" });
    }
    return map;
  }, [items]);

  const { cells, monthLabel, monthCount } = useMemo(() => {
    const { year, month } = cursor;
    const leading = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const total = Math.ceil((leading + daysInMonth) / 7) * 7;

    const built = Array.from({ length: total }, (_, i) => {
      const date = new Date(Date.UTC(year, month, 1 - leading + i));
      const key = utcDayKey(date);
      return {
        key,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month,
        entries: byDay.get(key) ?? [],
      };
    });

    return {
      cells: built,
      monthLabel: new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      monthCount: built.reduce((n, c) => (c.inMonth ? n + c.entries.length : n), 0),
    };
  }, [cursor, byDay]);

  const shift = (delta: number) =>
    setCursor(({ year, month }) => {
      const next = new Date(Date.UTC(year, month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });

  const goToday = () =>
    setCursor({
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7)) - 1,
    });

  const selectedEntries = selected ? byDay.get(selected) ?? [] : [];

  const navButton =
    "rounded-md border border-[var(--border)] px-2 py-1 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)] active:bg-[var(--surface-hover)]";

  return (
    <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--background)]">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className={navButton} aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => shift(1)} className={navButton} aria-label="Next month">
            ›
          </button>
          <button onClick={goToday} className={`${navButton} ml-1`}>
            Today
          </button>
        </div>
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{monthLabel}</h2>
        <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
          {monthCount} {monthCount === 1 ? "entry" : "entries"}
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>

      {/* ── Weekday header ── */}
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      {/* ── Day grid ──
          Cells are plain containers, not buttons: they hold the per-record
          buttons, and a button inside a button is invalid markup that would
          fold every headline into the day's accessible name. The day number is
          its own button instead, and doubles as the whole tap target on narrow
          screens where the chips are replaced by dots. */}
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const isToday = cell.key === today;
          const isSelected = cell.key === selected;
          return (
            <div
              key={cell.key}
              className={`min-h-[64px] border-b border-r border-[var(--border)] p-1 last:border-r-0 sm:min-h-[92px] [&:nth-child(7n)]:border-r-0 ${
                cell.inMonth ? "" : "bg-[var(--surface)]/60"
              } ${isSelected ? "ring-1 ring-inset ring-[var(--accent)]" : ""}`}
            >
              <button
                onClick={() => setSelected((prev) => (prev === cell.key ? null : cell.key))}
                className="block w-full rounded text-left transition hover:bg-[var(--surface)]"
                aria-label={`${cell.entries.length} entries on ${cell.key}`}
              >
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-medium ${
                    isToday
                      ? "bg-[var(--accent)] text-white"
                      : cell.inMonth
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                  }`}
                >
                  {cell.day}
                </span>

                {/* Compact density: below sm the cells are too narrow for
                    headlines, so the day shows coloured dots instead. */}
                {cell.entries.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {cell.entries.slice(0, 4).map((entry, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${statusDot(entry.item.contentStatus)} ${
                          entry.kind === "publish" ? "opacity-50" : ""
                        }`}
                      />
                    ))}
                    {cell.entries.length > 4 && (
                      <span className="text-[9px] leading-none text-[var(--muted)]">
                        +{cell.entries.length - 4}
                      </span>
                    )}
                  </span>
                )}
              </button>

              <div className="mt-1 hidden flex-col gap-0.5 sm:flex">
                {cell.entries.slice(0, 3).map((entry, i) => (
                  <button
                    key={i}
                    onClick={() => onOpen(entry.item)}
                    title={`${entry.kind === "due" ? "Due" : "Publish"} — ${entry.item.headline} (${entry.item.contentStatus})`}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-[var(--surface)]"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(entry.item.contentStatus)} ${
                        entry.kind === "publish" ? "opacity-50" : ""
                      }`}
                    />
                    {entry.kind === "publish" && (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        pub
                      </span>
                    )}
                    <span className="truncate text-[11px] leading-tight text-[var(--foreground)]">
                      {entry.item.headline}
                    </span>
                  </button>
                ))}
                {cell.entries.length > 3 && (
                  <button
                    onClick={() => setSelected(cell.key)}
                    className="rounded px-1 text-left text-[10px] font-medium text-[var(--muted)] transition hover:text-[var(--accent)]"
                  >
                    +{cell.entries.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Selected day ── */}
      {selected && (
        <div className="border-t border-[var(--border)] px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              {new Date(`${selected}T00:00:00Z`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </h3>
            <button
              onClick={() => setSelected(null)}
              className="ml-auto text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
            >
              Close
            </button>
          </div>
          {selectedEntries.length === 0 ? (
            <p className="py-1 text-xs text-[var(--muted)]">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {selectedEntries.map((entry, i) => (
                <li key={i}>
                  <button
                    onClick={() => onOpen(entry.item)}
                    className="flex w-full items-center gap-2 py-1.5 text-left transition hover:bg-[var(--surface)]"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${statusDot(entry.item.contentStatus)} ${
                        entry.kind === "publish" ? "opacity-50" : ""
                      }`}
                    />
                    <span className="flex-1 truncate text-sm text-[var(--foreground)]">
                      {entry.item.headline}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {entry.kind === "due" ? "Due" : "Publish"}
                    </span>
                    <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">
                      {entry.item.contentStatus}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--muted)]">
        <span>Dot colour = status.</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" /> due date
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] opacity-50" /> publish date
          <span className="hidden sm:inline">(tagged “pub”)</span>
        </span>
      </div>
    </section>
  );
}
