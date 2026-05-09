"use client";

import type { FleetSnapshot, Port } from "@strait-command/shared";
import { fuelOutlookForShip } from "@/lib/fuelOutlook";
import clsx from "clsx";
import { useMemo } from "react";

function destPosition(snap: FleetSnapshot | null, portId: string): Port | undefined {
  return snap?.ports.find((p) => p.id === portId);
}

export function StraitMonitorCard({
  snapshot,
}: {
  snapshot: FleetSnapshot | null;
}) {
  const metrics = useMemo(() => {
    const ships = snapshot?.ships ?? [];
    let critical = 0;
    let warning = 0;
    for (const sh of ships) {
      const port = destPosition(snapshot, sh.destinationPortId);
      const out = port ? fuelOutlookForShip(sh, port.position) : null;
      if (!out) continue;
      if (out.tier === "critical") critical += 1;
      else if (out.tier === "warning") warning += 1;
    }
    const cells = snapshot?.weatherCells ?? [];
    const adverse = cells.filter((c) => c.adverse).length;
    const simDays = snapshot ? Math.floor(snapshot.simTimeMs / 86_400_000) : 0;
    const unacked = (snapshot?.alerts ?? []).filter((a) => !a.acknowledged).length;
    return {
      hulls: ships.length,
      critical,
      warning,
      adverse,
      weatherTotal: cells.length,
      simDays,
      tick: snapshot?.tick ?? 0,
      unacked,
    };
  }, [snapshot]);

  return (
    <div className="glass-panel space-y-3 p-4">
      <div>
        <div className="ui-section-title">Strait monitor</div>
        <p className="ui-section-desc">
          Live snapshot stream (~10/s) · Weather-weighted fuel outlook (same model as the simulator).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-[0.6875rem]">
        <Metric label="Sim day" value={String(metrics.simDays)} accent />
        <Metric label="Open alerts" value={String(metrics.unacked)} warn={metrics.unacked > 0} />
        <Metric label="Hull signals" value={String(metrics.hulls)} />
        <Metric
          label="Fuel stress"
          value={`${metrics.critical} crit · ${metrics.warning} warn`}
          warn={metrics.critical > 0 || metrics.warning > 0}
        />
        <Metric
          label="Weather grid"
          value={
            metrics.weatherTotal
              ? `${metrics.adverse}/${metrics.weatherTotal} adverse`
              : "—"
          }
          warn={metrics.adverse > 0}
        />
        <Metric label="Sim tick" value={metrics.tick.toLocaleString()} />
      </div>

      <p className="text-[0.65rem] leading-snug text-slate-600 dark:text-slate-500">
        Inspired by public chokepoint dashboards (e.g.{" "}
        <a
          href="https://www.hormuztracker.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-700 underline decoration-cyan-500/40 underline-offset-2 dark:text-cyan-400/90"
        >
          HormuzTracker
        </a>
        ) — metrics here are driven by your simulation, not external AIS.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg px-2.5 py-2 ring-1",
        accent && "bg-cyan-500/10 ring-cyan-500/25 dark:bg-cyan-500/10",
        !accent && !warn && "bg-slate-200/60 ring-slate-300/80 dark:bg-white/5 dark:ring-white/10",
        warn && !accent && "bg-amber-500/10 ring-amber-500/35 dark:bg-amber-500/10",
      )}
    >
      <div className="text-[0.6rem] uppercase tracking-wide text-slate-600 dark:text-slate-500">{label}</div>
      <div className="mt-0.5 tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}
