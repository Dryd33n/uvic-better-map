import type { WalkGraph } from "./types";

type Point = [number, number];

// Each end of a route walks straight (indoors, or across open ground) to any network edge within
// this many metres of the nearest one, so a route can leave a building on whichever side is best.
const LEG_SLACK = 30;
// An end in a building with mapped entrances walks to one of them instead, and from it onto the
// network within this many metres of the nearest edge (entrances are usually on it).
const DOOR_SLACK = 5;
// Ends this close together walk straight to each other rather than via the network (unless
// either has entrances to go through).
const DIRECT = 40;

/** A walk from one point to another: total metres and the path, both ends included. */
export interface Route {
  distance: number;
  path: Point[];
}

// The ways onto the network from a point: each edge within reach, at the point on it nearest,
// through an entrance (`via`) if it has any.
interface Access {
  at: Point;
  leg: number;
  a: number;
  b: number;
  via?: Point;
}

/** The walking network, with shortest walks from one point to many. */
export class Walker {
  private xy: Float64Array;
  private adjacent: { to: number; len: number }[][];
  private edges: [number, number][] = [];

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
  }

  private node = (i: number): Point => [this.xy[2 * i], this.xy[2 * i + 1]];

  private near(p: Point, slack: number): Access[] {
    const all = this.edges.map(([a, b]) => {
      const [ax, ay] = this.node(a), [bx, by] = this.node(b);
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      const at: Point = [ax + t * dx, ay + t * dy];
      return { at, leg: Math.hypot(p[0] - at[0], p[1] - at[1]), a, b };
    });
    const nearest = Math.min(...all.map((x) => x.leg));
    return all.filter((x) => x.leg <= nearest + slack);
  }

  private access(p: Point, doors?: Point[]): Access[] {
    if (!doors?.length) return this.near(p, LEG_SLACK);
    return doors.flatMap((d) => this.near(d, DOOR_SLACK).map((s) => ({ ...s, via: d, leg: Math.hypot(p[0] - d[0], p[1] - d[1]) + s.leg })));
  }

  /**
   * Shortest walks from `from` to each of `to` (null where the network can't reach): walk to the
   * network, along it, and off it again; through an end's entrances (`fromDoors`, `toDoors[i]`)
   * where its building has them. Ends close together walk straight.
   */
  routes(from: Point, to: Point[], fromDoors?: Point[], toDoors: (Point[] | undefined)[] = []): (Route | null)[] {
    if (!this.edges.length) return to.map(() => null);
    const n = this.adjacent.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    // How each seeded node's walk got onto the network (an entrance, then the point on the edge).
    const entry = new Map<number, Point[]>();
    const seed = (i: number, d: number, way: Point[]) => {
      if (d >= dist[i]) return;
      dist[i] = d;
      prev[i] = -1;
      entry.set(i, way);
    };
    for (const s of this.access(from, fromDoors)) {
      const [a, b] = [this.node(s.a), this.node(s.b)];
      const way = s.via ? [s.via, s.at] : [s.at];
      seed(s.a, s.leg + Math.hypot(a[0] - s.at[0], a[1] - s.at[1]), way);
      seed(s.b, s.leg + Math.hypot(b[0] - s.at[0], b[1] - s.at[1]), way);
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
    const walkBack = (i: number): Point[] => {
      const path: Point[] = [];
      for (let k = i; k >= 0; k = prev[k]) {
        path.push(this.node(k));
        if (prev[k] < 0) path.push(...[...entry.get(k)!].reverse());
      }
      return path.reverse();
    };

    return to.map((p, t) => {
      let best: Route | null = null;
      const direct = Math.hypot(p[0] - from[0], p[1] - from[1]);
      if (direct <= DIRECT && !fromDoors?.length && !toDoors[t]?.length) best = { distance: direct, path: [from, p] };
      for (const s of this.access(p, toDoors[t])) {
        for (const i of [s.a, s.b]) {
          const q = this.node(i);
          const d = dist[i] + Math.hypot(q[0] - s.at[0], q[1] - s.at[1]) + s.leg;
          if (d < (best?.distance ?? Infinity)) best = { distance: d, path: [from, ...walkBack(i), s.at, ...(s.via ? [s.via] : []), p] };
        }
      }
      return best;
    });
  }
}
