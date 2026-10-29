// Dataset -> files. Runs every configured writer, then adds manifest.json, rooms.json and extras/.
import { writers as builtIn, roomIndex } from './writers.mjs';

export const SCHEMA_VERSION = 1;

const GEOMETRY = { area: 'Polygon', building: 'Polygon', line: 'LineString', point: 'Point', label: 'Point' };

function fieldList(features) {
  const seen = new Map();
  for (const f of features) for (const [k, v] of Object.entries(f.props)) {
    const t = Array.isArray(v) ? 'array' : typeof v;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(t);
  }
  return [...seen].map(([name, types]) => ({ name, type: [...types].join('|') }));
}

export function renderOutputs(ds, { writers = builtIn } = {}) {
  const config = ds.config;
  const files = {};
  const formats = config.output?.formats || ['geojson', 'local'];

  // Overall extent, lon/lat.
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const L of Object.values(ds.layers)) for (const f of L.features) {
    const b = f.bbox?.ll || [f.at.ll[0], f.at.ll[1], f.at.ll[0], f.at.ll[1]];
    w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]);
  }

  const manifest = {
    name: config.name || 'campus-data',
    schemaVersion: SCHEMA_VERSION,
    builtAt: ds.builtAt,
    source: config.source || null,
    crs: {
      lngLat: 'EPSG:4326, [longitude, latitude] (GeoJSON, RFC 7946)',
      local: { origin: config.origin, units: 'metres', axes: 'x east, y north', projection: 'equirectangular about origin' },
    },
    bbox: [w, s, e, n],
    formats: [],
    layers: {},
    indoor: null,
    rooms: null,
    bundles: {},
    extras: {},
  };

  for (const [key, L] of Object.entries(ds.layers)) {
    manifest.layers[key] = { label: L.label, kind: L.kind, group: L.group, geometry: GEOMETRY[L.kind] || null, count: L.features.length, fields: fieldList(L.features), files: {} };
  }

  if (ds.indoor) {
    const buildings = {};
    for (const b of Object.values(ds.indoor.buildings)) {
      buildings[b.id] = { name: b.name, levels: b.levels.map((l) => l.id), rooms: b.levels.reduce((a, l) => a + l.rooms.length, 0), files: {} };
    }
    manifest.indoor = {
      buildingsLayer: config.indoor.buildingsLayer,
      storey: ds.indoor.storey,
      levels: ds.indoor.levels,
      roomTypes: ds.indoor.roomTypes,
      roomFields: fieldList(Object.values(ds.indoor.buildings).flatMap((b) => b.levels.flatMap((l) => l.rooms))),
      buildings,
    };
  }

  for (const fmt of formats) {
    const fn = typeof fmt === 'function' ? fmt : writers[fmt];
    if (!fn) throw new Error(`Unknown output format "${fmt}". Built in: ${Object.keys(writers).join(', ')}`);
    const name = typeof fmt === 'function' ? fmt.formatName || fmt.name || 'custom' : fmt;
    const out = fn(ds, { roomIndex }) || {};
    Object.assign(files, out.files || {});
    for (const [k, p] of Object.entries(out.layers || {})) if (manifest.layers[k]) manifest.layers[k].files[name] = p;
    for (const [id, p] of Object.entries(out.floors || {})) if (manifest.indoor?.buildings[id]) manifest.indoor.buildings[id].files[name] = p;
    for (const [k, p] of Object.entries(out.bundles || {})) (manifest.bundles[name] ??= {})[k] = p;
    manifest.formats.push(name);
  }

  if (ds.indoor) {
    const idx = roomIndex(ds);
    files['rooms.json'] = idx;
    manifest.rooms = { count: idx.length, file: 'rooms.json' };
  }
  for (const [name, data] of Object.entries(ds.extras)) {
    const path = `extras/${name}.json`;
    files[path] = data;
    manifest.extras[name] = path;
  }
  if (ds.warnings.length) manifest.warnings = ds.warnings;
  files['manifest.json'] = manifest;
  return { files, manifest };
}
