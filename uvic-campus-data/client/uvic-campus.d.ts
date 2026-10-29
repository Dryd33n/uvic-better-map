// Types for uvic-campus-data's client and dataset files (schemaVersion 1).

export type LngLat = [lon: number, lat: number];
export type XY = [x: number, y: number];
export type BBox = [west: number, south: number, east: number, north: number];

// ── GeoJSON (RFC 7946) ──
export type Geometry =
  | { type: 'Point'; coordinates: LngLat }
  | { type: 'LineString'; coordinates: LngLat[] }
  | { type: 'MultiLineString'; coordinates: LngLat[][] }
  | { type: 'Polygon'; coordinates: LngLat[][] }
  | { type: 'MultiPolygon'; coordinates: LngLat[][][] };

export interface Feature<P = Record<string, unknown>> {
  type: 'Feature';
  id: string;
  properties: P & { id: string; labelPoint?: LngLat };
  geometry: Geometry;
  bbox?: BBox;
}
export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  name: string;
  features: Feature<P>[];
}

// ── Properties by layer (the defaults in config/sources.mjs) ──
export interface BuildingProps {
  name?: string; fullName?: string; code?: string; type?: 'Main' | 'Secondary' | string;
  number?: string; link?: string; photo?: string; about?: string;
  /** Indoor levels this building has, bottom to top. Absent when there's no floor data. */
  levels?: string[];
  /** Metres, from floor count at `indoor.storey` per storey. Absent without floor data. */
  height?: number;
}
export interface PointProps {
  name?: string; building?: string; level?: string; where?: string; room?: string;
  about?: string; lot?: string; bank?: string; kind?: string; category?: string; access?: string;
  [key: string]: unknown;
}
export interface Washroom { gender?: string; access?: string; features?: string }
export interface RoomProps {
  name?: string;
  /** Room type code, see manifest.indoor.roomTypes (0 corridor, 1 classroom, 2 washroom, 3 food, 4 stair/lift, 5 other). */
  type: number;
  typeName?: string;
  label?: string; note?: string; link?: string;
  washroom?: Washroom;
  building: string; buildingName: string;
  level: string; levelLabel: string; elev: number;
}

// ── Files ──
export interface Level { id: string; label: string; elev: number }
export interface FieldInfo { name: string; type: string }
export interface LayerInfo {
  label: string;
  kind: 'area' | 'building' | 'line' | 'point' | 'label';
  group: string | null;
  geometry: 'Polygon' | 'LineString' | 'Point' | null;
  count: number;
  fields: FieldInfo[];
  /** format name -> path relative to the dataset folder */
  files: Record<string, string>;
}
export interface Manifest {
  name: string;
  schemaVersion: 1;
  builtAt: string;
  source: { title: string; url: string; webmap?: string } | null;
  crs: { lngLat: string; local: { origin: LngLat; units: 'metres'; axes: string; projection: string } };
  bbox: BBox;
  formats: string[];
  layers: Record<string, LayerInfo>;
  indoor: null | {
    buildingsLayer: string;
    storey: number;
    levels: Level[];
    roomTypes: Record<string, string>;
    roomFields: FieldInfo[];
    buildings: Record<string, { name: string; levels: string[]; rooms: number; files: Record<string, string> }>;
  };
  rooms: null | { count: number; file: string };
  bundles: Record<string, Record<string, string>>;
  extras: Record<string, string>;
  warnings?: string[];
}
export interface RoomIndexEntry {
  id: string; name: string; building: string; buildingName: string; level: string;
  type: number; typeName?: string; labelPoint: LngLat; label?: string; washroom?: Washroom;
}

// ── 'local' format (metres east/north of manifest.crs.local.origin) ──
export interface LocalFeature<P = Record<string, unknown>> {
  id: string; props: P;
  /** polygons: [[outer, ...holes]] with each ring a flat [x0, y0, x1, y1, ...] */
  polys?: number[][][];
  /** lines: flat [x0, y0, x1, y1, ...] per part */
  lines?: number[][];
  at: XY;
  bbox?: [number, number, number, number];
}
export interface LocalRoom {
  id: string; n?: string; t: number; polys: number[][][]; at: XY;
  lbl?: string; note?: string; link?: string; wash?: Washroom;
}
export interface LocalFloorPlan { building: string; name: string; floors: (Level & { rooms: LocalRoom[] })[] }

// ── Client ──
export interface SearchResult {
  kind: 'building' | 'room' | 'point';
  label: string;
  detail: string;
  score: number;
  building?: string;
  level?: string;
  layer?: string;
  feature?: Feature;
  room?: RoomIndexEntry;
}

export declare function openCampus(base?: string, options?: { load?: (path: string) => Promise<any> }): Promise<Campus>;
export declare function pointInGeometry(pt: LngLat, geometry: Geometry): boolean;

export declare class Campus {
  readonly manifest: Manifest;
  readonly levels: Level[];
  readonly roomTypes: Record<string, string>;
  readonly bbox: BBox;
  layerKeys(filter?: { group?: string; kind?: LayerInfo['kind'] }): string[];
  layerInfo(key: string): LayerInfo;
  url(path: string): string | null;
  layerUrl(key: string, format?: string): string | null;
  file<T = any>(path: string): Promise<T>;

  layer(key: string): Promise<FeatureCollection>;
  layer(key: string, options: { format: 'geojson' }): Promise<FeatureCollection>;
  layer(key: string, options: { format: 'local' }): Promise<{ key: string; label: string; kind: string; group: string | null; features: LocalFeature[] }>;
  features(key: string): Promise<Feature[]>;

  buildings(): Promise<Feature<BuildingProps>[]>;
  building(query: string | number): Promise<Feature<BuildingProps> | null>;
  buildingAt(lngLat: LngLat): Promise<Feature<BuildingProps> | null>;
  buildingsWithFloors(): string[];
  buildingLevels(id: string): Level[];

  floorPlan(buildingId: string, options?: { level?: string | null; format?: 'geojson' }): Promise<FeatureCollection<RoomProps> | null>;
  floorPlan(buildingId: string, options: { level?: string | null; format: 'local' }): Promise<LocalFloorPlan | null>;
  rooms(): Promise<RoomIndexEntry[]>;
  room(query: string): Promise<RoomIndexEntry | null>;
  roomFeature(query: string | RoomIndexEntry): Promise<Feature<RoomProps> | null>;

  search(query: string, options?: { limit?: number; kinds?: SearchResult['kind'][]; layers?: string[] }): Promise<SearchResult[]>;

  toLocal(lngLat: LngLat): XY;
  toLngLat(xy: XY): LngLat;
  distance(a: LngLat, b: LngLat): number;
  directionsUrl(lngLat: LngLat, mode?: 'walking' | 'bicycling' | 'transit' | 'driving'): string;
}
