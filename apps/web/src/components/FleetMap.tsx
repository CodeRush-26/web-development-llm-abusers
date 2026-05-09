"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import maplibregl, {
  type DataDrivenPropertyValueSpecification,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { Position } from "@strait-command/shared";
import { getFleetApiOrigin } from "@/lib/fleetApiOrigin";
import { isMaritimeZoneVertexAllowed } from "@/lib/maritimeZone";
import { useFleetStore, type UiTheme } from "@/store/fleetStore";
import clsx from "clsx";

/** Match sidebar semantics: each operational status maps to the same hue family on the map. */
function shipStatusCircleColorExpr(dark: boolean): DataDrivenPropertyValueSpecification<string> {
  const def = dark ? "#22d3ee" : "#0891b2";
  return [
    "match",
    ["get", "status"],
    "normal",
    def,
    "rerouting",
    "#fbbf24",
    "distressed",
    "#ef4444",
    "out_of_fuel",
    "#94a3b8",
    "stranded",
    "#f43f5e",
    "insufficient_fuel",
    "#fb923c",
    "arrived",
    "#34d399",
    "holding",
    "#c084fc",
    def,
  ] as DataDrivenPropertyValueSpecification<string>;
}

/** Status keys we bake ship-arrow sprites for (must match engine + `shipStatusAccentHex`) */
const SHIP_ARROW_STATUSES = [
  "normal",
  "rerouting",
  "distressed",
  "out_of_fuel",
  "stranded",
  "insufficient_fuel",
  "arrived",
  "holding",
] as const;

function shipArrowIconId(status: string, dark: boolean): string {
  const prefix = dark ? "d" : "l";
  const key = SHIP_ARROW_STATUSES.includes(status as (typeof SHIP_ARROW_STATUSES)[number])
    ? status
    : "normal";
  return `ship-arrow-${prefix}-${key}`;
}

function shipArrowIconLayoutExpr(
  theme: UiTheme,
): DataDrivenPropertyValueSpecification<string> {
  const dark = theme === "dark";
  const def = shipArrowIconId("normal", dark);
  return [
    "match",
    ["get", "status"],
    "normal",
    shipArrowIconId("normal", dark),
    "rerouting",
    shipArrowIconId("rerouting", dark),
    "distressed",
    shipArrowIconId("distressed", dark),
    "out_of_fuel",
    shipArrowIconId("out_of_fuel", dark),
    "stranded",
    shipArrowIconId("stranded", dark),
    "insufficient_fuel",
    shipArrowIconId("insufficient_fuel", dark),
    "arrived",
    shipArrowIconId("arrived", dark),
    "holding",
    shipArrowIconId("holding", dark),
    def,
  ] as DataDrivenPropertyValueSpecification<string>;
}

/** Raster triangle — Unicode ▲ in `text-field` often has no glyph in Carto font stacks, so nothing draws */
function createTriangleArrowImage(fillHex: string, strokeHex: string): ImageData {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const top = size * 0.1;
  const bot = size * 0.9;
  const halfW = size * 0.44;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + halfW, bot);
  ctx.lineTo(cx - halfW, bot);
  ctx.closePath();
  ctx.fillStyle = fillHex;
  ctx.fill();
  ctx.strokeStyle = strokeHex;
  ctx.lineWidth = Math.max(2, size * 0.055);
  ctx.lineJoin = "round";
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function registerShipArrowIcons(map: MapLibreMap, theme: UiTheme): void {
  const dark = theme === "dark";
  const stroke = dark ? "#0f172a" : "#ffffff";
  for (const status of SHIP_ARROW_STATUSES) {
    const id = shipArrowIconId(status, dark);
    if (map.hasImage(id)) continue;
    const fill = shipStatusAccentHex(status, theme);
    map.addImage(id, createTriangleArrowImage(fill, stroke), { pixelRatio: 2 });
  }
}

export type ShipMapHover =
  | {
      shipId: string;
      clientX: number;
      clientY: number;
    }
  | null;

/** Tooltip / legend — must stay in sync with `shipStatusCircleColorExpr` hues */
function shipStatusAccentHex(status: string, uiTheme: UiTheme): string {
  const dark = uiTheme === "dark";
  const def = dark ? "#22d3ee" : "#0891b2";
  const map: Record<string, string> = {
    normal: def,
    rerouting: "#fbbf24",
    distressed: "#ef4444",
    out_of_fuel: "#94a3b8",
    stranded: "#f43f5e",
    insufficient_fuel: "#fb923c",
    arrived: "#34d399",
    holding: "#c084fc",
  };
  return map[status] ?? def;
}

function formatShipStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

function styleUrlForTheme(theme: UiTheme): string {
  return theme === "dark" ? STYLE_DARK : STYLE_LIGHT;
}

function applyAtmosphere(map: MapLibreMap, theme: UiTheme): void {
  const dark = theme === "dark";
  /** Carto GL styles may omit sky/terrain slots — failures must not skip ship layers */
  try {
    map.setSky(
      dark
        ? {
            "sky-color": "#1b3558",
            "horizon-color": "#0c1428",
            "fog-color": "#080f1e",
            "fog-ground-blend": 0.38,
            "horizon-fog-blend": 0.58,
            "sky-horizon-blend": 0.68,
            "atmosphere-blend": 0.88,
          }
        : {
            "sky-color": "#7dd3fc",
            "horizon-color": "#f0f9ff",
            "fog-color": "#dce8f5",
            "fog-ground-blend": 0.26,
            "horizon-fog-blend": 0.42,
            "sky-horizon-blend": 0.78,
            "atmosphere-blend": 0.92,
          },
    );
  } catch {
    /* ignore — map works without sky */
  }
  try {
    map.setTerrain(null);
  } catch {
    /* no terrain source — keep flat map */
  }
}

const SHIP_HIT_LAYERS = ["ships-arrow", "ships-label"] as const;
/** Pixels — ships are arrow glyphs only (no hull circle), so hits use symbol query + proximity */
const MAX_SHIP_PICK_PX = 30;

function resolveShipHitId(map: MapLibreMap, e: maplibregl.MapMouseEvent): string | undefined {
  const feats = map.queryRenderedFeatures(e.point, { layers: [...SHIP_HIT_LAYERS] });
  const fromGlyph = feats[0]?.properties?.id as string | undefined;
  if (fromGlyph) return fromGlyph;

  const st = useFleetStore.getState();
  if (st.drawZones) return undefined;
  const snap = st.snapshot;
  if (!snap) return undefined;

  const pt = e.point;
  let bestId: string | undefined;
  let bestD = MAX_SHIP_PICK_PX;

  const frame =
    st.playbackActive && st.playbackIndex != null
      ? st.playbackFrames[st.playbackIndex]
      : null;
  const shipsSource = frame?.ships ?? snap.ships;

  for (const ship of shipsSource) {
    const disp = st.displayShips[ship.shipId];
    const pos =
      st.playbackActive && frame ? ship.position : disp ? disp.position : ship.position;
    const screen = map.project([pos.lng, pos.lat]);
    const d = Math.hypot(screen.x - pt.x, screen.y - pt.y);
    if (d < bestD) {
      bestD = d;
      bestId = ship.shipId;
    }
  }
  return bestId;
}

function bindShipHitHandlers(
  map: MapLibreMap,
  hoveredShipIdRef: MutableRefObject<string | null>,
  applyOverlayFilters: () => void,
  onHoverUi?: (h: ShipMapHover) => void,
): () => void {
  const canvas = map.getCanvas();

  const onShipClick = (e: maplibregl.MapMouseEvent): void => {
    if (useFleetStore.getState().drawZones) return;
    const id = resolveShipHitId(map, e);
    if (id) useFleetStore.getState().setSelectedShipId(id);
  };
  const onShipMove = (e: maplibregl.MapMouseEvent): void => {
    if (useFleetStore.getState().drawZones) {
      map.getCanvas().style.cursor = "";
      if (hoveredShipIdRef.current !== null) {
        hoveredShipIdRef.current = null;
        applyOverlayFilters();
      }
      onHoverUi?.(null);
      return;
    }
    const id = resolveShipHitId(map, e);
    const next = id ?? null;
    const oe = e.originalEvent as MouseEvent;
    if (hoveredShipIdRef.current !== next) {
      hoveredShipIdRef.current = next;
      applyOverlayFilters();
    }
    map.getCanvas().style.cursor = next ? "pointer" : "";
    if (next) {
      onHoverUi?.({ shipId: next, clientX: oe.clientX, clientY: oe.clientY });
    } else {
      onHoverUi?.(null);
    }
  };

  const onCanvasLeave = (): void => {
    hoveredShipIdRef.current = null;
    applyOverlayFilters();
    map.getCanvas().style.cursor = "";
    onHoverUi?.(null);
  };

  map.on("click", onShipClick);
  map.on("mousemove", onShipMove);
  canvas.addEventListener("mouseleave", onCanvasLeave);
  return () => {
    map.off("click", onShipClick);
    map.off("mousemove", onShipMove);
    canvas.removeEventListener("mouseleave", onCanvasLeave);
    map.getCanvas().style.cursor = "";
  };
}

function addOperationalLayers(map: MapLibreMap, theme: UiTheme): void {
  const dark = theme === "dark";

  /** No external raster-DEM: demotiles.maplibre.org often fails (offline / CORS / service) and spams console. */
  applyAtmosphere(map, theme);

  map.addSource("nav", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "nav-line",
    type: "line",
    source: "nav",
    paint: {
      "line-color": dark ? "#c4836a" : "#a85d45",
      "line-opacity": dark ? 0.42 : 0.48,
      "line-width": 1.5,
    },
  });

  map.addSource("routes", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "routes-line",
    type: "line",
    source: "routes",
    paint: {
      "line-color": dark ? "#38bdf8" : "#0284c7",
      "line-opacity": dark ? 0.55 : 0.62,
      "line-width": 2,
    },
  });

  map.addSource("zones", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "zones-fill",
    type: "fill",
    source: "zones",
    paint: {
      "fill-color": "#ef4444",
      "fill-opacity": dark ? 0.22 : 0.18,
    },
  });
  map.addLayer({
    id: "zones-outline",
    type: "line",
    source: "zones",
    paint: {
      "line-color": "#ef4444",
      "line-opacity": 0.85,
      "line-width": 2,
    },
  });

  map.addSource("ships", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  registerShipArrowIcons(map, theme);
  map.addLayer({
    id: "ships-arrow",
    type: "symbol",
    source: "ships",
    layout: {
      "icon-image": shipArrowIconLayoutExpr(theme),
      "icon-size": 0.32,
      "icon-rotate": ["coalesce", ["to-number", ["get", "heading"]], 0],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: "ships-label",
    type: "symbol",
    source: "ships",
    layout: {
      "text-field": ["get", "label"],
      "text-size": 9,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
    },
    paint: {
      "text-color": dark ? "#e2e8f0" : "#0f172a",
      "text-halo-color": dark ? "#020617" : "#ffffff",
      "text-halo-width": dark ? 1.1 : 1.35,
    },
  });

  map.addSource("ports", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "ports-core",
    type: "circle",
    source: "ports",
    paint: {
      "circle-radius": 4,
      "circle-color": dark ? "#a78bfa" : "#7c3aed",
      "circle-opacity": dark ? 0.75 : 0.85,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": dark ? "#0f172a" : "#f8fafc",
    },
  });
  map.addLayer({
    id: "ports-label",
    type: "symbol",
    source: "ports",
    layout: {
      "text-field": ["get", "label"],
      "text-size": 10,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
    },
    paint: {
      "text-color": dark ? "#ddd6fe" : "#4c1d95",
      "text-halo-color": dark ? "#020617" : "#ffffff",
      "text-halo-width": dark ? 1.1 : 1.5,
    },
  });

  map.addSource("endpoints", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "endpoints-line",
    type: "line",
    source: "endpoints",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": [
        "match",
        ["get", "kind"],
        "source",
        dark ? "#34d399" : "#059669",
        "destination",
        dark ? "#fbbf24" : "#d97706",
        dark ? "#a78bfa" : "#7c3aed",
      ],
      "line-opacity": dark ? 0.35 : 0.4,
      "line-width": 1.5,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "endpoints-core",
    type: "circle",
    source: "endpoints",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": [
        "match",
        ["get", "kind"],
        "source",
        dark ? "#34d399" : "#059669",
        "destination",
        dark ? "#fbbf24" : "#d97706",
        dark ? "#a78bfa" : "#7c3aed",
      ],
      "circle-opacity": dark ? 0.85 : 0.9,
      "circle-stroke-width": 2,
      "circle-stroke-color": dark ? "#0f172a" : "#f8fafc",
    },
  });
  map.addLayer({
    id: "endpoints-label",
    type: "symbol",
    source: "endpoints",
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 10,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
    },
    paint: {
      "text-color": [
        "match",
        ["get", "kind"],
        "source",
        dark ? "#6ee7b7" : "#047857",
        "destination",
        dark ? "#fcd34d" : "#b45309",
        dark ? "#e2e8f0" : "#0f172a",
      ],
      "text-halo-color": dark ? "#020617" : "#ffffff",
      "text-halo-width": dark ? 1.1 : 1.5,
    },
  });

  map.addSource("zone-draft-overlay", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "zone-draft-path",
    type: "line",
    source: "zone-draft-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": dark ? "#fbbf24" : "#d97706",
      "line-opacity": 0.95,
      "line-width": 2.5,
      "line-dasharray": [1.5, 1.5],
    },
  });
  map.addLayer({
    id: "zone-draft-vertices",
    type: "circle",
    source: "zone-draft-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 7,
      "circle-color": dark ? "#22d3ee" : "#0891b2",
      "circle-opacity": 0.95,
      "circle-stroke-width": 2,
      "circle-stroke-color": dark ? "#0f172a" : "#ffffff",
    },
  });
  map.addLayer({
    id: "zone-draft-vertex-labels",
    type: "symbol",
    source: "zone-draft-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": dark ? "#020617" : "#ffffff",
      "text-halo-color": dark ? "#ffffff" : "#0f172a",
      "text-halo-width": 1.2,
    },
  });
}

export function FleetMap({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const lastRafRef = useRef<number | null>(null);
  const themeRef = useRef<UiTheme>("dark");
  const themeApplyPassRef = useRef<UiTheme | undefined>(undefined);
  const introEaseDoneRef = useRef(false);
  const hoveredShipIdRef = useRef<string | null>(null);
  const shipHitCleanupRef = useRef<(() => void) | null>(null);
  const applyOverlayFiltersRef = useRef<() => void>(() => {});
  const setShipHoverRef = useRef<(h: ShipMapHover) => void>(() => {});

  const [shipHover, setShipHover] = useState<ShipMapHover>(null);
  setShipHoverRef.current = setShipHover;

  const uiTheme = useFleetStore((s) => s.uiTheme);
  const connected = useFleetStore((s) => s.connected);
  const fleetApiStatus = useFleetStore((s) => s.fleetApiStatus);
  const snapshot = useFleetStore((s) => s.snapshot);
  const displayShips = useFleetStore((s) => s.displayShips);
  const showPorts = useFleetStore((s) => s.showPorts);
  const showVoyageEndpoints = useFleetStore((s) => s.showVoyageEndpoints);
  const showVoyageEndpointsOnHover = useFleetStore((s) => s.showVoyageEndpointsOnHover);
  const playbackActive = useFleetStore((s) => s.playbackActive);
  const playbackFrames = useFleetStore((s) => s.playbackFrames);
  const playbackIndex = useFleetStore((s) => s.playbackIndex);
  const playbackFrame =
    playbackActive && playbackIndex != null ? playbackFrames[playbackIndex] ?? null : null;
  const zones = playbackFrame?.zones ?? snapshot?.zones ?? [];
  const zoneDraft = useFleetStore((s) => s.zoneDraft);
  const drawZones = useFleetStore((s) => s.drawZones);
  const zoneVertexTarget = useFleetStore((s) => s.zoneVertexTarget);
  const zoneCoastalBufferNm = useFleetStore((s) => s.zoneCoastalBufferNm);
  const zonePlacementHint = useFleetStore((s) => s.zonePlacementHint);
  const selectedShipId = useFleetStore((s) => s.selectedShipId);

  const resetView = (): void => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [56.25, 26.2],
      zoom: 6.45,
      pitch: 62,
      bearing: -22,
      duration: 850,
      essential: true,
    });
  };

  const applyOverlayFilters = (): void => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer("ports-core")) return;
    if (!map.getLayer("endpoints-core")) return;

    const portsVis = showPorts ? "visible" : "none";
    map.setLayoutProperty("ports-core", "visibility", portsVis);
    map.setLayoutProperty("ports-label", "visibility", portsVis);

    const hoverId = hoveredShipIdRef.current;
    const showEndpointsNow =
      showVoyageEndpoints || (showVoyageEndpointsOnHover && hoverId != null);

    const epVis = showEndpointsNow ? "visible" : "none";
    map.setLayoutProperty("endpoints-line", "visibility", epVis);
    map.setLayoutProperty("endpoints-core", "visibility", epVis);
    map.setLayoutProperty("endpoints-label", "visibility", epVis);

    if (!showEndpointsNow) return;
    if (showVoyageEndpoints || !hoverId) {
      map.setFilter("endpoints-line", ["==", ["geometry-type"], "LineString"]);
      map.setFilter("endpoints-core", ["==", ["geometry-type"], "Point"]);
      map.setFilter("endpoints-label", ["==", ["geometry-type"], "Point"]);
      return;
    }

    map.setFilter("endpoints-line", [
      "all",
      ["==", ["geometry-type"], "LineString"],
      ["==", ["get", "shipId"], hoverId],
    ]);
    map.setFilter("endpoints-core", [
      "all",
      ["==", ["geometry-type"], "Point"],
      ["==", ["get", "shipId"], hoverId],
    ]);
    map.setFilter("endpoints-label", [
      "all",
      ["==", ["geometry-type"], "Point"],
      ["==", ["get", "shipId"], hoverId],
    ]);
  };

  applyOverlayFiltersRef.current = applyOverlayFilters;

  /** Single stable dependency for map GeoJSON sync — keeps useEffect arity fixed for React (avoids HMR / hook mismatch warnings). */
  const mapSyncInputs = useMemo(
    () => ({
      snapshot,
      displayShips,
      zones,
      zoneDraft,
      playbackActive,
      playbackFrames,
      playbackIndex,
      uiTheme,
      showPorts,
      showVoyageEndpoints,
      showVoyageEndpointsOnHover,
    }),
    [
      snapshot,
      displayShips,
      zones,
      zoneDraft,
      playbackActive,
      playbackFrames,
      playbackIndex,
      uiTheme,
      showPorts,
      showVoyageEndpoints,
      showVoyageEndpointsOnHover,
    ],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialTheme = useFleetStore.getState().uiTheme;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrlForTheme(initialTheme),
      center: [56.25, 26.2],
      zoom: 6.45,
      pitch: 62,
      bearing: -22,
      maxPitch: 85,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    map.on("load", () => {
      const t = useFleetStore.getState().uiTheme;
      themeRef.current = t;
      try {
        addOperationalLayers(map, t);
      } catch (err) {
        console.error("[FleetMap] addOperationalLayers failed", err);
      }
      shipHitCleanupRef.current?.();
      shipHitCleanupRef.current = bindShipHitHandlers(
        map,
        hoveredShipIdRef,
        () => applyOverlayFiltersRef.current(),
        (h) => setShipHoverRef.current(h),
      );
      map.once("idle", () => {
        if (introEaseDoneRef.current) return;
        introEaseDoneRef.current = true;
        map.easeTo({
          pitch: 64,
          bearing: -24,
          duration: 1400,
          essential: true,
        });
      });
    });

    map.on("click", (e) => {
      const st = useFleetStore.getState();
      if (!st.drawZones) return;
      const nav = st.snapshot?.navigablePolygon ?? [];
      const target = st.zoneVertexTarget;
      const buf = st.zoneCoastalBufferNm;
      const p = { lat: e.lngLat.lat, lng: e.lngLat.lng };

      if (st.zoneDraft.length >= target) {
        useFleetStore.getState().setZonePlacementHint(
          `All ${target} corners placed — save or cancel from the Hazards panel.`,
        );
        return;
      }

      if (!isMaritimeZoneVertexAllowed(p, nav, buf)) {
        useFleetStore.getState().setZonePlacementHint(
          nav.length < 3
            ? "Fleet navigable chart not loaded yet — wait for connection."
            : `Outside chart water and beyond the ${buf.toFixed(1)} NM coastal strip — click inside the sea lane or near shore.`,
        );
        return;
      }

      useFleetStore.getState().pushZoneVertex(p);
    });

    mapRef.current = map;
    return () => {
      shipHitCleanupRef.current?.();
      shipHitCleanupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (themeApplyPassRef.current === undefined) {
      themeApplyPassRef.current = uiTheme;
      themeRef.current = uiTheme;
      return;
    }

    if (themeApplyPassRef.current === uiTheme) return;

    themeApplyPassRef.current = uiTheme;
    themeRef.current = uiTheme;

    map.setStyle(styleUrlForTheme(uiTheme));
    map.once("style.load", () => {
      try {
        addOperationalLayers(map, uiTheme);
      } catch (err) {
        console.error("[FleetMap] addOperationalLayers failed", err);
      }
      shipHitCleanupRef.current?.();
      shipHitCleanupRef.current = bindShipHitHandlers(
        map,
        hoveredShipIdRef,
        () => applyOverlayFiltersRef.current(),
        (h) => setShipHoverRef.current(h),
      );
      applyOverlayFilters();
    });
  }, [uiTheme]);

  useEffect(() => {
    applyOverlayFilters();
  }, [showPorts, showVoyageEndpoints, showVoyageEndpointsOnHover]);

  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      if (lastRafRef.current != null) {
        const dt = t - lastRafRef.current;
        useFleetStore.getState().tickInterpolation(dt);
      }
      lastRafRef.current = t;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const snap = mapSyncInputs.snapshot;
    if (!snap) return;

    const {
      displayShips: dispShips,
      zones: zList,
      zoneDraft: draft,
      playbackActive: pbActive,
      playbackFrames: pbFrames,
      playbackIndex: pbIdx,
    } = mapSyncInputs;

    const pushData = (): void => {
      if (!map.getSource("ships")) return;

      const navRing = snap.navigablePolygon.map((p) => [p.lng, p.lat] as [number, number]);
      navRing.push(navRing[0]!);
      const navSrc = map.getSource("nav") as maplibregl.GeoJSONSource;
      navSrc?.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: navRing },
          },
        ],
      });

      const shipFeatures: GeoJSON.Feature[] = [];
      const routeFeatures: GeoJSON.Feature[] = [];
      const portFeatures: GeoJSON.Feature[] = [];
      const endpointFeatures: GeoJSON.Feature[] = [];

      const frame =
        pbActive && pbIdx != null ? pbFrames[pbIdx] ?? null : null;
      const shipsSource = frame?.ships ?? snap.ships;

      for (const ship of shipsSource) {
        const disp = dispShips[ship.shipId];
        const pos: Position =
          pbActive && frame ? ship.position : disp ? disp.position : ship.position;
        shipFeatures.push({
          type: "Feature",
          properties: {
            id: ship.shipId,
            label: ship.name,
            status: ship.status,
            heading: ship.heading,
          },
          geometry: { type: "Point", coordinates: [pos.lng, pos.lat] },
        });

        const rw = ship.routeWaypoints ?? [];
        if (rw.length > 0) {
          const coords: [number, number][] = [
            [pos.lng, pos.lat],
            ...rw.map((w) => [w.lng, w.lat] as [number, number]),
          ];
          routeFeatures.push({
            type: "Feature",
            properties: { id: ship.shipId },
            geometry: { type: "LineString", coordinates: coords },
          });
        }

        const srcPort = snap.ports.find((p) => p.id === ship.sourcePortId);
        if (srcPort) {
          endpointFeatures.push({
            type: "Feature",
            properties: {
              shipId: ship.shipId,
              kind: "source",
              label: `${ship.name} • SRC`,
            },
            geometry: {
              type: "Point",
              coordinates: [srcPort.position.lng, srcPort.position.lat],
            },
          });
        }

        const dstPort = snap.ports.find((p) => p.id === ship.destinationPortId);
        if (dstPort) {
          endpointFeatures.push({
            type: "Feature",
            properties: {
              shipId: ship.shipId,
              kind: "destination",
              label: `${ship.name} • DST`,
            },
            geometry: {
              type: "Point",
              coordinates: [dstPort.position.lng, dstPort.position.lat],
            },
          });
        }
      }

      const shipSrc = map.getSource("ships") as maplibregl.GeoJSONSource;
      shipSrc?.setData({ type: "FeatureCollection", features: shipFeatures });

      const routeSrc = map.getSource("routes") as maplibregl.GeoJSONSource;
      routeSrc?.setData({ type: "FeatureCollection", features: routeFeatures });

      for (const p of snap.ports) {
        portFeatures.push({
          type: "Feature",
          properties: { id: p.id, label: p.name },
          geometry: { type: "Point", coordinates: [p.position.lng, p.position.lat] },
        });
      }
      const portsSrc = map.getSource("ports") as maplibregl.GeoJSONSource;
      portsSrc?.setData({ type: "FeatureCollection", features: portFeatures });

      const epSrc = map.getSource("endpoints") as maplibregl.GeoJSONSource;
      epSrc?.setData({ type: "FeatureCollection", features: endpointFeatures });
      applyOverlayFilters();

      const zoneFeats: GeoJSON.Feature[] = zList.map((z) => ({
        type: "Feature",
        properties: { id: z.id, name: z.name },
        geometry: {
          type: "Polygon",
          coordinates: [
            z.coordinates.map((c) => [c.lng, c.lat] as [number, number]),
          ],
        },
      }));
      if (draft.length >= 3) {
        const ring = draft.map((c) => [c.lng, c.lat] as [number, number]);
        ring.push(ring[0]!);
        zoneFeats.push({
          type: "Feature",
          properties: { id: "draft", name: "Draft" },
          geometry: {
            type: "Polygon",
            coordinates: [ring],
          },
        });
      }
      const zSrc = map.getSource("zones") as maplibregl.GeoJSONSource;
      zSrc?.setData({ type: "FeatureCollection", features: zoneFeats });

      const draftOverlay: GeoJSON.Feature[] = [];
      if (draft.length >= 2) {
        draftOverlay.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: draft.map((c) => [c.lng, c.lat] as [number, number]),
          },
        });
      }
      for (let i = 0; i < draft.length; i++) {
        const c = draft[i]!;
        draftOverlay.push({
          type: "Feature",
          properties: { label: String(i + 1), vertexIndex: i + 1 },
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        });
      }
      const zdSrc = map.getSource("zone-draft-overlay") as maplibregl.GeoJSONSource;
      zdSrc?.setData({ type: "FeatureCollection", features: draftOverlay });
    };

    if (!map.loaded()) {
      map.once("style.load", pushData);
      return;
    }
    if (!map.getSource("ships")) {
      map.once("style.load", pushData);
      return;
    }
    pushData();
  }, [mapSyncInputs]);

  useEffect(() => {
    if (drawZones) setShipHover(null);
  }, [drawZones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = drawZones ? "crosshair" : "";
  }, [drawZones]);

  useEffect(() => {
    if (!shipHover || !snapshot) return;
    if (!snapshot.ships.some((s) => s.shipId === shipHover.shipId)) setShipHover(null);
  }, [snapshot, shipHover]);

  return (
    <div className={clsx("relative h-full min-h-0 w-full overflow-hidden rounded-xl", className)}>
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute bottom-24 right-3 z-[60] sm:bottom-28">
        <button
          type="button"
          onClick={resetView}
          className="pointer-events-auto rounded-lg border border-slate-300/70 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition hover:bg-white dark:border-white/10 dark:bg-black/50 dark:text-slate-100 dark:hover:bg-black/60"
        >
          Recenter
        </button>
      </div>
      {!snapshot && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[40] flex justify-center px-3 sm:bottom-14">
          <div
            className={clsx(
              "pointer-events-auto max-w-lg rounded-xl border px-4 py-3 text-center text-xs leading-relaxed shadow-lg backdrop-blur-md",
              "border-amber-600/45 bg-amber-50/95 text-amber-950",
              "dark:border-amber-500/35 dark:bg-[rgba(40,20,5,0.92)] dark:text-amber-100",
            )}
          >
            {fleetApiStatus === "checking" && (
              <>
                <strong className="font-semibold">Checking API…</strong> Waiting for{" "}
                <code className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.7rem] dark:bg-white/10">
                  {getFleetApiOrigin()}
                </code>
                .
              </>
            )}
            {fleetApiStatus === "unreachable" && (
              <>
                <strong className="font-semibold">Cannot reach API.</strong> Start the stack from the repo root (
                <code className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.7rem] dark:bg-white/10">
                  npm run dev
                </code>
                ), set{" "}
                <code className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.7rem] dark:bg-white/10">
                  NEXT_PUBLIC_WS_URL=https://your-api-host
                </code>{" "}
                for apps/web, then refresh.
              </>
            )}
            {fleetApiStatus === "starting" && (
              <>
                <strong className="font-semibold">Starting simulation…</strong> Routes are computing on the server;
                the map appears once the fleet engine is ready.
              </>
            )}
            {fleetApiStatus === "live" && !connected && (
              <>
                <strong className="font-semibold">Connecting…</strong> Opening the WebSocket to the fleet server.
              </>
            )}
            {fleetApiStatus === "live" && connected && (
              <>
                <strong className="font-semibold">Syncing…</strong> Waiting for the first fleet snapshot.
              </>
            )}
          </div>
        </div>
      )}
      {shipHover &&
        (() => {
          const sh = snapshot?.ships.find((s) => s.shipId === shipHover.shipId);
          if (!sh) return null;
          const port = snapshot?.ports.find((p) => p.id === sh.destinationPortId);
          const accent = shipStatusAccentHex(sh.status, uiTheme);
          const pad = 12;
          const boxW = 260;
          const boxH = 120;
          let left = shipHover.clientX + pad;
          let top = shipHover.clientY + pad;
          if (typeof window !== "undefined") {
            left = Math.min(left, window.innerWidth - boxW - 12);
            top = Math.min(top, window.innerHeight - boxH - 12);
            left = Math.max(10, left);
            top = Math.max(10, top);
          }
          return (
            <div
              className={clsx(
                "pointer-events-none fixed z-[100] w-[260px] max-w-[min(260px,calc(100vw-1.25rem))] rounded-xl border px-3 py-2.5 text-left text-xs shadow-xl backdrop-blur-md",
                uiTheme === "dark"
                  ? "border-white/12 bg-slate-950/95 text-slate-100"
                  : "border-slate-300/90 bg-white/96 text-slate-900",
              )}
              style={{
                left,
                top,
                borderLeftWidth: 4,
                borderLeftColor: accent,
              }}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/30"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold leading-tight">{sh.name}</div>
                  <div className="mt-1 space-y-0.5 font-mono text-[0.6875rem] leading-snug text-slate-600 dark:text-slate-400">
                    <div>
                      <span className="text-slate-500 dark:text-slate-500">Status</span> ·{" "}
                      {formatShipStatusLabel(sh.status)}
                    </div>
                    <div>
                      {sh.speed.toFixed(0)} kn · {sh.fuel.toFixed(0)} t fuel · {sh.heading.toFixed(0)}° hdg
                    </div>
                    <div className="truncate">
                      <span className="text-slate-500 dark:text-slate-500">Dest</span> ·{" "}
                      {port?.name ?? sh.destinationPortId}
                    </div>
                    {selectedShipId === sh.shipId && (
                      <div className="text-[0.625rem] text-cyan-600 dark:text-cyan-400">Selected in sidebar</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      {drawZones && (
        <div
          className={clsx(
            "pointer-events-none absolute left-4 top-4 max-w-[min(100vw-2rem,22rem)] rounded-lg border px-3 py-2 text-xs leading-snug backdrop-blur-sm",
            uiTheme === "dark"
              ? "border-amber-400/40 bg-black/60 text-amber-200"
              : "border-amber-600/50 bg-white/90 text-amber-900",
          )}
        >
          <div className="font-semibold">Hazard polygon</div>
          <div className="mt-1 font-mono text-[0.65rem] opacity-90">
            Corners {zoneDraft.length} / {zoneVertexTarget} · coastal strip {zoneCoastalBufferNm.toFixed(1)} NM
          </div>
          <div className="mt-1.5 text-[0.65rem] opacity-90">
            Fleet-wide — affects all ships&apos; routing, not the hull selected in the sidebar.
          </div>
          <div className="mt-1.5 text-[0.65rem] opacity-90">
            Chart water + inland buffer only — clicks elsewhere are rejected.
          </div>
          {zonePlacementHint && (
            <div
              className={clsx(
                "mt-2 rounded border px-2 py-1.5 text-[0.65rem] leading-snug",
                uiTheme === "dark"
                  ? "border-red-400/40 bg-red-950/50 text-red-100"
                  : "border-red-300 bg-red-50 text-red-900",
              )}
            >
              {zonePlacementHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
