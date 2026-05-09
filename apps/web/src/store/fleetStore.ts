"use client";

import type { FleetSnapshot, PlaybackFrame, Position } from "@strait-command/shared";
import { create } from "zustand";

export type Role = "command" | "captain";
export type UiTheme = "dark" | "light";

/** Client-side API bootstrap phase (poll `/health` before Socket.IO). */
export type FleetApiStatus = "checking" | "unreachable" | "starting" | "live";

interface FleetDisplayShip {
  shipId: string;
  position: Position;
  target: Position;
}

interface FleetStore {
  connected: boolean;
  role: Role;
  captainShipId: string;
  snapshot: FleetSnapshot | null;
  playbackFrames: PlaybackFrame[];
  playbackIndex: number | null;
  playbackActive: boolean;
  zoneDraft: Position[];
  /** Planned polygon vertices for hazard zone (command draws exactly this many) */
  zoneVertexTarget: number;
  /** NM allowance inland beyond navigable polygon boundary */
  zoneCoastalBufferNm: number;
  /** Last placement hint / rejection reason while drawing zones */
  zonePlacementHint: string | null;
  drawZones: boolean;
  selectedShipId: string | null;
  displayShips: Record<string, FleetDisplayShip>;
  /** Map overlays */
  showPorts: boolean;
  showVoyageEndpoints: boolean;
  showVoyageEndpointsOnHover: boolean;
  setConnected: (v: boolean) => void;
  setRole: (r: Role, captainShipId?: string) => void;
  applySnapshot: (s: FleetSnapshot) => void;
  setPlaybackFrames: (f: PlaybackFrame[]) => void;
  setPlaybackIndex: (i: number | null) => void;
  setPlaybackActive: (v: boolean) => void;
  tickInterpolation: (dtMs: number) => void;
  clearZoneDraft: () => void;
  pushZoneVertex: (p: Position) => void;
  removeLastZoneVertex: () => void;
  setZoneVertexTarget: (n: number) => void;
  setZoneCoastalBufferNm: (nm: number) => void;
  setZonePlacementHint: (msg: string | null) => void;
  setDrawZones: (v: boolean) => void;
  setSelectedShipId: (id: string | null) => void;
  setShowPorts: (v: boolean) => void;
  setShowVoyageEndpoints: (v: boolean) => void;
  setShowVoyageEndpointsOnHover: (v: boolean) => void;
  /** UI chrome */
  uiTheme: UiTheme;
  leftSidebarOpen: boolean;
  alertsPanelOpen: boolean;
  setUiTheme: (t: UiTheme) => void;
  toggleLeftSidebar: () => void;
  toggleAlertsPanel: () => void;
  fleetApiStatus: FleetApiStatus;
  setFleetApiStatus: (s: FleetApiStatus) => void;
}

const NM_PER_MS_KNOTS = 1 / (3600 * 1000);

export const ZONE_VERTEX_MIN = 3;
export const ZONE_VERTEX_MAX = 24;

function clampZoneTarget(n: number): number {
  return Math.min(ZONE_VERTEX_MAX, Math.max(ZONE_VERTEX_MIN, Math.round(n)));
}

export const useFleetStore = create<FleetStore>((set, get) => ({
  connected: false,
  role: "command",
  captainShipId: "MV-1",
  snapshot: null,
  playbackFrames: [],
  playbackIndex: null,
  playbackActive: false,
  zoneDraft: [],
  zoneVertexTarget: 4,
  zoneCoastalBufferNm: 3,
  zonePlacementHint: null,
  drawZones: false,
  selectedShipId: null,
  displayShips: {},
  showPorts: true,
  showVoyageEndpoints: false,
  showVoyageEndpointsOnHover: true,
  uiTheme: "dark",
  leftSidebarOpen: true,
  alertsPanelOpen: true,
  fleetApiStatus: "checking",
  setFleetApiStatus: (s) => set({ fleetApiStatus: s }),
  setConnected: (v) => set({ connected: v }),
  setRole: (r, captainShipId) =>
    set({
      role: r,
      captainShipId: captainShipId ?? get().captainShipId,
    }),
  applySnapshot: (s) =>
    set((state) => {
      const nextDisplay = { ...state.displayShips };
      for (const sh of s.ships) {
        const prev = nextDisplay[sh.shipId];
        const target = { ...sh.position };
        if (!prev) {
          nextDisplay[sh.shipId] = {
            shipId: sh.shipId,
            position: { ...target },
            target,
          };
        } else {
          nextDisplay[sh.shipId] = {
            ...prev,
            target,
          };
        }
      }
      return { snapshot: s, displayShips: nextDisplay };
    }),
  setPlaybackFrames: (f) => set({ playbackFrames: f }),
  setPlaybackIndex: (i) => set({ playbackIndex: i }),
  setPlaybackActive: (v) => set({ playbackActive: v }),
  tickInterpolation: (dtMs) =>
    set((state) => {
      if (!state.snapshot || state.playbackActive) return state;
      const snap = state.snapshot;
      const next = { ...state.displayShips };
      for (const sh of snap.ships) {
        const cur = next[sh.shipId];
        if (!cur) continue;
        const speed = Math.max(sh.cruiseSpeed ?? sh.speed, 2);
        const maxStepNm = speed * NM_PER_MS_KNOTS * dtMs;
        const distNm = haversineNmApprox(cur.position, cur.target);
        if (distNm < 0.0005) {
          next[sh.shipId] = { ...cur, position: { ...cur.target } };
          continue;
        }
        const t = Math.min(1, maxStepNm / Math.max(distNm, 1e-9));
        next[sh.shipId] = {
          ...cur,
          position: lerpLatLng(cur.position, cur.target, t),
        };
      }
      return { displayShips: next };
    }),
  clearZoneDraft: () => set({ zoneDraft: [], zonePlacementHint: null }),
  pushZoneVertex: (p) =>
    set((state) => ({ zoneDraft: [...state.zoneDraft, p], zonePlacementHint: null })),
  removeLastZoneVertex: () =>
    set((state) => ({
      zoneDraft: state.zoneDraft.slice(0, -1),
      zonePlacementHint: null,
    })),
  setZoneVertexTarget: (n) => {
    if (!Number.isFinite(n)) return;
    set({ zoneVertexTarget: clampZoneTarget(n) });
  },
  setZoneCoastalBufferNm: (nm) => {
    if (!Number.isFinite(nm)) return;
    set({
      zoneCoastalBufferNm: Math.min(50, Math.max(0, nm)),
    });
  },
  setZonePlacementHint: (msg) => set({ zonePlacementHint: msg }),
  setDrawZones: (v) =>
    set({
      drawZones: v,
      zoneDraft: [],
      zonePlacementHint: null,
    }),
  setSelectedShipId: (id) => set({ selectedShipId: id }),
  setShowPorts: (v) => set({ showPorts: v }),
  setShowVoyageEndpoints: (v) => set({ showVoyageEndpoints: v }),
  setShowVoyageEndpointsOnHover: (v) => set({ showVoyageEndpointsOnHover: v }),
  setUiTheme: (t) => set({ uiTheme: t }),
  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleAlertsPanel: () =>
    set((s) => ({ alertsPanelOpen: !s.alertsPanelOpen })),
}));

function lerpLatLng(a: Position, b: Position, t: number): Position {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

function haversineNmApprox(a: Position, b: Position): number {
  const dy = (b.lat - a.lat) * 60;
  const dx =
    (b.lng - a.lng) * 60 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dx * dx + dy * dy);
}
