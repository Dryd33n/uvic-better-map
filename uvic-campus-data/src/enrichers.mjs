// Enrichers run after all layers and floors are loaded: (dataset, ctx) => void | Promise<void>.
// They're factories: call them in config/sources.mjs with options, get back the function.
// See docs/EXTENDING.md for how to write your own.

import { mapFields, featuresOf, normRoom } from './pipeline.mjs';

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
