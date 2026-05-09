import "./loadEnv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import type {
  CaptainResponse,
  ClientToServerEvents,
  Directive,
  DirectiveResultPayload,
  RestrictedZone,
  ServerToClientEvents,
} from "@strait-command/shared";
import { SimulationEngine } from "./simulation/engine";
import { fetchWeatherGrid } from "./services/weather";
import { analyzeDistressMessage, distressPriorityBoost } from "./services/distressAi";
import { appendServerEvent } from "./services/eventLog";
import { v4 as uuidv4 } from "uuid";

const PORT = Number(process.env.PORT ?? 4000);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

interface SocketData {
  role?: "command" | "captain";
  captainShipId?: string;
  operatorId?: string;
}

export function buildIoServer(
  engine: SimulationEngine,
): Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>({
    cors: { origin: true, credentials: true },
  });

  io.on("connection", (socket) => {
    socket.emit("fleet:snapshot", engine.snapshot());

    socket.on("role:join", (payload) => {
      socket.data.role = payload.role;
      socket.data.captainShipId = payload.captainShipId;
      socket.data.operatorId = payload.operatorId ?? socket.id;
      socket.emit("fleet:snapshot", engine.snapshot());
    });

    socket.on("zone:save", (payload) => {
      if (socket.data.role !== "command") {
        socket.emit("error", "Zones require Command role");
        return;
      }
      const id = payload.id ?? uuidv4();
      const zone: RestrictedZone = {
        id,
        name: payload.name,
        coordinates: payload.coordinates,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const idx = engine.zones.findIndex((z) => z.id === id);
      if (idx >= 0) engine.zones[idx] = zone;
      else engine.zones.push(zone);
      engine.onZonesChanged();
      io.emit("zone:updated", engine.zones);
      io.emit("fleet:snapshot", engine.snapshot());
      appendServerEvent({
        type: "zone_save",
        zoneId: id,
        name: payload.name,
        vertexCount: payload.coordinates.length,
        operatorId: socket.data.operatorId ?? socket.id,
      });
    });

    socket.on("zone:delete", (zoneId) => {
      if (socket.data.role !== "command") {
        socket.emit("error", "Zones require Command role");
        return;
      }
      engine.zones = engine.zones.filter((z) => z.id !== zoneId);
      engine.onZonesChanged();
      io.emit("zone:updated", engine.zones);
      io.emit("fleet:snapshot", engine.snapshot());
      appendServerEvent({
        type: "zone_delete",
        zoneId,
        operatorId: socket.data.operatorId ?? socket.id,
      });
    });

    socket.on("directive:send", (partial) => {
      if (socket.data.role !== "command") {
        socket.emit("error", "Directives require Command role");
        return;
      }
      const ship = engine.ships.find((s) => s.shipId === partial.shipId);
      if (!ship) {
        socket.emit("error", "Unknown ship");
        return;
      }
      const d: Directive = {
        id: partial.id ?? uuidv4(),
        type: partial.type,
        shipId: partial.shipId,
        issuedAt: engine.getSimTimeMs(),
        issuedBy: partial.issuedBy ?? socket.data.operatorId ?? "command",
        targetPortId: partial.targetPortId,
        waypoint: partial.waypoint,
        note: partial.note,
      };
      ship.pendingDirective = d;
      io.emit("directive:pending", d);

      const appliedOk = engine.applyDirectiveEffectsNow(ship.shipId);

      const hasCaptainForShip = Array.from(io.sockets.sockets.values()).some(
        (s) => s.data.role === "captain" && s.data.captainShipId === ship.shipId,
      );

      let error: DirectiveResultPayload["error"];
      if (!appliedOk) {
        error = d.type === "REROUTE_PORT" || d.type === "DIVERT_WAYPOINT" ? "no_route" : "invalid_directive";
        ship.pendingDirective = null;
      } else if (!hasCaptainForShip) {
        engine.applyDirectiveAccepted(ship.shipId);
      }

      const resultPayload: DirectiveResultPayload = {
        directive: d,
        shipId: ship.shipId,
        success: appliedOk,
        ...(error ? { error } : {}),
      };
      io.emit("fleet:snapshot", engine.snapshot());
      io.emit("directive:result", resultPayload);
      appendServerEvent({
        type: "directive_send",
        directiveId: d.id,
        shipId: partial.shipId,
        directiveType: partial.type,
        operatorId: socket.data.operatorId ?? socket.id,
      });
    });

    socket.on("captain:respond", async (response: CaptainResponse) => {
      if (socket.data.role !== "captain") {
        socket.emit("error", "Captain role required");
        return;
      }
      if (socket.data.captainShipId !== response.shipId) {
        socket.emit("error", "Wrong vessel scope");
        return;
      }
      io.emit("captain:response", response);
      appendServerEvent({
        type: "captain_response",
        shipId: response.shipId,
        action: response.action,
        directiveId: response.directiveId,
      });

      const ship = engine.ships.find((s) => s.shipId === response.shipId);
      if (!ship?.pendingDirective || ship.pendingDirective.id !== response.directiveId) {
        io.emit("fleet:snapshot", engine.snapshot());
        return;
      }

      if (response.action === "ACCEPT") {
        engine.applyDirectiveAccepted(response.shipId);
        io.emit("fleet:snapshot", engine.snapshot());
        return;
      }

      const msg = response.distressMessage ?? "";
      const analysis = await analyzeDistressMessage(msg, GROQ_API_KEY);
      ship.status = "distressed";
      const alertId = `distress:${response.shipId}:${response.directiveId}`;
      const alert = {
        id: alertId,
        type: "distress_escalation" as const,
        severity: analysis.severity,
        shipId: response.shipId,
        message: `${ship.name}: ESCALATE — ${analysis.summary}`,
        timestamp: engine.getSimTimeMs(),
        acknowledged: false,
        distressAnalysis: analysis,
        aiPriorityScore: distressPriorityBoost(analysis),
      };
      engine.alerts.set(alert.id, alert);
      ship.pendingDirective = null;
      io.emit("distress:analyzed", { shipId: response.shipId, analysis });
      io.emit("alert:new", alert);
      io.emit("fleet:snapshot", engine.snapshot());
    });

    socket.on("alert:ack", ({ alertId, operatorId }) => {
      engine.acknowledgeAlert(alertId, operatorId);
      const a = engine.alerts.get(alertId);
      if (a) io.emit("alert:updated", a);
      io.emit("fleet:snapshot", engine.snapshot());
    });

    socket.on("playback:request", () => {
      socket.emit("playback:frames", engine.getPlayback());
    });

    socket.on("sim:setPaused", ({ paused }) => {
      if (socket.data.role !== "command") {
        socket.emit("error", "Pause requires Command role");
        return;
      }
      engine.simulationPaused = paused;
      appendServerEvent({
        type: "sim_set_paused",
        paused,
        operatorId: socket.data.operatorId ?? socket.id,
      });
      io.emit("fleet:snapshot", engine.snapshot());
    });
  });

  return io;
}

async function main(): Promise<void> {
  const fastify = Fastify({ logger: true });
  await fastify.register(cors, { origin: true });

  let engine: SimulationEngine | undefined;

  fastify.get("/health", async () => {
    if (!engine) {
      return {
        ok: true,
        booting: true,
        tick: 0,
        simTimeMs: 0,
        simulationPaused: false,
        ships: 0,
      };
    }
    return {
      ok: true,
      booting: !engine.isRoutingReady(),
      tick: engine.tickCount,
      simTimeMs: engine.simTimeMs,
      simulationPaused: engine.simulationPaused,
      ships: engine.ships.length,
    };
  });

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  fastify.log.info(`HTTP listening on :${PORT}`);

  engine = new SimulationEngine();

  const io = buildIoServer(engine);
  io.attach(fastify.server);

  void (async () => {
    try {
      const cells = await fetchWeatherGrid(engine!.boundingBox, 5);
      engine!.setWeather(cells);
    } catch {
      fastify.log.warn("Weather bootstrap failed — continuing");
    }
  })();

  setInterval(async () => {
    try {
      const cells = await fetchWeatherGrid(engine!.boundingBox, 5);
      engine!.setWeather(cells);
    } catch {
      /* ignore transient failures */
    }
  }, 60_000);

  setInterval(() => {
    const snap = engine!.tick(100);
    io.emit("fleet:snapshot", snap);
    io.emit("fleet:tick", {
      tick: snap.tick,
      simTimeMs: snap.simTimeMs,
      simulationPaused: snap.simulationPaused,
    });
  }, 100);

  fastify.log.info(`Strait Command API + WS on :${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
