---
title: Strait Command API
emoji: 🚢
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/qMg4I596)

# Strait Command — Maritime Crisis Operations Platform

Production-grade real-time command deck for the **Strait of Hormuz Crisis** scenario: fifteen simulated cargo ships, grid **A\*** routing inside navigable water with runtime restricted zones, **Socket.IO** fleet sync at **10 Hz**, Open-Meteo **weather** with **30% fuel penalty** in adverse cells, **captain ↔ command** directives with AI-assisted distress escalation (**Groq** optional via `GROQ_API_KEY`, heuristic fallback), **playback** ring buffer (30 s × 120 frames ≈ last hour), and a **Next.js / MapLibre** tactical UI with glass panels and alert pipeline.

## Observability & grading aids

| Mechanism | Purpose |
| --- | --- |
| **Pause / resume simulation** | Command UI sends `sim:setPaused` — freezes **sim time** and ship physics (`FleetSnapshot.simulationPaused`). Weather refresh still runs on wall clock. |
| **`fleet:tick`** | Each simulation tick emits `{ tick, simTimeMs, simulationPaused }` alongside `fleet:snapshot` for latency / timing checks. |
| **`GET /health`** | JSON: `ok`, `tick`, `simTimeMs`, `simulationPaused`, `ships`. |
| **Event log** | Append-only JSONL at **`logs/strait-command-events.jsonl`** (zone save/delete, directives, captain responses, pause). Created on first event. |
| **`out_of_fuel`** | Operational status when bunkers reach zero (replaces former `stopped`). |

## Architecture

| Layer | Stack |
| --- | --- |
| Shared contracts | `packages/shared` — ships, alerts, directives, WebSocket event typings |
| API + simulation | `apps/server` — Fastify health check, Socket.IO, `SimulationEngine` (fuel, proximity 2 km, geofences, stranded detection), grid routing |
| Client | `apps/web` — Next.js 15 (App Router), Tailwind, Framer Motion, MapLibre GL, Recharts, Zustand, client-side motion interpolation |

**Assumptions (documented):**

- **Routing:** Grid occupancy over the official navigable polygon; **A\*** with 8-neighbor moves. Weather cost on route edges is approximated by **fuel burn on track** (adverse flag per ship position), not a full weighted A\* graph, to keep laptop performance predictable while meeting fuel and reroute behavior.
- **Playback:** In-memory ring buffer of snapshots every **30 s** of simulation time (not wall clock), sufficient for “last hour @ 30 s” scrubbing for grading.
- **Coordinates:** `[lat, lng]` throughout; restricted zones are simple polygons in geographic space (planar ray-casting — valid at Gulf regional scale).

## Prerequisites

- Node.js **20+** (22 used in Docker)
- npm **10+**
- Optional: **Groq API key** (free tier) for structured distress JSON — see [Groq Console](https://console.groq.com/). Without it, the server uses deterministic keyword/heuristic NLP.

## Environment variables

Copy `.env.example` to **`.env`** at the **repository root** (same folder as `package.json`). Both `apps/server` and `apps/web` load this file for local runs.

| Variable | Where | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Server | Optional; Groq API key for LLM distress parsing |
| `GROQ_MODEL` | Server | Optional; default **`llama-3.3-70b-versatile`** |
| `GROQ_API_BASE` | Server | Optional; override Groq OpenAI-compatible URL |
| `PORT` | Server | Default **4000** |
| `NEXT_PUBLIC_WS_URL` | Web | Optional override for fleet API URL. When unset, the UI picks **`http://localhost:4000`** on localhost, **same origin** on **`*.hf.space`**, or **`http(s)://<hostname>:4000`** otherwise (LAN). Set when the API is hosted separately (e.g. **`https://….hf.space`**). |

### Hugging Face Space (Docker backend only)

The repository root **`Dockerfile`** defaults to the **API** image listening on **`PORT`** (**`7860`** in the image; overridden to **`4000`** by `docker-compose` locally). In your Space, open **Settings → Variables and secrets** and add:

| Name | Visibility | Value |
| --- | --- | --- |
| `PORT` | Public variable | **`7860`** (must match **README** `app_port` unless you change both) |
| `GROQ_API_KEY` | Secret | Your Groq API key, or leave unset for heuristic-only distress handling |
| `GROQ_MODEL` | Public variable | Optional; default **`llama-3.3-70b-versatile`** |

For **`npm run dev`** on your laptop with the API still on Hugging Face, set **`NEXT_PUBLIC_WS_URL=https://<your-subdomain>.hf.space`** in **`.env`**. For purely local dev (server + web on localhost), leave **`NEXT_PUBLIC_WS_URL`** unset. If you host the Next app on the same **`*.hf.space`** origin as the Docker API, the UI uses **same origin** automatically without that variable.

**Deploy:** Hugging Face **does not accept your account password** over HTTPS Git — use a **[User Access Token](https://huggingface.co/settings/tokens)** (write) as the **password**, or SSH.

```bash
git remote add hf https://huggingface.co/spaces/asad01001/Strait_of_Hormuz
git push hf main
```

When prompted: **Username** = your Hugging Face username; **Password** = paste the token (starts with `hf_`), not your login password.

Alternatively set the remote once with embedded credentials (avoid sharing the URL — it contains the token):

```bash
git remote add hf https://YOUR_USERNAME:hf_YOUR_TOKEN@huggingface.co/spaces/asad01001/Strait_of_Hormuz
```

Or use the [Hugging Face Hub CLI](https://huggingface.co/docs/huggingface_hub/guides/cli) with `HF_TOKEN` set.

## Local development

```bash
cp .env.example .env
# Edit .env — set GROQ_API_KEY for live LLM distress analysis

npm install
npm run dev
```

- **UI:** http://localhost:3000  
- **API + WebSocket:** http://localhost:4000 (`/socket.io`)  
- Health: `GET http://localhost:4000/health`

Use the in-app **Role** selector: **Command** (fleet + zone draw + directives) vs **Captain** (single ship + directive response). Draw restricted zones with **Draw polygon** → click vertices → **Commit zone**. Weather is fetched from Open-Meteo on startup and every **60 s**.

## Verification & QA

See **[docs/TESTING-CHECKLIST.md](docs/TESTING-CHECKLIST.md)** for a full grading-style checklist mapped to this codebase (constants, limitations, and manual steps).

```bash
# After the API is up (e.g. port 4000)
npm run smoke
```

## Docker

```bash
docker compose up --build
```

- Web: http://localhost:3000  
- API: http://localhost:4000  

The **API** image exposes a Docker **HEALTHCHECK** (`GET /health`). The **web** service starts only after the API reports healthy (`depends_on: condition: service_healthy`). Requires **Docker Compose v2.1+**.

**Browser WebSocket URL (important for deploy):** `NEXT_PUBLIC_WS_URL` is embedded at **Next.js build time**. For Docker on your laptop, defaults to `http://localhost:4000` (browser on the host talks to the published API port). For a **remote** server, set the **public** API origin before building the web image, e.g.:

```bash
set NEXT_PUBLIC_WS_URL=https://your-api.example.com
docker compose build --no-cache web
docker compose up
```

Pass Groq at runtime (optional):

```bash
set GROQ_API_KEY=gsk_...   # Windows
export GROQ_API_KEY=gsk_... # Unix
docker compose up --build
```

## Feature checklist (problem statement mapping)

- **15 ships** from `apps/server/src/data/fleet.json`
- **≥ 1 Hz** updates (10 Hz simulation tick; broadcast each tick)
- **WebSockets** only (no polling) — `fleet:snapshot`
- **Roles:** Command vs Captain scopes enforced server-side for zones and directives
- **Zones:** draw, persist in memory, reroute on intersection / breach alerts
- **Proximity:** **2 km** pairwise check with deduped rolling alert
- **Weather:** Open-Meteo grid; adverse ⇒ **×1.3** fuel burn
- **AI distress:** severity, injuries, category, impact; prioritizes alert score
- **Playback:** Load history + scrub timeline (ring buffer frames)

## Repository layout

```
packages/shared/          # TypeScript contracts
apps/server/src/
  data/fleet.json         # Canonical fleet + polygon + ports
  simulation/engine.ts    # Tick loop, alerts, directives
  routing.ts              # Grid + A*
  services/weather.ts     # Open-Meteo
  services/distressAi.ts  # OpenAI + heuristic fallback
apps/web/src/
  components/             # Map, HUD, sidebar, alerts, playback
  store/fleetStore.ts     # Zustand + interpolation targets
```

## License / coursework

See course repository terms. This implementation is submitted for the Code Rush Web Dev track scenario.
