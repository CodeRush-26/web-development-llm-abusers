"use client";

/** Static legend — matches FleetMap layer colors */
import { useFleetStore } from "@/store/fleetStore";

export function MapLegend() {
  const showPorts = useFleetStore((s) => s.showPorts);
  const showVoyageEndpoints = useFleetStore((s) => s.showVoyageEndpoints);
  const showVoyageEndpointsOnHover = useFleetStore((s) => s.showVoyageEndpointsOnHover);
  const setShowPorts = useFleetStore((s) => s.setShowPorts);
  const setShowVoyageEndpoints = useFleetStore((s) => s.setShowVoyageEndpoints);
  const setShowVoyageEndpointsOnHover = useFleetStore((s) => s.setShowVoyageEndpointsOnHover);

  const rows: { color: string; label: string; detail: string }[] = [
    {
      color: "bg-cyan-400",
      label: "Cyan",
      detail: "Normal — on planned route",
    },
    {
      color: "bg-amber-400",
      label: "Amber",
      detail: "Rerouting after hazard or new orders",
    },
    {
      color: "bg-orange-400",
      label: "Orange",
      detail: "Fuel warning — may fall short of port",
    },
    {
      color: "bg-red-500",
      label: "Red",
      detail: "Distress or emergency state",
    },
    {
      color: "bg-violet-400",
      label: "Purple",
      detail: "Holding position per directive",
    },
    {
      color: "bg-slate-400",
      label: "Gray",
      detail: "Out of fuel (dead in water)",
    },
    {
      color: "border-2 border-cyan-400/60 bg-transparent",
      label: "Lines",
      detail: "Bright cyan = route; dark peach ring = navigable chart boundary; faint ring = ship glow",
    },
    {
      color: "bg-red-500/40 border border-red-400/50",
      label: "Red zones",
      detail: "Restricted areas — fleet reroutes around them",
    },
  ];

  return (
    <div className="glass-panel p-4">
      <div className="ui-section-title">Map legend</div>
      <p className="ui-section-desc">
        Each icon is a ship. Hover for source/destination. Click or pick a name in the list to see details.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
        <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-200/40 px-3 py-2 ring-1 ring-slate-300/50 dark:bg-white/5 dark:ring-white/10">
          <span className="text-slate-700 dark:text-slate-300">Show ports</span>
          <input
            type="checkbox"
            checked={showPorts}
            onChange={(e) => setShowPorts(e.target.checked)}
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-200/40 px-3 py-2 ring-1 ring-slate-300/50 dark:bg-white/5 dark:ring-white/10">
          <span className="text-slate-700 dark:text-slate-300">Show voyage endpoints on hover</span>
          <input
            type="checkbox"
            checked={showVoyageEndpointsOnHover}
            onChange={(e) => setShowVoyageEndpointsOnHover(e.target.checked)}
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-200/40 px-3 py-2 ring-1 ring-slate-300/50 dark:bg-white/5 dark:ring-white/10">
          <span className="text-slate-700 dark:text-slate-300">Show all voyage endpoints</span>
          <input
            type="checkbox"
            checked={showVoyageEndpoints}
            onChange={(e) => setShowVoyageEndpoints(e.target.checked)}
          />
        </label>
      </div>

      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex gap-3 text-xs leading-snug">
            <span
              className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${r.color}`}
              aria-hidden
            />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{r.label}</span>
              <span className="text-slate-500 dark:text-slate-500"> — </span>
              <span className="text-slate-600 dark:text-slate-400">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
