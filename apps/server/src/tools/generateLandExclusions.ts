import fs from "node:fs";
import path from "node:path";
import polygonClipping from "polygon-clipping";

type FeatureCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: Geometry | null }[];
};

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type MultiPolygon = number[][][][]; // [[[ [lng,lat], ... ]]] per polygon

function bboxPolygonLngLat(bbox: { west: number; south: number; east: number; north: number }): number[][][] {
  const ring: number[][] = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south],
  ];
  return [ring];
}

function geometryToMultiPolygons(g: Geometry): MultiPolygon[] {
  if (g.type === "Polygon") return [g.coordinates as unknown as MultiPolygon];
  if (g.type === "MultiPolygon") return g.coordinates as unknown as MultiPolygon[];
  return [];
}

function closeRing(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return [...ring, a];
}

function dedupeClosePoints(ring: number[][], eps = 1e-4): number[][] {
  if (ring.length <= 2) return ring;
  const out: number[][] = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev) out.push(p);
    else {
      const dx = p[0] - prev[0];
      const dy = p[1] - prev[1];
      if (Math.abs(dx) > eps || Math.abs(dy) > eps) out.push(p);
    }
  }
  return out;
}

function toLatLngRing(ringLngLat: number[][]): [number, number][] {
  return ringLngLat.map(([lng, lat]) => [lat, lng]);
}

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(__dirname, "../../../..");
  const fleetPath = path.join(workspaceRoot, "apps/server/src/data/fleet.json");
  const outPath = path.join(workspaceRoot, "apps/server/src/data/landExclusions.generated.json");

  const fleet = JSON.parse(fs.readFileSync(fleetPath, "utf8")) as {
    boundingBox: { west: number; south: number; east: number; north: number };
  };
  const bboxPoly = bboxPolygonLngLat(fleet.boundingBox);

  // 50m is detailed enough for coastlines/islands in this region, but still manageable.
  const url =
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download land GeoJSON: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const gj = JSON.parse(text) as FeatureCollection;
  if (gj.type !== "FeatureCollection" || !Array.isArray(gj.features)) {
    throw new Error("Unexpected GeoJSON type");
  }

  const clippedPolys: MultiPolygon[] = [];

  for (const f of gj.features) {
    if (!f.geometry) continue;
    const parts = geometryToMultiPolygons(f.geometry);
    for (const mp of parts) {
      // mp is MultiPolygon (polygons array) or Polygon coerced to MultiPolygon.
      // polygon-clipping expects MultiPolygon for operations.
      const clipped = polygonClipping.intersection(mp as any, bboxPoly as any) as any;
      if (clipped && Array.isArray(clipped) && clipped.length > 0) clippedPolys.push(clipped as MultiPolygon);
    }
  }

  if (clippedPolys.length === 0) {
    fs.writeFileSync(outPath, JSON.stringify([], null, 2), "utf8");
    console.log(`Wrote empty land exclusions to ${outPath}`);
    return;
  }

  // Merge all clipped fragments into one multipolygon to reduce ring count.
  let merged: MultiPolygon = clippedPolys[0]!;
  for (let i = 1; i < clippedPolys.length; i++) {
    merged = polygonClipping.union(merged as any, clippedPolys[i] as any) as any as MultiPolygon;
  }

  const ringsLatLng: [number, number][][] = [];
  for (const poly of merged) {
    for (const ring of poly) {
      const cleaned = closeRing(dedupeClosePoints(ring));
      if (cleaned.length < 4) continue;
      ringsLatLng.push(toLatLngRing(cleaned));
    }
  }

  // Only keep rings that actually represent land (outer rings are sufficient for blocking).
  // Even if some holes are included, blocking them is acceptable for "never route on land".
  fs.writeFileSync(outPath, JSON.stringify(ringsLatLng, null, 2), "utf8");
  console.log(`Wrote ${ringsLatLng.length} land exclusion rings to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

