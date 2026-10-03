# Complete city release operations

The release adds all 32 items in [the acceptance checklist](feature-acceptance.md). The public city is guest-first and Vietnamese-first. Account recovery, paid advantages, and cross-deployment career sharing are outside this release.

## Activation and deployments

The shared simulation runs at 20Hz in Node, Deno and Cloudflare adapters. `CONTENT_RELEASE=false` disables the new public trip and living-city mechanics as a compatibility rollback; normal public cities enable them. Optional private/team launchers require a healthy room capability response. A missing or unhealthy room service leaves public play available and hides unsupported modes.

The existing Vercel and Deno hooks publish merged `main`. AWS and Cloudflare remain manual: use [AWS deployment](aws-deployment.md), [Deno deployment](deno-deployment.md) and [private room operations](private-room-operations.md) for configuration, secrets, health checks, owner routing, failure behavior and rollback. Local runtime tests do not establish that those cloud resources exist or are healthy. Do not provision paid resources or upgrade the Cloudflare plan automatically.

Preserve authenticated guest signing keys and existing career storage across deployment and rollback. Default careers use Deno KV; AWS uses DynamoDB. Mongo installations need a replica set for transactional career writes. Historical nickname-based records remain separate. Public sessions checkpoint every 30 seconds and on explicit finish; private owner state and retry queues persist before career delivery. No career database is written on every simulation tick.

Profiles accumulate fare components, violations, distance, clean trips, personal bests, bounded recent trips and progression. Daily objectives reset at 00:00 Asia/Ho_Chi_Minh; weekly contracts reset Monday at 00:00. Career session contributions and claims are idempotent. Cosmetics provide no gameplay advantage.

## Combined validation

Install with `bun install --frozen-lockfile`, then build shared/core/server/client and the Cloudflare dry-run bundle before browser or runtime testing. The CI workflow runs on dependency-targeted PRs as well as `main`. It covers formatting, lint, shared/core/server tests, native Deno KV, legacy/regional smoke, actual Miniflare and routed DynamoDB owners, browser journeys, production containers and Terraform validation/tests.

The combined browser journey completes protected practice, passenger and food jobs, two- and three-stop parcels, clean fares, a real objective claim, cosmetic equip, career reload and shift results. Room journeys use separate browser identities for invites, competitive rounds, co-op, relay, emotes, rematches, host transfer and owner replacement. Public and co-op HUDs are checked at desktop, tablet, breakpoint, phone, small phone and touch-landscape sizes, including 44px controls, bounds, overlap, focus and touch cancellation.

`bun run test:soak` runs a real 30-minute wall-clock load against a routed Node owner with local DynamoDB, a Deno KV public/career service, and Miniflare Durable Objects. It starts 64 routed public humans plus eight configured load bots, eight default public humans plus two real browser renderers and eight bots, and six private rooms across competitive/co-op/relay with 24 humans and eight filler bots. `TEST_DYNAMO_URL` selects an already-running local DynamoDB (default port 8800). The script creates and deletes its own table, temporary KV and servers; it never provisions cloud resources.

The soak records bounded tick histograms (0.1ms quantiles), bandwidth, server memory and desktop/phone frame-rate and browser-heap samples. It exercises natural weather, closures, jobs, demand rotations and five-minute rematches. Each public/private owner must keep p95 tick work below 40ms. CI uses a ten-second load smoke; it is not a substitute for the full manual integration soak. The separate deterministic sample measures identical 64-human/eight-bot workloads on baseline and release, including full snapshot encoding.

Local fixtures require development mode and explicit `ALLOW_GAME_TESTS` / `ALLOW_ROOM_TESTS` or Cloudflare `TEST_MODE`. They seed authored jobs, positioning and simulation timing, while real simulation completion and career persistence still calculate rewards. Production entrypoints block these mutation endpoints and local metrics.

## Merge and recovery

Keep feature branches in dependency order and assemble their tips in `codex/release-integration`. Pass the complete combined suite and full soak before any merge. Retarget each PR to current `main`, rebase and validate its resulting head, wait for required CI, then merge. Repeat affected checks after conflict resolution. Verify final `main`, public deployment health and browser play after the last merge.

For release incidents, retain career storage and signing keys, hide an unhealthy room adapter, and roll back the application revision. Owner replacement explicitly interrupts an in-flight round; same-owner reconnect has 30 seconds of grace. Durable queued career contributions survive retries and cannot award a round twice. A rematch creates a fresh simulation and clears client prediction/input state even when the rider ID remains unchanged.
