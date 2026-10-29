// uvic-campus-data client: read a built dataset from any web app (or Node 18+).
// One file, no dependencies. Copy it into your app or import 'uvic-campus-data/client'.
//
//   import { openCampus } from './uvic-campus.mjs';
//   const campus = await openCampus('https://your.host/dist/');
//   const ecs = await campus.building('ECS');
//   const plan = await campus.floorPlan('ECS');            // GeoJSON rooms, all levels
//   const hits = await campus.search('ecs 125');
//
// Everything is fetched lazily and cached. See docs/CLIENT.md for the full API.
// In Node, use client/node.mjs (openCampusFromDir) to read from a folder.

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const squash = (s) => norm(s).replace(/[^a-z0-9]/g, '');

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when [lon, lat] falls inside a GeoJSON Polygon or MultiPolygon geometry. */
export function pointInGeometry(pt, geometry) {
  if (!geometry) return false;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some(([outer, ...holes]) => pointInRing(pt, outer) && !holes.some((h) => pointInRing(pt, h)));
}

/**
 * Open a dataset.
 * @param {string} base  URL of the dataset folder (the one holding manifest.json). Relative URLs resolve against the page.
 * @param {{ load?: (path: string) => Promise<any> }} [options]  custom loader, e.g. fileLoader('dist') in Node
 */
export async function openCampus(base = './dist/', { load } = {}) {
  let baseUrl = null;
  if (!load) {
    const root = typeof document !== 'undefined' ? document.baseURI : undefined;
    baseUrl = new URL(base.endsWith('/') ? base : `${base}/`, root);
    load = async (path) => {
      const r = await fetch(new URL(path, baseUrl));
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    };
  }
  const manifest = await load('manifest.json');
  if (manifest.schemaVersion !== 1) console.warn(`uvic-campus: dataset schema v${manifest.schemaVersion}, this client expects v1`);
  return new Campus(manifest, load, baseUrl);
}

export class Campus {
  constructor(manifest, load, baseUrl) {
    this.manifest = manifest;
    this._load = load;
    this._baseUrl = baseUrl;
    this._cache = new Map();
    const [lon0, lat0] = manifest.crs.local.origin;
    this._mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    this._my = 110574;
    this._origin = [lon0, lat0];
  }

  // ── metadata ──
  /** Indoor levels, bottom to top: [{ id: '1', label: 'Level 1', elev: 0 }, ...] */
  get levels() { return this.manifest.indoor?.levels || []; }
  /** Room type code -> name, e.g. { 1: 'Classroom', 2: 'Washroom' } */
  get roomTypes() { return this.manifest.indoor?.roomTypes || {}; }
  /** [west, south, east, north] of everything in the dataset. */
  get bbox() { return this.manifest.bbox; }
  /** Layer keys, optionally filtered by group or kind: layerKeys({ group: 'amenities' }) */
  layerKeys({ group, kind } = {}) {
    return Object.entries(this.manifest.layers).filter(([, l]) => (!group || l.group === group) && (!kind || l.kind === kind)).map(([k]) => k);
  }
  layerInfo(key) {
    const info = this.manifest.layers[key];
    if (!info) throw new Error(`Unknown layer "${key}". Known: ${Object.keys(this.manifest.layers).join(', ')}`);
    return info;
  }
  /** Absolute URL of a dataset file, for libraries that want a URL (MapLibre sources, workers). Null with a custom loader. */
  url(path) { return this._baseUrl ? new URL(path, this._baseUrl).href : null; }
  /** URL of a layer file: campus.layerUrl('buildings') */
  layerUrl(key, format = 'geojson') { return this.url(this.layerInfo(key).files[format]); }

  async file(path) {
    if (!this._cache.has(path)) {
      const p = this._load(path);
      this._cache.set(path, p);
      p.catch(() => this._cache.delete(path));
    }
    return this._cache.get(path);
  }

  // ── layers ──
  /** A layer as a GeoJSON FeatureCollection (default) or the 'local' metre format. */
  async layer(key, { format = 'geojson' } = {}) {
    const path = this.layerInfo(key).files[format];
    if (!path) throw new Error(`Layer "${key}" wasn't built in "${format}" format (has: ${Object.keys(this.layerInfo(key).files).join(', ')})`);
    return this.file(path);
  }
  async features(key) { return (await this.layer(key)).features; }

  // ── buildings ──
  async buildings() { return this.features(this.manifest.indoor?.buildingsLayer || 'buildings'); }

  /** Find a building by id, code (ECS), number (233) or name ("Clearihue"). Returns a GeoJSON Feature or null. */
  async building(query) {
    const all = await this.buildings();
    const q = norm(query), s = squash(query);
    return all.find((f) => norm(f.id) === q)
      || all.find((f) => norm(f.properties.code) === q || norm(f.properties.number) === q)
      || all.find((f) => squash(f.properties.name) === s || squash(f.properties.fullName) === s)
      || all.find((f) => squash(f.properties.name).includes(s) || squash(f.properties.fullName).includes(s))
      || null;
  }

  /** The building containing [lon, lat], or null. */
  async buildingAt(lngLat) {
    return (await this.buildings()).find((f) => pointInGeometry(lngLat, f.geometry)) || null;
  }

  /** Building ids that have indoor floor plans. */
  buildingsWithFloors() { return Object.keys(this.manifest.indoor?.buildings || {}); }

  /** Levels that exist in one building: [{ id, label, elev }] bottom to top. */
  buildingLevels(id) {
    const b = this.manifest.indoor?.buildings?.[id];
    return b ? this.levels.filter((l) => b.levels.includes(l.id)) : [];
  }

  // ── floors and rooms ──
  /**
   * A building's floor plan. GeoJSON: every room on every level, with properties.level.
   * Pass { level: '2' } to get one level, { format: 'local' } for the metre format.
   */
  async floorPlan(buildingId, { level = null, format = 'geojson' } = {}) {
    const b = this.manifest.indoor?.buildings?.[buildingId];
    if (!b) return null;
    const path = b.files[format];
    if (!path) throw new Error(`Floor plans weren't built in "${format}" format`);
    const data = await this.file(path);
    if (level == null) return data;
    if (format === 'geojson') return { ...data, features: data.features.filter((f) => f.properties.level === String(level)) };
    return { ...data, floors: data.floors.filter((f) => f.id === String(level)) };
  }

  /** The room index: every named room with building, level, type and label point. */
  async rooms() { return this.manifest.rooms ? this.file(this.manifest.rooms.file) : []; }

  /** Find one room by its number or id: room('ECS 125'), room('ecs125'), room('ECS:1:ECS_125'). */
  async room(query) {
    const s = squash(query);
    return (await this.rooms()).find((r) => squash(r.name) === s || r.id === query) || null;
  }

  /** The room's full GeoJSON feature (polygon and all properties) from its building's floor plan. */
  async roomFeature(query) {
    const r = typeof query === 'object' ? query : await this.room(query);
    if (!r) return null;
    const plan = await this.floorPlan(r.building);
    return plan?.features.find((f) => f.id === r.id) || null;
  }

  // ── search ──
  /**
   * Search buildings, rooms and point layers. Returns ranked results:
   *   [{ kind: 'building'|'room'|'point', label, detail, score, building?, level?, layer?, feature?, room? }]
   * options: { limit = 10, kinds = ['building', 'room', 'point'], layers = all point layers }
   */
  async search(query, { limit = 10, kinds = ['building', 'room', 'point'], layers } = {}) {
    const q = norm(query);
    if (!q) return [];
    const tokens = q.split(' ');
    const sq = squash(query);
    const out = [];
    const score = (label, hay, base) => {
      if (!tokens.every((t) => hay.includes(t) || hay.replace(/[^a-z0-9]/g, '').includes(t))) return null;
      const l = norm(label);
      return base + (l === q || squash(label) === sq ? 0 : l.startsWith(q) ? 10 : l.includes(q) ? 20 : 30);
    };
    if (kinds.includes('building')) {
      for (const f of await this.buildings()) {
        const p = f.properties, label = p.name || p.fullName || f.id;
        const hay = norm([label, p.fullName, p.code, p.number].filter(Boolean).join(' '));
        let s = score(label, hay, p.type === 'Secondary' ? 5 : 0);
        if (p.code && norm(p.code) === q) s = -10;
        if (s != null) out.push({ kind: 'building', label, detail: [p.code, p.number && `Building ${p.number}`].filter(Boolean).join(' · '), score: s, building: f.id, feature: f });
      }
    }
    if (kinds.includes('room') && this.manifest.rooms) {
      for (const r of await this.rooms()) {
        const hay = norm(`${r.name} ${r.label || ''} ${r.buildingName} ${r.typeName || ''}`);
        const s = score(r.name, hay, 3);
        if (s != null) out.push({ kind: 'room', label: r.name, detail: [r.buildingName, this.levels.find((l) => l.id === r.level)?.label, r.typeName].filter(Boolean).join(' · '), score: s, building: r.building, level: r.level, room: r });
      }
    }
    if (kinds.includes('point')) {
      const keys = layers || this.layerKeys({ kind: 'point' });
      for (const key of keys) {
        const info = this.layerInfo(key);
        for (const f of await this.features(key)) {
          const p = f.properties;
          const label = p.name || p.building || info.label;
          const hay = norm(`${info.label} ${Object.values(p).filter((v) => typeof v === 'string').join(' ')}`);
          const s = score(label, hay, 6);
          if (s != null) out.push({ kind: 'point', label, detail: [info.label, p.building !== label && p.building, p.level || p.where].filter(Boolean).join(' · '), score: s, layer: key, feature: f });
        }
      }
    }
    return out.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, undefined, { numeric: true })).slice(0, limit);
  }

  // ── coordinates ──
  /** [lon, lat] -> [x, y] metres east/north of the dataset origin (the 'local' frame). */
  toLocal([lon, lat]) { return [(lon - this._origin[0]) * this._mx, (lat - this._origin[1]) * this._my]; }
  /** [x, y] local metres -> [lon, lat]. */
  toLngLat([x, y]) { return [this._origin[0] + x / this._mx, this._origin[1] + y / this._my]; }
  /** Straight-line distance in metres between two [lon, lat] points. */
  distance(a, b) { const p = this.toLocal(a), q = this.toLocal(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); }
  /** Google Maps walking directions to [lon, lat]. */
  directionsUrl([lon, lat], mode = 'walking') {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=${mode}`;
  }
}
