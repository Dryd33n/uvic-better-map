// Checks a built dataset against what consumers rely on. Pure: give it a `read(path)`.
//   const report = await validateDataset((p) => readJson(join('dist', p)))
//   report = { ok, errors: [], warnings: [], stats: {} }

import { signedArea } from './geometry.mjs';

const MAX_ERRORS = 50;

export async function validateDataset(read) {
  const errors = [], warnings = [], stats = { files: 0, features: 0, rooms: 0 };
  const err = (m) => { if (errors.length < MAX_ERRORS) errors.push(m); };
  let manifest;
  try { manifest = await read('manifest.json'); } catch (e) { return { ok: false, errors: [`manifest.json: ${e.message}`], warnings, stats }; }
  stats.files++;

  const [W, S, E, N] = manifest.bbox || [-180, -90, 180, 90];
  const pad = 0.01;
  const inBox = ([x, y]) => x >= W - pad && x <= E + pad && y >= S - pad && y <= N + pad;

  const checkRing = (r, outer, where) => {
    if (r.length < 4) return err(`${where}: ring has ${r.length} positions (needs 4+)`);
    const a = r[0], z = r[r.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) err(`${where}: ring not closed`);
    const ccw = signedArea(r.slice(0, -1)) > 0;
    if (ccw !== outer) err(`${where}: ${outer ? 'outer ring should be counter-clockwise' : 'hole should be clockwise'}`);
    if (!r.every(inBox)) err(`${where}: coordinates outside the dataset bbox`);
  };
  const checkGeometry = (g, where) => {
    if (!g) return err(`${where}: missing geometry`);
    if (g.type === 'Point') { if (!inBox(g.coordinates)) err(`${where}: point outside bbox`); }
    else if (g.type === 'LineString') { if (g.coordinates.length < 2) err(`${where}: line needs 2+ positions`); }
    else if (g.type === 'MultiLineString') { if (g.coordinates.some((l) => l.length < 2)) err(`${where}: line needs 2+ positions`); }
    else if (g.type === 'Polygon') g.coordinates.forEach((r, i) => checkRing(r, i === 0, where));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((r, i) => checkRing(r, i === 0, where)));
    else err(`${where}: unexpected geometry type ${g.type}`);
  };
  const checkCollection = (fc, where, expected) => {
    if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return err(`${where}: not a FeatureCollection`);
    if (expected != null && fc.features.length !== expected) err(`${where}: ${fc.features.length} features, manifest says ${expected}`);
    const ids = new Set();
    for (const f of fc.features) {
      if (ids.has(f.id)) err(`${where}: duplicate id ${f.id}`);
      ids.add(f.id);
      checkGeometry(f.geometry, `${where} #${f.id}`);
    }
    stats.features += fc.features.length;
    return ids;
  };

  const layerIds = {};
  for (const [key, L] of Object.entries(manifest.layers || {})) {
    if (!L.count) warnings.push(`layer ${key} is empty`);
    for (const [fmt, path] of Object.entries(L.files || {})) {
      let data;
      try { data = await read(path); stats.files++; } catch (e) { err(`${path}: ${e.message}`); continue; }
      if (fmt === 'geojson') layerIds[key] = checkCollection(data, path, L.count);
      else if (fmt === 'local' && data.features?.length !== L.count) err(`${path}: ${data.features?.length} features, manifest says ${L.count}`);
    }
  }

  if (manifest.indoor) {
    const bKey = manifest.indoor.buildingsLayer;
    const known = layerIds[bKey];
    for (const [id, b] of Object.entries(manifest.indoor.buildings)) {
      if (known && !known.has(id)) err(`indoor building ${id} is not in layer ${bKey}`);
      for (const [fmt, path] of Object.entries(b.files || {})) {
        let data;
        try { data = await read(path); stats.files++; } catch (e) { err(`${path}: ${e.message}`); continue; }
        if (fmt === 'geojson') { checkCollection(data, path, b.rooms); stats.rooms += data.features.length; }
      }
    }
  }
  if (manifest.rooms) {
    try {
      const idx = await read(manifest.rooms.file); stats.files++;
      if (idx.length !== manifest.rooms.count) err(`rooms.json: ${idx.length} entries, manifest says ${manifest.rooms.count}`);
      const bs = manifest.indoor?.buildings || {};
      const bad = idx.filter((r) => !bs[r.building]);
      if (bad.length) err(`rooms.json: ${bad.length} rooms point at unknown buildings (e.g. ${bad[0].name})`);
    } catch (e) { err(`${manifest.rooms.file}: ${e.message}`); }
  }
  for (const [name, group] of Object.entries(manifest.bundles || {})) {
    for (const path of Object.values(group)) { try { await read(path); stats.files++; } catch (e) { err(`bundle ${name} ${path}: ${e.message}`); } }
  }
  if (errors.length >= MAX_ERRORS) warnings.push(`stopped listing errors after ${MAX_ERRORS}`);
  return { ok: errors.length === 0, errors, warnings, stats };
}
