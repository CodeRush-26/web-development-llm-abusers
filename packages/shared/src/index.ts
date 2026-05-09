/** Shared contracts — Strait Command maritime ops platform */

export type OperationalStatus =
  | "normal"
  | "rerouting"
  | "distressed"
  /** Fuel depleted — vessel dead in water until scenario reset */
  | "out_of_fuel"
  | "stranded"
  | "insufficient_fuel"
  | "arrived"
  | "holding";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AlertType =
  | "geofence_breach"
  | "distress_escalation"
  | "proximity_collision"
  | "fuel_insufficient"
  | "stranded_ship"
  | "severe_weather_exposure"
  | "route_deviation";

export interface Position {
  lat: number;
  lng: number;
}

export interface Ship {
  shipId: string;
  name: string;
  position: Position;
  speed: number;
  heading: number;
  /** Starting port for the current voyage (static for the scenario unless reset). */
  sourcePortId: string;
  destinationPortId: string;
  fuel: number;
  cargo: string;
  status: OperationalStatus;
  /** Knots — effective target this tick */
  targetSpeed?: number;
  /** Route waypoints [lat,lng] excluding current position */
  routeWaypoints: Position[];
  /** Index into routeWaypoints */
  routeIndex: number;
  /** Pending command directive awaiting captain response */
  pendingDirective?: Directive | null;
  /** Last directive applied to this ship (for captain visibility even after auto-apply). */
  lastAppliedDirective?: Directive | null;
  /** Sim time when lastAppliedDirective was set. */
  lastAppliedAtMs?: number | null;
  /** Last acknowledged directive id */
  lastDirectiveId?: string | null;
  /** Design cruise speed (knots) for recovery from HOLD */
  cruiseSpeed: number;
  /** Optional command diversion before resuming port routing */
  divertTarget?: Position | null;
}

export interface Port {
  id: string;
  name: string;
  position: Position;
}

export interface ScenarioMeta {
  name: string;
  description: string;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface FleetDataset {
  scenario: ScenarioMeta;
  coordinateFormat: string;
  units: Record<string, string>;
  boundingBox: BoundingBox;
  navigableWater: [number, number][];
  /**
   * Closed rings (first point ≈ last) marking land / impassable areas inside the coarse navigable hull.
   * Used only for routing occupancy — not shown as operator restricted zones.
   */
  landExclusions?: [number, number][][];
  ports: { id: string; name: string; position: [number, number] }[];
  fleet: {
    shipId: string;
    name: string;
    position: [number, number];
    speed: number;
    heading: number;
    /** Optional origin port id (if omitted, server will infer nearest port). */
    source?: string;
    destination: string;
    fuel: number;
    cargo: string;
    status: string;
  }[];
}

export interface RestrictedZone {
  id: string;
  name: string;
  coordinates: Position[];
  createdAt: number;
  updatedAt: number;
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  shipId?: string;
  /** Second ship for proximity */
  relatedShipId?: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  /** AI-derived priority score 0–100 */
  aiPriorityScore?: number;
  /** Structured distress analysis when applicable */
  distressAnalysis?: DistressAnalysis;
}

export type DirectiveType = "REROUTE_PORT" | "DIVERT_WAYPOINT" | "HOLD";

export interface Directive {
  id: string;
  type: DirectiveType;
  shipId: string;
  issuedAt: number;
  issuedBy: string;
  /** Port id for REROUTE_PORT */
  targetPortId?: string;
  /** For DIVERT_WAYPOINT */
  waypoint?: Position;
  note?: string;
}

export interface CaptainResponse {
  directiveId: string;
  shipId: string;
  action: "ACCEPT" | "ESCALATE_DISTRESS";
  distressMessage?: string;
  respondedAt: number;
  captainId: string;
}

/** Broadcast to all clients when a directive’s effects run (routing, hold, etc.). */
export interface DirectiveResultPayload {
  directive: Directive;
  shipId: string;
  success: boolean;
  /** Set when the order could not be executed as issued */
  error?: "no_route" | "invalid_directive";
}

export interface DistressAnalysis {
  severity: AlertSeverity;
  category: string;
  injuryCount: number | null;
  damageEstimate: string | null;
  operationalImpact: string;
  recommendedUrgency: string;
  summary: string;
  rawMessage: string;
  analyzedAt: number;
}

export interface WeatherCell {
  lat: number;
  lng: number;
  windSpeedMs: number;
  precipitationMm: number;
  /** Server marks adverse per grading rules */
  adverse: boolean;
}

export interface FleetSnapshot {
  ships: Ship[];
  zones: RestrictedZone[];
  alerts: Alert[];
  ports: Port[];
  navigablePolygon: Position[];
  boundingBox: BoundingBox;
  scenario: ScenarioMeta;
  tick: number;
  simTimeMs: number;
  weatherCells: WeatherCell[];
  /** When true, simulation time and motion are frozen */
  simulationPaused: boolean;
}

export interface PlaybackFrame {
  simTimeMs: number;
  ships: Ship[];
  alerts: Alert[];
  /** Restricted zones at this frame (for historical replay) */
  zones: RestrictedZone[];
}

export interface ServerToClientEvents {
  "fleet:snapshot": (snapshot: FleetSnapshot) => void;
  "fleet:tick": (payload: {
    tick: number;
    simTimeMs: number;
    simulationPaused: boolean;
  }) => void;
  "alert:new": (alert: Alert) => void;
  "alert:updated": (alert: Alert) => void;
  "zone:updated": (zones: RestrictedZone[]) => void;
  "directive:pending": (directive: Directive) => void;
  /** All tabs see whether the order took effect (routing succeeded or failed). */
  "directive:result": (payload: DirectiveResultPayload) => void;
  "captain:response": (response: CaptainResponse) => void;
  "playback:frames": (frames: PlaybackFrame[]) => void;
  "distress:analyzed": (payload: { shipId: string; analysis: DistressAnalysis }) => void;
  "error": (message: string) => void;
}

export interface ClientToServerEvents {
  "role:join": (payload: {
    role: "command" | "captain";
    captainShipId?: string;
    operatorId?: string;
  }) => void;
  "zone:save": (payload: {
    id?: string;
    name: string;
    coordinates: Position[];
  }) => void;
  "zone:delete": (zoneId: string) => void;
  "directive:send": (directive: Omit<Directive, "issuedAt"> & { issuedAt?: number }) => void;
  "captain:respond": (response: CaptainResponse) => void;
  "alert:ack": (payload: { alertId: string; operatorId: string }) => void;
  "playback:request": () => void;
  /** Command role — freeze or resume simulation clock and physics */
  "sim:setPaused": (payload: { paused: boolean }) => void;
}
