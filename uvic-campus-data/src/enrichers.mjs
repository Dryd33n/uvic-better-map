// Enrichers run after all layers and floors are loaded: (dataset, ctx) => void | Promise<void>.
// They're factories: call them in config/sources.mjs with options, get back the function.
// See docs/EXTENDING.md for how to write your own.

import { mapFields, featuresOf, normRoom } from './pipeline.mjs';
import { toPaths, union, difference, xor, close, open, area, toLocalPolys } from './clip.mjs';

/**
 * Join attributes from another source onto a layer (or onto 'rooms') by matching a key.
 *   joinByField({ target: 'buildings', on: 'code', source: {...}, sourceKey: 'BLDG_CODE',
 *                 fields: { phone: 'Phone' }, into: 'contact', normalize: (v) => String(v).toUpperCase() })
 * `on` is the target property; `into` nests joined fields under one property instead of merging.
 */
export function joinByField({ target, on, source, sourceKey, fields, into = null, normalize = (v) => String(v ?? '').trim().toUpperCase(), name = 'join' }) {
  const joinEnricher = async function joinEnricher(ds, ctx) {
    const raw = await ctx.loadSource(source);
    const table = new Map();
    for (const r of raw) {
      const k = normalize(r.attrs?.[sourceKey]);
      if (!k) continue;
      const values = mapFields(r.attrs || {}, fields, r);
      if (Object.keys(values).length) table.set(k, values);
    }
    let matched = 0;
    for (const f of featuresOf(ds, target)) {
      const v = table.get(normalize(f.props[on]));
      if (!v) continue;
      if (into) f.props[into] = { ...(f.props[into] || {}), ...v };
      else Object.assign(f.props, v);
      matched++;
    }
    ctx.log(`${name}: matched ${matched} of ${table.size} ${target} records`);
  };
  joinEnricher.sources = [{ source, fields: { ...fields, _key: sourceKey } }]; // lets `npm run audit` see this source
  return joinEnricher;
}

/**
 * Add a computed property to every feature of a layer (or 'rooms').
 *   computeField({ target: 'buildings', name: 'hasFood', value: (f, ds) => ds.layers.food.features.some(...) })
 * Returning undefined leaves the property unset.
 */
export function computeField({ target, name, value }) {
  return function computeEnricher(ds) {
    for (const f of featuresOf(ds, target)) {
      const v = value(f, ds);
      if (v !== undefined) f.props[name] = v;
    }
  };
}

/** Gender / accessibility / features for washroom rooms, joined on the room number (CLE B002). */
export function washroomDetails({ source, roomField = 'Room', fields }) {
  const fn = joinByField({ target: 'rooms', on: 'name', source, sourceKey: roomField, fields, into: 'washroom', normalize: normRoom, name: 'washrooms' });
  fn.needsIndoor = true;
  return fn;
}
/**
 * Building heights from their floor data: top full storey above ground + one storey + roof.
 * Buildings without floor data keep whatever height (if any) they had.
 */
export function heightsFromFloors({ roof = 0.5 } = {}) {
  function heightsEnricher(ds) {
    if (!ds.indoor) return;
    const { storey, levels } = ds.indoor;
    const elev = Object.fromEntries(levels.map((l) => [l.id, l.elev]));
    const bl = ds.layers[ds.config.indoor.buildingsLayer];
    for (const b of bl?.features || []) {
      const ids = b.props.levels;
      if (!ids?.length) continue;
      // Full storeys only: a mezzanine (elevation between storeys) doesn't add height.
      const above = ids.map((id) => elev[id]).filter((e) => e >= 0 && Number.isInteger(e / storey));
      const top = above.length ? Math.max(...above) : 0;
      b.props.height = top + storey + roof;
    }
  }
  heightsEnricher.needsIndoor = true;
  return heightsEnricher;
}

/**
 * Parts of buildings the footprint doesn't cover (skyways, overhangs, upper wings), as solid
 * outlines ready to extrude. The footprint layer is the ground-floor outline, so extruding it
 * alone misses these. Per building and above-ground level: union the level's rooms with the
 * footprint, close the wall gaps between rooms, cut every footprint away (so pieces meet the
 * footprint edge exactly), and drop slivers from plans that don't quite line up with it.
 * Consecutive levels with the same outline merge into one band. Written to extras/<name>.json as
 *   { [buildingId]: [{ level, elev, top, polys: [[outer, ...holes]] }] }   (local metres, flat rings)
 * `level`/`elev` are the band's lowest level; `top` reaches the roof on the top storey.
 */
export function overhangs({ name = 'overhangs', minElev = 0, wallGap = 0.5, minWidth = 2, minArea = 10, roofTolerance = 1 } = {}) {
  function overhangsEnricher(ds, ctx) {
    if (!ds.indoor) return;
    const { storey, levels } = ds.indoor;
    const bl = ds.layers[ds.config.indoor.buildingsLayer]?.features || [];
    const byId = new Map(bl.map((b) => [b.id, b]));
    const elev = Object.fromEntries(levels.map((l) => [l.id, l.elev]));
    const near = (a, b, pad) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];
    const out = {};
    let bands = 0;
    for (const b of Object.values(ds.indoor.buildings)) {
      const fp = byId.get(b.id);
      if (!fp) continue;
      const own = toPaths(fp.geom.polys);
      // Every footprint around this building, so a skyway into a neighbour stops at its wall too.
      const footprints = bl.filter((o) => near(o.bbox.xy, fp.bbox.xy, 60)).flatMap((o) => toPaths(o.geom.polys));
      const pieces = [];
      for (const { id, rooms } of b.levels) {
        if (elev[id] < minElev) continue; // below ground: hidden anyway
        const solid = close(union([...own, ...rooms.flatMap((r) => toPaths(r.geom.polys))]), wallGap);
        const piece = open(difference(solid, footprints), minWidth / 2);
        if (area(piece) >= minArea) pieces.push({ level: id, elev: elev[id], paths: piece });
      }
      // Merge a storey into the band below when the outlines differ only by slivers.
      const merged = [];
      for (const p of pieces) {
        const last = merged[merged.length - 1];
        if (last && p.elev === last.top && area(open(xor(last.paths, p.paths), minWidth / 4)) < minArea / 5) {
          last.paths = union([...last.paths, ...p.paths]);
          last.top = p.elev + storey;
        } else merged.push({ ...p, top: p.elev + storey });
      }
      const height = fp.props.height;
      const result = merged
        .map(({ level, elev: e, top, paths }) => ({ level, elev: e, top: height && top >= height - roofTolerance ? Math.max(height, top) : top, polys: toLocalPolys(paths, minArea) }))
        .filter((m) => m.polys.length);
      if (result.length) { out[b.id] = result; bands += result.length; }
    }
    ds.extras[name] = out;
    ctx.log(`${name}: ${bands} bands in ${Object.keys(out).length} buildings`);
  }
  overhangsEnricher.needsIndoor = true;
  return overhangsEnricher;
}

/**
 * Each level's outline: its rooms unioned, with the wall gaps between them closed. Lets an app
 * draw a floor plate that covers exactly the floor (walls show as the plate between rooms).
 * Written to extras/<name>.json as  { [buildingId]: { [levelId]: [[outer, ...holes]] } }  (local metres)
 */
export function floorOutlines({ name = 'floorOutlines', wallGap = 0.5, minArea = 1 } = {}) {
  function floorOutlinesEnricher(ds, ctx) {
    if (!ds.indoor) return;
    const out = {};
    for (const b of Object.values(ds.indoor.buildings)) {
      for (const { id, rooms } of b.levels) {
        const polys = toLocalPolys(close(union(rooms.flatMap((r) => toPaths(r.geom.polys))), wallGap), minArea);
        if (polys.length) (out[b.id] ??= {})[id] = polys;
      }
    }
    ds.extras[name] = out;
    ctx.log(`${name}: ${Object.values(out).reduce((n, l) => n + Object.keys(l).length, 0)} levels in ${Object.keys(out).length} buildings`);
  }
  floorOutlinesEnricher.needsIndoor = true;
  return floorOutlinesEnricher;
}
