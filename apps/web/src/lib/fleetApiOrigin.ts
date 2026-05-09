/**
 * Resolves the fleet API (HTTP + Socket.IO) base URL.
 *
 * 1) `NEXT_PUBLIC_WS_URL` when set (build-time) — use for Vercel + API on HF, etc.
 * 2) Browser heuristics when unset:
 *    - localhost / 127.0.0.1 / ::1 → http://localhost:4000
 *    - *.hf.space → same origin (API on the same Space)
 *    - else → same host, port 4000, same protocol (LAN / custom dev hostnames)
 * 3) Server / pre-paint: http://localhost:4000
 */
export function getFleetApiOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  const { protocol, hostname, origin } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return "http://localhost:4000";
  }

  if (hostname.endsWith(".hf.space")) {
    return origin;
  }

  const isHttps = protocol === "https:";
  const apiProto = isHttps ? "https:" : "http:";
  return `${apiProto}//${hostname}:4000`;
}
