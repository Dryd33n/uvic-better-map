"use client";

import { useState } from "react";
import ThemeEditor from "./theme-editor";
import type { ThemeEdits, ThemeName } from "./theme";
import { PANEL } from "./ui";

/** A point on the map: local metres (x east, y north of the dataset origin), WGS84, metres above sea level. */
export interface DebugPoint {
  x: number;
  y: number;
  elev: number;
  lon: number;
  lat: number;
  /** The building it's on, if any: "Name (CODE)". */
  building?: string;
}

export interface DebugSnapshot {
  /** Under the mouse. */
  cursor: DebugPoint | null;
  /** Where the last click landed. */
  pinned: DebugPoint | null;
  camera: { position: DebugPoint; target: DebugPoint; heading: number; pitch: number; distance: number };
  /** `ground` is Level 1 in metres above sea level as the data has it; `offset` is the adjustment made here. */
  building: { label: string; code?: string; ground: number; offset: number } | null;
  level: string | null;
  /** The selected room on that floor ("CLE A101"). */
  room: string | null;
  /** Every building moved up or down in this panel. */
  adjustments: GroundAdjustment[];
}

export interface GroundAdjustment {
  code: string;
  label: string;
  ground: number;
  offset: number;
}

const signed = (m: number) => `${m > 0 ? "+" : m < 0 ? "−" : "±"}${Math.abs(m).toFixed(1)}`;

/** The adjustments as entries for terrain({ overrides }) in the data package's config. */
function overrides(adjustments: GroundAdjustment[]): string {
  return [
    "// Ground adjustments from the debug panel: Level 1 in metres above sea level, for",
    "// terrain({ overrides }) in uvic-campus-data/config/sources.mjs.",
    ...adjustments.map((a) => `${a.code}: ${(a.ground + a.offset).toFixed(1)}, // ${a.label}: was ${a.ground.toFixed(1)}, ${signed(a.offset)} m`),
  ].join("\n");
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = (a - d - m / 60) * 3600;
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(2).padStart(5, "0")}"${v >= 0 ? pos : neg}`;
}

const latLon = (p: DebugPoint) => `${dms(p.lat, "N", "S")} ${dms(p.lon, "E", "W")}`;
const decimal = (p: DebugPoint) => `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
const local = (p: DebugPoint) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;

/** A link that reopens this exact view: camera, target, selected building and floor. */
export function viewLink(s: DebugSnapshot): string {
  const { position: p, target: t } = s.camera;
  const params = new URLSearchParams({ view: [p.x, p.y, p.elev, t.x, t.y, t.elev].map((v) => v.toFixed(1)).join(",") });
  if (s.building?.code) params.set("b", s.building.code);
  if (s.level) params.set("l", s.level);
  if (s.level && s.room) params.set("r", s.room);
  return `${window.location.origin}${window.location.pathname}#${params.toString().replaceAll("%2C", ",")}`;
}

function report(s: DebugSnapshot, note: string): string {
  const point = s.pinned ?? s.cursor;
  const c = s.camera;
  const lines = [
    "### Map issue",
    note.trim() || "(describe the issue)",
    "",
    `- View: ${viewLink(s)}`,
    `- Building: ${s.building ? `${s.building.label}${s.level ? `, level ${s.level}` : ""}${s.room ? `, room ${s.room}` : ""}` : "none selected"}`,
  ];
  if (point) {
    lines.push(
      `- ${s.pinned ? "Clicked point" : "Cursor"}: ${latLon(point)} (${decimal(point)}), local ${local(point)}, ${point.elev.toFixed(1)} m ASL${point.building ? `, on ${point.building}` : ""}`,
    );
  }
  lines.push(
    `- Camera: at local ${local(c.position)}, ${c.position.elev.toFixed(1)} m ASL, looking ${Math.round(c.heading)}° ${COMPASS[Math.round(c.heading / 45) % 8]}, pitch ${Math.round(c.pitch)}°, ${Math.round(c.distance)} m to target ${local(c.target)} at ${c.target.elev.toFixed(1)} m ASL`,
  );
  if (s.adjustments.length) lines.push("", "```js", overrides(s.adjustments), "```");
  return lines.join("\n");
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Row({ label, point }: { label: string; point: DebugPoint | null }) {
  return (
    <div className={label ? "mt-2" : ""}>
      {label && <div className={heading}>{label}</div>}
      {point ? (
        <div className="leading-relaxed">
          <div>{latLon(point)}</div>
          <div className="text-zinc-500">{decimal(point)}</div>
          <div>
            local {local(point)} · {point.elev.toFixed(1)} m
          </div>
          {point.building && <div className="text-zinc-500">on {point.building}</div>}
        </div>
      ) : (
        <div className="text-zinc-400">—</div>
      )}
    </div>
  );
}

const nudge = "rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] hover:bg-zinc-100 dark:border-white/15 dark:hover:bg-white/10";
const outline = "rounded-md border border-zinc-300 font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10";
const heading = "font-sans text-[11px] font-semibold uppercase tracking-wide text-zinc-500";
const quiet = "font-sans text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white";

/** Moves the selected building up or down: buttons nudge, the field takes a value on Enter or blur. */
function GroundOffset({ building, onChange }: { building: NonNullable<DebugSnapshot["building"]>; onChange(metres: number): void }) {
  const { ground, offset } = building;
  const commit = (v: string) => {
    const m = Number(v);
    if (v.trim() && Number.isFinite(m) && m !== offset) onChange(m);
  };
  return (
    <div className="mt-1">
      <div>
        Level 1 at {(ground + offset).toFixed(1)} m
        {offset !== 0 && (
          <span className="text-zinc-500">
            {" "}
            (data {ground.toFixed(1)}, {signed(offset)})
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 font-sans">
        {[-1, -0.1].map((d) => (
          <button key={d} onClick={() => onChange(offset + d)} className={nudge}>
            {signed(d).replace(".0", "")}
          </button>
        ))}
        <input
          key={offset}
          type="number"
          step={0.1}
          defaultValue={offset}
          aria-label="Ground offset in metres"
          title="Offset in metres: Enter to apply"
          onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          className="w-14 rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-right font-mono text-[11px] outline-none focus:border-zinc-500 dark:border-white/15 dark:focus:border-sky-400"
        />
        {[0.1, 1].map((d) => (
          <button key={d} onClick={() => onChange(offset + d)} className={nudge}>
            {signed(d).replace(".0", "")}
          </button>
        ))}
        <button disabled={!offset} onClick={() => onChange(0)} className={`${nudge} disabled:opacity-40`}>
          reset
        </button>
      </div>
    </div>
  );
}

export default function DebugPanel({
  snapshot,
  onClose,
  onClearPin,
  onGroundOffset,
  onClearGroundOffsets,
  theme,
  onTheme,
  themeEdits,
  onThemeEdits,
}: {
  snapshot: DebugSnapshot | null;
  onClose(): void;
  onClearPin(): void;
  onGroundOffset(metres: number): void;
  onClearGroundOffsets(): void;
  theme: ThemeName;
  onTheme(theme: ThemeName): void;
  themeEdits: Record<ThemeName, ThemeEdits>;
  onThemeEdits(edits: Record<ThemeName, ThemeEdits>): void;
}) {
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const flash = async (what: string, text: string) => {
    setCopied((await copy(text)) ? what : "Copy failed");
    setTimeout(() => setCopied(null), 1500);
  };

  const c = snapshot?.camera;
  return (
    <aside className={`${PANEL} absolute right-4 top-14 max-h-[calc(100%-4.5rem)] w-80 max-w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-3 font-mono text-xs`}>
      <div className="flex items-center justify-between font-sans">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-950 dark:text-white">Debug</h2>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white" aria-label="Close debug panel" title="Close (`)">
          ✕
        </button>
      </div>

      <Row label="Cursor" point={snapshot?.cursor ?? null} />
      <div className="mt-2 flex items-baseline justify-between">
        <span className={heading}>Clicked point</span>
        {snapshot?.pinned && (
          <button onClick={onClearPin} className={quiet}>
            clear
          </button>
        )}
      </div>
      <Row label="" point={snapshot?.pinned ?? null} />

      <div className="mt-2">
        <div className={heading}>Camera</div>
        {c && (
          <div className="leading-relaxed">
            <div>
              at {local(c.position)} · {c.position.elev.toFixed(1)} m
            </div>
            <div>
              target {local(c.target)} · {c.target.elev.toFixed(1)} m
            </div>
            <div>
              heading {Math.round(c.heading)}° {COMPASS[Math.round(c.heading / 45) % 8]} · pitch {Math.round(c.pitch)}° · {Math.round(c.distance)} m
            </div>
          </div>
        )}
      </div>
      <div className="mt-2">
        <div className={heading}>Selection</div>
        <div>{snapshot?.building ? `${snapshot.building.label}${snapshot.level ? ` · level ${snapshot.level}` : ""}` : "—"}</div>
        {snapshot?.building?.code && <GroundOffset building={snapshot.building} onChange={onGroundOffset} />}
      </div>
      {!!snapshot?.adjustments.length && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between">
            <span className={heading}>Ground adjustments</span>
            <button onClick={onClearGroundOffsets} className={quiet}>
              clear all
            </button>
          </div>
          {snapshot.adjustments.map((a) => (
            <div key={a.code}>
              {a.code} {(a.ground + a.offset).toFixed(1)} m <span className="text-zinc-500">({signed(a.offset)})</span>
            </div>
          ))}
          <button
            onClick={() => void flash("Adjustments copied", overrides(snapshot.adjustments))}
            className={`${outline} mt-1 w-full px-2 py-1 font-sans`}
          >
            Copy adjustments
          </button>
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's wrong here?"
        rows={3}
        className="mt-3 w-full resize-y rounded-md border border-zinc-300 bg-white/60 p-2 font-sans text-xs text-zinc-900 outline-none focus:border-zinc-500 dark:border-white/15 dark:bg-black/30 dark:text-zinc-100 dark:focus:border-sky-400"
      />
      <div className="mt-2 flex gap-2 font-sans">
        <button
          disabled={!snapshot}
          onClick={() => snapshot && void flash("Report copied", report(snapshot, note))}
          className="flex-1 rounded-md bg-zinc-900 px-2 py-1.5 font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Copy report
        </button>
        <button
          disabled={!snapshot}
          onClick={() => snapshot && void flash("Link copied", viewLink(snapshot))}
          className={`${outline} px-2 py-1.5`}
        >
          Copy link
        </button>
      </div>
      <p className="mt-1.5 h-4 font-sans text-[11px] text-zinc-500">{copied ?? "Click the map to pin a point. ` toggles this panel."}</p>
      <ThemeEditor theme={theme} onTheme={onTheme} edits={themeEdits} onEdits={onThemeEdits} onCopy={(text) => void flash("Theme changes copied", text)} />
    </aside>
  );
}
