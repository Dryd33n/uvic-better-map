import type { WalkGraph } from "./types";

type Point = [number, number];
/** A point on a walk, with its scene height where it's known (on a floor indoors); else on the ground. */
export type Waypoint = [x: number, y: number, h?: number];

// Each end of a route walks straight (indoors, or across open ground) to any network edge within
// this many metres of the nearest one, so a route can leave a building on whichever side is best.
const LEG_SLACK = 30;
// An end in a building with mapped entrances walks to one of them instead, and from it onto the
// network within this many metres of the nearest edge (entrances are usually on it).
const DOOR_SLACK = 5;
// Ends this close together walk straight to each other rather than via the network (unless
// either has entrances to go through).
const DIRECT = 40;
// Edges are indexed on a grid of cells this many metres across, so finding the ones near a point
// looks at the cells around it rather than the whole network.
const GRID = 50;

/**
 * A walk from one point to another: total metres and the path, both ends included. Storeys
 * climbed on the way (indoors, up or down) are in the distance at the indoor legs' rate, and
 * counted in `climb`.
 */
export interface Route {
  distance: number;
  path: Waypoint[];
  climb: number;
  /** Extra metres the doors used added to steer the choice (Door.penalty); not in the distance. */
  penalty: number;
}

/**
 * An entrance an end of a walk goes through, with the walk between them if it's known (through
 * the building's corridors): its metres and path, end to door on the way out, door to end on the
 * way in. Without one the end walks straight to the door.
 */
export interface Door {
  at: Point;
  leg?: number;
  path?: Waypoint[];
  /** Storeys up or down on the leg. */
  climb?: number;
  /** Metres added when choosing it (a less likely door), not to the walk's distance. */
  penalty?: number;
}

// The ways onto the network from a point: each edge within reach, at the point on it nearest,
// through an entrance if it has any.
interface Access {
  at: Point;
  leg: number;
  a: number;
  b: number;
  door?: Door;
}

/** The walking network, with shortest walks from one point to many. */
export class Walker {
  private xy: Float64Array;
  private adjacent: { to: number; len: number }[][];
  private edges: [number, number][] = [];
  // The grid: its corner and size in cells, and the edges passing through each cell.
  private gx = 0;
  private gy = 0;
  private gw = 0;
  private gh = 0;
  private cells: number[][] = [];
  // Marks the edges a search has measured (by search number), so each is measured once.
  private seen = new Uint32Array(0);
  private search = 0;

  constructor(g: WalkGraph) {
    this.xy = Float64Array.from(g.nodes);
    this.adjacent = Array.from({ length: g.nodes.length / 2 }, () => []);
    for (let i = 0; i < g.edges.length; i += 2) {
      const [a, b] = [g.edges[i], g.edges[i + 1]];
      const len = Math.hypot(this.xy[2 * a] - this.xy[2 * b], this.xy[2 * a + 1] - this.xy[2 * b + 1]);
      this.adjacent[a].push({ to: b, len });
      this.adjacent[b].push({ to: a, len });
      this.edges.push([a, b]);
    }
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.xy.length; i += 2) {
      [x0, x1] = [Math.min(x0, this.xy[i]), Math.max(x1, this.xy[i])];
      [y0, y1] = [Math.min(y0, this.xy[i + 1]), Math.max(y1, this.xy[i + 1])];
    }
    if (!this.edges.length) return;
    [this.gx, this.gy] = [x0, y0];
    this.gw = Math.floor((x1 - x0) / GRID) + 1;
    this.gh = Math.floor((y1 - y0) / GRID) + 1;
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    this.seen = new Uint32Array(this.edges.length);
    // Each edge goes in every cell its bounding box touches (a little more than it passes through).
    this.edges.forEach(([a, b], e) => {
      const [ax, ay] = this.node(a), [bx, by] = this.node(b);
      const [i0, i1] = [this.col(Math.min(ax, bx)), this.col(Math.max(ax, bx))];
      const [j0, j1] = [this.row(Math.min(ay, by)), this.row(Math.max(ay, by))];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.gw + i].push(e);
    });
  }

  private node = (i: number): Point => [this.xy[2 * i], this.xy[2 * i + 1]];
  private col = (x: number) => Math.max(0, Math.min(this.gw - 1, Math.floor((x - this.gx) / GRID)));
  private row = (y: number) => Math.max(0, Math.min(this.gh - 1, Math.floor((y - this.gy) / GRID)));

  // The edges within `slack` metres of the nearest one to p: the grid's cells in rings outward
  // from p's, until a ring is too far to hold anything within reach.
  private near(p: Point, slack: number): Access[] {
    const found: Access[] = [];
    let nearest = Infinity;
    const stamp = ++this.search;
    const [ci, cj] = [Math.floor((p[0] - this.gx) / GRID), Math.floor((p[1] - this.gy) / GRID)];
    // Rings past this one hold no cell of the grid.
    const last = Math.max(ci, cj, this.gw - 1 - ci, this.gh - 1 - cj);
    for (let r = 0; r <= last; r++) {
      // Every cell in ring r is at least (r - 1) cells from p.
      if ((r - 1) * GRID > nearest + slack) break;
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= this.gh) continue;
        const edge = j === cj - r || j === cj + r;
        for (let i = ci - r; i <= ci + r; i += edge ? 1 : 2 * r || 1) {
          if (i < 0 || i >= this.gw) continue;
          for (const e of this.cells[j * this.gw + i]) {
            if (this.seen[e] === stamp) continue;
            this.seen[e] = stamp;
            const [a, b] = this.edges[e];
            const [ax, ay] = this.node(a), [bx, by] = this.node(b);
            const dx = bx - ax, dy = by - ay;
            const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
            const at: Point = [ax + t * dx, ay + t * dy];
            const leg = Math.hypot(p[0] - at[0], p[1] - at[1]);
            nearest = Math.min(nearest, leg);
            if (leg <= nearest + slack) found.push({ at, leg, a, b });
          }
        }
      }
    }
    return found.filter((x) => x.leg <= nearest + slack);
  }

  private access(p: Point, doors?: Door[]): Access[] {
    if (!doors?.length) return this.near(p, LEG_SLACK);
    return doors.flatMap((door) =>
      this.near(door.at, DOOR_SLACK).map((s) => ({ ...s, door, leg: (door.leg ?? Math.hypot(p[0] - door.at[0], p[1] - door.at[1])) + s.leg + (door.penalty ?? 0) })),
    );
  }

  /**
   * Shortest walks from `from` to each of `to` (null where the network can't reach): walk to the
   * network, along it, and off it again; through an end's entrances (`fromDoors`, `toDoors[i]`)
   * where its building has them. Ends close together walk straight.
   */
  routes(from: Waypoint, to: Waypoint[], fromDoors?: Door[], toDoors: (Door[] | undefined)[] = []): (Route | null)[] {
    if (!this.edges.length) return to.map(() => null);
    const start: Point = [from[0], from[1]];
    const n = this.adjacent.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    // How each seeded node's walk got onto the network: from the start (through a door), to the
    // point on the edge.
    const entry = new Map<number, { way: Waypoint[]; climb: number; penalty: number }>();
    const seed = (i: number, d: number, way: Waypoint[], climb: number, penalty: number) => {
      if (d >= dist[i]) return;
      dist[i] = d;
      prev[i] = -1;
      entry.set(i, { way, climb, penalty });
    };
    for (const s of this.access(start, fromDoors)) {
      const [a, b] = [this.node(s.a), this.node(s.b)];
      const way: Waypoint[] = [...(s.door ? (s.door.path ?? [from, s.door.at]) : [from]), s.at];
      const [climb, penalty] = [s.door?.climb ?? 0, s.door?.penalty ?? 0];
      seed(s.a, s.leg + Math.hypot(a[0] - s.at[0], a[1] - s.at[1]), way, climb, penalty);
      seed(s.b, s.leg + Math.hypot(b[0] - s.at[0], b[1] - s.at[1]), way, climb, penalty);
    }
    // Dijkstra over a binary heap of [distance, node].
    const heap: [number, number][] = [];
    const push = (d: number, i: number) => {
      heap.push([d, i]);
      for (let k = heap.length - 1; k > 0; ) {
        const up = (k - 1) >> 1;
        if (heap[up][0] <= heap[k][0]) break;
        [heap[up], heap[k]] = [heap[k], heap[up]];
        k = up;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const [l, r] = [2 * k + 1, 2 * k + 2];
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    for (let i = 0; i < n; i++) if (dist[i] < Infinity) push(dist[i], i);
    while (heap.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      for (const { to, len } of this.adjacent[i]) {
        if (d + len >= dist[to]) continue;
        dist[to] = d + len;
        prev[to] = i;
        entry.delete(to);
        push(dist[to], to);
      }
    }
    // The walk to node i, and the storeys climbed and penalty on its way out of the start.
    const walkBack = (i: number): { path: Waypoint[]; climb: number; penalty: number } => {
      const path: Waypoint[] = [];
      let climb = 0, penalty = 0;
      for (let k = i; k >= 0; k = prev[k]) {
        path.push(this.node(k));
        if (prev[k] >= 0) continue;
        const e = entry.get(k)!;
        path.push(...[...e.way].reverse());
        [climb, penalty] = [e.climb, e.penalty];
      }
      return { path: path.reverse(), climb, penalty };
    };

    return to.map((p, t) => {
      let best: Route | null = null;
      const end: Point = [p[0], p[1]];
      const direct = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (direct <= DIRECT && !fromDoors?.length && !toDoors[t]?.length) best = { distance: direct, path: [from, p], climb: 0, penalty: 0 };
      for (const s of this.access(end, toDoors[t])) {
        for (const i of [s.a, s.b]) {
          const q = this.node(i);
          const d = dist[i] + Math.hypot(q[0] - s.at[0], q[1] - s.at[1]) + s.leg;
          if (d >= (best ? best.distance + best.penalty : Infinity)) continue;
          const way: Waypoint[] = s.door ? (s.door.path ?? [s.door.at, p]) : [p];
          const back = walkBack(i);
          const penalty = back.penalty + (s.door?.penalty ?? 0);
          best = { distance: d - penalty, path: [...back.path, s.at, ...way], climb: back.climb + (s.door?.climb ?? 0), penalty };
        }
      }
      return best;
    });
  }
}
