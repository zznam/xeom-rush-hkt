# Private room operations

Cloudflare and AWS provisioning remain manual. Merging this release does not create cloud resources, upgrade a plan, or make an unconfigured room service live. The default public city remains playable when room availability checks fail; private modes appear only after the configured owner and career checkpoint endpoint are healthy.

## Shared behavior

Each owner runs the portable simulation at 20Hz only while a round has connected participants. Private rooms accept eight humans, last five minutes, transfer host when the host disconnects, keep thirty seconds of same-owner reconnect grace, support results/rematches, and expire after ten empty minutes. Competitive bots fill slots before a round. A replacement owner explicitly interrupts the round; it never pretends to resume missing positions. Career checkpoints use stable per-round contribution IDs, so retries and retained contributions cannot duplicate rewards. Round scores reset separately from saved career totals.

Simulation state is not written to career databases every tick. Checkpoints occur every thirty seconds and on lifecycle changes. Successfully retained checkpoints survive owner replacement; an abrupt crash can lose work since the last successful checkpoint. Database outages retain a delivery queue on Cloudflare and retry from alarms; the room stops advertising healthy availability when the career endpoint is unavailable.

## Default site: Cloudflare and Deno

The worker manifest is `apps/room-service/wrangler.jsonc`. It binds one SQLite-backed Durable Object per opaque invitation. WebSockets use the [Durable Object hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/); round timers stop in lobbies, results, and disconnected rooms. A durable outbox is saved before authenticated delivery to Deno.

Configure these manually:

- Worker `GUEST_SECRET`: the same guest signer used by Deno. Preserve the existing durable `career-v2/identity-key` when enabling rooms for an existing site; changing the signer invalidates existing credentials.
- Deno `GUEST_SECRET`: that same existing signer, or an initial high-entropy secret for a new site.
- Worker and Deno `ROOM_CHECKPOINT_SECRET`: a separate high-entropy secret of at least 32 characters. Keep it out of client bundles and repository files.
- Worker `CAREER_API_URL`: the Deno origin. Worker `ALLOWED_ORIGINS`: trusted frontend origins, comma-separated.
- Deno `ROOM_SERVICE_URL`: the deployed Worker origin. The Deno capability check verifies guest-signature compatibility and the authenticated career health endpoint before advertising rooms.
- Keep Worker `TEST_MODE=false` and omit Node `ALLOW_ROOM_TESTS` in production.

Review the account and limits, then deploy manually with `bun run --filter @xeom-rush/room-service build` and Wrangler. Set secrets using protected operator tooling. Apply the manifest's SQLite class migration. Verify `/api/rooms/capabilities` from the Deno route, then complete an invite, round, rematch, disconnect, and checkpoint round trip on the configured service.

[Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) currently lists Free allocations of 100,000 Durable Object requests/day, 13,000 GB-s/day, 5 million SQLite row reads/day, 100,000 row writes/day, and 5GB storage. Incoming WebSocket messages count at a 20:1 ratio for compute billing; outgoing messages are excluded. Eight clients sending sixty inputs/second use about 7,200 billed incoming-message requests per five-minute round, before other requests. Treat roughly thirteen fully occupied rounds/day as a request-budget illustration, not guaranteed capacity. Active timers consume duration; idle hibernation reduces it. Watch quotas, errors, queue age, and stored data; do not automatically upgrade. Quota or health failures hide room entry, keep public-city play available, and preserve pending checkpoints for retry.

## AWS: explicitly routed ECS owners

Set Terraform `private_rooms_enabled=true` only when ready, and review `max_private_rooms` (default four per existing city owner). Apply infrastructure manually using the established AWS workflow. Invitations contain `/rooms/<owner>/private/<invite>/ws`, so all friends reach the same singleton ECS owner. Room metadata and career contributions use the existing DynamoDB adapter; thirty-second career writes remain idempotent. A recovered owner loads room metadata, ends an interrupted round, and retains already written contributions. The existing region guest signer also authenticates private-room admission.

The Terraform template now omits a fixed `BOT_COUNT`, letting public cities target eight total drivers. Explicit `BOT_COUNT` remains a local/load-test override. Test combined public and private load before raising either room capacity or private-owner limits. Confirm ALB path routing, origin allowlists, guest secret, DynamoDB access, health checks, and singleton replacement settings from [AWS deployment operations](aws-deployment.md).

## Local verification and rollback

Build shared/core/server/client, then dry-run the worker build. `bun run --filter @xeom-rush/room-service test` exercises invitation, round, host transfer, reconnect, results, rematch, and owner restart through the Node adapter and actual Miniflare runtime. Local fixtures require explicit test flags and are unavailable in production.

To disable default-site rooms, remove Deno `ROOM_SERVICE_URL`; to disable AWS rooms, set `private_rooms_enabled=false` and apply manually. Preserve guest signers, career tables/KV, and the worker's durable queue during rollback. Let pending checkpoints drain before removing a room service. Public cities continue through their existing Vercel/Deno or AWS route. Rolling back gameplay can use `CONTENT_RELEASE=false`; do not delete saved profiles to roll back UI.
