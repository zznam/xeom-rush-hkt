# Driver tools and end-to-end verification

## Improvement choices

The game already includes practice, authored delivery jobs, careers, objectives,
cosmetics, private rooms, and city administration. This iteration improves three
existing workflows: configuring controls, choosing the next job, and reviewing a
completed shift. These additions require no account, server migration, or paid
service.

| #   | Feature                                 | Where to find it       | Acceptance evidence                                                                                                        |
| --- | --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Control presets: WASD, arrows, and IJKL | Tùy chỉnh              | Select a preset, drive with it, reload, and verify it persists.                                                            |
| 2   | Conflict-aware key remapping            | Tùy chỉnh              | Duplicate bindings and arrows assigned to the wrong direction are rejected with a useful message.                          |
| 3   | Settings backup and restore             | Tùy chỉnh              | Download JSON, restore it, reject malformed or unsupported backups without partial changes.                                |
| 4   | Restore default settings                | Tùy chỉnh              | Explicit reset/cancel controls restore defaults, including the system motion preference.                                   |
| 5   | Job-kind filter                         | Chọn khách             | Filter passenger, food, and parcel offers, with an empty-state explanation.                                                |
| 6   | Passenger-tier filter                   | Chọn khách             | Filter regular, business, and VIP offers; combine with job-kind filters and clear them.                                    |
| 7   | Offer sorting                           | Chọn khách             | Sort authoritative offers by distance, total quoted fare, or remaining pickup time. Undated offers sort last for expiry.   |
| 8   | Personal shift goal                     | Hồ sơ → Mục tiêu ca xe | Choose earnings, deliveries, safe trips, or distance; observe live progress and retain the target across shifts.           |
| 9   | Local shift journal                     | Hồ sơ → Nhật ký ca xe  | Ending a shift stores its summary; reload preserves it; clearing the journal requires an explicit confirmation.            |
| 10  | Personal-best comparison                | Kết thúc               | Compare the completed shift against retained shifts in the same mode; show first-shift guidance when no comparison exists. |

Goals, history, and comparisons are browser-local conveniences. They do not award
server rewards. History retains the latest 30 explicitly ended shifts; closing a
tab or losing a connection does not create a completed record. Comparisons use
that retained history, grouped as public city, sandbox, or friends. Clearing the
journal does not change server career totals. Denied storage produces a visible
error for goals and journal saves.

## Bugs corrected during verification

- Malformed stored controls, including valid JSON `null`, no longer crash joining.
- Editing an incomplete development server address no longer crashes the lobby's
  room-capability lookup.
- Passenger cards use current server offers instead of a separate nearest-eight
  list that could show unavailable prices.
- Closing dialogs returns keyboard focus to the opener, and opening a dialog
  clears held steering.
- Server-ended shifts use the final validated summary for results, goals, and
  history instead of potentially stale periodic metadata.
- Results remain scrollable on small screens, including the new comparison panel.
- The admin test suite keeps its own artifact directory; running it no longer
  erases other suites' evidence. Pickup tests stop steering at the observed pickup
  instead of issuing a second read after a short trip may already have finished.

## Browser coverage

Verified on 2026-11-03 with retries disabled: **70/70 browser tests passed**,
with zero skipped, flaky, or failed cases.

| Suite                        | Passed |
| ---------------------------- | -----: |
| Public play and driver tools |     48 |
| Regional matchmaking         |      5 |
| Administration               |      6 |
| Private rooms and team play  |     10 |
| Content rollback             |      1 |

Machine-readable evidence is in `apps/e2e/test-results/reports/` and
`apps/e2e/test-results/e2e-summary.json` (generated, ignored files).
The shared, game-core, and server suites also passed all 170 unit/integration
tests; legacy and regional client production builds passed.

The public suite covers joining, practice, real movement, pickup and delivery,
multi-stop jobs, fare feedback, daily claims, cosmetics, saved careers, reconnects,
mobile controls, dialogs, and the ten driver tools. New regression files are:

- `apps/e2e/tests/settings-features.test.ts`
- `apps/e2e/tests/dispatch-features.test.ts`
- `apps/e2e/tests/shift-notebook.test.ts`
- `apps/e2e/tests/resilience.test.ts`
- `apps/e2e/tests/final-summary.test.ts`

Final-summary tests retain the real server handshake and gameplay stream, then
inject only the terminal result and close packets. They verify that final server
statistics take precedence, while older or malformed optional summaries retain
the last valid gameplay data. They do not simulate an actual administrator reset.

Separate configurations exercise regional matchmaking, room ownership and team
play, content rollback, and the admin controller/worker workflow. Tests use local
services and Chromium. Game fixtures are gated by `ALLOW_GAME_TESTS=true`, rejected
in production, and still use authoritative simulation ticks for trip completion.

To prepare and run every browser suite:

```sh
bun install --frozen-lockfile
bun run --filter e2e install:browsers
bun run test:e2e:all
```

When multiple projects install different Playwright browsers on the same machine,
use an isolated cache for both installation and execution. The verified run used:

```sh
export PLAYWRIGHT_BROWSERS_PATH=/tmp/xeom-playwright-browsers
bun run --filter e2e install:browsers
E2E_SERVER_PORT=3206 E2E_CLIENT_PORT=5276 bun run test:e2e:all --skip-build --retries=0
```

`--skip-build` requires previously built server, admin, and room-service artifacts.
Omit it for a fresh checkout. Tests retain action/network/DOM failure traces and
failure screenshots; continuous canvas screencasts are disabled to reduce overhead.

For non-browser regression checks:

```sh
bun run test
bun run build:client:legacy
VITE_REGIONS_JSON='[{"id":"sg","label":"Singapore","apiUrl":"https://sg.example.com"}]' bun run build:client:regional
```

Local browser checks do not prove live deployment configuration, external OAuth
provider availability, or long-duration production capacity. Those remain separate
deployment and release gates in the existing operations guides.

## Live production checks

`bun run test:production` opens a fresh Chromium context against the public
production URL and exercises all ten tools using live offers, real keyboard
movement, a completed delivery, and ended shifts. It creates only test-guest game
activity and clears only that fresh context's local history. It does not use test
endpoints, inject gameplay, or reuse the user's browser profile.

Install the project's matching Chromium first with
`bun run --filter e2e install:browsers`; use the same
`PLAYWRIGHT_BROWSERS_PATH` for installation and execution when isolating caches.
Screenshots and the machine-readable report are written under
`apps/e2e/test-results/production/`. The run can take several minutes because it
follows live GPS routes and competes with normal bots for available passengers.

Capability discovery retries a network or server failure once, with a short
backoff. Authorization failures are returned immediately. If both attempts fail,
the lobby shows Vietnamese recovery guidance instead of a raw browser fetch error.
