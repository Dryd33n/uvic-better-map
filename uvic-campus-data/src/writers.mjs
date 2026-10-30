// Output writers. A writer is (dataset, helpers) => { files, layers?, floors?, bundles? } where
//   files:   { 'relative/path.json': object | string }
//   layers:  { layerKey: path }     recorded in the manifest as layers[key].files[format]
//   floors:  { buildingId: path }   recorded as indoor.buildings[id].files[format]
//   bundles: { name: path }         recorded as bundles[format]
// Built-in formats: 'geojson' and 'local'. A custom writer is any function with that shape;
// set fn.formatName to name it in the manifest.

import { geojsonRing } from './geometry.mjs';

// ── GeoJSON (RFC 7946, WGS84) ───────────────────────────────────────────────
export function toGeoJSONGeometry(f) {
  const g = f.geom;
  if (g.type === 'point') return { type: 'Point', coordinates: g.ll };
  if (g.type === 'line') {
    const lines = g.lines.map((l) => l.ll);
    return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
  }
  const polys = g.polys.map((p) => [geojsonRing(p.outer.ll, true), ...p.holes.map((h) => geojsonRing(h.ll, false))]);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

export function toGeoJSONFeature(f, extra = {}) {
  const properties = { id: f.id, ...f.props, ...extra };
  if (f.geom.type !== 'point' && f.at) properties.labelPoint = f.at.ll;
  const out = { type: 'Feature', id: f.id, properties, geometry: toGeoJSONGeometry(f) };
  if (f.bbox) out.bbox = f.bbox.ll;
  return out;
}

function roomExtras(ds, b, levelId) {
  const L = ds.indoor.levels.find((l) => l.id === levelId);
  return { building: b.id, buildingName: b.name, level: levelId, levelLabel: L?.label, elev: L?.elev };
}

export function geojson(ds) {
  const files = {}, layers = {}, floors = {};
  for (const [key, L] of Object.entries(ds.layers)) {
    const path = `layers/${key}.geojson`;
    files[path] = { type: 'FeatureCollection', name: key, features: L.features.map((f) => toGeoJSONFeature(f)) };
    layers[key] = path;
  }
  for (const b of Object.values(ds.indoor?.buildings || {})) {
    const path = `floors/${b.id}.geojson`;
    const features = b.levels.flatMap(({ id: lv, rooms }) => rooms.map((r) => toGeoJSONFeature(r, roomExtras(ds, b, lv))));
    files[path] = { type: 'FeatureCollection', name: `floors:${b.id}`, building: b.id, levels: b.levels.map((l) => l.id), features };
    floors[b.id] = path;
  }
  return { files, layers, floors };
}

// ── Local metres (compact, for 3D) ───────────────────────────────────────────
const flat = (pts) => pts.flat();

export function toLocalFeature(f) {
  const out = { id: f.id, props: f.props };
  const g = f.geom;
  if (g.type === 'polygon') out.polys = g.polys.map((p) => [flat(p.outer.xy), ...p.holes.map((h) => flat(h.xy))]);
  if (g.type === 'line') out.lines = g.lines.map((l) => flat(l.xy));
  out.at = f.at.xy;
  if (f.bbox) out.bbox = f.bbox.xy;
  return out;
}

// Rooms use short keys to keep floor files small: n name, t type, lbl label, wash washroom.
export function toLocalRoom(r) {
  const p = r.props, out = { id: r.id, t: p.type ?? 5 };
  if (p.name) out.n = p.name;
  out.polys = r.geom.polys.map((q) => [flat(q.outer.xy), ...q.holes.map((h) => flat(h.xy))]);
  out.at = r.at.xy;
  if (p.label && String(p.label).toUpperCase() !== String(p.name || '').toUpperCase()) out.lbl = p.label;
  if (p.note) out.note = p.note;
  if (p.link) out.link = p.link;
  if (p.washroom) out.wash = p.washroom;
  return out;
}

export function local(ds) {
  const files = {}, layers = {}, floors = {};
  const localLayers = {};
  const indoorIds = new Set(Object.keys(ds.indoor?.buildings || {}));
  for (const [key, L] of Object.entries(ds.layers)) {
    const features = L.features.map((f) => {
      const lf = toLocalFeature(f);
      // Aliases the 3D template reads: which levels exist and which floor file to load.
      if (key === ds.config.indoor?.buildingsLayer && indoorIds.has(f.id)) lf.props = { ...f.props, floors: f.props.levels, floorKey: f.id };
      return lf;
    });
    const layer = { key, label: L.label, kind: L.kind, group: L.group, features };
    const path = `layers/${key}.local.json`;
    files[path] = layer;
    layers[key] = path;
    localLayers[key] = layer;
  }
  for (const b of Object.values(ds.indoor?.buildings || {})) {
    const path = `floors/${b.id}.local.json`;
    files[path] = {
      building: b.id, name: b.name,
      floors: b.levels.map(({ id: lv, rooms }) => {
        const L = ds.indoor.levels.find((l) => l.id === lv);
        return { id: lv, label: L.label, elev: L.elev, rooms: rooms.map(toLocalRoom) };
      }),
    };
    floors[b.id] = path;
  }
  // One-file bundle of every outdoor layer plus a compact room index: what templates/three-viewer loads.
  // Each room is [name, building, level, type], plus its label ("Vertigo") when it has one.
  const rooms = roomIndex(ds).filter((r) => r.type !== 0 && r.type !== 4).map((r) => [r.name, r.building, r.level, r.type, ...(r.label ? [r.label] : [])]);
  files['campus.local.json'] = {
    source: ds.config.source?.title, sourceUrl: ds.config.source?.url, scrapedAt: ds.builtAt,
    origin: ds.config.origin, units: 'metres east (x) and north (y) of origin',
    roomTypes: ds.indoor?.roomTypes || {}, storey: ds.indoor?.storey, floorList: ds.indoor?.levels || [],
    rooms, layers: localLayers,
  };
  return { files, layers, floors, bundles: { campus: 'campus.local.json' } };
}

// ── Shared ───────────────────────────────────────────────────────────────────
// Every named room, flat, for search. Written to rooms.json whatever the formats.
export function roomIndex(ds) {
  const out = [];
  for (const b of Object.values(ds.indoor?.buildings || {})) {
    for (const { id: lv, rooms } of b.levels) {
      for (const r of rooms) {
        if (!r.props.name) continue;
        const e = { id: r.id, name: r.props.name, building: b.id, buildingName: b.name, level: lv, type: r.props.type ?? 5, typeName: r.props.typeName, labelPoint: r.at.ll };
        if (r.props.label && r.props.label !== r.props.name) e.label = r.props.label;
        if (r.props.washroom) e.washroom = r.props.washroom;
        out.push(e);
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export const writers = { geojson, local };
