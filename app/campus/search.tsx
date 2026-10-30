"use client";

import { useMemo, useState } from "react";
import { PANEL } from "./ui";

/** Something to find: a building, or a room in one. */
export interface SearchItem {
  kind: "building" | "room";
  /** What's shown and matched first: "Clearihue Building", "A101", "Vertigo". */
  title: string;
  /** Shown under the title: "CLE A101 · Level 1", "CLE · Building 115". */
  detail: string;
  /** Everything else it should match on, lower case: codes, building names. */
  terms: string;
  building: string;
  room?: { name: string; level: string };
}

const MAX_RESULTS = 8;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Every word of the query must appear somewhere; exact and prefix matches on the title rank first,
// then buildings before rooms, then shorter titles.
function search(items: SearchItem[], query: string): SearchItem[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(" ");
  const squashed = q.replace(/ /g, "");
  const scored: [number, SearchItem][] = [];
  for (const item of items) {
    const title = norm(item.title);
    const all = `${title} ${item.terms}`;
    if (!words.every((w) => all.includes(w)) && !all.replace(/ /g, "").includes(squashed)) continue;
    const score =
      (title === q || item.terms.split(" ").includes(q) ? 0 : title.startsWith(q) ? 1 : all.includes(q) ? 2 : 3) * 4 +
      (item.kind === "building" ? 0 : 1);
    scored.push([score * 1000 + title.length, item]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, MAX_RESULTS).map(([, item]) => item);
}

export default function SearchBox({ items, onPick }: { items: SearchItem[]; onPick(item: SearchItem): void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => search(items, query), [items, query]);

  const pick = (item: SearchItem) => {
    onPick(item);
    setQuery(item.title);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className={`${PANEL} flex items-center gap-2 rounded-lg px-3`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-zinc-500" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder="Search rooms and buildings"
          aria-label="Search rooms and buildings"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="search-results"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) pick(results[active]);
            else if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            else return;
            e.preventDefault();
          }}
          className="h-10 w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery("")} aria-label="Clear search" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ✕
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul id="search-results" role="listbox" className={`${PANEL} absolute inset-x-0 top-12 z-10 overflow-hidden rounded-lg py-1`}>
          {results.map((item, i) => (
            <li
              key={`${item.building}:${item.room?.level}:${item.room?.name ?? ""}`}
              role="option"
              aria-selected={i === active}
              // Mouse down, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 ${i === active ? "bg-black/5 dark:bg-white/10" : ""}`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-zinc-200 font-mono text-[10px] text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                {item.kind === "building" ? "B" : "R"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-zinc-900 dark:text-zinc-100">{item.title}</span>
                <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-zinc-500">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
