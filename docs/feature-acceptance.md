# Complete city release acceptance

All 32 features have implemented gameplay and the authored content below. Combined unit, persistence, runtime and browser journeys pass. The final continuous thirty-minute soak remains pending; its evidence will be recorded before any release PR merges. Cloudflare/AWS publication remains a separate manual operation.

See [release operations](complete-release-operations.md) for test commands and deployment requirements. Evidence paths refer to repository files; browser suites are in `apps/e2e/tests/`.

| ID  | Feature                 | Gameplay and authored content                                                              | Verification evidence                                                                    |
| --- | ----------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | Street GPS              | Shared obstacle-aware street routes; deviation and closure replanning                      | `packages/shared/src/navigation.test.ts`; trip and relay browser journeys                |
| 2   | Fare cards              | Quoted base, combo, environment, clean bonus and optional tip use server calculation       | `packages/game-core/src/trips.test.ts`; combined fare journey                            |
| 3   | Combo countdown         | Server combo expiry and visible remaining timer                                            | `packages/shared/src/protocol.test.ts`; public HUD/browser checks                        |
| 4   | Clean-driving bonus     | 10% bonus; delivery-tick violations disqualify                                             | `packages/game-core/src/trips.test.ts`; clean fare journey                               |
| 5   | Passenger personalities | Six archetypes with twelve distinct Vietnamese lines each                                  | `packages/shared/src/jobs.test.ts`; passenger-story browser assertions                   |
| 6   | Food and parcel jobs    | Food freshness, parcel damage, two/three ordered stops; base fare retained                 | Shared/core job tests; browser completes food and both parcel lengths                    |
| 7   | Pickup selection        | Automatic pickup by default; one selected target until cleared or unavailable              | `packages/game-core/src/trips.test.ts`; combined pickup journey                          |
| 8   | Arrival feedback        | Trip toast, completion sound, ordered-stop feedback                                        | Combined delivery/results journey; browser error checks                                  |
| 9   | Distinct districts      | Four authored connected street layouts                                                     | `packages/shared/src/atlas.test.ts`; clearance/connectivity reference tests              |
| 10  | Named landmarks         | Twelve named landmarks with district stories                                               | Atlas reachability tests; ordered landmark relay journey                                 |
| 11  | Day/night               | Twelve-minute city cycle retained across room rematches                                    | Shared city-life and room clock tests; natural-cycle soak                                |
| 12  | Rain                    | Ninety-second events; shared acceleration and turning modifiers                            | `packages/game-core/src/weather-prediction.test.ts`; natural-cycle soak                  |
| 13  | Roadworks               | Advance announcements, reachability and occupant safety guards                             | `packages/game-core/src/city-life.test.ts`; closure navigation tests and soak            |
| 14  | Demand events           | Six authored rotating market/festival events; highest boost wins                           | Shared city-life/fare tests; all six rotations in soak                                   |
| 15  | Ambient audio           | Procedural district, river and rain soundscapes; saved mute option                         | Live sound-toggle browser check; sound engine/client build and error checks              |
| 16  | Discovery passport      | Twelve landmark discoveries saved to authenticated careers                                 | Atlas tests; career merge/persistence tests and browser profile checks                   |
| 17  | Stable driver careers   | Guest identity, retry-safe KV/Mongo/Dynamo contributions; historical names separate        | Native KV, Mongo replica-set, routed Dynamo concurrency/retry tests; browser reload      |
| 18  | Daily objectives        | Twelve templates; Vietnam-midnight reset and atomic claims                                 | Progression/reset tests; real gameplay objective claim and reload journey                |
| 19  | Cosmetics               | Twelve scooter palettes, six helmets, six jackets, four horns; no advantage                | Catalog and persistence tests; cosmetic equip/reload journey                             |
| 20  | Mastery badges          | Twelve earned badges driven by career statistics                                           | Progression catalog tests; bounded career progression/persistence checks                 |
| 21  | Personal bests          | Best fare/streak, component totals and eight recent trip records                           | Career retry/migration tests; browser recent-record and clean-best assertions            |
| 22  | Weekly contracts        | Eight templates; Monday midnight reset and retry-safe claims                               | Progression boundary tests; common atomic claim tests across persistence adapters        |
| 23  | Shift results           | Detailed fares, bonuses, tips, fines, distance and delivery totals                         | Combined session-finish/results browser journey; career tests                            |
| 24  | City/career rankings    | Bounded top-ten rankings independent of nearby snapshots                                   | Career ranking tests; routed Dynamo ranking/runtime and public browser checks            |
| 25  | Private rooms           | Eight humans, opaque invites, five-minute rounds, host transfer, grace, results/rematches  | Both adapter browser journeys; actual Miniflare/Dynamo lifecycle and durable retry tests |
| 26  | Co-op dispatch          | Two-human minimum, reserved jobs, fixed 20,000đ target per starting human                  | Portable team tests; separate-browser co-op through both owners; soak                    |
| 27  | Delivery relay          | Two teams of two-four humans; four ordered legs and proximity handoffs                     | Team rules; both adapter relay journeys; actual thirty-second disconnect recovery        |
| 28  | Quick emotes            | Six fixed emotes; three-second server cooldown and bounded visibility                      | Team cooldown tests; both adapter browser emote checks                                   |
| 29  | Adaptive bots           | Public target eight drivers; retiring carriers finish delivery first                       | `packages/game-core/src/practice.test.ts`; seeded legacy bot tests; combined soak        |
| 30  | Protected practice      | Player-reserved introductory trip with competitive rewards suppressed                      | Practice reservation/reward tests; real browser pickup and arrival                       |
| 31  | Custom controls         | Saved bindings, handedness, joystick size/position/sensitivity, text, sound and motion     | Saved-settings/no-reconnect browser checks; focus and touch-cancellation checks          |
| 32  | Performance/readability | Adaptive decorative quality, persistent GPS, distinct passenger/job symbols, 44px controls | Six-viewport public/co-op bounds/overlap checks; baseline comparison and combined soak   |
