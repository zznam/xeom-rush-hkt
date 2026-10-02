# 🏍️ Xe Ôm Rush

A cheerful Saigon motorbike taxi game with an authoritative multiplayer server. The toon release adds illustrated characters, pickup and delivery feedback, accessible controls, reconnect recovery, and Deno KV persistence.

[Play the game](https://xeom-rush.vercel.app) · [16-feature roadmap](docs/roadmap.md) · [Art assets and prompts](docs/art-direction.md) · [Default Vercel/Deno deployment](docs/deno-deployment.md) · [Ad-hoc AWS deployment](docs/aws-deployment.md)

## 📌 The Pitch & Vietnamese Context

In Vietnam, motorbikes are the pulse of the city. _Xe Ôm_ (traditional motorbike taxi) drivers navigate the labyrinthine hẻm (alleys) and hours of _giờ cao điểm_ (rush hour traffic) to deliver passengers and goods.

**Xe Ôm Rush** turns this daily hustle into a high-concurrency real-time competitive game. Players spawn as drivers, search for passengers popping up at market hotspots (like _Chợ Bến Thành_ or _Chợ Lớn_), pick them up, and find the shortest routes through narrow alleys to drop them off, earning VNĐ while dodging traffic.

---

## 🚦 Live Gameplay & Simulation Features

- **Passenger Tiers & Deadlines:** Passengers are spawned with weighted probabilities (70% Regular 🟢, 20% Business 🟡, 10% VIP 🟣). Business and VIP passengers have strict delivery deadlines (relative server ticks); if they are not picked up before their deadline, they expire and disappear. VIP spawns trigger a global sound alert.
- **Combo / Streak System:** Successfully delivering passengers in succession builds your combo streak. A multiplier (1× → 1.5× → 2.0× → 3.0× at streaks 1, 3, 5, 10) is applied to rewards. The streak resets if you remain idle (no delivery) for 30 seconds, collide with a pedestrian, or start a new ride. Brief reconnects to the same running city preserve the ride.
- **Rush Hour Events (Giờ cao điểm):** Every 5 minutes, a 60-second Rush Hour event starts. During this event, passenger spawn rate is doubled (2×) and rewards are boosted by 1.5×. Rush Hour is introduced with a custom musical sting. Local development also supports manually triggering it via `POST /api/rush-hour`. Demo controls are disabled in production.
- **Procedural Sound Engine:** Generated fully in-browser via the Web Audio API with zero external file assets. Includes:
  - Motorbike engine hum (pitch scale dynamically linked to speed).
  - Short ascending chimes on passenger pickup.
  - Triumphant arpeggios on passenger delivery.
  - Custom square-wave buzzer sound on keypress `H` (còi xe).
  - Orchestral/synthesized horn fanfare stings on Rush Hour start and VIP spawns.
- **HUD Minimap:** Positioned bottom-left mapping the full 4000×4000 grid. Displays player coordinates, other drivers, passenger blips (color-coded by tier), and destination drop-off zones.
- **Grid Alleys & Buildings:** A physics collision engine checks movement inputs against dense block building structures, simulating narrow, winding lanes.
- **Seeded Roundabouts:** Green traffic circles with central obstacles and visual direction indicators guiding vehicles.
- **Traffic Signals:** Intersections contain dynamic traffic lights (Green/Yellow/Red) alternating for North-South and East-West directions.
- **Pedestrian Crosswalks & AI:** Randomly generated pedestrian agents walk back and forth across crosswalks, complete with dynamic path timing and collision checks.
- **Autonomous AI Bots:** Bots navigate the city using A* street-grid pathfinding. They feature smooth turn interpolation, reverse-throttle collision recovery when stuck, and distributed spawning logic to prevent clustering.

### ⚠️ Violations & Traffic Penalties

- **Red Light Violation (Vượt đèn đỏ):** Crossing a stop line during a red light triggers a **-2,000đ** penalty.
- **Pedestrian Collision (Tông người đi bộ):** Striking a pedestrian deducts up to **5,000đ** (never below zero), resets your combo streak to **0**, stuns your bike (disabling input) for **2 seconds** (40 ticks), and triggers a high-impact screen shake.
- **Driver-to-Driver Collision (Va chạm xe):** Colliding with another player or bot pushes both bikes apart using slide-along-wall physics resolution and carries a **-1,000đ** penalty (with a 1-second cooldown).

---

## 🛠️ Engineering Depth and Regional Capacity

To build a true .io game at scale, sending standard JSON updates to every player is a performance bottleneck. The architecture uses the following patterns. Production concurrency must be established by load tests; 100k CCU has not been validated. Regional capacity expands through independently owned cities, with a default limit of 64 human drivers per city:

### 1. Spatial Partitioning (Grid Chunks)

A single server cannot broadcast position updates of all 100k players to everyone. We segment the map into a 2D grid of **Chunks** (each `500x500` units).

- Players only receive updates for entities in their **current chunk + 8 neighboring chunks** (a 3x3 local grid).
- Entity queries visit nearby buckets instead of the entire world. Their cost depends on local entity density; they are not constant-time at arbitrary player counts.

### 2. Binary Wire Protocol

Instead of sending verbose JSON over WebSockets (e.g., `{"type":"update","x":123.4,"y":56.7,"id":"player-1"}` which is ~60 bytes), we use a custom binary protocol packing data into ArrayBuffers.

The live protocol now uses **per-client binary delta snapshots**:

- The first packet and periodic resync packets are full visible-world baselines.
- Normal 20Hz packets send only changed entities plus removed entity IDs for anything that left the player's interest area.
- The client reconstructs deltas back into complete snapshots before prediction, interpolation, rendering, and HUD logic run.
- The developer panel shows actual packet bytes and whether the latest packet was `FULL` or `DELTA`.

- **Micro-benchmarks (`vitest bench`):**
  - **Serialization (Encoding):** Custom binary serialization is **8.4x faster** than `JSON.stringify`.
  - **Deserialization (Decoding):** Custom binary parsing is **4.6x faster** than `JSON.parse`.
- This yields a **5x to 10x bandwidth reduction**, saving server memory and networking bandwidth.

### 3. Authoritative Server Tick Loop (20Hz)

- Physics, collision, and state updates run strictly on the server at **20 ticks per second** (50ms interval).
- Clients capture inputs (arrow keys / WASD) and stream their velocity intent to the server.
- Prevents client-side cheating (speed hacks, teleporting).

### 4. Client-side Prediction & Interpolation

- To prevent lag, the client immediately updates the local player's position (**Client Prediction**) and reconciles with server updates when they arrive.
- Other players are rendered smoothly by interpolating their positions over a historical buffer (**Entity Interpolation**), giving a silky-smooth 60 FPS visual experience on HTML5 Canvas.

---

## 🏗️ System Architecture

```text
                       +---------------------------------------+
                       |           Browser Client              |
                       |  (React UI + HTML5 Canvas @ 60 FPS)   |
                       +-------------------+---------------+---+
                                           |               ^
                   Inputs (Movement Intent)|               | Binary Snapshots
                                           v               | (12 bytes/entity)
                       +-------------------+---------------+---+
                       |          WebSocket Gateway            |
                       |       (ws Library - Binary mode)      |
                       +-------------------+---------------+---+
                                           |               ^
                                Read Input |               | Filtered State
                                           v               |
                       +-------------------+---------------+---+
                       |        Authoritative Game Loop        |
                       |            (20 ticks/sec)             |
                       +---+-------------------------------+---+
                           |                               |
                           v                               v
            +--------------+--------------+ +--------------+--------------+
            |  Spatial Grid Partitioning  | |    Physics & Collisions     |
            |     (3x3 Chunk Filter)      | |  (Alley walls, Pickups)    |
            +-----------------------------+ +-----------------------------+
```

---

## 📊 Developer Diagnostic Panel & Load Testing

Local development includes a diagnostic interface (hidden by default and excluded from production) showing live metrics:

- **Real-time RTT (Ping)** & **Server Tick Rate (Hz)** telemetry.
- **Payload Size Comparison:** Compares the actual binary packet size to equivalent JSON.
- **Dynamic Compression Ratio:** Visualizes network efficiency (typically showing **6x - 10x smaller payload sizes**).
- **Map Chunk Debug Grid:** Draw boundaries of active spatial grid chunks.
- **Real-time Bot Spawner:** Spawn 25 AI drivers directly from the client UI.

### Load and Stress Testing

The backend includes a headless client simulator capable of spinning up hundreds of concurrent connections staggered:

```bash
# Run headless stress bots (default 100 bots for 15s)
bun run --filter server stress

# Run stress bots with custom parameters
bun run --filter server stress -- --clients 250 --duration 30 --url ws://localhost:3002
```

---

## 🗄️ Database Persistence & Leaderboard

The Deno deployment uses **Deno KV** for career totals, ranking, and idempotent session checkpoints every 30 seconds and at ride end. Live city state remains in memory. Legacy names still identify careers; stable guest identity is planned in release 2. The original **MongoDB** adapter remains available for Node deployments:

- **Asynchronous Save Queue:** During a match, passenger dropoffs and traffic violations are tracked strictly in memory. When a player disconnects, their session stats are saved asynchronously to prevent database latency from slowing down the 20Hz tick loop.
- **Collections:**
  - `players` — Tracks career earnings (VNĐ), total deliveries, and high score/streak records.
  - `matches` — Logs complete history of completed match sessions, containing a summary of scores and traffic violations (red-light runs, pedestrian collisions, and driver impacts) for each driver.
- **Leaderboard Optimization:** Exposes a `GET /api/leaderboard` endpoint sorted by indexed `{ careerScore: -1 }` for optimal query response times.
- **Memory-Only Fallback:** If the database connection times out (configured to fail fast in 2 seconds), local development starts in **MEMORY-ONLY mode**; production refuses to start without working persistence. This allows quick local testing and E2E runs without database dependencies.

---

## 🚀 Running & Deploying the Project

### Prerequisites

- Bun 1.2+ (and Node.js 22+ or Deno 2 for alternate runtimes)

### Quick Start (Local Development)

```bash
# Install dependencies
bun install

# Start MongoDB service (runs on port 27018 to avoid port conflicts)
docker compose up -d

# Run the backend server
bun run dev:server

# Run the frontend web client
bun run dev:client

# Run automated unit tests (Vitest)
bun run test

# Run automated E2E smoke tests (Playwright)
bun run test:e2e

# Run performance benchmarks
bun run bench
```

### Default deployment: legacy Vercel + Deno

Both deployment routes are supported. **Legacy is the default** for normal builds and the existing `main` Git deployments. AWS `regional-production` runs only when explicitly requested.

| Target                         | Client and server                                           | Deployment trigger                           |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------- |
| `legacy` (default)             | Vercel client, Deno Deploy backend and Deno KV              | Existing provider Git integrations on `main` |
| `regional-production` (ad-hoc) | CloudFront/S3 client, regional ECS matchmaking and DynamoDB | Manually dispatched AWS workflows            |

- **Vercel** uses `vercel.json`, which explicitly builds the legacy client. Set `VITE_WS_URL` to `wss://xeom-rush.zznam.deno.net`.
- **Deno Deploy** uses `deno.json` and `deploy/deno-entry.ts`, which explicitly selects legacy production mode and Deno KV.
- `bun run build:legacy` builds both legacy components. Ordinary `bun run build:client` also defaults to legacy unless `VITE_DEPLOY_TARGET=regional-production` is explicitly supplied.
- A leftover `VITE_REGIONS_JSON`, `GAME_REGION`, or `DYNAMODB_TABLE` does not switch the default route to AWS.
- GitHub CI validates both supported routes without deploying AWS or requiring AWS credentials.

See [the default deployment guide](docs/deno-deployment.md) for provider configuration, validation, and rollback.

### Ad-hoc deployment: AWS regional-production

AWS remains independently deployable with regional matchmaking, reserved city seats, same-city reconnects, and careers keyed by signed guest identities. Its workflows are named **AWS regional-production - Build release**, **AWS regional-production - Deploy infrastructure**, and **AWS regional-production - Publish frontend**. All use `workflow_dispatch`; pushes and merges never trigger AWS deployment.

To build its frontend explicitly:

```bash
VITE_REGIONS_JSON='[{"id":"ap-southeast-1","label":"Singapore","apiUrl":"https://sg.play.example.com"}]' bun run build:client:regional
```

AWS server tasks explicitly set `DEPLOY_TARGET=regional-production` through Terraform. An incomplete regional configuration fails instead of silently falling back to legacy. The manual workflows accept `main`, `regional-production`, or `codex/regional-production`; protect those branches in their AWS GitHub environments. AWS publishes to its own CloudFront site and does not change Vercel/Deno's default route.

See [the AWS operations guide](docs/aws-deployment.md) for bootstrap, manual promotion, and rollback.

The original Railway Docker configuration is retained as an optional paid-host fallback. The Railway trial expired; its MongoDB volume has not been removed or migrated. New Deno careers begin in the new database. The legacy `deploy.sh` helper describes Railway setup and is not used for Deno.
