# 🏍️ Xe Ôm Rush

An authoritative-server, spatial-partitioned .io game built to demonstrate high-scale real-time multiplayer architecture patterns for the Codex Community Vietnam Hackathon.

## 📌 The Pitch & Vietnamese Context

In Vietnam, motorbikes are the pulse of the city. *Xe Ôm* (traditional motorbike taxi) drivers navigate the labyrinthine hẻm (alleys) and hours of *giờ cao điểm* (rush hour traffic) to deliver passengers and goods.

**Xe Ôm Rush** turns this daily hustle into a high-concurrency real-time competitive game. Players spawn as drivers, search for passengers popping up at market hotspots (like *Chợ Bến Thành* or *Chợ Lớn*), pick them up, and find the shortest routes through narrow alleys to drop them off, earning VNĐ while dodging traffic.

---

## 🚦 Live Gameplay & Simulation Features

The game is fully playable and includes the following features simulating real-world street dynamics in Vietnam:

* **Passenger Pickups & Deliveries:** Green pulsing hotspots indicate passengers waiting for rides. Drivers receive dynamic line vectors mapping directly to red destination drop-off zones, earning score (VNĐ) on delivery.
* **Grid Alleys & Buildings:** A physics collision engine checks movement inputs against dense block building structures, simulating narrow, winding lanes.
* **Seeded Roundabouts:** Green traffic circles with central obstacles and visual direction indicators guiding vehicles.
* **Traffic Signals:** Intersections contain dynamic traffic lights (Green/Yellow/Red) alternating for North-South and East-West directions.
* **Pedestrian Crosswalks & AI:** Randomly generated pedestrian agents walk back and forth across crosswalks, complete with dynamic path timing and collision checks.

### ⚠️ Violations & Traffic Penalties

* **Red Light Violation (Vượt đèn đỏ):** Crossing a stop line during a red light triggers a **-2,000đ** penalty.
* **Pedestrian Collision (Tông người đi bộ):** Striking a pedestrian resets your score to **0đ**, stuns your bike (disabling input) for **2 seconds** (40 ticks), and triggers a high-impact screen shake.
* **Driver-to-Driver Collision (Va chạm xe):** Colliding with another player or bot pushes both bikes apart using slide-along-wall physics resolution and carries a **-1,000đ** penalty (with a 1-second cooldown).

---

## 🛠️ Engineering Depth (How we target 100k CCU)

To build a true .io game at scale, sending standard JSON updates to every player is a performance bottleneck. This project demonstrates four key production-grade architecture patterns:

### 1. Spatial Partitioning (Grid Chunks)

A single server cannot broadcast position updates of all 100k players to everyone. We segment the map into a 2D grid of **Chunks** (each `500x500` units).

* Players only receive updates for entities in their **current chunk + 8 neighboring chunks** (a 3x3 local grid).
* Entity query time drops from $O(N)$ (broadcasting to everyone) to $O(1)$ lookup per player.

### 2. Binary Wire Protocol

Instead of sending verbose JSON over WebSockets (e.g., `{"type":"update","x":123.4,"y":56.7,"id":"player-1"}` which is ~60 bytes), we use a custom binary protocol packing data into ArrayBuffers.

* **Micro-benchmarks (`vitest bench`):**
  * **Serialization (Encoding):** Custom binary serialization is **8.4x faster** than `JSON.stringify`.
  * **Deserialization (Decoding):** Custom binary parsing is **4.6x faster** than `JSON.parse`.
* This yields a **5x to 10x bandwidth reduction**, saving server memory and networking bandwidth.

### 3. Authoritative Server Tick Loop (20Hz)

* Physics, collision, and state updates run strictly on the server at **20 ticks per second** (50ms interval).
* Clients capture inputs (arrow keys / WASD) and stream their velocity intent to the server.
* Prevents client-side cheating (speed hacks, teleporting).

### 4. Client-side Prediction & Interpolation

* To prevent lag, the client immediately updates the local player's position (**Client Prediction**) and reconciles with server updates when they arrive.
* Other players are rendered smoothly by interpolating their positions over a historical buffer (**Entity Interpolation**), giving a silky-smooth 60 FPS visual experience on HTML5 Canvas.

---

## 🏗️ System Architecture

```
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

The client includes a premium developer interface showing live metrics:

* **Real-time RTT (Ping)** & **Server Tick Rate (Hz)** telemetry.
* **Payload Size Comparison:** Compares the actual binary packet size to equivalent JSON.
* **Dynamic Compression Ratio:** Visualizes network efficiency (typically showing **6x - 10x smaller payload sizes**).
* **Map Chunk Debug Grid:** Draw boundaries of active spatial grid chunks.
* **Real-time Bot Spawner:** Spawn 25 AI drivers directly from the client UI.

### Load and Stress Testing

The backend includes a headless client simulator capable of spinning up hundreds of concurrent connections staggered:

```bash
# Run headless stress bots (default 100 bots for 15s)
pnpm --filter server stress

# Run stress bots with custom parameters
pnpm --filter server stress -- --clients 250 --duration 30 --url ws://localhost:3002
```

---

## 🚀 Running the Project

### Prerequisites

- Node.js 18+
* pnpm

### Quick Start

```bash
# Install dependencies
pnpm install

# Run the backend server
pnpm dev:server

# Run the frontend web client
pnpm dev:client

# Run automated unit tests
pnpm test

# Run performance benchmarks
pnpm bench
```
