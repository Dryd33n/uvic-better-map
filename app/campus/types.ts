// Shapes of the files in public/campus (the "local" format from uvic-campus-data).
// Coordinates are metres: x east, y north of the dataset origin. See uvic-campus-data/docs/DATA.md.

/** Flat ring: [x0, y0, x1, y1, ...], not closed. */
export type FlatRing = number[];
/** One polygon: outer ring first, then holes. */
export type LocalPolygon = FlatRing[];

export interface LocalFeature<P = Record<string, unknown>> {
  id: string;
  props: P;
  polys?: LocalPolygon[];
  lines?: number[][];
  at: [x: number, y: number];
  bbox?: [x0: number, y0: number, x1: number, y1: number];
}

export interface LocalLayer<P = Record<string, unknown>> {
  key: string;
  label: string;
  kind: "area" | "building" | "line" | "point" | "label";
  group: string | null;
  features: LocalFeature<P>[];
}

export interface BuildingProps {
  name?: string;
  fullName?: string;
  code?: string;
  type?: "Main" | "Secondary" | string;
  number?: string;
  link?: string;
  about?: string;
  levels?: string[];
  height?: number;
  floors?: string[];
  floorKey?: string;
  /** Ground level in metres above sea level, from the terrain DEM. */
  ground?: number;
  /** Per polygon, where the polygons are separate structures with their own ground (no floor plans). */
  grounds?: number[];
}

/**
 * extras/massing.json: each building's storeys where its floor plans reach, by building id, bottom
 * to top. Each band is a solid outline spanning elev to top (metres, top includes the roof); the
 * ground band covers the footprint, higher ones may float (skyways).
 */
export type Massing = Record<string, { level: string | null; elev: number; top: number; polys: LocalPolygon[] }[]>;

/** extras/floorOutlines.json: each level's outline (its rooms unioned), by building id and level id. */
export type FloorOutlines = Record<string, Record<string, LocalPolygon[]>>;

/** extras/groundLines.json: each group of ground layers' outlines (unioned, footprints cut away), as rings. */
export type GroundLines = Record<string, FlatRing[]>;

/** extras/walkGraph.json: the walking network, noded. Flat [x0, y0, x1, y1, ...] local metres and node index pairs. */
export interface WalkGraph {
  nodes: number[];
  edges: number[];
}

/**
 * extras/terrain.json: a lidar ground heightfield. heights[j * nx + i] is the ground at local
 * (x0 + i·cell, y0 + j·cell) in decimetres above sea level; j = 0 is the south edge.
 */
export interface Terrain {
  source: string;
  licence: string;
  cell: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Ground at the origin, metres: the scene's zero. */
  ref: number;
  heights: number[];
}

export interface Level {
  id: string;
  label: string;
  elev: number;
}

/** A room in floors/<BUILDING>.local.json (short keys: n name, t type). */
export interface LocalRoom {
  id: string;
  /** Room type: 0 corridor, 1 classroom, 2 washroom, 3 food, 4 stair or lift, 5 other. */
  t: number;
  n?: string;
  polys: LocalPolygon[];
  at: [x: number, y: number];
  lbl?: string;
  note?: string;
  link?: string;
  /** Washrooms: who it's for ("Men", "Women", "All Gender") and access ("Accessible", ...). */
  wash?: { gender?: string | null; access?: string | null };
}

/** floors/<BUILDING>.local.json: every level of one building, bottom to top. */
export interface FloorFile {
  building: string;
  name: string;
  floors: (Level & { rooms: LocalRoom[] })[];
}

/** A room in the bundle's search index (no corridors, stairs or lifts). */
export type RoomEntry = [name: string, building: string, level: string, type: number, label?: string];

export interface CampusBundle {
  origin: [lon: number, lat: number];
  storey: number;
  floorList: Level[];
  /** Room type names by type number ("1": "Classroom"). */
  roomTypes: Record<string, string>;
  rooms: RoomEntry[];
  layers: Record<string, LocalLayer>;
}
