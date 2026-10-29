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
}

/**
 * extras/overhangs.json: parts of buildings outside the ground-floor footprint (skyways,
 * overhangs), by building id. Each band is a solid outline spanning elev to top (metres).
 */
export type Overhangs = Record<string, { level: string; elev: number; top: number; polys: LocalPolygon[] }[]>;

/** extras/floorOutlines.json: each level's outline (its rooms unioned), by building id and level id. */
export type FloorOutlines = Record<string, Record<string, LocalPolygon[]>>;

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
}

/** floors/<BUILDING>.local.json: every level of one building, bottom to top. */
export interface FloorFile {
  building: string;
  name: string;
  floors: (Level & { rooms: LocalRoom[] })[];
}

export interface CampusBundle {
  origin: [lon: number, lat: number];
  storey: number;
  floorList: Level[];
  layers: Record<string, LocalLayer>;
}
