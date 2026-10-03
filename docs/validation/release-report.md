# Complete release verification

The [32-item acceptance checklist](../feature-acceptance.md) maps every feature to implemented gameplay, authored content and its verification. Twelve feature worktrees and one integration worktree were assembled before merging. Public play supports the default Vercel/Deno route and routed AWS owners; private and team modes require a configured, healthy room service.

## Combined correctness

The frozen integration tree matches complete-release commit `174112600c52842b5894507b6dd6a0a184f83636`. [Combined CI run 37135089713](https://github.com/zznam/xeom-rush-hkt/actions/runs/37135089713) passed its ordinary suite: 39 shared tests, 27 portable simulation tests, 60 server tests, four native Deno KV tests, actual Miniflare/DynamoDB owner journeys, legacy/regional smoke, builds, lint/format, Deno-only deployment build, Docker startup and Terraform validation/tests. Browser coverage comprises 23 public journeys, three regional journeys, ten private/team journeys and one compatibility rollback journey. Pickup fixtures finish any automatically collected trip through the authoritative simulation before selecting their authored test job; the exact protocol-label assertion avoids matching driver names.

Private runtime checks use both real adapters, durable checkpoint failure/retry and owner replacement. Separate-browser journeys cover invite, competitive/co-op/relay play, rematches, host transfer and emotes. Thirty-second reconnect-grace scenarios verify relay reassignment and termination when no eligible teammate remains. Six layouts cover desktop, tablet, breakpoint, phone, small phone and touch landscape, including dialog focus, control bounds, overlap and cancellation.

Authored content includes four connected districts, twelve landmarks, six passenger archetypes with 72 distinct Vietnamese lines, passenger/food/parcel jobs with ordered stops, six demand events, twelve daily templates, eight weekly contracts, twelve mastery badges and 28 cosmetic choices. Career tests cover authenticated identity, transactional retries, period boundaries, claims, component totals, records and rankings.

## Capacity and baseline

The deterministic sample uses seed 42, 7,200 simulated ticks, 64 humans and eight bots, with full snapshot encoding for all humans. The enhanced release also sends its gameplay metadata. The baseline is original remote main `2c41af5997de7a8c268492be6b9777a1a6e4b673`.

| Measurement                                      | Baseline | Enhanced release |
| ------------------------------------------------ | -------: | ---------------: |
| Simulation and encoding p95                      |  3.645ms |          4.198ms |
| Mean work per tick                               |  2.531ms |          2.921ms |
| Full snapshot/control bytes per human per second |   23,012 |           27,523 |
| Process RSS at sample end                        | 118.5MiB |         178.7MiB |
| JavaScript heap used at sample end               |  11.8MiB |          26.8MiB |

Raw evidence: [baseline simulation](baseline-performance.json), [enhanced simulation](release-performance.json), [baseline browser sample](baseline-browser.json). Full snapshots in this deterministic comparison differ from the live adapter's full/delta and control traffic. Memory figures are end-of-sample observations, not reserved capacity or leak proof.

The [full-capacity report](release-soak.json) passes all acceptance assertions: 1,800,288ms elapsed, sixty uninterrupted samples, 5,403 deliveries, 49 rounds, zero errors and maximum cumulative p95 of 34.1ms across every measured owner. Final Node public p95 is 33.6ms, Deno public 10.5ms, ECS private rooms 4.0–4.8ms and Durable Objects 4ms. Every simulation sustained at least 18Hz, including round transitions. The previous [full run](https://github.com/zznam/xeom-rush-hkt/actions/runs/37132137585) completed 5,419 deliveries and 49 rounds with no errors, but was rejected because Node public p95 reached 40.8ms. Snapshot encoding now reuses at most 2,048 UTF-8 records and compares explicit binary fields. The [dense 64-peer delta comparison](protocol-performance.json) preserves identical bytes and reduces work from approximately 8.6ms to 1.2ms; the strict sub-40ms live gate is unchanged. Its load is 74 public humans and 16 public bots, plus seven private/team rooms with 52 humans and four filler bots. All four configured ECS room slots and three Durable Objects run together. Two real renderers use desktop 1440×900 and phone 390×844. The gate requires uninterrupted measurement, natural rain/night/closures/all six demand events, all three job kinds, repeated five-minute rounds, no runtime/browser errors, sustained public and private ticks and every measured owner p95 below 40ms.

The hosted release's desktop renderer measured 13.23fps median / 9.60fps p05; phone measured 35.41fps median / 25.71fps p05. This dense synthetic run has modest desktop rendering throughput despite meeting the server gate. Desktop observed heap rises from 14.3MB to 44.7MB; phone from 15.2MB to 35.1MB. End-of-run Node RSS is 284.3MiB and Deno RSS 180.2MiB. Live raw-peer traffic averages 34,941 bytes/second, including private-room metadata. These observations are retained rather than treated as proof of a rendering speedup or a memory-leak check.

The baseline browser run lasts sixty seconds on the shared macOS host; the full release run uses an isolated hosted Linux runner. FPS, heap and live bandwidth remain useful recorded observations, but their hardware, duration, driver activity and room populations differ. They do not establish a causal rendering speedup or like-for-like bandwidth reduction.

## Deployment and recovery

Cloudflare and AWS provisioning remains manual. Local/hosted emulation verifies adapters, not live cloud availability. Default public deployment health and browser play must be checked after final main merges. Vercel exhausted its deployment budget during verification; the READY complete-release preview is retained for an attempted production promotion after source/configuration equivalence checks. No account upgrade is authorized or performed. Private/team launchers remain hidden until their backend advertises healthy supported capabilities. Preserve guest signing keys, career stores and durable pending contributions during rollback; `CONTENT_RELEASE=false` has a separate real-browser compatibility check.

See [release operations](../complete-release-operations.md) and [private-room operations](../private-room-operations.md) for configuration, secret requirements, health checks, Free-plan capacity illustrations, failure handling and rollback.
