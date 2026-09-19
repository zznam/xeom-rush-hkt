# Vercel and Deno deployment

The Railway trial expired on the account. Deno Deploy replaces the backend for the free-tier release; Vercel continues serving the static client. The Railway MongoDB volume must remain intact for a possible later export.

## Deno app

Production backend: `https://xeom-rush.zznam.deno.net`.

Use the existing `zznam` organization and the `zznam/xeom-rush-hkt` GitHub repository, production branch `main`.

- App directory: repository root.
- Preset: none; dynamic runtime.
- Install: `pnpm install --frozen-lockfile` (Deno provides pnpm; Corepack is not installed).
- Build: `pnpm build:server`.
- Entrypoint: `deploy/deno-entry.ts`.
- Working directory: repository root.
- Free deployment regions; no paid region upgrade.
- Assign a managed Deno KV database to the app before considering it healthy.
- `ALLOWED_ORIGINS=https://xeom-rush.vercel.app` (default); add explicit trusted preview origins only when needed.
- `BOT_COUNT=8` by default; supported range 0–20.
- Do not set `DENO_KV_PATH` in production: the platform supplies the assigned database.

The entrypoint enforces production mode. `deno.json` enables KV and records the tested build/runtime configuration; explicit CommonJS package types let Deno run the same compiled authoritative server as Node. Demo mutation endpoints are unavailable in production.

## Vercel

Keep the existing repository-root build/output configuration. Set production `VITE_WS_URL` to the deployed Deno app's `wss://` URL, then rebuild the frontend. A previously built Vite bundle retains its old URL until rebuilt.

## Validation and rollback

1. Run `pnpm test`, `pnpm build:client`, and `pnpm build:server`.
2. Run `deno test --no-check --allow-read --allow-write --allow-env --allow-sys --unstable-kv tests/deno-kv.test.ts`. Application types are checked in the preceding TypeScript build; this command verifies the native KV runtime behavior.
3. Run `pnpm test:e2e` using its isolated local ports and memory-only test database target.
4. Check production `/api/health` returns `status: ok` and `database: connected`.
5. Join with two browsers, verify movement and snapshots, complete a delivery, end the ride, and check saved scores. Check short reconnects and production admin endpoint denial.
6. Compare deployed Git revisions, review Deno logs, and check free-tier usage.

Use the prior successful Deno revision and prior Vercel deployment for rollback; keep the client/backend protocol pair compatible. The first migration has no working Railway rollback while the trial is expired.

## Limits and references

Deno can evict or scale out instances. An active socket's traffic keeps its instance alive, but live game state is not durable or shared across instances. The client retries for up to 25 seconds; the server retains disconnected drivers for 30 seconds on that instance. KV checkpoints protect career totals, not the live city or passenger position. Name-based career ownership is legacy behavior, scheduled for replacement by stable guest identity in release 2.

- [Deno runtime and WebSocket lifecycle](https://docs.deno.com/deploy/reference/runtime/)
- [Managed Deno KV](https://docs.deno.com/deploy/reference/deno_kv/)
- [Deno free-tier limits](https://deno.com/deploy/pricing)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
