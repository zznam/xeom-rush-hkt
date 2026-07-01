# Binary Delta Snapshots Design

## Goal

Reduce per-client network bandwidth by adding binary delta snapshots with per-client baselines while preserving the existing authoritative server, spatial filtering, prediction, interpolation, and HUD flow.

## Context

Xe Om Rush already uses a custom binary protocol, a 20Hz authoritative server tick loop, and chunk-based interest management. The server currently sends a complete visible snapshot to every connected client every tick. That is simple and robust, but it repeats unchanged entity fields even when only a few positions or scores change.

## Chosen Approach

Add a new delta snapshot message type. The server sends a full snapshot when a socket has no baseline, at a fixed resync interval, or when delta encoding is unsafe. On normal ticks, the server compares the current visible snapshot for that socket against the last snapshot sent to that socket and sends only changed entities plus removed entity IDs.

The client network layer reconstructs deltas into the existing `WorldSnapshot` shape before notifying React/gameplay code. This keeps the renderer, prediction, interpolation, minimap, and HUD consumers working with complete snapshots.

## Protocol

The existing `SNAPSHOT` message remains the full baseline format.

Add `DELTA_SNAPSHOT` with:

- tick
- changed players
- removed player IDs
- changed passengers
- removed passenger IDs
- changed traffic lights
- removed traffic light IDs
- changed pedestrians
- removed pedestrian IDs
- rush-hour flag
- changed streak entries
- removed streak IDs

Changed entities are encoded as complete entity records. This is intentionally larger than bit-level field masks, but safer for a first deployable version because each changed record can be decoded with the same semantics as full snapshots. Removed IDs let the client delete entities that left the visible area, were picked up, expired, or disconnected.

## Server Flow

Each active socket keeps:

- the last complete `WorldSnapshot` sent or reconstructed for that socket
- the tick when the last full snapshot was sent

On each broadcast:

1. Build the current visible snapshot with `world.getVisibleSnapshotForPlayer`.
2. If no baseline exists or the resync interval elapsed, send a full snapshot and store it as the baseline.
3. Otherwise, encode a delta from the previous baseline to the current snapshot.
4. Send the delta and replace the baseline with the current snapshot.

The baseline is deleted when the socket closes.

## Client Flow

`GameNetwork` stores the last complete snapshot it delivered. When a full snapshot arrives, it becomes the baseline. When a delta arrives, the network layer applies it to the baseline and delivers the reconstructed full `WorldSnapshot`.

The callback receives packet metadata: actual byte length and packet kind (`full` or `delta`). `GameCanvas` uses the actual packet byte length instead of the current rough size estimate, and `DebugOverlay` displays whether the latest packet was full or delta.

## Error Handling

If a delta arrives before the client has a baseline, the client ignores it. The server sends a full snapshot first for every socket, so this path is a guard against reconnect races or malformed streams.

Periodic full snapshots cap long-lived drift risk and make protocol changes easier to deploy.

## Testing

Shared protocol tests must prove:

- delta snapshots reconstruct the next full snapshot from a baseline
- entity removals are applied correctly
- streak removals are applied correctly
- unchanged snapshots produce a smaller delta than a full snapshot

Server tests must prove:

- the first packet for a socket can be a full snapshot
- after a baseline exists, a changed world state can be encoded as a delta

Client/network tests are not currently set up in the repo, so the client side is verified through TypeScript build and E2E smoke coverage.

## Scope

This version does not implement bit-level field masks, client requests for resync, compression libraries, adaptive resync intervals, or lag compensation. Those are future optimizations after the baseline delta architecture is green.
