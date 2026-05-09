"use client";

import { io, type Socket } from "socket.io-client";
import { getFleetApiOrigin } from "./fleetApiOrigin";

let socket: Socket | null = null;
let boundOrigin: string | null = null;

const ioOptions = {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  autoConnect: false,
  reconnectionAttempts: 20,
  reconnectionDelay: 500,
  reconnectionDelayMax: 8000,
};

/**
 * Lazy singleton so the origin is resolved at runtime (localhost, LAN, Hugging Face, or `NEXT_PUBLIC_WS_URL`).
 */
export function getFleetSocket(): Socket {
  const origin = getFleetApiOrigin();
  if (socket && boundOrigin === origin) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.close();
  }
  boundOrigin = origin;
  socket = io(origin, ioOptions);
  return socket;
}
