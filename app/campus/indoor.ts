import type { FloorFile, LocalRoom } from "./types";

type Point = [number, number];

/**
 * A spot in a building: where, on which level. A door snaps to a corridor if one is near, and the
 * room it might open into isn't free to cross (the rooms a walk starts and ends in are).
 */
export interface Place {
  at: Point;
  level: string;
  door?: boolean;
}

/**
 * A walk through a building: metres, with each storey up or down a stair or lift counted as
 * STOREY_COST (and in `climb`), and the spots it passes, by level.
 */
export interface IndoorRoute {
  distance: number;
  path: Place[];
  climb: number;
}

// Floors are walked on a grid of cells this many metres across.
const CELL = 0.5;
// Corridors reach this many cells past their outline, closing the wall gap to the next corridor
// and the rooms beside them; other rooms (stairs and lifts too) reach this many, to their neighbours.
const CORRIDOR_REACH = 2;
const ROOM_REACH = 2;
// Walking through a room that isn't a corridor costs this many times as much, so routes keep to
// corridors and only cross rooms (a lobby, a suite) where nothing else connects. The rooms at
// either end of a walk are free to cross.
const ROOM_COST = 8;
// Stairs and lifts are walked into to change floors, not through as a shortcut.
const STAIR_COST = 3;
// Corridors cost up to 1 + HUG within CLEAR metres of a wall, so walks keep to the middle.
const HUG = 2;
const CLEAR = 1;
// A corridor's reach (above) into the room beside it costs more than any corridor.
const EDGE_COST = 4;
// A straightened stretch keeps at least this far from walls (or as far as its ends are, in a
// corridor narrower than twice this).
const MIN_CLEAR = 0.5;
// Each storey up or down a stair or lift counts as this many metres.
export const STOREY_COST = 25;
// A spot finds the nearest walkable cell within this many metres; a door counts a cell in a room
// (not a corridor) as this much further.
const SNAP = 6;
const DOOR_ROOM = 4;
// A door the corridors don't reach is walked to from the corridor cell that makes the shortest
// walk and has a straight line to it over at most OUT_ROOMS mapped room (one at the plan's edge,
// a hall or a gym); the best OUT_TRIES cells are tried.
const OUT_TRIES = 400;
const OUT_ROOMS = 1;
const ROOM_CORRIDOR = 0;
const ROOM_STAIRS = 4;
// The eight moves to a neighbouring cell, and half their length (a step costs the mean of the
// two cells' costs).
const STEP_I = [1, -1, 0, 0, 1, 1, -1, -1];
const STEP_J = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP_LEN = STEP_I.map((di, s) => (Math.hypot(di, STEP_J[s]) * CELL) / 2);
// The search's queue groups distances this many metres apart.
const BUCKET = CELL / 2;

/**
 * One building's floors as a walking grid: corridors cheap, other rooms dear, walls closed; levels
 * joined at stairs and lifts that share a name (S3 on Level 1 and Level 2).
 */
export class Indoor {
  private nx: number;
  private ny: number;
  private x0: number;
  private y0: number;
  private levels: string[];
  private elevs: number[];
  // Per level, per cell: 0 blocked, else the cost per metre; the room the cell lies in (-1 none);
  // whether it's open corridor (in a corridor or the wall gap between two), and if so how far it is
  // from anything that isn't (metres).
  private cost: Float32Array[];
  private room: Int32Array[];
  private open: Uint8Array[] = [];
  private clearance: Float32Array[] = [];
  private rooms: LocalRoom[][];
  // Per level, per room: whether it's a corridor.
  private cheap: Uint8Array[] = [];
  // Stairs and lifts: [level index, cell] pairs joined between consecutive levels.
  private links = new Map<number, { to: number; len: number }[]>();
  // Which nodes have links (a fast check in the search).
  private linked: Uint8Array;

  constructor(file: FloorFile) {
    const floors = [...file.floors].sort((a, b) => a.elev - b.elev);
    this.levels = floors.map((f) => f.id);
    this.elevs = floors.map((f) => f.elev);
    this.rooms = floors.map((f) => f.rooms);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of floors)
      for (const r of f.rooms)
        for (const p of r.polys)
          for (let i = 0; i < p[0].length; i += 2) {
            [x0, x1] = [Math.min(x0, p[0][i]), Math.max(x1, p[0][i])];
            [y0, y1] = [Math.min(y0, p[0][i + 1]), Math.max(y1, p[0][i + 1])];
          }
    const margin = (CORRIDOR_REACH + 1) * CELL;
    this.x0 = x0 - margin;
    this.y0 = y0 - margin;
    this.nx = Math.max(1, Math.ceil((x1 - x0 + 2 * margin) / CELL));
    this.ny = Math.max(1, Math.ceil((y1 - y0 + 2 * margin) / CELL));
    this.cost = floors.map(() => new Float32Array(this.nx * this.ny));
    this.room = floors.map(() => new Int32Array(this.nx * this.ny).fill(-1));
    floors.forEach((f, l) => this.rasterize(l, f.rooms));

    // Stairs and lifts by name, joined level to level at the cell nearest each one's label point.
    const shafts = new Map<string, { level: number; cell: number }[]>();
    floors.forEach((f, l) => {
      for (const r of f.rooms) {
        if (r.t !== ROOM_STAIRS || !r.n) continue;
        const cell = this.snap(l, r.at);
        if (cell >= 0) shafts.set(r.n, [...(shafts.get(r.n) ?? []), { level: l, cell }]);
      }
    });
    const N = this.nx * this.ny;
    for (const stops of shafts.values()) {
      for (let k = 1; k < stops.length; k++) {
        const [a, b] = [stops[k - 1], stops[k]];
        const len = STOREY_COST * this.storeys(a.level, b.level);
        const [u, v] = [a.level * N + a.cell, b.level * N + b.cell];
        this.links.set(u, [...(this.links.get(u) ?? []), { to: v, len }]);
        this.links.set(v, [...(this.links.get(v) ?? []), { to: u, len }]);
      }
    }
    this.linked = new Uint8Array(N * floors.length);
    for (const n of this.links.keys()) this.linked[n] = 1;
  }

  // Marks a level's cells: each room's inside (scanline fill), then grown by its reach; then how far
  // each open corridor cell is from a wall, and its cost for that. Plain index loops: this runs over
  // every cell of every level when a building's grid is built.
  private rasterize(l: number, rooms: LocalRoom[]) {
    const { nx, ny } = this;
    const cheap = (r: LocalRoom) => r.t === ROOM_CORRIDOR;
    const inside = rooms.map((r) => this.fill(r));
    const cost = this.cost[l], room = this.room[l];
    const isCheap = (this.cheap[l] = Uint8Array.from(rooms, (r) => (cheap(r) ? 1 : 0)));
    // Each cell within `reach` of a room's cells gets cost `c` (or `edge` where it lies in a dear
    // room, if given), unless it already has a lower one.
    const grow = (cells: number[], reach: number, c: number, edge = 0) => {
      for (const k of cells) {
        const i = k % nx, j = (k - i) / nx;
        const i0 = Math.max(0, i - reach), i1 = Math.min(nx - 1, i + reach);
        const j0 = Math.max(0, j - reach), j1 = Math.min(ny - 1, j + reach);
        for (let jj = j0; jj <= j1; jj++)
          for (let q = jj * nx + i0, qe = jj * nx + i1; q <= qe; q++) {
            const v = edge && room[q] >= 0 && !isCheap[room[q]] ? edge : c;
            if (!cost[q] || cost[q] > v) cost[q] = v;
          }
      }
    };
    // Dear rooms first, so corridors win where they overlap.
    rooms.forEach((r, n) => {
      if (cheap(r)) return;
      grow(inside[n], ROOM_REACH, r.t === ROOM_STAIRS ? STAIR_COST : ROOM_COST);
      for (const k of inside[n]) room[k] = n;
    });
    // A corridor's reach across a wall gap is cheap, but where it lies in a room beside the
    // corridor it costs EDGE_COST, so walks keep to the corridor rather than along its rooms.
    rooms.forEach((r, n) => {
      if (cheap(r)) grow(inside[n], CORRIDOR_REACH, 1, EDGE_COST);
    });
    rooms.forEach((r, n) => {
      if (!cheap(r)) return;
      for (const k of inside[n]) {
        room[k] = n;
        cost[k] = 1;
      }
    });
    // Open corridor, its distance to the nearest cell that isn't (two-pass chamfer, in cells), and
    // the cost of walking near a wall.
    const size = nx * ny;
    const open = (this.open[l] = new Uint8Array(size));
    const d = new Float32Array(size);
    for (let k = 0; k < size; k++) {
      open[k] = cost[k] === 1 && (room[k] < 0 || isCheap[room[k]]) ? 1 : 0;
      d[k] = open[k] ? Infinity : 0;
    }
    // Off the grid counts as a wall one step away.
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : d[j * nx + i]);
    const S = Math.SQRT2;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (open[k]) d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + S, at(i + 1, j - 1) + S);
      }
    for (let j = ny - 1; j >= 0; j--)
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        if (open[k]) d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + S, at(i - 1, j + 1) + S);
      }
    const clearance = (this.clearance[l] = new Float32Array(size));
    for (let k = 0; k < size; k++) {
      if (!open[k]) continue;
      clearance[k] = Math.max(0, (d[k] - 0.5) * CELL);
      cost[k] = 1 + (HUG * Math.max(0, CLEAR - clearance[k])) / CLEAR;
    }
  }

  // The cells whose centres lie inside a room (holes excluded): even-odd scanlines over all rings.
  private fill(r: LocalRoom): number[] {
    const out: number[] = [];
    for (const p of r.polys) {
      let [lo, hi] = [Infinity, -Infinity];
      for (let i = 1; i < p[0].length; i += 2) [lo, hi] = [Math.min(lo, p[0][i]), Math.max(hi, p[0][i])];
      const j0 = Math.max(0, Math.ceil((lo - this.y0) / CELL - 0.5)), j1 = Math.min(this.ny - 1, Math.floor((hi - this.y0) / CELL - 0.5));
      for (let j = j0; j <= j1; j++) {
        const y = this.y0 + (j + 0.5) * CELL;
        const xs: number[] = [];
        for (const ring of p)
          for (let i = 0, k = ring.length - 2; i < ring.length; k = i, i += 2) {
            const [ax, ay, bx, by] = [ring[k], ring[k + 1], ring[i], ring[i + 1]];
            if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
          }
        xs.sort((a, b) => a - b);
        for (let m = 0; m + 1 < xs.length; m += 2) {
          const i0 = Math.max(0, Math.ceil((xs[m] - this.x0) / CELL - 0.5)), i1 = Math.min(this.nx - 1, Math.floor((xs[m + 1] - this.x0) / CELL - 0.5));
          for (let i = i0; i <= i1; i++) out.push(j * this.nx + i);
        }
      }
    }
    return out;
  }

  // Storeys between two levels (by index): a mezzanine counts as one.
  private storeys(a: number, b: number): number {
    return Math.max(1, Math.round(Math.abs(this.elevs[b] - this.elevs[a]) / 4));
  }

  private centre(cell: number): Point {
    return [this.x0 + ((cell % this.nx) + 0.5) * CELL, this.y0 + (Math.floor(cell / this.nx) + 0.5) * CELL];
  }

  // The walkable cell nearest a point on a level (-1 if none within SNAP).
  private snap(l: number, [x, y]: Point, door = false): number {
    const ci = Math.floor((x - this.x0) / CELL), cj = Math.floor((y - this.y0) / CELL);
    const reach = Math.ceil(SNAP / CELL);
    let best = -1, bestD = Infinity;
    for (let dj = -reach; dj <= reach; dj++)
      for (let di = -reach; di <= reach; di++) {
        const [i, j] = [ci + di, cj + dj];
        if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
        const k = j * this.nx + i;
        if (!this.cost[l][k]) continue;
        // Prefer corridors a little: a spot in a wall sits on the corridor side.
        const d = Math.hypot(di, dj) * CELL + (this.open[l][k] ? 0 : door ? DOOR_ROOM : 0.5);
        if (d < bestD && d <= SNAP + (door ? DOOR_ROOM : 0)) [best, bestD] = [k, d];
      }
    return best;
  }

  /** Whether a level is in this building's plans. */
  has(level: string): boolean {
    return this.levels.includes(level);
  }

  /**
   * Shortest walks from one spot to each of several (null where unreachable), keeping to corridors:
   * other rooms only where nothing else connects, except the rooms the walk starts and ends in.
   */
  routes(from: Place, to: Place[]): (IndoorRoute | null)[] {
    const N = this.nx * this.ny, nx = this.nx;
    const lf = this.levels.indexOf(from.level);
    const start = lf < 0 ? -1 : this.snap(lf, from.at);
    if (start < 0) return to.map(() => null);
    const goals = to.map((p) => {
      const l = this.levels.indexOf(p.level);
      const c = l < 0 ? -1 : this.snap(l, p.at, p.door);
      return c < 0 ? -1 : l * N + c;
    });
    // This walk's costs: the grid's, with the end rooms free to cross.
    const w = new Float32Array(N * this.levels.length);
    this.cost.forEach((c, l) => w.set(c, l * N));
    for (const node of [lf * N + start, ...goals.filter((g, i) => g >= 0 && !to[i].door)]) {
      const l = Math.floor(node / N), r = this.room[l][node % N], rooms = this.room[l];
      if (r < 0 || this.cheap[l][r]) continue;
      for (let k = 0; k < N; k++) if (rooms[k] === r && w[l * N + k]) w[l * N + k] = 1;
    }

    const dist = new Float64Array(w.length).fill(Infinity);
    const prev = new Int32Array(w.length).fill(-1);
    const done = new Uint8Array(w.length);
    let remaining = new Set(goals.filter((g) => g >= 0)).size;
    const isGoal = new Uint8Array(w.length);
    for (const g of goals) if (g >= 0) isGoal[g] = 1;
    // Nodes queued in buckets of BUCKET metres (Dial's algorithm): far faster than a heap here, and
    // the order is out by at most a bucket, well under a cell.
    const buckets: number[][] = [];
    const push = (d: number, n: number) => (buckets[Math.floor(d / BUCKET)] ??= []).push(n);
    let cursor = 0;
    const pop = (): number => {
      for (; cursor < buckets.length; cursor++) {
        const b = buckets[cursor];
        if (b?.length) return b.pop()!;
      }
      return -1;
    };
    const s0 = lf * N + start;
    dist[s0] = 0;
    push(0, s0);
    const ny = this.ny;
    const linked = this.linked;
    while (remaining) {
      const n = pop();
      if (n < 0) break;
      if (done[n]) continue;
      done[n] = 1;
      if (isGoal[n]) remaining--;
      const d = dist[n], base = n - (n % N), k = n % N, i = k % nx, j = (k - i) / nx;
      const here = w[n];
      for (let s = 0; s < 8; s++) {
        const di = STEP_I[s], dj = STEP_J[s], len = STEP_LEN[s];
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = base + jj * nx + ii;
        if (!w[q] || done[q]) continue;
        // No cutting a corner past a blocked cell.
        if (di && dj && (!w[base + j * nx + ii] || !w[base + jj * nx + i])) continue;
        const nd = d + len * (here + w[q]);
        if (nd < dist[q]) {
          dist[q] = nd;
          prev[q] = n;
          push(nd, q);
        }
      }
      if (!linked[n]) continue;
      for (const { to, len } of this.links.get(n)!) {
        if (d + len < dist[to]) {
          dist[to] = d + len;
          prev[to] = n;
          push(d + len, to);
        }
      }
    }

    // A door the corridors don't reach (or that's off the plan: a plan covering part of its
    // building): out from the corridor cell on its level that makes the shortest walk, then
    // straight to it across space the plan doesn't map (OUT_TRIES).
    const outFrom = (p: Place): number => {
      const l = this.levels.indexOf(p.level);
      if (l < 0) return -1;
      const options: [number, number][] = [];
      for (let k = 0; k < N; k++) {
        const n = l * N + k;
        if (!done[n] || !this.open[l][k]) continue;
        const [x, y] = this.centre(k);
        options.push([dist[n] + Math.hypot(x - p.at[0], y - p.at[1]), n]);
      }
      options.sort((a, b) => a[0] - b[0]);
      for (const [, n] of options.slice(0, OUT_TRIES)) if (this.crossesFew(l, n % N, p.at)) return n;
      return -1;
    };
    return goals.map((goal, i) => {
      let g = goal, extra = 0;
      if ((g < 0 || !done[g]) && to[i].door) {
        g = outFrom(to[i]);
        if (g >= 0) {
          const [x, y] = this.centre(g % N);
          extra = Math.hypot(x - to[i].at[0], y - to[i].at[1]);
        }
      }
      if (g < 0 || !done[g]) return null;
      const nodes: number[] = [];
      for (let n = g; n >= 0; n = prev[n]) nodes.push(n);
      nodes.reverse();
      let climb = 0;
      for (let k = 1; k < nodes.length; k++) {
        const [a, b] = [Math.floor(nodes[k - 1] / N), Math.floor(nodes[k] / N)];
        if (a !== b) climb += this.storeys(a, b);
      }
      return { distance: dist[g] + extra, path: this.straighten(nodes, w), climb };
    });
  }

  // A cell path as spots, straightened: on each level, each spot goes straight on as far along the
  // path as it can see over corridors (or the rooms the shortcut starts and ends in).
  private straighten(nodes: number[], w: Float32Array): Place[] {
    const N = this.nx * this.ny;
    const out: Place[] = [];
    let a = 0;
    while (a < nodes.length) {
      const l = Math.floor(nodes[a] / N);
      out.push({ at: this.centre(nodes[a] % N), level: this.levels[l] });
      let next = a;
      for (let k = a + 1; k < nodes.length && Math.floor(nodes[k] / N) === l; k++) {
        if (!this.clear(l, nodes[a] % N, nodes[k] % N, w)) break;
        next = k;
      }
      // The last of a level (a stair or lift, or the end): on to the next level.
      if (next === a) {
        a++;
        continue;
      }
      // The last spot before a stair keeps its own place, so the walk meets the stair.
      a = next;
      if (a === nodes.length - 1 || Math.floor(nodes[a + 1] / N) !== l) {
        out.push({ at: this.centre(nodes[a] % N), level: this.levels[l] });
        a++;
      }
    }
    return out;
  }

  // Whether the straight line from a cell to a point crosses at most OUT_ROOMS mapped rooms (and
  // otherwise only corridors, wall gaps and unmapped space).
  private crossesFew(l: number, from: number, [bx, by]: Point): boolean {
    const room = this.room[l], cheap = this.cheap[l];
    const crossed = new Set<number>();
    const [ax, ay] = this.centre(from);
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2));
    for (let s = 1; s < steps; s++) {
      const i = Math.floor((ax + ((bx - ax) * s) / steps - this.x0) / CELL), j = Math.floor((ay + ((by - ay) * s) / steps - this.y0) / CELL);
      if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
      const r = room[j * this.nx + i];
      if (r >= 0 && !cheap[r] && crossed.add(r).size > OUT_ROOMS) return false;
    }
    return true;
  }

  // Whether the straight line between two cells on a level crosses only open corridor at least
  // MIN_CLEAR from walls (or as far as its ends are), or the rooms it starts and ends in.
  private clear(l: number, from: number, to: number, w: Float32Array): boolean {
    const N = this.nx * this.ny, room = this.room[l], open = this.open[l], clearance = this.clearance[l];
    const end = (k: number) => (open[k] ? clearance[k] : 0);
    const min = Math.min(MIN_CLEAR, end(from), end(to));
    const [ax, ay] = this.centre(from), [bx, by] = this.centre(to);
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2));
    for (let s = 1; s < steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
      const k = Math.floor((y - this.y0) / CELL) * this.nx + Math.floor((x - this.x0) / CELL);
      if (!w[l * N + k]) return false;
      if (open[k]) {
        if (clearance[k] < min) return false;
        continue;
      }
      const r = room[k];
      if (r < 0 || (r !== room[from] && r !== room[to])) return false;
    }
    return true;
  }
}
