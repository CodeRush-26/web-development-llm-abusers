import type { BoundingBox, Position, RestrictedZone, WeatherCell } from "@strait-command/shared";
import { haversineM, haversineNm, pointInPolygon, segmentNavigableChord } from "./geo";

/** Extra traversal cost for grid cells whose nearest weather sample is adverse (routes prefer calmer water when tied). */
const ADVERSE_ROUTE_MULT = 2.35;

export interface GridSpec {
  rows: number;
  cols: number;
  bbox: BoundingBox;
  latStep: number;
  lngStep: number;
}

export function defaultGridSpec(bbox: BoundingBox): GridSpec {
  const rows = 144;
  const cols = 144;
  return {
    rows,
    cols,
    bbox,
    latStep: (bbox.north - bbox.south) / rows,
    lngStep: (bbox.east - bbox.west) / cols,
  };
}

export function buildOccupancy(
  spec: GridSpec,
  navigableRing: Position[],
  restrictedZones: RestrictedZone[],
  opts?: {
    /** When set, cells inside these rings are dilated (expanded) by `dilateRadius` cells. */
    dilateSeedRings?: Position[][];
    /** Grid-cell radius for dilation (0 disables). */
    dilateRadius?: number;
  },
): Uint8Array {
  const { rows, cols, bbox } = spec;
  const blocked = new Uint8Array(rows * cols);
  const restrictedRings = restrictedZones.map((z) => z.coordinates);
  const seedRings = opts?.dilateSeedRings ?? [];
  const seed = opts?.dilateRadius && opts.dilateRadius > 0 ? new Uint8Array(rows * cols) : null;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const lat = bbox.south + (i + 0.5) * spec.latStep;
      const lng = bbox.west + (j + 0.5) * spec.lngStep;
      const p: Position = { lat, lng };
      if (!pointInPolygon(p, navigableRing)) {
        blocked[i * cols + j] = 1;
        continue;
      }
      let inRestricted = false;
      for (const ring of restrictedRings) {
        if (ring.length >= 3 && pointInPolygon(p, ring)) {
          inRestricted = true;
          break;
        }
      }
      const idx = i * cols + j;
      blocked[idx] = inRestricted ? 1 : 0;
      if (seed && blocked[idx] === 0) {
        for (const ring of seedRings) {
          if (ring.length >= 3 && pointInPolygon(p, ring)) {
            seed[idx] = 1;
            break;
          }
        }
      }
    }
  }

  const r = opts?.dilateRadius ?? 0;
  if (seed && r > 0) {
    dilateIntoBlocked(blocked, seed, spec, r);
  }
  return blocked;
}

function dilateIntoBlocked(blocked: Uint8Array, seed: Uint8Array, spec: GridSpec, radius: number): void {
  const { rows, cols } = spec;
  if (radius <= 0) return;
  let frontier: number[] = [];
  for (let idx = 0; idx < seed.length; idx++) {
    if (seed[idx]) frontier.push(idx);
  }
  const visited = new Uint8Array(seed.length);
  for (const idx of frontier) visited[idx] = 1;

  const neigh: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  for (let step = 0; step < radius; step++) {
    const next: number[] = [];
    for (const idx of frontier) {
      const i = Math.floor(idx / cols);
      const j = idx % cols;
      for (const [di, dj] of neigh) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) continue;
        const nidx = ni * cols + nj;
        if (visited[nidx]) continue;
        visited[nidx] = 1;
        if (!blocked[nidx]) blocked[nidx] = 1;
        next.push(nidx);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
}

/**
 * Per-cell multipliers ≥ 1 aligned with the routing grid. Higher cost in adverse weather
 * so A* preferentially skirts severe cells when an alternate exists.
 */
export function buildWeatherCostMultipliers(spec: GridSpec, weatherCells: WeatherCell[]): Float32Array | null {
  if (!weatherCells.length) return null;
  const { rows, cols } = spec;
  const out = new Float32Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const p = cellToPosition(i, j, spec);
      let bestD = Infinity;
      let adverse = false;
      for (const w of weatherCells) {
        const d = haversineM(p, { lat: w.lat, lng: w.lng });
        if (d < bestD) {
          bestD = d;
          adverse = w.adverse;
        }
      }
      out[i * cols + j] = adverse ? ADVERSE_ROUTE_MULT : 1;
    }
  }
  return out;
}

export function positionToCell(p: Position, spec: GridSpec): [number, number] {
  const j = Math.floor((p.lng - spec.bbox.west) / spec.lngStep);
  const i = Math.floor((p.lat - spec.bbox.south) / spec.latStep);
  return [
    Math.max(0, Math.min(spec.rows - 1, i)),
    Math.max(0, Math.min(spec.cols - 1, j)),
  ];
}

export function cellToPosition(i: number, j: number, spec: GridSpec): Position {
  return {
    lat: spec.bbox.south + (i + 0.5) * spec.latStep,
    lng: spec.bbox.west + (j + 0.5) * spec.lngStep,
  };
}

function heuristic(a: number, b: number, cols: number): number {
  const ar = Math.floor(a / cols);
  const ac = a % cols;
  const br = Math.floor(b / cols);
  const bc = b % cols;
  const dr = Math.abs(ar - br);
  const dc = Math.abs(ac - bc);
  return Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc);
}

const NEIGHBORS: [number, number, number][] = [
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [1, 1, Math.SQRT2],
];

function cellIndex(i: number, j: number, cols: number): number {
  return i * cols + j;
}

function nearestFree(blocked: Uint8Array, spec: GridSpec, preferIdx: number): number | null {
  const { rows, cols } = spec;
  const pi = Math.floor(preferIdx / cols);
  const pj = preferIdx % cols;
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const idx = cellIndex(i, j, cols);
      if (blocked[idx]) continue;
      const d = Math.abs(i - pi) + Math.abs(j - pj);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
  }
  return best;
}

/** Default upper bound on leg length after densification (~85 m) — smaller ⇒ denser polylines */
export const DEFAULT_DENSIFY_MAX_LEG_NM = 0.046;
/** Hard cap on interpolated inserts between two waypoints (long ocean legs stay bounded). */
const DENSIFY_MAX_INSERTS_PER_LEG = 140;

function snapPositionToClosestWater(p: Position, blocked: Uint8Array, spec: GridSpec): Position {
  const cols = spec.cols;
  const [ci, cj] = positionToCell(p, spec);
  const idx = cellIndex(ci, cj, cols);
  if (!blocked[idx]) {
    return { ...p };
  }
  const nf = nearestFree(blocked, spec, idx);
  if (nf === null) return { ...p };
  const i = Math.floor(nf / cols);
  const j = nf % cols;
  return cellToPosition(i, j, spec);
}

/**
 * Many closely spaced waypoints along each chord; samples snap to the nearest **traversable**
 * grid cell (same occupancy surface as A*) so geometry hugs usable water without editing fleet.json.
 */
export function densifyPathAlongClosestWater(
  path: Position[],
  blocked: Uint8Array,
  spec: GridSpec,
  maxLegNm: number = DEFAULT_DENSIFY_MAX_LEG_NM,
): Position[] {
  if (path.length < 2) return path.map((x) => ({ ...x }));
  const minSepNm = 0.001;
  const out: Position[] = [{ ...path[0] }];

  const pushIfSeparate = (q: Position): void => {
    const prev = out[out.length - 1];
    if (!prev || haversineNm(prev, q) >= minSepNm) out.push(q);
  };

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const distNm = haversineNm(a, b);
    let steps = Math.max(1, Math.ceil(distNm / maxLegNm));
    if (steps > DENSIFY_MAX_INSERTS_PER_LEG + 1) {
      steps = DENSIFY_MAX_INSERTS_PER_LEG + 1;
    }

    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const p: Position = {
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
      };
      pushIfSeparate(snapPositionToClosestWater(p, blocked, spec));
    }
    pushIfSeparate({ ...b });
  }

  return out;
}

/**
 * Samples the chord in lon/lat — every sample must fall on a **free** occupancy cell
 * (navigable hull minus land exclusions and zones). Catches shortcuts that polygon-only tests miss.
 */
function segmentChordClearOccupancy(
  a: Position,
  b: Position,
  blocked: Uint8Array,
  spec: GridSpec,
): boolean {
  const distM = haversineM(a, b);
  const spacingM = 42;
  const steps = Math.min(4500, Math.max(36, Math.ceil(distM / spacingM)));
  const { cols } = spec;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p: Position = {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
    };
    const [ci, cj] = positionToCell(p, spec);
    if (blocked[cellIndex(ci, cj, cols)]) return false;
  }
  return true;
}

function routeEdgeValid(
  a: Position,
  b: Position,
  navigableRing: Position[],
  restrictedRings: Position[][],
  cellSpanNm: number,
  blocked: Uint8Array,
  spec: GridSpec,
): boolean {
  if (!segmentNavigableChord(a, b, navigableRing, restrictedRings, cellSpanNm)) return false;
  return segmentChordClearOccupancy(a, b, blocked, spec);
}

function reconstruct(
  cameFrom: Int32Array,
  current: number,
  cols: number,
  spec: GridSpec,
  start: Position,
  goal: Position,
  navigableRing: Position[] | undefined,
  restrictedRings: Position[][] | undefined,
  cellSpanNm: number,
  maxSimplifyGridSkip: number,
  blocked: Uint8Array,
): Position[] {
  const path: Position[] = [];
  let c = current;
  while (c !== -1) {
    const i = Math.floor(c / cols);
    const j = c % cols;
    path.push(cellToPosition(i, j, spec));
    c = cameFrom[c];
  }
  path.reverse();
  if (path.length === 0) return [{ ...goal }];
  path[0] = { ...start };
  path[path.length - 1] = { ...goal };
  if (navigableRing && navigableRing.length >= 3) {
    const restricted = restrictedRings ?? [];
    const simplified = simplifyPathKeepingSea(
      path,
      navigableRing,
      restricted,
      cellSpanNm,
      maxSimplifyGridSkip,
      blocked,
      spec,
    );
    if (
      polylineFullyNavigable(simplified, navigableRing, restricted, cellSpanNm, blocked, spec)
    ) {
      return simplified;
    }
    return path;
  }
  return simplifyPathCollinear(path);
}

/** Legacy collinear collapse — only used when navigable ring unavailable */
function simplifyPathCollinear(points: Position[]): Position[] {
  if (points.length <= 2) return points;
  const out: Position[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (!collinear(prev, cur, next)) out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}

function collinear(a: Position, b: Position, c: Position): boolean {
  const cross =
    (b.lat - a.lat) * (c.lng - a.lng) - (b.lng - a.lng) * (c.lat - a.lat);
  return Math.abs(cross) < 1e-8;
}

/**
 * Greedy shortcut from anchor — each chord must lie entirely in navigable water (no land / zones).
 */
function simplifyPathKeepingSea(
  points: Position[],
  navigableRing: Position[],
  restrictedRings: Position[][],
  cellSpanNm: number,
  maxGridSkip: number,
  blocked: Uint8Array,
  spec: GridSpec,
): Position[] {
  if (points.length <= 2) return points;
  const out: Position[] = [points[0]];
  let anchor = 0;
  for (let i = 2; i < points.length; i++) {
    const skipDist = i - anchor;
    if (
      skipDist > maxGridSkip ||
      !routeEdgeValid(
        points[anchor],
        points[i],
        navigableRing,
        restrictedRings,
        cellSpanNm,
        blocked,
        spec,
      )
    ) {
      out.push(points[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function polylineFullyNavigable(
  points: Position[],
  navigableRing: Position[],
  restrictedRings: Position[][],
  cellSpanNm: number,
  blocked: Uint8Array,
  spec: GridSpec,
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (
      !routeEdgeValid(
        points[i],
        points[i + 1],
        navigableRing,
        restrictedRings,
        cellSpanNm,
        blocked,
        spec,
      )
    )
      return false;
  }
  return true;
}

const DILATE_NEIGH: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function collectCellsAlongChord(
  a: Position,
  b: Position,
  spec: GridSpec,
  out: Set<number>,
): void {
  const [ia, ja] = positionToCell(a, spec);
  const [ib, jb] = positionToCell(b, spec);
  const gridSteps = Math.ceil(Math.hypot(ib - ia, jb - ja));
  const steps = Math.max(10, Math.min(420, gridSteps * 4 + 24));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const lat = a.lat + t * (b.lat - a.lat);
    const lng = a.lng + t * (b.lng - a.lng);
    const [i, j] = positionToCell({ lat, lng }, spec);
    out.add(cellIndex(i, j, spec.cols));
  }
}

function dilateCellSet(
  cells: Set<number>,
  spec: GridSpec,
  blocked: Uint8Array,
  radius: number,
): Set<number> {
  if (radius <= 0) return cells;
  const { rows, cols } = spec;
  let frontier = [...cells];
  const out = new Set(cells);
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const idx of frontier) {
      const ci = Math.floor(idx / cols);
      const cj = idx % cols;
      for (const [di, dj] of DILATE_NEIGH) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) continue;
        const nidx = cellIndex(ni, nj, cols);
        if (blocked[nidx] || out.has(nidx)) continue;
        out.add(nidx);
        next.push(nidx);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return out;
}

/** Strong penalty on cells used by other routes so paths spread apart */
export function buildRouteAvoidanceMultiplier(
  spec: GridSpec,
  blocked: Uint8Array,
  polylines: Position[][],
  strength: number,
  dilateRadius: number,
): Float32Array {
  const mult = new Float32Array(spec.rows * spec.cols);
  mult.fill(1);
  const raw = new Set<number>();
  for (const path of polylines) {
    if (path.length < 2) continue;
    for (let i = 0; i < path.length - 1; i++) {
      collectCellsAlongChord(path[i], path[i + 1], spec, raw);
    }
  }
  const cells = dilateCellSet(raw, spec, blocked, dilateRadius);
  for (const idx of cells) {
    if (!blocked[idx]) mult[idx] = Math.max(mult[idx], strength);
  }
  return mult;
}

export function combineCellCostMultipliers(
  a: Float32Array | null | undefined,
  b: Float32Array | null | undefined,
  length: number,
): Float32Array | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = a[i]! * b[i]!;
  return out;
}

class MinHeap {
  private heap: { idx: number; f: number }[] = [];

  get length(): number {
    return this.heap.length;
  }

  push(idx: number, f: number): void {
    this.heap.push({ idx, f });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): number | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].idx;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.heap[p].f <= this.heap[i].f) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].f < this.heap[smallest].f) smallest = l;
      if (r < n && this.heap[r].f < this.heap[smallest].f) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

export interface ComputeRouteOptions {
  /** Same length as grid (rows×cols); edge cost scales with average of endpoint multipliers. */
  cellCostMultiplier?: Float32Array | null;
  /** When provided, post-process path so straight shortcuts never cross land or restricted zones. */
  navigableRing?: Position[];
  restrictedRings?: Position[][];
  /** Nautical miles ≈ one routing cell — used to set chord sample density (default: from grid). */
  cellSpanNm?: number;
  /** Limits how many consecutive grid vertices a shortcut may skip (keeps legs near the mesh). */
  maxSimplifyGridSkip?: number;
}

/** Grid A* from start to goal; respects navigable + restricted occupancy; optional weather-weighted edges */
export function computeGridRoute(
  blocked: Uint8Array,
  spec: GridSpec,
  start: Position,
  goal: Position,
  opts?: ComputeRouteOptions,
): Position[] | null {
  const { rows, cols } = spec;
  const size = rows * cols;

  let startIdx = cellIndex(...positionToCell(start, spec), cols);
  let goalIdx = cellIndex(...positionToCell(goal, spec), cols);

  if (blocked[startIdx]) {
    const n = nearestFree(blocked, spec, startIdx);
    if (n === null) return null;
    startIdx = n;
  }
  if (blocked[goalIdx]) {
    const n = nearestFree(blocked, spec, goalIdx);
    if (n === null) return null;
    goalIdx = n;
  }

  const open = new MinHeap();
  const gScore = new Float64Array(size);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  gScore[startIdx] = 0;
  open.push(startIdx, heuristic(startIdx, goalIdx, cols));

  const closed = new Uint8Array(size);
  const mult = opts?.cellCostMultiplier ?? null;

  const cellSpanNm =
    opts?.cellSpanNm ?? Math.min(spec.latStep * 60, spec.lngStep * 60);
  const maxSimplifyGridSkip = opts?.maxSimplifyGridSkip ?? 8;

  while (open.length > 0) {
    const current = open.pop()!;
    if (current === goalIdx) {
      return reconstruct(
        cameFrom,
        current,
        cols,
        spec,
        start,
        goal,
        opts?.navigableRing,
        opts?.restrictedRings,
        cellSpanNm,
        maxSimplifyGridSkip,
        blocked,
      );
    }
    closed[current] = 1;
    const ci = Math.floor(current / cols);
    const cj = current % cols;

    for (const [di, dj, stepCost] of NEIGHBORS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) continue;
      const nidx = cellIndex(ni, nj, cols);
      if (blocked[nidx] || closed[nidx]) continue;
      if (di !== 0 && dj !== 0) {
        const c1 = cellIndex(ci + di, cj, cols);
        const c2 = cellIndex(ci, cj + dj, cols);
        if (blocked[c1] || blocked[c2]) continue;
      }

      const pa = cellToPosition(ci, cj, spec);
      const pb = cellToPosition(ni, nj, spec);
      if (opts?.navigableRing && opts.navigableRing.length >= 3) {
        if (
          !routeEdgeValid(
            pa,
            pb,
            opts.navigableRing,
            opts.restrictedRings ?? [],
            cellSpanNm,
            blocked,
            spec,
          )
        ) {
          continue;
        }
      } else if (!segmentChordClearOccupancy(pa, pb, blocked, spec)) {
        continue;
      }

      const m0 = mult ? mult[current]! : 1;
      const m1 = mult ? mult[nidx]! : 1;
      const edgeCost = stepCost * 0.5 * (m0 + m1);
      const tentative = gScore[current] + edgeCost;
      if (tentative < gScore[nidx]) {
        cameFrom[nidx] = current;
        gScore[nidx] = tentative;
        const f = tentative + heuristic(nidx, goalIdx, cols);
        open.push(nidx, f);
      }
    }
  }
  return null;
}
