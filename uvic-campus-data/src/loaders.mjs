// Source loaders. Each turns a `source` object from the config into raw records:
//   { id, attrs, geometry: { type: 'rings', rings } | { type: 'paths', paths } | { type: 'point', coords: [lon,lat] } | null }
// rings/paths are arrays of [[lon,lat], ...].
// Add a loader by adding a function here (or pass `loaders` to buildDataset).

export const loaders = {
  // ArcGIS REST feature layer. source: { type: 'arcgis', url: '.../FeatureServer/0', where?, pageSize? }
  async arcgis(src, ctx) {
    const out = [];
    const pageSize = src.pageSize || 1000;
    for (let offset = 0; ;) {
      const q = new URLSearchParams({
        where: src.where || '1=1', outFields: '*', outSR: '4326', f: 'json', geometryPrecision: '7',
        resultOffset: String(offset), resultRecordCount: String(pageSize),
      });
      const res = await ctx.fetchJson(`${src.url}/query?${q}`);
      if (res.error) throw new Error(`${src.url}: ${res.error.message || JSON.stringify(res.error)}`);
      const feats = res.features || [];
      for (const f of feats) {
        const a = f.attributes || {}, g = f.geometry;
        let geometry = null;
        if (g?.rings) geometry = { type: 'rings', rings: g.rings };
        else if (g?.paths) geometry = { type: 'paths', paths: g.paths };
        else if (g && Number.isFinite(g.x) && Number.isFinite(g.y)) geometry = { type: 'point', coords: [g.x, g.y] };
        out.push({ id: a.OBJECTID ?? a.FID ?? a.objectid ?? out.length + 1, attrs: a, geometry });
      }
      if (!res.exceededTransferLimit || !feats.length) break;
      offset += feats.length;
    }
    return out;
  },

  // GeoJSON FeatureCollection. source: { type: 'geojson', file?: 'path relative to config', url?: 'https://...', data?: object }
  async geojson(src, ctx) {
    const fc = src.data ?? (await ctx.readJson(src.file || src.url));
    const feats = fc.type === 'FeatureCollection' ? fc.features : fc.type === 'Feature' ? [fc] : [];
    return feats.map((f, i) => {
      const g = f.geometry;
      let geometry = null;
      if (g?.type === 'Polygon') geometry = { type: 'rings', rings: g.coordinates };
      else if (g?.type === 'MultiPolygon') geometry = { type: 'rings', rings: g.coordinates.flat() };
      else if (g?.type === 'LineString') geometry = { type: 'paths', paths: [g.coordinates] };
      else if (g?.type === 'MultiLineString') geometry = { type: 'paths', paths: g.coordinates };
      else if (g?.type === 'Point') geometry = { type: 'point', coords: g.coordinates };
      else if (g?.type === 'MultiPoint' && g.coordinates.length) geometry = { type: 'point', coords: g.coordinates[0] };
      return { id: f.id ?? f.properties?.id ?? i + 1, attrs: f.properties || {}, geometry };
    });
  },
};

export async function loadSource(src, ctx) {
  const fn = (ctx.loaders || loaders)[src?.type];
  if (!fn) throw new Error(`No loader for source type "${src?.type}". Known: ${Object.keys(ctx.loaders || loaders).join(', ')}`);
  return fn(src, ctx);
}
