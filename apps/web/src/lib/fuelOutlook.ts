import type { Position, Ship, WeatherCell } from "@strait-command/shared";

/** Matches `apps/server/src/simulation/engine.ts` — projected bunkers for remaining route */
export const FUEL_PER_NM = 0.085;
export const WEATHER_FUEL_MULT = 1.3;
export const FUEL_SAFETY_MULT = 1.05;

export function haversineNm(a: Position, b: Position): number {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const m = 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  return m / 1852;
}

export function routeRemainingNm(ship: Ship, destination: Position): number {
  let distNm = 0;
  let cur = { ...ship.position };
  for (const wp of ship.routeWaypoints) {
    distNm += haversineNm(cur, wp);
    cur = wp;
  }
  distNm += haversineNm(cur, destination);
  return distNm;
}

export function projectedFuelNeedTons(ship: Ship, destination: Position): number {
  const nm = routeRemainingNm(ship, destination);
  return nm * FUEL_PER_NM * WEATHER_FUEL_MULT * FUEL_SAFETY_MULT;
}

export type FuelTier = "ok" | "warning" | "critical";

export interface FuelOutlook {
  tier: FuelTier;
  distNm: number;
  needTons: number;
  reserveTons: number;
  pctOfNeed: number;
}

export function fuelOutlookForShip(
  ship: Ship,
  destination: Position | null,
): FuelOutlook | null {
  if (!destination) {
    return {
      tier: "ok",
      distNm: 0,
      needTons: 0,
      reserveTons: ship.fuel,
      pctOfNeed: 100,
    };
  }
  if (
    ship.status === "arrived" ||
    ship.status === "stranded" ||
    ship.status === "out_of_fuel"
  ) {
    return {
      tier:
        ship.status === "stranded" || ship.status === "out_of_fuel"
          ? "critical"
          : "ok",
      distNm: 0,
      needTons: 0,
      reserveTons: ship.fuel,
      pctOfNeed: 100,
    };
  }

  const distNm = routeRemainingNm(ship, destination);
  const needTons = projectedFuelNeedTons(ship, destination);
  const reserveTons = ship.fuel - needTons;
  const pctOfNeed = needTons > 0 ? (ship.fuel / needTons) * 100 : 100;

  let tier: FuelTier = "ok";
  if (
    ship.status === "insufficient_fuel" ||
    ship.fuel < needTons ||
    reserveTons < 0
  ) {
    tier = "critical";
  } else if (ship.fuel < needTons * 1.12 || pctOfNeed < 112) {
    tier = "warning";
  }

  return { tier, distNm, needTons, reserveTons, pctOfNeed };
}

export function nearestWeatherCell(
  position: Position,
  cells: WeatherCell[],
): WeatherCell | null {
  if (!cells.length) return null;
  let best: WeatherCell | null = null;
  let bestNm = Infinity;
  for (const c of cells) {
    const nm = haversineNm(position, { lat: c.lat, lng: c.lng });
    if (nm < bestNm) {
      bestNm = nm;
      best = c;
    }
  }
  return best;
}
