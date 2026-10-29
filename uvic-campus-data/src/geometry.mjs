// Geometry helpers. Pure functions, no dependencies, browser + Node.

export const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

// Equirectangular projection around an origin. Accurate to centimetres across a campus.
export function makeProjector([lon0, lat0]) {
  const MX = 111320 * Math.cos((lat0 * Math.PI) / 180); // metres per degree of longitude
  const MY = 110574;                                    // metres per degree of latitude
  return {
    origin: [lon0, lat0],
    toLocal: ([lon, lat]) => [(lon - lon0) * MX, (lat - lat0) * MY],
    toLngLat: ([x, y]) => [lon0 + x / MX, lat0 + y / MY],
  };
}

// Shoelace area of an open ring [[x,y],...]. Positive = counter-clockwise.
export function signedArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

export function pointInRing([px, py], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Turn loose rings (any winding, outers and holes mixed, lon/lat) into polygons.
 * Winding is ignored: a ring inside another polygon's outer ring is its hole,
 * otherwise it starts a new polygon. Works for Esri (CW outers) and GeoJSON (CCW outers).
 * Returns [{ outer: {ll, xy, area}, holes: [{ll, xy, area}] }] with open rings.
 */
export function assemblePolygons(rawRings, proj, { metres = 1, lngLat = 7, minArea = 0.5 } = {}) {
  const rings = [];
  for (const raw of rawRings || []) {
    const ll = [], xy = [];
    for (const p of raw) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const [x, y] = proj.toLocal(p);
      const q = [round(x, metres), round(y, metres)];
      const last = xy[xy.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      xy.push(q);
      ll.push([round(p[0], lngLat), round(p[1], lngLat)]);
    }
    if (xy.length > 1 && xy[0][0] === xy[xy.length - 1][0] && xy[0][1] === xy[xy.length - 1][1]) { xy.pop(); ll.pop(); }
    if (xy.length < 3) continue;
    const area = Math.abs(signedArea(xy));
    if (area < minArea) continue;
    rings.push({ ll, xy, area });
  }
  rings.sort((a, b) => b.area - a.area);
  const polys = [];
  for (const r of rings) {
    const owner = polys
      .filter((p) => pointInRing(r.xy[0], p.outer.xy) && !p.holes.some((h) => pointInRing(r.xy[0], h.xy)))
      .sort((a, b) => a.outer.area - b.outer.area)[0];
    if (owner) owner.holes.push(r); else polys.push({ outer: r, holes: [] });
  }
  return polys;
}

export function bboxOfPolys(polys, key = 'xy') {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p.outer[key]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Area-weighted centroid of the largest polygon's outer ring, nudged inside if needed. Local metres.
export function labelPoint(polys) {
  const best = polys.reduce((a, b) => (!a || b.outer.area > a.outer.area ? b : a), null);
  if (!best) return null;
  const r = best.outer.xy;
  let cx = 0, cy = 0, A = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const cr = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    A += cr; cx += (r[j][0] + r[i][0]) * cr; cy += (r[j][1] + r[i][1]) * cr;
  }
  if (Math.abs(A) < 1e-9) return r[0];
  const c = [cx / (3 * A), cy / (3 * A)];
  return pointInRing(c, r) && !best.holes.some((h) => pointInRing(c, h.xy)) ? c : r[0];
}

export function pointInPolys(pt, polys, key = 'xy') {
  return polys.some((p) => pointInRing(pt, p.outer[key]) && !p.holes.some((h) => pointInRing(pt, h[key])));
}

// GeoJSON (RFC 7946) rings: closed, outer counter-clockwise, holes clockwise.
export function geojsonRing(ll, outer) {
  const ccw = signedArea(ll) > 0;
  const r = ccw === outer ? ll.slice() : ll.slice().reverse();
  r.push(r[0]);
  return r;
}

// Clean polylines: drop repeated vertices (at output precision) and paths shorter than 2 points.
export function cleanPaths(rawPaths, proj, { metres = 1, lngLat = 7 } = {}) {
  const out = [];
  for (const raw of rawPaths || []) {
    const ll = [], xy = [];
    for (const p of raw) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const [x, y] = proj.toLocal(p);
      const q = [round(x, metres), round(y, metres)];
      const last = xy[xy.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      xy.push(q);
      ll.push([round(p[0], lngLat), round(p[1], lngLat)]);
    }
    if (xy.length >= 2) out.push({ ll, xy, length: xy.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - xy[i - 1][0], q[1] - xy[i - 1][1]) : 0), 0) });
  }
  return out;
}

export function bboxOfPoints(lists) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of lists) for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
