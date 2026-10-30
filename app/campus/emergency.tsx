"use client";

import { ICONS } from "./icons";

/** The closest of one kind of safety equipment to what's selected. */
export interface Nearest {
  kind: keyof typeof SAFETY_LABELS;
  /** Building name and level label, if it's indoors. */
  building?: string;
  level?: string;
  /** The source's note on where it is ("Near west door"). */
  where?: string;
  /** Straight-line metres on the map, and floors up (+) or down (-) from here. */
  distance: number;
  floors: number;
  /** Where to go to see it. */
  target: { building?: string; level?: string; at: [number, number] };
}

export const SAFETY_LABELS = { aed: "AED", naloxone: "Naloxone kit", phones: "Emergency phone" } as const;
const ICON = { aed: ICONS.aed, naloxone: ICONS.naloxone, phones: ICONS.phone } as const;

const floorsText = (n: number) => (n === 0 ? "same floor" : `${Math.abs(n)} floor${Math.abs(n) > 1 ? "s" : ""} ${n > 0 ? "up" : "down"}`);

/** The info panels' emergency section: nearest AED, naloxone kit and emergency phone, each a link to it. */
export default function EmergencySection({ items, onGo }: { items: Nearest[]; onGo(item: Nearest): void }) {
  if (!items.length) return null;
  return (
    <section className="mt-3 border-t border-black/10 pt-2 dark:border-white/10">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">Emergency</h3>
      <ul className="mt-1">
        {items.map((item) => (
          <li key={item.kind}>
            <button onClick={() => onGo(item)} className="-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 rounded px-1 py-1 text-left hover:bg-black/5 dark:hover:bg-white/10">
              <span
                className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                dangerouslySetInnerHTML={{ __html: ICON[item.kind] }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{SAFETY_LABELS[item.kind]}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                    {Math.round(item.distance)} m · {floorsText(item.floors)}
                  </span>
                </span>
                <span className="block truncate text-xs text-zinc-500">{[item.building ?? "Outdoors", item.level].filter(Boolean).join(" · ")}</span>
                {item.where && <span className="block text-xs text-zinc-500">{item.where[0].toUpperCase() + item.where.slice(1)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
