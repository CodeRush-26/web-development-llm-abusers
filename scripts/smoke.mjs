/**
 * Quick smoke test: GET /health on the simulation API (default http://127.0.0.1:4000).
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
const base = process.argv[2] ?? process.env.SMOKE_API_URL ?? "http://127.0.0.1:4000";
const url = new URL("/health", base.endsWith("/") ? base : `${base}/`);

const res = await fetch(url);
if (!res.ok) {
  console.error(`Smoke failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const body = await res.json();
console.log("Smoke OK:", JSON.stringify(body));
process.exit(0);
