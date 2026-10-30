// The map's two themes: monochrome, white buildings, one accent for hover and selection. Dark is
// the default. The debug panel's theme editor edits these live (THEME_FIELDS lists what it shows).

export type ThemeName = "dark" | "light";

export interface Palette {
  sky: string;
  offCampus: string; // terrain outside the campus land
  // Fades the scene into the sky between these distances (m).
  fog: { near: number; far: number };
  areas: Record<string, string>;
  lines: Record<string, string>;
  // A faint world grid on the terrain: lines every `spacing` m, stronger every `majorSpacing` m,
  // turned `angle` degrees. `minor` and `major` are their strengths.
  grid: { color: string; minor: number; major: number; angle: number; spacing: number; majorSpacing: number };
  light: { sky: string; ground: string; hemi: number; sun: number };
  building: { Main: string; Secondary: string; hover: string; selected: string; foundation: string };
  edge: string;
  accent: string;
  // Floor plans: the cut top, the floor plate, room outlines, stairs and lifts, the selected room.
  cap: string;
  slab: string;
  room: string;
  stairs: string;
  roomSelect: number; // opacity of the accent over the selected room
  pit: string; // inside walls of a floor cut below the ground beside it
}

export const THEMES: Record<ThemeName, Palette> = {
  dark: {
    sky: "#0b0d10",
    offCampus: "#0c0e11",
    fog: { near: 1800, far: 5000 },
    areas: {
      boundary: "#15181c", forest: "#1b271b", fields: "#425c42", trails: "#25292c", roads: "#1d2126", parking: "#1a1d21",
      reserved: "#1a1d21", shortParking: "#1a1d21", walkways: "#25292c", paths: "#25292c", fountains: "#16212a", construction: "#1f1e1b",
    },
    lines: { boundary: "#5d6671", green: "#2a3c2a", trails: "#3a4046", roads: "#4d5560", parking: "#3d444c", paths: "#38414c", water: "#3f5d72" },
    grid: { color: "#2b2b2b", minor: 0.4, major: 0.07, angle: 6, spacing: 2, majorSpacing: 100 },
    light: { sky: "#ffffff", ground: "#1a1d22", hemi: 4, sun: 1.5 },
    building: { Main: "#999999", Secondary: "#999999", hover: "#c4f0ff", selected: "#86def8", foundation: "#999999" },
    edge: "#7c8591",
    accent: "#4cc9f0",
    cap: "#d7dce2",
    slab: "#272c34",
    room: "#c9d1db",
    stairs: "#3b424c",
    roomSelect: 0.28,
    pit: "#262a30",
  },
  light: {
    sky: "#eef0f2",
    offCampus: "#dcdfe3",
    fog: { near: 1800, far: 5000 },
    areas: {
      boundary: "#e7e9ec", forest: "#c6d2c8", fields: "#dde3de", trails: "#e5e3de", roads: "#d3d6da", parking: "#d9dce0",
      reserved: "#d9dce0", shortParking: "#d9dce0", walkways: "#ffffff", paths: "#ffffff", fountains: "#d3dfe8", construction: "#e9e4da",
    },
    lines: { boundary: "#8c949e", green: "#b9c3bc", trails: "#c3bdb2", roads: "#a7aeb6", parking: "#b5bbc2", paths: "#7e8a95", water: "#93adc0" },
    grid: { color: "#d1d1d1", minor: 0.4, major: 0.08, angle: 6, spacing: 2, majorSpacing: 100 },
    light: { sky: "#ffffff", ground: "#9aa0a6", hemi: 1.3, sun: 1.5 },
    building: { Main: "#cfcfcf", Secondary: "#f1f2f4", hover: "#d6f0fb", selected: "#a4d6f0", foundation: "#b4b9c0" },
    edge: "#9aa1aa",
    accent: "#0a84c6",
    cap: "#ffffff",
    slab: "#eceef1",
    room: "#4b5563",
    stairs: "#d3d8de",
    roomSelect: 0.28,
    pit: "#c7ccd2",
  },
};

/** Edits to a theme: dotted palette paths ("areas.roads") to new values. */
export type ThemeEdits = Record<string, string | number>;

export function getPath(p: Palette, path: string): string | number {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], p) as string | number;
}

/** A theme with edits applied (a copy; the defaults stay as they are). */
export function withEdits(base: Palette, edits: ThemeEdits = {}): Palette {
  const p = structuredClone(base);
  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split(".");
    const last = keys.pop()!;
    const parent = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p as unknown as Record<string, unknown>);
    if (parent && last in parent) parent[last] = value;
  }
  return p;
}

// perTheme: a number set separately for each theme (scene and lighting); other numbers are shared.
type Field = { path: string; label: string; min?: number; max?: number; step?: number; perTheme?: boolean };
const colors = (prefix: string, keys: string[], labels: Record<string, string> = {}): Field[] =>
  keys.map((k) => ({ path: `${prefix}.${k}`, label: labels[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) }));

/**
 * What the theme editor shows, by section. Fields with min/max are numbers, the rest colours.
 * Colours are per theme, and so are the scene and lighting numbers; other numbers (grid, fills)
 * apply to both themes.
 */
export const THEME_FIELDS: { section: string; fields: Field[] }[] = [
  {
    section: "Scene",
    fields: [
      { path: "sky", label: "Sky" },
      { path: "offCampus", label: "Off campus" },
      { path: "fog.near", label: "Fog starts (m)", min: 0, max: 6000, step: 50, perTheme: true },
      { path: "fog.far", label: "Fog ends (m)", min: 100, max: 12000, step: 50, perTheme: true },
    ],
  },
  {
    section: "Lighting",
    fields: [
      { path: "light.sky", label: "Sky light" },
      { path: "light.ground", label: "Ground bounce" },
      { path: "light.hemi", label: "Ambient", min: 0, max: 4, step: 0.05, perTheme: true },
      { path: "light.sun", label: "Sun", min: 0, max: 4, step: 0.05, perTheme: true },
    ],
  },
  { section: "Ground fills", fields: colors("areas", Object.keys(THEMES.dark.areas), { shortParking: "Short-term parking" }) },
  { section: "Ground lines", fields: colors("lines", Object.keys(THEMES.dark.lines), { green: "Forest and fields" }) },
  {
    section: "Grid",
    fields: [
      { path: "grid.color", label: "Colour" },
      { path: "grid.spacing", label: "Spacing (m)", min: 1, max: 100, step: 1 },
      { path: "grid.minor", label: "Lines", min: 0, max: 0.4, step: 0.005 },
      { path: "grid.majorSpacing", label: "Major spacing (m)", min: 10, max: 1000, step: 10 },
      { path: "grid.major", label: "Major lines", min: 0, max: 0.4, step: 0.005 },
      { path: "grid.angle", label: "Angle (°)", min: 0, max: 90, step: 1 },
    ],
  },
  {
    section: "Buildings",
    fields: [
      ...colors("building", ["Main", "Secondary"], { Main: "Main buildings", Secondary: "Secondary buildings" }),
      { path: "building.foundation", label: "Foundation" },
      { path: "edge", label: "Edges" },
      { path: "building.hover", label: "Hovered" },
      { path: "building.selected", label: "Selected" },
      { path: "accent", label: "Accent" },
    ],
  },
  {
    section: "Floor plans",
    fields: [
      { path: "cap", label: "Cut top" },
      { path: "slab", label: "Floor" },
      { path: "room", label: "Room outlines" },
      { path: "stairs", label: "Stairs and lifts" },
      { path: "roomSelect", label: "Selected room fill", min: 0, max: 1, step: 0.02 },
      { path: "pit", label: "Pit walls" },
    ],
  },
];
