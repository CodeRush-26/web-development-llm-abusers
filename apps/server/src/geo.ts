import type { Position } from "@strait-command/shared";

const EARTH_RADIUS_NM = 3440.065;

/** Haversine distance in meters */
export function haversineM(a: Position, b: Position): number {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function haversineNm(a: Position, b: Position): number {
  return haversineM(a, b) / 1852;
}

/** Initial bearing from a to b in degrees [0,360) */
export function bearingDeg(a: Position, b: Position): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/** Move from `from` toward bearing at distanceNm nautical miles */
export function destinationPoint(from: Position, bearing: number, distanceNm: number): Position {
  const δ = distanceNm / EARTH_RADIUS_NM;
  const θ = (bearing * Math.PI) / 180;
  const φ1 = (from.lat * Math.PI) / 180;
  const λ1 = (from.lng * Math.PI) / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * Math.sin(φ2);
  let λ2 = λ1 + Math.atan2(y, x);
  let lon = (λ2 * 180) / Math.PI;
  lon = ((lon + 540) % 360) - 180;
  return { lat: (φ2 * 180) / Math.PI, lng: lon };
}

/** Ray casting — point in polygon on sphere approximated in lon/lat plane for regional scale */
export function pointInPolygon(point: Position, ring: Position[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Segment AB intersects segment CD */
function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (
    p: Position,
    q: Position,
    r: Position,
  ): number =>
    (q.lat - p.lat) * (r.lng - q.lng) - (q.lng - p.lng) * (r.lat - q.lat);
  const onSegment = (p: Position, q: Position, r: Position): boolean =>
    q.lng <= Math.max(p.lng, r.lng) + 1e-9 &&
    q.lng >= Math.min(p.lng, r.lng) - 1e-9 &&
    q.lat <= Math.max(p.lat, r.lat) + 1e-9 &&
    q.lat >= Math.min(p.lat, r.lat) - 1e-9;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return (o1 > 0 !== o2 > 0) && (o3 > 0 !== o4 > 0);
}

/** Whether segment crosses any edge of polygon */
export function segmentCrossesPolygon(a: Position, b: Position, ring: Position[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const c = ring[i];
    const d = ring[(i + 1) % n];
    if (segmentsIntersect(a, b, c, d)) return true;
  }
  return false;
}

/** Route polyline may intersect restricted zone */
export function routeIntersectsZone(
  waypoints: Position[],
  zoneRing: Position[],
): boolean {
  if (waypoints.length < 2) return false;
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (segmentCrossesPolygon(waypoints[i], waypoints[i + 1], zoneRing)) return true;
  }
  return false;
}

export function clampHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

/**
 * Whether the straight chord from a→b stays in open water: inside navigable polygon and
 * outside every restricted zone.
 *
 * Uses **distance-adaptive sampling** (~90 m along the chord, minimum ~52 samples) so narrow
 * peninsulas cannot fall between consecutive tests. Caps total samples on very long legs for CPU.
 */
export function segmentNavigableChord(
  a: Position,
  b: Position,
  navigableRing: Position[],
  restrictedRings: Position[][],
  cellSpanNm: number,
): boolean {
  if (navigableRing.length < 3) return false;
  const nm = haversineNm(a, b);
  if (nm < 1e-12) {
    if (!pointInPolygon(a, navigableRing)) return false;
    for (const ring of restrictedRings) {
      if (ring.length >= 3 && pointInPolygon(a, ring)) return false;
    }
    return true;
  }

  const distM = haversineM(a, b);
  /** Target spacing along chord — catches thin coastal slivers (~100 m class) */
  const spacingM = Math.min(110, Math.max(65, cellSpanNm * 1852 * 0.025));
  const fromDistance = Math.ceil(distM / spacingM);
  const steps = Math.min(4000, Math.max(52, fromDistance));

  if (!pointInPolygon(a, navigableRing) || !pointInPolygon(b, navigableRing)) return false;
  for (const ring of restrictedRings) {
    if (ring.length >= 3 && (pointInPolygon(a, ring) || pointInPolygon(b, ring))) return false;
  }
  /** Straight chord cuts across land or closes through a concavity */
  if (segmentCrossesPolygon(a, b, navigableRing)) return false;
  for (const ring of restrictedRings) {
    if (ring.length >= 3 && segmentCrossesPolygon(a, b, ring)) return false;
  }

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p: Position = {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
    };
    if (!pointInPolygon(p, navigableRing)) return false;
    for (const ring of restrictedRings) {
      if (ring.length >= 3 && pointInPolygon(p, ring)) return false;
    }
  }
  return true;
}
