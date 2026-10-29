// Compare the config with the ArcGIS web map behind the app: which layers the map has that the
// config doesn't pull, and which real attribute fields the config leaves out.
//   const report = await auditAgainstWebmap(config, { fetchJson })

const SYSTEM = /^(OBJECTID|FID|GlobalID|Shape_|Shape__|SHAPE|created_|last_edited|ORIG_FID)/i;
// CAD export noise that's on many UVic layers: drawing handles, block and layer names.
const CAD = /^(Handle|Layer|LayerReplace|LayerRepla|Layer_\w*|Layer_Mod_?|RefName(_\d)?|Entity|Lyr\w*|Ent\w*|Blk\w*|Txt\w*|Doc\w*|Ext[XYZ]|Scale[XYZ]|Line\w*|LTScale|Color|Elevation|Thickness|Join_Count|TARGET_FID|Style|FontID|Height|VertAlign|LnSpace|SpaceFct|Direction|Handle_\d|SymbolID|id)$/i;

const norm = (u) => decodeURIComponent(String(u || '')).replace(/\/+$/, '').toLowerCase();

function configSources(config) {
  const list = [];
  for (const l of config.layers || []) list.push({ where: `layer ${l.key}`, src: l.source, fields: l.fields });
  for (const lv of config.indoor?.levels || []) list.push({ where: `indoor level ${lv.id}`, src: lv.source, fields: config.indoor.fields });
  for (const e of config.enrich || []) for (const s of e.sources || []) list.push({ where: `enricher ${e.name || 'anonymous'}`, src: s.source, fields: s.fields, enricher: true });
  return list.filter((x) => x.src?.type === 'arcgis');
}

function mentionedFields(spec) {
  if (spec === '*') return null; // everything
  const names = new Set();
  for (const v of Object.values(spec || {})) {
    if (typeof v === 'string') names.add(v);
    else if (Array.isArray(v)) v.forEach((x) => names.add(x));
    else if (typeof v === 'function') for (const m of v.toString().matchAll(/(?:\.|\[['"])([A-Za-z_]\w*)/g)) names.add(m[1]);
  }
  return names;
}

export async function auditAgainstWebmap(config, { fetchJson, portal = 'https://www.arcgis.com' } = {}) {
  const id = config.source?.webmap;
  if (!id) throw new Error('config.source.webmap is not set');
  const wm = await fetchJson(`${portal}/sharing/rest/content/items/${id}/data?f=json`);
  const leaves = [];
  const walk = (ls, path) => {
    for (const l of ls || []) {
      const p = [...path, l.title];
      if (l.layers?.length && !l.url) walk(l.layers, p);
      else if (l.url) leaves.push({ title: p.join(' > '), url: /FeatureServer$|MapServer$/i.test(l.url) ? `${l.url}/${l.layerId ?? 0}` : l.url, type: l.layerType });
    }
  };
  walk(wm.operationalLayers, []);

  const used = configSources(config);
  const usedUrls = new Set(used.map((u) => norm(u.src.url)));
  const missing = leaves.filter((l) => !usedUrls.has(norm(l.url)));

  const ignore = new Set(config.audit?.ignoreFields || []);
  const unmapped = [];
  for (const u of used) {
    // An enricher reading a source that a layer already pulls in full doesn't need to map everything.
    if (u.enricher && used.some((o) => !o.enricher && norm(o.src.url) === norm(u.src.url))) continue;
    const known = mentionedFields(u.fields);
    if (!known) continue;
    try {
      const meta = await fetchJson(`${u.src.url}?f=json`);
      const left = (meta.fields || []).map((f) => f.name).filter((n) => !SYSTEM.test(n) && !CAD.test(n) && !ignore.has(n) && !known.has(n));
      if (left.length) unmapped.push({ where: u.where, url: u.src.url, fields: left });
    } catch (e) {
      unmapped.push({ where: u.where, url: u.src.url, error: e.message });
    }
  }
  return { webmap: { id, title: wm.title || null, layers: leaves.length }, configured: used.length, missing, unmapped };
}
