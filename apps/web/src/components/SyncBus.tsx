"use client";

import { useEffect, useRef } from "react";
import type {
  Alert,
  CaptainResponse,
  Directive,
  DirectiveResultPayload,
  FleetSnapshot,
} from "@strait-command/shared";
import { playAlertChime, unlockAlertAudio } from "@/lib/alertChime";
import { playDirectiveChime } from "@/lib/directiveChime";
import { fleetSocket as socket } from "@/lib/socket";
import { useFleetStore } from "@/store/fleetStore";
import { useToastStore } from "@/store/toastStore";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

function formatDirectiveAppliedSummary(snap: FleetSnapshot | null, d: Directive): string {
  const ship = snap?.ships.find((s) => s.shipId === d.shipId);
  const hull = d.shipId;
  const name = ship?.name ?? hull;
  switch (d.type) {
    case "HOLD":
      return `Hold · ${name} (${hull})`;
    case "REROUTE_PORT": {
      const pid = d.targetPortId ?? "";
      const port = snap?.ports.find((p) => p.id === pid);
      return `Reroute to ${port?.name ?? pid} · ${name}`;
    }
    case "DIVERT_WAYPOINT": {
      const w = d.waypoint;
      const coord = w ? `${w.lat.toFixed(2)}°, ${w.lng.toFixed(2)}°` : "waypoint";
      return `Divert via ${coord} · ${name}`;
    }
    default:
      return `${name} (${hull})`;
  }
}

function toastVariantForAlert(a: Alert): "danger" | "warning" | "info" {
  if (a.severity === "critical" || a.severity === "high") return "danger";
  if (a.severity === "medium") return "warning";
  return "info";
}

export function SyncBus(): null {
  const role = useFleetStore((s) => s.role);
  const captainShipId = useFleetStore((s) => s.captainShipId);
  const alertBootstrapDone = useRef(false);
  const knownAlertIds = useRef(new Set<string>());
  const knownToastAlertIds = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const store = useFleetStore.getState();
    store.setFleetApiStatus("checking");

    const toastAlertIfNew = (a: Alert): void => {
      if (knownToastAlertIds.current.has(a.id)) return;
      knownToastAlertIds.current.add(a.id);
      if (a.acknowledged) return;
      useToastStore.getState().pushToast(a.message, toastVariantForAlert(a));
    };

    const considerChime = (a: Alert): void => {
      if (knownAlertIds.current.has(a.id)) return;
      knownAlertIds.current.add(a.id);
      if (a.acknowledged) return;
      if (
        a.severity !== "critical" &&
        a.severity !== "high" &&
        a.severity !== "medium"
      )
        return;
      playAlertChime(a.severity);
    };

    const onSnap = (snap: FleetSnapshot): void => {
      store.applySnapshot(snap);
      if (!alertBootstrapDone.current) {
        for (const a of snap.alerts) {
          knownAlertIds.current.add(a.id);
          knownToastAlertIds.current.add(a.id);
        }
        alertBootstrapDone.current = true;
        return;
      }
      for (const a of snap.alerts) considerChime(a);
      for (const a of snap.alerts) toastAlertIfNew(a);
    };

    const onAlertNew = (alert: Alert): void => {
      toastAlertIfNew(alert);
      considerChime(alert);
    };

    const onDirectivePending = (_d: Directive): void => {
      playDirectiveChime();
    };

    const onDirectiveResult = (payload: DirectiveResultPayload): void => {
      const snap = useFleetStore.getState().snapshot;
      const ship = snap?.ships.find((s) => s.shipId === payload.shipId);
      const name = ship?.name ?? payload.shipId;
      if (payload.success) {
        useToastStore
          .getState()
          .pushToast(`Order applied · ${formatDirectiveAppliedSummary(snap, payload.directive)}`, "success");
        return;
      }
      const msg =
        payload.error === "no_route"
          ? `Order failed · ${name} — no valid sea route (check zones / destination).`
          : `Order failed · ${name} — invalid order parameters.`;
      useToastStore.getState().pushToast(msg, "danger");
    };

    const onServerError = (message: string): void => {
      useToastStore.getState().pushToast(message, "danger");
    };

    const onCaptainResponse = (response: CaptainResponse): void => {
      const snap = useFleetStore.getState().snapshot;
      const ship = snap?.ships.find((s) => s.shipId === response.shipId);
      const label = ship ? `${ship.name} (${response.shipId})` : response.shipId;
      if (response.action === "ACCEPT") {
        useToastStore
          .getState()
          .pushToast(`Captain acknowledged standing orders · ${label}`, "success");
        return;
      }
      if (response.action === "ESCALATE_DISTRESS") {
        useToastStore
          .getState()
          .pushToast(`Captain escalated · distress logged · ${label}`, "warning");
      }
    };

    const onDisc = (): void => store.setConnected(false);
    const onPlayback = store.setPlaybackFrames;
    const join = (): void => {
      const st = useFleetStore.getState();
      socket.emit("role:join", {
        role: st.role,
        captainShipId: st.role === "captain" ? st.captainShipId : undefined,
        operatorId: "web-operator",
      });
    };

    const onConn = (): void => {
      store.setConnected(true);
      join();
    };

    socket.on("connect", onConn);
    socket.on("disconnect", onDisc);
    socket.on("fleet:snapshot", onSnap);
    socket.on("alert:new", onAlertNew);
    socket.on("directive:pending", onDirectivePending);
    socket.on("directive:result", onDirectiveResult);
    socket.on("error", onServerError);
    socket.on("captain:response", onCaptainResponse);
    socket.on("playback:frames", onPlayback);

    void (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${WS_BASE}/health`);
          const j = (await res.json()) as { ok?: boolean; booting?: boolean };
          if (j.ok && j.booting !== true) break;
          useFleetStore.getState().setFleetApiStatus(j.booting === true ? "starting" : "checking");
        } catch {
          useFleetStore.getState().setFleetApiStatus("unreachable");
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (cancelled) return;
      useFleetStore.getState().setFleetApiStatus("live");
      socket.connect();
    })();

    return () => {
      cancelled = true;
      socket.off("connect", onConn);
      socket.off("disconnect", onDisc);
      socket.off("fleet:snapshot", onSnap);
      socket.off("alert:new", onAlertNew);
      socket.off("directive:pending", onDirectivePending);
      socket.off("directive:result", onDirectiveResult);
      socket.off("error", onServerError);
      socket.off("captain:response", onCaptainResponse);
      socket.off("playback:frames", onPlayback);
      socket.disconnect();
      useFleetStore.getState().setFleetApiStatus("checking");
    };
  }, []);

  useEffect(() => {
    const onGesture = (): void => {
      unlockAlertAudio();
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    return () => window.removeEventListener("pointerdown", onGesture);
  }, []);

  useEffect(() => {
    if (!socket.connected) return;
    socket.emit("role:join", {
      role,
      captainShipId: role === "captain" ? captainShipId : undefined,
      operatorId: "web-operator",
    });
  }, [role, captainShipId]);

  return null;
}
