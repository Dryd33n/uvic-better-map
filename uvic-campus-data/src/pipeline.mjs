// Build pipeline: config -> in-memory dataset. Pure (no fs), runs in Node or a browser.
//
//   const ds = await buildDataset(config, { fetchJson, readJson, log })
//
// The dataset is what enrichers and writers receive:
//   ds.layers[key]  = { key, label, kind, group, features: Feature[] }
//   ds.indoor       = { levels, roomTypes, storey, buildings: { [buildingId]: { id, name, levels: [{ id, rooms: Room[] }] } } } | null
//                     (levels are arrays, bottom to top: object keys would reorder '1' before 'M')
//   ds.extras       = { [name]: anything }   (written to extras/<name>.json)
//
// Feature: { id, layer, props, geom, at, bbox }
//   geom = { type: 'polygon', polys: [{ outer: {ll, xy}, holes: [...] }] }
//        | { type: 'line', lines: [{ ll, xy }] }
//        | { type: 'point', ll, xy }
//   at   = { ll: [lon,lat], xy: [x,y] }   label point (polygons), midpoint (lines) or the point itself
//   bbox = { ll: [w,s,e,n], xy: [x0,y0,x1,y1] }  (polygons and lines)
// Room: a Feature with `building` and `level` set, layer 'rooms'.

import { makeProjector, assemblePolygons, bboxOfPolys, labelPoint, pointInPolys, round, cleanPaths, bboxOfPoints } from './geometry.mjs';
import { loadSource } from './loaders.mjs';

const SKIP_ATTRS = /^(OBJECTID|FID|GlobalID|Shape_|Shape__|SHAPE)/i;

export function cleanValue(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') { const t = v.trim(); return t ? t : undefined; }
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined;
  return v;
}

// spec: { outName: 'SourceField' | ['A', 'B'] | (attrs, raw) => value } | '*'
export function mapFields(attrs, spec, raw) {
  const out = {};
  if (spec === '*') {
    for (const [k, v] of Object.entries(attrs)) { if (SKIP_ATTRS.test(k)) continue; const c = cleanValue(v); if (c !== undefined) out[k] = c; }
    return out;
  }
  for (const [k, src] of Object.entries(spec || {})) {
    let v;
    if (typeof src === 'function') v = cleanValue(src(attrs, raw));
    else for (const s of Array.isArray(src) ? src : [src]) { v = cleanValue(attrs[s]); if (v !== undefined) break; }
    if (v !== undefined) out[k] = typeof v === 'number' || typeof v === 'boolean' || typeof v === 'object' ? v : String(v);
  }
  return out;
}

export const normName = (s) => String(s || '').toLowerCase().replace(/\bbuilding\b/g, '').replace(/[^a-z0-9]/g, '');
export const normRoom = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

export function makeFeature(raw, { kind, layer, fields, id: idFn }, ctx) {
  const props = mapFields(raw.attrs || {}, fields, raw);
  const { proj, precision } = ctx;
  const P = (xy) => [round(xy[0], precision.metres), round(xy[1], precision.metres)];
  const L = (ll) => [round(ll[0], precision.lngLat), round(ll[1], precision.lngLat)];
  let geom, at, bbox;
  if (kind === 'point' || kind === 'label') {
    let ll;
    if (raw.geometry?.type === 'point') ll = raw.geometry.coords;
    else if (raw.geometry?.type === 'rings') {
      const polys = assemblePolygons(raw.geometry.rings, proj, precision);
      const c = polys.length && labelPoint(polys);
      if (c) ll = proj.toLngLat(c);
    }
    if (!ll || !Number.isFinite(ll[0])) return null;
    const xy = P(proj.toLocal(ll));
    geom = { type: 'point', ll: L(ll), xy };
    at = { ll: geom.ll, xy };
  } else if (kind === 'line') {
    if (raw.geometry?.type !== 'paths') return null;
    const lines = cleanPaths(raw.geometry.paths, proj, precision);
    if (!lines.length) return null;
    geom = { type: 'line', lines };
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const mid = longest.xy[Math.floor(longest.xy.length / 2)];
    at = { xy: mid, ll: longest.ll[Math.floor(longest.ll.length / 2)] };
    bbox = { xy: bboxOfPoints(lines.map((l) => l.xy)), ll: bboxOfPoints(lines.map((l) => l.ll)) };
  } else {
    if (raw.geometry?.type !== 'rings') return null;
    const polys = assemblePolygons(raw.geometry.rings, proj, precision);
    if (!polys.length) return null;
    geom = { type: 'polygon', polys };
    const c = labelPoint(polys);
    at = { xy: P(c), ll: L(proj.toLngLat(c)) };
    bbox = { xy: bboxOfPolys(polys, 'xy').map((v) => round(v, precision.metres)), ll: bboxOfPolys(polys, 'll') };
  }
  const id = String(idFn ? idFn(props, raw) : raw.id);
  return { id, layer, props, geom, at, bbox };
}

function uniqueIds(features) {
  const seen = new Map();
  for (const f of features) {
    const n = seen.get(f.id) || 0;
    seen.set(f.id, n + 1);
    if (n) f.id = `${f.id}-${n + 1}`;
  }
  return features;
}

export function makeContext(config, env = {}) {
  const precision = { lngLat: 7, metres: 1, ...(config.output?.precision || {}) };
  return {
    config,
    proj: makeProjector(config.origin),
    precision,
    fetchJson: env.fetchJson || (async (u) => (await fetch(u)).json()),
    readJson: env.readJson || (async (u) => (await fetch(u)).json()),
    log: env.log || (() => {}),
    loaders: env.loaders,
    loadSource: null, // set below
  };
}

export async function buildDataset(config, env = {}) {
  const ctx = makeContext(config, env);
  ctx.loadSource = (src) => loadSource(src, ctx);
  const only = env.only ? new Set(env.only) : null;
  const ds = { config, proj: ctx.proj, builtAt: new Date().toISOString(), layers: {}, indoor: null, extras: {}, warnings: [] };

  for (const layer of config.layers) {
    if (only && !only.has(layer.key) && layer.key !== config.indoor?.buildingsLayer) continue;
    const raw = await ctx.loadSource(layer.source);
    let features = raw.map((r) => makeFeature(r, { ...layer, layer: layer.key }, ctx)).filter(Boolean);
    if (layer.filter) features = features.filter(layer.filter);
    if (layer.transform) features = features.map((f) => layer.transform(f, ctx)).filter(Boolean);
    uniqueIds(features);
    ds.layers[layer.key] = { key: layer.key, label: layer.label || layer.key, kind: layer.kind, group: layer.group || null, features };
    const dropped = raw.length - features.length;
    ctx.log(`${layer.key.padEnd(14)} ${String(features.length).padStart(5)} features${dropped ? `  (${dropped} without usable geometry)` : ''}`);
  }

  if (config.indoor && env.indoor !== false) ds.indoor = await buildIndoor(ds, ctx);

  for (const enrich of config.enrich || []) {
    if (env.indoor === false && enrich.needsIndoor) continue;
    await enrich(ds, ctx);
  }
  return ds;
}

async function buildIndoor(ds, ctx) {
  const I = ctx.config.indoor;
  const bl = ds.layers[I.buildingsLayer];
  if (!bl) { ds.warnings.push(`indoor: buildings layer "${I.buildingsLayer}" missing`); return null; }
  const byCode = new Map(), byName = new Map();
  for (const b of bl.features) {
    if (b.props.code) byCode.set(String(b.props.code).toUpperCase(), b);
    byCode.set(b.id.toUpperCase(), b);
    for (const n of [b.props.name, b.props.fullName]) if (n) byName.set(normName(n), b);
  }
  const containing = (xy) => bl.features.find((b) =>
    b.bbox && b.bbox.xy[0] <= xy[0] && xy[0] <= b.bbox.xy[2] && b.bbox.xy[1] <= xy[1] && xy[1] <= b.bbox.xy[3] && pointInPolys(xy, b.geom.polys));
  const pattern = I.codePattern || /^([A-Za-z]{2,6})[\s_-]/;
  // A room this far outside the building its name points to, inside another one, is mislabelled
  // in the source (BWC level 2 corridors drawn in BEC): it goes to the building it's in.
  const strayDistance = I.strayDistance ?? 30;
  const far = (b, [x, y]) => {
    const [x0, y0, x1, y1] = b.bbox?.xy ?? [x, y, x, y];
    return x < x0 - strayDistance || x > x1 + strayDistance || y < y0 - strayDistance || y > y1 + strayDistance;
  };

  const buildings = {};
  let unassigned = 0, moved = 0;
  for (const level of I.levels) {
    const raw = await ctx.loadSource(level.source);
    let kept = 0;
    for (const r of raw) {
      const f = makeFeature(r, { kind: 'area', layer: 'rooms', fields: I.fields }, ctx);
      if (!f) continue;
      const name = f.props.name;
      const prefix = name && (String(name).match(pattern) || [])[1];
      let b = (prefix && byCode.get(prefix.toUpperCase())) || containing(f.at.xy) || byName.get(normName(f.props.buildingName));
      if (!b) { unassigned++; continue; }
      if (far(b, f.at.xy)) {
        const inside = containing(f.at.xy);
        if (inside && inside !== b) { b = inside; moved++; }
      }
      delete f.props.buildingName;
      if (f.props.type != null && I.roomTypes?.[f.props.type]) f.props.typeName = I.roomTypes[f.props.type];
      f.building = b.id;
      f.level = level.id;
      f.id = `${b.id}:${level.id}:${name ? normRoom(name).replace(/\s+/g, '_') : `oid${r.id}`}`;
      const entry = (buildings[b.id] ??= { id: b.id, name: b.props.name || b.props.fullName || b.id, byLevel: new Map() });
      if (!entry.byLevel.has(level.id)) entry.byLevel.set(level.id, []);
      entry.byLevel.get(level.id).push(f);
      kept++;
    }
    ctx.log(`level ${level.id.padEnd(8)} ${String(kept).padStart(5)} rooms`);
  }
  if (unassigned) ctx.log(`(${unassigned} rooms matched no building and were skipped)`);
  if (moved) ctx.log(`(${moved} rooms lay in another building than their name says and were moved to it)`);

  // Order each building's levels as in the config, give rooms unique ids, tag buildings.
  const order = I.levels.map((l) => l.id);
  for (const e of Object.values(buildings)) {
    e.levels = order.filter((id) => e.byLevel.has(id)).map((id) => ({ id, rooms: e.byLevel.get(id) }));
    delete e.byLevel;
    uniqueIds(e.levels.flatMap((l) => l.rooms));
  }
  for (const b of bl.features) if (buildings[b.id]) b.props.levels = buildings[b.id].levels.map((l) => l.id);

  return {
    levels: I.levels.map(({ id, label, elev }) => ({ id, label, elev })),
    roomTypes: I.roomTypes || {},
    storey: I.storey || 4,
    buildings,
  };
}

// Iterate a layer's features, or every room when layer === 'rooms'.
export function featuresOf(ds, layer) {
  if (layer === 'rooms') return Object.values(ds.indoor?.buildings || {}).flatMap((b) => b.levels.flatMap((l) => l.rooms));
  return ds.layers[layer]?.features || [];
}
