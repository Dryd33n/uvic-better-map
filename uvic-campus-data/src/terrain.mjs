// Ground elevation from a lidar DEM: a heightfield over the campus, and each building's ground level.
// Reads only the campus window of a cloud-optimised GeoTIFF over HTTP (a few MB of a 71 GB file).

import { toPaths, offset } from './clip.mjs';
import { bboxOfPoints } from './geometry.mjs';

const bboxOfRing = (xy) => bboxOfPoints([xy]);

// NRCan HRDEM, "Vancouver Island / Sunshine Coast 2018" lidar project: 1 m bare-earth DTM, metres
// above sea level (CGVD2013), in EPSG:3979. Open Government Licence – Canada.
export const HRDEM = {
  title: 'NRCan High Resolution Digital Elevation Model (HRDEM), BC Vancouver Island / Sunshine Coast 2018, 1 m DTM',
  url: 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/BC-Vancouver_Island_Sunshine_Coast_2018-1m-dtm.tif',
  crs: '+proj=lcc +lat_0=49 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  licence: 'Contains information licensed under the Open Government Licence – Canada',
};

/**
 * Terrain heightfield plus `ground` (metres above sea level) on every building.
 * Written to extras/<name>.json as
 *   { source, licence, cell, x0, y0, nx, ny, ref, heights }
 * heights[j * nx + i] is the ground at local (x0 + i·cell, y0 + j·cell) in decimetres above sea
 * level (j = 0 is the south edge). `ref` is the ground at the origin in metres, a handy zero for 3D.
 * A building's ground is a percentile of the DEM along a ring `ring` metres outside its footprint.
 * The median puts Level 1 at the grade most of the building meets: on a hillside, where most of
 * the edge is downhill, it's dug into the slope (a walkout); one sunken loading bay or light well
 * doesn't pull a building down, nor one raised terrace lift it. `overrides` ({ [code]: metres })
 * sets a building's Level 1 by hand where the DEM can't tell. Where
 * the footprint is several separate structures (polygons more than `touch` metres apart) and has
 * no floor plans, `grounds` gives each polygon its own, parallel to the polygons.
 * `extent` is the layer whose bbox (plus `pad` metres) the grid covers.
 */
export function terrain({ name = 'terrain', dem = HRDEM, cell = 4, pad = 120, extent = 'boundary', ring = 2, percentile = 0.5, touch = 1, overrides = {} } = {}) {
  async function terrainEnricher(ds, ctx) {
    const [{ fromUrl }, { default: proj4 }] = await Promise.all([import('geotiff'), import('proj4')]);
    const toDem = proj4('EPSG:4326', dem.crs).forward;
    const { toLngLat } = ds.proj;

    // Grid extent in local metres.
    const feats = [...(ds.layers[extent]?.features || []), ...(ds.layers[ds.config.indoor?.buildingsLayer || 'buildings']?.features || [])];
    let [ex0, ey0, ex1, ey1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of feats) {
      const b = f.bbox?.xy;
      if (!b) continue;
      ex0 = Math.min(ex0, b[0]); ey0 = Math.min(ey0, b[1]); ex1 = Math.max(ex1, b[2]); ey1 = Math.max(ey1, b[3]);
    }
    if (!Number.isFinite(ex0)) { ds.warnings.push(`${name}: no ${extent} features to size the grid`); return; }
    const x0 = Math.floor((ex0 - pad) / cell) * cell, y0 = Math.floor((ey0 - pad) / cell) * cell;
    const nx = Math.ceil((ex1 + pad - x0) / cell) + 1, ny = Math.ceil((ey1 + pad - y0) / cell) + 1;

    // The DEM window covering it, read once at full resolution.
    const image = await (await fromUrl(dem.url)).getImage();
    const [ox, oy] = image.getOrigin();
    const [rx, ry] = image.getResolution();
    const nodata = image.getGDALNoData();
    const corners = [[x0, y0], [x0 + (nx - 1) * cell, y0], [x0, y0 + (ny - 1) * cell], [x0 + (nx - 1) * cell, y0 + (ny - 1) * cell]]
      .map((p) => toDem(toLngLat(p)))
      .map(([X, Y]) => [(X - ox) / rx, (Y - oy) / ry]);
    const c0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 4, r0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 4;
    const w = Math.ceil(Math.max(...corners.map((c) => c[0]))) + 4 - c0, h = Math.ceil(Math.max(...corners.map((c) => c[1]))) + 4 - r0;
    const [px] = await image.readRasters({ window: [c0, r0, c0 + w, r0 + h] });
    const valid = (v) => v !== nodata && Number.isFinite(v) && v > -1000;
    // Local metres -> fractional pixel (pixel centres at .5).
    const toPx = (p) => { const [X, Y] = toDem(toLngLat(p)); return [(X - ox) / rx - c0, (Y - oy) / ry - r0]; };

    // Mean of the valid pixels within r of (u, v); NaN if none.
    const mean = (u, v, r) => {
      let s = 0, n = 0;
      for (let row = Math.max(0, Math.floor(v - r)); row <= Math.min(h - 1, Math.floor(v + r)); row++) {
        for (let col = Math.max(0, Math.floor(u - r)); col <= Math.min(w - 1, Math.floor(u + r)); col++) {
          const z = px[row * w + col];
          if (valid(z)) { s += z; n++; }
        }
      }
      return n ? s / n : NaN;
    };

    const grid = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [u, v] = toPx([x0 + i * cell, y0 + j * cell]);
      grid[j * nx + i] = mean(u, v, cell / 2);
    }
    // Fill gaps (water, missing returns) from their neighbours; anything left is sea level.
    let gaps = grid.reduce((n, z) => n + Number.isNaN(z), 0);
    const filled = gaps;
    for (let pass = 0; gaps && pass < 200; pass++) {
      const next = grid.slice();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (!Number.isNaN(grid[j * nx + i])) continue;
        let s = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          const z = a >= 0 && a < nx && b >= 0 && b < ny ? grid[b * nx + a] : NaN;
          if (!Number.isNaN(z)) { s += z; n++; }
        }
        if (n) { next[j * nx + i] = s / n; gaps--; }
      }
      grid.set(next);
    }
    for (let k = 0; k < grid.length; k++) if (Number.isNaN(grid[k])) grid[k] = 0;

    // Ground level of some polygons, from a ring just outside them (NaN if the DEM has nothing there).
    const groundOf = (polys) => {
      const zs = [];
      for (const path of offset(toPaths(polys), ring)) {
        for (let k = 0; k < path.length; k++) {
          const a = path[k], c = path[(k + 1) % path.length];
          const len = Math.hypot(c.X - a.X, c.Y - a.Y) / 1000;
          for (let t = 0; t < len; t += 1) {
            const [u, v] = toPx([(a.X + ((c.X - a.X) * t) / len) / 1000, (a.Y + ((c.Y - a.Y) * t) / len) / 1000]);
            const z = mean(u, v, 0.5);
            if (!Number.isNaN(z)) zs.push(z);
          }
        }
      }
      if (!zs.length) return NaN;
      zs.sort((p, q) => p - q);
      return Math.round(zs[Math.floor(percentile * (zs.length - 1))] * 10) / 10;
    };
    // Polygons whose boxes touch are one structure; separate ones (a housing complex mapped as one
    // building) each get their own ground, in `grounds`, parallel to the polygons. Not buildings
    // with floor plans: their wings share levels (and skyways), so they share one ground.
    const parts = (polys) => {
      const box = polys.map((p) => bboxOfRing(p.outer.xy));
      const group = polys.map((_, i) => i);
      const root = (i) => (group[i] === i ? i : (group[i] = root(group[i])));
      for (let i = 0; i < polys.length; i++) {
        for (let k = i + 1; k < polys.length; k++) {
          const [a, b] = [box[i], box[k]];
          if (a[0] - touch <= b[2] && b[0] - touch <= a[2] && a[1] - touch <= b[3] && b[1] - touch <= a[3]) group[root(i)] = root(k);
        }
      }
      return polys.map((_, i) => root(i));
    };

    const bl = ds.layers[ds.config.indoor?.buildingsLayer || 'buildings']?.features || [];
    let grounded = 0, split = 0;
    for (const b of bl) {
      if (b.geom?.type !== 'polygon') continue;
      const all = overrides[b.props.code] ?? groundOf(b.geom.polys);
      if (Number.isNaN(all)) continue;
      b.props.ground = all;
      grounded++;
      if (b.props.levels?.length) continue;
      const ids = parts(b.geom.polys);
      if (new Set(ids).size < 2) continue;
      const byPart = new Map();
      for (const id of new Set(ids)) byPart.set(id, groundOf(b.geom.polys.filter((_, i) => ids[i] === id)));
      b.props.grounds = ids.map((id) => (Number.isNaN(byPart.get(id)) ? all : byPart.get(id)));
      split++;
    }

    const ref = Math.round(grid[Math.round(-y0 / cell) * nx + Math.round(-x0 / cell)]);
    ds.extras[name] = { source: dem.title, url: dem.url, licence: dem.licence, cell, x0, y0, nx, ny, ref, heights: Array.from(grid, (z) => Math.round(z * 10)) };
    const [lo, hi] = grid.reduce(([a, b], z) => [Math.min(a, z), Math.max(b, z)], [Infinity, -Infinity]);
    ctx.log(`${name}: ${nx}×${ny} grid at ${cell} m, ${lo.toFixed(1)}–${hi.toFixed(1)} m, ${filled} gaps filled; ground on ${grounded} buildings (${split} in separate parts)`);
  }
  return terrainEnricher;
}
