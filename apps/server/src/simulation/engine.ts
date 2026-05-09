import fleetDataset from "../data/fleet.json";
import fs from "node:fs";
import path from "node:path";
import type {
  Alert,
  AlertSeverity,
  BoundingBox,
  FleetDataset,
  FleetSnapshot,
  OperationalStatus,
  PlaybackFrame,
  Port,
  Position,
  RestrictedZone,
  Ship,
  WeatherCell,
} from "@strait-command/shared";
import {
  bearingDeg,
  destinationPoint,
  haversineM,
  haversineNm,
  pointInPolygon,
} from "../geo";
import {
  buildOccupancy,
  buildRouteAvoidanceMultiplier,
  buildWeatherCostMultipliers,
  combineCellCostMultipliers,
  computeGridRoute,
  densifyPathAlongClosestWater,
  defaultGridSpec,
  type GridSpec,
} from "../routing";
import { v4 as uuidv4 } from "uuid";

const TICK_MS_DEFAULT = 100;
export const PROXIMITY_M = 2000;
const WAYPOINT_REACHED_NM = 0.08;
const ARRIVAL_NM = 0.06;
const FUEL_PER_NM = 0.085;
const WEATHER_FUEL_MULT = 1.3;
/** Penalty multiplier on grid cells used by other ships’ planned routes (spread paths apart). */
const ROUTE_AVOIDANCE_COST = 14;
const ROUTE_AVOIDANCE_DILATE = 1;

function portsFromDataset(ds: FleetDataset): Map<string, Port> {
  const m = new Map<string, Port>();
  for (const p of ds.ports) {
    m.set(p.id, {
      id: p.id,
      name: p.name,
      position: { lat: p.position[0], lng: p.position[1] },
    });
  }
  return m;
}

function navigableRing(ds: FleetDataset): Position[] {
  return ds.navigableWater.map(([lat, lng]) => ({ lat, lng }));
}

function nearestPortId(ports: Map<string, Port>, pos: Position): string | null {
  let bestId: string | null = null;
  let bestD = Infinity;
  for (const p of ports.values()) {
    const dy = (p.position.lat - pos.lat) * 60;
    const dx =
      (p.position.lng - pos.lng) *
      60 *
      Math.cos(((pos.lat + p.position.lat) / 2) * (Math.PI / 180));
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) {
      bestD = d;
      bestId = p.id;
    }
  }
  return bestId;
}

export class SimulationEngine {
  readonly scenario: FleetDataset["scenario"];
  readonly boundingBox: BoundingBox;
  readonly navigablePolygon: Position[];
  readonly ports: Map<string, Port>;

  ships: Ship[] = [];
  zones: RestrictedZone[] = [];
  alerts: Map<string, Alert> = new Map();
  weatherCells: WeatherCell[] = [];

  gridSpec: GridSpec;
  occupancy: Uint8Array;
  /** Cached grid-aligned weather cost surface for routing (rebuilt with weather updates). */
  weatherCostMul: Float32Array | null;

  tickCount = 0;
  simTimeMs = 0;
  /** When true, tick() does not advance sim time or ship physics */
  simulationPaused = false;
  private weatherAgeMs = 1e9;

  private playbackFrames: PlaybackFrame[] = [];
  private lastPlaybackInsert = 0;
  private readonly playbackEveryMs = 30_000;

  /** Land polygons from scenario data — merged into routing occupancy (not operator zones). */
  private readonly landExclusionRings: Position[][];

  /** True after each ship has a first grid route (async bootstrap); refinement may continue in the background. */
  private routingBootstrapComplete = false;

  constructor() {
    const ds = fleetDataset as unknown as FleetDataset;
    this.scenario = ds.scenario;
    this.boundingBox = ds.boundingBox;
    this.navigablePolygon = navigableRing(ds);
    this.ports = portsFromDataset(ds);
    const generated = readGeneratedLandExclusions();
    const fromDataset = (ds.landExclusions ?? []).map((ring: [number, number][]) =>
      ring.map(([lat, lng]) => ({ lat, lng })),
    );
    this.landExclusionRings = [...fromDataset, ...generated];
    this.gridSpec = defaultGridSpec(this.boundingBox);
    this.occupancy = buildOccupancy(this.gridSpec, this.navigablePolygon, this.allRoutingZones(), {
      dilateSeedRings: this.landExclusionRings,
      dilateRadius: 3,
    });
    this.weatherCostMul = null;
    this.bootstrapShips(ds);
  }

  /** Used by `/health` so the client can wait before opening Socket.IO while routes are still computing. */
  isRoutingReady(): boolean {
    return this.routingBootstrapComplete;
  }

  private staticLandRestrictedZones(): RestrictedZone[] {
    const t = 0;
    return this.landExclusionRings.map((coordinates, i) => ({
      id: `__landExclusion${i}`,
      name: "Land (routing mask)",
      coordinates,
      createdAt: t,
      updatedAt: t,
    }));
  }

  /** Operator zones plus static land masks — used for occupancy and chord checks */
  private allRoutingZones(): RestrictedZone[] {
    return [...this.zones, ...this.staticLandRestrictedZones()];
  }

  private bootstrapShips(ds: FleetDataset): void {
    this.ships = ds.fleet.map((row) => {
      const initialPosition = { lat: row.position[0], lng: row.position[1] };
      const inferredSource = nearestPortId(this.ports, initialPosition);
      const ship: Ship = {
        shipId: row.shipId,
        name: row.name,
        position: initialPosition,
        speed: row.speed,
        cruiseSpeed: row.speed,
        heading: row.heading,
        sourcePortId: row.source ?? inferredSource ?? row.destination,
        destinationPortId: row.destination,
        fuel: row.fuel,
        cargo: row.cargo,
        status: row.status as OperationalStatus,
        routeWaypoints: [],
        routeIndex: 0,
        pendingDirective: null,
        divertTarget: null,
      };
      return ship;
    });
    queueMicrotask(() => this.runDeferredBootstrap());
  }

  /**
   * Chunk pathfinding across macrotasks so HTTP `/health` stays responsive during startup.
   */
  private runDeferredBootstrap(): void {
    let i = 0;
    const step = (): void => {
      if (i < this.ships.length) {
        this.assignRoute(this.ships[i], false);
        this.estimateFuelFlag(this.ships[i]);
        i++;
        setImmediate(step);
        return;
      }
      this.routingBootstrapComplete = true;
      this.queueRefineRoundsAsync(5);
    };
    setImmediate(step);
  }

  private refineFleetRoutesOneRound(): void {
    const sorted = [...this.ships].sort((a, b) => a.shipId.localeCompare(b.shipId));
    for (const s of sorted) {
      if (
        s.status === "arrived" ||
        s.status === "stranded" ||
        s.status === "holding" ||
        s.status === "out_of_fuel"
      )
        continue;
      this.assignRoute(s, false);
      this.estimateFuelFlag(s);
    }
  }

  /** Re-plan routes in rounds so each ship can steer away from others’ corridors */
  private refineFleetRoutes(rounds: number): void {
    for (let r = 0; r < rounds; r++) {
      this.refineFleetRoutesOneRound();
    }
  }

  /** Async refinement after initial bootstrap — yields between rounds. */
  private queueRefineRoundsAsync(roundsLeft: number): void {
    if (roundsLeft <= 0) return;
    setImmediate(() => {
      this.refineFleetRoutesOneRound();
      this.queueRefineRoundsAsync(roundsLeft - 1);
    });
  }

  /** Planned route polyline for avoidance (current track through remaining waypoints to nav goal). */
  private plannedPolyline(ship: Ship): Position[] | null {
    const goal = this.navigationGoal(ship);
    if (!goal) return null;
    return [ship.position, ...ship.routeWaypoints, goal];
  }

  private buildAvoidanceMultiplier(forShipId: string): Float32Array | null {
    const polylines: Position[][] = [];
    for (const s of this.ships) {
      if (s.shipId === forShipId) continue;
      if (
        s.status === "arrived" ||
        s.status === "stranded" ||
        s.status === "holding" ||
        s.status === "out_of_fuel"
      )
        continue;
      const line = this.plannedPolyline(s);
      if (line && line.length >= 2) polylines.push(line);
    }
    if (polylines.length === 0) return null;
    return buildRouteAvoidanceMultiplier(
      this.gridSpec,
      this.occupancy,
      polylines,
      ROUTE_AVOIDANCE_COST,
      ROUTE_AVOIDANCE_DILATE,
    );
  }

  rebuildOccupancy(): void {
    this.occupancy = buildOccupancy(this.gridSpec, this.navigablePolygon, this.allRoutingZones(), {
      dilateSeedRings: this.landExclusionRings,
      dilateRadius: 3,
    });
  }

  navigationGoal(ship: Ship): Position | null {
    if (ship.divertTarget) return ship.divertTarget;
    const port = this.ports.get(ship.destinationPortId);
    return port?.position ?? null;
  }

  assignRoute(ship: Ship, markRerouting: boolean): boolean {
    const goal = this.navigationGoal(ship);
    if (!goal) {
      ship.status = "stranded";
      return false;
    }
    const cellSpanNm = Math.min(this.gridSpec.latStep * 60, this.gridSpec.lngStep * 60);
    const avoidance = this.buildAvoidanceMultiplier(ship.shipId);
    const combinedCost = combineCellCostMultipliers(
      this.weatherCostMul,
      avoidance,
      this.occupancy.length,
    );
    const path = computeGridRoute(this.occupancy, this.gridSpec, ship.position, goal, {
      cellCostMultiplier: combinedCost,
      navigableRing: this.navigablePolygon,
      restrictedRings: this.allRoutingZones().map((z) => z.coordinates),
      cellSpanNm,
    });
    if (!path || path.length < 2) {
      ship.status = "stranded";
      ship.routeWaypoints = [];
      ship.routeIndex = 0;
      this.raiseAlert({
        type: "stranded_ship",
        severity: "critical",
        shipId: ship.shipId,
        message: `${ship.name}: no valid route — revise zones or destination.`,
      });
      return false;
    }
    const densePath = densifyPathAlongClosestWater(path, this.occupancy, this.gridSpec);
    ship.routeWaypoints = densePath.slice(1);
    ship.routeIndex = 0;
    if (markRerouting && ship.status !== "arrived" && ship.status !== "holding" && ship.status !== "out_of_fuel") {
      ship.status = "rerouting";
    }
    this.estimateFuelFlag(ship);
    return true;
  }

  private estimateFuelFlag(ship: Ship): void {
    if (
      ship.status === "arrived" ||
      ship.status === "stranded" ||
      ship.status === "out_of_fuel"
    )
      return;
    const goal = this.navigationGoal(ship);
    if (!goal) return;
    let distNm = 0;
    let cur = { ...ship.position };
    for (const wp of ship.routeWaypoints) {
      distNm += haversineNm(cur, wp);
      cur = wp;
    }
    distNm += haversineNm(cur, goal);
    const need = distNm * FUEL_PER_NM * WEATHER_FUEL_MULT * 1.05;
    if (ship.fuel < need && ship.status !== "insufficient_fuel") {
      ship.status = "insufficient_fuel";
      this.raiseAlert({
        type: "fuel_insufficient",
        severity: "high",
        shipId: ship.shipId,
        message: `${ship.name}: projected fuel shortfall (~${need.toFixed(0)} t required).`,
      });
    }
  }

  setWeather(cells: WeatherCell[]): void {
    this.weatherCells = cells;
    this.weatherAgeMs = 0;
    this.weatherCostMul = buildWeatherCostMultipliers(this.gridSpec, cells);
  }

  private weatherAt(p: Position): WeatherCell | null {
    if (this.weatherCells.length === 0) return null;
    let best: WeatherCell | null = null;
    let bestD = Infinity;
    for (const c of this.weatherCells) {
      const d = haversineM(p, { lat: c.lat, lng: c.lng });
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private adverseAt(p: Position): boolean {
    return this.weatherAt(p)?.adverse ?? false;
  }

  private isPositionOnNavigableWater(p: Position): boolean {
    if (!pointInPolygon(p, this.navigablePolygon)) return false;
    for (const ring of this.landExclusionRings) {
      if (ring.length >= 3 && pointInPolygon(p, ring)) return false;
    }
    return true;
  }

  /** If numerical drift puts a hull outside charted water, reroute */
  private enforceNavigableWater(): void {
    for (const ship of this.ships) {
      if (
        ship.status === "arrived" ||
        ship.status === "stranded" ||
        ship.status === "holding" ||
        ship.status === "out_of_fuel"
      )
        continue;
      if (this.isPositionOnNavigableWater(ship.position)) continue;
      const key = `offchart:${ship.shipId}`;
      if (!this.alerts.has(key)) {
        this.raiseAlert({
          id: key,
          type: "route_deviation",
          severity: "high",
          shipId: ship.shipId,
          message: `${ship.name}: position outside navigable water — rerouting.`,
        });
      }
      this.assignRoute(ship, true);
    }
  }

  tick(dtMs: number = TICK_MS_DEFAULT): FleetSnapshot {
    if (!this.routingBootstrapComplete) {
      return this.snapshot();
    }
    if (this.simulationPaused) {
      return this.snapshot();
    }
    this.simTimeMs += dtMs;
    this.weatherAgeMs += dtMs;
    this.tickCount++;

    for (const ship of this.ships) {
      if (ship.status === "arrived" || ship.status === "stranded") continue;
      if (ship.status === "holding") continue;
      if (ship.status === "out_of_fuel") continue;
      this.advanceShip(ship, dtMs);
    }

    this.enforceNavigableWater();
    this.checkProximity();
    this.checkGeofences();
    this.maybePlaybackSnapshot();

    return this.snapshot();
  }

  private advanceShip(ship: Ship, dtMs: number): void {
    const hours = dtMs / 3_600_000;
    const speed = Math.min(ship.cruiseSpeed, 28);
    const goal = this.navigationGoal(ship);
    if (!goal) {
      ship.status = "stranded";
      return;
    }

    if (ship.routeWaypoints.length === 0 || ship.routeIndex >= ship.routeWaypoints.length) {
      if (haversineNm(ship.position, goal) < ARRIVAL_NM) {
        if (ship.divertTarget) {
          ship.divertTarget = null;
          this.assignRoute(ship, false);
          return;
        }
        ship.status = "arrived";
        ship.speed = 0;
        return;
      }
      this.assignRoute(ship, false);
      return;
    }

    const target = ship.routeWaypoints[ship.routeIndex];
    const distNm = haversineNm(ship.position, target);
    const stepNm = Math.min(distNm, speed * hours);

    const adverse = this.adverseAt(ship.position);
    const fuelMult = adverse ? WEATHER_FUEL_MULT : 1;

    if (adverse && ship.status === "normal") {
      const wid = `weather:${ship.shipId}`;
      if (!this.alerts.has(wid)) {
        this.raiseAlert({
          id: wid,
          type: "severe_weather_exposure",
          severity: "medium",
          shipId: ship.shipId,
          message: `${ship.name}: severe sea state — elevated fuel burn.`,
        });
      }
    }

    if (stepNm > 1e-6) {
      const brg = bearingDeg(ship.position, target);
      ship.heading = brg;
      ship.position = destinationPoint(ship.position, brg, stepNm);
      ship.speed = speed;
      ship.fuel = Math.max(0, ship.fuel - stepNm * FUEL_PER_NM * fuelMult);
    }

    if (ship.fuel <= 0 && ship.status !== "stranded") {
      ship.status = "out_of_fuel";
      ship.speed = 0;
      this.raiseAlert({
        type: "fuel_insufficient",
        severity: "critical",
        shipId: ship.shipId,
        message: `${ship.name}: fuel exhausted.`,
      });
      return;
    }

    if (distNm <= WAYPOINT_REACHED_NM + speed * hours * 1.5) {
      ship.routeIndex++;
      if (ship.routeIndex >= ship.routeWaypoints.length) {
        if (haversineNm(ship.position, goal) < ARRIVAL_NM * 3) {
          if (ship.divertTarget) {
            ship.divertTarget = null;
            this.assignRoute(ship, false);
          } else {
            ship.status = "arrived";
            ship.speed = 0;
          }
        }
      }
    }

    if (ship.status === "rerouting") {
      ship.status = "normal";
    }
  }

  private checkProximity(): void {
    for (let i = 0; i < this.ships.length; i++) {
      for (let j = i + 1; j < this.ships.length; j++) {
        const a = this.ships[i];
        const b = this.ships[j];
        if (a.status === "arrived" && b.status === "arrived") continue;
        const d = haversineM(a.position, b.position);
        const pairKey = [a.shipId, b.shipId].sort().join(":");
        if (d < PROXIMITY_M) {
          const alertId = `proximity:${pairKey}`;
          const existing = this.alerts.get(alertId);
          if (existing) {
            existing.timestamp = this.simTimeMs;
            existing.message = `Proximity: ${a.name} & ${b.name} — ${(d / 1000).toFixed(2)} km`;
          } else {
            this.raiseAlert({
              id: alertId,
              type: "proximity_collision",
              severity: "high",
              shipId: a.shipId,
              relatedShipId: b.shipId,
              message: `Proximity warning: ${a.name} & ${b.name} — ${(d / 1000).toFixed(2)} km`,
            });
          }
        }
      }
    }
  }

  private checkGeofences(): void {
    for (const ship of this.ships) {
      if (
        ship.status === "arrived" ||
        ship.status === "out_of_fuel" ||
        ship.status === "holding"
      )
        continue;
      for (const zone of this.zones) {
        if (zone.coordinates.length < 3) continue;
        const inside = pointInPolygon(ship.position, zone.coordinates);
        const key = `geofence:${ship.shipId}:${zone.id}`;
        if (inside && !this.alerts.has(key)) {
          this.raiseAlert({
            id: key,
            type: "geofence_breach",
            severity: "high",
            shipId: ship.shipId,
            message: `${ship.name} inside restricted zone «${zone.name}».`,
          });
          this.assignRoute(ship, true);
        }
      }
    }
  }

  private raiseAlert(
    a: Partial<Alert> & { message: string; type: Alert["type"]; severity: AlertSeverity },
  ): void {
    const alert: Alert = {
      id: a.id ?? uuidv4(),
      type: a.type,
      severity: a.severity,
      shipId: a.shipId,
      relatedShipId: a.relatedShipId,
      message: a.message,
      timestamp: this.simTimeMs,
      acknowledged: false,
      aiPriorityScore: severityToScore(a.severity),
    };
    this.alerts.set(alert.id, alert);
  }

  onZonesChanged(): void {
    this.rebuildOccupancy();
    for (const z of this.zones) {
      for (const ship of this.ships) {
        if (
          ship.status === "arrived" ||
          ship.status === "stranded" ||
          ship.status === "out_of_fuel" ||
          ship.status === "holding"
        )
          continue;
        if (pointInPolygon(ship.position, z.coordinates)) {
          const key = `geofence:${ship.shipId}:${z.id}`;
          if (!this.alerts.has(key)) {
            this.raiseAlert({
              id: key,
              type: "geofence_breach",
              severity: "high",
              shipId: ship.shipId,
              message: `${ship.name} breached «${z.name}».`,
            });
          }
        }
      }
    }
    for (const ship of this.ships) {
      if (
        ship.status === "arrived" ||
        ship.status === "stranded" ||
        ship.status === "out_of_fuel" ||
        ship.status === "holding"
      )
        continue;
      this.assignRoute(ship, true);
    }
    this.refineFleetRoutes(3);
  }

  acknowledgeAlert(alertId: string, operatorId: string): void {
    const al = this.alerts.get(alertId);
    if (!al) return;
    al.acknowledged = true;
    al.acknowledgedAt = this.simTimeMs;
    al.acknowledgedBy = operatorId;
  }

  snapshot(): FleetSnapshot {
    return {
      ships: this.ships.map((s) => ({
        ...s,
        routeWaypoints: s.routeWaypoints.map((w) => ({ ...w })),
      })),
      zones: this.zones.map((z) => ({
        ...z,
        coordinates: z.coordinates.map((c) => ({ ...c })),
      })),
      alerts: Array.from(this.alerts.values()).sort((a, b) => b.timestamp - a.timestamp),
      ports: Array.from(this.ports.values()),
      navigablePolygon: this.navigablePolygon,
      boundingBox: this.boundingBox,
      scenario: this.scenario,
      tick: this.tickCount,
      simTimeMs: this.simTimeMs,
      weatherCells: this.weatherCells,
      simulationPaused: this.simulationPaused,
    };
  }

  getPlayback(): PlaybackFrame[] {
    return this.playbackFrames;
  }

  private maybePlaybackSnapshot(): void {
    if (this.simTimeMs - this.lastPlaybackInsert >= this.playbackEveryMs) {
      this.lastPlaybackInsert = this.simTimeMs;
      this.playbackFrames.push({
        simTimeMs: this.simTimeMs,
        ships: this.ships.map((s) => JSON.parse(JSON.stringify(s)) as Ship),
        alerts: Array.from(this.alerts.values()).map((x) => ({ ...x })),
        zones: this.zones.map((z) => ({
          ...z,
          coordinates: z.coordinates.map((c) => ({ ...c })),
        })),
      });
      while (this.playbackFrames.length > 120) this.playbackFrames.shift();
    }
  }

  /**
   * Applies routing / motion from `pendingDirective` immediately; keeps pending until captain ack or escalate.
   * @returns whether the directive could be executed (hold always ok; reroute/divert require a valid route).
   */
  applyDirectiveEffectsNow(shipId: string): boolean {
    const ship = this.ships.find((s) => s.shipId === shipId);
    if (!ship?.pendingDirective) return false;
    const d = ship.pendingDirective;

    if (d.type === "HOLD") {
      ship.status = "holding";
      ship.speed = 0;
      ship.lastAppliedDirective = d;
      ship.lastAppliedAtMs = this.simTimeMs;
      return true;
    }

    if (d.type === "REROUTE_PORT") {
      if (!d.targetPortId) return false;
      ship.destinationPortId = d.targetPortId;
      ship.divertTarget = null;
      ship.status = "normal";
      ship.speed = ship.cruiseSpeed;
      const ok = this.assignRoute(ship, true);
      if (ok) {
        ship.lastAppliedDirective = d;
        ship.lastAppliedAtMs = this.simTimeMs;
      }
      return ok;
    }

    if (d.type === "DIVERT_WAYPOINT") {
      if (!d.waypoint) return false;
      ship.divertTarget = d.waypoint;
      ship.status = "normal";
      ship.speed = ship.cruiseSpeed;
      const ok = this.assignRoute(ship, true);
      if (ok) {
        ship.lastAppliedDirective = d;
        ship.lastAppliedAtMs = this.simTimeMs;
      }
      return ok;
    }

    return false;
  }

  /** Captain acknowledged — effects already ran when command issued */
  applyDirectiveAccepted(shipId: string): void {
    const ship = this.ships.find((s) => s.shipId === shipId);
    if (!ship?.pendingDirective) return;
    ship.lastAppliedDirective = ship.pendingDirective;
    ship.lastAppliedAtMs = this.simTimeMs;
    ship.lastDirectiveId = ship.pendingDirective.id;
    ship.pendingDirective = null;
  }

  getSimTimeMs(): number {
    return this.simTimeMs;
  }
}

function readGeneratedLandExclusions(): Position[][] {
  try {
    const candidates = [
      // When running inside apps/server (recommended)
      path.join(process.cwd(), "src/data/landExclusions.generated.json"),
      // When running from repo root (common in monorepo tooling)
      path.join(process.cwd(), "apps/server/src/data/landExclusions.generated.json"),
      // When running compiled JS from dist/ (fallback)
      path.join(__dirname, "../data/landExclusions.generated.json"),
      path.join(__dirname, "../../src/data/landExclusions.generated.json"),
    ];

    let raw: string | null = null;
    for (const p of candidates) {
      try {
        raw = fs.readFileSync(p, "utf8");
        break;
      } catch {
        // try next candidate
      }
    }
    if (!raw) return [];

    const rings = JSON.parse(raw) as [number, number][][];
    return rings.map((ring) => ring.map(([lat, lng]) => ({ lat, lng })));
  } catch {
    return [];
  }
}

function severityToScore(s: AlertSeverity): number {
  switch (s) {
    case "critical":
      return 100;
    case "high":
      return 75;
    case "medium":
      return 50;
    default:
      return 25;
  }
}
