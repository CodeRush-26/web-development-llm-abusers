import type { Position } from "@strait-command/shared";

/** Matches `apps/server/src/geo.ts` ray-casting for navigable charts */
export function pointInPolygon(point: Position, ring: Position[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.lng;
    const yi = ring[i]!.lat;
    const xj = ring[j]!.lng;
    const yj = ring[j]!.lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Distance in nautical miles from `p` to segment AB (planar NM proxy — stable at Gulf scale) */
export function distancePointToSegmentNm(p: Position, a: Position, b: Position): number {
  const lat0 = ((a.lat + b.lat + p.lat) / 3) * (Math.PI / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * 60 * Math.cos(lat0);
  const by = (b.lat - a.lat) * 60;
  const px = (p.lng - a.lng) * 60 * Math.cos(lat0);
  const py = (p.lat - a.lat) * 60;
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const qx = ax + t * vx;
  const qy = ay + t * vy;
  const dx = px - qx;
  const dy = py - qy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Minimum distance from point to closed ring boundary (nm) */
export function distancePointToRingBoundaryNm(p: Position, ring: Position[]): number {
  if (ring.length < 2) return Infinity;
  let min = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    min = Math.min(min, distancePointToSegmentNm(p, a, b));
  }
  return min;
}

/**
 * Maritime hazard vertices: inside chart water, or within `coastalBufferNm` of the water boundary
 * (captures shoreline / port strips “slightly on land”).
 */
export function isMaritimeZoneVertexAllowed(
  p: Position,
  navigableRing: Position[],
  coastalBufferNm: number,
): boolean {
  if (navigableRing.length < 3) return true;
  if (pointInPolygon(p, navigableRing)) return true;
  const dist = distancePointToRingBoundaryNm(p, navigableRing);
  return dist <= coastalBufferNm;
}
