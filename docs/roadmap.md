# Xe Ôm Rush: casual-play roadmap

The audience is casual players on phones and desktop, with a Vietnamese city identity. Ship a playable release after each stage; keep the authoritative simulation and existing binary delta protocol. This roadmap contains proposals, not a claim that every feature is implemented.

## Release 1: a friendly, playable city

| Priority | Feature                            | Delivery and acceptance                                                                                                                                                                      |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 1. One-click play                  | Remember the nickname; hide developer server settings in production; show clear joining and failure states. Implemented.                                                                     |
| P1       | 2. First-delivery guidance         | In-game pickup/drop-off instructions and remembered tutorial completion. Implemented starter; a reserved practice passenger is a later refinement.                                           |
| P0       | 4. Reconnect                       | Bounded automatic retries; preserve the driver for 30 seconds on the same instance; clear stale input and subscriptions. Explain a new ride after server replacement. Implemented.           |
| P0       | 5. Mobile control reliability      | Track the active finger; handle touch cancellation, lost focus, and visibility changes; separate controls from the toolbar. Implemented.                                                     |
| P1       | 6. Fair penalties and spawn safety | Cap pedestrian fines at 5,000đ, keep the stun and combo reset, validate normal spawn positions, and spread passenger pickups. Implemented.                                                   |
| P1       | 7. Comfort settings                | Persist sound and reduced motion preferences; avoid reconnecting when changing settings. Implemented. Adaptive quality remains a later enhancement.                                          |
| P1       | 9. Session results                 | Explicit end-ride action, earnings/delivery summary, and return to a remembered-name lobby. Implemented.                                                                                     |
| P0       | 15. Public-server protections      | Disable demo mutation endpoints in production; bound packets, connections, input queues, and send buffers; validate finite inputs and names; health includes storage readiness. Implemented. |
| P1       | 16. Cartoon art and game feedback  | Generated Saigon lobby illustration, transparent scooter and passenger sprites, colorful city blocks, pickup bobbing, delivery confetti, and reward toasts. Implemented.                     |

Release gate: build, unit tests, desktop/mobile browser flows, Deno storage tests, and live WebSocket health/resume checks. Inspect the actual lobby and gameplay before release.

## Release 2: better trips and trustworthy progress

| Priority | Feature                      | Implementation and acceptance                                                                                                                                                                                                                                                                         |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | 3. Road-following navigation | Share collision-aware street pathfinding between bots and player navigation. Render waypoints and a destination arrow; recompute only when the destination or road segment changes. A route must avoid buildings and roundabout centers.                                                              |
| P1       | 8. Useful trip cards         | Show tier, base fare, expected combo-adjusted payout, destination distance, and pickup expiry. Preserve automatic pickup; clearly distinguish pickup expiry from delivery timing. Drive all clocks from server ticks, including rush-hour time remaining.                                             |
| P0       | 10. Stable guest identity    | Server-issue a random browser-bound credential; persist profiles by player ID, never display name. No mandatory sign-in. Treat old name-based records as archived legacy scores rather than awarding them to anyone typing that name. Account login and cross-device recovery are outside this stage. |
| P1       | 11. Correct leaderboards     | Separate nearby drivers, current-city ranking, and saved careers. Publish a bounded top-ten ranking independently of spatial snapshots. Add the current player's rank and delivery total. Never present nearby-only data as the whole city.                                                           |

Interfaces: extend the join/config handshake for guest authentication, versioned metadata, and authoritative trip timing. Extend the persistence adapter for ID-based profiles and indexed rankings; update full and delta encoders together. Keep old records intact during an additive migration. Test duplicate names, invalid credentials, database retries, route obstructions, and late event joins.

## Release 3: reasons to return and play together

| Priority | Feature                              | Implementation and acceptance                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | 12. Daily challenges and cosmetics   | Three server-verified objectives: five deliveries, a three-delivery streak, and 20,000đ earned. Reset at midnight Asia/Ho_Chi_Minh. Reward cosmetic stamps and unlock three scooter palettes at 3, 10, and 25 completed daily objectives. No paid advantage. Claims must be idempotent. |
| P1       | 13. Friend invites and private rooms | Keep the public city open-ended. Private rooms have a shareable opaque invite, up to eight human players, five-minute rounds, a results screen, and rematch. Expire empty rooms after ten minutes. Player progress persists separately from room scores.                                |
| P1       | 14. Adaptive bot population          | Release 1 starts with eight bots, configured and capped at twenty. Later, target eight total drivers in public cities and retire excess bots after their current delivery when humans join. Private rooms default to zero bots; the host may fill empty places before a round.          |

Room infrastructure is a prerequisite for friend rooms: Deno free regions can run separate instances, so an in-memory room map alone cannot guarantee friends meet. Introduce an authoritative room owner and routing/coordination before advertising room links. Do not write the 20 Hz simulation to KV or claim that global storage synchronizes live cities. Verify cross-instance joins and owner recovery before shipping this stage.

## Hosting and operational defaults

- Frontend: existing Vercel project and production domain. Backend: Deno Deploy with managed Deno KV, replacing the expired Railway trial at the user's request.
- Deno KV stores career profiles, indexed leaderboard entries, and idempotent session contributions. Checkpoint every 30 seconds and flush on explicit exit or graceful shutdown. An abrupt crash can lose progress since the last checkpoint.
- Live city state remains instance-local. Reconnection preserves a ride only while its original instance survives; saved careers are shared by the production KV timeline.
- Existing Railway MongoDB volume is preserved. No historical data import is claimed while that database is inaccessible.
- Maintain Node/Mongo compatibility for local development and future hosting flexibility.
- Validate free-tier limits before expanding. The Deno dashboard currently restricts this free organization to its free regions; there is no assumed single-instance guarantee.
- Guest-first identity and open city plus timed private rooms are roadmap defaults, because the optional preference questions were not answered.
