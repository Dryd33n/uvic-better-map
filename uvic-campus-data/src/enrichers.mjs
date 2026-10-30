// Enrichers run after all layers and floors are loaded: (dataset, ctx) => void | Promise<void>.
// They're factories: call them in config/sources.mjs with options, get back the function.
// See docs/EXTENDING.md for how to write your own.

import { mapFields, featuresOf, normRoom } from './pipeline.mjs';
import { pointInPolys } from './geometry.mjs';
import { toPaths, union, difference, intersection, xor, offset, close, open, area, toLocalPolys, fillHoles } from './clip.mjs';

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
 * A building's 3D massing from its floor plans: each storey stands only where that floor has
 * rooms, so a wing with one storey is one storey tall even if another wing has five, and skyways
 * float over open ground. The ground storey also covers the footprint. A storey keeps the outline
 * of the one below except where it adds or removes a piece at least `minWidth` wide, so walls run
 * straight up instead of stepping by plan noise, and storeys with the same outline merge into one
 * band. Holes under `minHole` m² are filled, and above the ground storey holes are filled wherever
 * the ground storey is under them (no pits in roofs; courtyards stay open), as are gaps narrower
 * than `minSlot` over the storey below and pieces the storey walls in on over `minEnclosed` of
 * their edge (wells in the plan, not setbacks). Strips narrower than `minWidth`
 * are dropped from upper storeys. Neighbouring footprints are cut away. Written to
 * extras/<name>.json as
 *   { [buildingId]: [{ level, elev, top, polys: [[outer, ...holes]] }] }   (local metres, flat rings)
 * bottom to top; `level`/`elev` are the band's lowest storey and `top` includes `roof`.
 * Mezzanines and basements don't count as storeys.
 */
export function massing({ name = 'massing', wallGap = 0.5, minWidth = 2, minSlot = 8, minEnclosed = 0.6, minHole = 100, minArea = 4, roof = 0.5 } = {}) {
  function massingEnricher(ds, ctx) {
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
      const others = bl.filter((o) => o !== fp && near(o.bbox.xy, fp.bbox.xy, 60)).flatMap((o) => toPaths(o.geom.polys));
      const floors = new Map(b.levels.filter(({ id }) => elev[id] >= 0 && Number.isInteger(elev[id] / storey)).map((l) => [elev[l.id], l]));
      if (!floors.size) continue;
      const topElev = Math.max(...floors.keys());
      const merged = [];
      let prev = [], ground = [];
      for (let e = 0; e <= topElev; e += storey) {
        const floor = floors.get(e);
        let plan = floor ? close(union(floor.rooms.flatMap((r) => toPaths(r.geom.polys))), wallGap) : [];
        plan = difference(fillHoles(plan, minHole), others);
        // The ground storey is the footprint plus whatever the plan adds beyond it.
        const below = e === 0 ? own : prev;
        let removed = open(difference(below, plan), minWidth / 2);
        if (e > 0) {
          // A piece walled in by the storey on most of its edge is a well in the plan (an atrium,
          // unmapped rooms), not a wing stepping down: it stays, so roofs stay flat (ECS).
          // Edges measured as a 0.5 m band around each piece (holes included).
          const kept = difference(below, removed);
          const band = difference(offset(removed, 0.5), removed);
          removed = removed.filter((p) => {
            if (area([p]) <= 0) return true;
            const edge = intersection(band, offset([p], 0.5));
            return area(intersection(edge, kept)) <= minEnclosed * area(edge);
          });
        }
        let shape = union([...difference(below, removed), ...open(difference(plan, below), minWidth / 2)]);
        if (e === 0) shape = union([...shape, ...own]);
        shape = fillHoles(shape, minHole);
        if (e === 0) ground = shape;
        else {
          // Strips narrower than minWidth left over from the storey below (1 m fins on CUN's roof).
          // Square corners the opening trims are far under a square metre and stay.
          shape = difference(shape, difference(shape, open(shape, minWidth / 2)).filter((p) => area([p]) >= 1));
          // No pits in roofs: holes in an upper storey are filled wherever the ground storey is
          // under them. Over open ground they stay (Clearihue's and Cornett's courtyards).
          const solid = fillHoles(shape, Infinity);
          shape = fillHoles(difference(solid, difference(difference(solid, shape), ground)), minHole);
          // Nor slots: gaps and notches narrower than minSlot over the storey below are filled, so
          // a missing corridor doesn't split a block into two towers (ECS).
          shape = fillHoles(union([...shape, ...intersection(close(shape, minSlot / 2), below)]), minHole);
        }
        prev = shape;
        if (area(shape) < minArea) continue;
        const last = merged[merged.length - 1];
        if (last && last.next === e && area(xor(last.paths, shape)) < 1) {
          last.next = e + storey;
        } else merged.push({ level: floor?.id ?? null, elev: e, next: e + storey, paths: shape });
      }
      const result = merged
        .map(({ level, elev: e, next, paths }) => ({ level, elev: e, top: next + roof, polys: toLocalPolys(paths, minArea) }))
        .filter((m) => m.polys.length);
      if (result.length) { out[b.id] = result; bands += result.length; }
    }
    ds.extras[name] = out;
    ctx.log(`${name}: ${bands} bands in ${Object.keys(out).length} buildings`);
  }
  massingEnricher.needsIndoor = true;
  return massingEnricher;
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

/**
 * The ground layers' outlines, for drawing as lines: each group's polygons unioned (no seams where
 * pieces abut) with building footprints cut away. Written to extras/<name>.json as
 *   { [group]: [ring, ...] }   flat [x0, y0, x1, y1, ...] rings in local metres, holes included
 *   groundLines({ groups: { roads: ['roads'], paths: ['walkways', 'paths'] } })
 */
export function groundLines({ name = 'groundLines', groups, minArea = 2 } = {}) {
  return function groundLinesEnricher(ds, ctx) {
    const polysOf = (key) => (ds.layers[key]?.features || []).filter((f) => f.geom?.polys).flatMap((f) => toPaths(f.geom.polys));
    const footprints = polysOf(ds.config.indoor?.buildingsLayer || 'buildings');
    const out = {};
    let rings = 0;
    for (const [group, keys] of Object.entries(groups)) {
      const paths = keys.flatMap(polysOf);
      if (!paths.length) continue;
      out[group] = toLocalPolys(difference(union(paths), footprints), minArea).flat().map((r) => r.map((v) => Math.round(v * 10) / 10));
      rings += out[group].length;
    }
    ds.extras[name] = out;
    ctx.log(`${name}: ${rings} rings in ${Object.keys(out).length} groups`);
  };
}

/**
 * Food outlets onto their rooms: each outlet point (a layer with `name` and an `about` link) names
 * the room it's in, so floor plans and search show "Mystic Market" rather than "JCC B112". The room
 * is a food-service room containing the point (any level), else the nearest within `near` metres,
 * else a non-corridor room containing it on `groundLevel`. The room gets the outlet's name as its
 * label (outlets sharing a room are joined with " / ") and its link; the outlet gets `room` and
 * `level`. Outlets with no room keep neither, for apps to place by building. `rooms` names an
 * outlet's room by hand ({ Starbucks: 'CSR 050' }) where the geometry picks wrong.
 */
export function foodOutlets({ layer = 'food', foodType = 3, corridorType = 0, near = 10, groundLevel = '1', rooms: byHand = {} } = {}) {
  function foodOutletsEnricher(ds, ctx) {
    if (!ds.indoor) return;
    const footprints = ds.layers[ds.config.indoor.buildingsLayer]?.features || [];
    const placed = new Map(); // room -> outlet names
    let matched = 0;
    for (const f of ds.layers[layer]?.features || []) {
      const xy = f.at?.xy;
      const b = xy && footprints.find((o) => o.geom?.polys && pointInPolys(xy, o.geom.polys));
      const levels = (b && ds.indoor.buildings[b.id]?.levels) || [];
      const rooms = levels.flatMap(({ id, rooms }) => rooms.map((r) => ({ r, level: id })));
      const contains = ({ r }) => pointInPolys(xy, r.geom.polys);
      const food = rooms.filter(({ r }) => r.props.type === foodType);
      const dist = ({ r }) => Math.hypot(r.at.xy[0] - xy[0], r.at.xy[1] - xy[1]);
      const hit =
        rooms.find((x) => x.r.props.name === byHand[f.props.name]) ??
        food.find(contains) ??
        food.filter((x) => dist(x) <= near).sort((p, q) => dist(p) - dist(q))[0] ??
        rooms.find((x) => x.level === groundLevel && x.r.props.type !== corridorType && contains(x));
      if (!hit) continue;
      const names = placed.get(hit.r) ?? [];
      names.push(f.props.name);
      placed.set(hit.r, names);
      hit.r.props.label = names.join(' / ');
      if (/^https?:/i.test(f.props.about ?? '')) hit.r.props.link = f.props.about;
      f.props.room = hit.r.props.name;
      f.props.level = hit.level;
      matched++;
    }
    ctx.log(`foodOutlets: ${matched} of ${ds.layers[layer]?.features.length ?? 0} outlets placed in rooms`);
  }
  foodOutletsEnricher.needsIndoor = true;
  return foodOutletsEnricher;
}
