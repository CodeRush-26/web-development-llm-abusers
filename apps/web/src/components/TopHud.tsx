"use client";

import { fleetSocket } from "@/lib/socket";
import { useFleetStore } from "@/store/fleetStore";
import { EMPTY_SHIPS } from "@/store/emptyRefs";
import clsx from "clsx";

/** Until snapshot loads — IDs align with `fleet.json` */
const FALLBACK_HULL_IDS = Array.from({ length: 15 }, (_, i) => `MV-${i + 1}`);

export function TopHud() {
  const connected = useFleetStore((s) => s.connected);
  const scenario = useFleetStore((s) => s.snapshot?.scenario);
  const fleetShips = useFleetStore((s) => s.snapshot?.ships ?? EMPTY_SHIPS);
  const shipCount = useFleetStore((s) => s.snapshot?.ships.length ?? 0);
  const simPaused = useFleetStore((s) => s.snapshot?.simulationPaused ?? false);
  const role = useFleetStore((s) => s.role);
  const setRole = useFleetStore((s) => s.setRole);
  const captainShipId = useFleetStore((s) => s.captainShipId);
  const uiTheme = useFleetStore((s) => s.uiTheme);
  const setUiTheme = useFleetStore((s) => s.setUiTheme);
  const toggleLeftSidebar = useFleetStore((s) => s.toggleLeftSidebar);
  const leftSidebarOpen = useFleetStore((s) => s.leftSidebarOpen);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex min-h-14 flex-wrap items-center gap-x-2 gap-y-2 border-b border-slate-200/90 bg-white/90 px-3 py-2 backdrop-blur-xl dark:border-cyan-500/20 dark:bg-[rgba(4,8,20,0.94)] dark:shadow-[inset_0_-1px_0_rgba(34,211,238,0.08)] sm:gap-x-3 sm:px-4">
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => toggleLeftSidebar()}
          aria-expanded={leftSidebarOpen}
          aria-controls="ops-sidebar"
          title={leftSidebarOpen ? "Hide operations panel" : "Show operations panel"}
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
            "border-slate-300 bg-white text-slate-800 dark:border-cyan-500/25 dark:bg-slate-900 dark:text-cyan-100",
          )}
        >
          <span className="sr-only">Toggle operations sidebar</span>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0">
            <path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-400/95">
            Strait Command
          </p>
          <h1 className="truncate text-[0.95rem] font-semibold leading-snug text-slate-900 dark:text-white sm:text-lg">
            {scenario?.name ?? "Connecting to simulation…"}
          </h1>
        </div>

        {shipCount > 0 && (
          <span className="hidden shrink-0 rounded-md bg-slate-200/80 px-2 py-1 font-mono text-[0.625rem] leading-none text-slate-700 dark:bg-white/10 dark:text-slate-300 lg:inline">
            {shipCount} tracked
          </span>
        )}
        {simPaused && (
          <span className="hidden shrink-0 rounded-md bg-amber-500/25 px-2 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/15 dark:text-amber-200 sm:inline">
            Sim paused
          </span>
        )}
      </div>

      <div className="pointer-events-auto flex w-full min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-2 sm:w-auto sm:flex-nowrap sm:gap-x-2">
        <div
          className="flex rounded-xl border border-slate-300/90 p-0.5 dark:border-slate-600/70"
          role="group"
          aria-label="Interface theme"
        >
          <button
            type="button"
            onClick={() => setUiTheme("light")}
            aria-pressed={uiTheme === "light"}
            title="Briefing light"
            className={clsx(
              "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
              uiTheme === "light"
                ? "bg-amber-400/25 text-amber-900 shadow-sm dark:bg-amber-400/20 dark:text-amber-100"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10",
            )}
          >
            <SunIcon />
            <span className="hidden sm:inline">Light</span>
          </button>
          <button
            type="button"
            onClick={() => setUiTheme("dark")}
            aria-pressed={uiTheme === "dark"}
            title="Tactical dark"
            className={clsx(
              "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
              uiTheme === "dark"
                ? "bg-cyan-500/20 text-cyan-950 shadow-sm dark:bg-cyan-500/15 dark:text-cyan-100"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10",
            )}
          >
            <MoonIcon />
            <span className="hidden sm:inline">Dark</span>
          </button>
        </div>

        <div className="flex w-fit max-w-full shrink-0 flex-wrap items-center gap-1.5">
          <label className="flex w-fit items-center">
            <span className="sr-only">Operations role</span>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "command" | "captain", captainShipId)
              }
              className="ui-select h-9 w-max max-w-[9.5rem] cursor-pointer py-1.5 pl-2 pr-7 text-xs font-medium"
              aria-label="Operations role"
              title="Fleet commander vs ship captain"
            >
              <option value="command">Command</option>
              <option value="captain">Captain</option>
            </select>
          </label>

          {role === "captain" && (
            <label className="flex w-fit items-center">
              <span className="sr-only">Captain hull ID</span>
              <select
                value={captainShipId}
                onChange={(e) => setRole("captain", e.target.value)}
                className="ui-select h-9 w-max max-w-[6.5rem] cursor-pointer py-1.5 pl-2 pr-7 font-mono text-xs"
                aria-label="Captain hull ID"
                title={
                  fleetShips.find((s) => s.shipId === captainShipId)?.name ??
                  `Hull ${captainShipId}`
                }
              >
                {fleetShips.length > 0
                  ? fleetShips.map((s) => (
                      <option key={s.shipId} value={s.shipId}>
                        {s.shipId}
                      </option>
                    ))
                  : FALLBACK_HULL_IDS.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
              </select>
            </label>
          )}
        </div>

        {role === "command" && (
          <button
            type="button"
            onClick={() => fleetSocket.emit("sim:setPaused", { paused: !simPaused })}
            title={simPaused ? "Resume simulation (clock & physics)" : "Freeze simulation"}
            className={clsx(
              "h-9 shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
              simPaused
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200"
                : "border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
            )}
          >
            {simPaused ? "Resume sim" : "Pause sim"}
          </button>
        )}

        <div
          className={clsx(
            "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium",
            connected
              ? "border-emerald-500/45 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300"
              : "border-red-500/45 text-red-700 dark:border-red-500/40 dark:text-red-300",
          )}
          title={connected ? "Socket connected to simulation server" : "Disconnected — start the API server"}
        >
          <span
            className={clsx(
              "h-2 w-2 shrink-0 rounded-full",
              connected
                ? "animate-pulse bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.6)] dark:bg-emerald-400"
                : "bg-red-500",
            )}
            aria-hidden
          />
          <span className="hidden sm:inline">{connected ? "Connected" : "Offline"}</span>
          <span className="sm:hidden">{connected ? "OK" : "!"}</span>
        </div>
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M12 7a5 5 0 100 10 5 5 0 000-10zm0-5h2v4h-2V2zm0 18h2v4h-2v-4zM4.93 4.93l1.41 1.41 2.83-2.83-1.41-1.41L4.93 4.93zM14.83 18.49l2.83 2.83 1.41-1.41-2.83-2.83-1.41 1.41zM2 13h4v-2H2v2zm18 0h4v-2h-4v2zM5.34 18.49l-1.41 1.41 2.83 2.83 1.41-1.41-2.83-2.83zM16.24 6.34l2.83-2.83 1.41 1.41-2.83 2.83-1.41-1.41z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M21 14.5A8.5 8.5 0 0110.5 4 8.5 8.5 0 0021 14.5z"
      />
    </svg>
  );
}
