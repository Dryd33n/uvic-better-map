"use client";

import { THEME_FIELDS, THEMES, getPath, type ThemeEdits, type ThemeName } from "./theme";

const heading = "font-sans text-[11px] font-semibold uppercase tracking-wide text-zinc-500";
const outline = "rounded-md border border-zinc-300 font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10";

/** Every edit as "theme.path: old -> new", for the THEMES table in app/campus/theme.ts. */
export function themeChanges(edits: Record<ThemeName, ThemeEdits>): string {
  const lines: string[] = [];
  for (const name of ["dark", "light"] as const) {
    for (const [path, value] of Object.entries(edits[name])) {
      const before = getPath(THEMES[name], path);
      if (before !== value) lines.push(`${name}.${path}: ${JSON.stringify(before)} -> ${JSON.stringify(value)}`);
    }
  }
  return lines.length ? ["// Theme editor changes, for THEMES in app/campus/theme.ts:", ...lines].join("\n") : "";
}

/**
 * The debug panel's theme editor: a tab per theme (picking one also shows it on the map), every
 * colour and number in it by section, live. Edited fields are marked and can be reset one by one.
 */
export default function ThemeEditor({
  theme,
  onTheme,
  edits,
  onEdits,
  onCopy,
}: {
  theme: ThemeName;
  onTheme(theme: ThemeName): void;
  edits: Record<ThemeName, ThemeEdits>;
  onEdits(edits: Record<ThemeName, ThemeEdits>): void;
  onCopy(text: string): void;
}) {
  const mine = edits[theme];
  // Colours are per theme; numbers (fog, light, grid, fills) are set in both at once.
  const set = (path: string, value: string | number | null, shared: boolean) => {
    const next = { ...edits };
    for (const name of shared ? (["dark", "light"] as const) : [theme]) {
      const e = { ...next[name] };
      if (value === null || value === getPath(THEMES[name], path)) delete e[path];
      else e[path] = value;
      next[name] = e;
    }
    onEdits(next);
  };
  const changes = themeChanges(edits);
  const count = Object.keys(edits.dark).length + Object.keys(edits.light).length;

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between">
        <span className={heading}>Theme</span>
        <button disabled={!Object.keys(mine).length} onClick={() => onEdits({ ...edits, [theme]: {} })} className="font-sans text-[11px] text-zinc-500 hover:text-zinc-900 disabled:opacity-40 dark:hover:text-white">
          reset {theme}
        </button>
      </div>
      <div role="tablist" className="mt-1 grid grid-cols-2 gap-1 rounded-md bg-black/5 p-0.5 font-sans dark:bg-white/5">
        {(["dark", "light"] as const).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={name === theme}
            onClick={() => onTheme(name)}
            className={`rounded px-2 py-1 text-[11px] font-medium capitalize ${name === theme ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"}`}
          >
            {name}
            {Object.keys(edits[name]).length > 0 && <span className="ml-1 text-sky-600 dark:text-sky-400">•{Object.keys(edits[name]).length}</span>}
          </button>
        ))}
      </div>

      {THEME_FIELDS.map(({ section, fields }) => (
        <details key={section} className="mt-1 border-b border-black/5 pb-1 dark:border-white/5">
          <summary className="cursor-pointer select-none py-1 font-sans text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
            {section}
            {fields.some((f) => f.path in mine) && <span className="ml-1 text-sky-600 dark:text-sky-400">•</span>}
          </summary>
          <div className="space-y-1 pb-1">
            {fields.map((f) => {
              const value = getPath(THEMES[theme], f.path) as string | number;
              const current = (mine[f.path] ?? value) as string | number;
              const edited = f.path in mine;
              const shared = f.min !== undefined && !f.perTheme;
              return (
                <label key={f.path} className="flex items-center gap-2 font-sans text-[11px]">
                  <span className={`w-28 shrink-0 truncate ${edited ? "text-sky-700 dark:text-sky-300" : ""}`} title={shared ? `${f.path} (both themes)` : f.path}>
                    {f.label}
                    {shared && <span className="ml-1 text-zinc-400">⇄</span>}
                  </span>
                  {f.min !== undefined ? (
                    <>
                      <input
                        type="range"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={current}
                        onChange={(e) => set(f.path, Number(e.target.value), shared)}
                        className="min-w-0 flex-1 accent-sky-500"
                      />
                      <input
                        type="number"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={current}
                        onChange={(e) => e.target.value !== "" && set(f.path, Number(e.target.value), shared)}
                        className="w-14 rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-right font-mono text-[10px] outline-none dark:border-white/15"
                      />
                    </>
                  ) : (
                    <>
                      <input type="color" value={current as string} onChange={(e) => set(f.path, e.target.value, false)} className="h-5 w-7 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent p-0 dark:border-white/15" />
                      <input
                        key={current as string}
                        defaultValue={current as string}
                        onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && set(f.path, e.target.value.toLowerCase(), false)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-1 py-0.5 font-mono text-[10px] outline-none dark:border-white/15"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      set(f.path, null, shared);
                    }}
                    disabled={!edited}
                    title={`Reset to ${value}`}
                    aria-label={`Reset ${f.label}`}
                    className="w-3 shrink-0 text-zinc-500 hover:text-zinc-900 disabled:invisible dark:hover:text-white"
                  >
                    ↺
                  </button>
                </label>
              );
            })}
          </div>
        </details>
      ))}

      <button disabled={!changes} onClick={() => onCopy(changes)} className={`${outline} mt-2 w-full px-2 py-1 font-sans`}>
        Copy theme changes{count ? ` (${count})` : ""}
      </button>
    </div>
  );
}
