# 🏍️ Xe Ôm Rush

An authoritative-server, spatial-partitioned .io game built to demonstrate high-scale architecture patterns for the Codex Community Vietnam Hackathon.

## 📌 The Pitch & Vietnamese Context

In Vietnam, motorbikes are the pulse of the city. *Xe Ôm* (traditional motorbike taxi) drivers navigate the labyrinthine hẻm (alleys) and hours of *giờ cao điểm* (rush hour traffic) to deliver passengers and goods. 

**Xe Ôm Rush** turns this daily hustle into a high-concurrency real-time competitive game. Players spawn as drivers, search for passengers popping up at market hotspots (like *Chợ Bến Thành* or *Chợ Lớn*), pick them up, and find the shortest routes through narrow alleys to drop them off, earning VNĐ while dodging traffic.

---

## 🛠️ Engineering Depth (How we target 100k CCU)

To build a true .io game at scale, sending standard JSON updates to every player is a performance bottleneck. This project demonstrates four key production-grade architecture patterns:

### 1. Spatial Partitioning (Grid Chunks)
A single server cannot broadcast position updates of all 100k players to everyone. We segment the map into a 2D grid of **Chunks** (each `500x500` units). 
- Players only receive updates for entities in their **current chunk + 8 neighboring chunks** (a 3x3 local grid).
- Entity query time drops from $O(N)$ (broadcasting to everyone) to $O(1)$ lookup per player.

### 2. Binary Wire Protocol
Instead of sending verbose JSON over WebSockets (e.g., `{"type":"update","x":123.4,"y":56.7,"id":"player-1"}` which is ~60 bytes), we use a custom binary protocol.
- Position updates are packed into binary buffers (approx. **12 bytes** per update).
- This yields a **5x to 10x bandwidth reduction**, critical for network performance and server memory.

### 3. Authoritative Server Tick Loop (20Hz)
- Physics, collision, and state updates run strictly on the server at **20 ticks per second** (50ms interval).
- Clients capture inputs (arrow keys / WASD) and stream their velocity intent to the server.
- Prevents client-side cheating (speed hacks, teleporting).

### 4. Client-side Prediction & Interpolation
- To prevent lag, the client immediately updates the local player's position (**Client Prediction**) and reconciles with server updates when they arrive.
- Other players are rendered smoothly by interpolating their positions over a historical buffer (**Entity Interpolation**), giving a silky-smooth 60 FPS visual experience on HTML5 Canvas.

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

## 🚀 Running the Project

### Prerequisites
- Node.js 18+
- pnpm

### Quick Start
```bash
# Install dependencies
pnpm install

# Run the backend server
pnpm dev:server

# Run the frontend web client
pnpm dev:client
```
