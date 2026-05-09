"use client";

import { io, type Socket } from "socket.io-client";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

export const fleetSocket: Socket = io(WS_BASE, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  autoConnect: false,
  reconnectionAttempts: 20,
  reconnectionDelay: 500,
  reconnectionDelayMax: 8000,
});
