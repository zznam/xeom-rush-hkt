# Binary Delta Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add binary delta snapshots with per-client baselines so Xe Om Rush sends compact per-tick updates while preserving complete `WorldSnapshot` consumers.

**Architecture:** Keep full snapshots as baselines. Add a `DELTA_SNAPSHOT` protocol message that carries complete changed entity records plus removed IDs, then reconstruct complete snapshots in the client network layer before gameplay code sees them.

**Tech Stack:** TypeScript, Vitest, Node `ws`, Vite React client, existing `@xeom-rush/shared` package.

---

## File Structure

- Modify `packages/shared/src/types.ts` to add `EMessageType.DELTA_SNAPSHOT` and packet metadata types.
- Modify `packages/shared/src/protocol.ts` to add delta encode/decode helpers and reusable entity serialization helpers.
- Modify `packages/shared/src/protocol.test.ts` with failing delta protocol tests before implementation.
- Modify `apps/server/src/index.ts` to keep per-socket baselines and send full snapshots periodically.
- Modify `apps/client/src/game/network.ts` to reconstruct deltas and surface packet metadata.
- Modify `apps/client/src/components/GameCanvas.tsx` to use actual packet bytes and packet kind.
- Modify `apps/client/src/components/DebugOverlay.tsx` to display full/delta packet mode.
- Modify `README.md` to document delta snapshots in the engineering-depth section.

## Tasks

### Task 1: Shared Protocol Delta Round Trip

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/protocol.ts`
- Test: `packages/shared/src/protocol.test.ts`

- [x] Write failing tests for `encodeDeltaSnapshot` and `decodeDeltaSnapshot`.
- [x] Run `pnpm --filter shared test -- protocol.test.ts` and confirm the new tests fail because the functions do not exist.
- [x] Add `EMessageType.DELTA_SNAPSHOT = 6`.
- [x] Implement delta encoding with changed records and removed ID lists.
- [x] Implement delta decoding that applies changes/removals to a baseline and returns a complete `WorldSnapshot`.
- [x] Run `pnpm --filter shared test -- protocol.test.ts` and confirm the tests pass.

### Task 2: Server Per-Socket Baselines

**Files:**

- Modify: `apps/server/src/index.ts`

- [x] Add a `lastSnapshot` and `lastFullSnapshotTick` to `PlayerSocket`.
- [x] Send a full snapshot when no baseline exists or the resync interval has elapsed.
- [x] Send a delta snapshot otherwise.
- [x] Update the baseline after each successful send.
- [x] Run `pnpm --filter server test` after building shared package.

### Task 3: Client Delta Reconstruction and Telemetry

**Files:**

- Modify: `apps/client/src/game/network.ts`
- Modify: `apps/client/src/components/GameCanvas.tsx`
- Modify: `apps/client/src/components/DebugOverlay.tsx`

- [x] Store the last complete snapshot in `GameNetwork`.
- [x] Decode full snapshots into the baseline.
- [x] Decode delta snapshots against the baseline and deliver complete snapshots.
- [x] Pass callback metadata `{ bytes, kind }`.
- [x] Display actual packet bytes and latest packet kind in the debug overlay.
- [x] Run `pnpm build:client`.

### Task 4: Documentation and Full Verification

**Files:**

- Modify: `README.md`

- [x] Update the Binary Wire Protocol section with delta snapshot behavior.
- [x] Run `pnpm test`.
- [x] Run `pnpm build:server`.
- [x] Run `pnpm build:client`.
- [x] Run `pnpm test:e2e` if browsers/dependencies are available.
