"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import DebugPanel, { type DebugPoint, type DebugSnapshot } from "./debug-panel";
import { ICONS, type IconName } from "./icons";
import SearchBox, { type SearchItem } from "./search";
import { PANEL } from "./ui";
import type { BuildingProps, CampusBundle, FloorFile, FloorOutlines, GroundLines, Level, LocalFeature, LocalPolygon, LocalRoom, Massing, Terrain } from "./types";

const DATA_URL = "/campus/campus.local.json";
const MASSING_URL = "/campus/extras/massing.json";
const OUTLINES_URL = "/campus/extras/floorOutlines.json";
const TERRAIN_URL = "/campus/extras/terrain.json";
const floorUrl = (key: string) => `/campus/floors/${key}.local.json`;

const GROUND_LINES_URL = "/campus/extras/groundLines.json";

// Ground layers, bottom to top: filled into the ground texture in the theme's colours.
const AREAS = ["boundary", "forest", "fields", "trails", "roads", "parking", "reserved", "shortParking", "walkways", "paths", "fountains", "construction"];
// The ground layers' outlines (extras/groundLines.json), drawn as lines over the fills.
const GROUND_LINES = ["boundary", "green", "trails", "roads", "parking", "paths", "water"];

// Monochrome, white buildings, one accent for hover and selection. Dark is the default.
export type ThemeName = "dark" | "light";
interface Palette {
  sky: string;
  offCampus: string; // terrain outside the campus land
  areas: Record<string, string>;
  lines: Record<string, string>;
  // A faint world grid on the terrain: every 10 m, stronger every 100 m.
  grid: { color: string; minor: number; major: number };
  light: { sky: string; ground: string; hemi: number; sun: number };
  building: { Main: string; Secondary: string; hover: string; selected: string; foundation: string };
  edge: string;
  accent: string;
  // Floor plans: the cut top, the floor plate, room outlines, stairs and lifts.
  cap: string;
  slab: string;
  room: string;
  stairs: string;
  pit: string; // inside walls of a floor cut below the ground beside it
}
const THEMES: Record<ThemeName, Palette> = {
  dark: {
    sky: "#0b0d10",
    offCampus: "#0c0e11",
    areas: {
      boundary: "#15181c", forest: "#14181a", fields: "#151a1b", trails: "#181b1f", roads: "#1d2126", parking: "#1a1d21",
      reserved: "#1a1d21", shortParking: "#1a1d21", walkways: "#22262b", paths: "#22262b", fountains: "#16212a", construction: "#1f1e1b",
    },
    lines: { boundary: "#5d6671", green: "#2f3a3a", trails: "#3a4046", roads: "#4d5560", parking: "#3d444c", paths: "#474e57", water: "#3f5d72" },
    grid: { color: "#ffffff", minor: 0.035, major: 0.07 },
    light: { sky: "#ffffff", ground: "#1a1d22", hemi: 1.2, sun: 1.5 },
    building: { Main: "#eef0f3", Secondary: "#dfe3e8", hover: "#c4f0ff", selected: "#86def8", foundation: "#353a41" },
    edge: "#7c8591",
    accent: "#4cc9f0",
    cap: "#d7dce2",
    slab: "#272c34",
    room: "#c9d1db",
    stairs: "#3b424c",
    pit: "#262a30",
  },
  light: {
    sky: "#eef0f2",
    offCampus: "#dcdfe3",
    areas: {
      boundary: "#e7e9ec", forest: "#e0e4e1", fields: "#dde3de", trails: "#e5e3de", roads: "#d3d6da", parking: "#d9dce0",
      reserved: "#d9dce0", shortParking: "#d9dce0", walkways: "#f3f4f6", paths: "#f3f4f6", fountains: "#d3dfe8", construction: "#e9e4da",
    },
    lines: { boundary: "#8c949e", green: "#b9c3bc", trails: "#c3bdb2", roads: "#a7aeb6", parking: "#b5bbc2", paths: "#bcc2c9", water: "#93adc0" },
    grid: { color: "#000000", minor: 0.04, major: 0.08 },
    light: { sky: "#ffffff", ground: "#9aa0a6", hemi: 1.3, sun: 1.5 },
    building: { Main: "#ffffff", Secondary: "#f1f2f4", hover: "#d6f0fb", selected: "#a4d6f0", foundation: "#b4b9c0" },
    edge: "#9aa1aa",
    accent: "#0a84c6",
    cap: "#ffffff",
    slab: "#eceef1",
    room: "#4b5563",
    stairs: "#d3d8de",
    pit: "#c7ccd2",
  },
};
// The ground layers are drawn into this texture, then draped over the terrain.
const GROUND_TEXTURE = 4096;
// Ground outlines are sampled this often along their edges and drawn this far above the terrain.
const LINE_STEP = 2;
const LINE_LIFT = 0.2;
// Building edges: corners turning less than this stay unlined (curved walls).
const EDGE_TURN = 0.3;
// Building walls run this far below their lowest level or the lowest ground beside them, so they
// meet the terrain on slopes.
const FOOTING = 1;
// Every building stands this far above its ground level on a foundation, so no ground floor reads
// as sunk where the ground rises a little.
const PLINTH = 0.4;
// The source has no heights for buildings without floor plans.
const HEIGHT_BY_TYPE: Record<string, number> = { Main: 15, Secondary: 9 };
const HEIGHT_DEFAULT = 11;

// Floor plans, bottom to top: the cut top of the building (roof wherever the floor doesn't reach),
// the floor plate, stairs and lifts filled, then every room's outline.
const ROOM_CORRIDOR = 0;
const ROOM_WASHROOM = 2;
const ROOM_FOOD = 3;
const ROOM_STAIRS = 4;
// Corridor edges this close to another corridor's edge are a seam between them, not a wall (m).
const CORRIDOR_SEAM = 0.15;
// Floor plan markers: a room's name shows once the room is at least this wide on screen (and
// wider than most of the name), an icon once it's this wide. Points count as rooms this wide (m).
const LABEL_MIN_ROOM_PX = 28;
const ICON_MIN_ROOM_PX = 12;
const POINT_SIZE = 4;
// Camera flights to a found room or building: how long, and how far from it they end.
const FLIGHT_MS = 900;
const ROOM_VIEW_DISTANCE = 70;
const BUILDING_VIEW_DISTANCE = 220;
// Point layers shown on floor plans, with their icon and rank (lower places first).
const POINT_MARKERS: [layer: string, icon: IconName, rank: number][] = [
  ["aed", "aed", 0],
  ["naloxone", "naloxone", 0],
  ["showers", "shower", 3],
  ["microwaves", "microwave", 3],
];
const MARKER_CLASS =
  "absolute left-0 top-0 flex flex-col items-center whitespace-nowrap text-center font-mono text-[10px] leading-tight text-zinc-700 [text-shadow:0_0_3px_#fff,0_0_3px_#fff] dark:text-zinc-200 dark:[text-shadow:0_0_3px_#000,0_0_3px_#000]";
const CHIP_CLASS = "grid h-[18px] w-[18px] place-items-center rounded bg-zinc-800 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900";
const ACCESSIBLE_CHIP_CLASS = "grid h-[18px] w-[18px] place-items-center rounded bg-sky-700 text-white shadow-sm dark:bg-sky-400 dark:text-zinc-950";
const CAP_LIFT = 0.02; // above the cut, so the cap closes the chopped walls
const SLAB_LIFT = 0.05;
// Room outlines sit clear of the plate, which is depth-biased toward the camera.
const ROOM_LIFT = 0.25;
const NO_CUT = 1e6;
const THEME_KEY = "campus-theme";
function readThemeStored(): ThemeName {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
const DEBUG_KEY = "campus-debug";
const noSubscribe = () => () => {};
function readDebugStored(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}
const OFFSETS_KEY = "campus-ground-offsets";
function readOffsets(): [string, number][] {
  try {
    const stored = JSON.parse(localStorage.getItem(OFFSETS_KEY) ?? "{}") as Record<string, unknown>;
    return Object.entries(stored).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]));
  } catch {
    return [];
  }
}
function saveOffsets(offsets: Map<string, number>) {
  try {
    if (offsets.size) localStorage.setItem(OFFSETS_KEY, JSON.stringify(Object.fromEntries(offsets)));
    else localStorage.removeItem(OFFSETS_KEY);
  } catch {}
}
// Metres per degree, as in the dataset's local projection (uvic-campus-data/src/geometry.mjs).
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQ = 111320;
// Keeps a roof that ends exactly at the shown floor (a skyway below it) from flickering at the cut.
const CUT_SLACK = 0.01;

type Building = LocalFeature<BuildingProps>;

/** The selected room, as the info panel shows it. */
interface RoomInfo {
  title: string;
  name?: string;
  type?: string;
  building: string;
  level: string;
  wash?: { gender?: string | null; access?: string | null };
  note?: string;
  link?: string;
}

// Everything the search box can find: buildings, and the bundle's room index.
function searchIndex(data: CampusBundle): SearchItem[] {
  const buildings = (data.layers.buildings?.features ?? []) as Building[];
  const byId = new Map(buildings.map((b) => [b.id, b.props]));
  const levels = new Map(data.floorList.map((l) => [l.id, l.label]));
  const lower = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();
  const items: SearchItem[] = buildings
    .filter((b) => b.props.name || b.props.fullName)
    .map((b) => ({
      kind: "building",
      title: b.props.fullName ?? b.props.name!,
      detail: [b.props.code, b.props.number && `Building ${b.props.number}`].filter(Boolean).join(" · "),
      terms: lower(b.props.code, b.props.name, b.props.fullName),
      building: b.id,
    }));
  for (const [name, building, level, type, label] of data.rooms ?? []) {
    const b = byId.get(building);
    const number = name.replace(/^\S+\s+/, "");
    items.push({
      kind: "room",
      title: label ?? name,
      detail: [label && name, b?.fullName ?? b?.name ?? building, levels.get(level) ?? `Level ${level}`].filter(Boolean).join(" · "),
      terms: lower(name, number, b?.code, b?.name, b?.fullName, data.roomTypes?.[type]),
      building,
      room: { name, level },
    });
  }
  return items;
}
export type FloorPicker = { levels: Level[]; level: string } | null;

// Flat [x, y, ...] ring -> Vector2s in map metres.
function ringPoints(flat: number[]): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return pts;
}

// Whether local point (x, y) lies inside a flat ring.
function inRing(flat: number[], [x, y]: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [flat[i], flat[i + 1], flat[j], flat[j + 1]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Area of a flat ring in square metres.
function ringArea(flat: number[]): number {
  let a = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length;
    a += flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
  }
  return Math.abs(a / 2);
}

function toShape([outer, ...holes]: LocalPolygon): THREE.Shape {
  const shape = new THREE.Shape(ringPoints(outer));
  for (const h of holes) shape.holes.push(new THREE.Path(ringPoints(h)));
  return shape;
}

// Shapes are drawn in the XY plane; rotating -90° about X puts them on the ground with north = -z.
const toGround = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);

function buildingHeight(p: BuildingProps): number {
  return p.height ?? HEIGHT_BY_TYPE[p.type ?? ""] ?? HEIGHT_DEFAULT;
}

// Ground height in metres above sea level at local (x, y): on the terrain mesh's own triangles
// (see terrainGeometry), so lines laid on it sit exactly on the surface.
function heightAt(t: Terrain, x: number, y: number): number {
  const u = Math.min(Math.max((x - t.x0) / t.cell, 0), t.nx - 1.001);
  const v = Math.min(Math.max((y - t.y0) / t.cell, 0), t.ny - 1.001);
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const h = (a: number, b: number) => t.heights[b * t.nx + a] / 10;
  const [ha, hb, hc, hd] = [h(i, j), h(i + 1, j), h(i, j + 1), h(i + 1, j + 1)];
  return fu >= fv ? ha + fu * (hb - ha) + fv * (hd - hb) : ha + fv * (hc - ha) + fu * (hd - hc);
}

// Closed flat rings -> line segment positions (x, height, -y), each edge cut into pieces at most
// `step` long so the line can follow the terrain.
function ringLines(rings: number[][], height: (x: number, y: number) => number, step = Infinity): THREE.BufferGeometry {
  const p: number[] = [];
  for (const r of rings) {
    for (let k = 0; k < r.length; k += 2) {
      const [x0, y0, x1, y1] = [r[k], r[k + 1], r[(k + 2) % r.length], r[(k + 3) % r.length]];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let s = 0; s < n; s++) {
        const [ax, ay] = [x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n];
        const [bx, by] = [x0 + ((x1 - x0) * (s + 1)) / n, y0 + ((y1 - y0) * (s + 1)) / n];
        p.push(ax, height(ax, ay), -ay, bx, height(bx, by), -by);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

// A floor's room outlines at height y. Corridors that meet read as one: their edges are left out
// wherever they run along another corridor's edge (checked in pieces at most 0.5 m long).
function roomOutlines(rooms: LocalRoom[], y: number): THREE.BufferGeometry {
  const p: number[] = [];
  const corridors = rooms.filter((r) => r.t === ROOM_CORRIDOR).map((r) => {
    const rings = r.polys.flat();
    const xs = rings.flatMap((q) => q.filter((_, i) => i % 2 === 0)), ys = rings.flatMap((q) => q.filter((_, i) => i % 2 === 1));
    return { r, rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const onCorridorEdge = (self: LocalRoom, x: number, y0: number) =>
    corridors.some(({ r, rings, box }) => {
      if (r === self || x < box[0] - CORRIDOR_SEAM || x > box[2] + CORRIDOR_SEAM || y0 < box[1] - CORRIDOR_SEAM || y0 > box[3] + CORRIDOR_SEAM) return false;
      return rings.some((q) => {
        for (let k = 0; k < q.length; k += 2) {
          const [ax, ay, bx, by] = [q[k], q[k + 1], q[(k + 2) % q.length], q[(k + 3) % q.length]];
          const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const t = len2 ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y0 - ay) * (by - ay)) / len2)) : 0;
          if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y0) < CORRIDOR_SEAM) return true;
        }
        return false;
      });
    });
  for (const r of rooms) {
    const corridor = r.t === ROOM_CORRIDOR;
    for (const q of r.polys.flat()) {
      for (let k = 0; k < q.length; k += 2) {
        const [x0, y0, x1, y1] = [q[k], q[k + 1], q[(k + 2) % q.length], q[(k + 3) % q.length]];
        const n = corridor ? Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5)) : 1;
        for (let s = 0; s < n; s++) {
          const [ax, ay] = [x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n];
          const [bx, by] = [x0 + ((x1 - x0) * (s + 1)) / n, y0 + ((y1 - y0) * (s + 1)) / n];
          if (corridor && onCorridorEdge(r, (ax + bx) / 2, (ay + by) / 2)) continue;
          p.push(ax, y, -ay, bx, y, -by);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

// A building's edges as lines: vertical at its corners (not along curved walls), and around each
// block's top except where the block above carries the wall on up (no seams between storeys).
function edgeLines(blocks: { polys: LocalPolygon[]; from: number; to: number }[]): THREE.BufferGeometry {
  const p: number[] = [];
  const ringsOf = (b: { polys: LocalPolygon[] }) => b.polys.flat();
  // Whether (x, y) lies on one of these rings' edges.
  const onEdge = (rings: number[][], x: number, y: number) =>
    rings.some((r) => {
      for (let k = 0; k < r.length; k += 2) {
        const [ax, ay, bx, by] = [r[k], r[k + 1], r[(k + 2) % r.length], r[(k + 3) % r.length]];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = len2 ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
        if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < 0.05) return true;
      }
      return false;
    });
  blocks.forEach((block, i) => {
    const above = blocks.slice(i + 1).filter((b) => b.from < block.to && b.to > block.to).flatMap(ringsOf);
    for (const r of ringsOf(block)) {
      const n = r.length / 2;
      for (let k = 0; k < n; k++) {
        const [px, py] = [r[((k + n - 1) % n) * 2], r[((k + n - 1) % n) * 2 + 1]];
        const [x, y] = [r[k * 2], r[k * 2 + 1]];
        const [qx, qy] = [r[((k + 1) % n) * 2], r[((k + 1) % n) * 2 + 1]];
        let turn = Math.abs(Math.atan2(qy - y, qx - x) - Math.atan2(y - py, x - px));
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn > EDGE_TURN) p.push(x, block.from, -y, x, block.to, -y);
        if (!onEdge(above, (x + qx) / 2, (y + qy) / 2)) p.push(x, block.to, -y, qx, block.to, -qy);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

// Adds the world grid to the terrain's material: lines every 10 m and 100 m in world x/z, faded
// out where they'd be closer together than a few pixels.
function withGrid(material: THREE.MeshLambertMaterial, uniforms: { gridColor: { value: THREE.Color }; gridMinor: { value: number }; gridMajor: { value: number } }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGrid;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGrid = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vGrid;
uniform vec3 gridColor;
uniform float gridMinor, gridMajor;
float gridLine(vec2 p, float size) {
  vec2 c = p / size;
  vec2 w = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, vec2(1e-5));
  return (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(0.04, 0.12, max(w.x, w.y)));
}`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, gridColor, max(gridLine(vGrid, 10.0) * gridMinor, gridLine(vGrid, 100.0) * gridMajor));`,
      );
  };
}

// Without terrain data: a flat grid around the campus land, at height 0.
function flatTerrain(data: CampusBundle): Terrain {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of [...(data.layers.boundary?.features ?? []), ...(data.layers.buildings?.features ?? [])]) {
    const [x0, y0, x1, y1] = f.bbox ?? [0, 0, 0, 0];
    box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0); box[2] = Math.max(box[2], x1); box[3] = Math.max(box[3], y1);
  }
  const cell = Math.max(box[2] - box[0], box[3] - box[1]) + 200;
  return { source: "", licence: "", cell, x0: box[0] - 100, y0: box[1] - 100, nx: 2, ny: 2, ref: 0, heights: [0, 0, 0, 0] };
}

// The terrain surface in scene units (heights relative to `ref`), with UVs across the grid.
function terrainGeometry(t: Terrain): THREE.BufferGeometry {
  const { nx, ny, cell, x0, y0 } = t;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos.set([x0 + i * cell, t.heights[k] / 10 - t.ref, -(y0 + j * cell)], k * 3);
      uv.set([i / (nx - 1), j / (ny - 1)], k * 2);
    }
  }
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let n = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index.set([a, b, d, a, d, c], n);
      n += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

// Just the vertical faces of a (non-indexed) mesh, cut down to `top(x, z)` at each corner.
function wallsOf(g: THREE.BufferGeometry, top: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const normal = g.getAttribute("normal");
  const p: number[] = [], n: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (Math.abs(normal.getY(i)) > 0.5) continue;
    for (let k = i; k < i + 3; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      p.push(x, Math.min(pos.getY(k), top(x, z)), z);
      n.push(normal.getX(k), normal.getY(k), normal.getZ(k));
    }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  walls.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  return walls;
}

// The floor shown when a building is selected: Level 1, else the lowest level at or above ground.
function groundLevel(levels: Level[]): string {
  return (levels.find((l) => l.elev === 0) ?? levels.find((l) => l.elev >= 0) ?? levels[0]).id;
}

export default function CampusViewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  // Set by the scene once it exists; the UI calls into it.
  const sceneApi = useRef<{
    deselect(): void;
    showLevel(id: string): void;
    setDebug(open: boolean): void;
    clearPin(): void;
    setGroundOffset(metres: number): void;
    clearGroundOffsets(): void;
    setTheme(theme: ThemeName): void;
    clearRoom(): void;
    find(item: SearchItem): void;
  } | null>(null);
  // Chosen this visit, else as left last time (dark until hydrated, and by default).
  const [themeChosen, setTheme] = useState<ThemeName | null>(null);
  const themeStored = useSyncExternalStore(noSubscribe, readThemeStored, () => "dark" as const);
  const theme = themeChosen ?? themeStored;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<BuildingProps | null>(null);
  const [selected, setSelected] = useState<BuildingProps | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [floors, setFloors] = useState<FloorPicker>(null);
  // Opened or closed this visit, else as left last time (read after hydration; false on the server).
  const [debugToggled, setDebugOpen] = useState<boolean | null>(null);
  const debugStored = useSyncExternalStore(noSubscribe, readDebugStored, () => false);
  const debugOpen = debugToggled ?? debugStored;
  const [debug, setDebug] = useState<DebugSnapshot | null>(null);

  // The debug panel: ` toggles it, and it stays open across reloads.
  const debugOpenRef = useRef(debugOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "`" || (e.target as HTMLElement).closest("input, textarea")) return;
      setDebugOpen(!debugOpenRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    debugOpenRef.current = debugOpen;
    sceneApi.current?.setDebug(debugOpen);
  }, [debugOpen, status]);
  useEffect(() => {
    sceneApi.current?.setTheme(theme);
  }, [theme, status]);
  useEffect(() => {
    if (themeChosen === null) return;
    try {
      localStorage.setItem(THEME_KEY, themeChosen);
    } catch {}
  }, [themeChosen]);
  useEffect(() => {
    if (debugToggled === null) return;
    try {
      localStorage.setItem(DEBUG_KEY, debugToggled ? "1" : "0");
    } catch {}
  }, [debugToggled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const abort = new AbortController();
    const disposables: { dispose(): void }[] = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);

    let palette = THEMES.dark;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.Fog(palette.sky, 1800, 5000);
    const camera = new THREE.PerspectiveCamera(40, 1, 5, 12000);
    camera.position.set(100, 850, 750);

    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.minDistance = 40;
    controls.maxDistance = 3000;
    controls.maxPolarAngle = 1.2;
    controls.zoomToCursor = true;

    const hemi = new THREE.HemisphereLight(palette.light.sky, palette.light.ground, palette.light.hemi);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, palette.light.sun);
    sun.position.set(-500, 700, 350);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -1000, right: 1000, top: 1000, bottom: -1000, near: 10, far: 2500 });
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    // The selected building is cut at the shown floor: everything above `cut.constant` is clipped.
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CUT);
    // Building faces sit a little back in depth so their edge lines draw cleanly on top.
    const face = (clip: boolean) =>
      new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...(clip && { clippingPlanes: [cut], clipShadows: true }) });
    const materials = { Main: face(false), Secondary: face(false), hover: face(false), selected: face(true) };
    const edgeMaterials = {
      base: new THREE.LineBasicMaterial(),
      accent: new THREE.LineBasicMaterial(),
      selected: new THREE.LineBasicMaterial({ clippingPlanes: [cut] }),
    };
    const lifted = (step: number) => new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -step, polygonOffsetUnits: -step });
    const capMaterial = lifted(1);
    const slabMaterial = lifted(2);
    const stairsMaterial = lifted(3);
    const roomLineMaterial = new THREE.LineBasicMaterial();
    // The selected room: an accent wash over its floor and an accent outline.
    const roomFillMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const roomOutlineMaterial = new THREE.LineBasicMaterial();
    // A floor cut below the surrounding ground leaves a pit in the terrain. Its walls are the
    // selected building's inside wall faces (not floors or roofs: an upper storey's underside would
    // read as a ceiling), from the shown floor up to the ground right beside each wall, so they
    // don't stand up as a rim where the ground outside is below the floor.
    const pitFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), NO_CUT);
    const pitMaterial = new THREE.MeshLambertMaterial({ side: THREE.BackSide, clippingPlanes: [pitFloor] });
    const pit = new THREE.Mesh(undefined, pitMaterial);
    pit.visible = false;
    scene.add(pit);
    const foundations = { base: face(false), selected: face(true) };
    const styleOf = (b: Building, selected: boolean, hovered: boolean): THREE.Material[] => [
      selected ? materials.selected : hovered ? materials.hover : b.props.type === "Secondary" ? materials.Secondary : materials.Main,
      selected ? foundations.selected : foundations.base,
    ];
    const edgeStyleOf = (selected: boolean, hovered: boolean) => (selected ? edgeMaterials.selected : hovered ? edgeMaterials.accent : edgeMaterials.base);
    // The ground: layer fills in a texture (drawn in addCampus, redrawn per theme), outlines as
    // lines, and the grid in the terrain's shader.
    const areaMaterials = Object.fromEntries(AREAS.map((key) => [key, new THREE.MeshBasicMaterial({ depthWrite: false })]));
    const lineMaterials = Object.fromEntries(GROUND_LINES.map((key) => [key, new THREE.LineBasicMaterial()]));
    const grid = { gridColor: { value: new THREE.Color() }, gridMinor: { value: 0 }, gridMajor: { value: 0 } };
    let drawGround: (() => void) | null = null;
    disposables.push(
      ...Object.values(materials), ...Object.values(foundations), ...Object.values(edgeMaterials), ...Object.values(areaMaterials), ...Object.values(lineMaterials),
      capMaterial, slabMaterial, stairsMaterial, roomLineMaterial, roomFillMaterial, roomOutlineMaterial, pitMaterial,
    );

    function applyTheme(name: ThemeName) {
      palette = THEMES[name];
      const p = palette;
      (scene.background as THREE.Color).set(p.sky);
      scene.fog!.color.set(p.sky);
      hemi.color.set(p.light.sky);
      hemi.groundColor.set(p.light.ground);
      hemi.intensity = p.light.hemi;
      sun.intensity = p.light.sun;
      for (const k of ["Main", "Secondary", "hover", "selected"] as const) materials[k].color.set(p.building[k]);
      foundations.base.color.set(p.building.foundation);
      foundations.selected.color.set(p.building.foundation);
      edgeMaterials.base.color.set(p.edge);
      edgeMaterials.accent.color.set(p.accent);
      edgeMaterials.selected.color.set(p.accent);
      capMaterial.color.set(p.cap);
      slabMaterial.color.set(p.slab);
      stairsMaterial.color.set(p.stairs);
      roomLineMaterial.color.set(p.room);
      roomFillMaterial.color.set(p.accent);
      roomOutlineMaterial.color.set(p.accent);
      pitMaterial.color.set(p.pit);
      for (const [k, m] of Object.entries(areaMaterials)) m.color.set(p.areas[k]);
      for (const [k, m] of Object.entries(lineMaterials)) m.color.set(p.lines[k]);
      grid.gridColor.value.set(p.grid.color);
      grid.gridMinor.value = p.grid.minor;
      grid.gridMajor.value = p.grid.major;
      drawGround?.();
    }
    applyTheme("dark");

    // Building meshes, for picking, and what each one needs for its floor plans.
    const buildings: THREE.Mesh[] = [];
    let campus: CampusBundle | null = null;
    let massing: Massing = {};
    let groundAt: ((x: number, y: number) => number) | null = null; // terrain height in scene units at local x, y
    let ref = 0; // scene y 0 in metres above sea level
    let terrainData: Terrain | null = null;
    // Ground adjustments made in the debug panel, in metres by building code, kept across reloads.
    const offsets = new Map<string, number>(readOffsets());

    // Level 1 in metres above sea level, as the data has it (before adjustments).
    const dataGround = (b: Building) => b.props.ground ?? heightAt(terrainData!, ...b.at);
    // What stands on the ground: the footprint, or the ground band (which covers it).
    const standingOf = (b: Building) => {
      const bands = massing[b.id] ?? [];
      return bands[0]?.elev === 0 ? bands[0].polys : (b.polys ?? []);
    };

    // A building standing at `ground` (Level 1, metres above sea level) on a foundation. With floor
    // plans, the massing bands give each storey only where its floor reaches (one-storey wings stay
    // low, skyways leave open ground under them); otherwise the footprint is extruded to the
    // building's height. Foundations reach down to the lowest level or the lowest ground beside
    // them, whichever is lower.
    function buildingGeometry(b: Building, ground: number) {
      const base = ground - ref + PLINTH;
      // Separate structures mapped as one building stand at their own ground (relative to its main ground).
      const dz = (b.polys ?? []).map((_, i) => (b.props.grounds?.[i] ?? ground) - ground);
      const levelFloor = Math.min(0, ...levelsOf(b).map((l) => l.elev));
      const height = buildingHeight(b.props);
      const body: THREE.BufferGeometry[] = [];
      const foundation: THREE.BufferGeometry[] = [];
      const extrude = (p: LocalPolygon, from: number, to: number) => new THREE.ExtrudeGeometry(toShape(p), { depth: to - from, bevelEnabled: false }).translate(0, 0, from);
      let highest = -Infinity;
      const bands = massing[b.id] ?? [];
      standingOf(b).forEach((p, i) => {
        // Walls reach below the lowest level and the lowest ground beside them.
        let lowest = levelFloor;
        for (let k = 0; k < p[0].length; k += 2) {
          const z = groundAt!(p[0][k], p[0][k + 1]) - base;
          lowest = Math.min(lowest, z);
          highest = Math.max(highest, z);
        }
        const up = dz[i] ?? 0; // separate structures exist only without floor plans
        if (!bands.length) body.push(extrude(p, up, up + height));
        foundation.push(extrude(p, Math.min(lowest, up + levelFloor) - FOOTING, up));
      });
      for (const { elev, top, polys } of bands) for (const p of polys) body.push(extrude(p, elev, top));
      const merged = [body, foundation].map((g) => mergeGeometries(g));
      [...body, ...foundation].forEach((g) => g.dispose());
      // Two groups: the building (material 0) and its foundation (material 1).
      const geometry = toGround(mergeGeometries(merged, true));
      merged.forEach((g) => g.dispose());
      const blocks = bands.length
        ? bands.map((m) => ({ polys: m.polys, from: m.elev, to: m.top }))
        : standingOf(b).map((p, i) => ({ polys: [p], from: dz[i] ?? 0, to: (dz[i] ?? 0) + height }));
      return { geometry, edges: edgeLines(blocks), base, groundTop: base + highest };
    }

    // (Re)builds a building's mesh at its ground plus any adjustment.
    function placeBuilding(mesh: THREE.Mesh) {
      const b = mesh.userData.building as Building;
      const { geometry, edges, base, groundTop } = buildingGeometry(b, dataGround(b) + (offsets.get(b.props.code ?? "") ?? 0));
      mesh.geometry.dispose();
      (mesh.userData.walls as THREE.BufferGeometry | undefined)?.dispose();
      delete mesh.userData.walls;
      mesh.geometry = geometry;
      const lines = mesh.userData.edges as THREE.LineSegments;
      lines.geometry.dispose();
      lines.geometry = edges;
      mesh.position.y = base;
      mesh.userData.groundTop = groundTop;
    }

    function setGroundOffset(offset: number) {
      const mesh = selectedMesh;
      const code = (mesh?.userData.building as Building | undefined)?.props.code;
      if (!mesh || !code || !Number.isFinite(offset)) return;
      offset = Math.round(offset * 10) / 10;
      if (offset) offsets.set(code, offset);
      else offsets.delete(code);
      saveOffsets(offsets);
      placeBuilding(mesh);
      if (shownLevel) void showLevel(shownLevel);
      publish();
    }

    function addCampus(data: CampusBundle, terrain: Terrain, groundLines: GroundLines) {
      const groundY = (x: number, y: number) => heightAt(terrain, x, y) - terrain.ref;
      groundAt = groundY;
      ref = terrain.ref;
      terrainData = terrain;

      // The ground layers and building footprints go flat into their own scene, which is drawn
      // from straight above into a texture for the terrain (again whenever the theme changes). The
      // layers are coplanar, so draw order (not depth) stacks them; footprints go last with alpha 0,
      // which cuts holes in the terrain for the buildings to stand in (uphill ground would
      // otherwise poke through floor plans).
      const flat = new THREE.Scene();
      flat.background = new THREE.Color();
      const flatLayer = (shapes: THREE.Shape[], material: THREE.Material, order: number) => {
        if (!shapes.length) return;
        const mesh = new THREE.Mesh(toGround(new THREE.ShapeGeometry(shapes)), material);
        mesh.renderOrder = order;
        flat.add(mesh);
      };
      AREAS.forEach((key, i) => {
        const shapes = (data.layers[key]?.features ?? []).flatMap((f) => (f.polys ?? []).map(toShape));
        flatLayer(shapes, areaMaterials[key], i);
      });
      const footprints: THREE.Shape[] = [];

      // Buildings: one mesh each so they can be picked (see buildingGeometry), edges as a child.
      for (const b of (data.layers.buildings?.features ?? []) as Building[]) {
        if (!b.polys?.length) continue;
        const mesh = new THREE.Mesh(undefined, styleOf(b, false, false));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.building = b;
        mesh.userData.edges = new THREE.LineSegments(undefined, edgeStyleOf(false, false));
        mesh.add(mesh.userData.edges);
        placeBuilding(mesh);
        footprints.push(...standingOf(b).map(toShape));
        scene.add(mesh);
        buildings.push(mesh);
      }
      const holes = new THREE.MeshBasicMaterial({ opacity: 0, blending: THREE.NoBlending, depthWrite: false });
      flatLayer(footprints, holes, AREAS.length);

      // Draw the flat scene from above, north up, over exactly the terrain grid.
      const [x1, y1] = [terrain.x0 + (terrain.nx - 1) * terrain.cell, terrain.y0 + (terrain.ny - 1) * terrain.cell];
      const eye = new THREE.OrthographicCamera(terrain.x0, x1, y1, terrain.y0, 0.1, 100);
      eye.position.set(0, 50, 0);
      eye.up.set(0, 0, -1);
      eye.lookAt(0, 0, 0);
      const size = Math.min(GROUND_TEXTURE, renderer.capabilities.maxTextureSize);
      const target = new THREE.WebGLRenderTarget(size, Math.round((size * (y1 - terrain.y0)) / (x1 - terrain.x0)), {
        samples: 4,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        colorSpace: THREE.SRGBColorSpace,
      });
      target.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      drawGround = () => {
        (flat.background as THREE.Color).set(palette.offCampus);
        renderer.setRenderTarget(target);
        renderer.render(flat, eye);
        renderer.setRenderTarget(null);
      };
      drawGround();
      disposables.push(holes, target, {
        dispose: () => flat.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose()),
      });

      const groundMaterial = new THREE.MeshLambertMaterial({ map: target.texture, alphaTest: 0.5 });
      withGrid(groundMaterial, grid);
      const ground = new THREE.Mesh(terrainGeometry(terrain), groundMaterial);
      ground.receiveShadow = true;
      scene.add(ground);
      disposables.push(ground.geometry, groundMaterial);

      // The layers' outlines, laid on the terrain.
      for (const key of GROUND_LINES) {
        if (!groundLines[key]?.length) continue;
        const lines = new THREE.LineSegments(ringLines(groundLines[key], (x, y) => groundY(x, y) + LINE_LIFT, LINE_STEP), lineMaterials[key]);
        scene.add(lines);
        disposables.push(lines.geometry);
      }

      // Centre the view on the campus land.
      const box = new THREE.Box3();
      for (const f of data.layers.boundary?.features ?? []) {
        const [x0, y0, x1, y1] = f.bbox ?? [0, 0, 0, 0];
        box.expandByPoint(new THREE.Vector3(x0, 0, -y0)).expandByPoint(new THREE.Vector3(x1, 0, -y1));
      }
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        c.y = groundY(c.x, -c.z);
        controls.target.copy(c);
        camera.position.set(c.x, c.y + 850, c.z + 750);
        sun.target.position.copy(c);
      }
    }

    // ── floor plans ──
    // The shown floor: a cap over the cut (the massing bands at that height, or the footprint), the
    // floor's outline as its plate, and its rooms merged per room type, all at the building's ground
    // level. The cap is pickable and stands in for the selected building.
    const plan = new THREE.Group();
    scene.add(plan);
    const floorFiles = new Map<string, Promise<FloorFile>>();
    let outlines: Promise<FloorOutlines> | null = null; // loaded on first selection
    let planToken = 0;
    let shownLevel: string | null = null;

    const loadJson = <T,>(url: string, cache: Map<string, Promise<T>>): Promise<T> => {
      if (!cache.has(url)) {
        const p = fetch(url, { signal: abort.signal }).then((r) => {
          if (!r.ok) throw new Error(`${url} returned ${r.status}`);
          return r.json() as Promise<T>;
        });
        p.catch(() => cache.delete(url));
        cache.set(url, p);
      }
      return cache.get(url)!;
    };
    const planMesh = (polys: LocalPolygon[], y: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(toGround(new THREE.ShapeGeometry(polys.map(toShape))).translate(0, y, 0), material);
      mesh.receiveShadow = true;
      plan.add(mesh);
      return mesh;
    };

    // ── room labels and icons ──
    // The shown floor's markers as HTML over the canvas, placed every frame in rank order (safety
    // equipment, elevators, washrooms, food and amenities, named rooms, room numbers, stairs; bigger
    // rooms first within a rank). Each shows only where its room is big enough on screen and it
    // overlaps no marker placed before it.
    type Marker = { el: HTMLDivElement; at: THREE.Vector3; size: number; text: boolean; w: number; h: number };
    let markers: Marker[] = [];
    const markerLayer = labelsRef.current!;
    const projected = new THREE.Vector3();

    function addMarkers(b: Building, level: Level, rooms: LocalRoom[], y: number) {
      type Item = { rank: number; size: number; at: [number, number]; icons: (IconName | "wc")[]; accessible?: boolean; name?: string; number?: string };
      const items: Item[] = [];
      for (const r of rooms) {
        const size = Math.sqrt(r.polys.reduce((a, p) => a + ringArea(p[0]) - p.slice(1).reduce((h, q) => h + ringArea(q), 0), 0));
        const number = (r.n ?? "").replace(/^[A-Za-z]+\s+/, "");
        const base = { size, at: r.at };
        if (r.t === ROOM_WASHROOM) {
          const gender = r.wash?.gender;
          const icon = gender === "Men" ? "men" : gender === "Women" ? "women" : gender === "All Gender" ? "allGender" : "wc";
          items.push({ ...base, rank: 2, icons: [icon], accessible: !!r.wash?.access?.startsWith("Accessible") });
        } else if (r.t === ROOM_STAIRS) items.push({ ...base, ...(/^L\d/i.test(number) ? { rank: 1, icons: ["elevator" as const] } : { rank: 6, icons: ["stairs" as const] }) });
        else if (r.t === ROOM_FOOD) items.push({ ...base, rank: 3, icons: ["food"], name: r.lbl });
        else if (r.t !== ROOM_CORRIDOR && (r.lbl || number)) items.push({ ...base, rank: r.lbl ? 4 : 5, icons: [], name: r.lbl, number });
      }
      // Point layers placed by building and level ("Level 1").
      for (const [key, icon, rank] of POINT_MARKERS) {
        for (const f of campus?.layers[key]?.features ?? []) {
          if (f.props.level === level.label && (b.polys ?? []).some((p) => inRing(p[0], f.at))) items.push({ rank, size: POINT_SIZE, at: f.at, icons: [icon] });
        }
      }
      items.sort((a, b) => a.rank - b.rank || b.size - a.size);

      for (const item of items) {
        const el = document.createElement("div");
        el.className = MARKER_CLASS;
        if (item.icons.length || item.accessible) {
          const row = document.createElement("div");
          row.className = "flex gap-0.5";
          for (const icon of item.icons) {
            const chip = document.createElement("span");
            chip.className = icon === "wc" ? CHIP_CLASS + " text-[8px] font-bold" : CHIP_CLASS;
            if (icon === "wc") chip.textContent = "WC";
            else chip.innerHTML = ICONS[icon];
            row.append(chip);
          }
          if (item.accessible) {
            const chip = document.createElement("span");
            chip.className = ACCESSIBLE_CHIP_CLASS;
            chip.innerHTML = ICONS.accessible;
            row.append(chip);
          }
          el.append(row);
        }
        if (item.name) {
          const name = document.createElement("div");
          name.className = "font-sans text-[11px] font-semibold";
          name.textContent = item.name;
          el.append(name);
        }
        if (item.number) el.append(item.number);
        markerLayer.append(el);
        const text = !!(item.name || item.number);
        // Icons in tiny rooms (lift shafts) show as soon as the point icons do.
        const size = text ? item.size : Math.max(item.size, POINT_SIZE);
        markers.push({ el, at: new THREE.Vector3(item.at[0], y, -item.at[1]), size, text, w: el.offsetWidth, h: el.offsetHeight });
      }
      placeMarkers();
    }
    function placeMarkers() {
      if (!markers.length) return;
      const { clientWidth: w, clientHeight: h } = mount!;
      const pxPerMetreAt1 = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const placed: number[][] = [];
      for (const m of markers) {
        projected.copy(m.at).project(camera);
        const x = ((projected.x + 1) / 2) * w, y = ((1 - projected.y) / 2) * h;
        const box = [x - m.w / 2 - 2, y - m.h / 2 - 1, x + m.w / 2 + 2, y + m.h / 2 + 1];
        const roomPx = (m.size * pxPerMetreAt1) / camera.position.distanceTo(m.at);
        const show =
          projected.z < 1 &&
          box[0] >= 0 && box[2] <= w && box[1] >= 0 && box[3] <= h &&
          roomPx >= (m.text ? Math.max(LABEL_MIN_ROOM_PX, m.w * 0.6) : ICON_MIN_ROOM_PX) &&
          !placed.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3]);
        if (show) {
          placed.push(box);
          m.el.style.transform = "translate(" + Math.round(box[0] + 2) + "px, " + Math.round(box[1] + 1) + "px)";
        }
        m.el.style.visibility = show ? "visible" : "hidden";
      }
    }

    function clearPlan() {
      planToken++;
      for (const m of plan.children as THREE.Mesh[]) m.geometry.dispose();
      plan.clear();
      markers.forEach((m) => m.el.remove());
      markers = [];
      cut.constant = NO_CUT;
      pit.visible = false;
      shownLevel = null;
      shownFloor = null;
      roomHighlight = [];
      if (selectedRoom) {
        selectedRoom = null;
        setRoom(null);
      }
    }

    function levelsOf(b: Building): Level[] {
      const ids = b.props.floors ?? [];
      return (campus?.floorList ?? []).filter((l) => ids.includes(l.id));
    }

    // Shows a floor of the selected building; resolves true once it's drawn.
    async function showLevel(levelId: string): Promise<boolean> {
      const mesh = selectedMesh;
      const b = mesh?.userData.building as Building | undefined;
      const levels = b ? levelsOf(b) : [];
      const level = levels.find((l) => l.id === levelId);
      if (!mesh || !b?.props.floorKey || !level) return false;
      clearPlan();
      const token = planToken;
      shownLevel = level.id;
      publish();
      setFloors({ levels, level: level.id });

      outlines ??= loadJson<FloorOutlines>(OUTLINES_URL, new Map()).catch((): FloorOutlines => ({}));
      let file: FloorFile, outline: LocalPolygon[] | undefined;
      try {
        [file, outline] = await Promise.all([loadJson(floorUrl(b.props.floorKey), floorFiles), outlines.then((o) => o[b.id]?.[level.id])]);
      } catch {
        return false; // aborted or missing: the building just stays whole
      }
      const floor = file.floors.find((f) => f.id === level.id);
      if (token !== planToken || !floor) return false;

      const y = floor.elev + mesh.position.y;
      cut.constant = y + CUT_SLACK;
      if (y < mesh.userData.groundTop && groundAt) {
        const ground = groundAt, base = mesh.position.y;
        mesh.userData.walls ??= wallsOf(mesh.geometry, (x, z) => ground(x, -z) - base);
        pit.geometry = mesh.userData.walls;
        pit.position.copy(mesh.position);
        pitFloor.constant = -y;
        pit.visible = true;
      }
      // The building as cut at this floor: the bands it passes through, or the footprint (basements).
      const cutBands = (massing[b.id] ?? []).filter((m) => m.elev <= floor.elev && floor.elev < m.top);
      const top = cutBands.length ? cutBands.flatMap((m) => m.polys) : (b.polys ?? []);
      // Without outlines, the cap doubles as the plate.
      planMesh(top, y + CAP_LIFT, outline ? capMaterial : slabMaterial).userData.owner = mesh;
      if (outline) planMesh(outline, y + SLAB_LIFT, slabMaterial);

      // Stairs and lifts filled so they're easy to find; every room as an outline.
      const stairs = floor.rooms.filter((r) => r.t === ROOM_STAIRS).flatMap((r) => r.polys);
      if (stairs.length) planMesh(stairs, y + SLAB_LIFT, stairsMaterial);
      plan.add(new THREE.LineSegments(roomOutlines(floor.rooms, y + ROOM_LIFT), roomLineMaterial));
      addMarkers(b, level, floor.rooms, y + ROOM_LIFT);
      shownFloor = { building: b, level, rooms: floor.rooms, y };
      return true;
    }

    // ── rooms ──
    // A room of the shown floor can be selected (clicked, or found by search): it's highlighted and
    // its details go to the info panel.
    let shownFloor: { building: Building; level: Level; rooms: LocalRoom[]; y: number } | null = null;
    let selectedRoom: LocalRoom | null = null;
    let roomHighlight: THREE.Object3D[] = [];

    function selectRoom(room: LocalRoom | null) {
      for (const o of roomHighlight) {
        plan.remove(o);
        (o as THREE.Mesh).geometry.dispose();
      }
      roomHighlight = [];
      selectedRoom = shownFloor && room;
      if (shownFloor && room) {
        const { building: b, level, y } = shownFloor;
        const outline = new THREE.LineSegments(ringLines(room.polys.flat(), () => y + ROOM_LIFT + 0.02), roomOutlineMaterial);
        plan.add(outline);
        roomHighlight = [planMesh(room.polys, y + SLAB_LIFT, roomFillMaterial), outline];
        setRoom({
          title: room.lbl ?? room.n ?? "Room",
          name: room.n,
          type: campus?.roomTypes[room.t],
          building: b.props.fullName ?? b.props.name ?? b.id,
          level: level.label,
          wash: room.wash ?? undefined,
          note: room.note,
          link: room.link,
        });
      } else setRoom(null);
      publish();
    }

    // The room under the pointer on the shown floor (the smallest, where rooms overlap).
    function roomAt(): LocalRoom | null {
      if (!shownFloor) return null;
      const p = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -shownFloor.y), new THREE.Vector3());
      if (!p) return null;
      const xy: [number, number] = [p.x, -p.z];
      let best: LocalRoom | null = null, bestArea = Infinity;
      for (const r of shownFloor.rooms) {
        if (r.t === ROOM_CORRIDOR) continue; // corridors aren't selectable
        for (const poly of r.polys) {
          if (!inRing(poly[0], xy) || poly.slice(1).some((h) => inRing(h, xy))) continue;
          const area = ringArea(poly[0]);
          if (area < bestArea) [best, bestArea] = [r, area];
        }
      }
      return best;
    }

    // Selects a building, opens a floor and selects a room on it by name, then flies there.
    async function goToRoom(buildingId: string, levelId: string, name: string) {
      const mesh = buildings.find((m) => (m.userData.building as Building).id === buildingId);
      if (!mesh) return;
      select(mesh);
      if (!(await showLevel(levelId)) || !shownFloor) return;
      const room = shownFloor.rooms.find((r) => r.n === name);
      if (!room) return;
      selectRoom(room);
      flyTo(new THREE.Vector3(room.at[0], shownFloor.y, -room.at[1]), ROOM_VIEW_DISTANCE);
    }
    function goToBuilding(buildingId: string) {
      const mesh = buildings.find((m) => (m.userData.building as Building).id === buildingId);
      if (!mesh) return;
      select(mesh);
      const b = mesh.userData.building as Building;
      flyTo(new THREE.Vector3(b.at[0], mesh.position.y, -b.at[1]), BUILDING_VIEW_DISTANCE);
    }

    // ── camera flights ──
    // Eases the camera to look at `target` from `distance`, keeping its heading and looking down
    // at least 40°. Any drag or scroll takes over.
    let flight: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; start: number } | null = null;
    function flyTo(target: THREE.Vector3, distance: number) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (dir.y < 0.64) {
        const h = Math.hypot(dir.x, dir.z) || 1;
        dir.set((dir.x / h) * 0.77, 0.64, (dir.z / h) * 0.77);
      }
      flight = { from: [camera.position.clone(), controls.target.clone()], to: [target.clone().addScaledVector(dir, distance), target.clone()], start: performance.now() };
    }
    function stepFlight() {
      if (!flight) return;
      const t = Math.min(1, (performance.now() - flight.start) / FLIGHT_MS);
      const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      camera.position.lerpVectors(flight.from[0], flight.to[0], k);
      controls.target.lerpVectors(flight.from[1], flight.to[1], k);
      if (t === 1) flight = null;
      publish();
    }

    // ── picking and selection ──
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverMesh: THREE.Mesh | null = null;
    let selectedMesh: THREE.Mesh | null = null;
    let downAt: [number, number] | null = null;

    const restyle = (m: THREE.Mesh | null) => {
      if (!m) return;
      const b = m.userData.building as Building;
      m.material = styleOf(b, m === selectedMesh, m === hoverMesh);
      (m.userData.edges as THREE.LineSegments).material = edgeStyleOf(m === selectedMesh, m === hoverMesh);
    };
    const aim = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const pick = (e: PointerEvent): THREE.Mesh | null => {
      aim(e);
      for (const hit of raycaster.intersectObjects([...buildings, ...plan.children], false)) {
        if (hit.object.userData.owner) return hit.object.userData.owner as THREE.Mesh;
        // The selected building above the cut is invisible.
        if (hit.object === selectedMesh && hit.point.y > cut.constant + 0.01) continue;
        if (buildings.includes(hit.object as THREE.Mesh)) return hit.object as THREE.Mesh;
      }
      return null;
    };

    function select(mesh: THREE.Mesh | null) {
      if (mesh === selectedMesh) return;
      const prev = selectedMesh;
      selectedMesh = mesh;
      restyle(prev);
      restyle(mesh);
      clearPlan();
      const b = mesh?.userData.building as Building | undefined;
      setSelected(b?.props ?? null);
      const levels = b?.props.floorKey ? levelsOf(b) : [];
      setFloors(null);
      if (levels.length) void showLevel(groundLevel(levels));
      publish();
    }

    // ── debug panel ──
    // Live while open: what's under the cursor, the last clicked point, the camera and selection.
    let debugOn = false;
    let cursor: DebugPoint | null = null;
    let pinned: DebugPoint | null = null;
    let queued = false;
    const nameOf = (b: Building) => (b.props.code ? `${b.props.name ?? b.props.fullName} (${b.props.code})` : (b.props.name ?? b.id));
    const toPoint = (v: THREE.Vector3, b?: Building): DebugPoint => {
      const [lon0, lat0] = campus?.origin ?? [0, 0];
      const x = v.x, y = -v.z;
      return { x, y, elev: v.y + ref, lon: lon0 + x / (M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180)), lat: lat0 + y / M_PER_DEG_LAT, building: b && nameOf(b) };
    };
    // The first visible surface under the pointer: a building, a floor plan, or the terrain.
    const probe = (e: PointerEvent): DebugPoint | null => {
      aim(e);
      let best: { at: THREE.Vector3; distance: number; b?: Building } | null = null;
      for (const hit of raycaster.intersectObjects([...buildings, ...plan.children], false)) {
        if (hit.object === selectedMesh && hit.point.y > cut.constant + 0.01) continue;
        const owner = buildings.includes(hit.object as THREE.Mesh) ? hit.object : selectedMesh;
        best = { at: hit.point, distance: hit.distance, b: owner?.userData.building };
        break;
      }
      // March the ray over the terrain heightfield, then bisect the step that crosses it.
      const { origin, direction } = raycaster.ray;
      const above = (t: number) => {
        const p = origin.clone().addScaledVector(direction, t);
        return p.y > groundAt!(p.x, -p.z);
      };
      if (groundAt && above(0)) {
        const step = 4, limit = best?.distance ?? 8000;
        for (let t = step; t <= limit; t += step) {
          if (above(t)) continue;
          let lo = t - step, hi = t;
          for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            if (above(mid)) lo = mid;
            else hi = mid;
          }
          best = { at: origin.clone().addScaledVector(direction, hi), distance: hi };
          break;
        }
      }
      return best && toPoint(best.at, best.b);
    };
    function publish() {
      if (!debugOn || queued || !campus) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!debugOn) return;
        const look = controls.target.clone().sub(camera.position);
        const b = selectedMesh?.userData.building as Building | undefined;
        setDebug({
          cursor,
          pinned,
          camera: {
            position: toPoint(camera.position),
            target: toPoint(controls.target),
            heading: (THREE.MathUtils.radToDeg(Math.atan2(look.x, -look.z)) + 360) % 360,
            pitch: THREE.MathUtils.radToDeg(Math.atan2(look.y, Math.hypot(look.x, look.z))),
            distance: look.length(),
          },
          building: b ? { label: nameOf(b), code: b.props.code, ground: dataGround(b), offset: offsets.get(b.props.code ?? "") ?? 0 } : null,
          level: shownLevel,
          room: selectedRoom?.n ?? null,
          adjustments: buildings.flatMap((m) => {
            const a = m.userData.building as Building;
            const offset = offsets.get(a.props.code ?? "");
            return offset ? [{ code: a.props.code!, label: nameOf(a), ground: dataGround(a), offset }] : [];
          }),
        });
      });
    }
    controls.addEventListener("change", publish);

    // A view link (#view=camera x,y,elev,target x,y,elev&b=CODE&l=LEVEL, local metres) restores it.
    function applyLink() {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const v = params.get("view")?.split(",").map(Number);
      if (v?.length === 6 && v.every(Number.isFinite)) {
        camera.position.set(v[0], v[2] - ref, -v[1]);
        controls.target.set(v[3], v[5] - ref, -v[4]);
        controls.update();
      }
      const code = params.get("b");
      const mesh = code && buildings.find((m) => (m.userData.building as Building).props.code === code);
      if (!mesh) return;
      const level = params.get("l"), room = params.get("r");
      if (level && room) void goToRoom((mesh.userData.building as Building).id, level, room);
      else {
        select(mesh);
        if (level) void showLevel(level);
      }
    }

    sceneApi.current = {
      deselect: () => select(null),
      clearRoom: () => selectRoom(null),
      find: (item) => (item.room ? void goToRoom(item.building, item.room.level, item.room.name) : goToBuilding(item.building)),
      showLevel: (id) => void showLevel(id),
      setDebug: (open) => {
        debugOn = open;
        publish();
      },
      clearPin: () => {
        pinned = null;
        publish();
      },
      setGroundOffset,
      setTheme: applyTheme,
      clearGroundOffsets: () => {
        const moved = buildings.filter((m) => offsets.has((m.userData.building as Building).props.code ?? ""));
        offsets.clear();
        saveOffsets(offsets);
        moved.forEach(placeBuilding);
        if (selectedMesh && moved.includes(selectedMesh) && shownLevel) void showLevel(shownLevel);
        publish();
      },
    };

    const onMove = (e: PointerEvent) => {
      if (e.buttons) return; // dragging the map
      if (debugOn) {
        cursor = probe(e);
        publish();
      }
      const hit = pick(e);
      if (tooltipRef.current) tooltipRef.current.style.transform = `translate(${e.offsetX + 14}px, ${e.offsetY + 14}px)`;
      if (hit === hoverMesh) return;
      const prev = hoverMesh;
      hoverMesh = hit;
      restyle(prev);
      restyle(hit);
      renderer.domElement.style.cursor = hit ? "pointer" : "";
      setHovered(hit ? (hit.userData.building as Building).props : null);
    };
    const onLeave = () => {
      const prev = hoverMesh;
      hoverMesh = null;
      restyle(prev);
      setHovered(null);
      cursor = null;
      publish();
    };
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
      flight = null;
    };
    const onWheel = () => { flight = null; };
    const onUp = (e: PointerEvent) => {
      // A click, not the end of a drag.
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      if (debugOn) pinned = probe(e);
      const hit = pick(e);
      if (hit && hit === selectedMesh && shownFloor) selectRoom(roomAt());
      else select(hit);
      publish();
    };
    const el = renderer.domElement;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: true });

    renderer.setAnimationLoop(() => {
      stepFlight();
      controls.update();
      renderer.render(scene, camera);
      placeMarkers();
    });

    const getJson = async <T,>(url: string): Promise<T> => {
      const r = await fetch(url, { signal: abort.signal });
      if (!r.ok) throw new Error(`${url} returned ${r.status}`);
      return r.json();
    };
    Promise.all([
      getJson<CampusBundle>(DATA_URL),
      // Optional: without it, buildings are plain footprint extrusions.
      getJson<Massing>(MASSING_URL).catch((): Massing => ({})),
      // Optional: without it, the campus is flat.
      getJson<Terrain>(TERRAIN_URL).catch(() => null),
      // Optional: without it, the ground has fills but no outlines.
      getJson<GroundLines>(GROUND_LINES_URL).catch((): GroundLines => ({})),
    ])
      .then(([data, extra, terrain, groundLines]) => {
        campus = data;
        setSearchItems(searchIndex(data));
        massing = extra;
        addCampus(data, terrain ?? flatTerrain(data), groundLines);
        applyLink();
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (abort.signal.aborted) return;
        setError(e.message);
        setStatus("error");
      });

    return () => {
      abort.abort();
      sceneApi.current = null;
      observer.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      controls.removeEventListener("change", publish);
      renderer.setAnimationLoop(null);
      controls.dispose();
      clearPlan();
      disposables.forEach((d) => d.dispose());
      buildings.forEach((m) => {
        m.geometry.dispose();
        (m.userData.edges as THREE.LineSegments).geometry.dispose();
        (m.userData.walls as THREE.BufferGeometry | undefined)?.dispose();
      });
      renderer.dispose();
      el.remove();
    };
  }, []);

  return (
    <div className={`${theme} relative h-full w-full overflow-hidden bg-[#eef0f2] dark:bg-[#0b0d10]`}>
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />

      <div
        ref={tooltipRef}
        className="pointer-events-none absolute left-0 top-0 rounded border border-white/10 bg-zinc-950/85 px-2 py-1 font-mono text-[11px] text-zinc-100 shadow"
        hidden={!hovered}
      >
        {hovered?.name}
        {hovered?.code && <span className="ml-1.5 text-sky-300">{hovered.code}</span>}
      </div>

      <div className="absolute left-4 top-4 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2">
      <SearchBox items={searchItems} onPick={(item) => sceneApi.current?.find(item)} />
      {room && (
        <aside className={`${PANEL} rounded-lg p-4 text-sm`}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold leading-snug text-zinc-950 dark:text-white">{room.title}</h2>
            <button onClick={() => sceneApi.current?.clearRoom()} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white" aria-label="Close room">
              ✕
            </button>
          </div>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-sky-700 dark:text-sky-300">
            {[room.title !== room.name && room.name, room.level].filter(Boolean).join(" · ")}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {room.type && (
              <>
                <dt className="text-zinc-500">Type</dt>
                <dd>{room.type}</dd>
              </>
            )}
            <dt className="text-zinc-500">Building</dt>
            <dd>
              <button onClick={() => sceneApi.current?.clearRoom()} className="text-left hover:underline">
                {room.building}
              </button>
            </dd>
            {room.wash?.gender && (
              <>
                <dt className="text-zinc-500">For</dt>
                <dd>{room.wash.gender}</dd>
              </>
            )}
            {room.wash?.access && !/^n\/a$/i.test(room.wash.access) && (
              <>
                <dt className="text-zinc-500">Access</dt>
                <dd>{room.wash.access}</dd>
              </>
            )}
          </dl>
          {room.note && <p className="mt-2 leading-relaxed">{room.note}</p>}
          {room.link && (
            <a href={room.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-sky-700 hover:underline dark:text-sky-300">
              Room page ↗
            </a>
          )}
        </aside>
      )}
      {selected && !room && (
        <aside className={`${PANEL} rounded-lg p-4 text-sm`}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold leading-snug text-zinc-950 dark:text-white">{selected.fullName ?? selected.name}</h2>
            <button onClick={() => sceneApi.current?.deselect()} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white" aria-label="Close">
              ✕
            </button>
          </div>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-sky-700 dark:text-sky-300">
            {[selected.code, selected.number && `Building ${selected.number}`].filter(Boolean).join(" · ")}
          </p>
          {selected.about && <p className="mt-2 leading-relaxed">{selected.about}</p>}
          {selected.link && (
            <a href={selected.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-sky-700 hover:underline dark:text-sky-300">
              Building page ↗
            </a>
          )}
        </aside>
      )}
      </div>

      {floors && (
        <div role="group" aria-label="Floor" className={`${PANEL} absolute bottom-4 left-4 flex gap-1 rounded-full p-1`}>
          {floors.levels.map((l) => (
            <button
              key={l.id}
              title={l.label}
              aria-pressed={l.id === floors.level}
              onClick={() => sceneApi.current?.showLevel(l.id)}
              className={`h-8 min-w-8 rounded-full px-2 font-mono text-sm tabular-nums transition-colors ${
                l.id === floors.level
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              }`}
            >
              {l.id}
            </button>
          ))}
        </div>
      )}

      <div className="absolute right-4 top-4 flex gap-2">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className={`${PANEL} grid h-7 w-7 place-items-center rounded-full text-xs hover:text-zinc-950 dark:hover:text-white`}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button
          onClick={() => setDebugOpen(!debugOpen)}
          title="Debug panel (`)"
          aria-pressed={debugOpen}
          className={`${PANEL} rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider hover:text-zinc-950 dark:hover:text-white`}
        >
          Debug
        </button>
      </div>
      {debugOpen && (
        <DebugPanel
          snapshot={debug}
          onClose={() => setDebugOpen(false)}
          onClearPin={() => sceneApi.current?.clearPin()}
          onGroundOffset={(m) => sceneApi.current?.setGroundOffset(m)}
          onClearGroundOffsets={() => sceneApi.current?.clearGroundOffsets()}
        />
      )}

      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center font-mono text-xs uppercase tracking-wider text-zinc-500">
          {status === "loading" ? "Loading campus…" : `Couldn't load the campus data: ${error}`}
        </div>
      )}
    </div>
  );
}
