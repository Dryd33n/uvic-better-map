// Polygon booleans and offsets on local-metre polygons, via Clipper (integer coordinates).
// Paths are Clipper paths: [{ X, Y }] in millimetres, outers counter-clockwise, holes clockwise.

import ClipperLib from 'clipper-lib';

const C = ClipperLib;
const SCALE = 1000; // metres -> mm
const FILL = C.PolyFillType.pftNonZero;

const toPath = (xy) => xy.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const orient = (path, outer) => (C.Clipper.Orientation(path) === outer ? path : path.reverse());

/** Pipeline polygons ([{ outer: { xy }, holes: [{ xy }] }]) -> Clipper paths. */
export function toPaths(polys) {
  return polys.flatMap((p) => [orient(toPath(p.outer.xy), true), ...p.holes.map((h) => orient(toPath(h.xy), false))]);
}

function run(type, subject, clip = []) {
  const c = new C.Clipper();
  c.AddPaths(subject, C.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(type, out, FILL, FILL);
  return C.Clipper.CleanPolygons(out, 0.02 * SCALE);
}

export const union = (paths) => run(C.ClipType.ctUnion, paths);
export const difference = (a, b) => run(C.ClipType.ctDifference, a, b);
export const xor = (a, b) => run(C.ClipType.ctXor, a, b);
export const intersection = (a, b) => run(C.ClipType.ctIntersection, a, b);

/** Drop holes smaller than minArea square metres (light wells, unmapped shafts). */
export const fillHoles = (paths, minArea) => paths.filter((p) => C.Clipper.Area(p) >= 0 || -C.Clipper.Area(p) / SCALE ** 2 >= minArea);

/** Grow (metres > 0) or shrink (< 0) with square corners. */
export function offset(paths, metres) {
  const co = new C.ClipperOffset(2, 0.25 * SCALE);
  co.AddPaths(paths, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, metres * SCALE);
  return out;
}
/** Fill gaps and notches narrower than 2 × metres. */
export const close = (paths, metres) => offset(offset(paths, metres), -metres);
/** Drop parts narrower than 2 × metres. */
export const open = (paths, metres) => offset(offset(paths, -metres), metres);

/** Total area in square metres (holes subtract). */
export const area = (paths) => paths.reduce((a, p) => a + C.Clipper.Area(p), 0) / SCALE ** 2;

/** Clipper paths -> local-format polygons [[outer, ...holes]] of flat [x0, y0, x1, y1, ...] rings. */
export function toLocalPolys(paths, minArea = 0) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, FILL, FILL);
  const flat = (path) => path.flatMap(({ X, Y }) => [X / SCALE, Y / SCALE]);
  return C.JS.PolyTreeToExPolygons(tree)
    .filter((p) => Math.abs(C.Clipper.Area(p.outer)) / SCALE ** 2 >= minArea)
    .map((p) => [flat(p.outer), ...p.holes.map(flat)]);
}
