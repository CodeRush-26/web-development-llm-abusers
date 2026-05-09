"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { TopHud } from "@/components/TopHud";
import { OpsSidebar } from "@/components/OpsSidebar";
import { AlertStrip } from "@/components/AlertStrip";
import { StraitNewsStrip } from "@/components/StraitNewsStrip";
import { PlaybackBar } from "@/components/PlaybackBar";
import { SyncBus } from "@/components/SyncBus";
import { ToastHost } from "@/components/ToastHost";
import { useFleetStore } from "@/store/fleetStore";
import clsx from "clsx";

const FleetMap = dynamic(
  () => import("@/components/FleetMap").then((m) => m.FleetMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[min(240px,40dvh)] w-full items-center justify-center rounded-xl bg-slate-200/40 dark:bg-slate-950/60">
        <p className="font-mono text-[0.6875rem] text-slate-600 dark:text-slate-400">Loading map…</p>
      </div>
    ),
  },
);

export default function CommandDeck() {
  const role = useFleetStore((s) => s.role);
  const captainShipId = useFleetStore((s) => s.captainShipId);
  const setSelectedShipId = useFleetStore((s) => s.setSelectedShipId);

  useEffect(() => {
    if (role === "captain") setSelectedShipId(captainShipId);
  }, [role, captainShipId, setSelectedShipId]);

  return (
    <main
      className={clsx(
        "relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden",
        "bg-gradient-to-br from-slate-100 via-sky-50/80 to-slate-100",
        "dark:from-slate-950 dark:via-[#0a1628] dark:to-slate-950",
        "scanlines",
      )}
    >
      <SyncBus />
      <TopHud />

      {/* Map fills space below compact header; chrome cleared by sidebar / playback insets */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-2 pb-2 pt-[3.75rem] sm:px-3 sm:pb-3 sm:pt-16">
        <div
          className={clsx(
            "relative min-h-0 flex-1 overflow-hidden rounded-2xl ring-1 shadow-[0_0_60px_rgba(14,165,233,0.08)] ring-cyan-500/15 dark:shadow-[0_0_80px_rgba(34,211,238,0.06)] dark:ring-cyan-500/10",
            "border border-slate-200/90 bg-slate-900/5 dark:border-transparent dark:bg-transparent",
          )}
        >
          <FleetMap className="h-full border-0 shadow-none ring-0" />
          <div className="pointer-events-none absolute right-2 top-2 z-50 flex flex-row items-start gap-2 sm:right-3 sm:top-3">
            <StraitNewsStrip />
            <AlertStrip />
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-center sm:left-auto sm:right-3 sm:justify-end">
            <p
              className={clsx(
                "max-w-[min(100%,520px)] rounded-lg border px-2.5 py-1 font-mono text-[0.625rem] leading-snug backdrop-blur-sm sm:text-[0.6875rem]",
                "border-slate-300/90 bg-white/90 text-slate-600",
                "dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-500",
              )}
            >
              Map view · Drag pan · Scroll zoom · Right-click + drag or Ctrl + drag to tilt · Click ship = select
            </p>
          </div>
        </div>
      </div>

      <OpsSidebar />
      <ToastHost />
      <PlaybackBar />
    </main>
  );
}
