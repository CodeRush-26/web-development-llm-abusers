# Verification & testing checklist (Strait Command)

This document maps grading / QA expectations to this repository: **where to look**, **how to verify**, and **known limitations**.

**Legend**

| Tag | Meaning |
| --- | --- |
| **Yes** | Implemented; follow “How to verify” |
| **Partial** | Works with caveats (see Notes) |
| **Manual** | No automated test; needs browser / stopwatch / DevTools |
| **N/A** | Not applicable (e.g. no database in this project) |

**Key files**

| Area | Location |
| --- | --- |
| Fleet + scenario | `apps/server/src/data/fleet.json` |
| Simulation + alerts + fuel + proximity | `apps/server/src/simulation/engine.ts` |
| Grid A* routing | `apps/server/src/routing.ts` |
| WebSocket + broadcasts | `apps/server/src/index.ts` |
| Client sync + toasts | `apps/web/src/components/SyncBus.tsx` |
| Map + zones | `apps/web/src/components/FleetMap.tsx`, `OpsSidebar.tsx` |
| Event log (JSONL) | `logs/strait-command-events.jsonl` (created on first event) |
| Docker | `docker-compose.yml`, `Dockerfile` |
| Health | `GET /health` on the API port (default 4000) |
| Smoke script | `npm run smoke` (API must be running) |

**Constants (engine)**

- Tick interval: **100 ms** → **10 Hz** simulation + broadcast (`TICK_MS_DEFAULT` in `engine.ts`). Meets “≥ 1 Hz”.
- Proximity threshold: **2000 m** (`PROXIMITY_M`).
- Adverse weather fuel multiplier: **×1.3** (`WEATHER_FUEL_MULT`); applied while the ship is in an adverse cell during movement.
- Fuel projection for “insufficient fuel” status uses a conservative estimate (includes weather factor ×1.3 in the projection formula).
- Playback ring buffer: frame every **30 s** sim time, keep **120** frames ≈ **1 hour** sim time.

---

## Phase 1: Initial setup & data loading

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| `docker compose up --build` | **Yes** | `docker compose up --build` from repo root; `web` waits for `api` **healthy** | Set `NEXT_PUBLIC_WS_URL` at **build** time for non-localhost deploys (see README). |
| All containers start | **Yes** | `docker compose ps`; hit http://localhost:3000 and http://localhost:4000/health | API image includes `HEALTHCHECK` via `scripts/healthcheck.cjs`. |
| Database | **N/A** | — | No DB; state is in-memory. Event log is append-only file. |
| Env / API keys | **Partial** | Copy `.env.example` → `.env` | `GROQ_API_KEY` optional; heuristics if missing. |
| `fleet.json` loads, 15 ships | **Yes** | `GET /health` shows `ships: 15`; or count `shipId` in `fleet.json` | — |
| Valid lat/lng, destinations | **Yes** | Inspect `fleet.json` `fleet[]`; run sim and open map | — |
| Navigable polygon + bbox | **Yes** | `fleet.json` + engine bootstrap | Land exclusions in data + generated JSON for routing mask. |
| Initial fuel, speed, heading, cargo | **Yes** | Ship cards / snapshot | — |

---

## Phase 2: Ship simulation core

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Tick ≥ 1 Hz | **Yes** | 10 Hz: `index.ts` interval 100 ms | — |
| All ships update | **Yes** | Watch `fleet:snapshot` in DevTools or map motion | — |
| Time advances | **Yes** | `simTimeMs` in snapshot / `fleet:tick` | Pauses when `sim:setPaused` (Command). |
| Smooth motion | **Partial** | Visual + `fleetStore` interpolation | Server steps ships each tick; client interpolates toward snapshot target. |
| Max speed | **Yes** | `advanceShip` caps effective speed | — |
| Stay in navigable water | **Partial** | `enforceNavigableWater` + routing occupancy | Reroute if off-chart; paths use grid + polygon checks. |
| No NaN positions | **Yes** | Code paths use finite numbers; report if seen | — |
| Fuel decreases when moving | **Yes** | Log or UI fuel field | Stops / hold / arrived reduce or stop burn as implemented. |
| Adverse weather ×1.3 burn | **Yes** | Compare fuel delta in storm vs clear cells | `WEATHER_FUEL_MULT` in `advanceShip`. |
| Fuel floor at 0, `out_of_fuel` | **Yes** | `Math.max(0, …)`; status `out_of_fuel` when empty | — |
| Status transitions | **Partial** | Force scenarios (zones, no route, escalate) | `OperationalStatus` in `packages/shared`; see engine for triggers. |

---

## Phase 3: Routing engine

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Initial routes for 15 ships | **Yes** | Start server; ships move toward goals | `bootstrapShips` + `assignRoute`. |
| Routes in navigable water | **Partial** | Map overlay + occupancy | Chord + occupancy checks in `routing.ts`. |
| New zone → reroute | **Yes** | Commit zone; watch `rerouting` / new polyline | `onZonesChanged` + `assignRoute`. |
| Directive → new path | **Yes** | Command issues directive; `applyDirectiveEffectsNow` + `assignRoute` | Effects run on **send**; captain **ACCEPT** clears pending (no second reroute if already applied). |
| Weather-aware cost | **Yes** | `buildWeatherCostMultipliers` in route cost | Preference, not hard exclusion. |
| Stranded / alerts on no path | **Yes** | Box destination with zones | `stranded` + `stranded_ship` alert. |
| Geofence / inside zone | **Yes** | Draw zone over ship | Geofence checks in engine; breach alerts. |

---

## Phase 4: Real-time (WebSocket)

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Socket.IO connects | **Yes** | Open app with API up; “Simulation offline” clears | `SyncBus` + `NEXT_PUBLIC_WS_URL`. |
| State broadcast | **Yes** | `io.emit("fleet:snapshot", …)` each tick + on events | No polling for fleet state. |
| Multi-tab sync | **Yes** | Multiple browsers | Same snapshots + zone/directive events (`io.emit`). |
| Message types | **Partial** | Network tab / socket.io | See `ServerToClientEvents` in `packages/shared`. Includes `directive:pending`, `directive:result`, `captain:response`, zones, alerts. |
| Latency / p95 500 ms | **Manual** | Chrome DevTools + timestamps | Not logged server-side by default. |

---

## Phase 5–6: Command & captain UI

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Map, 15 ships, Hormuz region | **Yes** | Visual inspection | — |
| Zone draw + commit | **Yes** | Ops sidebar hazards flow | — |
| Edit zone vertices after save | **No** | — | **Not implemented.** Delete the zone (Hazards → **Saved hazard zones** → **Delete**) and draw again if needed. |
| Captain sees one ship | **Yes** | Role = Captain + hull selector | Server checks captain socket scope on directives/responses. |
| Directive send / receive | **Yes** | Two roles / two tabs | Pending + `directive:result` + snapshot. |
| ESCALATE + AI | **Partial** | Needs `GROQ_API_KEY` for LLM; else heuristic | See `services/distressAi.ts`. |

---

## Phase 7: Alerts

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Geofence / proximity / fuel / stranded | **Yes** | Trigger each scenario | Proximity ~2 km; deduping logic in engine. |
| Acknowledge | **Yes** | Alert UI + `alert:ack` | — |
| Filter alerts by type in UI | **No** | — | List shows priority ordering; **no filter dropdown**. |
| Alert history log | **Partial** | JSONL + playback strip | Full “filter UI” not built. |

---

## Phase 8: AI / NLP

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Groq integration | **Partial** | Escalate distress with key set | Timeout / fallback in `distressAi.ts` — read file for behavior. |
| Severity drives alert score | **Yes** | Escalate and inspect alert | — |

---

## Phase 9: Weather

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Open-Meteo fetch | **Yes** | Server logs; refresh every 60 s | `services/weather.ts`. |
| Map overlay | **Manual** | Optional / partial | Weather affects sim; dedicated storm overlay may be limited — confirm in `FleetMap` if present. |

---

## Phase 10: Playback

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| Ring buffer ~1 h sim | **Yes** | Code: 120 × 30 s | — |
| UI scrubber | **Partial** | `PlaybackBar` + store | “Live vs scrub” behavior — test in UI. |
| Pause sim | **Yes** | Top HUD / Command pause | `sim:setPaused`. |

---

## Phase 11–12: Performance & edge cases

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| 15 ships performance | **Manual** | Profile browser | — |
| Directive spam | **Partial** | Rapid sends | **Single pending directive per ship**; newest replaces previous. **No queue.** |
| Zone spam | **Manual** | Rapid commits | In-memory zones list; watch reroute load. |

---

## Phase 13: Code quality & docs

| Item | Status | How to verify | Notes |
| --- | --- | --- | --- |
| README / env | **Yes** | README + `.env.example` | — |
| Separation of concerns | **Yes** | Browse `apps/server`, `apps/web`, `packages/shared` | — |
| CI build | **Yes** | `.github/workflows/ci.yml` runs `npm ci` + `npm run build` | — |

---

## Phase 14: Grading alignment

Use **Phase 1–7 + Phase 4** as core demo path; **Phase 8** with a valid Groq key for full AI; **Docker** for deploy story.

---

## Quick commands

```bash
# Install & dev (two terminals or use root `npm run dev`)
npm install
npm run dev -w apps/server
npm run dev -w apps/web

# Production-style build (matches CI)
npm run build

# API smoke test (server must be listening)
npm run smoke
# or
node scripts/smoke.mjs http://127.0.0.1:4000

# Docker
docker compose up --build
```

---

## Pre-demo (2-minute)

1. `docker compose up --build` **or** `npm run dev`.
2. Open **Command**: ships moving; **Playback** / pause if needed.
3. Draw **zone** → ships reroute / alerts.
4. **Directive** to a hull; second tab **Captain** accept / escalate.
5. Force **proximity** or **stranded** if time permits.
