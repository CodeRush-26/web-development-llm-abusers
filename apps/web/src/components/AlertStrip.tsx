"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Alert } from "@strait-command/shared";
import { getFleetSocket } from "@/lib/socket";
import { EMPTY_ALERTS } from "@/store/emptyRefs";
import { useFleetStore } from "@/store/fleetStore";
import clsx from "clsx";
import { useMemo } from "react";

export function AlertStrip() {
  const alerts = useFleetStore((s) => s.snapshot?.alerts ?? EMPTY_ALERTS);
  const alertsPanelOpen = useFleetStore((s) => s.alertsPanelOpen);
  const toggleAlertsPanel = useFleetStore((s) => s.toggleAlertsPanel);

  /** Unacked first, then recent acknowledged — so the strip isn’t empty when everything was acked */
  const listed = useMemo(() => {
    const unacked = alerts.filter((a) => !a.acknowledged);
    const acked = alerts.filter((a) => a.acknowledged);
    unacked.sort((a, b) => (b.aiPriorityScore ?? 0) - (a.aiPriorityScore ?? 0));
    acked.sort((a, b) => b.timestamp - a.timestamp);
    return [...unacked, ...acked].slice(0, 12);
  }, [alerts]);

  const unacked = useMemo(
    () => alerts.filter((a) => !a.acknowledged).length,
    [alerts],
  );

  const ack = (id: string): void => {
    getFleetSocket().emit("alert:ack", { alertId: id, operatorId: "web-operator" });
  };

  return (
    <div className="pointer-events-none relative z-50 flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex items-start gap-2">
        <button
          type="button"
          onClick={() => toggleAlertsPanel()}
          aria-expanded={alertsPanelOpen}
          aria-controls="alert-strip-panel"
          title={alertsPanelOpen ? "Hide alerts panel" : "Show alerts"}
          className={clsx(
            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-lg backdrop-blur-xl transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
            "border-slate-300/90 bg-white/90 text-slate-800",
            "dark:border-cyan-500/25 dark:bg-slate-950/90 dark:text-cyan-100",
            unacked > 0 && "ring-2 ring-amber-500/40 dark:ring-amber-400/35",
          )}
        >
          <span className="sr-only">
            {alertsPanelOpen ? "Collapse alerts" : "Expand alerts"}
          </span>
          <BellIcon />
          {unacked > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[0.625rem] font-bold leading-none text-slate-950 shadow-sm"
              aria-hidden
            >
              {unacked > 99 ? "99+" : unacked}
            </span>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {alertsPanelOpen && (
          <motion.div
            id="alert-strip-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="no-scrollbar pointer-events-auto flex max-h-[min(420px,42vh)] w-[min(100vw-2rem,380px)] flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5"
          >
            <div className="rounded-xl border border-slate-300/90 bg-white/90 px-4 py-2.5 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/85">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active alerts</h2>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
                    Open items first, then recent history · Acknowledge when your team has acted on an item
                  </p>
                </div>
                <span className="font-mono text-xs tabular-nums text-cyan-700 dark:text-cyan-400/90">{unacked}</span>
              </div>
            </div>

            <AnimatePresence mode="popLayout">
              {listed.length === 0 && alerts.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="glass-panel border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-500"
                >
                  No alerts yet. Connect to the fleet server — proximity, zones, fuel, and weather warnings appear here.
                </motion.div>
              )}
              {listed.map((a) => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  className={clsx(
                    "glass-panel border px-4 py-3 text-sm shadow-xl",
                    severityBorder(a.severity),
                    a.acknowledged && "opacity-75",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.15em] text-slate-500">
                        <span>{a.type.replace(/_/g, " ")}</span>
                        {a.acknowledged && (
                          <span className="rounded border border-slate-400/50 px-1.5 py-px text-[0.625rem] normal-case tracking-normal text-slate-500 dark:border-slate-600 dark:text-slate-400">
                            Acknowledged
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 leading-snug text-slate-800 dark:text-slate-100">{a.message}</p>
                      {a.distressAnalysis && (
                        <div className="mt-3 rounded-xl bg-black/45 p-3 text-xs text-cyan-50/95">
                          <div className="font-semibold text-cyan-300">AI summary</div>
                          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
                            <dt className="text-slate-500">Severity</dt>
                            <dd>{a.distressAnalysis.severity}</dd>
                            <dt className="text-slate-500">Injuries</dt>
                            <dd>{a.distressAnalysis.injuryCount ?? "—"}</dd>
                            <dt className="text-slate-500">Impact</dt>
                            <dd className="col-span-2 sm:col-span-1">
                              {a.distressAnalysis.operationalImpact}
                            </dd>
                          </dl>
                        </div>
                      )}
                    </div>
                    {!a.acknowledged ? (
                      <button
                        type="button"
                        onClick={() => ack(a.id)}
                        className={clsx(
                          "shrink-0 rounded-lg border px-3 py-1.5 font-mono text-[0.6875rem] font-medium uppercase tracking-wide transition",
                          "border-cyan-600/80 bg-white text-cyan-900 shadow-sm hover:bg-cyan-50",
                          "dark:border-cyan-500/45 dark:bg-transparent dark:text-cyan-200 dark:shadow-none dark:hover:bg-cyan-500/15",
                        )}
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Done
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 1.99 2zM18 16v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"
      />
    </svg>
  );
}

function severityBorder(s: Alert["severity"]): string {
  switch (s) {
    case "critical":
      return "border-red-500/60 shadow-danger";
    case "high":
      return "border-amber-400/50";
    case "medium":
      return "border-cyan-500/40";
    default:
      return "border-slate-600/50";
  }
}
