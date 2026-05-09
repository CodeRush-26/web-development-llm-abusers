"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Directive, FleetSnapshot, Ship } from "@strait-command/shared";
import { MapLegend } from "@/components/MapLegend";
import { StraitMonitorCard } from "@/components/StraitMonitorCard";
import { fleetSocket } from "@/lib/socket";
import {
  fuelOutlookForShip,
  nearestWeatherCell,
  type FuelTier,
} from "@/lib/fuelOutlook";
import {
  ZONE_VERTEX_MAX,
  ZONE_VERTEX_MIN,
  useFleetStore,
} from "@/store/fleetStore";
import clsx from "clsx";

type OpsTab = "fleet" | "ship" | "hazards";

function portName(snap: FleetSnapshot | null, id: string): string {
  return snap?.ports.find((p) => p.id === id)?.name ?? id;
}

function directivePlainEnglish(snap: FleetSnapshot | null, d: Directive): string {
  switch (d.type) {
    case "HOLD":
      return "Orders you to stop moving and hold position until further notice.";
    case "REROUTE_PORT":
      return `Orders a new destination: **${portName(snap, d.targetPortId ?? "")}** (${d.targetPortId ?? "port"}).`;
    case "DIVERT_WAYPOINT":
      return d.waypoint
        ? `Orders a diversion to **${d.waypoint.lat.toFixed(2)}°N**, **${d.waypoint.lng.toFixed(2)}°E**.`
        : "Orders a diversion to a specific waypoint.";
    default:
      return "New order from Command.";
  }
}

function tierDotClass(tier: FuelTier): string {
  switch (tier) {
    case "critical":
      return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]";
    case "warning":
      return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]";
    default:
      return "bg-emerald-500/90";
  }
}

function FuelOpsCard({ ship, snapshot }: { ship: Ship; snapshot: FleetSnapshot | null }) {
  const port = snapshot?.ports.find((p) => p.id === ship.destinationPortId);
  const outlook = port ? fuelOutlookForShip(ship, port.position) : null;
  const wx = nearestWeatherCell(ship.position, snapshot?.weatherCells ?? []);

  if (!outlook) return null;

  return (
    <div className="rounded-xl border border-slate-300/80 bg-slate-100/80 p-3 dark:border-cyan-500/25 dark:bg-black/30">
      <div className="ui-section-title">Fueling & sea state</div>
      <p className="ui-section-desc">
        Projected need uses route distance × 0.085 t/nm × weather stress × safety margin — mirrors server checks.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[0.6875rem]">
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Outlook</dt>
          <dd
            className={clsx(
              "font-semibold uppercase",
              outlook.tier === "critical" && "text-red-600 dark:text-red-400",
              outlook.tier === "warning" && "text-amber-700 dark:text-amber-300",
              outlook.tier === "ok" && "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {outlook.tier}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Remain · need</dt>
          <dd className="text-slate-900 dark:text-slate-100">
            {ship.fuel.toFixed(0)} · {outlook.needTons.toFixed(0)} t
          </dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Route left</dt>
          <dd className="tabular-nums text-slate-900 dark:text-slate-100">{outlook.distNm.toFixed(1)} nm</dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-slate-500">Bunker margin</dt>
          <dd className="tabular-nums text-slate-900 dark:text-slate-100">
            {outlook.reserveTons >= 0 ? "+" : ""}
            {outlook.reserveTons.toFixed(0)} t ({outlook.pctOfNeed.toFixed(0)}%)
          </dd>
        </div>
      </dl>
      {wx && (
        <p className="mt-3 border-t border-slate-300/60 pt-2 text-[0.6875rem] leading-snug text-slate-700 dark:border-white/10 dark:text-slate-400">
          Nearest weather cell: wind {(wx.windSpeedMs ?? 0).toFixed(1)} m/s · rain{" "}
          {(wx.precipitationMm ?? 0).toFixed(1)} mm/h
          {wx.adverse ? " · adverse (elevated fuel burn in sim)" : ""}.
        </p>
      )}
    </div>
  );
}

export function OpsSidebar() {
  const [tab, setTab] = useState<OpsTab>("fleet");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fleetSectionRef = useRef<HTMLDivElement>(null);
  const shipSectionRef = useRef<HTMLDivElement>(null);
  const hazardsSectionRef = useRef<HTMLDivElement>(null);

  const snapshot = useFleetStore((s) => s.snapshot);
  const role = useFleetStore((s) => s.role);
  const captainShipId = useFleetStore((s) => s.captainShipId);
  const selectedShipId = useFleetStore((s) => s.selectedShipId);
  const setSelectedShipId = useFleetStore((s) => s.setSelectedShipId);
  const drawZones = useFleetStore((s) => s.drawZones);
  const setDrawZones = useFleetStore((s) => s.setDrawZones);
  const zoneDraft = useFleetStore((s) => s.zoneDraft);
  const zoneVertexTarget = useFleetStore((s) => s.zoneVertexTarget);
  const zoneCoastalBufferNm = useFleetStore((s) => s.zoneCoastalBufferNm);
  const zonePlacementHint = useFleetStore((s) => s.zonePlacementHint);
  const setZoneVertexTarget = useFleetStore((s) => s.setZoneVertexTarget);
  const setZoneCoastalBufferNm = useFleetStore((s) => s.setZoneCoastalBufferNm);
  const clearZoneDraft = useFleetStore((s) => s.clearZoneDraft);
  const removeLastZoneVertex = useFleetStore((s) => s.removeLastZoneVertex);
  const leftSidebarOpen = useFleetStore((s) => s.leftSidebarOpen);
  const uiTheme = useFleetStore((s) => s.uiTheme);

  const ships = useMemo(() => {
    const list = snapshot?.ships ?? [];
    if (role === "captain") return list.filter((s) => s.shipId === captainShipId);
    return list;
  }, [snapshot, role, captainShipId]);

  /** Command must pick a hull — no silent fallback to first ship (directives were mis-addressed). Captain sees only their vessel. */
  const selected =
    ships.find((s) => s.shipId === selectedShipId) ??
    (role === "captain" ? ships[0] : undefined);

  const portList = snapshot?.ports ?? [];
  const [reroutePortId, setReroutePortId] = useState("");
  const [divertLat, setDivertLat] = useState("26.1");
  const [divertLng, setDivertLng] = useState("56.4");
  const [distressMessage, setDistressMessage] = useState("");

  useEffect(() => {
    if (!portList.length) return;
    if (!reroutePortId || !portList.some((p) => p.id === reroutePortId)) {
      setReroutePortId(portList[0]!.id);
    }
  }, [portList, reroutePortId]);

  useEffect(() => {
    if (!selected?.pendingDirective) setDistressMessage("");
  }, [selected?.pendingDirective?.id]);

  const chartData =
    selected?.routeWaypoints?.slice(0, 12).map((w, i) => ({
      i,
      lat: w.lat,
    })) ?? [];

  const showHazardsTab = role === "command";

  const scrollToTab = (id: OpsTab): void => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-ops-tab="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (role === "captain" && tab === "hazards") setTab("fleet");
  }, [role, tab]);

  const prevSelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedShipId) {
      prevSelRef.current = selectedShipId;
      return;
    }
    if (prevSelRef.current !== null && prevSelRef.current !== selectedShipId && tab !== "hazards") {
      setTab("ship");
      requestAnimationFrame(() => scrollToTab("ship"));
    }
    prevSelRef.current = selectedShipId;
  }, [selectedShipId, tab]);

  useEffect(() => {
    if (!leftSidebarOpen) return;
    const root = scrollRef.current;
    if (!root) return;

    const els = [
      fleetSectionRef.current,
      shipSectionRef.current,
      showHazardsTab ? hazardsSectionRef.current : null,
    ].filter((x): x is HTMLDivElement => x != null);

    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting && e.intersectionRatio >= 0.28);
        if (!visible.length) return;
        visible.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const attr = visible[0]?.target.getAttribute("data-ops-tab");
        if (attr === "fleet" || attr === "ship" || attr === "hazards") setTab(attr);
      },
      { root, rootMargin: "-10% 0px -14% 0px", threshold: [0.28, 0.45, 0.65] },
    );

    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [leftSidebarOpen, showHazardsTab]);

  const commitZone = (): void => {
    const st = useFleetStore.getState();
    if (st.zoneDraft.length < ZONE_VERTEX_MIN) return;
    if (st.zoneDraft.length !== st.zoneVertexTarget) return;
    fleetSocket.emit("zone:save", {
      name: `RZ-${Math.floor(Date.now() / 1000) % 10000}`,
      coordinates: st.zoneDraft,
    });
    clearZoneDraft();
    setDrawZones(false);
  };

  const sendDirective = (
    type: "REROUTE_PORT" | "DIVERT_WAYPOINT" | "HOLD",
    extra?: { portId?: string; waypoint?: { lat: number; lng: number } },
  ): void => {
    const ship =
      role === "command"
        ? snapshot?.ships.find((s) => s.shipId === selectedShipId)
        : ships[0];
    if (!ship) return;
    fleetSocket.emit("directive:send", {
      type,
      shipId: ship.shipId,
      targetPortId: extra?.portId,
      waypoint: extra?.waypoint,
    });
  };

  const respond = (
    action: "ACCEPT" | "ESCALATE_DISTRESS",
    distress?: string,
  ): void => {
    const ship = snapshot?.ships.find((s) => s.shipId === captainShipId);
    const d = ship?.pendingDirective;
    if (!d) return;
    fleetSocket.emit("captain:respond", {
      directiveId: d.id,
      shipId: captainShipId,
      action,
      distressMessage: distress,
      respondedAt: Date.now(),
      captainId: `captain-${captainShipId}`,
    });
  };

  const tabs = (
    [
      { id: "fleet" as const, label: "Fleet" },
      { id: "ship" as const, label: "Ship" },
      ...(showHazardsTab ? [{ id: "hazards" as const, label: "Hazards" }] : []),
    ]
  );

  return (
    <aside
      id="ops-sidebar"
      className={clsx(
        "pointer-events-auto absolute left-2 top-14 z-20 flex w-[min(100vw-1rem,360px)] flex-col gap-0 transition-[transform,opacity] duration-300 ease-out sm:left-4",
        "bottom-24 max-lg:bottom-32",
        leftSidebarOpen
          ? "translate-x-0 opacity-100"
          : "pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0",
      )}
    >
      <div className="glass-panel relative z-10 flex flex-shrink-0 gap-0.5 p-1 shadow-lg">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            data-tab-link={t.id}
            onClick={() => {
              setTab(t.id);
              scrollToTab(t.id);
            }}
            className={clsx(
              "min-w-0 flex-1 rounded-lg px-2 py-2 text-center text-xs font-semibold transition",
              tab === t.id
                ? "bg-cyan-500/20 text-cyan-900 shadow-sm dark:bg-cyan-500/15 dark:text-cyan-100"
                : "text-slate-600 hover:bg-slate-200/80 dark:text-slate-400 dark:hover:bg-white/10",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className={clsx(
          "no-scrollbar min-h-0 flex-1 snap-y snap-proximity overflow-y-auto overflow-x-hidden scroll-smooth",
          "pb-2 pt-1",
        )}
      >
        <section
          ref={fleetSectionRef}
          data-ops-tab="fleet"
          className="snap-start space-y-2 pb-10 pt-1"
          style={{ minHeight: "min(72vh, 560px)" }}
        >
          <StraitMonitorCard snapshot={snapshot} />
          <MapLegend />
          <div className="glass-panel flex flex-col gap-2 p-4">
            <div>
              <div className="ui-section-title">Fleet list</div>
              <p className="ui-section-desc">
                Scroll the panel — snap sections · fuel dot = bunkers vs projected need.
              </p>
            </div>
            <div className="space-y-1.5">
              {ships.map((s) => {
                const port = snapshot?.ports.find((p) => p.id === s.destinationPortId);
                const fo = port ? fuelOutlookForShip(s, port.position) : null;
                const tier = fo?.tier ?? "ok";
                return (
                  <button
                    key={s.shipId}
                    type="button"
                    onClick={() => {
                      setSelectedShipId(s.shipId);
                      setTab("ship");
                      requestAnimationFrame(() => scrollToTab("ship"));
                    }}
                    className={clsx(
                      "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                      selectedShipId === s.shipId
                        ? "border-cyan-500/40 bg-cyan-500/15 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)] dark:border-cyan-400/55"
                        : "border-transparent hover:border-slate-300 hover:bg-slate-900/[0.04] dark:hover:border-slate-600/70 dark:hover:bg-white/[0.04]",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={clsx("h-2 w-2 shrink-0 rounded-full", tierDotClass(tier))}
                        title={`Fuel outlook: ${tier}`}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-[0.625rem] leading-tight text-slate-500 dark:text-slate-400">
                          {s.shipId}
                        </span>
                        <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">{s.name}</span>
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[0.6875rem] uppercase text-slate-500">{s.status}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section
          ref={shipSectionRef}
          data-ops-tab="ship"
          className="snap-start space-y-2 pb-10 pt-2"
          style={{ minHeight: "min(72vh, 560px)" }}
        >
          {selected ? (
            <div className="glass-panel space-y-4 p-4 text-sm">
              <FuelOpsCard ship={selected} snapshot={snapshot} />

              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="ui-section-title">Selected vessel</div>
                  <p className="mt-1 font-mono text-[0.7rem] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-400/95">
                    {selected.shipId}
                  </p>
                  <h3 className="ui-card-title mt-0.5 text-lg">{selected.name}</h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">
                    Heading to{" "}
                    <span className="font-medium text-slate-800 dark:text-slate-300">
                      {portName(snapshot, selected.destinationPortId)}
                    </span>{" "}
                    <span className="font-mono text-[0.6875rem] text-slate-500 dark:text-slate-600">
                      ({selected.destinationPortId})
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1.5 text-right font-mono">
                  <div className="text-[0.6875rem] uppercase tracking-wide text-emerald-600 dark:text-emerald-500/90">
                    Speed
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {selected.speed.toFixed(0)} kn
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <Stat label="Fuel remaining" value={`${selected.fuel.toFixed(0)} t`} hint="tons" />
                <Stat label="Cargo" value={selected.cargo} />
                <Stat label="Heading" value={`${selected.heading.toFixed(0)}°`} hint="true north" />
                <Stat label="Status" value={selected.status.replace(/_/g, " ")} />
              </div>

              <div>
                <div className="ui-section-title">Route preview</div>
                <p className="ui-section-desc">Latitude along upcoming waypoints</p>
                <div className="mt-2 h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="routeLat" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="i" hide />
                      <YAxis hide domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          background: uiTheme === "dark" ? "#020617" : "#f8fafc",
                          border:
                            uiTheme === "dark"
                              ? "1px solid rgba(34,211,238,0.35)"
                              : "1px solid rgba(6,182,212,0.35)",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: uiTheme === "dark" ? "#e2e8f0" : "#0f172a",
                        }}
                        labelFormatter={(i) => `Segment ${i}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="lat"
                        stroke="#22d3ee"
                        fill="url(#routeLat)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {role === "command" && selected && (
                <div className="border-t border-slate-200/80 pt-4 dark:border-white/10">
                  <div className="ui-section-title">Send directive</div>
                  <p className="ui-section-desc">
                    Hold and reroute apply immediately on the map and route; the captain still acknowledges or escalates here with a written distress reason when needed.
                  </p>
                  <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.07] px-3 py-2 text-xs dark:border-cyan-500/25 dark:bg-cyan-500/10">
                    <span className="text-slate-600 dark:text-slate-400">Recipient hull</span>
                    <span className="ml-2 font-mono font-semibold text-cyan-900 dark:text-cyan-100">{selected.shipId}</span>
                    <span className="text-slate-600 dark:text-slate-400"> · </span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{selected.name}</span>
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    <button type="button" className="ui-btn-primary text-left" onClick={() => sendDirective("HOLD")}>
                      <span className="block font-semibold">Hold position</span>
                      <span className="mt-0.5 block text-xs font-normal text-cyan-800/80 dark:text-cyan-200/70">
                        Stop and wait — holding pattern for threats or coordination
                      </span>
                    </button>

                    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-black/25">
                      <label className="block text-[0.6875rem] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        Reroute to port
                      </label>
                      <select
                        value={reroutePortId}
                        onChange={(e) => setReroutePortId(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                      >
                        {portList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.id})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ui-btn-primary mt-2 w-full text-left"
                        onClick={() => reroutePortId && sendDirective("REROUTE_PORT", { portId: reroutePortId })}
                      >
                        <span className="block font-semibold">Send reroute order</span>
                        <span className="mt-0.5 block text-xs font-normal text-cyan-800/80 dark:text-cyan-200/70">
                          Path recomputes around zones and adverse weather cells
                        </span>
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-black/25">
                      <label className="block text-[0.6875rem] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        Divert via waypoint
                      </label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-600 dark:text-slate-400">
                          <span className="mb-1 block">Latitude</span>
                          <input
                            type="number"
                            step="0.01"
                            value={divertLat}
                            onChange={(e) => setDivertLat(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-950"
                          />
                        </label>
                        <label className="text-xs text-slate-600 dark:text-slate-400">
                          <span className="mb-1 block">Longitude</span>
                          <input
                            type="number"
                            step="0.01"
                            value={divertLng}
                            onChange={(e) => setDivertLng(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-950"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="ui-btn-primary mt-2 w-full text-left"
                        onClick={() => {
                          const lat = parseFloat(divertLat);
                          const lng = parseFloat(divertLng);
                          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                          sendDirective("DIVERT_WAYPOINT", { waypoint: { lat, lng } });
                        }}
                      >
                        <span className="block font-semibold">Send diversion order</span>
                        <span className="mt-0.5 block text-xs font-normal text-cyan-800/80 dark:text-cyan-200/70">
                          Vessel routes via this coordinate first, then resumes destination routing
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {role === "captain" && selected.pendingDirective && (
                <div className="border-t border-slate-200/80 pt-4 dark:border-white/10">
                  <div className="ui-section-title">Orders from Command</div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {directivePlainEnglish(snapshot, selected.pendingDirective)
                      .split("**")
                      .map((chunk, i) =>
                        i % 2 === 1 ? (
                          <strong key={i} className="font-semibold text-slate-900 dark:text-white">
                            {chunk}
                          </strong>
                        ) : (
                          chunk
                        ),
                      )}
                  </p>

                  <label className="mt-4 block">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Distress narrative (required only if you escalate — machinery, medical, hull, weather…)
                    </span>
                    <textarea
                      value={distressMessage}
                      onChange={(e) => setDistressMessage(e.target.value)}
                      rows={5}
                      placeholder="Example: Main engine governor fault — cannot sustain ordered speed for Muscat reroute; requesting assistance."
                      className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-inner placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600"
                    />
                  </label>

                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-emerald-500/45 bg-emerald-500/10 px-3 py-2.5 text-left text-sm font-semibold text-emerald-900 transition hover:bg-emerald-500/20 dark:text-emerald-100"
                      onClick={() => respond("ACCEPT")}
                    >
                      Accept orders
                      <span className="mt-0.5 block text-xs font-normal text-emerald-800/80 dark:text-emerald-200/75">
                        Ship applies this order on the next simulation tick
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={distressMessage.trim().length < 12}
                      className="rounded-lg border border-red-500/45 bg-red-500/10 px-3 py-2.5 text-left text-sm font-semibold text-red-900 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-100"
                      onClick={() => {
                        const msg = distressMessage.trim();
                        if (msg.length < 12) return;
                        respond("ESCALATE_DISTRESS", msg);
                        setDistressMessage("");
                      }}
                    >
                      Cannot comply — escalate distress
                      <span className="mt-0.5 block text-xs font-normal text-red-800/80 dark:text-red-200/75">
                        Sends your text to Command; AI structures severity for alert sorting
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {role === "captain" && !selected.pendingDirective && selected.lastAppliedDirective && (
                <div className="border-t border-slate-200/80 pt-4 dark:border-white/10">
                  <div className="ui-section-title">Last order (already applied)</div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {directivePlainEnglish(snapshot, selected.lastAppliedDirective)
                      .split("**")
                      .map((chunk, i) =>
                        i % 2 === 1 ? (
                          <strong key={i} className="font-semibold text-slate-900 dark:text-white">
                            {chunk}
                          </strong>
                        ) : (
                          chunk
                        ),
                      )}
                  </p>
                  <p className="mt-2 text-[0.6875rem] text-slate-600 dark:text-slate-500">
                    No pending orders right now. If you expected to respond, switch to Captain first, then have Command send the order.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel p-4 text-sm text-slate-600 dark:text-slate-500">
              {!snapshot?.ships.length ? (
                <>No ship data yet. Connect to the simulation server.</>
              ) : role === "command" ? (
                <>
                  <p className="font-medium text-slate-800 dark:text-slate-200">No vessel selected</p>
                  <p className="mt-2 leading-relaxed">
                    Pick a hull in the Fleet list or click a ship on the map. Directives are sent to the hull ID shown on the card — Command never sends to an implicit vessel.
                  </p>
                </>
              ) : (
                <>No ship data for this captain scope.</>
              )}
            </div>
          )}
        </section>

        {showHazardsTab && (
          <section
            ref={hazardsSectionRef}
            data-ops-tab="hazards"
            className="snap-start pb-16 pt-2"
            style={{ minHeight: "min(72vh, 560px)" }}
          >
            <div className="glass-panel space-y-3 p-4">
              <div>
                <div className="ui-section-title text-red-700 dark:text-red-300/95">Hazard zones</div>
                <p className="ui-section-desc">
                  Applies to the <strong className="font-semibold text-slate-800 dark:text-slate-100">entire fleet</strong>
                  — routing and restricted water update for every hull, independent of which ship is selected in the Fleet tab.
                  Polygons must lie in chart navigable water or within your coastal strip inland of the shoreline.
                  Each corner is validated before it is accepted.
                </p>
              </div>

              {snapshot && snapshot.zones.length > 0 && (
                <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 p-3 dark:border-white/10 dark:bg-black/35">
                  <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                    Saved hazard zones
                  </div>
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {snapshot.zones.map((z) => (
                      <li
                        key={z.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-2 dark:border-white/10 dark:bg-slate-950/60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{z.name}</div>
                          <div className="font-mono text-[0.65rem] text-slate-600 dark:text-slate-500">
                            {z.coordinates.length} vertices ·{" "}
                            <span className="select-all" title={z.id}>
                              {z.id.length > 12 ? `${z.id.slice(0, 10)}…` : z.id}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete hazard zone «${z.name}»? Ships will reroute without this polygon.`,
                              )
                            )
                              return;
                            fleetSocket.emit("zone:delete", z.id);
                          }}
                          className="shrink-0 rounded-lg border border-red-500/45 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-800 shadow-sm transition hover:bg-red-500/20 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-200 dark:hover:bg-red-950/80"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-3 rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-black/25">
                <label className="block text-[0.6875rem] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Polygon corners ({ZONE_VERTEX_MIN}–{ZONE_VERTEX_MAX})
                </label>
                <input
                  type="number"
                  min={ZONE_VERTEX_MIN}
                  max={ZONE_VERTEX_MAX}
                  value={zoneVertexTarget}
                  disabled={drawZones}
                  onChange={(e) => setZoneVertexTarget(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
                <label className="block text-[0.6875rem] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Coastal strip (NM beyond chart water)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={zoneCoastalBufferNm}
                  disabled={drawZones}
                  onChange={(e) => setZoneCoastalBufferNm(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
                <p className="text-[0.65rem] leading-snug text-slate-600 dark:text-slate-500">
                  Increase the strip slightly if you need to clip ports or beaches; keep it tight for maritime realism.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!drawZones) setDrawZones(true);
                    else {
                      clearZoneDraft();
                      setDrawZones(false);
                    }
                  }}
                  className={clsx(
                    "rounded-lg px-3 py-2 text-sm font-medium transition",
                    drawZones
                      ? "bg-amber-500/25 text-amber-900 ring-2 ring-amber-500/50 dark:text-amber-100 dark:ring-amber-500/40"
                      : "ui-btn-secondary",
                  )}
                >
                  {drawZones ? "Stop drawing" : "Begin placing corners"}
                </button>
                {drawZones && zoneDraft.length > 0 && (
                  <button type="button" onClick={() => removeLastZoneVertex()} className="ui-btn-secondary text-sm">
                    Undo last corner
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-500">
                Progress:{" "}
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {zoneDraft.length} / {zoneVertexTarget}
                </span>{" "}
                corners · minimum {ZONE_VERTEX_MIN} · save requires exactly {zoneVertexTarget}.
              </p>

              {zoneDraft.length > 0 && (
                <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200/90 bg-white/80 p-2 font-mono text-[0.65rem] dark:border-white/10 dark:bg-black/40">
                  {zoneDraft.map((c, i) => (
                    <li key={`${i}-${c.lat}-${c.lng}`} className="flex justify-between gap-2 text-slate-700 dark:text-slate-300">
                      <span className="text-cyan-700 dark:text-cyan-400">{i + 1}</span>
                      <span className="tabular-nums">
                        {c.lat.toFixed(4)}°, {c.lng.toFixed(4)}°
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">in range</span>
                    </li>
                  ))}
                </ul>
              )}

              {zonePlacementHint && (
                <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-900 dark:border-red-500/35 dark:bg-red-950/50 dark:text-red-100">
                  {zonePlacementHint}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={
                    zoneDraft.length < ZONE_VERTEX_MIN || zoneDraft.length !== zoneVertexTarget
                  }
                  onClick={commitZone}
                  className="flex-1 rounded-lg bg-red-600/90 px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-900/30 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-red-600/85"
                >
                  Save hazard zone
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearZoneDraft();
                    setDrawZones(false);
                  }}
                  className="ui-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-200/50 px-3 py-2 ring-1 ring-slate-300/50 dark:bg-black/35 dark:ring-white/5">
      <div className="text-[0.6875rem] uppercase tracking-wide text-slate-600 dark:text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-slate-900 dark:text-slate-100">{value}</div>
      {hint && <div className="mt-0.5 font-mono text-[0.6875rem] text-slate-500 dark:text-slate-600">{hint}</div>}
    </div>
  );
}
